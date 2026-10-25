import type { Db } from './db.js';
import type { DeviantArtClient } from './deviantart.js';
import type { BrowseItem } from './parsers/browse.js';
import type { BenchmarkItem, BenchmarkKind, BenchmarkRun } from './types.js';

export const BENCHMARK_MIN_SIZE = 24;
export const BENCHMARK_MAX_SIZE = 300;
export const BENCHMARK_DEFAULT_SIZE = 100;
/** Obras por página de exploración (lo que devuelve DeviantArt). */
export const BROWSE_PAGE_SIZE = 24;
/**
 * Muestra “general”: DeviantArt no tiene una lista pública de “lo más nuevo de toda la plataforma” sin sesión,
 * así que se combinan, por turnos, varias etiquetas amplias (y, en Populares, la portada).
 */
export const GENERAL_TAGS = ['digitalart', 'fanart', 'anime', 'art', 'drawing', 'illustration', 'originalcharacter', 'painting', 'photography'];
export const HOME_URL = 'https://www.deviantart.com/';
/** Sin sesión, DeviantArt devuelve el mismo ranking para 24 h, 1 semana, 1 mes y “siempre”: se usa el de siempre. */
export const POPULAR_ORDER = 'popular-all-time';
export const RECENT_ORDER = 'most-recent';

export const browseUrl = (tag: string, kind: BenchmarkKind, page = 1) =>
  `https://www.deviantart.com/tag/${encodeURIComponent(tag)}?order=${kind === 'recent' ? RECENT_ORDER : POPULAR_ORDER}${page > 1 ? `&page=${page}` : ''}`;

export interface BenchmarkParams {
  kind: BenchmarkKind;
  scope: string;
  size: number;
}

export const KIND_LABEL: Record<BenchmarkKind, string> = { recent: 'Recientes', popular: 'Populares' };

/** Normaliza una etiqueta como las de DeviantArt: minúsculas, sin tildes, sin espacios ni signos (salvo “_”). */
export function normalizeScope(raw: unknown): string {
  const v = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!v || v === 'general') return 'general';
  return v.replace(/^#/, '').replace(/[\s-]+/g, '').replace(/[^a-z0-9_]/g, '');
}

export function validateBenchmarkParams(input: unknown): BenchmarkParams {
  if (!input || typeof input !== 'object') throw new Error('Cuerpo inválido: se esperaba un objeto JSON.');
  const b = input as Record<string, unknown>;
  if (b['kind'] !== 'recent' && b['kind'] !== 'popular') throw new Error('“kind” debe ser "recent" (recientes) o "popular" (populares).');
  const scope = normalizeScope(b['scope']);
  if (scope !== 'general' && !/^[a-z0-9_]{2,50}$/.test(scope)) throw new Error('La etiqueta debe tener entre 2 y 50 letras o números (sin espacios), o usa “general”.');
  const size = b['size'] === undefined ? BENCHMARK_DEFAULT_SIZE : Number(b['size']);
  if (!Number.isInteger(size)) throw new Error('“size” debe ser un número entero de obras.');
  if (size < BENCHMARK_MIN_SIZE || size > BENCHMARK_MAX_SIZE)
    throw new Error(`El tamaño de la muestra debe estar entre ${BENCHMARK_MIN_SIZE} y ${BENCHMARK_MAX_SIZE} obras (para no sobrecargar DeviantArt).`);
  return { kind: b['kind'], scope, size };
}

/** Peticiones aproximadas y duración estimada (para mostrarlas antes de medir). Cada fuente cuesta al menos una página. */
export function estimateCost(size: number, delayMs: number, concurrency: number, sources = 1) {
  const pages = Math.max(Math.ceil(size / BROWSE_PAGE_SIZE), sources);
  const requests = pages + size;
  // Páginas de exploración: ~1,3 MB y ~1,5 s cada una (una a una); oEmbed: ~2 KB, en paralelo (máx. 2) con la pausa cortés.
  const seconds = Math.round(pages * (1.5 + Math.max(delayMs, 250) / 1000) + (size * Math.max(delayMs, 250)) / 1000 / Math.max(1, Math.min(2, concurrency)));
  return { pages, requests, seconds, megabytes: Math.round(pages * 1.3) };
}

interface Source {
  label: string;
  url: (page: number) => string;
  page: number;
  done: boolean;
  /** Obras ya descargadas que aún no entraron en la muestra. */
  buffer: BrowseItem[];
}

export function planSources(kind: BenchmarkKind, scope: string): Source[] {
  const tags = scope === 'general' ? GENERAL_TAGS : [scope];
  const out: Source[] = [];
  // La portada (sin sesión) es lo que DeviantArt destaca ahora mismo: una sola página.
  if (kind === 'popular' && scope === 'general') out.push({ label: 'portada', url: () => HOME_URL, page: 1, done: false, buffer: [] });
  for (const t of tags) out.push({ label: t, url: (p) => browseUrl(t, kind, p), page: 1, done: false, buffer: [] });
  return out;
}

export interface BenchmarkOptions {
  log?: (m: string) => void;
  concurrency?: number;
  /** Límite de páginas por fuente (seguridad). */
  maxPagesPerSource?: number;
}

/** Mide una muestra de referencia de la plataforma: lista (páginas públicas) → oEmbed por obra (etiquetas, SFW/NSFW, cifras). */
export class BenchmarkService {
  private current: { run: BenchmarkRun; done: Promise<BenchmarkRun> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly da: DeviantArtClient,
    private readonly opts: BenchmarkOptions = {},
  ) {}

  get running(): BenchmarkRun | null {
    return this.current ? this.db.getBenchmark(this.current.run.id) : null;
  }

  /** Una medición a la vez (en total), para no sumar carga a DeviantArt. */
  start(params: BenchmarkParams): { run: BenchmarkRun; done: Promise<BenchmarkRun>; reused: boolean } {
    if (this.current) return { ...this.current, run: this.db.getBenchmark(this.current.run.id)!, reused: true };
    const run = this.db.startBenchmark(params);
    const done = this.run(run.id, params).finally(() => (this.current = null));
    this.current = { run, done };
    return { run, done, reused: false };
  }

  private async run(id: number, p: BenchmarkParams): Promise<BenchmarkRun> {
    const log = this.opts.log ?? (() => {});
    const finish = (status: BenchmarkRun['status'], message: string | null) => {
      this.db.finishBenchmark(id, status, message);
      log(`[tendencias ${id}] ${p.kind}/${p.scope}: ${status}${message ? ` — ${message}` : ''}`);
      return this.db.getBenchmark(id)!;
    };
    try {
      const sources = planSources(p.kind, p.scope);
      const picked = new Map<string, { item: BrowseItem; source: string }>();
      const used: string[] = [];
      const maxPages = this.opts.maxPagesPerSource ?? Math.ceil(BENCHMARK_MAX_SIZE / BROWSE_PAGE_SIZE) + 2;
      // Reparto equitativo: en cada turno, cada fuente activa aporta hasta ⌈faltantes / fuentes activas⌉ obras
      // de su página actual (lo que sobra queda guardado para el siguiente turno, sin pedirlo otra vez).
      const add = (s: Source, item: BrowseItem) => {
        if (picked.has(item.id)) return false;
        picked.set(item.id, { item, source: s.label });
        return true;
      };
      while (picked.size < p.size) {
        const active = sources.filter((s) => !s.done || s.buffer.length);
        if (!active.length) break;
        const cap = Math.max(1, Math.ceil((p.size - picked.size) / active.length));
        let progress = false;
        for (const s of active) {
          if (picked.size >= p.size) break;
          if (!s.buffer.length && !s.done) {
            const url = s.url(s.page);
            try {
              const page = await this.da.browse(url);
              used.push(url);
              const fresh = page.items.filter((i) => !picked.has(i.id));
              s.buffer.push(...fresh);
              s.page++;
              // Sin obras nuevas en la página (todo repetido) → no vale la pena seguir pidiendo esa fuente.
              if (!page.hasMore || !fresh.length || s.label === 'portada' || s.page > maxPages) s.done = true;
            } catch (e) {
              if (/cloudflare/i.test((e as Error).message)) throw e;
              if (!picked.size && sources.length === 1) throw e;
              log(`[tendencias ${id}] ${url}: ${(e as Error).message}`);
              s.done = true;
              s.buffer = [];
            }
          }
          let taken = 0;
          while (s.buffer.length && taken < cap && picked.size < p.size) if (add(s, s.buffer.shift()!)) taken++;
          if (taken) progress = true;
        }
        this.db.updateBenchmark(id, { found: picked.size, sources: used });
        if (!progress && sources.every((s) => s.done && !s.buffer.length)) break;
      }
      if (!picked.size) return finish('empty', p.scope === 'general' ? 'DeviantArt no devolvió obras.' : `No hay obras públicas con la etiqueta “${p.scope}”.`);

      // Más recientes: orden por fecha. Populares: el orden de DeviantArt (portada primero).
      const list = [...picked.values()];
      if (p.kind === 'recent') list.sort((a, b) => Date.parse(b.item.publishedAt ?? '') - Date.parse(a.item.publishedAt ?? ''));
      this.db.updateBenchmark(id, { found: list.length, phase: 'métricas' });

      let processed = 0;
      let failed = 0;
      const queue = list.map((x, rank) => ({ ...x, rank }));
      const worker = async () => {
        for (let q = queue.shift(); q; q = queue.shift()) {
          const { item, source, rank } = q;
          const base: BenchmarkItem = {
            id: item.id,
            rank,
            source,
            url: item.url,
            title: item.title,
            author: item.author,
            thumbnail: null,
            publishedAt: item.publishedAt,
            rating: item.rating,
            tags: [],
            views: item.views ?? 0,
            favourites: item.favourites ?? 0,
            comments: item.comments ?? 0,
            downloads: item.downloads,
            statsSource: 'browse',
            measuredAt: new Date().toISOString(),
          };
          try {
            const d = await this.da.oembed(item.url);
            this.db.saveBenchmarkItem(id, {
              ...base,
              // El título de la página de exploración viene bien codificado; el de oEmbed a veces no.
              title: base.title || d.title || '',
              thumbnail: d.thumbnail,
              publishedAt: base.publishedAt ?? d.publishedAt,
              rating: d.rating ?? base.rating,
              tags: d.tags,
              views: d.views,
              favourites: d.favourites,
              comments: d.comments,
              downloads: d.downloads ?? base.downloads,
              statsSource: 'oembed',
              measuredAt: new Date().toISOString(),
            });
          } catch (e) {
            if (/cloudflare/i.test((e as Error).message)) {
              queue.length = 0;
              throw e;
            }
            // Sin oEmbed se conservan las cifras de la página de exploración (sin etiquetas).
            failed++;
            if (item.views !== null) this.db.saveBenchmarkItem(id, base);
          }
          processed++;
          if (processed % 5 === 0 || processed === list.length) this.db.updateBenchmark(id, { processed, failed });
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, Math.max(1, this.opts.concurrency ?? 2)) }, worker));
      this.db.updateBenchmark(id, { processed, failed });
      const short = list.length < p.size ? ` Solo se encontraron ${list.length} de ${p.size} obras.` : '';
      if (failed === list.length) return finish('partial', `No se pudo leer el oEmbed de ninguna obra: se usan las cifras de las páginas de exploración, sin etiquetas.${short}`);
      return finish(failed || short ? 'partial' : 'ok', [failed ? `${failed} obra(s) sin oEmbed (sin etiquetas).` : '', short.trim()].filter(Boolean).join(' ') || null);
    } catch (e) {
      return finish('error', (e as Error).message);
    }
  }
}

export interface BenchmarkAutoSettings {
  /** Medir Recientes y Populares después de cada sincronización automática (respeta su intervalo mínimo). */
  enabled: boolean;
  size: number;
  scope: string;
}

export const DEFAULT_AUTO: BenchmarkAutoSettings = { enabled: false, size: BENCHMARK_DEFAULT_SIZE, scope: 'general' };

export function validateAutoSettings(input: unknown, current: BenchmarkAutoSettings): BenchmarkAutoSettings {
  if (!input || typeof input !== 'object') throw new Error('Cuerpo inválido: se esperaba un objeto JSON.');
  const b = input as Record<string, unknown>;
  const next = { ...current };
  if (b['enabled'] !== undefined) {
    if (typeof b['enabled'] !== 'boolean') throw new Error('“enabled” debe ser verdadero o falso.');
    next.enabled = b['enabled'];
  }
  if (b['size'] !== undefined || b['scope'] !== undefined) {
    const p = validateBenchmarkParams({ kind: 'recent', size: b['size'] ?? next.size, scope: b['scope'] ?? next.scope });
    next.size = p.size;
    next.scope = p.scope;
  }
  return next;
}
