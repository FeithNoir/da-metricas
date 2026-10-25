import { describe, expect, it } from 'vitest';
import {
  BenchmarkService,
  browseUrl,
  estimateCost,
  HOME_URL,
  normalizeScope,
  planSources,
  validateAutoSettings,
  validateBenchmarkParams,
  DEFAULT_AUTO,
} from '../src/benchmark.js';
import { Db } from '../src/db.js';
import { DeviantArtClient } from '../src/deviantart.js';
import { PoliteClient } from '../src/http.js';
import { fakeFetch, fixture, type Route } from './helpers.js';

const oembed = fixture('oembed-invocation.json');

function service(route: Route) {
  const db = new Db(':memory:');
  const f = fakeFetch(route);
  const http = new PoliteClient({ db, fetch: f, delayMs: 0, maxRetries: 1, sleep: async () => {} });
  return { db, f, svc: new BenchmarkService(db, new DeviantArtClient(http)) };
}

const daRoute: Route = (url) => {
  if (url === HOME_URL) return { body: fixture('browse-home.html') };
  if (url.includes('/tag/') && url.includes('most-recent')) return { body: fixture('browse-recent.html') };
  if (url.includes('/tag/') && url.includes('popular-all-time')) return { body: fixture('browse-popular.html') };
  if (url.startsWith('https://backend.deviantart.com/oembed')) {
    if (url.includes('1401768647')) return { status: 500, body: 'error' }; // una obra sin oEmbed
    return { body: oembed };
  }
  return undefined;
};

describe('parámetros de una medición', () => {
  it('valida tipo, alcance y tamaño con mensajes en español', () => {
    expect(validateBenchmarkParams({ kind: 'recent' })).toEqual({ kind: 'recent', scope: 'general', size: 100 });
    expect(validateBenchmarkParams({ kind: 'popular', scope: ' #Naruto ', size: 48 })).toEqual({ kind: 'popular', scope: 'naruto', size: 48 });
    expect(() => validateBenchmarkParams({ kind: 'x' })).toThrow(/recientes/);
    expect(() => validateBenchmarkParams({ kind: 'recent', size: 5 })).toThrow(/entre 24 y 300/);
    expect(() => validateBenchmarkParams({ kind: 'recent', size: 1000 })).toThrow(/entre 24 y 300/);
    expect(() => validateBenchmarkParams({ kind: 'recent', size: 50.5 })).toThrow(/entero/);
    expect(() => validateBenchmarkParams({ kind: 'recent', scope: '!' })).toThrow(/etiqueta/);
    expect(() => validateBenchmarkParams(null)).toThrow(/JSON/);
  });

  it('normaliza etiquetas como DeviantArt', () => {
    expect(normalizeScope('Pokémon')).toBe('pokemon');
    expect(normalizeScope('One Piece')).toBe('onepiece');
    expect(normalizeScope('')).toBe('general');
    expect(normalizeScope('GENERAL')).toBe('general');
    expect(normalizeScope('digital_art')).toBe('digital_art');
  });

  it('planifica fuentes y estima el costo', () => {
    expect(planSources('popular', 'general')[0]!.url(1)).toBe(HOME_URL);
    expect(planSources('recent', 'general').some((s) => s.label === 'portada')).toBe(false);
    expect(planSources('recent', 'naruto').map((s) => s.url(2))).toEqual(['https://www.deviantart.com/tag/naruto?order=most-recent&page=2']);
    expect(browseUrl('fanart', 'popular')).toBe('https://www.deviantart.com/tag/fanart?order=popular-all-time');
    const e = estimateCost(100, 600, 2);
    expect(e).toMatchObject({ pages: 5, requests: 105, seconds: 41, megabytes: 7 });
    // General: al menos una página por etiqueta amplia
    expect(estimateCost(100, 600, 2, 9)).toMatchObject({ pages: 9, requests: 109 });
  });

  it('ajustes automáticos', () => {
    expect(validateAutoSettings({ enabled: true }, DEFAULT_AUTO)).toEqual({ enabled: true, size: 100, scope: 'general' });
    expect(validateAutoSettings({ size: 48, scope: 'anime' }, DEFAULT_AUTO)).toMatchObject({ size: 48, scope: 'anime' });
    expect(() => validateAutoSettings({ enabled: 'sí' }, DEFAULT_AUTO)).toThrow();
    expect(() => validateAutoSettings({ size: 2 }, DEFAULT_AUTO)).toThrow();
  });
});

describe('BenchmarkService', () => {
  it('Recientes por etiqueta: lista, quita repetidas, enriquece con oEmbed y guarda', async () => {
    const { db, f, svc } = service(daRoute);
    const { run, done } = svc.start({ kind: 'recent', scope: 'fanart', size: 24 });
    expect(run.status).toBe('running');
    // Una a la vez
    expect(svc.start({ kind: 'popular', scope: 'general', size: 24 }).reused).toBe(true);
    const fin = await done;
    expect(fin.status).toBe('partial'); // solo 6 obras distintas en la fixture y una sin oEmbed
    expect(fin.message).toMatch(/Solo se encontraron 6 de 24/);
    expect(fin.message).toMatch(/1 obra\(s\) sin oEmbed/);
    expect(fin).toMatchObject({ found: 6, processed: 6, failed: 1, items: 6 });
    expect(f.calls.filter((u) => u.includes('/tag/'))).toEqual([
      'https://www.deviantart.com/tag/fanart?order=most-recent',
      'https://www.deviantart.com/tag/fanart?order=most-recent&page=2',
    ]);
    const items = db.benchmarkItems(fin.id);
    expect(items).toHaveLength(6);
    // Más nuevas primero
    expect(items.map((i) => Date.parse(i.publishedAt!))).toEqual([...items.map((i) => Date.parse(i.publishedAt!))].sort((a, b) => b - a));
    const fallback = items.find((i) => i.id === '1401768647')!;
    expect(fallback).toMatchObject({ statsSource: 'browse', tags: [], views: 2 });
    const enriched = items.find((i) => i.statsSource === 'oembed')!;
    expect(enriched.tags).toContain('ecchitober');
    expect(enriched).toMatchObject({ views: 373, favourites: 5, comments: 3, rating: 'adult', source: 'fanart' });
    // Las páginas de 1,3 MB no se guardan en la caché
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM http_cache WHERE url LIKE '%/tag/%' OR url LIKE '%oembed%'").get()).toEqual({ n: 0 });
    // Una segunda medición vuelve a pedir todo (cifras frescas)
    const before = f.calls.filter((u) => u.includes('oembed')).length;
    await svc.start({ kind: 'recent', scope: 'fanart', size: 24 }).done;
    expect(f.calls.filter((u) => u.includes('oembed')).length).toBe(before * 2);
    expect(svc.running).toBeNull();
  });

  it('Populares general: portada primero y luego etiquetas amplias por turnos', async () => {
    const { db, f, svc } = service(daRoute);
    const fin = await svc.start({ kind: 'popular', scope: 'general', size: 24 }).done;
    expect(f.calls[0]).toBe(HOME_URL);
    expect(f.calls.filter((u) => u.includes('/tag/')).length).toBeGreaterThanOrEqual(1);
    expect(fin.sources[0]).toBe(HOME_URL);
    const items = db.benchmarkItems(fin.id);
    expect(items[0]).toMatchObject({ source: 'portada', rank: 0 });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.some((i) => i.source !== 'portada')).toBe(true);
  });

  it('Cloudflare detiene la medición sin reintentar', async () => {
    const { db, svc } = service(() => ({ status: 403, body: '<title>Just a moment...</title> cf-chl', headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' } }));
    const fin = await svc.start({ kind: 'recent', scope: 'anime', size: 24 }).done;
    expect(fin.status).toBe('error');
    expect(fin.message).toMatch(/Cloudflare/);
    expect(db.benchmarkItems(fin.id)).toHaveLength(0);
  });

  it('etiqueta sin obras → vacía', async () => {
    const { svc } = service((url) => (url.includes('/tag/') ? { body: '<html><script>window.__INITIAL_STATE__ = JSON.parse("{\\"@@entities\\":{},\\"@@streams\\":{}}");</script></html>' } : undefined));
    const fin = await svc.start({ kind: 'recent', scope: 'zzzz', size: 24 }).done;
    expect(fin.status).toBe('empty');
    expect(fin.message).toMatch(/zzzz/);
  });
});
