import { describe, expect, it } from 'vitest';
import { parseBrowsePage } from '../src/parsers/browse.js';
import { parseOembed } from '../src/parsers/oembed.js';
import { extractInitialState, parseDeviationPage, parseGalleryPage } from '../src/parsers/page.js';
import { parseRssPage } from '../src/parsers/rss.js';
import { decodeEntities, deviationIdFromUrl, fixMojibake, toIso } from '../src/parsers/text.js';
import { fixture } from './helpers.js';

describe('RSS de la galería (respuesta real recortada)', () => {
  it('lee título, URL, id, fecha, miniatura y el enlace a la página siguiente', () => {
    const page = parseRssPage(fixture('rss-feithnoir-page1.xml'));
    expect(page.channelTitle).toBe("DeviantArt: feithnoir's gallery");
    expect(page.items).toHaveLength(3);
    const first = page.items[0];
    expect(first.id).toBe('1401415400');
    expect(first.title).toBe('Ecchitober: Day 23 - "Invocation"');
    expect(first.url).toBe('https://www.deviantart.com/feithnoir/art/Ecchitober%3A-Day-23---%22Invocation%22-1401415400');
    expect(first.publishedAt).toBe('2026-10-24T05:20:48.000Z');
    expect(first.author).toBe('FeithNoir');
    expect(first.rating).toBe('adult');
    expect(first.thumbnail).toMatch(/w_300,h_900/);
    expect(first.keywords).toEqual([]);
    // media:description (HTML del autor) se guarda para clasificar franquicia y personajes
    expect(first.description).toMatch(/Lillith/);
    expect(first.description).not.toMatch(/&lt;/);
    expect(page.nextUrl).toBe('https://backend.deviantart.com/rss.xml?type=deviation&q=gallery%3Afeithnoir&offset=60');
  });

  it('la última página no trae “next”', () => {
    const page = parseRssPage(fixture('rss-feithnoir-last.xml'));
    expect(page.items).toHaveLength(2);
    expect(page.nextUrl).toBeNull();
    // SFW/NSFW: DeviantArt marca cada obra con media:rating (adult / nonadult)
    expect(page.items.map((i) => i.rating)).toEqual(['nonadult', 'nonadult']);
  });

  it('un usuario inexistente devuelve un feed vacío', () => {
    const page = parseRssPage(fixture('rss-nouser.xml'));
    expect(page.items).toEqual([]);
    expect(page.nextUrl).toBeNull();
  });

  it('rechaza lo que no es RSS', () => {
    expect(() => parseRssPage('<html><body>hola</body></html>')).toThrow(/RSS/);
  });
});

describe('oEmbed (respuesta real)', () => {
  it('extrae estadísticas, etiquetas y fecha', () => {
    const d = parseOembed(fixture('oembed-invocation.json'));
    expect(d).toMatchObject({ title: 'Ecchitober: Day 23 - "Invocation"', author: 'FeithNoir', views: 373, favourites: 5, comments: 3, downloads: 0, rating: 'adult', source: 'oembed' });
    expect(d.publishedAt).toBe('2026-10-24T05:20:48.000Z');
    expect(d.tags).toEqual(['demongirl', 'originalcharacter', 'fanart', 'magic', 'sexy', 'invocation', 'demon_girl', 'exposedbreasts', 'nsfwpatreonartist', 'ecchitober']);
  });
  it('acepta obras sin etiquetas', () => {
    const d = parseOembed(fixture('oembed-notags.json'));
    expect(d.tags).toEqual([]);
    expect(d.views).toBe(138);
  });
  it('tolera texto extra al final y falla claro sin estadísticas', () => {
    expect(parseOembed(fixture('oembed-invocation.json') + '\n').views).toBe(373);
    expect(() => parseOembed('{"title":"x"}')).toThrow(/estadísticas/);
    expect(() => parseOembed('Not found')).toThrow();
  });
});

describe('páginas HTML (respaldo)', () => {
  it('lee el estado embebido de una obra', () => {
    const d = parseDeviationPage(fixture('deviation-page.html'), '1401415400');
    expect(d).toMatchObject({ views: 373, favourites: 5, comments: 3, downloads: 1, author: 'FeithNoir', source: 'page' });
    expect(d.tags).toContain('ecchitober');
    expect(d.publishedAt).toBe('2026-10-24T05:20:48.000Z');
  });
  it('falla si la obra no está o no hay estado', () => {
    expect(() => parseDeviationPage(fixture('deviation-page.html'), '1')).toThrow(/no contiene/);
    expect(() => parseDeviationPage('<html></html>', '1')).toThrow(/estado embebido/);
    expect(extractInitialState('<html></html>')).toBeNull();
  });
  it('lee el total de la galería y el avatar', () => {
    const g = parseGalleryPage(fixture('gallery-page.html'), 'FeithNoir');
    expect(g).toMatchObject({ username: 'feithnoir', displayName: 'FeithNoir', total: 702 });
    expect(g?.premiumFolders).toBe(1);
    expect(g?.avatar).toMatch(/feithnoir\.jpg/);
  });
});

describe('utilidades de texto', () => {
  it('repara UTF-8 mal decodificado (como el oEmbed de DeviantArt) sin tocar texto correcto', () => {
    expect(fixMojibake('Illustration for ARTMIF project: \u00c2\u00abSlavic Mythology\u00c2\u00bb')).toBe('Illustration for ARTMIF project: «Slavic Mythology»');
    // Con caracteres fuera de Latin-1 (‰) no se puede saber con certeza: se deja igual
    expect(fixMojibake('Ã‰xito y canciÃ³n')).toBe('Ã‰xito y canciÃ³n');
    expect(fixMojibake('canciÃ³n')).toBe('canción');
    expect(fixMojibake('Pokémon «Ash»')).toBe('Pokémon «Ash»');
    expect(fixMojibake('Ñandú')).toBe('Ñandú');
    expect(fixMojibake('Día 23 – “Invocation”')).toBe('Día 23 – “Invocation”');
  });

  it('decodifica entidades y extrae ids', () => {
    expect(decodeEntities('&quot;A&quot; &amp; B&#039;s &#x263A;')).toBe('"A" & B\'s ☺');
    expect(deviationIdFromUrl('https://www.deviantart.com/u/art/Some-Title-12345')).toBe('12345');
    expect(deviationIdFromUrl('https://www.deviantart.com/u')).toBeNull();
    expect(toIso('2020-02-15T08:05:47-0800')).toBe('2020-02-15T16:05:47.000Z');
    expect(toIso('nope')).toBeNull();
  });
});

describe('páginas de exploración (etiqueta y portada, respuestas reales recortadas)', () => {
  it('lee lo más reciente de una etiqueta con cifras, autor, fecha y clasificación', () => {
    const page = parseBrowsePage(fixture('browse-recent.html'));
    expect(page.pageType).toBeTruthy();
    expect(page.requestParams).toMatchObject({ tag: 'fanart', order: 'most-recent' });
    expect(page.items.length).toBeGreaterThan(0);
    const first = page.items[0]!;
    expect(first).toMatchObject({ id: '1401768647', author: 'drav2255', views: 2, position: 0 });
    expect(first.url).toMatch(/^https:\/\/www\.deviantart\.com\/drav2255\/art\/.+-1401768647$/);
    expect(first.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(['adult', 'nonadult']).toContain(first.rating);
    // Orden del flujo = más nuevas primero
    const dates = page.items.map((i) => Date.parse(i.publishedAt!));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('lee populares de una etiqueta y la portada', () => {
    const pop = parseBrowsePage(fixture('browse-popular.html'));
    expect(pop.items[0]).toMatchObject({ id: '753799011', author: 'arkuny', views: 440160 });
    expect(pop.items.every((i) => i.type !== 'journal')).toBe(true);
    const home = parseBrowsePage(fixture('browse-home.html'));
    expect(home.items[0]).toMatchObject({ id: '1348309161', author: 'rynziera', views: 710170 });
    expect(home.items.every((i) => i.favourites !== null)).toBe(true);
  });

  it('falla con un mensaje claro si la página no trae datos', () => {
    expect(() => parseBrowsePage('<html><body>nada</body></html>')).toThrow();
  });
});
