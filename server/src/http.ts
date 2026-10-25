import { config } from './config.js';
import type { Db } from './db.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpResult {
  status: number;
  body: string;
  fromCache: boolean;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} en ${url}`);
  }
}

export interface PoliteClientOptions {
  fetch?: FetchLike;
  db?: Db | null;
  userAgent?: string;
  concurrency?: number;
  delayMs?: number;
  maxRetries?: number;
  cacheTtlMinutes?: number;
  /** Inyectable en tests para no esperar de verdad. */
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([403, 429, 500, 502, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Cliente HTTP “amable” con DeviantArt:
 *  - User-Agent descriptivo;
 *  - concurrencia limitada (1–2) y pausa mínima entre peticiones;
 *  - reintentos con backoff exponencial (y Retry-After) ante 429/403/5xx;
 *  - caché en SQLite con TTL para respuestas 200;
 *  - detecta desafíos de Cloudflare y NO intenta saltárselos.
 */
export class PoliteClient {
  private readonly fetchFn: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private lastStart = 0;
  readonly opts: Required<Omit<PoliteClientOptions, 'fetch' | 'db' | 'sleep'>>;
  requests = 0;

  constructor(private readonly options: PoliteClientOptions = {}) {
    this.fetchFn = options.fetch ?? ((u, i) => fetch(u, i));
    this.sleep = options.sleep ?? defaultSleep;
    this.opts = {
      userAgent: options.userAgent ?? config.userAgent,
      concurrency: Math.min(2, Math.max(1, options.concurrency ?? config.concurrency)),
      delayMs: options.delayMs ?? config.delayMs,
      maxRetries: options.maxRetries ?? config.maxRetries,
      cacheTtlMinutes: options.cacheTtlMinutes ?? config.cacheTtlMinutes,
    };
  }

  private async acquire() {
    if (this.active >= this.opts.concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    const wait = this.lastStart + this.opts.delayMs - Date.now();
    this.lastStart = Math.max(Date.now(), this.lastStart + this.opts.delayMs);
    if (wait > 0) await this.sleep(wait);
  }

  private release() {
    this.active--;
    this.queue.shift()?.();
  }

  /** GET con caché. `useCache: false` fuerza la descarga (pero guarda el resultado, salvo `store: false`). */
  async get(url: string, { useCache = true, store = true }: { useCache?: boolean; store?: boolean } = {}): Promise<HttpResult> {
    const db = this.options.db;
    if (useCache && db && this.opts.cacheTtlMinutes > 0) {
      const hit = db.cacheGet(url, this.opts.cacheTtlMinutes);
      if (hit !== null) return { status: 200, body: hit, fromCache: true };
    }
    let attempt = 0;
    for (;;) {
      await this.acquire();
      let res: Response;
      try {
        this.requests++;
        res = await this.fetchFn(url, {
          headers: { 'User-Agent': this.opts.userAgent, Accept: 'application/json, application/rss+xml, text/html;q=0.9, */*;q=0.5' },
          redirect: 'follow',
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        this.release();
        if (attempt++ >= this.opts.maxRetries) throw new HttpError(0, url, `Error de red en ${url}: ${(e as Error).message}`);
        await this.sleep(this.backoff(attempt));
        continue;
      }
      const body = await res.text().catch(() => '');
      this.release();
      if (res.ok) {
        if (isCloudflareChallenge(res, body)) throw new HttpError(403, url, `Cloudflare pidió verificación en ${url}; no se intenta saltar.`);
        if (store) db?.cacheSet(url, body);
        return { status: res.status, body, fromCache: false };
      }
      if (RETRYABLE.has(res.status) && attempt < this.opts.maxRetries && !isCloudflareChallenge(res, body)) {
        attempt++;
        const retryAfter = Number(res.headers.get('retry-after'));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 120_000) : this.backoff(attempt));
        continue;
      }
      throw new HttpError(res.status, url, isCloudflareChallenge(res, body) ? `Cloudflare bloqueó ${url}; no se intenta saltar.` : undefined);
    }
  }

  private backoff(attempt: number) {
    return Math.min(60_000, 2000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
  }
}

export function isCloudflareChallenge(res: Response, body: string): boolean {
  const server = res.headers.get('server') ?? '';
  return /cloudflare/i.test(server) && /just a moment|cf-chl|challenge-platform/i.test(body.slice(0, 20_000));
}
