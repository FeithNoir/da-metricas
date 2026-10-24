import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3100),
  host: process.env.HOST ?? '0.0.0.0',
  dbFile: process.env.DB_FILE ?? resolve(here, '..', 'data', 'da-metricas.db'),
  webDist: process.env.WEB_DIST ?? resolve(here, '..', '..', 'web', 'dist', 'web', 'browser'),
  userAgent:
    process.env.USER_AGENT ??
    'da-metricas/1.0 (herramienta personal de métricas públicas; +https://github.com/FeithNoir/da-metricas)',
  /** Peticiones simultáneas a DeviantArt (1–2 para ser amables). */
  concurrency: Math.min(2, Math.max(1, num(process.env.DA_CONCURRENCY, 2))),
  /** Pausa mínima entre peticiones, en ms. */
  delayMs: Math.max(250, num(process.env.DA_DELAY_MS, 600)),
  maxRetries: num(process.env.DA_MAX_RETRIES, 4),
  /** Vida de la caché HTTP en minutos (evita repetir descargas en sincronizaciones seguidas). */
  cacheTtlMinutes: num(process.env.CACHE_TTL_MINUTES, 30),
  /** Tope de páginas RSS por artista (60 obras por página). */
  maxRssPages: num(process.env.DA_MAX_RSS_PAGES, 100),
};
