import { createHash } from 'node:crypto';

/**
 * Clasificador transparente basado en reglas: franquicia (fuente), personajes y clasificación SFW/NSFW.
 * Sin modelos ni servicios externos: un diccionario JSON con alias y unas pocas reglas explicables.
 *
 * Reglas de coincidencia (sobre etiquetas, título y descripción):
 *  - Las etiquetas se comparan en forma “compacta” (minúsculas, sin acentos ni símbolos):
 *    “sakura_haruno”, “SakuraHaruno” y “sakuraharuno” son lo mismo.
 *  - Un alias coincide con una etiqueta si es idéntico; si tiene 6+ caracteres, también si está contenido
 *    (“tristanaleagueoflegends” contiene “tristana”); y si la etiqueta es alias + sufijo genérico
 *    (“bleachfanart”) o alias + otra franquicia (“jinxleagueoflegends”).
 *  - Un alias que empieza con “=” solo coincide exacto (útil para siglas como “=lol”).
 *  - En el título se buscan frases completas (“Sakura Haruno”, “One Piece”). La descripción solo se usa como
 *    respaldo si etiquetas y título no dieron nada (suele mencionar otras obras). Las siglas de 3 letras o menos
 *    nunca se buscan en la descripción.
 *  - Para nombres de dos palabras se prueba también el orden invertido (“Haruno Sakura”).
 *  - Los alias “débiles” (p. ej. “Sakura”, “Raven”) solo cuentan si la franquicia del personaje ya se detectó
 *    por otra vía. Un alias fuerte repetido en dos personajes se vuelve débil automáticamente.
 *  - Si se detecta un personaje y falta la etiqueta de su franquicia, la franquicia se infiere del personaje.
 *  - “Original” se detecta con etiquetas como originalcharacter / oc o con los OC declarados del artista.
 *    La etiqueta genérica “original” solo cuenta si no se encontró ninguna franquicia.
 */

export const ORIGINAL = 'Original';
export const UNCLASSIFIED = 'Sin clasificar';
export type RatingClass = 'sfw' | 'nsfw' | 'desconocido';
export const RATING_LABEL: Record<RatingClass, string> = { sfw: 'SFW', nsfw: 'NSFW', desconocido: 'Desconocido' };

export type CharacterSpec = string | { name: string; aliases?: string[]; weak?: string[] };
export interface FranchiseSpec {
  name: string;
  aliases?: string[];
  characters?: CharacterSpec[];
}
export interface ArtistSpec {
  /** Personajes originales (OC) del artista: se asignan a “Original”. */
  originalCharacters?: CharacterSpec[];
  /** Series o proyectos originales del artista (cuentan como “Original”). */
  originalSeries?: string[];
  /** Franquicias o alias extra que solo aplican a este artista. */
  franchises?: FranchiseSpec[];
}
export interface Dictionary {
  version?: string;
  description?: string;
  suffixes?: string[];
  prefixes?: string[];
  original?: { aliases?: string[]; weak?: string[] };
  franchises: FranchiseSpec[];
  artists?: Record<string, ArtistSpec>;
}

export interface Evidence {
  kind: 'franchise' | 'character' | 'original';
  value: string;
  source: 'tag' | 'title' | 'description' | 'inferred';
  /** Texto que coincidió (etiqueta, alias o personaje del que se infirió). */
  match: string;
}

export interface Classification {
  franchises: string[];
  characters: string[];
  evidence: Evidence[];
}

export interface ClassifyInput {
  title: string;
  tags: string[];
  description?: string | null;
  username?: string;
}

interface Alias {
  raw: string;
  key: string;
  phrase: string;
  exact: boolean;
}
interface CompiledCharacter {
  name: string;
  franchise: string;
  strong: Alias[];
  weak: Alias[];
}
interface CompiledFranchise {
  name: string;
  aliases: Alias[];
}
interface Compiled {
  franchises: CompiledFranchise[];
  characters: CompiledCharacter[];
  originalStrong: Alias[];
  originalWeak: Alias[];
  suffixes: Set<string>;
  prefixes: Set<string>;
  franchiseKeys: Set<string>;
  /** Series originales declaradas por el artista (cuentan siempre como Original). */
  artistOriginalKeys: Set<string>;
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** “Sakura_Haruno!” → “sakuraharuno”. */
export const compactKey = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '');
/** Texto normalizado con espacios alrededor para buscar frases completas. */
export const normText = (s: string) =>
  ` ${stripAccents(s)
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

function alias(raw: string): Alias {
  const exact = raw.startsWith('=');
  const t = exact ? raw.slice(1) : raw;
  return { raw: t, key: compactKey(t), phrase: normText(t), exact };
}

/** Variantes automáticas de un nombre: “Sakura Haruno” → también “Haruno Sakura”. */
function nameVariants(name: string): string[] {
  const words = name.replace(/\s*\(.*\)\s*$/, '').trim().split(/\s+/);
  const base = words.join(' ');
  return words.length === 2 ? [base, `${words[1]} ${words[0]}`] : [base];
}

const charSpec = (c: CharacterSpec) => (typeof c === 'string' ? { name: c } : c);

export function compileDictionary(dict: Dictionary, username?: string): Compiled {
  const franchises = new Map<string, CompiledFranchise>();
  const characters: CompiledCharacter[] = [];
  const addFranchise = (f: FranchiseSpec) => {
    const cur = franchises.get(f.name) ?? { name: f.name, aliases: [alias(f.name)] };
    for (const a of f.aliases ?? []) cur.aliases.push(alias(a));
    franchises.set(f.name, cur);
    for (const c of f.characters ?? []) addCharacter(c, f.name);
  };
  const addCharacter = (c: CharacterSpec, franchise: string) => {
    const s = charSpec(c);
    if (!s.name?.trim()) return;
    const existing = characters.find((x) => x.name === s.name && x.franchise === franchise);
    // “Raven (Teen Titans)”: el calificativo indica que el nombre a secas es ambiguo → solo alias débil.
    // Se añade también “nombre + calificativo” como alias fuerte (“raventeentitans”, “rika_pokemon”).
    // Si el personaje declara “weak” explícitamente, el nombre a secas no se añade (útil para nombres comunes: “May”).
    const qual = s.name.match(/^(.*?)\s*\((.+)\)\s*$/);
    // Un nombre que aparece en su propia lista “weak” (p. ej. “Nami”) no se usa como alias fuerte.
    const weakKeys = new Set((s.weak ?? []).map(compactKey));
    const strong = [...(qual ? [`${qual[1]} ${qual[2]}`] : nameVariants(s.name).filter((v) => !weakKeys.has(compactKey(v)))), ...(s.aliases ?? [])].map(alias);
    const weak = [...(qual && !s.weak ? nameVariants(s.name) : []), ...(s.weak ?? [])].map(alias);
    if (existing) {
      existing.strong.push(...strong);
      existing.weak.push(...weak);
    } else characters.push({ name: s.name, franchise, strong, weak });
  };
  for (const f of dict.franchises ?? []) addFranchise(f);
  const originalStrong = (dict.original?.aliases ?? []).map(alias);
  const originalWeak = (dict.original?.weak ?? []).map(alias);
  const artistOriginalKeys = new Set<string>();
  const artist = username ? dict.artists?.[username.toLowerCase()] : undefined;
  if (artist) {
    for (const f of artist.franchises ?? []) addFranchise(f);
    for (const c of artist.originalCharacters ?? []) addCharacter(c, ORIGINAL);
    for (const s of artist.originalSeries ?? []) {
      originalStrong.push(alias(s));
      artistOriginalKeys.add(compactKey(s));
    }
  }
  // Un alias fuerte compartido por varios personajes es ambiguo: pasa a débil (requiere contexto de franquicia).
  const owners = new Map<string, Set<string>>();
  for (const c of characters) for (const a of c.strong) (owners.get(a.key) ?? owners.set(a.key, new Set()).get(a.key)!).add(`${c.franchise}|${c.name}`);
  for (const c of characters) {
    const amb = c.strong.filter((a) => (owners.get(a.key)?.size ?? 0) > 1);
    if (amb.length) {
      c.strong = c.strong.filter((a) => !amb.includes(a));
      c.weak.push(...amb);
    }
  }
  const list = [...franchises.values()];
  return {
    franchises: list,
    characters,
    originalStrong,
    originalWeak,
    suffixes: new Set((dict.suffixes ?? []).map(compactKey)),
    prefixes: new Set((dict.prefixes ?? []).map(compactKey)),
    franchiseKeys: new Set(list.flatMap((f) => f.aliases.map((a) => a.key)).filter((k) => k.length >= 2)),
    artistOriginalKeys,
  };
}

function tagMatches(tag: string, a: Alias, c: Compiled, substring: boolean): boolean {
  if (!a.key) return false;
  if (tag === a.key) return true;
  if (a.exact) return false;
  if (substring && a.key.length >= 6 && tag.includes(a.key)) return true;
  if (a.key.length >= 2 && tag.length > a.key.length) {
    if (tag.startsWith(a.key)) {
      const rest = tag.slice(a.key.length);
      if (c.suffixes.has(rest) || c.franchiseKeys.has(rest)) return true;
    }
    if (tag.endsWith(a.key)) {
      const pre = tag.slice(0, tag.length - a.key.length);
      if (c.prefixes.has(pre) || c.franchiseKeys.has(pre)) return true;
    }
  }
  return false;
}

interface Ctx {
  tags: string[];
  rawTags: string[];
  title: string;
  description: string;
}

/** Devuelve dónde coincidió el alias (o null). La descripción solo se mira si ctx.useDescription. */
function find(a: Alias, ctx: Ctx & { useDescription?: boolean }, c: Compiled, weak = false): { source: Evidence['source']; match: string } | null {
  // Los alias débiles no se buscan como subcadena (“sakura” no debe saltar dentro de “sakuraharuno”).
  for (let i = 0; i < ctx.tags.length; i++) if (tagMatches(ctx.tags[i], a, c, !weak)) return { source: 'tag', match: ctx.rawTags[i] };
  const len = a.phrase.trim().length;
  if (len >= 2 && ctx.title.includes(a.phrase)) return { source: 'title', match: a.raw };
  if (ctx.useDescription && !weak && len >= 4 && !a.exact && ctx.description.includes(a.phrase)) return { source: 'description', match: a.raw };
  return null;
}

/** Texto plano de una descripción HTML (sin enlaces ni etiquetas). */
export function plainDescription(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<a\b[^>]*>.*?<\/a>/gis, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
}

export function classifyWith(c: Compiled, input: ClassifyInput): Classification {
  const rawTags = input.tags.filter(Boolean);
  const ctx: Ctx = { rawTags, tags: rawTags.map(compactKey), title: normText(input.title ?? ''), description: normText(plainDescription(input.description)) };
  const evidence: Evidence[] = [];
  const franchises: string[] = [];
  const characters: string[] = [];
  const addF = (name: string, ev: Omit<Evidence, 'kind' | 'value'>) => {
    if (franchises.includes(name)) return;
    franchises.push(name);
    evidence.push({ kind: name === ORIGINAL ? 'original' : 'franchise', value: name, ...ev });
  };
  const addC = (ch: CompiledCharacter, ev: Omit<Evidence, 'kind' | 'value'>) => {
    if (characters.includes(ch.name)) return;
    characters.push(ch.name);
    evidence.push({ kind: 'character', value: ch.name, ...ev });
  };

  // La descripción suele mencionar otras obras (promos, próximas entregas), así que solo se usa como respaldo:
  // primero etiquetas + título; si no aparece nada, se repite la búsqueda incluyendo la descripción.
  const run = (useDescription: boolean) => {
    const cx = { ...ctx, useDescription };
    // 1) Franquicias por alias directos.
    for (const f of c.franchises) {
      for (const a of f.aliases) {
        const hit = find(a, cx, c);
        if (hit) {
          addF(f.name, hit);
          break;
        }
      }
    }
    // 2) Personajes con alias fuertes (e inferencia de su franquicia).
    const matched = new Set<CompiledCharacter>();
    for (const ch of c.characters) {
      for (const a of ch.strong) {
        const hit = find(a, cx, c);
        if (hit) {
          matched.add(ch);
          addC(ch, hit);
          break;
        }
      }
    }
    for (const ch of matched) addF(ch.franchise, { source: 'inferred', match: ch.name });
    // 3) Alias débiles: solo si la franquicia del personaje ya está presente. No reutilizan un alias de franquicia.
    const weakPass = () => {
      for (const ch of c.characters) {
        if (matched.has(ch) || characters.includes(ch.name) || !franchises.includes(ch.franchise)) continue;
        for (const a of ch.weak) {
          if (c.franchiseKeys.has(a.key)) continue;
          const hit = find(a, cx, c, true);
          if (hit) {
            addC(ch, hit);
            break;
          }
        }
      }
    };
    weakPass();
    // 4) Original: señales fuertes siempre; la genérica (“original”) solo si no hay otra franquicia.
    if (!franchises.includes(ORIGINAL)) {
      const strong = c.originalStrong.map((a) => find(a, cx, c)).find(Boolean);
      if (strong) addF(ORIGINAL, strong);
      else if (!franchises.length) {
        const weak = c.originalWeak.map((a) => find(a, cx, c, true)).find(Boolean);
        if (weak) addF(ORIGINAL, weak);
      }
      // Los OC del artista con nombre ambiguo (“Ivory”) cuentan cuando la obra resultó ser original.
      if (franchises.includes(ORIGINAL)) weakPass();
    }
  };
  run(false);
  if (!franchises.length && !characters.length && ctx.description.trim()) run(true);
  // Una etiqueta “OC” genérica en un fanart de una sola franquicia con personaje identificado suele ser relleno:
  // no se cuenta como Original (sí cuenta si coincide un OC o serie propia del artista, o en obras multi-franquicia).
  const orig = evidence.find((e) => e.kind === 'original');
  const otherFr = franchises.filter((f) => f !== ORIGINAL);
  const charsOfOther = characters.filter((n) => c.characters.some((ch) => ch.name === n && ch.franchise !== ORIGINAL));
  if (orig && orig.source !== 'inferred' && !c.artistOriginalKeys.has(compactKey(orig.match)) && otherFr.length === 1 && charsOfOther.length) {
    franchises.splice(franchises.indexOf(ORIGINAL), 1);
    evidence.splice(evidence.indexOf(orig), 1);
  }
  return { franchises, characters, evidence };
}

/** Atajo: compila y clasifica (en lote conviene compilar una vez con compileDictionary). */
export function classify(dict: Dictionary, input: ClassifyInput): Classification {
  return classifyWith(compileDictionary(dict, input.username), input);
}

/** SFW/NSFW a partir de la señal propia de DeviantArt (RSS media:rating u oEmbed safety). */
export function ratingClassOf(raw: string | null | undefined): RatingClass {
  const v = (raw ?? '').trim().toLowerCase();
  if (['adult', 'mature', 'moderate', 'strict', 'true', 'nsfw'].includes(v)) return 'nsfw';
  if (['nonadult', 'non-adult', 'false', 'none', 'sfw', 'general'].includes(v)) return 'sfw';
  return 'desconocido';
}

/** Une el diccionario base con las ampliaciones del usuario (mismas reglas, sin borrar nada). */
export function mergeDictionaries(base: Dictionary, extra: Partial<Dictionary> | null | undefined): Dictionary {
  if (!extra) return base;
  const franchises = base.franchises.map((f) => ({ ...f, aliases: [...(f.aliases ?? [])], characters: [...(f.characters ?? [])] }));
  for (const f of extra.franchises ?? []) {
    const cur = franchises.find((x) => x.name.toLowerCase() === f.name.toLowerCase());
    if (cur) {
      cur.aliases.push(...(f.aliases ?? []));
      cur.characters.push(...(f.characters ?? []));
    } else franchises.push({ name: f.name, aliases: [...(f.aliases ?? [])], characters: [...(f.characters ?? [])] });
  }
  const artists: Record<string, ArtistSpec> = { ...(base.artists ?? {}) };
  for (const [u, a] of Object.entries(extra.artists ?? {})) {
    const cur = artists[u.toLowerCase()] ?? {};
    artists[u.toLowerCase()] = {
      originalCharacters: [...(cur.originalCharacters ?? []), ...(a.originalCharacters ?? [])],
      originalSeries: [...(cur.originalSeries ?? []), ...(a.originalSeries ?? [])],
      franchises: [...(cur.franchises ?? []), ...(a.franchises ?? [])],
    };
  }
  return {
    ...base,
    suffixes: [...(base.suffixes ?? []), ...(extra.suffixes ?? [])],
    prefixes: [...(base.prefixes ?? []), ...(extra.prefixes ?? [])],
    original: { aliases: [...(base.original?.aliases ?? []), ...(extra.original?.aliases ?? [])], weak: [...(base.original?.weak ?? []), ...(extra.original?.weak ?? [])] },
    franchises,
    artists,
  };
}

const isStrArr = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
function checkChars(v: unknown, where: string) {
  if (v === undefined) return;
  if (!Array.isArray(v)) throw new Error(`${where}: “characters” debe ser una lista.`);
  for (const c of v) {
    if (typeof c === 'string') continue;
    if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim()) throw new Error(`${where}: cada personaje necesita “name”.`);
    if (c.aliases !== undefined && !isStrArr(c.aliases)) throw new Error(`${where}: “aliases” de ${c.name} debe ser una lista de textos.`);
    if (c.weak !== undefined && !isStrArr(c.weak)) throw new Error(`${where}: “weak” de ${c.name} debe ser una lista de textos.`);
  }
}

/** Valida una ampliación del diccionario enviada por el usuario. Lanza errores en español. */
export function validateDictionaryExtension(input: unknown): Partial<Dictionary> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('El diccionario debe ser un objeto JSON.');
  const d = input as Record<string, unknown>;
  const allowed = ['franchises', 'artists', 'suffixes', 'prefixes', 'original', 'version', 'description'];
  for (const k of Object.keys(d)) if (!allowed.includes(k)) throw new Error(`Clave no reconocida: “${k}”. Usa: ${allowed.join(', ')}.`);
  if (d['franchises'] !== undefined) {
    if (!Array.isArray(d['franchises'])) throw new Error('“franchises” debe ser una lista.');
    for (const f of d['franchises'] as unknown[]) {
      const fr = f as Record<string, unknown>;
      if (!fr || typeof fr !== 'object' || typeof fr['name'] !== 'string' || !fr['name'].trim()) throw new Error('Cada franquicia necesita “name”.');
      if (fr['aliases'] !== undefined && !isStrArr(fr['aliases'])) throw new Error(`“aliases” de ${fr['name']} debe ser una lista de textos.`);
      checkChars(fr['characters'], String(fr['name']));
    }
  }
  for (const k of ['suffixes', 'prefixes']) if (d[k] !== undefined && !isStrArr(d[k])) throw new Error(`“${k}” debe ser una lista de textos.`);
  if (d['original'] !== undefined) {
    const o = d['original'] as Record<string, unknown>;
    if (!o || typeof o !== 'object' || (o['aliases'] !== undefined && !isStrArr(o['aliases'])) || (o['weak'] !== undefined && !isStrArr(o['weak'])))
      throw new Error('“original” debe tener listas de textos en “aliases” y/o “weak”.');
  }
  if (d['artists'] !== undefined) {
    if (!d['artists'] || typeof d['artists'] !== 'object' || Array.isArray(d['artists'])) throw new Error('“artists” debe ser un objeto { usuario: {...} }.');
    for (const [u, a] of Object.entries(d['artists'] as Record<string, Record<string, unknown>>)) {
      if (!a || typeof a !== 'object') throw new Error(`artists.${u} debe ser un objeto.`);
      checkChars(a['originalCharacters'], `artists.${u}.originalCharacters`);
      if (a['originalSeries'] !== undefined && !isStrArr(a['originalSeries'])) throw new Error(`artists.${u}.originalSeries debe ser una lista de textos.`);
      if (a['franchises'] !== undefined) validateDictionaryExtension({ franchises: a['franchises'] });
    }
  }
  if (JSON.stringify(d).length > 500_000) throw new Error('El diccionario personalizado es demasiado grande (máx. 500 KB).');
  return d as Partial<Dictionary>;
}

/** Sube cuando cambian las reglas del clasificador: invalida las clasificaciones guardadas aunque el diccionario sea el mismo. */
export const CLASSIFIER_VERSION = 2;

/** Huella del diccionario + versión de las reglas (se guarda con cada clasificación para saber si está vigente). */
export const dictionaryHash = (d: Dictionary) => createHash('sha1').update(`v${CLASSIFIER_VERSION}:${JSON.stringify(d)}`).digest('hex').slice(0, 12);

/** Personaje → franquicia (para mostrar a qué fuente pertenece cada personaje). */
export function characterIndex(d: Dictionary): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of d.franchises) for (const c of f.characters ?? []) m.set(charSpec(c).name, f.name);
  for (const a of Object.values(d.artists ?? {})) {
    for (const f of a.franchises ?? []) for (const c of f.characters ?? []) m.set(charSpec(c).name, f.name);
    for (const c of a.originalCharacters ?? []) m.set(charSpec(c).name, ORIGINAL);
  }
  return m;
}
