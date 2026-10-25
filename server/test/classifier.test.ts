import { describe, expect, it } from 'vitest';
import { BUILTIN_DICTIONARY } from '../src/classification.js';
import {
  classify,
  compactKey,
  mergeDictionaries,
  ORIGINAL,
  plainDescription,
  ratingClassOf,
  validateDictionaryExtension,
  type Dictionary,
} from '../src/classifier/classify.js';

/** Diccionario mínimo y explícito para probar las reglas sin depender del JSON del repo. */
const dict: Dictionary = {
  suffixes: ['fanart', 'art'],
  prefixes: ['nsfw'],
  original: { aliases: ['OC', 'original character'], weak: ['original'] },
  franchises: [
    {
      name: 'Naruto',
      aliases: ['Naruto Shippuden', 'Boruto', 'Konoha'],
      characters: [{ name: 'Sakura Haruno', weak: ['Sakura'] }, { name: 'Sarada Uchiha', aliases: ['Sarada'] }, 'Tsunade'],
    },
    { name: 'Street Fighter', characters: [{ name: 'Sakura Kasugano', weak: ['Sakura'] }, { name: 'Poison (Street Fighter)' }] },
    { name: 'League of Legends', aliases: ['=lol', 'Yordle'], characters: ['Tristana', { name: 'Jinx (League of Legends)' }] },
    { name: 'RWBY', characters: [{ name: 'Weiss Schnee', weak: ['Weiss'] }] },
  ],
  artists: { feithnoir: { originalCharacters: [{ name: 'Cocoa of Mdir', aliases: ['Cocoa'] }], originalSeries: ['Woodheart Cafe'] } },
};
const run = (title: string, tags: string[] = [], extra: { description?: string; username?: string } = {}) => classify(dict, { title, tags, ...extra });

describe('clasificador: alias y formas de etiqueta', () => {
  it('normaliza etiquetas y textos', () => {
    expect(compactKey('Sakura_Haruno!')).toBe('sakuraharuno');
    expect(compactKey('Pokémon')).toBe('pokemon');
  });

  it('reconoce un personaje en sus formas habituales y deduce la franquicia', () => {
    for (const tags of [['sakuraharuno'], ['sakura_haruno'], ['harunosakura'], ['SakuraHaruno'], ['sakuraharunofanart']]) {
      const r = run('Practice', tags);
      expect(r.characters, tags.join()).toEqual(['Sakura Haruno']);
      expect(r.franchises).toEqual(['Naruto']);
    }
    const t = run('Naruto - Sakura Haruno');
    expect(t.characters).toEqual(['Sakura Haruno']);
    expect(t.evidence.find((e) => e.kind === 'character')?.source).toBe('title');
  });

  it('infiere la franquicia desde el personaje cuando falta la etiqueta', () => {
    const r = run('Hot springs', ['saradauchiha', 'onsen']);
    expect(r).toMatchObject({ franchises: ['Naruto'], characters: ['Sarada Uchiha'] });
    expect(r.evidence).toContainEqual({ kind: 'franchise', value: 'Naruto', source: 'inferred', match: 'Sarada Uchiha' });
  });

  it('alias contenidos, sufijos genéricos y personaje + franquicia en una sola etiqueta', () => {
    expect(run('x', ['narutoshippudenfanart']).franchises).toEqual(['Naruto']);
    expect(run('x', ['tristanaleagueoflegends']).characters).toEqual(['Tristana']);
    // “Jinx (League of Legends)” → alias automático “jinxleagueoflegends”; “Jinx” a secas es débil
    expect(run('x', ['jinxleagueoflegends']).characters).toEqual(['Jinx (League of Legends)']);
    expect(run('Jinx', []).characters).toEqual([]);
    expect(run('LoL - Jinx', []).characters).toEqual(['Jinx (League of Legends)']);
  });

  it('las siglas con “=” solo coinciden exactas', () => {
    expect(run('x', ['lol']).franchises).toEqual(['League of Legends']);
    expect(run('x', ['lollipop']).franchises).toEqual([]);
  });

  it('alias débiles: solo con la franquicia ya detectada, y nunca como subcadena', () => {
    expect(run('Sakura x Kakashi', []).characters).toEqual([]);
    expect(run('Sakura x Sarada', []).characters.sort()).toEqual(['Sakura Haruno', 'Sarada Uchiha']);
    // “Sakura” es débil en dos franquicias: con Street Fighter detectado no se confunde con la de Naruto
    expect(run('Sakura', ['streetfighter']).characters).toEqual(['Sakura Kasugano']);
    expect(run('Weiss - Popsicle', ['weissschneerwby']).characters).toEqual(['Weiss Schnee']);
  });

  it('crossovers: varias franquicias y personajes en una obra', () => {
    const r = run('Tsunade x Tristana', ['naruto', 'leagueoflegends']);
    expect(r.franchises).toEqual(['Naruto', 'League of Legends']);
    expect(r.characters.sort()).toEqual(['Tristana', 'Tsunade']);
  });
});

describe('clasificador: Original y obras sin clasificar', () => {
  it('detecta Original por etiquetas OC, título o los OC/series del artista', () => {
    expect(run('Demon girl', ['originalcharacter']).franchises).toEqual([ORIGINAL]);
    expect(run('OC - Cherry Blossom', []).franchises).toEqual([ORIGINAL]);
    expect(run('Kokoro', ['ocart']).franchises).toEqual([ORIGINAL]);
    const oc = run('Cocoa - Winter', [], { username: 'feithnoir' });
    expect(oc).toMatchObject({ franchises: [ORIGINAL], characters: ['Cocoa of Mdir'] });
    expect(run('Woodheart Cafe - Promo', [], { username: 'feithnoir' }).franchises).toEqual([ORIGINAL]);
    // Los OC de un artista no se aplican a otro
    expect(run('Cocoa - Winter', [], { username: 'otra-persona' }).franchises).toEqual([]);
  });

  it('“original” genérico solo cuenta si no hay franquicia; “OC” de relleno no cuenta en fanart con personaje', () => {
    expect(run('Sketch', ['original']).franchises).toEqual([ORIGINAL]);
    expect(run('Naruto practice', ['original']).franchises).toEqual(['Naruto']);
    expect(run('Tsunade', ['naruto', 'originalcharacter']).franchises).toEqual(['Naruto']);
    // En una obra multi-franquicia (p. ej. un pack) sí se conserva
    expect(run('Pack', ['naruto', 'tristana', 'originalcharacter']).franchises).toContain(ORIGINAL);
  });

  it('sin señales → sin franquicia (se muestra como “Sin clasificar”)', () => {
    expect(run('Landscape practice', ['grayscale', 'practice'])).toEqual({ franchises: [], characters: [], evidence: [] });
  });

  it('la descripción solo se usa como respaldo', () => {
    const d = '<p>Fanart of Tsunade from <b>Naruto</b>! <a href="https://x.com">Patreon</a></p>';
    expect(plainDescription(d)).toBe('Fanart of Tsunade from Naruto !');
    expect(run('Untitled', [], { description: d })).toMatchObject({ franchises: ['Naruto'], characters: ['Tsunade'] });
    expect(run('Untitled', [], { description: d }).evidence[0].source).toBe('description');
    // Con señales en etiquetas, la descripción (que suele mencionar otras obras) se ignora
    expect(run('Weiss', ['rwby'], { description: d }).franchises).toEqual(['RWBY']);
  });
});

describe('clasificación SFW/NSFW (señal de DeviantArt)', () => {
  it('traduce media:rating / safety / matureLevel y no adivina', () => {
    expect(ratingClassOf('adult')).toBe('nsfw');
    expect(ratingClassOf('nonadult')).toBe('sfw');
    expect(ratingClassOf('moderate')).toBe('nsfw');
    expect(ratingClassOf('strict')).toBe('nsfw');
    expect(ratingClassOf(null)).toBe('desconocido');
    expect(ratingClassOf('')).toBe('desconocido');
    expect(ratingClassOf('raro')).toBe('desconocido');
  });
});

describe('diccionario', () => {
  it('valida las ampliaciones con mensajes en español', () => {
    expect(() => validateDictionaryExtension([])).toThrow(/objeto JSON/);
    expect(() => validateDictionaryExtension({ foo: 1 })).toThrow(/Clave no reconocida/);
    expect(() => validateDictionaryExtension({ franchises: [{ name: 'X', characters: [{ aliases: [] }] }] })).toThrow(/necesita “name”/);
    expect(() => validateDictionaryExtension({ artists: { a: { originalSeries: 'x' } } })).toThrow(/lista de textos/);
    expect(validateDictionaryExtension({ franchises: [{ name: 'Mi serie', aliases: ['miserie'] }] })).toBeTruthy();
  });

  it('las ampliaciones se suman al diccionario base sin borrar nada', () => {
    const m = mergeDictionaries(dict, { franchises: [{ name: 'naruto', aliases: ['Hokage'] }, { name: 'Nueva', aliases: ['nuevaserie'] }] });
    expect(m.franchises.find((f) => f.name === 'Naruto')!.aliases).toContain('Hokage');
    expect(m.franchises.find((f) => f.name === 'Naruto')!.aliases).toContain('Boruto');
    expect(classify(m, { title: 'x', tags: ['hokage'] }).franchises).toEqual(['Naruto']);
    expect(classify(m, { title: 'x', tags: ['nuevaserie'] }).franchises).toEqual(['Nueva']);
  });

  it('el diccionario del repositorio es válido y cubre casos reales de feithnoir', () => {
    expect(BUILTIN_DICTIONARY.franchises.length).toBeGreaterThan(80);
    const names = new Set<string>();
    for (const f of BUILTIN_DICTIONARY.franchises) {
      expect(names.has(f.name), `franquicia duplicada: ${f.name}`).toBe(false);
      names.add(f.name);
    }
    const c = (title: string, tags: string[]) => classify(BUILTIN_DICTIONARY, { title, tags, username: 'feithnoir' });
    expect(c('Konoha Mean Girls: Stream Night', [])).toMatchObject({ franchises: ['Naruto'] });
    expect(c('RWBY - Kali at Beach', ['kalibelladonna', 'rwby'])).toMatchObject({ franchises: ['RWBY'], characters: ['Kali Belladonna'] });
    expect(c('Warframe - Wisp Fanart', [])).toMatchObject({ franchises: ['Warframe'], characters: ['Wisp'] });
    expect(c('Commission - Toji and Makima', ['chainsawmanfanart', 'jujutsukaisen', 'makimachainsawman']).franchises.sort()).toEqual(['Chainsaw Man', 'Jujutsu Kaisen']);
    expect(c('Ecchitober: Day 1 - "Ritual"', ['originalcharacter', 'demongirl']).franchises).toEqual([ORIGINAL]);
    expect(c('Ecchitober: Day 3 - "Raven"', ['merchant', 'ecchitober']).franchises).toEqual([]);
    // Personajes de Eredan iTCG (no OC del artista) y nombres ambiguos de OC solo cuando la obra es original
    expect(c('Flaziir', ['fanart', 'eredanitcg'])).toMatchObject({ franchises: ['Eredan'], characters: ['Flaziir'] });
    expect(c('May Nurses Finale - Ivory and Viridian', ['catgirl', 'originalcharacter'])).toMatchObject({ franchises: [ORIGINAL], characters: ['Viridian Purr', 'Ivory Sprout'] });
    expect(c('Ivory tower', ['landscape']).characters).toEqual([]);
    // Otro artista (smoke test con metour): Akatsuki y Disney clásico
    expect(c('Kisame and Itachi', ['fanart', 'naruto', 'narutoshippuden']).characters.sort()).toEqual(['Itachi Uchiha', 'Kisame Hoshigaki']);
    expect(c('Claude Frollo sketches', ['fanart', 'frollo', 'thehunchbackofnotredame'])).toMatchObject({ franchises: ['Disney'], characters: ['Claude Frollo'] });
    expect(c('Winter lake', ['frozenlake', 'tangledhair']).franchises).toEqual([]);
    expect(c('Commission - Ash and Melia (Fire Emblem)', ['commission', 'fireemblem']).characters.sort()).toEqual(['Ash (Fire Emblem)', 'Melia (Fire Emblem)']);
  });
});
