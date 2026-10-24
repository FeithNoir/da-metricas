import { describe, expect, it } from 'vitest';
import { Db } from '../src/db.js';
import { HttpError, PoliteClient } from '../src/http.js';
import { fakeFetch } from './helpers.js';

const noSleep = async () => {};

describe('cliente HTTP amable', () => {
  it('envía User-Agent descriptivo, reintenta 429 y luego responde', async () => {
    let n = 0;
    const seen: string[] = [];
    const client = new PoliteClient({
      fetch: async (_u, init) => {
        seen.push(new Headers(init?.headers).get('user-agent') ?? '');
        return ++n < 3 ? new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }) : new Response('ok');
      },
      sleep: noSleep,
      delayMs: 0,
      cacheTtlMinutes: 0,
    });
    const res = await client.get('https://example.com/a');
    expect(res.body).toBe('ok');
    expect(n).toBe(3);
    expect(seen[0]).toMatch(/da-metricas/);
  });
  it('se rinde tras los reintentos y no reintenta 404', async () => {
    const f = fakeFetch(() => ({ status: 403, body: 'no' }));
    const client = new PoliteClient({ fetch: f, sleep: noSleep, delayMs: 0, maxRetries: 2, cacheTtlMinutes: 0 });
    await expect(client.get('https://x/1')).rejects.toBeInstanceOf(HttpError);
    expect(f.calls).toHaveLength(3);
    const g = fakeFetch(() => undefined);
    const c2 = new PoliteClient({ fetch: g, sleep: noSleep, delayMs: 0, cacheTtlMinutes: 0 });
    await expect(c2.get('https://x/2')).rejects.toMatchObject({ status: 404 });
    expect(g.calls).toHaveLength(1);
  });
  it('detecta un desafío de Cloudflare y no lo reintenta', async () => {
    const f = fakeFetch(() => ({ status: 403, body: '<title>Just a moment...</title>', headers: { server: 'cloudflare' } }));
    const client = new PoliteClient({ fetch: f, sleep: noSleep, delayMs: 0, cacheTtlMinutes: 0 });
    await expect(client.get('https://x/cf')).rejects.toThrow(/Cloudflare/);
    expect(f.calls).toHaveLength(1);
  });
  it('usa la caché SQLite dentro del TTL', async () => {
    const db = new Db(':memory:');
    const f = fakeFetch(() => ({ body: 'cuerpo' }));
    const client = new PoliteClient({ fetch: f, db, sleep: noSleep, delayMs: 0, cacheTtlMinutes: 10 });
    await client.get('https://x/c');
    const second = await client.get('https://x/c');
    expect(second.fromCache).toBe(true);
    await client.get('https://x/c', { useCache: false });
    expect(f.calls).toHaveLength(2);
    db.close();
  });
  it('limita la concurrencia a 2', async () => {
    let active = 0;
    let peak = 0;
    const client = new PoliteClient({
      fetch: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return new Response('ok');
      },
      concurrency: 5,
      delayMs: 0,
      cacheTtlMinutes: 0,
    });
    await Promise.all(Array.from({ length: 6 }, (_, i) => client.get(`https://x/${i}`)));
    expect(peak).toBeLessThanOrEqual(2);
  });
});
