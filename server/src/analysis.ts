import { ORIGINAL, UNCLASSIFIED } from './classifier/classify.js';
import { ageInDays, describe, iqrFences, mannWhitney, mean, median, pearson, percentileRank, rate, spearman, stdDev, zScore, type Descriptive, type MannWhitney } from './stats.js';
import type { DeviationWithMetrics, RatingClass, Snapshot } from './types.js';

export const TIMEZONE = process.env.TZ_ANALYSIS ?? 'America/Bogota';
/** Etiquetas con menos obras que esto se marcan como “muestra pequeña”. */
export const MIN_TAG_WORKS = 5;
/** Para tasas de interacción se exigen al menos estas vistas (evita 1/2 = 50 %). */
export const MIN_VIEWS_FOR_RATES = 30;

export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export interface WorkRow {
  id: string;
  title: string;
  url: string;
  thumbnail: string | null;
  publishedAt: string | null;
  tags: string[];
  views: number;
  favourites: number;
  comments: number;
  downloads: number | null;
  favRate: number | null;
  commentRate: number | null;
  ageDays: number | null;
  viewsPerDay: number | null;
  favsPerDay: number | null;
  franchises: string[];
  characters: string[];
  ratingClass: RatingClass;
}

export type MetricKey = 'views' | 'favourites' | 'comments' | 'favRate' | 'commentRate' | 'viewsPerDay' | 'favsPerDay';

export function toWorkRows(devs: DeviationWithMetrics[], now = new Date()): WorkRow[] {
  return devs
    .filter((d) => d.metricsAt)
    .map((d) => {
      const age = ageInDays(d.publishedAt, now);
      return {
        id: d.id,
        title: d.title,
        url: d.url,
        thumbnail: d.thumbnail,
        publishedAt: d.publishedAt,
        tags: d.tags,
        views: d.views,
        favourites: d.favourites,
        comments: d.comments,
        downloads: d.downloads,
        favRate: d.views >= MIN_VIEWS_FOR_RATES ? rate(d.favourites, d.views) : null,
        commentRate: d.views >= MIN_VIEWS_FOR_RATES ? rate(d.comments, d.views) : null,
        ageDays: age,
        viewsPerDay: age ? d.views / age : null,
        favsPerDay: age ? d.favourites / age : null,
        franchises: d.franchises ?? [],
        characters: d.characters ?? [],
        ratingClass: d.ratingClass ?? 'desconocido',
      };
    });
}

const vals = (rows: WorkRow[], k: MetricKey) => rows.map((r) => r[k]).filter((v): v is number => v !== null && Number.isFinite(v));

interface GroupStat {
  key: string;
  label: string;
  count: number;
  meanViews: number | null;
  medianViews: number | null;
  meanFavourites: number | null;
  meanComments: number | null;
  meanFavRate: number | null;
  totalViews: number;
  lowSample: boolean;
}

function groupStats(groups: Map<string, { label: string; rows: WorkRow[] }>, minWorks: number): GroupStat[] {
  return [...groups].map(([key, { label, rows }]) => ({
    key,
    label,
    count: rows.length,
    meanViews: mean(vals(rows, 'views')),
    medianViews: median(vals(rows, 'views')),
    meanFavourites: mean(vals(rows, 'favourites')),
    meanComments: mean(vals(rows, 'comments')),
    meanFavRate: mean(vals(rows, 'favRate')),
    totalViews: rows.reduce((a, r) => a + r.views, 0),
    lowSample: rows.length < minWorks,
  }));
}

export function localParts(iso: string, tz: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { year: get('year'), month: get('month'), weekday: wd, hour: Number(get('hour')) };
}

export interface OutlierEntry {
  id: string;
  title: string;
  url: string;
  value: number;
  z: number | null;
}

export interface Outliers {
  metric: MetricKey;
  lower: number;
  upper: number;
  high: OutlierEntry[];
  low: OutlierEntry[];
}

function outliers(rows: WorkRow[], metric: MetricKey): Outliers | null {
  const v = vals(rows, metric);
  const f = iqrFences(v);
  if (!f || v.length < 4) return null;
  const m = mean(v);
  const sd = stdDev(v);
  const entry = (r: WorkRow): OutlierEntry => ({ id: r.id, title: r.title, url: r.url, value: r[metric] as number, z: zScore(r[metric] as number, m, sd) });
  const withV = rows.filter((r) => r[metric] !== null);
  return {
    metric,
    lower: f.lower,
    upper: f.upper,
    high: withV.filter((r) => (r[metric] as number) > f.upper).sort((a, b) => (b[metric] as number) - (a[metric] as number)).map(entry),
    low: withV.filter((r) => (r[metric] as number) < f.lower).sort((a, b) => (a[metric] as number) - (b[metric] as number)).map(entry),
  };
}

const CORR_METRICS: { key: MetricKey | 'ageDays' | 'tagCount'; label: string }[] = [
  { key: 'views', label: 'Vistas' },
  { key: 'favourites', label: 'Favoritos' },
  { key: 'comments', label: 'Comentarios' },
  { key: 'ageDays', label: 'Antigüedad (días)' },
  { key: 'tagCount', label: 'N.º de etiquetas' },
];

export interface GrowthEntry {
  id: string;
  title: string;
  url: string;
  views: number;
  favourites: number;
  comments: number;
  days: number;
  viewsPerDay: number;
}

export interface ArtistAnalysis {
  generatedAt: string;
  timezone: string;
  works: number;
  worksWithoutMetrics: number;
  totals: { views: number; favourites: number; comments: number; downloads: number | null };
  descriptive: Record<'views' | 'favourites' | 'comments' | 'viewsPerDay' | 'favRate' | 'commentRate', Descriptive>;
  engagement: { minViews: number; topFavRate: WorkRow[]; bottomFavRate: WorkRow[]; topCommentRate: WorkRow[] };
  top: { views: WorkRow[]; favourites: WorkRow[]; comments: WorkRow[]; viewsPerDay: WorkRow[] };
  outliers: Outliers[];
  correlations: { labels: string[]; pearson: (number | null)[][]; spearman: (number | null)[][]; n: number };
  tags: { minWorks: number; totalDistinct: number; items: GroupStat[] };
  byMonth: GroupStat[];
  byYear: GroupStat[];
  byWeekday: GroupStat[];
  byHour: GroupStat[];
  growth: null | { from: string; to: string; works: number; views: number; favourites: number; comments: number; top: GrowthEntry[] };
  timeline: { takenAt: string; views: number; favourites: number; comments: number; works: number }[];
  classification: ClassificationAnalysis;
  insights: string[];
}

export const pct = (x: number | null, d = 1) => (x === null ? '—' : `${(x * 100).toFixed(d).replace('.', ',')} %`);
export const fmt = (x: number | null, d = 0) => (x === null ? '—' : x.toLocaleString('es-CO', { maximumFractionDigits: d }));

export function analyzeArtist(
  devs: DeviationWithMetrics[],
  opts: {
    now?: Date;
    firstLast?: { id: string; first: Snapshot; last: Snapshot }[];
    timeline?: ArtistAnalysis['timeline'];
    tz?: string;
    /** Personaje → franquicia según el diccionario. */
    characterFranchise?: Record<string, string>;
    overrides?: number;
    dictionaryHash?: string | null;
  } = {},
): ArtistAnalysis {
  const now = opts.now ?? new Date();
  const tz = opts.tz ?? TIMEZONE;
  const rows = toWorkRows(devs, now);
  const sortBy = (k: MetricKey, dir: 1 | -1 = -1) => [...rows].filter((r) => r[k] !== null).sort((a, b) => dir * ((a[k] as number) - (b[k] as number)));

  // Etiquetas
  const tagGroups = new Map<string, { label: string; rows: WorkRow[] }>();
  for (const r of rows) for (const t of r.tags) (tagGroups.get(t) ?? tagGroups.set(t, { label: t, rows: [] }).get(t)!).rows.push(r);
  const tagItems = groupStats(new Map([...tagGroups].filter(([, g]) => g.rows.length >= 2)), MIN_TAG_WORKS).sort(
    (a, b) => Number(a.lowSample) - Number(b.lowSample) || (b.meanViews ?? 0) - (a.meanViews ?? 0),
  );

  // Fechas (en la zona horaria del análisis)
  const byMonth = new Map<string, { label: string; rows: WorkRow[] }>();
  const byYear = new Map<string, { label: string; rows: WorkRow[] }>();
  const byWeekday = new Map<string, { label: string; rows: WorkRow[] }>(WEEKDAYS.map((w, i) => [String(i), { label: w, rows: [] }]));
  const byHour = new Map<string, { label: string; rows: WorkRow[] }>();
  for (const r of rows) {
    if (!r.publishedAt) continue;
    const p = localParts(r.publishedAt, tz);
    const mk = `${p.year}-${p.month}`;
    (byMonth.get(mk) ?? byMonth.set(mk, { label: `${MONTHS[Number(p.month) - 1]} ${p.year}`, rows: [] }).get(mk)!).rows.push(r);
    (byYear.get(p.year) ?? byYear.set(p.year, { label: p.year, rows: [] }).get(p.year)!).rows.push(r);
    byWeekday.get(String(p.weekday))?.rows.push(r);
    const hk = String(p.hour).padStart(2, '0');
    (byHour.get(hk) ?? byHour.set(hk, { label: `${hk}:00`, rows: [] }).get(hk)!).rows.push(r);
  }
  const sortKey = (a: GroupStat, b: GroupStat) => a.key.localeCompare(b.key);

  // Correlaciones
  const series = CORR_METRICS.map((m) => rows.map((r) => (m.key === 'tagCount' ? r.tags.length : ((r[m.key as keyof WorkRow] as number | null) ?? NaN))));
  const matrix = (f: (a: number[], b: number[]) => number | null) => series.map((a) => series.map((b) => f(a, b)));

  // Crecimiento entre el primer y el último snapshot
  let growth: ArtistAnalysis['growth'] = null;
  const fl = (opts.firstLast ?? []).filter((x) => x.first.takenAt !== x.last.takenAt);
  if (fl.length) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const entries: GrowthEntry[] = fl
      .filter((x) => byId.has(x.id))
      .map((x) => {
        const r = byId.get(x.id)!;
        const days = Math.max((Date.parse(x.last.takenAt) - Date.parse(x.first.takenAt)) / 86_400_000, 1 / 24);
        const dv = x.last.views - x.first.views;
        return { id: r.id, title: r.title, url: r.url, views: dv, favourites: x.last.favourites - x.first.favourites, comments: x.last.comments - x.first.comments, days, viewsPerDay: dv / days };
      });
    growth = {
      from: fl.map((x) => x.first.takenAt).sort()[0],
      to: fl.map((x) => x.last.takenAt).sort().at(-1)!,
      works: entries.length,
      views: entries.reduce((a, e) => a + e.views, 0),
      favourites: entries.reduce((a, e) => a + e.favourites, 0),
      comments: entries.reduce((a, e) => a + e.comments, 0),
      top: entries.sort((a, b) => b.views - a.views).slice(0, 10),
    };
  }

  const totalsDownloads = rows.some((r) => r.downloads !== null) ? rows.reduce((a, r) => a + (r.downloads ?? 0), 0) : null;
  const analysis: ArtistAnalysis = {
    generatedAt: now.toISOString(),
    timezone: tz,
    works: rows.length,
    worksWithoutMetrics: devs.length - rows.length,
    totals: {
      views: rows.reduce((a, r) => a + r.views, 0),
      favourites: rows.reduce((a, r) => a + r.favourites, 0),
      comments: rows.reduce((a, r) => a + r.comments, 0),
      downloads: totalsDownloads,
    },
    descriptive: {
      views: describe(vals(rows, 'views')),
      favourites: describe(vals(rows, 'favourites')),
      comments: describe(vals(rows, 'comments')),
      viewsPerDay: describe(vals(rows, 'viewsPerDay')),
      favRate: describe(vals(rows, 'favRate')),
      commentRate: describe(vals(rows, 'commentRate')),
    },
    engagement: {
      minViews: MIN_VIEWS_FOR_RATES,
      topFavRate: sortBy('favRate').slice(0, 10),
      bottomFavRate: sortBy('favRate', 1).slice(0, 10),
      topCommentRate: sortBy('commentRate').slice(0, 10),
    },
    top: {
      views: sortBy('views').slice(0, 10),
      favourites: sortBy('favourites').slice(0, 10),
      comments: sortBy('comments').slice(0, 10),
      viewsPerDay: sortBy('viewsPerDay').slice(0, 10),
    },
    outliers: (['views', 'favourites', 'favRate', 'viewsPerDay'] as MetricKey[]).map((m) => outliers(rows, m)).filter((o): o is Outliers => !!o),
    correlations: { labels: CORR_METRICS.map((m) => m.label), pearson: matrix(pearson), spearman: matrix(spearman), n: rows.length },
    tags: { minWorks: MIN_TAG_WORKS, totalDistinct: tagGroups.size, items: tagItems.slice(0, 60) },
    byMonth: groupStats(byMonth, 3).sort(sortKey),
    byYear: groupStats(byYear, 3).sort(sortKey),
    byWeekday: groupStats(byWeekday, 3).sort((a, b) => Number(a.key) - Number(b.key)),
    byHour: groupStats(byHour, 3).sort(sortKey),
    growth,
    timeline: opts.timeline ?? [],
    classification: analyzeClassification(rows, {
      tz,
      characterFranchise: opts.characterFranchise ?? {},
      overrides: opts.overrides ?? 0,
      dictionaryHash: opts.dictionaryHash ?? null,
    }),
    insights: [],
  };
  analysis.insights = buildInsights(analysis);
  return analysis;
}

/** Frases cortas en español a partir de los resultados (sin inventar: solo describen los números). */
export function buildInsights(a: ArtistAnalysis): string[] {
  const out: string[] = [];
  if (!a.works) return out;
  const v = a.descriptive.views;
  out.push(
    `Se analizaron ${fmt(a.works)} obras con ${fmt(a.totals.views)} vistas, ${fmt(a.totals.favourites)} favoritos y ${fmt(a.totals.comments)} comentarios en total.`,
  );
  if (v.mean !== null && v.median !== null && v.mean > v.median * 1.3)
    out.push(
      `La media de vistas (${fmt(v.mean)}) supera bastante a la mediana (${fmt(v.median)}): unas pocas obras muy vistas “jalan” el promedio, así que la mediana describe mejor a una obra típica.`,
    );
  const fr = a.descriptive.favRate;
  if (fr.median !== null) out.push(`Una obra típica convierte el ${pct(fr.median, 2)} de sus vistas en favoritos (mediana, obras con ≥ ${a.engagement.minViews} vistas).`);
  const topV = a.top.views[0];
  if (topV && a.totals.views) out.push(`La obra más vista, “${topV.title}”, reúne el ${pct(topV.views / a.totals.views)} de todas las vistas.`);
  const ov = a.outliers.find((o) => o.metric === 'views');
  if (ov?.high.length) out.push(`${ov.high.length} obra(s) son valores atípicos altos en vistas (por encima de ${fmt(ov.upper)} según el criterio IQR).`);
  const r = a.correlations.spearman[0]?.[1];
  if (r !== null && r !== undefined)
    out.push(`Vistas y favoritos tienen una correlación de Spearman de ${r.toFixed(2).replace('.', ',')}: ${Math.abs(r) >= 0.7 ? 'fuerte' : Math.abs(r) >= 0.4 ? 'moderada' : 'débil'}${r < 0 ? ' y negativa' : ''}.`);
  const rAge = a.correlations.spearman[0]?.[3];
  if (rAge !== null && rAge !== undefined && Math.abs(rAge) >= 0.3)
    out.push(rAge > 0 ? 'Las obras más antiguas tienden a acumular más vistas (correlación positiva con la antigüedad).' : 'Las obras más recientes tienden a tener más vistas que las antiguas, pese a llevar menos tiempo publicadas.');
  const bestTag = a.tags.items.find((t) => !t.lowSample);
  if (bestTag) out.push(`Entre las etiquetas con al menos ${a.tags.minWorks} obras, “${bestTag.label}” tiene el mayor promedio de vistas (${fmt(bestTag.meanViews)} en ${bestTag.count} obras).`);
  const wd = a.byWeekday.filter((w) => w.count >= 5).sort((x, y) => (y.medianViews ?? 0) - (x.medianViews ?? 0))[0];
  if (wd) out.push(`Por día de publicación (hora de ${a.timezone === "America/Bogota" ? "Bogotá" : a.timezone}), el ${wd.label} tiene la mediana de vistas más alta (${fmt(wd.medianViews)}, ${wd.count} obras).`);
  out.push(...classificationInsights(a.classification, v.median));
  if (a.growth) out.push(`Entre sincronizaciones se ganaron ${fmt(a.growth.views)} vistas y ${fmt(a.growth.favourites)} favoritos en ${fmt(a.growth.works)} obras.`);
  return out;
}

export interface WorkDetail {
  work: WorkRow;
  rank: Record<'views' | 'favourites' | 'comments', number>;
  percentiles: Partial<Record<MetricKey, number | null>>;
  zScores: Partial<Record<MetricKey, number | null>>;
  artistMedians: Partial<Record<MetricKey, number | null>>;
  peers: number;
}

/** Posición de una obra frente a las demás del mismo artista. */
export function workDetail(target: DeviationWithMetrics, all: DeviationWithMetrics[], now = new Date()): WorkDetail | null {
  const rows = toWorkRows(all, now);
  const work = rows.find((r) => r.id === target.id);
  if (!work) return null;
  const keys: MetricKey[] = ['views', 'favourites', 'comments', 'favRate', 'commentRate', 'viewsPerDay', 'favsPerDay'];
  const percentiles: WorkDetail['percentiles'] = {};
  const zScores: WorkDetail['zScores'] = {};
  const artistMedians: WorkDetail['artistMedians'] = {};
  for (const k of keys) {
    const v = vals(rows, k);
    const x = work[k];
    percentiles[k] = x === null ? null : percentileRank(v, x);
    zScores[k] = x === null ? null : zScore(x, mean(v), stdDev(v));
    artistMedians[k] = median(v);
  }
  const rankOf = (k: 'views' | 'favourites' | 'comments') => 1 + rows.filter((r) => r[k] > work[k]).length;
  return { work, rank: { views: rankOf('views'), favourites: rankOf('favourites'), comments: rankOf('comments') }, percentiles, zScores, artistMedians, peers: rows.length };
}

// ======================= Franquicias, personajes y SFW/NSFW =======================

/** Categorías (franquicia, personaje o clasificación) con menos obras que esto se marcan como “muestra pequeña”. */
export const MIN_CATEGORY_WORKS = 5;
export const RATING_LABEL: Record<RatingClass, string> = { sfw: 'SFW', nsfw: 'NSFW', desconocido: 'Desconocido' };

export interface TopWork {
  id: string;
  title: string;
  url: string;
  views: number;
  favourites: number;
}

/** Estadística de una categoría (misma lógica que el resto del análisis: medianas, tasas con ≥ 30 vistas, muestra pequeña). */
export interface CategoryStat {
  key: string;
  label: string;
  count: number;
  /** Fracción de las obras analizadas (multi-etiqueta: las fracciones pueden sumar más de 1). */
  share: number;
  totalViews: number;
  /** Fracción de las vistas totales del artista. */
  viewsShare: number;
  medianViews: number | null;
  meanViews: number | null;
  totalFavourites: number;
  medianFavourites: number | null;
  meanFavourites: number | null;
  totalComments: number;
  medianComments: number | null;
  meanComments: number | null;
  medianFavRate: number | null;
  meanFavRate: number | null;
  medianViewsPerDay: number | null;
  /** Fracción NSFW dentro de la categoría (entre las de clasificación conocida). */
  nsfwShare: number | null;
  lowSample: boolean;
  /** Para personajes: franquicia a la que pertenece. */
  franchise?: string | null;
  top: TopWork[];
}

export interface RatingCell {
  count: number;
  medianViews: number | null;
  medianFavRate: number | null;
  medianViewsPerDay: number | null;
  lowSample: boolean;
}

export interface ClassificationAnalysis {
  minWorks: number;
  dictionaryHash: string | null;
  coverage: {
    works: number;
    withFranchise: number;
    /** Con franquicia distinta de “Original”. */
    fanart: number;
    original: number;
    unclassified: number;
    withCharacter: number;
    multiFranchise: number;
    overrides: number;
    franchisesDistinct: number;
    charactersDistinct: number;
  };
  franchises: CategoryStat[];
  characters: CategoryStat[];
  ratings: CategoryStat[];
  /** SFW vs NSFW: prueba de Mann–Whitney sobre vistas, favoritos/vistas y vistas por día. */
  ratingTest: null | { views: MannWhitney | null; favRate: MannWhitney | null; viewsPerDay: MannWhitney | null };
  /** ratio = mediana NSFW ÷ mediana SFW; solo si ambos grupos tienen al menos MIN_CATEGORY_WORKS obras. */
  franchiseByRating: { key: string; label: string; count: number; sfw: RatingCell; nsfw: RatingCell; ratio: number | null }[];
  franchiseByYear: { years: string[]; series: { key: string; label: string; counts: number[]; medianViews: (number | null)[]; total: number }[] };
  topCharactersByMedian: CategoryStat[];
}

function topWorks(rows: WorkRow[], n = 3): TopWork[] {
  return [...rows]
    .sort((a, b) => b.views - a.views)
    .slice(0, n)
    .map((r) => ({ id: r.id, title: r.title, url: r.url, views: r.views, favourites: r.favourites }));
}

function categoryStat(key: string, label: string, rows: WorkRow[], all: { works: number; views: number }, minWorks: number): CategoryStat {
  const totalViews = rows.reduce((a, r) => a + r.views, 0);
  const known = rows.filter((r) => r.ratingClass !== 'desconocido');
  return {
    key,
    label,
    count: rows.length,
    share: all.works ? rows.length / all.works : 0,
    totalViews,
    viewsShare: all.views ? totalViews / all.views : 0,
    medianViews: median(vals(rows, 'views')),
    meanViews: mean(vals(rows, 'views')),
    totalFavourites: rows.reduce((a, r) => a + r.favourites, 0),
    medianFavourites: median(vals(rows, 'favourites')),
    meanFavourites: mean(vals(rows, 'favourites')),
    totalComments: rows.reduce((a, r) => a + r.comments, 0),
    medianComments: median(vals(rows, 'comments')),
    meanComments: mean(vals(rows, 'comments')),
    medianFavRate: median(vals(rows, 'favRate')),
    meanFavRate: mean(vals(rows, 'favRate')),
    medianViewsPerDay: median(vals(rows, 'viewsPerDay')),
    nsfwShare: known.length ? known.filter((r) => r.ratingClass === 'nsfw').length / known.length : null,
    lowSample: rows.length < minWorks,
    top: topWorks(rows),
  };
}

function ratingCell(rows: WorkRow[], minWorks: number): RatingCell {
  return {
    count: rows.length,
    medianViews: median(vals(rows, 'views')),
    medianFavRate: median(vals(rows, 'favRate')),
    medianViewsPerDay: median(vals(rows, 'viewsPerDay')),
    lowSample: rows.length < minWorks,
  };
}

/** Orden de rankings: primero las categorías con muestra suficiente, luego por mediana de vistas. */
const byReliableMedian = (a: CategoryStat, b: CategoryStat) => Number(a.lowSample) - Number(b.lowSample) || (b.medianViews ?? 0) - (a.medianViews ?? 0);

export function analyzeClassification(
  rows: WorkRow[],
  opts: { tz?: string; characterFranchise?: Record<string, string>; overrides?: number; dictionaryHash?: string | null; minWorks?: number } = {},
): ClassificationAnalysis {
  const minWorks = opts.minWorks ?? MIN_CATEGORY_WORKS;
  const tz = opts.tz ?? TIMEZONE;
  const all = { works: rows.length, views: rows.reduce((a, r) => a + r.views, 0) };
  const group = (keyOf: (r: WorkRow) => string[]) => {
    const m = new Map<string, WorkRow[]>();
    for (const r of rows) for (const k of keyOf(r)) (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    return m;
  };
  const frGroups = group((r) => (r.franchises.length ? r.franchises : [UNCLASSIFIED]));
  const franchises = [...frGroups]
    .map(([k, rs]) => categoryStat(k, k, rs, all, minWorks))
    .sort((a, b) => b.count - a.count || (b.medianViews ?? 0) - (a.medianViews ?? 0));
  const chGroups = group((r) => r.characters);
  const characters = [...chGroups]
    .map(([k, rs]) => {
      const st = categoryStat(k, k, rs, all, minWorks);
      // Franquicia del diccionario; si el personaje vino de una corrección manual, la más común entre sus obras.
      const fromDict = opts.characterFranchise?.[k];
      const counts = new Map<string, number>();
      for (const r of rs) for (const f of r.franchises) counts.set(f, (counts.get(f) ?? 0) + 1);
      st.franchise = fromDict ?? [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return st;
    })
    .sort((a, b) => b.count - a.count || (b.medianViews ?? 0) - (a.medianViews ?? 0));
  const order: RatingClass[] = ['sfw', 'nsfw', 'desconocido'];
  const ratings = order
    .map((k) => categoryStat(k, RATING_LABEL[k], rows.filter((r) => r.ratingClass === k), all, minWorks))
    .filter((r) => r.count > 0 || r.key !== 'desconocido');
  const sfw = rows.filter((r) => r.ratingClass === 'sfw');
  const nsfw = rows.filter((r) => r.ratingClass === 'nsfw');
  const ratingTest =
    sfw.length >= 3 && nsfw.length >= 3
      ? {
          views: mannWhitney(vals(nsfw, 'views'), vals(sfw, 'views')),
          favRate: mannWhitney(vals(nsfw, 'favRate'), vals(sfw, 'favRate')),
          viewsPerDay: mannWhitney(vals(nsfw, 'viewsPerDay'), vals(sfw, 'viewsPerDay')),
        }
      : null;

  // SFW vs NSFW dentro de cada franquicia (con al menos minWorks obras en total).
  const franchiseByRating = franchises
    .filter((f) => f.count >= minWorks)
    .map((f) => {
      const rs = frGroups.get(f.key)!;
      const s = ratingCell(rs.filter((r) => r.ratingClass === 'sfw'), minWorks);
      const n = ratingCell(rs.filter((r) => r.ratingClass === 'nsfw'), minWorks);
      return { key: f.key, label: f.label, count: f.count, sfw: s, nsfw: n, ratio: !s.lowSample && !n.lowSample && s.medianViews && n.medianViews !== null ? n.medianViews / s.medianViews : null };
    });

  // Tendencia por año de las franquicias más frecuentes (excluye “Sin clasificar”).
  const yearOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(new Date(iso));
  const years = [...new Set(rows.filter((r) => r.publishedAt).map((r) => yearOf(r.publishedAt!)))].sort();
  const topFr = franchises.filter((f) => f.key !== UNCLASSIFIED).slice(0, 8);
  const franchiseByYear = {
    years,
    series: topFr.map((f) => {
      const rs = frGroups.get(f.key)!.filter((r) => r.publishedAt);
      const byY = years.map((y) => rs.filter((r) => yearOf(r.publishedAt!) === y));
      return { key: f.key, label: f.label, counts: byY.map((g) => g.length), medianViews: byY.map((g) => median(vals(g, 'views'))), total: f.count };
    }),
  };

  const withFranchise = rows.filter((r) => r.franchises.length).length;
  return {
    minWorks,
    dictionaryHash: opts.dictionaryHash ?? null,
    coverage: {
      works: rows.length,
      withFranchise,
      fanart: rows.filter((r) => r.franchises.some((f) => f !== ORIGINAL)).length,
      original: rows.filter((r) => r.franchises.includes(ORIGINAL)).length,
      unclassified: rows.length - withFranchise,
      withCharacter: rows.filter((r) => r.characters.length).length,
      multiFranchise: rows.filter((r) => r.franchises.length > 1).length,
      overrides: opts.overrides ?? 0,
      franchisesDistinct: franchises.filter((f) => f.key !== UNCLASSIFIED).length,
      charactersDistinct: characters.length,
    },
    franchises,
    characters: characters.slice(0, 150),
    ratings,
    ratingTest,
    franchiseByRating,
    franchiseByYear,
    topCharactersByMedian: characters.filter((c) => c.count >= 2).sort(byReliableMedian).slice(0, 20),
  };
}

export const pval = (p: number) => (p < 0.001 ? 'p < 0,001' : `p = ${p.toFixed(3).replace('.', ',')}`);

export function classificationInsights(c: ClassificationAnalysis, globalMedian: number | null): string[] {
  const out: string[] = [];
  const cv = c.coverage;
  if (!cv.works) return out;
  out.push(
    `El ${pct(cv.withFranchise / cv.works, 0)} de las obras tiene franquicia identificada (${fmt(cv.fanart)} con alguna franquicia o fuente y ${fmt(cv.original)} originales); ${fmt(cv.unclassified)} quedan sin clasificar.`,
  );
  const best = c.franchises.filter((f) => !f.lowSample && f.key !== UNCLASSIFIED).sort(byReliableMedian)[0];
  if (best)
    out.push(
      `Entre las franquicias con al menos ${c.minWorks} obras, ${best.label} tiene la mejor mediana de vistas (${fmt(best.medianViews)} en ${best.count} obras${globalMedian !== null ? `, frente a ${fmt(globalMedian)} del total` : ''}).`,
    );
  const s = c.ratings.find((r) => r.key === 'sfw');
  const n = c.ratings.find((r) => r.key === 'nsfw');
  if (s?.count && n?.count) {
    const t = c.ratingTest?.views;
    out.push(
      `Las obras NSFW (${fmt(n.count)}) tienen una mediana de ${fmt(n.medianViews)} vistas frente a ${fmt(s.medianViews)} de las SFW (${fmt(s.count)})` +
        (t ? `; la diferencia ${t.p < 0.05 ? 'es estadísticamente significativa' : 'no es estadísticamente significativa'} (Mann–Whitney, ${pval(t.p)}).` : '.'),
    );
  }
  const ch = c.topCharactersByMedian.find((x) => !x.lowSample);
  if (ch) out.push(`El personaje con mejor mediana de vistas (≥ ${c.minWorks} obras) es ${ch.label} (${fmt(ch.medianViews)} en ${ch.count} obras).`);
  return out;
}
