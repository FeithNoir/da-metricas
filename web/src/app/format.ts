export const TZ = 'America/Bogota';

export function num(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return x.toLocaleString('es-CO', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** 1234 → “1,2 mil”; 1 500 000 → “1,5 M”. */
export function compact(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  if (Math.abs(x) >= 1e6) return `${num(x / 1e6, 1)} M`;
  if (Math.abs(x) >= 1e4) return `${num(x / 1e3, 1)} mil`;
  return num(x, x < 10 && x % 1 ? 1 : 0);
}

export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${num(x * 100, digits)} %`;
}

export function corr(x: number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  return x.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Intensidad en palabras de un coeficiente de correlación. */
export function corrLabel(r: number | null | undefined): string {
  if (r === null || r === undefined) return 'sin datos';
  const a = Math.abs(r);
  const s = a >= 0.7 ? 'fuerte' : a >= 0.4 ? 'moderada' : a >= 0.2 ? 'débil' : 'casi nula';
  return r < 0 && a >= 0.2 ? `${s} negativa` : s;
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${new Date(iso).toLocaleString('es-CO', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (hora de Bogotá)`;
}

/** “hace 3 h”, “hace 2 días”. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'nunca';
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

export const SYNC_STATUS: Record<string, string> = {
  running: 'en curso',
  ok: 'completa',
  partial: 'parcial',
  error: 'con error',
  not_found: 'usuario inexistente',
  empty: 'sin obras públicas',
};

export const METRIC_LABEL: Record<string, string> = {
  views: 'Vistas',
  favourites: 'Favoritos',
  comments: 'Comentarios',
  favRate: 'Favoritos / vistas',
  commentRate: 'Comentarios / vistas',
  viewsPerDay: 'Vistas por día',
  favsPerDay: 'Favoritos por día',
};

export const isRate = (k: string) => k === 'favRate' || k === 'commentRate';
export const metricValue = (k: string, v: number | null | undefined) => (isRate(k) ? pct(v, 2) : num(v, k.endsWith('PerDay') ? 1 : 0));
