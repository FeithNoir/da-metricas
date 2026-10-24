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
    expect(lines[0].replace('\uFEFF', '')).toBe('id,titulo,url,publicada,vistas,favoritos,comentarios,descargas,tasa_favoritos,tasa_comentarios,vistas_por_dia,etiquetas,clasificacion,metricas_al');
    expect(lines).toHaveLength(6);

    // segunda sincronización → segundo snapshot e historial
    await app.syncService.start('feithnoir').done;
    expect((await app.inject('/api/deviations/1401415400')).json().history).toHaveLength(2);
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
