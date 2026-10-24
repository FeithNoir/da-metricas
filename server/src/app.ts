import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { analyzeArtist, toWorkRows, workDetail } from './analysis.js';
import { config } from './config.js';
import { toCsv } from './csv.js';
import { Db } from './db.js';
import { DeviantArtClient, USERNAME_RE } from './deviantart.js';
import { PoliteClient, type FetchLike } from './http.js';
import { AutoSyncScheduler, MAX_INTERVAL_HOURS, MIN_INTERVAL_HOURS } from './scheduler.js';
import { SyncService } from './sync.js';
import type { DeviationWithMetrics } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    syncService: SyncService;
    scheduler: AutoSyncScheduler;
  }
}

export interface AppOptions {
  dbFile?: string;
  serveStatic?: boolean;
  logger?: boolean;
  /** fetch inyectable (tests con fixtures). */
  fetch?: FetchLike;
  delayMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** No arrancar el planificador (tests). */
  scheduler?: boolean;
  log?: (m: string) => void;
}

interface WorksQuery {
  q?: string;
  tag?: string;
  from?: string;
  to?: string;
  sort?: string;
  order?: string;
}

const SORTABLE = ['title', 'publishedAt', 'views', 'favourites', 'comments', 'downloads', 'favRate', 'commentRate', 'viewsPerDay'] as const;

export function filterWorks(devs: DeviationWithMetrics[], q: WorksQuery) {
  let rows = devs.map((d) => {
    const w = toWorkRows([d])[0];
    return { ...d, favRate: w?.favRate ?? null, commentRate: w?.commentRate ?? null, viewsPerDay: w?.viewsPerDay ?? null };
  });
  const needle = q.q?.trim().toLowerCase();
  if (needle) rows = rows.filter((r) => r.title.toLowerCase().includes(needle));
  const tag = q.tag?.trim().toLowerCase();
  if (tag) rows = rows.filter((r) => r.tags.includes(tag));
  // Fechas AAAA-MM-DD se interpretan en hora de Bogotá (UTC−5), igual que en la interfaz.
  const dateOnly = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = q.from ? Date.parse(dateOnly(q.from) ? `${q.from}T00:00:00-05:00` : q.from) : NaN;
  const to = q.to ? Date.parse(dateOnly(q.to) ? `${q.to}T23:59:59.999-05:00` : q.to) : NaN;
  if (!Number.isNaN(from)) rows = rows.filter((r) => r.publishedAt && Date.parse(r.publishedAt) >= from);
  if (!Number.isNaN(to)) rows = rows.filter((r) => r.publishedAt && Date.parse(r.publishedAt) <= to);
  const sort = (SORTABLE as readonly string[]).includes(q.sort ?? '') ? (q.sort as (typeof SORTABLE)[number]) : 'publishedAt';
  const dir = q.order === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const x = a[sort];
    const y = b[sort];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === 'string' ? x.localeCompare(String(y), 'es') : (x as number) - (y as number)) * dir;
  });
  return rows;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const db = new Db(opts.dbFile ?? config.dbFile);
  db.failStaleSyncs();
  db.cachePrune(24 * 60);
  const http = new PoliteClient({ db, fetch: opts.fetch, delayMs: opts.delayMs, maxRetries: opts.maxRetries, sleep: opts.sleep });
  const syncService = new SyncService(db, new DeviantArtClient(http), { log: opts.log });
  const scheduler = new AutoSyncScheduler(db, syncService, opts.log);
  app.decorate('db', db);
  app.decorate('syncService', syncService);
  app.decorate('scheduler', scheduler);
  if (opts.scheduler) scheduler.start();
  app.addHook('onClose', async () => {
    scheduler.stop();
    db.close();
  });

  const userOr400 = (raw: string, reply: FastifyReply) => {
    const u = raw.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) {
      void reply.code(400).send({ error: 'Nombre de usuario inválido: solo letras, números y guiones (máx. 20).' });
      return null;
    }
    return u;
  };
  const artistOr404 = (u: string, reply: FastifyReply) => {
    const a = db.getArtist(u);
    if (!a) void reply.code(404).send({ error: `Aún no hay datos de “${u}”. Sincroniza primero.` });
    return a;
  };

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/artists', async () => ({ artists: db.listArtists() }));

  app.get<{ Params: { username: string } }>('/api/artists/:username', async (req, reply) => {
    const u = userOr400(req.params.username, reply);
    if (!u) return reply;
    const a = artistOr404(u, reply);
    if (!a) return reply;
    const devs = db.listDeviations(u);
    return { artist: { ...a, works: devs.length, worksWithMetrics: devs.filter((d) => d.metricsAt).length }, syncing: syncService.isRunning(u), syncs: db.listSyncs(u, 10) };
  });

  app.patch<{ Params: { username: string }; Body: { autoSync?: unknown } }>('/api/artists/:username', async (req, reply) => {
    const u = userOr400(req.params.username, reply);
    if (!u) return reply;
    if (!artistOr404(u, reply)) return reply;
    if (typeof req.body?.autoSync !== 'boolean') return reply.code(400).send({ error: '“autoSync” debe ser verdadero o falso.' });
    db.setArtistAutoSync(u, req.body.autoSync);
    return { artist: db.getArtist(u) };
  });

  app.post<{ Params: { username: string } }>('/api/artists/:username/sync', async (req, reply) => {
    const u = userOr400(req.params.username, reply);
    if (!u) return reply;
    const { sync } = syncService.start(u);
    return reply.code(202).send({ sync });
  });

  app.get<{ Params: { id: string } }>('/api/syncs/:id', async (req, reply) => {
    const s = db.getSync(Number(req.params.id));
    if (!s) return reply.code(404).send({ error: 'Sincronización no encontrada.' });
    return { sync: s };
  });

  app.get<{ Params: { username: string }; Querystring: WorksQuery }>('/api/artists/:username/deviations', async (req, reply) => {
    const u = userOr400(req.params.username, reply);
    if (!u) return reply;
    if (!artistOr404(u, reply)) return reply;
    const items = filterWorks(db.listDeviations(u), req.query);
    return { total: items.length, items };
  });

  app.get<{ Params: { username: string } }>('/api/artists/:username/analysis', async (req, reply) => {
    const u = userOr400(req.params.username, reply);
    if (!u) return reply;
    if (!artistOr404(u, reply)) return reply;
    return analyzeArtist(db.listDeviations(u), { firstLast: db.firstAndLast(u), timeline: db.artistTimeline(u) });
  });

  app.get<{ Params: { username: string }; Querystring: WorksQuery }>('/api/artists/:username/export.csv', async (req, reply) => {
    const u = userOr400(req.params.username, reply);
    if (!u) return reply;
    if (!artistOr404(u, reply)) return reply;
    const rows = filterWorks(db.listDeviations(u), req.query);
    const csv = toCsv(
      [
        { key: 'id', label: 'id' },
        { key: 'title', label: 'titulo' },
        { key: 'url', label: 'url' },
        { key: 'publishedAt', label: 'publicada' },
        { key: 'views', label: 'vistas' },
        { key: 'favourites', label: 'favoritos' },
        { key: 'comments', label: 'comentarios' },
        { key: 'downloads', label: 'descargas' },
        { key: 'favRate', label: 'tasa_favoritos' },
        { key: 'commentRate', label: 'tasa_comentarios' },
        { key: 'viewsPerDay', label: 'vistas_por_dia' },
        { key: 'tags', label: 'etiquetas' },
        { key: 'rating', label: 'clasificacion' },
        { key: 'metricsAt', label: 'metricas_al' },
      ],
      rows as unknown as Record<string, unknown>[],
    );
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${u}-obras-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(csv);
  });

  app.get<{ Params: { id: string } }>('/api/deviations/:id', async (req, reply) => {
    if (!/^\d{1,15}$/.test(req.params.id)) return reply.code(400).send({ error: 'Identificador de obra inválido.' });
    const d = db.getDeviation(req.params.id);
    if (!d) return reply.code(404).send({ error: 'Obra no encontrada.' });
    return { deviation: d, history: db.history(d.id), detail: workDetail(d, db.listDeviations(d.username)) };
  });

  const settingsResponse = () => ({
    ...scheduler.settings,
    minIntervalHours: MIN_INTERVAL_HOURS,
    maxIntervalHours: MAX_INTERVAL_HOURS,
    nextRunAt: scheduler.nextRunAt?.toISOString() ?? null,
    lastRunAt: scheduler.lastRunAt?.toISOString() ?? null,
  });
  app.get('/api/settings', async () => settingsResponse());
  app.put('/api/settings', async (req, reply) => {
    try {
      scheduler.update(req.body);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    return settingsResponse();
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Ruta no encontrada.' });
    if (opts.serveStatic && existsSync(config.webDist)) return reply.type('text/html').sendFile('index.html');
    return reply.code(404).send({ error: 'No encontrado.' });
  });
  if (opts.serveStatic && existsSync(config.webDist)) await app.register(fastifyStatic, { root: config.webDist, wildcard: false });

  return app;
}
