import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { fakeFetch, fixture } from './helpers.js';

/** “Internet” simulado con las respuestas reales guardadas. */
function fakeDeviantArt() {
  const page1 = fixture('rss-feithnoir-page1.xml');
  const last = fixture('rss-feithnoir-last.xml');
  const oembed = fixture('oembed-invocation.json');
  return fakeFetch((url) => {
    if (url === 'https://www.deviantart.com/feithnoir/gallery') return { body: fixture('gallery-page.html') };
    if (url.includes('/gallery')) return undefined; // otros usuarios: 404
    if (url.startsWith('https://backend.deviantart.com/rss.xml')) {
      if (!url.includes('gallery%3Afeithnoir')) return { body: fixture('rss-nouser.xml') };
      return { body: url.includes('offset=60') ? last : page1 };
    }
    if (url.startsWith('https://backend.deviantart.com/oembed')) {
      // Una obra falla en oEmbed y se resuelve con la página HTML de respaldo
      if (url.includes('1401415400')) return { status: 500, body: 'error' };
      const id = decodeURIComponent(url).match(/-(\d+)$/)?.[1] ?? '0';
      const views = (Number(id) % 1000) + 50;
      return { body: oembed.replace('"views": 373', `"views": ${views}`).replace(/"views":\s*373/, `"views":${views}`) };
    }
    if (url.includes('/art/') && url.includes('1401415400')) return { body: fixture('deviation-page.html') };
    return undefined;
  });
}

describe('API REST', () => {
  let app: FastifyInstance;
  afterEach(async () => app?.close());

  async function setup() {
    const f = fakeDeviantArt();
    app = await buildApp({ dbFile: ':memory:', fetch: f, delayMs: 0, maxRetries: 1, sleep: async () => {} });
    return f;
  }

  it('health y artistas vacíos', async () => {
    await setup();
    expect((await app.inject('/api/health')).json()).toEqual({ ok: true });
    expect((await app.inject('/api/artists')).json()).toEqual({ artists: [] });
    expect((await app.inject('/api/artists/feithnoir')).statusCode).toBe(404);
    expect((await app.inject('/api/artists/no%20valido')).statusCode).toBe(400);
  });

  it('sincroniza con las fixtures y expone obras, análisis, detalle y CSV', async () => {
    const f = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/artists/FeithNoir/sync' });
    expect(res.statusCode).toBe(202);
    const { sync } = res.json();
    let done = sync;
    for (let i = 0; i < 200 && done.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 10));
      done = (await app.inject(`/api/syncs/${sync.id}`)).json().sync;
    }
    expect(done).toMatchObject({ status: 'ok', found: 5, processed: 5, failed: 0 });
    // Usa el respaldo HTML para la obra cuyo oEmbed falló
    expect(f.calls.some((u) => u.includes('/art/') && u.includes('1401415400'))).toBe(true);

    const artist = (await app.inject('/api/artists/feithnoir')).json();
    expect(artist.artist).toMatchObject({ username: 'feithnoir', displayName: 'FeithNoir', galleryTotal: 702, works: 5, worksWithMetrics: 5 });

    const list = (await app.inject('/api/artists/feithnoir/deviations?sort=views&order=desc')).json();
    expect(list.total).toBe(5);
    expect(list.items[0].views).toBeGreaterThanOrEqual(list.items[1].views);
    const byPage = list.items.find((d: { id: string }) => d.id === '1401415400');
    expect(byPage).toMatchObject({ views: 373, statsSource: 'page' });
    expect(byPage.tags).toContain('ecchitober');

    expect((await app.inject('/api/artists/feithnoir/deviations?q=invocation')).json().total).toBe(1);
    expect((await app.inject('/api/artists/feithnoir/deviations?tag=ecchitober')).json().total).toBe(5);
    expect((await app.inject('/api/artists/feithnoir/deviations?from=2026-01-01&to=2026-12-31')).json().total).toBe(3);

    const analysis = (await app.inject('/api/artists/feithnoir/analysis')).json();
    expect(analysis.works).toBe(5);
    expect(analysis.descriptive.views.n).toBe(5);
    expect(analysis.insights.length).toBeGreaterThan(2);

    const detail = (await app.inject('/api/deviations/1401415400')).json();
    expect(detail.history).toHaveLength(1);
    expect(detail.detail.peers).toBe(5);
    expect((await app.inject('/api/deviations/999')).statusCode).toBe(404);

    const csv = await app.inject('/api/artists/feithnoir/export.csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.body.trim().split('\r\n');
    expect([...csv.rawPayload.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 para Excel
    expect(lines[0].replace('\uFEFF', '')).toBe('id,titulo,url,publicada,vistas,favoritos,comentarios,descargas,tasa_favoritos,tasa_comentarios,vistas_por_dia,etiquetas,clasificacion_deviantart,sfw_nsfw,franquicias,personajes,metricas_al');
    expect(lines).toHaveLength(6);

    // Clasificación automática tras sincronizar: SFW/NSFW desde media:rating y Original desde la etiqueta originalcharacter
    expect(byPage).toMatchObject({ ratingClass: 'nsfw', franchises: ['Original'], classificationOverridden: false });
    expect(lines[1]).toContain('nsfw');
    expect(analysis.classification.coverage.works).toBe(5);
    expect(analysis.classification.ratings.find((r: { key: string }) => r.key === 'nsfw').count).toBeGreaterThan(0);
    expect(detail.classification.rawRating).toBe('adult');
    expect(detail.classification.evidence.some((e: { kind: string; match: string }) => e.kind === 'original' && e.match === 'originalcharacter')).toBe(true);

    // segunda sincronización → segundo snapshot e historial
    await app.syncService.start('feithnoir').done;
    expect((await app.inject('/api/deviations/1401415400')).json().history).toHaveLength(2);
  });

  it('correcciones manuales, filtros, diccionario personalizado y reclasificación', async () => {
    await setup();
    await app.syncService.start('feithnoir').done;
    const id = '1401415400';
    const put = (payload: unknown) => app.inject({ method: 'PUT', url: `/api/deviations/${id}/classification`, payload: payload as object });

    // Validación en español
    expect((await put({ rating: 'rojo' })).statusCode).toBe(400);
    expect((await put({ franchises: 'Naruto' })).json().error).toMatch(/lista de textos/);
    expect((await app.inject({ method: 'PUT', url: '/api/deviations/abc/classification', payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/deviations/123/classification', payload: {} })).statusCode).toBe(404);

    // La corrección manual manda sobre la automática
    const ok = await put({ franchises: ['Naruto', ' Naruto '], characters: ['Sakura Haruno'], rating: 'sfw' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().classification.effective).toEqual({ franchises: ['Naruto'], characters: ['Sakura Haruno'], ratingClass: 'sfw' });
    expect(ok.json().classification.auto.franchises).toEqual(['Original']);
    const w = (await app.inject(`/api/artists/feithnoir/deviations?franchise=naruto`)).json();
    expect(w.items.map((x: { id: string }) => x.id)).toEqual([id]);
    expect(w.items[0]).toMatchObject({ ratingClass: 'sfw', classificationOverridden: true });
    expect((await app.inject('/api/artists/feithnoir/deviations?character=sakura%20haruno')).json().total).toBe(1);
    expect((await app.inject('/api/artists/feithnoir/deviations?rating=sfw')).json().total).toBe(3); // 2 SFW de origen + la corregida
    expect((await app.inject('/api/artists/feithnoir/deviations?rating=nsfw')).json().total).toBe(2);

    // Campos omitidos se conservan; null vuelve a lo automático
    expect((await put({ rating: null })).json().classification.effective).toMatchObject({ franchises: ['Naruto'], ratingClass: 'nsfw' });
    // La reclasificación no pisa las correcciones
    const re = (await app.inject({ method: 'POST', url: '/api/artists/feithnoir/reclassify' })).json();
    expect(re).toMatchObject({ works: 5, overrides: 1 });
    expect((await app.inject(`/api/deviations/${id}`)).json().classification.effective.franchises).toEqual(['Naruto']);
    const an = (await app.inject('/api/artists/feithnoir/analysis')).json();
    expect(an.classification.coverage.overrides).toBe(1);
    expect(an.classification.franchises.find((f: { key: string }) => f.key === 'Naruto').count).toBe(1);
    // Borrar la corrección
    const del = (await app.inject({ method: 'DELETE', url: `/api/deviations/${id}/classification` })).json();
    expect(del.classification.override).toBeNull();
    expect(del.classification.effective.franchises).toEqual(['Original']);
    // Una corrección que deja todo en null equivale a borrarla (no queda marcada como manual)
    await put({ rating: 'nsfw' });
    const allNull = (await put({ rating: null })).json().classification;
    expect(allNull.override).toBeNull();
    expect((await app.inject(`/api/deviations/${id}`)).json().deviation.classificationOverridden).toBe(false);

    // Diccionario personalizado: valida, guarda y reclasifica todo
    const bad = await app.inject({ method: 'PUT', url: '/api/dictionary/custom', payload: { franchises: [{ aliases: ['x'] }] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/necesita “name”/);
    const before = (await app.inject('/api/dictionary')).json();
    expect(before.franchises.length).toBeGreaterThan(50);
    const saved = await app.inject({ method: 'PUT', url: '/api/dictionary/custom', payload: { franchises: [{ name: 'Brujería Gótica', aliases: ['ecchitober'] }] } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().hash).not.toBe(before.hash);
    expect(saved.json().reclassified).toBe(5);
    expect((await app.inject('/api/artists/feithnoir/deviations?franchise=brujeria%20gotica')).json().total).toBe(5);
    await app.inject({ method: 'DELETE', url: '/api/dictionary/custom' });
    expect((await app.inject('/api/artists/feithnoir/deviations?franchise=brujeria%20gotica')).json().total).toBe(0);
    expect((await app.inject('/api/artists/feithnoir/deviations?franchise=sin%20clasificar')).json().total).toBeGreaterThanOrEqual(0);
  });

  it('informa si el usuario no existe', async () => {
    await setup();
    const done = await app.syncService.start('zzzznotauser9938271').done;
    expect(done.status).toBe('not_found');
    expect(done.message).toMatch(/no existe/);
    expect((await app.inject('/api/artists')).json().artists).toEqual([]);
  });

  it('opciones de auto-sync con validación en español', async () => {
    await setup();
    const s = (await app.inject('/api/settings')).json();
    expect(s).toMatchObject({ enabled: true, intervalHours: 24, minIntervalHours: 6 });
    const bad = await app.inject({ method: 'PUT', url: '/api/settings', payload: { intervalHours: 1 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/mínimo es de 6 horas/);
    const ok = (await app.inject({ method: 'PUT', url: '/api/settings', payload: { intervalHours: 12, enabled: true } })).json();
    expect(ok.intervalHours).toBe(12);
    expect(ok.nextRunAt).not.toBeNull();
    app.scheduler.stop();
  });
});

describe('API REST: artista sin obras públicas', () => {
  it('termina en “empty” con un mensaje claro', async () => {
    const f = fakeFetch((url) => {
      if (url.endsWith('/gallery')) return { body: fixture('gallery-page.html').replace(/FeithNoir/g, 'Vacio') };
      if (url.includes('rss.xml')) return { body: fixture('rss-nouser.xml') };
      return undefined;
    });
    const app = await buildApp({ dbFile: ':memory:', fetch: f, delayMs: 0, maxRetries: 0, sleep: async () => {} });
    const done = await app.syncService.start('vacio').done;
    expect(done.status).toBe('empty');
    expect(done.message).toMatch(/no tiene obras públicas/);
    expect((await app.inject('/api/artists/vacio/deviations')).json().total).toBe(0);
    await app.close();
  });
});
