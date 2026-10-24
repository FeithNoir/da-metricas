/**
 * Funciones estadísticas puras (sin dependencias). Todas ignoran valores no finitos.
 * Convenciones:
 *  - desviación estándar muestral (n − 1);
 *  - cuantiles por interpolación lineal (tipo 7 de Hyndman y Fan, el de Excel/R/NumPy por defecto);
 *  - Spearman con rangos promedio para empates.
 */

const finite = (xs: readonly number[]) => xs.filter((x) => Number.isFinite(x));

export function sum(xs: readonly number[]): number {
  return finite(xs).reduce((a, b) => a + b, 0);
}

export function mean(xs: readonly number[]): number | null {
  const v = finite(xs);
  return v.length ? sum(v) / v.length : null;
}

export function quantile(xs: readonly number[], q: number): number | null {
  const v = [...finite(xs)].sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export const median = (xs: readonly number[]) => quantile(xs, 0.5);

export function stdDev(xs: readonly number[]): number | null {
  const v = finite(xs);
  if (v.length < 2) return v.length ? 0 : null;
  const m = sum(v) / v.length;
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
}

export interface Descriptive {
  n: number;
  total: number;
  mean: number | null;
  median: number | null;
  stdDev: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  /** Coeficiente de variación (desviación / media). */
  cv: number | null;
}

export function describe(xs: readonly number[]): Descriptive {
  const v = finite(xs);
  const m = mean(v);
  const sd = stdDev(v);
  const q1 = quantile(v, 0.25);
  const q3 = quantile(v, 0.75);
  return {
    n: v.length,
    total: sum(v),
    mean: m,
    median: median(v),
    stdDev: sd,
    min: v.length ? Math.min(...v) : null,
    max: v.length ? Math.max(...v) : null,
    q1,
    q3,
    iqr: q1 !== null && q3 !== null ? q3 - q1 : null,
    cv: m && sd !== null ? sd / m : null,
  };
}

/** Pares (x, y) en los que ambos son finitos. */
function pairs(xs: readonly number[], ys: readonly number[]): [number[], number[]] {
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      a.push(xs[i]);
      b.push(ys[i]);
    }
  }
  return [a, b];
}

export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const [a, b] = pairs(xs, ys);
  const n = a.length;
  if (n < 3) return null;
  const ma = sum(a) / n;
  const mb = sum(b) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

/** Rangos 1..n con promedio en empates. */
export function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  const [a, b] = pairs(xs, ys);
  if (a.length < 3) return null;
  return pearson(ranks(a), ranks(b));
}

/** Percentil (0–100) de `value` dentro de `xs`: porcentaje de valores ≤ value (empates a la mitad). */
export function percentileRank(xs: readonly number[], value: number): number | null {
  const v = finite(xs);
  if (!v.length || !Number.isFinite(value)) return null;
  const below = v.filter((x) => x < value).length;
  const equal = v.filter((x) => x === value).length;
  return ((below + 0.5 * equal) / v.length) * 100;
}

export interface Fences {
  lower: number;
  upper: number;
}

/** Vallas de Tukey: [Q1 − k·IQR, Q3 + k·IQR] (k = 1,5 por defecto). */
export function iqrFences(xs: readonly number[], k = 1.5): Fences | null {
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  if (q1 === null || q3 === null) return null;
  const iqr = q3 - q1;
  return { lower: q1 - k * iqr, upper: q3 + k * iqr };
}

export function zScore(x: number, m: number | null, sd: number | null): number | null {
  if (m === null || !sd) return null;
  return (x - m) / sd;
}

/** Tasa segura: null si el denominador es 0. */
export function rate(num: number, den: number): number | null {
  return den > 0 && Number.isFinite(num) ? num / den : null;
}

/** Días transcurridos (mínimo 1) entre la publicación y `now`. */
export function ageInDays(publishedAt: string | null, now: Date): number | null {
  if (!publishedAt) return null;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(1, (now.getTime() - t) / 86_400_000);
}
