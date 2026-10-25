import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ratingClassOf } from './classifier/classify.js';
import type { Evidence } from './classifier/classify.js';
import type { Artist, BenchmarkItem, BenchmarkKind, BenchmarkRun, DeviationDetail, DeviationWithMetrics, RatingClass, RssItem, Snapshot, SyncRecord, SyncStatus } from './types.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS artists (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar TEXT,
  gallery_total INTEGER,
  auto_sync INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_sync_status TEXT
);
CREATE TABLE IF NOT EXISTS deviations (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES artists(username) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail TEXT,
  published_at TEXT,
  rating TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  stats_source TEXT
);
CREATE INDEX IF NOT EXISTS idx_deviations_user ON deviations(username);
CREATE TABLE IF NOT EXISTS syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT '',
  found INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
CREATE INDEX IF NOT EXISTS idx_syncs_user ON syncs(username, id);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deviation_id TEXT NOT NULL REFERENCES deviations(id) ON DELETE CASCADE,
  sync_id INTEGER REFERENCES syncs(id) ON DELETE SET NULL,
  taken_at TEXT NOT NULL,
  views INTEGER NOT NULL,
  favourites INTEGER NOT NULL,
  comments INTEGER NOT NULL,
  downloads INTEGER
);
CREATE INDEX IF NOT EXISTS idx_snapshots_dev ON snapshots(deviation_id, taken_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS http_cache (url TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);
`;

/**
 * Migraciones incrementales (PRAGMA user_version). Nunca borran datos: solo añaden columnas y tablas.
 * v1: descripción de la obra + clasificación automática (franquicia, personajes, evidencia) + correcciones manuales.
 */
export const MIGRATIONS: { version: number; up: (sql: DatabaseSync) => void }[] = [
  {
    version: 1,
    up: (sql) => {
      const cols = (sql.prepare('PRAGMA table_info(deviations)').all() as Row[]).map((r) => String(r['name']));
      if (!cols.includes('description')) sql.exec('ALTER TABLE deviations ADD COLUMN description TEXT');
      sql.exec(`
        CREATE TABLE IF NOT EXISTS classifications (
          deviation_id TEXT PRIMARY KEY REFERENCES deviations(id) ON DELETE CASCADE,
          franchises TEXT NOT NULL DEFAULT '[]',
          characters TEXT NOT NULL DEFAULT '[]',
          evidence TEXT NOT NULL DEFAULT '[]',
          dict_hash TEXT NOT NULL,
          classified_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS classification_overrides (
          deviation_id TEXT PRIMARY KEY REFERENCES deviations(id) ON DELETE CASCADE,
          franchises TEXT,
          characters TEXT,
          rating TEXT,
          updated_at TEXT NOT NULL
        );`);
    },
  },
  {
    // Tendencias: muestras de referencia de la plataforma (más recientes / más populares).
    version: 2,
    up: (sql) =>
      sql.exec(`
        CREATE TABLE IF NOT EXISTS benchmark_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          scope TEXT NOT NULL,
          size INTEGER NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL,
          phase TEXT NOT NULL DEFAULT '',
          found INTEGER NOT NULL DEFAULT 0,
          processed INTEGER NOT NULL DEFAULT 0,
          failed INTEGER NOT NULL DEFAULT 0,
          message TEXT,
          sources TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS benchmark_runs_kind ON benchmark_runs(kind, scope, started_at);
        CREATE TABLE IF NOT EXISTS benchmark_items (
          run_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
          deviation_id TEXT NOT NULL,
          rank INTEGER NOT NULL,
          source TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT NOT NULL,
          author TEXT,
          thumbnail TEXT,
          published_at TEXT,
          rating TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          views INTEGER NOT NULL,
          favourites INTEGER NOT NULL,
          comments INTEGER NOT NULL,
          downloads INTEGER,
          stats_source TEXT NOT NULL,
          measured_at TEXT NOT NULL,
          PRIMARY KEY (run_id, deviation_id)
        );`),
  },
];
export const SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toArtist(r: Row): Artist {
  return {
    username: String(r['username']),
    displayName: String(r['display_name']),
    avatar: s(r['avatar']),
    galleryTotal: n(r['gallery_total']),
    autoSync: Number(r['auto_sync']) === 1,
    createdAt: String(r['created_at']),
    lastSyncAt: s(r['last_sync_at']),
    lastSyncStatus: s(r['last_sync_status']) as SyncStatus | null,
  };
}

function toBenchmark(r: Row): BenchmarkRun {
  return {
    id: Number(r['id']),
    kind: String(r['kind']) as BenchmarkKind,
    scope: String(r['scope']),
    size: Number(r['size']),
    startedAt: String(r['started_at']),
    finishedAt: s(r['finished_at']),
    status: String(r['status']) as BenchmarkRun['status'],
    phase: String(r['phase'] ?? ''),
    found: Number(r['found']),
    processed: Number(r['processed']),
    failed: Number(r['failed']),
    message: s(r['message']),
    sources: (parseList(r['sources']) as string[] | null) ?? [],
    items: Number(r['items'] ?? 0),
  };
}

function toSync(r: Row): SyncRecord {
  return {
    id: Number(r['id']),
    username: String(r['username']),
    startedAt: String(r['started_at']),
    finishedAt: s(r['finished_at']),
    status: String(r['status']) as SyncStatus,
    phase: String(r['phase'] ?? ''),
    found: Number(r['found']),
    processed: Number(r['processed']),
    failed: Number(r['failed']),
    message: s(r['message']),
  };
}

export class Db {
  readonly sql: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec(SCHEMA);
    this.migrate();
  }

  get schemaVersion(): number {
    return Number((this.sql.prepare('PRAGMA user_version').get() as Row)['user_version']);
  }

  private migrate() {
    for (const m of MIGRATIONS) {
      if (this.schemaVersion >= m.version) continue;
      this.sql.exec('BEGIN');
      try {
        m.up(this.sql);
        this.sql.exec(`PRAGMA user_version = ${m.version}`);
        this.sql.exec('COMMIT');
      } catch (e) {
        this.sql.exec('ROLLBACK');
        throw e;
      }
    }
  }

  close() {
    this.sql.close();
  }

  // ---------- caché HTTP ----------
  cacheGet(url: string, ttlMinutes: number): string | null {
    const r = this.sql.prepare('SELECT body, fetched_at FROM http_cache WHERE url = ?').get(url) as Row | undefined;
    if (!r || Date.now() - Number(r['fetched_at']) > ttlMinutes * 60_000) return null;
    return String(r['body']);
  }
  cacheSet(url: string, body: string) {
    this.sql.prepare('INSERT OR REPLACE INTO http_cache (url, body, fetched_at) VALUES (?, ?, ?)').run(url, body, Date.now());
  }
  cachePrune(maxAgeMinutes: number) {
    this.sql.prepare('DELETE FROM http_cache WHERE fetched_at < ?').run(Date.now() - maxAgeMinutes * 60_000);
  }

  // ---------- artistas ----------
  upsertArtist(a: { username: string; displayName: string; avatar: string | null; galleryTotal: number | null }) {
    this.sql
      .prepare(
        `INSERT INTO artists (username, display_name, avatar, gallery_total, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name,
           avatar = COALESCE(excluded.avatar, artists.avatar), gallery_total = COALESCE(excluded.gallery_total, artists.gallery_total)`,
      )
      .run(a.username, a.displayName, a.avatar, a.galleryTotal, new Date().toISOString());
  }
  getArtist(username: string): Artist | null {
    const r = this.sql.prepare('SELECT * FROM artists WHERE username = ?').get(username) as Row | undefined;
    return r ? toArtist(r) : null;
  }
  listArtists(): (Artist & { works: number })[] {
    const rows = this.sql
      .prepare('SELECT a.*, (SELECT COUNT(*) FROM deviations d WHERE d.username = a.username) AS works FROM artists a ORDER BY a.username')
      .all() as Row[];
    return rows.map((r) => ({ ...toArtist(r), works: Number(r['works']) }));
  }
  setArtistAutoSync(username: string, on: boolean) {
    this.sql.prepare('UPDATE artists SET auto_sync = ? WHERE username = ?').run(on ? 1 : 0, username);
  }
  deleteArtist(username: string) {
    this.sql.prepare('DELETE FROM artists WHERE username = ?').run(username);
  }

  // ---------- sincronizaciones ----------
  startSync(username: string): SyncRecord {
    const r = this.sql
      .prepare("INSERT INTO syncs (username, started_at, status, phase) VALUES (?, ?, 'running', 'perfil') RETURNING *")
      .get(username, new Date().toISOString()) as Row;
    return toSync(r);
  }
  updateSync(id: number, patch: Partial<Pick<SyncRecord, 'phase' | 'found' | 'processed' | 'failed' | 'message'>>) {
    const cols = Object.keys(patch);
    if (!cols.length) return;
    const map: Record<string, string> = { phase: 'phase', found: 'found', processed: 'processed', failed: 'failed', message: 'message' };
    this.sql
      .prepare(`UPDATE syncs SET ${cols.map((c) => `${map[c]} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => (patch as Record<string, string | number | null>)[c]), id);
  }
  finishSync(id: number, status: SyncStatus, message: string | null) {
    const at = new Date().toISOString();
    const r = this.sql.prepare('UPDATE syncs SET status = ?, message = ?, finished_at = ?, phase = ? WHERE id = ? RETURNING username').get(status, message, at, 'fin', id) as Row;
    this.sql.prepare('UPDATE artists SET last_sync_at = ?, last_sync_status = ? WHERE username = ?').run(at, status, String(r['username']));
  }
  getSync(id: number): SyncRecord | null {
    const r = this.sql.prepare('SELECT * FROM syncs WHERE id = ?').get(id) as Row | undefined;
    return r ? toSync(r) : null;
  }
  listSyncs(username: string, limit = 20): SyncRecord[] {
    return (this.sql.prepare('SELECT * FROM syncs WHERE username = ? ORDER BY id DESC LIMIT ?').all(username, limit) as Row[]).map(toSync);
  }
  /** Marca como interrumpidas las sincronizaciones que quedaron “running” (p. ej. por un reinicio). */
  failStaleSyncs() {
    this.sql.prepare("UPDATE syncs SET status = 'error', message = 'Interrumpida por reinicio del servidor', finished_at = ? WHERE status = 'running'").run(new Date().toISOString());
  }

  // ---------- obras y snapshots ----------
  upsertFromRss(username: string, item: RssItem, seenAt: string) {
    this.sql
      .prepare(
        `INSERT INTO deviations (id, username, url, title, thumbnail, published_at, rating, tags, first_seen_at, last_seen_at, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET url = excluded.url, title = excluded.title,
           thumbnail = COALESCE(excluded.thumbnail, deviations.thumbnail),
           published_at = COALESCE(excluded.published_at, deviations.published_at),
           rating = COALESCE(excluded.rating, deviations.rating), last_seen_at = excluded.last_seen_at,
           description = COALESCE(excluded.description, deviations.description)`,
      )
      .run(item.id, username, item.url, item.title, item.thumbnail, item.publishedAt, item.rating, JSON.stringify(item.keywords), seenAt, seenAt, item.description ?? null);
  }
  /** Rellena descripción y clasificación (si faltan) sin tocar el resto (p. ej. desde el RSS guardado en caché). */
  fillFromRss(item: RssItem): boolean {
    const r = this.sql
      .prepare('UPDATE deviations SET description = COALESCE(description, ?), rating = COALESCE(rating, ?) WHERE id = ? AND (description IS NULL OR rating IS NULL)')
      .run(item.description ?? '', item.rating, item.id); // '' = el RSS no trae descripción (no se vuelve a buscar)
    return Number(r.changes) > 0;
  }
  cachedBodies(urlLike: string): { url: string; body: string }[] {
    return (this.sql.prepare('SELECT url, body FROM http_cache WHERE url LIKE ?').all(urlLike) as Row[]).map((r) => ({ url: String(r['url']), body: String(r['body']) }));
  }

  // ---------- clasificación ----------
  /** Datos mínimos para clasificar (sin métricas). */
  worksToClassify(username: string): { id: string; title: string; tags: string[]; description: string | null }[] {
    return (this.sql.prepare('SELECT id, title, tags, description FROM deviations WHERE username = ?').all(username) as Row[]).map((r) => ({
      id: String(r['id']),
      title: String(r['title']),
      tags: parseList(r['tags']) ?? [],
      description: s(r['description']),
    }));
  }
  saveClassifications(items: { id: string; franchises: string[]; characters: string[]; evidence: Evidence[] }[], hash: string) {
    const at = new Date().toISOString();
    const st = this.sql.prepare(
      `INSERT INTO classifications (deviation_id, franchises, characters, evidence, dict_hash, classified_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(deviation_id) DO UPDATE SET franchises = excluded.franchises, characters = excluded.characters, evidence = excluded.evidence,
         dict_hash = excluded.dict_hash, classified_at = excluded.classified_at`,
    );
    this.sql.exec('BEGIN');
    try {
      for (const it of items) st.run(it.id, JSON.stringify(it.franchises), JSON.stringify(it.characters), JSON.stringify(it.evidence), hash, at);
      this.sql.exec('COMMIT');
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }
  /** Obras del artista sin clasificar o clasificadas con otra versión del diccionario. */
  staleClassifications(username: string, hash: string): number {
    const r = this.sql
      .prepare('SELECT COUNT(*) AS n FROM deviations d LEFT JOIN classifications c ON c.deviation_id = d.id WHERE d.username = ? AND (c.dict_hash IS NULL OR c.dict_hash <> ?)')
      .get(username, hash) as Row;
    return Number(r['n']);
  }
  getClassification(id: string): ClassificationRecord | null {
    const r = this.sql
      .prepare(
        `SELECT d.rating AS raw_rating, c.franchises, c.characters, c.evidence, c.classified_at, c.dict_hash,
                o.franchises AS o_franchises, o.characters AS o_characters, o.rating AS o_rating, o.updated_at AS o_updated_at
         FROM deviations d LEFT JOIN classifications c ON c.deviation_id = d.id LEFT JOIN classification_overrides o ON o.deviation_id = d.id WHERE d.id = ?`,
      )
      .get(id) as Row | undefined;
    if (!r) return null;
    const auto = { franchises: parseList(r['franchises']) ?? [], characters: parseList(r['characters']) ?? [], ratingClass: ratingClassOf(s(r['raw_rating'])) };
    const override = r['o_updated_at']
      ? { franchises: parseList(r['o_franchises']), characters: parseList(r['o_characters']), rating: (s(r['o_rating']) as RatingClass | null) ?? null, updatedAt: String(r['o_updated_at']) }
      : null;
    let evidence: Evidence[] = [];
    try {
      evidence = JSON.parse(String(r['evidence'] ?? '[]')) as Evidence[];
    } catch {
      evidence = [];
    }
    return {
      rawRating: s(r['raw_rating']),
      auto,
      evidence,
      classifiedAt: s(r['classified_at']),
      dictHash: s(r['dict_hash']),
      override,
      effective: {
        franchises: override?.franchises ?? auto.franchises,
        characters: override?.characters ?? auto.characters,
        ratingClass: override?.rating ?? auto.ratingClass,
      },
    };
  }
  /** Guarda una corrección manual. Un campo null vuelve a la clasificación automática; si todos son null, se borra. */
  setOverride(id: string, o: { franchises: string[] | null; characters: string[] | null; rating: RatingClass | null }) {
    if (o.franchises === null && o.characters === null && o.rating === null) return this.clearOverride(id);
    this.sql
      .prepare(
        `INSERT INTO classification_overrides (deviation_id, franchises, characters, rating, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(deviation_id) DO UPDATE SET franchises = excluded.franchises, characters = excluded.characters, rating = excluded.rating, updated_at = excluded.updated_at`,
      )
      .run(id, o.franchises === null ? null : JSON.stringify(o.franchises), o.characters === null ? null : JSON.stringify(o.characters), o.rating, new Date().toISOString());
  }
  clearOverride(id: string) {
    this.sql.prepare('DELETE FROM classification_overrides WHERE deviation_id = ?').run(id);
  }
  countOverrides(username: string): number {
    return Number((this.sql.prepare('SELECT COUNT(*) AS n FROM classification_overrides o JOIN deviations d ON d.id = o.deviation_id WHERE d.username = ?').get(username) as Row)['n']);
  }
  applyDetail(id: string, d: DeviationDetail, syncId: number, takenAt: string) {
    this.sql
      .prepare(
        `UPDATE deviations SET tags = ?, stats_source = ?, title = CASE WHEN title = '' THEN COALESCE(?, title) ELSE title END,
           published_at = COALESCE(published_at, ?), rating = COALESCE(rating, ?) WHERE id = ?`,
      )
      .run(JSON.stringify(d.tags), d.source, d.title, d.publishedAt, d.rating, id);
    this.sql
      .prepare('INSERT INTO snapshots (deviation_id, sync_id, taken_at, views, favourites, comments, downloads) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, syncId, takenAt, d.views, d.favourites, d.comments, d.downloads);
  }
  listDeviations(username: string): DeviationWithMetrics[] {
    const rows = this.sql
      .prepare(
        `SELECT ${DEV_COLUMNS}
         FROM deviations d
         LEFT JOIN snapshots s ON s.id = (SELECT id FROM snapshots WHERE deviation_id = d.id ORDER BY taken_at DESC, id DESC LIMIT 1)
         LEFT JOIN classifications c ON c.deviation_id = d.id
         LEFT JOIN classification_overrides o ON o.deviation_id = d.id
         WHERE d.username = ? ORDER BY d.published_at DESC`,
      )
      .all(username) as Row[];
    return rows.map(toDeviation);
  }
  getDeviation(id: string): DeviationWithMetrics | null {
    const r = this.sql
      .prepare(
        `SELECT ${DEV_COLUMNS}
         FROM deviations d
         LEFT JOIN snapshots s ON s.id = (SELECT id FROM snapshots WHERE deviation_id = d.id ORDER BY taken_at DESC, id DESC LIMIT 1)
         LEFT JOIN classifications c ON c.deviation_id = d.id
         LEFT JOIN classification_overrides o ON o.deviation_id = d.id
         WHERE d.id = ?`,
      )
      .get(id) as Row | undefined;
    return r ? toDeviation(r) : null;
  }
  history(id: string): Snapshot[] {
    return (this.sql.prepare('SELECT * FROM snapshots WHERE deviation_id = ? ORDER BY taken_at, id').all(id) as Row[]).map((r) => ({
      takenAt: String(r['taken_at']),
      syncId: n(r['sync_id']),
      views: Number(r['views']),
      favourites: Number(r['favourites']),
      comments: Number(r['comments']),
      downloads: n(r['downloads']),
    }));
  }
  /** Primer y último snapshot de cada obra del artista (para calcular crecimiento). */
  /** Todos los snapshots de las obras de un artista (para comparar a igual edad). */
  artistSnapshots(username: string): { id: string; takenAt: string; views: number; favourites: number; comments: number }[] {
    return (
      this.sql
        .prepare(
          `SELECT s.deviation_id, s.taken_at, s.views, s.favourites, s.comments FROM snapshots s JOIN deviations d ON d.id = s.deviation_id WHERE d.username = ? ORDER BY s.deviation_id, s.taken_at, s.id`,
        )
        .all(username) as Row[]
    ).map((r) => ({ id: String(r['deviation_id']), takenAt: String(r['taken_at']), views: Number(r['views']), favourites: Number(r['favourites']), comments: Number(r['comments']) }));
  }

  firstAndLast(username: string): { id: string; first: Snapshot; last: Snapshot }[] {
    const rows = this.sql
      .prepare(
        `SELECT s.* FROM snapshots s JOIN deviations d ON d.id = s.deviation_id WHERE d.username = ? ORDER BY s.deviation_id, s.taken_at, s.id`,
      )
      .all(username) as Row[];
    const map = new Map<string, { first: Snapshot; last: Snapshot }>();
    for (const r of rows) {
      const snap: Snapshot = {
        takenAt: String(r['taken_at']),
        syncId: n(r['sync_id']),
        views: Number(r['views']),
        favourites: Number(r['favourites']),
        comments: Number(r['comments']),
        downloads: n(r['downloads']),
      };
      const id = String(r['deviation_id']);
      const cur = map.get(id);
      if (!cur) map.set(id, { first: snap, last: snap });
      else cur.last = snap;
    }
    return [...map].map(([id, v]) => ({ id, ...v }));
  }
  /** Totales del artista por sincronización terminada (serie temporal). */
  artistTimeline(username: string): { syncId: number; takenAt: string; works: number; views: number; favourites: number; comments: number }[] {
    return (
      this.sql
        .prepare(
          `SELECT s.sync_id AS sync_id, MAX(s.taken_at) AS taken_at, COUNT(*) AS works, SUM(s.views) AS views, SUM(s.favourites) AS favourites, SUM(s.comments) AS comments
           FROM snapshots s JOIN deviations d ON d.id = s.deviation_id JOIN syncs y ON y.id = s.sync_id
           WHERE d.username = ? AND y.status IN ('ok', 'partial') GROUP BY s.sync_id ORDER BY s.sync_id`,
        )
        .all(username) as Row[]
    ).map((r) => ({
      syncId: Number(r['sync_id']),
      takenAt: String(r['taken_at']),
      works: Number(r['works']),
      views: Number(r['views']),
      favourites: Number(r['favourites']),
      comments: Number(r['comments']),
    }));
  }

  // ---------- opciones ----------
  // ---------- tendencias (muestras de referencia) ----------
  startBenchmark(p: { kind: BenchmarkKind; scope: string; size: number }): BenchmarkRun {
    const r = this.sql
      .prepare("INSERT INTO benchmark_runs (kind, scope, size, started_at, status, phase) VALUES (?, ?, ?, ?, 'running', 'lista') RETURNING id")
      .get(p.kind, p.scope, p.size, new Date().toISOString()) as Row;
    return this.getBenchmark(Number(r['id']))!;
  }
  updateBenchmark(id: number, patch: Partial<Pick<BenchmarkRun, 'phase' | 'found' | 'processed' | 'failed' | 'message' | 'sources'>>) {
    const cols: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      cols.push(`${k} = ?`);
      vals.push(k === 'sources' ? JSON.stringify(v) : (v as string | number | null));
    }
    if (cols.length) this.sql.prepare(`UPDATE benchmark_runs SET ${cols.join(', ')} WHERE id = ?`).run(...vals, id);
  }
  finishBenchmark(id: number, status: BenchmarkRun['status'], message: string | null) {
    this.sql.prepare('UPDATE benchmark_runs SET status = ?, message = ?, finished_at = ? WHERE id = ?').run(status, message, new Date().toISOString(), id);
  }
  failStaleBenchmarks() {
    this.sql.prepare("UPDATE benchmark_runs SET status = 'error', message = 'Interrumpida por reinicio del servidor', finished_at = ? WHERE status = 'running'").run(new Date().toISOString());
  }
  getBenchmark(id: number): BenchmarkRun | null {
    const r = this.sql.prepare('SELECT r.*, (SELECT COUNT(*) FROM benchmark_items i WHERE i.run_id = r.id) AS items FROM benchmark_runs r WHERE id = ?').get(id) as Row | undefined;
    return r ? toBenchmark(r) : null;
  }
  listBenchmarks(limit = 50, kind?: BenchmarkKind): BenchmarkRun[] {
    const rows = this.sql
      .prepare(`SELECT r.*, (SELECT COUNT(*) FROM benchmark_items i WHERE i.run_id = r.id) AS items FROM benchmark_runs r ${kind ? 'WHERE kind = ?' : ''} ORDER BY id DESC LIMIT ?`)
      .all(...(kind ? [kind, limit] : [limit])) as Row[];
    return rows.map(toBenchmark);
  }
  /** Última medición terminada (ok/parcial) de un tipo; si se indica, del mismo alcance. */
  latestBenchmark(kind: BenchmarkKind, scope?: string): BenchmarkRun | null {
    const r = this.sql
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM benchmark_items i WHERE i.run_id = r.id) AS items FROM benchmark_runs r
         WHERE kind = ? AND status IN ('ok', 'partial') ${scope ? 'AND scope = ?' : ''} ORDER BY id DESC LIMIT 1`,
      )
      .get(...(scope ? [kind, scope] : [kind])) as Row | undefined;
    return r ? toBenchmark(r) : null;
  }
  deleteBenchmark(id: number) {
    return Number(this.sql.prepare('DELETE FROM benchmark_runs WHERE id = ?').run(id).changes) > 0;
  }
  saveBenchmarkItem(runId: number, it: BenchmarkItem) {
    this.sql
      .prepare(
        `INSERT OR REPLACE INTO benchmark_items (run_id, deviation_id, rank, source, url, title, author, thumbnail, published_at, rating, tags, views, favourites, comments, downloads, stats_source, measured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(runId, it.id, it.rank, it.source, it.url, it.title, it.author, it.thumbnail, it.publishedAt, it.rating, JSON.stringify(it.tags), it.views, it.favourites, it.comments, it.downloads, it.statsSource, it.measuredAt);
  }
  benchmarkItems(runId: number): BenchmarkItem[] {
    return (this.sql.prepare('SELECT * FROM benchmark_items WHERE run_id = ? ORDER BY rank').all(runId) as Row[]).map((r) => ({
      id: String(r['deviation_id']),
      rank: Number(r['rank']),
      source: String(r['source']),
      url: String(r['url']),
      title: String(r['title']),
      author: s(r['author']),
      thumbnail: s(r['thumbnail']),
      publishedAt: s(r['published_at']),
      rating: s(r['rating']),
      tags: parseList(r['tags']) ?? [],
      views: Number(r['views']),
      favourites: Number(r['favourites']),
      comments: Number(r['comments']),
      downloads: n(r['downloads']),
      statsSource: String(r['stats_source']),
      measuredAt: String(r['measured_at']),
    }));
  }

  getSetting(key: string): string | null {
    const r = this.sql.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    return r ? String(r['value']) : null;
  }
  setSetting(key: string, value: string) {
    this.sql.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

export interface ClassificationRecord {
  rawRating: string | null;
  auto: { franchises: string[]; characters: string[]; ratingClass: RatingClass };
  evidence: Evidence[];
  classifiedAt: string | null;
  dictHash: string | null;
  override: null | { franchises: string[] | null; characters: string[] | null; rating: RatingClass | null; updatedAt: string };
  effective: { franchises: string[]; characters: string[]; ratingClass: RatingClass };
}

const DEV_COLUMNS = `d.id, d.username, d.url, d.title, d.thumbnail, d.published_at, d.rating, d.tags, d.first_seen_at, d.last_seen_at, d.stats_source,
  s.views, s.favourites, s.comments, s.downloads, s.taken_at AS metrics_at,
  c.franchises AS c_franchises, c.characters AS c_characters,
  o.franchises AS o_franchises, o.characters AS o_characters, o.rating AS o_rating, o.updated_at AS o_updated_at`;

/** Lista JSON guardada en texto; null si el valor es NULL (o inválido). */
function parseList(v: unknown): string[] | null {
  if (v === null || v === undefined) return null;
  try {
    const x = JSON.parse(String(v)) as unknown;
    return Array.isArray(x) ? x.map(String) : null;
  } catch {
    return null;
  }
}

function toDeviation(r: Row): DeviationWithMetrics {
  const tags = parseList(r['tags']) ?? [];
  const oFr = parseList(r['o_franchises']);
  const oCh = parseList(r['o_characters']);
  const oRating = s(r['o_rating']) as RatingClass | null;
  return {
    id: String(r['id']),
    username: String(r['username']),
    url: String(r['url']),
    title: String(r['title']),
    thumbnail: s(r['thumbnail']),
    publishedAt: s(r['published_at']),
    rating: s(r['rating']),
    tags,
    firstSeenAt: String(r['first_seen_at']),
    lastSeenAt: String(r['last_seen_at']),
    statsSource: s(r['stats_source']),
    views: Number(r['views'] ?? 0),
    favourites: Number(r['favourites'] ?? 0),
    comments: Number(r['comments'] ?? 0),
    downloads: n(r['downloads']),
    metricsAt: s(r['metrics_at']),
    franchises: oFr ?? parseList(r['c_franchises']) ?? [],
    characters: oCh ?? parseList(r['c_characters']) ?? [],
    ratingClass: oRating ?? ratingClassOf(s(r['rating'])),
    classificationOverridden: !!r['o_updated_at'],
  };
}
