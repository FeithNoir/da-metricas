import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ClassificationService } from '../src/classification.js';
import { Db, SCHEMA_VERSION } from '../src/db.js';
import { fixture } from './helpers.js';

/** Esquema v0 tal como estaba antes de añadir la clasificación (sin descripción ni tablas nuevas). */
const V0 = `
CREATE TABLE artists (username TEXT PRIMARY KEY, display_name TEXT NOT NULL, avatar TEXT, gallery_total INTEGER, auto_sync INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_sync_at TEXT, last_sync_status TEXT);
CREATE TABLE deviations (id TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES artists(username) ON DELETE CASCADE, url TEXT NOT NULL, title TEXT NOT NULL, thumbnail TEXT, published_at TEXT, rating TEXT, tags TEXT NOT NULL DEFAULT '[]', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, stats_source TEXT);
CREATE TABLE syncs (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, phase TEXT NOT NULL DEFAULT '', found INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, message TEXT);
CREATE TABLE snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, deviation_id TEXT NOT NULL REFERENCES deviations(id) ON DELETE CASCADE, sync_id INTEGER REFERENCES syncs(id) ON DELETE SET NULL, taken_at TEXT NOT NULL, views INTEGER NOT NULL, favourites INTEGER NOT NULL, comments INTEGER NOT NULL, downloads INTEGER);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE http_cache (url TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);
INSERT INTO artists (username, display_name, avatar, gallery_total, auto_sync, created_at, last_sync_at, last_sync_status) VALUES ('feithnoir', 'FeithNoir', NULL, 702, 1, '2026-10-24T16:00:00Z', NULL, NULL);
INSERT INTO deviations (id, username, url, title, thumbnail, published_at, rating, tags, first_seen_at, last_seen_at, stats_source) VALUES ('1401415400', 'feithnoir', 'https://www.deviantart.com/feithnoir/art/Ecchitober-Day-23-Invocation-1401415400', 'Ecchitober: Day 23 - "Invocation"', NULL, '2026-10-24T05:20:48Z', 'adult', '["originalcharacter","demongirl"]', '2026-10-24T16:00:00Z', '2026-10-24T16:00:00Z', 'oembed');
INSERT INTO deviations (id, username, url, title, thumbnail, published_at, rating, tags, first_seen_at, last_seen_at, stats_source) VALUES ('2', 'feithnoir', 'https://www.deviantart.com/feithnoir/art/Naruto-Sakura-Haruno-2', 'Naruto - Sakura Haruno', NULL, '2024-01-01T00:00:00Z', 'nonadult', '[]', '2026-10-24T16:00:00Z', '2026-10-24T16:00:00Z', 'oembed');
INSERT INTO syncs (username, started_at, finished_at, status, phase, found, processed) VALUES ('feithnoir', '2026-10-24T16:00:00Z', '2026-10-24T16:07:00Z', 'ok', 'fin', 2, 2);
INSERT INTO snapshots (deviation_id, sync_id, taken_at, views, favourites, comments, downloads) VALUES ('1401415400', 1, '2026-10-24T16:01:00Z', 373, 5, 3, 0), ('2', 1, '2026-10-24T16:02:00Z', 1500, 20, 2, 0), ('2', NULL, '2026-10-24T17:00:00Z', 1510, 21, 2, 0);
`;

describe('migración de la base SQLite', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('pasa de v0 a la versión actual sin perder obras, snapshots ni sincronizaciones', () => {
    dir = mkdtempSync(join(tmpdir(), 'dam-'));
    const file = join(dir, 'old.db');
    const old = new DatabaseSync(file);
    old.exec(V0);
    // RSS guardado en caché antes de la migración: sirve para recuperar descripciones sin pedir nada
    old.prepare('INSERT INTO http_cache VALUES (?, ?, ?)').run('https://backend.deviantart.com/rss.xml?type=deviation&q=gallery%3Afeithnoir', fixture('rss-feithnoir-page1.xml'), Date.now());
    old.close();

    const db = new Db(file);
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    const cols = (db.sql.prepare('PRAGMA table_info(deviations)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('description');
    const tables = (db.sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['classifications', 'classification_overrides']));
    expect(db.listDeviations('feithnoir')).toHaveLength(2);
    expect(db.history('2').map((s) => s.views)).toEqual([1500, 1510]);
    expect(db.listSyncs('feithnoir')).toHaveLength(1);

    // Antes de clasificar: sin franquicias, pero SFW/NSFW ya sale de la columna rating existente
    const before = db.listDeviations('feithnoir');
    expect(before.find((d) => d.id === '2')).toMatchObject({ franchises: [], ratingClass: 'sfw', views: 1510 });

    const svc = new ClassificationService(db);
    expect(svc.backfillFromCache()).toBe(1); // solo la obra que está en el RSS de la caché
    expect(String((db.sql.prepare("SELECT description FROM deviations WHERE id = '1401415400'").get() as { description: string }).description)).toMatch(/Lillith/);
    expect(db.staleClassifications('feithnoir', svc.hash())).toBe(2);
    expect(svc.ensure('feithnoir')).toBe(true);
    expect(svc.ensure('feithnoir')).toBe(false); // ya al día con este diccionario
    const after = db.listDeviations('feithnoir');
    expect(after.find((d) => d.id === '2')).toMatchObject({ franchises: ['Naruto'], characters: ['Sakura Haruno'], ratingClass: 'sfw' });
    expect(after.find((d) => d.id === '1401415400')).toMatchObject({ franchises: ['Original'], ratingClass: 'nsfw' });
    db.close();

    // Reabrir es idempotente y conserva la clasificación
    const again = new Db(file);
    expect(again.schemaVersion).toBe(SCHEMA_VERSION);
    expect(again.listDeviations('feithnoir').find((d) => d.id === '2')?.franchises).toEqual(['Naruto']);
    again.close();
  });

  it('las correcciones manuales sobreviven a la reclasificación y se borran con la obra', () => {
    const db = new Db(':memory:');
    db.sql.exec(V0.split('\n').filter((l) => l.startsWith('INSERT')).join('\n'));
    const svc = new ClassificationService(db);
    svc.reclassify('feithnoir');
    svc.override('2', { franchises: ['Boruto'], rating: 'nsfw' });
    svc.reclassify('feithnoir');
    const c = db.getClassification('2')!;
    expect(c.auto.franchises).toEqual(['Naruto']);
    expect(c.effective).toEqual({ franchises: ['Boruto'], characters: ['Sakura Haruno'], ratingClass: 'nsfw' });
    expect(() => svc.override('2', { characters: Array.from({ length: 30 }, (_, i) => `P${i}`) })).toThrow(/Máximo 25/);
    db.deleteArtist('feithnoir');
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM classification_overrides').get()).toMatchObject({ n: 0 });
    db.close();
  });
});
