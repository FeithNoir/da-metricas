import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Artist, DeviationDetail, DeviationWithMetrics, RssItem, Snapshot, SyncRecord, SyncStatus } from './types.js';

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
        `INSERT INTO deviations (id, username, url, title, thumbnail, published_at, rating, tags, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET url = excluded.url, title = excluded.title,
           thumbnail = COALESCE(excluded.thumbnail, deviations.thumbnail),
           published_at = COALESCE(excluded.published_at, deviations.published_at),
           rating = COALESCE(excluded.rating, deviations.rating), last_seen_at = excluded.last_seen_at`,
      )
      .run(item.id, username, item.url, item.title, item.thumbnail, item.publishedAt, item.rating, JSON.stringify(item.keywords), seenAt, seenAt);
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
        `SELECT d.*, s.views, s.favourites, s.comments, s.downloads, s.taken_at AS metrics_at
         FROM deviations d
         LEFT JOIN snapshots s ON s.id = (SELECT id FROM snapshots WHERE deviation_id = d.id ORDER BY taken_at DESC, id DESC LIMIT 1)
         WHERE d.username = ? ORDER BY d.published_at DESC`,
      )
      .all(username) as Row[];
    return rows.map(toDeviation);
  }
  getDeviation(id: string): DeviationWithMetrics | null {
    const r = this.sql
      .prepare(
        `SELECT d.*, s.views, s.favourites, s.comments, s.downloads, s.taken_at AS metrics_at
         FROM deviations d
         LEFT JOIN snapshots s ON s.id = (SELECT id FROM snapshots WHERE deviation_id = d.id ORDER BY taken_at DESC, id DESC LIMIT 1)
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
  getSetting(key: string): string | null {
    const r = this.sql.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    return r ? String(r['value']) : null;
  }
  setSetting(key: string, value: string) {
    this.sql.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

function toDeviation(r: Row): DeviationWithMetrics {
  let tags: string[] = [];
  try {
    tags = JSON.parse(String(r['tags'] ?? '[]')) as string[];
  } catch {
    tags = [];
  }
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
  };
}
