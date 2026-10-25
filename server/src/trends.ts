/**
 * Tendencias: análisis de muestras de referencia (Recientes / Populares), contraste con un artista y consejos.
 * Todo es estadística descriptiva y reglas explícitas: cada consejo muestra las cifras en las que se basa.
 */
import { analyzeArtist, fmt, localParts, MIN_VIEWS_FOR_RATES, pct, pval, toWorkRows, type ArtistAnalysis, type WorkRow } from './analysis.js';
import { classifyWith, compactKey, ORIGINAL, ratingClassOf, UNCLASSIFIED, type Compiled } from './classifier/classify.js';
import { mannWhitney, mean, median, percentileRank, spearman } from './stats.js';
import type { BenchmarkItem, BenchmarkKind, BenchmarkRun, DeviationWithMetrics } from './types.js';
import { TIMEZONE } from './analysis.js';
import { GENERAL_TAGS, KIND_LABEL } from './benchmark.js';

export type Confidence = 'alta' | 'media' | 'baja';
/** Confianza por tamaño de muestra: ≥30 alta, ≥10 media, menos baja. */
export const confidenceFor = (n: number): Confidence => (n >= 30 ? 'alta' : n >= 10 ? 'media' : 'baja');
const CONF_WEIGHT: Record<Confidence, number> = { alta: 1, media: 0.7, baja: 0.4 };

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Convierte las obras de una muestra en el mismo formato que las del artista (clasificadas al vuelo con el diccionario actual). */
export function benchmarkWorks(items: BenchmarkItem[], compiled: Compiled): DeviationWithMetrics[] {
  return items.map((it) => {
    const author = it.author ?? '';
    const c = classifyWith(compiled, { title: it.title, tags: it.tags, username: author });
    return {
      id: it.id,
      username: author,
      url: it.url,
      title: it.title,
      thumbnail: it.thumbnail,
      publishedAt: it.publishedAt,
      rating: it.rating,
      tags: it.tags,
      firstSeenAt: it.measuredAt,
      lastSeenAt: it.measuredAt,
      statsSource: it.statsSource,
      views: it.views,
      favourites: it.favourites,
      comments: it.comments,
      downloads: it.downloads,
      metricsAt: it.measuredAt,
      franchises: c.franchises,
      characters: c.characters,
      ratingClass: ratingClassOf(it.rating),
      classificationOverridden: false,
    };
  });
}

/** Momento de referencia de una muestra: la mediana de las mediciones (todas ocurren en pocos minutos). */
export function measuredAt(items: BenchmarkItem[], run?: BenchmarkRun | null): Date {
  const ts = items.map((i) => Date.parse(i.measuredAt)).filter(Number.isFinite);
  const m = median(ts);
  return new Date(m ?? Date.parse(run?.finishedAt ?? run?.startedAt ?? '') ?? Date.now());
}

export interface AgeStats {
  /** Edad exacta (horas) al medir; no tiene el mínimo de 1 día que usa el resto del análisis. */
  medianAgeHours: number | null;
  minAgeHours: number | null;
  maxAgeHours: number | null;
  /** Mediana de vistas por hora desde la publicación (edad mínima: 15 min). */
  medianViewsPerHour: number | null;
}

export function ageStats(items: { publishedAt: string | null; views: number; measuredAt: string }[]): AgeStats {
  const ages: number[] = [];
  const vph: number[] = [];
  for (const it of items) {
    const p = Date.parse(it.publishedAt ?? '');
    const m = Date.parse(it.measuredAt);
    if (!Number.isFinite(p) || !Number.isFinite(m)) continue;
    const h = Math.max(0, (m - p) / HOUR_MS);
    ages.push(h);
    vph.push(it.views / Math.max(0.25, h));
  }
  return {
    medianAgeHours: median(ages),
    minAgeHours: ages.length ? Math.min(...ages) : null,
    maxAgeHours: ages.length ? Math.max(...ages) : null,
    medianViewsPerHour: median(vph),
  };
}

export interface SampleExtras {
  kind: BenchmarkKind;
  scope: string;
  measuredAt: string;
  items: number;
  withTags: number;
  authors: number;
  topAuthors: { author: string; count: number }[];
  /** Mayor fracción de la muestra que pertenece a un solo autor. */
  topAuthorShare: number | null;
  ages: AgeStats;
  /** Minutos entre la obra más antigua y la más nueva de la muestra. */
  spanMinutes: number | null;
  /** Obras publicadas por minuto en las fuentes consultadas (solo tiene sentido en Recientes). */
  uploadsPerMinute: number | null;
  medianTagCount: number | null;
  /** Por fuente: obras y, en Recientes, ritmo de publicación (obras por hora en esa etiqueta). */
  sources: { source: string; count: number; spanMinutes: number | null; perHour: number | null }[];
  notes: string[];
}

export interface BenchmarkAnalysis {
  run: BenchmarkRun;
  analysis: ArtistAnalysis;
  extras: SampleExtras;
}

export function analyzeBenchmark(run: BenchmarkRun, items: BenchmarkItem[], compiled: Compiled, characterFranchise: Record<string, string>): BenchmarkAnalysis {
  const now = measuredAt(items, run);
  const devs = benchmarkWorks(items, compiled);
  const analysis = analyzeArtist(devs, { now, characterFranchise });
  const authors = new Map<string, number>();
  const sources = new Map<string, number[]>();
  for (const it of items) {
    const a = it.author ?? '?';
    authors.set(a, (authors.get(a) ?? 0) + 1);
    const t = Date.parse(it.publishedAt ?? '');
    (sources.get(it.source) ?? sources.set(it.source, []).get(it.source)!).push(t);
  }
  const rateOf = (ts: number[]) => {
    const v = ts.filter(Number.isFinite);
    if (v.length < 2) return { spanMinutes: null, perHour: null };
    const span = (Math.max(...v) - Math.min(...v)) / 60_000;
    return { spanMinutes: span, perHour: span > 0 ? ((v.length - 1) / span) * 60 : null };
  };
  const pub = items.map((i) => Date.parse(i.publishedAt ?? '')).filter(Number.isFinite);
  const span = pub.length > 1 ? (Math.max(...pub) - Math.min(...pub)) / 60_000 : null;
  const topAuthors = [...authors].map(([author, count]) => ({ author, count })).sort((a, b) => b.count - a.count || a.author.localeCompare(b.author));
  const notes: string[] = [];
  const ages = ageStats(items);
  if (run.kind === 'recent')
    notes.push(
      'Estas obras tienen minutos u horas de publicadas: sus vistas y favoritos apenas empiezan. Sirven para ver qué se sube (temas, etiquetas, SFW/NSFW, horarios), no para comparar rendimiento total.',
    );
  if (run.kind === 'popular')
    notes.push(
      'DeviantArt muestra la misma lista para “24 horas”, “semana” y “siempre” a quien no inicia sesión, y oculta el contenido maduro (NSFW): esta muestra refleja lo que ve un visitante sin cuenta.',
    );
  if (run.scope === 'general')
    notes.push(
      run.kind === 'popular'
        ? 'Muestra general: portada de DeviantArt + populares de etiquetas amplias, por turnos.'
        : 'Muestra general: lo más nuevo de varias etiquetas amplias, por turnos (DeviantArt no publica una lista global de “lo más nuevo” sin sesión).',
    );
  const tagCounts = items.filter((i) => i.tags.length).map((i) => i.tags.length);
  return {
    run,
    analysis,
    extras: {
      kind: run.kind,
      scope: run.scope,
      measuredAt: now.toISOString(),
      items: items.length,
      withTags: items.filter((i) => i.statsSource === 'oembed').length,
      authors: authors.size,
      topAuthors: topAuthors.slice(0, 10),
      topAuthorShare: items.length ? topAuthors[0]!.count / items.length : null,
      ages,
      spanMinutes: span,
      // Solo con una fuente: mezclar etiquetas con ritmos distintos daría una cifra sin sentido.
      uploadsPerMinute: run.kind === 'recent' && sources.size === 1 && span && span > 0 && pub.length > 1 ? (pub.length - 1) / span : null,
      medianTagCount: median(tagCounts),
      sources: [...sources]
        .map(([source, ts]) => ({ source, count: ts.length, ...(run.kind === 'recent' ? rateOf(ts) : { spanMinutes: null, perHour: null }) }))
        .sort((a, b) => b.count - a.count || (b.perHour ?? 0) - (a.perHour ?? 0)),
      notes,
    },
  };
}

// ───────────────────────────── Contraste ─────────────────────────────

export type GroupKey = 'artist' | 'artistScoped' | 'recent' | 'popular';

export interface GroupSummary {
  key: GroupKey;
  label: string;
  n: number;
  medianViews: number | null;
  meanViews: number | null;
  medianFavourites: number | null;
  medianComments: number | null;
  /** Mediana de favoritos ÷ vistas (solo obras con ≥30 vistas). */
  medianFavRate: number | null;
  medianCommentRate: number | null;
  rateN: number;
  /** Favoritos por cada 100 vistas, en conjunto (Σfav ÷ Σvistas × 100). */
  favsPer100Views: number | null;
  commentsPer100Views: number | null;
  medianViewsPerDay: number | null;
  medianAgeDays: number | null;
  nsfwShare: number | null;
  originalShare: number | null;
  fanartShare: number | null;
  unclassifiedShare: number | null;
  medianTagCount: number | null;
}

interface Group {
  key: GroupKey;
  label: string;
  rows: WorkRow[];
  /** Edad exacta (días) de cada obra al medir. */
  exactAge: Map<string, number>;
}

function summarize(g: Group): GroupSummary {
  const r = g.rows;
  const share = (f: (x: WorkRow) => boolean) => (r.length ? r.filter(f).length / r.length : null);
  const rated = r.filter((x) => x.views >= MIN_VIEWS_FOR_RATES);
  const totViews = r.reduce((a, x) => a + x.views, 0);
  const known = r.filter((x) => x.ratingClass !== 'desconocido');
  return {
    key: g.key,
    label: g.label,
    n: r.length,
    medianViews: median(r.map((x) => x.views)),
    meanViews: mean(r.map((x) => x.views)),
    medianFavourites: median(r.map((x) => x.favourites)),
    medianComments: median(r.map((x) => x.comments)),
    medianFavRate: median(rated.map((x) => x.favourites / x.views)),
    medianCommentRate: median(rated.map((x) => x.comments / x.views)),
    rateN: rated.length,
    favsPer100Views: totViews ? (r.reduce((a, x) => a + x.favourites, 0) / totViews) * 100 : null,
    commentsPer100Views: totViews ? (r.reduce((a, x) => a + x.comments, 0) / totViews) * 100 : null,
    medianViewsPerDay: median(r.map((x) => x.viewsPerDay).filter((x): x is number => x !== null)),
    medianAgeDays: median([...g.exactAge.values()]),
    nsfwShare: known.length ? known.filter((x) => x.ratingClass === 'nsfw').length / known.length : null,
    originalShare: share((x) => x.franchises.includes(ORIGINAL)),
    fanartShare: share((x) => x.franchises.some((f) => f !== ORIGINAL)),
    unclassifiedShare: share((x) => !x.franchises.length),
    medianTagCount: median(r.filter((x) => x.tags.length).map((x) => x.tags.length)),
  };
}

export const AGE_BUCKETS = [
  { key: 'h6', label: '< 6 horas', min: 0, max: 0.25 },
  { key: 'd1', label: '6 h – 1 día', min: 0.25, max: 1 },
  { key: 'd7', label: '1 – 7 días', min: 1, max: 7 },
  { key: 'd30', label: '7 – 30 días', min: 7, max: 30 },
  { key: 'd365', label: '1 – 12 meses', min: 30, max: 365 },
  { key: 'old', label: 'Más de 1 año', min: 365, max: Infinity },
] as const;

export interface AgeCell {
  n: number;
  medianViews: number | null;
  /** Vistas ÷ edad exacta en días (sin mínimo de 1 día; edad mínima 15 min). */
  medianViewsPerDay: number | null;
  medianFavourites: number | null;
  lowSample: boolean;
}

export interface AgeBucketRow {
  key: string;
  label: string;
  cells: Partial<Record<GroupKey, AgeCell>>;
}

export interface AgePoint {
  ageDays: number;
  views: number;
  favourites: number;
}

const MIN_AGE_DAYS = 0.25 / 24;

function ageCell(points: AgePoint[]): AgeCell {
  return {
    n: points.length,
    medianViews: median(points.map((p) => p.views)),
    medianViewsPerDay: median(points.map((p) => p.views / Math.max(MIN_AGE_DAYS, p.ageDays))),
    medianFavourites: median(points.map((p) => p.favourites)),
    lowSample: points.length < 5,
  };
}

/**
 * Comparación a igual edad. Para el artista se usa cada snapshot guardado (vistas que tenía la obra a esa edad):
 * por obra y ventana, el último snapshot dentro de la ventana. Para las muestras, la medición única.
 */
export function ageBuckets(groups: { key: GroupKey; points: { id: string; point: AgePoint }[] }[]): AgeBucketRow[] {
  return AGE_BUCKETS.map((b) => {
    const cells: Partial<Record<GroupKey, AgeCell>> = {};
    for (const g of groups) {
      const perWork = new Map<string, AgePoint>();
      for (const { id, point } of g.points)
        if (point.ageDays >= b.min && point.ageDays < b.max) {
          const prev = perWork.get(id);
          if (!prev || point.ageDays > prev.ageDays) perWork.set(id, point);
        }
      cells[g.key] = ageCell([...perWork.values()]);
    }
    return { key: b.key, label: b.label, cells };
  });
}

export interface PercentileRow {
  metric: 'views' | 'favourites' | 'viewsPerDay' | 'favRate';
  label: string;
  benchmark: 'recent' | 'popular';
  artistMedian: number | null;
  benchmarkMedian: number | null;
  /** Percentil de la mediana del artista dentro de la muestra. */
  percentileOfMedian: number | null;
  /** Fracción de obras del artista por encima de la mediana de la muestra. */
  shareAboveMedian: number | null;
  /** Percentil de la mejor obra del artista. */
  percentileOfBest: number | null;
  n: number;
}

const METRIC_LABEL: Record<PercentileRow['metric'], string> = { views: 'Vistas', favourites: 'Favoritos', viewsPerDay: 'Vistas por día', favRate: 'Favoritos ÷ vistas' };

function metricValues(rows: WorkRow[], m: PercentileRow['metric']): number[] {
  if (m === 'favRate') return rows.filter((r) => r.views >= MIN_VIEWS_FOR_RATES).map((r) => r.favourites / r.views);
  if (m === 'viewsPerDay') return rows.map((r) => r.viewsPerDay).filter((x): x is number => x !== null);
  return rows.map((r) => r[m]);
}

export function percentiles(artist: WorkRow[], bench: WorkRow[], key: 'recent' | 'popular'): PercentileRow[] {
  return (['views', 'favourites', 'viewsPerDay', 'favRate'] as const).map((metric) => {
    const a = metricValues(artist, metric);
    const b = metricValues(bench, metric);
    const am = median(a);
    const bm = median(b);
    return {
      metric,
      label: METRIC_LABEL[metric],
      benchmark: key,
      artistMedian: am,
      benchmarkMedian: bm,
      percentileOfMedian: am === null || !b.length ? null : percentileRank(b, am),
      shareAboveMedian: bm === null || !a.length ? null : a.filter((x) => x > bm).length / a.length,
      percentileOfBest: !a.length || !b.length ? null : percentileRank(b, Math.max(...a)),
      n: b.length,
    };
  });
}

/**
 * Índice de rendimiento ajustado por antigüedad: vistas de la obra ÷ mediana de vistas de las obras del mismo artista
 * con edad más parecida (ventana de ~¼ de la galería, entre 11 y 41 obras). 1 = lo normal para su edad; 2 = el doble.
 * Evita que “lo publicado de madrugada” parezca mejor solo porque esas obras son más nuevas (o más viejas).
 */
export function ageAdjustedIndex(rows: WorkRow[], window?: number): Map<string, number> {
  const withAge = rows.filter((r) => r.ageDays !== null).sort((a, b) => a.ageDays! - b.ageDays!);
  const la = withAge.map((r) => Math.log(r.ageDays!));
  const out = new Map<string, number>();
  // Ventana adaptable: ~¼ de la galería, entre 11 y 41 obras.
  const k = Math.min(withAge.length, window ?? Math.max(11, Math.min(41, Math.round(withAge.length / 4))));
  for (let i = 0; i < withAge.length; i++) {
    // Las k obras más cercanas en log(edad) (incluida ella misma), con dos punteros.
    let lo = i;
    let hi = i + 1;
    while (hi - lo < k) {
      if (lo === 0) hi++;
      else if (hi === withAge.length) lo--;
      else if (la[i]! - la[lo - 1]! <= la[hi]! - la[i]!) lo--;
      else hi++;
    }
    const m = median(withAge.slice(lo, hi).map((r) => r.views));
    out.set(withAge[i]!.id, withAge[i]!.views / Math.max(1, m ?? 1));
  }
  return out;
}

export interface ShareRow {
  key: string;
  label: string;
  recentShare: number | null;
  recentCount: number;
  popularShare: number | null;
  popularCount: number;
  artistShare: number | null;
  artistCount: number;
  artistMedianViews: number | null;
  /** Mediana del índice ajustado por antigüedad (1 = lo normal en tu galería para obras de esa edad). */
  artistLift: number | null;
  /** Etiqueta usada para reunir la muestra (su frecuencia ahí es un efecto del muestreo, no una tendencia). */
  sampling?: boolean;
}

function shareTable(
  groups: { key: 'artist' | 'recent' | 'popular'; rows: WorkRow[] }[],
  keysOf: (r: WorkRow) => string[],
  labelOf: (k: string) => string,
  perf: Map<string, number>,
): ShareRow[] {
  const by = new Map<string, ShareRow>();
  const artistViews = new Map<string, number[]>();
  const artistPerf = new Map<string, number[]>();
  for (const g of groups) {
    const counts = new Map<string, number>();
    for (const r of g.rows)
      for (const k of new Set(keysOf(r))) {
        counts.set(k, (counts.get(k) ?? 0) + 1);
        if (g.key === 'artist') {
          (artistViews.get(k) ?? artistViews.set(k, []).get(k)!).push(r.views);
          const idx = perf.get(r.id);
          if (idx !== undefined) (artistPerf.get(k) ?? artistPerf.set(k, []).get(k)!).push(idx);
        }
      }
    for (const [k, c] of counts) {
      const row =
        by.get(k) ??
        by
          .set(k, {
            key: k,
            label: labelOf(k),
            recentShare: null,
            recentCount: 0,
            popularShare: null,
            popularCount: 0,
            artistShare: null,
            artistCount: 0,
            artistMedianViews: null,
            artistLift: null,
          })
          .get(k)!;
      if (g.key === 'recent') row.recentCount = c;
      if (g.key === 'popular') row.popularCount = c;
      if (g.key === 'artist') row.artistCount = c;
    }
  }
  for (const row of by.values()) {
    for (const g of groups) {
      const n = g.rows.length;
      const c = g.key === 'recent' ? row.recentCount : g.key === 'popular' ? row.popularCount : row.artistCount;
      const s = n ? c / n : null;
      if (g.key === 'recent') row.recentShare = s;
      if (g.key === 'popular') row.popularShare = s;
      if (g.key === 'artist') row.artistShare = s;
    }
    const v = artistViews.get(row.key);
    row.artistMedianViews = v ? median(v) : null;
    const pf = artistPerf.get(row.key);
    row.artistLift = pf?.length ? median(pf) : null;
  }
  return [...by.values()];
}

function topPlusArtist(rows: ShareRow[], top: number, cap: number): ShareRow[] {
  const head = rows.slice(0, top);
  const keys = new Set(head.map((r) => r.key));
  const extra = rows.filter((r) => !keys.has(r.key) && r.artistCount >= 5).sort((a, b) => b.artistCount - a.artistCount);
  return [...head, ...extra].slice(0, cap);
}

export interface TimingRow {
  key: string;
  label: string;
  artistCount: number;
  artistShare: number | null;
  artistMedianViews: number | null;
  artistMedianViewsPerDay: number | null;
  /** Mediana del índice ajustado por antigüedad de tus obras en esa franja. */
  artistIndex: number | null;
  popularShare: number | null;
  recentShare: number | null;
}

export const DAY_BLOCKS = [
  { key: 'madrugada', label: 'Madrugada (0–5 h)', from: 0, to: 5 },
  { key: 'manana', label: 'Mañana (6–11 h)', from: 6, to: 11 },
  { key: 'tarde', label: 'Tarde (12–17 h)', from: 12, to: 17 },
  { key: 'noche', label: 'Noche (18–23 h)', from: 18, to: 23 },
] as const;

const WEEKDAY_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function timingTable(groups: { key: 'artist' | 'recent' | 'popular'; rows: WorkRow[] }[], tz: string, kind: 'weekday' | 'block', perf: Map<string, number>): TimingRow[] {
  const slots = kind === 'weekday' ? WEEKDAY_LABEL.map((label, i) => ({ key: String(i), label })) : DAY_BLOCKS.map((b) => ({ key: b.key, label: b.label }));
  const slotOf = (r: WorkRow): string | null => {
    if (!r.publishedAt) return null;
    const p = localParts(r.publishedAt, tz);
    if (kind === 'weekday') return String(p.weekday);
    return DAY_BLOCKS.find((b) => p.hour >= b.from && p.hour <= b.to)?.key ?? null;
  };
  const per = new Map<string, Map<string, WorkRow[]>>();
  for (const g of groups) {
    const m = new Map<string, WorkRow[]>();
    for (const r of g.rows) {
      const s = slotOf(r);
      if (s !== null) (m.get(s) ?? m.set(s, []).get(s)!).push(r);
    }
    per.set(g.key, m);
  }
  const shareOf = (g: string, slot: string) => {
    const m = per.get(g);
    if (!m) return null;
    const tot = [...m.values()].reduce((a, x) => a + x.length, 0);
    return tot ? (m.get(slot)?.length ?? 0) / tot : null;
  };
  return slots.map((s) => {
    const a = per.get('artist')?.get(s.key) ?? [];
    return {
      key: s.key,
      label: s.label,
      artistCount: a.length,
      artistShare: shareOf('artist', s.key),
      artistMedianViews: median(a.map((r) => r.views)),
      artistMedianViewsPerDay: median(a.map((r) => r.viewsPerDay).filter((x): x is number => x !== null)),
      artistIndex: median(a.map((r) => perf.get(r.id)).filter((x): x is number => x !== undefined)),
      popularShare: shareOf('popular', s.key),
      recentShare: shareOf('recent', s.key),
    };
  });
}

export interface RatingMix {
  key: GroupKey;
  label: string;
  n: number;
  sfw: number;
  nsfw: number;
  nsfwShare: number | null;
  sfwMedianViews: number | null;
  nsfwMedianViews: number | null;
}

export interface Advice {
  id: string;
  area: 'etiquetas' | 'franquicias' | 'horario' | 'clasificación' | 'interacción' | 'constancia' | 'alcance';
  title: string;
  text: string;
  evidence: { label: string; value: string }[];
  confidence: Confidence;
  /** Menor tamaño de muestra entre las cifras usadas. */
  n: number;
  /** Prioridad (mayor = más importante): tamaño del efecto × confianza. */
  score: number;
  tone: 'fortaleza' | 'oportunidad' | 'alerta' | 'info';
}

export interface Contrast {
  generatedAt: string;
  username: string;
  timezone: string;
  scope: string;
  recent: { run: BenchmarkRun; extras: SampleExtras } | null;
  popular: { run: BenchmarkRun; extras: SampleExtras } | null;
  summary: GroupSummary[];
  ageBuckets: AgeBucketRow[];
  artistEarlyPoints: number;
  percentiles: PercentileRow[];
  tags: ShareRow[];
  franchises: ShareRow[];
  characters: ShareRow[];
  timing: { weekdays: TimingRow[]; blocks: TimingRow[] };
  ratingMix: RatingMix[];
  ratingTest: {
    views: ReturnType<typeof mannWhitney>;
    viewsPerDay: ReturnType<typeof mannWhitney>;
    /** Sobre el índice ajustado por antigüedad (compara obras de edad parecida). */
    index: ReturnType<typeof mannWhitney>;
    nsfwIndex: number | null;
    sfwIndex: number | null;
  } | null;
  cadence: { months: number; spearman: number | null; last90Days: number; perMonth: { month: string; count: number; medianViewsPerDay: number | null }[] };
  advice: Advice[];
  notes: string[];
}

export interface ContrastInput {
  username: string;
  artistWorks: DeviationWithMetrics[];
  artistSnapshots: { id: string; takenAt: string; views: number; favourites: number; comments: number }[];
  recent: { run: BenchmarkRun; items: BenchmarkItem[]; extras: SampleExtras } | null;
  popular: { run: BenchmarkRun; items: BenchmarkItem[]; extras: SampleExtras } | null;
  compiled: Compiled;
  scope?: string;
  now?: Date;
  tz?: string;
}

const BENCH_LABEL = (kind: BenchmarkKind, scope: string) => `${KIND_LABEL[kind]}${scope !== 'general' ? ` · #${scope}` : ''}`;

export function buildContrast(input: ContrastInput): Contrast {
  const tz = input.tz ?? TIMEZONE;
  const now = input.now ?? new Date();
  const artistRows = toWorkRows(input.artistWorks, now);
  const exactAgeOf = (rows: WorkRow[], at: Date) =>
    new Map(rows.filter((r) => r.publishedAt).map((r) => [r.id, Math.max(0, (at.getTime() - Date.parse(r.publishedAt!)) / DAY_MS)]));

  const scope = input.scope ?? input.popular?.run.scope ?? input.recent?.run.scope ?? 'general';
  const groups: Group[] = [{ key: 'artist', label: `@${input.username}`, rows: artistRows, exactAge: exactAgeOf(artistRows, now) }];
  if (scope !== 'general') {
    const sub = artistRows.filter(
      (r) => r.tags.some((t) => compactKey(t) === scope) || r.franchises.some((f) => compactKey(f) === scope) || r.characters.some((c) => compactKey(c) === scope),
    );
    if (sub.length) groups.push({ key: 'artistScoped', label: `@${input.username} · #${scope}`, rows: sub, exactAge: exactAgeOf(sub, now) });
  }
  const bench: Partial<Record<'recent' | 'popular', WorkRow[]>> = {};
  const benchPoints: { key: GroupKey; points: { id: string; point: AgePoint }[] }[] = [];
  for (const kind of ['recent', 'popular'] as const) {
    const b = input[kind];
    if (!b) continue;
    const at = measuredAt(b.items, b.run);
    const rows = toWorkRows(benchmarkWorks(b.items, input.compiled), at);
    bench[kind] = rows;
    groups.push({ key: kind, label: BENCH_LABEL(kind, b.run.scope), rows, exactAge: exactAgeOf(rows, at) });
    benchPoints.push({
      key: kind,
      points: b.items
        .filter((i) => i.publishedAt)
        .map((i) => ({
          id: i.id,
          point: { ageDays: Math.max(0, (Date.parse(i.measuredAt) - Date.parse(i.publishedAt!)) / DAY_MS), views: i.views, favourites: i.favourites },
        })),
    });
  }
  const summary = groups.map(summarize);

  // Edad a igual ventana: snapshots del artista.
  const pubOf = new Map(input.artistWorks.filter((w) => w.publishedAt).map((w) => [w.id, Date.parse(w.publishedAt!)]));
  const artistPoints = input.artistSnapshots
    .filter((s) => pubOf.has(s.id))
    .map((s) => ({ id: s.id, point: { ageDays: Math.max(0, (Date.parse(s.takenAt) - pubOf.get(s.id)!) / DAY_MS), views: s.views, favourites: s.favourites } }));
  const buckets = ageBuckets([{ key: 'artist', points: artistPoints }, ...benchPoints]);
  const artistEarlyPoints = new Set(artistPoints.filter((p) => p.point.ageDays < 1).map((p) => p.id)).size;

  const pcts: PercentileRow[] = [];
  for (const kind of ['popular', 'recent'] as const) if (bench[kind]) pcts.push(...percentiles(artistRows, bench[kind]!, kind));

  const perf = ageAdjustedIndex(artistRows);
  const shareGroups = [
    { key: 'artist' as const, rows: artistRows },
    ...(['recent', 'popular'] as const).filter((k) => bench[k]).map((k) => ({ key: k, rows: bench[k]! })),
  ];
  const tagLabels = new Map<string, string>();
  const tagKeys = (r: WorkRow) =>
    r.tags.map((t) => {
      const k = compactKey(t);
      if (!tagLabels.has(k)) tagLabels.set(k, t.toLowerCase());
      return k;
    }).filter(Boolean);
  const sortShares = (rows: ShareRow[]) =>
    rows.sort((a, b) => (b.popularShare ?? 0) + (b.recentShare ?? 0) - ((a.popularShare ?? 0) + (a.recentShare ?? 0)) || (b.artistShare ?? 0) - (a.artistShare ?? 0));
  const samplingTags = new Set([...(scope === 'general' ? GENERAL_TAGS : [scope]), ...[input.recent?.run.scope, input.popular?.run.scope].filter((x): x is string => !!x && x !== 'general')]);
  if ((input.recent?.run.scope ?? 'general') === 'general' || (input.popular?.run.scope ?? 'general') === 'general') for (const t of GENERAL_TAGS) samplingTags.add(t);
  const tags = sortShares(shareTable(shareGroups, tagKeys, (k) => tagLabels.get(k) ?? k, perf))
    .filter((r) => r.recentCount + r.popularCount >= 2 || r.artistCount >= 5)
    .map((r) => (samplingTags.has(r.key) ? { ...r, sampling: true } : r));
  const franchises = sortShares(shareTable(shareGroups, (r) => (r.franchises.length ? r.franchises : [UNCLASSIFIED]), (k) => k, perf));
  const characters = sortShares(shareTable(shareGroups, (r) => r.characters, (k) => k, perf)).filter((r) => r.recentCount + r.popularCount + r.artistCount >= 2);

  const timing = { weekdays: timingTable(shareGroups, tz, 'weekday', perf), blocks: timingTable(shareGroups, tz, 'block', perf) };

  const ratingMix: RatingMix[] = groups.map((g) => {
    const sfw = g.rows.filter((r) => r.ratingClass === 'sfw');
    const nsfw = g.rows.filter((r) => r.ratingClass === 'nsfw');
    return {
      key: g.key,
      label: g.label,
      n: g.rows.length,
      sfw: sfw.length,
      nsfw: nsfw.length,
      nsfwShare: sfw.length + nsfw.length ? nsfw.length / (sfw.length + nsfw.length) : null,
      sfwMedianViews: median(sfw.map((r) => r.views)),
      nsfwMedianViews: median(nsfw.map((r) => r.views)),
    };
  });
  const aSfw = artistRows.filter((r) => r.ratingClass === 'sfw');
  const aNsfw = artistRows.filter((r) => r.ratingClass === 'nsfw');
  const ratingTest =
    aSfw.length >= 5 && aNsfw.length >= 5
      ? (() => {
          const idx = (rows: WorkRow[]) => rows.map((r) => perf.get(r.id)).filter((x): x is number => x !== undefined);
          return {
            views: mannWhitney(aNsfw.map((r) => r.views), aSfw.map((r) => r.views)),
            viewsPerDay: mannWhitney(aNsfw.map((r) => r.viewsPerDay ?? 0), aSfw.map((r) => r.viewsPerDay ?? 0)),
            index: mannWhitney(idx(aNsfw), idx(aSfw)),
            nsfwIndex: median(idx(aNsfw)),
            sfwIndex: median(idx(aSfw)),
          };
        })()
      : null;

  // Constancia: obras por mes vs. vistas por día medianas de ese mes (vistas/día reduce el sesgo por antigüedad).
  const months = new Map<string, WorkRow[]>();
  for (const r of artistRows)
    if (r.publishedAt) {
      const p = localParts(r.publishedAt, tz);
      const k = `${p.year}-${p.month}`;
      (months.get(k) ?? months.set(k, []).get(k)!).push(r);
    }
  const perMonth = [...months]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => ({ month, count: rows.length, medianViewsPerDay: median(rows.map((r) => r.viewsPerDay).filter((x): x is number => x !== null)) }));
  const cm = perMonth.filter((m) => m.medianViewsPerDay !== null);
  const cadence = {
    months: cm.length,
    spearman: cm.length >= 6 ? spearman(cm.map((m) => m.count), cm.map((m) => m.medianViewsPerDay!)) : null,
    last90Days: artistRows.filter((r) => r.publishedAt && now.getTime() - Date.parse(r.publishedAt) <= 90 * DAY_MS).length,
    perMonth,
  };

  const notes: string[] = [];
  if (input.popular) notes.push(...input.popular.extras.notes.slice(0, 1));
  if (input.recent) notes.push(...input.recent.extras.notes.slice(0, 1));
  notes.push(
    'Vistas por día = vistas ÷ días desde la publicación (mínimo 1 día). Las obras con años acumulan vistas de forma distinta a las nuevas: para comparar a igual edad usa la tabla por antigüedad.',
  );

  const base: Omit<Contrast, 'advice'> = {
    generatedAt: new Date().toISOString(),
    username: input.username,
    timezone: tz,
    scope,
    recent: input.recent ? { run: input.recent.run, extras: input.recent.extras } : null,
    popular: input.popular ? { run: input.popular.run, extras: input.popular.extras } : null,
    summary,
    ageBuckets: buckets,
    artistEarlyPoints,
    percentiles: pcts,
    // Lo más presente en las muestras + todo lo que el artista usa en ≥5 obras (sus fuertes no deben quedar fuera).
    tags: topPlusArtist(tags, 60, 140),
    franchises: topPlusArtist(franchises, 40, 100),
    characters: topPlusArtist(characters, 40, 100),
    timing,
    ratingMix,
    ratingTest,
    cadence,
    notes,
  };
  return { ...base, advice: buildAdvice(base, tags, franchises) };
}

// ───────────────────────────── Consejos ─────────────────────────────

const x2 = (r: number) => `${r.toFixed(1).replace('.', ',')}×`;
const effect = (ratio: number) => Math.min(3, Math.abs(Math.log2(Math.max(ratio, 1e-6))));

/** Reglas explícitas. Cada regla solo se activa con muestra suficiente y muestra sus cifras. */
export function buildAdvice(c: Omit<Contrast, 'advice'>, allTags: ShareRow[] = c.tags, allFranchises: ShareRow[] = c.franchises): Advice[] {
  const out: Advice[] = [];
  const push = (a: Omit<Advice, 'confidence' | 'score'> & { effect: number }) => {
    const confidence = confidenceFor(a.n);
    const { effect: e, ...rest } = a;
    out.push({ ...rest, confidence, score: Math.round(e * CONF_WEIGHT[confidence] * 100) / 100 });
  };
  const artist = c.summary.find((s) => s.key === 'artist')!;
  const pop = c.summary.find((s) => s.key === 'popular') ?? null;
  const rec = c.summary.find((s) => s.key === 'recent') ?? null;
  if (!artist.n) return out;

  // 1. Franquicias fuertes del artista (sobre su propia mediana) y su presencia en las muestras.
  for (const f of allFranchises) {
    if (f.key === UNCLASSIFIED || f.artistCount < 5 || f.artistLift === null) continue;
    const ev = [
      { label: `Rendimiento de ${f.label}`, value: `${x2(f.artistLift)} lo normal para su edad (${f.artistCount} obras)` },
      { label: `Mediana de vistas con ${f.label}`, value: fmt(f.artistMedianViews) },
      { label: 'Tu mediana general', value: fmt(artist.medianViews) },
    ];
    if (pop) ev.push({ label: 'Presencia en Populares', value: `${pct(f.popularShare ?? 0)} (${f.popularCount} de ${pop.n})` });
    if (rec) ev.push({ label: 'Presencia en Recientes', value: `${pct(f.recentShare ?? 0)} (${f.recentCount} de ${rec.n})` });
    if (f.artistLift >= 1.5) {
      const saturated = rec && (f.recentShare ?? 0) >= 0.05 && (f.popularShare ?? 0) < (f.recentShare ?? 0) / 2;
      push({
        id: `franquicia-fuerte-${compactKey(f.key)}`,
        area: 'franquicias',
        tone: 'fortaleza',
        title: `${f.label} es de tus temas más fuertes`,
        text:
          `Tus obras de ${f.label} reciben ${x2(f.artistLift)} las vistas de tus obras de edad parecida (mediana). ` +
          (saturated
            ? 'Pero en Recientes se sube mucho más de lo que aparece en Populares: destaca con personajes o enfoques menos repetidos.'
            : 'Seguir publicando ahí (y enlazarlo desde obras menos vistas) es una apuesta con respaldo en tus propios datos.'),
        evidence: ev,
        n: f.artistCount,
        effect: effect(f.artistLift) * 1.2,
      });
    } else if (f.artistLift <= 0.6 && (f.artistShare ?? 0) >= 0.1) {
      push({
        id: `franquicia-baja-${compactKey(f.key)}`,
        area: 'franquicias',
        tone: 'alerta',
        title: `${f.label} rinde por debajo de tu mediana`,
        text: `Es una parte grande de tu galería (${pct(f.artistShare)}), pero recibe ${x2(f.artistLift)} las vistas de tus obras de edad parecida. Si tu meta es alcance, combínala con temas que te rinden más (por ejemplo, en la misma obra o serie) o mejora su presentación (título, miniatura, etiquetas).`,
        evidence: ev,
        n: f.artistCount,
        effect: effect(f.artistLift) * 0.8,
      });
    }
  }

  // 2. Franquicias en tendencia que el artista no trabaja.
  if (pop) {
    for (const f of allFranchises) {
      if (f.key === UNCLASSIFIED || f.key === ORIGINAL || f.popularCount < 3 || (f.popularShare ?? 0) < 0.05 || (f.artistShare ?? 0) >= 0.02) continue;
      push({
        id: `franquicia-hueco-${compactKey(f.key)}`,
        area: 'franquicias',
        tone: 'oportunidad',
        title: `${f.label} aparece en Populares y casi no está en tu galería`,
        text: `${pct(f.popularShare)} de la muestra Populares es de ${f.label}; tú tienes ${f.artistCount} obra(s). Si encaja con tu estilo, una pieza de prueba te dirá si tu público también responde.`,
        evidence: [
          { label: 'En Populares', value: `${f.popularCount} de ${pop.n} (${pct(f.popularShare)})` },
          ...(rec ? [{ label: 'En Recientes', value: `${f.recentCount} de ${rec.n} (${pct(f.recentShare ?? 0)})` }] : []),
          { label: 'En tu galería', value: `${f.artistCount} de ${artist.n}` },
        ],
        n: f.popularCount * 3,
        effect: Math.min(2, (f.popularShare ?? 0) * 10),
      });
    }
  }

  // 3. Etiquetas: huecos (frecuentes en las muestras, ausentes en tu galería) y fortalezas.
  const gapTags = allTags
    .filter((t) => !t.sampling)
    .filter((t) => {
      const inPop = pop ? t.popularCount >= 3 && (t.popularShare ?? 0) >= 0.08 : false;
      const inRec = rec ? t.recentCount >= 3 && (t.recentShare ?? 0) >= 0.1 : false;
      return (inPop || inRec) && (t.artistShare ?? 0) < 0.05;
    })
    .sort((a, b) => (b.popularShare ?? 0) + (b.recentShare ?? 0) - ((a.popularShare ?? 0) + (a.recentShare ?? 0)))
    .slice(0, 8);
  if (gapTags.length) {
    const n = Math.min(...gapTags.map((t) => Math.max(t.popularCount, t.recentCount))) * 3;
    push({
      id: 'etiquetas-hueco',
      area: 'etiquetas',
      tone: 'oportunidad',
      title: 'Etiquetas frecuentes en tendencia que casi no usas',
      text: `Úsalas solo cuando describan la obra (DeviantArt busca por etiquetas): ${gapTags.map((t) => `#${t.label}`).join(', ')}. No se cuentan las etiquetas con las que se reunió la muestra.`,
      evidence: gapTags.slice(0, 5).map((t) => ({
        label: `#${t.label}`,
        value: [pop ? `Populares ${pct(t.popularShare ?? 0)}` : '', rec ? `Recientes ${pct(t.recentShare ?? 0)}` : '', `tú ${pct(t.artistShare ?? 0)}`].filter(Boolean).join(' · '),
      })),
      n,
      effect: 1 + Math.min(1, gapTags.length / 8),
    });
  }
  const strongTags = allTags
    .filter((t) => t.artistCount >= 5 && (t.artistLift ?? 0) >= 1.5)
    .sort((a, b) => (b.artistLift ?? 0) - (a.artistLift ?? 0))
    .slice(0, 5);
  if (strongTags.length)
    push({
      id: 'etiquetas-fuertes',
      area: 'etiquetas',
      tone: 'fortaleza',
      title: 'Tus etiquetas que más rinden',
      text: `Tus obras con estas etiquetas reciben bastante más vistas que tus obras de edad parecida: ${strongTags.map((t) => `#${t.label}`).join(', ')}. Son buen punto de partida para nuevas piezas o series.`,
      evidence: strongTags.map((t) => ({
        label: `#${t.label}`,
        value: `${x2(t.artistLift!)} lo normal · ${t.artistCount} obras${pop ? ` · Populares ${pct(t.popularShare ?? 0)}` : ''}`,
      })),
      n: Math.min(...strongTags.map((t) => t.artistCount)),
      effect: effect(strongTags[0]!.artistLift!),
    });

  // 4. Cantidad de etiquetas.
  const ref = pop?.medianTagCount ? pop : rec?.medianTagCount ? rec : null;
  if (ref && artist.medianTagCount !== null && ref.medianTagCount) {
    const ratio = artist.medianTagCount / ref.medianTagCount;
    if (ratio < 0.7)
      push({
        id: 'etiquetas-cantidad',
        area: 'etiquetas',
        tone: 'oportunidad',
        title: 'Usas menos etiquetas que las obras en tendencia',
        text: `Tus obras llevan una mediana de ${fmt(artist.medianTagCount)} etiquetas; en ${ref.label} la mediana es ${fmt(ref.medianTagCount)}. Más etiquetas relevantes (personaje, franquicia, técnica, tema) = más búsquedas en las que aparecer.`,
        evidence: [
          { label: 'Tu mediana de etiquetas', value: fmt(artist.medianTagCount) },
          { label: `Mediana en ${ref.label}`, value: fmt(ref.medianTagCount) },
        ],
        n: Math.min(artist.n, ref.n),
        effect: effect(ratio),
      });
  }

  // 5. Clasificación SFW / NSFW.
  const am = c.ratingMix.find((r) => r.key === 'artist')!;
  const pm = c.ratingMix.find((r) => r.key === 'popular');
  const rm = c.ratingMix.find((r) => r.key === 'recent');
  const rt = c.ratingTest;
  if (am.nsfw >= 5 && am.sfw >= 5 && rt && rt.nsfwIndex !== null && rt.sfwIndex) {
    // Decisión con el índice ajustado por antigüedad (las cifras brutas se muestran como contexto).
    const ratio = rt.nsfwIndex / rt.sfwIndex;
    const p = rt.index?.p ?? null;
    const ev = [
      { label: 'NSFW (edad parecida)', value: `${x2(rt.nsfwIndex)} lo normal · mediana ${fmt(am.nsfwMedianViews)} vistas (${am.nsfw} obras)` },
      { label: 'SFW (edad parecida)', value: `${x2(rt.sfwIndex)} lo normal · mediana ${fmt(am.sfwMedianViews)} vistas (${am.sfw} obras)` },
      ...(p !== null ? [{ label: 'Mann–Whitney (ajustado)', value: pval(p) }] : []),
      ...(pm ? [{ label: 'NSFW en Populares (sin sesión)', value: pct(pm.nsfwShare ?? 0) }] : []),
      ...(rm ? [{ label: 'NSFW en Recientes', value: pct(rm.nsfwShare ?? 0) }] : []),
    ];
    const signif = p !== null && p < 0.05;
    if (ratio >= 1.3 && signif)
      push({
        id: 'clasificacion-nsfw',
        area: 'clasificación',
        tone: 'info',
        title: 'Lo NSFW te rinde más, pero no llega a quien no inicia sesión',
        text: `A igual edad, tu NSFW recibe ${x2(ratio)} las vistas de tu SFW (medianas brutas: ${fmt(am.nsfwMedianViews)} vs. ${fmt(am.sfwMedianViews)}). DeviantArt oculta el contenido maduro a visitantes sin sesión (por eso Populares tiene ${pct(pm?.nsfwShare ?? 0)} NSFW${rm ? ` y Recientes ${pct(rm.nsfwShare ?? 0)}` : ''}). Para ganar alcance nuevo, publica versiones o avances SFW que lleven a la obra completa.`,
        evidence: ev,
        n: Math.min(am.nsfw, am.sfw),
        effect: effect(ratio),
      });
    else if (!signif && am.nsfw / (am.nsfw + am.sfw) >= 0.3 && pm && (pm.nsfwShare ?? 0) < 0.05)
      push({
        id: 'clasificacion-alcance',
        area: 'clasificación',
        tone: 'oportunidad',
        title: 'NSFW y SFW te rinden igual, pero solo lo SFW llega a visitantes sin sesión',
        text: `A igual edad no hay diferencia clara entre tu NSFW y tu SFW (${x2(rt.nsfwIndex)} vs. ${x2(rt.sfwIndex)} lo normal; ${p !== null ? pval(p) : 'sin prueba'}), aunque las medianas brutas (${fmt(am.nsfwMedianViews)} vs. ${fmt(am.sfwMedianViews)}) parezcan decir otra cosa: tus obras recientes tienen más vistas y son mayormente NSFW. El ${pct(am.nsfw / (am.nsfw + am.sfw), 0)} de tu galería es NSFW y DeviantArt lo oculta a quien no inicia sesión (Populares: ${pct(pm.nsfwShare ?? 0)} NSFW). Publicar más piezas SFW, o versiones SFW de las NSFW, amplía el público sin costo aparente.`,
        evidence: ev,
        n: Math.min(am.nsfw, am.sfw),
        effect: 1 + am.nsfw / (am.nsfw + am.sfw),
      });
    else if (ratio <= 0.77 && signif)
      push({
        id: 'clasificacion-sfw',
        area: 'clasificación',
        tone: 'info',
        title: 'Lo SFW te rinde más',
        text: `A igual edad, tu SFW recibe ${x2(1 / ratio)} las vistas de tu NSFW y además puede aparecer para visitantes sin sesión. Priorízalo si buscas alcance.`,
        evidence: ev,
        n: Math.min(am.nsfw, am.sfw),
        effect: effect(ratio),
      });
  }

  // 6. Interacción: mediana de favoritos ÷ vistas por obra (robusta frente a las obras virales).
  if (pop && artist.medianFavRate !== null && pop.medianFavRate && artist.rateN >= 10 && pop.rateN >= 10) {
    const ratio = artist.medianFavRate / pop.medianFavRate;
    const recOk = rec && rec.rateN >= 10 && rec.medianFavRate ? rec : null;
    const ev = [
      { label: 'Tu mediana favoritos ÷ vistas', value: `${pct(artist.medianFavRate, 2)} (${artist.rateN} obras con ≥${MIN_VIEWS_FOR_RATES} vistas)` },
      { label: 'Mediana en Populares', value: `${pct(pop.medianFavRate, 2)} (${pop.rateN})` },
      ...(recOk ? [{ label: 'Mediana en Recientes', value: `${pct(recOk.medianFavRate, 2)} (${recOk.rateN})` }] : []),
    ];
    const caveat = 'Ojo: las obras con cientos de miles de vistas llegan a mucho público casual y suelen tener tasas más bajas.';
    if (ratio >= 1.25)
      push({
        id: 'interaccion-alta',
        area: 'interacción',
        tone: 'fortaleza',
        title: 'Conviertes vistas en favoritos mejor que Populares',
        text: `Tu obra típica convierte ${pct(artist.medianFavRate, 2)} de sus vistas en favoritos (${x2(ratio)} Populares${recOk ? `; ${x2(artist.medianFavRate / recOk.medianFavRate!)} Recientes` : ''}): quien te encuentra, te valora. Lo que más te puede crecer es el alcance (etiquetas, temas en tendencia, versiones SFW). ${caveat}`,
        evidence: ev,
        n: Math.min(artist.rateN, pop.rateN),
        effect: effect(ratio) * 0.6,
      });
    else if (ratio <= 0.8)
      push({
        id: 'interaccion-baja',
        area: 'interacción',
        tone: 'alerta',
        title: 'Conviertes menos vistas en favoritos que Populares',
        text: `Tu obra típica convierte ${pct(artist.medianFavRate, 2)} de sus vistas en favoritos (${x2(ratio)} Populares). Miniaturas más claras, títulos descriptivos y pedir la opinión en la descripción suelen ayudar.`,
        evidence: ev,
        n: Math.min(artist.rateN, pop.rateN),
        effect: effect(ratio),
      });
  }
  if (pop && artist.commentsPer100Views !== null && pop.commentsPer100Views && artist.commentsPer100Views / pop.commentsPer100Views <= 0.6)
    push({
      id: 'interaccion-comentarios',
      area: 'interacción',
      tone: 'oportunidad',
      title: 'Pocos comentarios por vista',
      text: `Tienes ${fmt(artist.commentsPer100Views, 2)} comentarios por 100 vistas frente a ${fmt(pop.commentsPer100Views, 2)} en Populares. Responder comentarios y cerrar la descripción con una pregunta invita a conversar.`,
      evidence: [
        { label: 'Tus comentarios por 100 vistas', value: fmt(artist.commentsPer100Views, 2) },
        { label: 'Populares', value: fmt(pop.commentsPer100Views, 2) },
      ],
      n: Math.min(artist.n, pop.n),
      effect: effect(artist.commentsPer100Views / pop.commentsPer100Views) * 0.7,
    });

  // 7. Horario: día de la semana y franja horaria del artista (con su propia mediana de vistas por día).
  const bestSlot = (rows: TimingRow[], what: string) => {
    const ok = rows.filter((r) => r.artistCount >= 5 && r.artistIndex !== null);
    if (ok.length < 2) return;
    const sorted = [...ok].sort((a, b) => b.artistIndex! - a.artistIndex!);
    const best = sorted[0]!;
    const worst = sorted[sorted.length - 1]!;
    const ratio = best.artistIndex! / Math.max(1e-9, worst.artistIndex!);
    if (ratio < 1.3) return;
    const where = what === 'dia' ? `los ${best.label.toLowerCase()}` : `en la ${best.label.toLowerCase()}`;
    push({
      id: `horario-${what}`,
      area: 'horario',
      tone: 'oportunidad',
      title: `${what === 'dia' ? 'Día' : 'Franja'} con mejor rendimiento: ${best.label.toLowerCase()}`,
      text: `Comparadas con tus obras de edad parecida, las que publicaste ${where} (hora de Bogotá) reciben ${x2(best.artistIndex!)} lo normal, frente a ${x2(worst.artistIndex!)} ${what === 'dia' ? `los ${worst.label.toLowerCase()}` : `en la ${worst.label.toLowerCase()}`}. Hoy publicas ahí el ${pct(best.artistShare)} de tus obras. Es una correlación: pruébalo unas semanas y compara.`,
      evidence: [
        { label: best.label, value: `${x2(best.artistIndex!)} lo normal (${best.artistCount} obras)` },
        { label: worst.label, value: `${x2(worst.artistIndex!)} lo normal (${worst.artistCount} obras)` },
        ...(best.popularShare !== null ? [{ label: `${best.label} en Populares`, value: pct(best.popularShare) }] : []),
      ],
      n: Math.min(best.artistCount, worst.artistCount),
      effect: effect(ratio) * 0.8,
    });
  };
  bestSlot(c.timing.weekdays, 'dia');
  bestSlot(c.timing.blocks, 'franja');

  // 8. Constancia.
  if (c.cadence.spearman !== null && c.cadence.months >= 8 && Math.abs(c.cadence.spearman) >= 0.3) {
    const pos = c.cadence.spearman > 0;
    push({
      id: 'constancia',
      area: 'constancia',
      tone: pos ? 'oportunidad' : 'info',
      title: pos ? 'Los meses con más publicaciones rinden más por obra' : 'Publicar mucho en un mes reparte las vistas',
      text: pos
        ? `En tu historial, cuantas más obras publicas en un mes, más vistas por día recibe cada una (Spearman ρ = ${fmt(c.cadence.spearman, 2)} en ${c.cadence.months} meses). Mantener un ritmo estable ayuda a que el público vuelva. En los últimos 90 días publicaste ${c.cadence.last90Days} obra(s).`
        : `En tu historial, los meses con muchas obras tienen menos vistas por día por obra (ρ = ${fmt(c.cadence.spearman, 2)} en ${c.cadence.months} meses). Espaciar las publicaciones puede darle más tiempo de visibilidad a cada una.`,
      evidence: [
        { label: 'Spearman (obras/mes vs. vistas/día)', value: fmt(c.cadence.spearman, 2) },
        { label: 'Meses con datos', value: String(c.cadence.months) },
        { label: 'Obras en los últimos 90 días', value: String(c.cadence.last90Days) },
      ],
      n: c.cadence.months,
      effect: Math.abs(c.cadence.spearman) * 2,
    });
  } else if (c.cadence.last90Days === 0 && artist.n >= 10)
    push({
      id: 'constancia-inactivo',
      area: 'constancia',
      tone: 'alerta',
      title: 'Sin publicaciones en los últimos 90 días',
      text: 'Las obras nuevas son las que más se muestran en Recientes y en los seguidores: retomar un ritmo (aunque sea bajo) mantiene activo el perfil.',
      evidence: [{ label: 'Obras en los últimos 90 días', value: '0' }],
      n: artist.n,
      effect: 1,
    });

  // 9. Alcance: posición del artista dentro de las muestras.
  const vpd = c.percentiles.find((p) => p.benchmark === 'popular' && p.metric === 'viewsPerDay');
  if (vpd && vpd.percentileOfMedian !== null && vpd.artistMedian !== null && vpd.benchmarkMedian)
    push({
      id: 'alcance-populares',
      area: 'alcance',
      tone: 'info',
      title: `Tu obra típica está en el percentil ${Math.round(vpd.percentileOfMedian)} de Populares`,
      text: `Mediana de vistas por día: tú ${fmt(vpd.artistMedian, 1)}, Populares ${fmt(vpd.benchmarkMedian, 1)}. ${pct(vpd.shareAboveMedian ?? 0, 0)} de tus obras supera la mediana de Populares; tu mejor obra llega al percentil ${Math.round(vpd.percentileOfBest ?? 0)}. Usa esas obras destacadas como portada de tu perfil y enlázalas desde las nuevas.`,
      evidence: [
        { label: 'Tu mediana vistas/día', value: fmt(vpd.artistMedian, 1) },
        { label: 'Mediana Populares', value: fmt(vpd.benchmarkMedian, 1) },
        { label: 'Percentil de tu mejor obra', value: fmt(vpd.percentileOfBest, 0) },
      ],
      n: vpd.n,
      effect: 0.6,
    });
  const early = c.ageBuckets.find((b) => b.key === 'd1');
  const ea = early?.cells.artist;
  const er = early?.cells.recent;
  if (ea && er && ea.n >= 3 && er.n >= 5 && ea.medianViewsPerDay !== null && er.medianViewsPerDay) {
    const ratio = ea.medianViewsPerDay / er.medianViewsPerDay;
    push({
      id: 'alcance-primer-dia',
      area: 'alcance',
      tone: ratio >= 1 ? 'fortaleza' : 'oportunidad',
      title: ratio >= 1 ? 'Arrancas mejor que una obra nueva típica' : 'Tu primer día está por debajo de una obra nueva típica',
      text: `Entre 6 h y 1 día de publicadas, tus obras ganan ${fmt(ea.medianViewsPerDay, 1)} vistas/día frente a ${fmt(er.medianViewsPerDay, 1)} en Recientes (${x2(ratio)}). ${ratio >= 1 ? 'Tus seguidores responden rápido.' : 'Compartir la obra en grupos y redes el mismo día ayuda a ese arranque.'}`,
      evidence: [
        { label: 'Tus obras (6 h – 1 día)', value: `${fmt(ea.medianViewsPerDay, 1)} vistas/día (${ea.n})` },
        { label: 'Recientes (6 h – 1 día)', value: `${fmt(er.medianViewsPerDay, 1)} vistas/día (${er.n})` },
      ],
      n: Math.min(ea.n, er.n),
      effect: effect(ratio) * 0.8,
    });
  } else if (c.recent && c.artistEarlyPoints < 3)
    push({
      id: 'alcance-medir-temprano',
      area: 'alcance',
      tone: 'info',
      title: 'Aún no hay datos de tus primeras horas',
      text: 'Para comparar tu arranque con Recientes a igual edad, sincroniza tu galería el mismo día en que publicas (la sincronización automática diaria también sirve).',
      evidence: [{ label: 'Obras tuyas medidas antes de cumplir 1 día', value: String(c.artistEarlyPoints) }],
      n: 1,
      effect: 0.3,
    });

  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
