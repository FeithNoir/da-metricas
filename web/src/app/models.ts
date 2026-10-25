export type SyncStatus = 'running' | 'ok' | 'partial' | 'error' | 'not_found' | 'empty';

export interface SyncRecord {
  id: number;
  username: string;
  startedAt: string;
  finishedAt: string | null;
  status: SyncStatus;
  phase: string;
  found: number;
  processed: number;
  failed: number;
  message: string | null;
}

export interface Artist {
  username: string;
  displayName: string;
  avatar: string | null;
  galleryTotal: number | null;
  autoSync: boolean;
  createdAt: string;
  lastSyncAt: string | null;
  lastSyncStatus: SyncStatus | null;
  works: number;
  worksWithMetrics?: number;
}

export interface ArtistResponse {
  artist: Artist;
  syncing: boolean;
  syncs: SyncRecord[];
}

export interface Work {
  id: string;
  username: string;
  url: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string | null;
  rating: string | null;
  tags: string[];
  views: number;
  favourites: number;
  comments: number;
  downloads: number | null;
  metricsAt: string | null;
  statsSource: string | null;
  favRate: number | null;
  commentRate: number | null;
  viewsPerDay: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Franquicias o fuentes (multi-etiqueta). Vacío = sin clasificar. “Original” = creación propia. */
  franchises?: string[];
  characters?: string[];
  /** SFW/NSFW según la marca de DeviantArt (media:rating / safety). */
  ratingClass?: RatingClass;
  /** true si hay una corrección manual. */
  classificationOverridden?: boolean;
}

export type RatingClass = 'sfw' | 'nsfw' | 'desconocido';

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
  cv: number | null;
}

export type MetricKey = 'views' | 'favourites' | 'comments' | 'favRate' | 'commentRate' | 'viewsPerDay' | 'favsPerDay';

export interface GroupStat {
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

export interface Analysis {
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
  insights: string[];
  classification?: ClassificationAnalysis;
}

export interface TopWork {
  id: string;
  title: string;
  url: string;
  views: number;
  favourites: number;
}

export interface CategoryStat {
  key: string;
  label: string;
  count: number;
  share: number;
  totalViews: number;
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
  nsfwShare: number | null;
  lowSample: boolean;
  franchise?: string | null;
  top: TopWork[];
}

export interface MannWhitney {
  n1: number;
  n2: number;
  u: number;
  z: number;
  p: number;
  probSuperiority: number;
  rankBiserial: number;
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
  ratingTest: null | { views: MannWhitney | null; favRate: MannWhitney | null; viewsPerDay: MannWhitney | null };
  franchiseByRating: { key: string; label: string; count: number; sfw: RatingCell; nsfw: RatingCell; ratio: number | null }[];
  franchiseByYear: { years: string[]; series: { key: string; label: string; counts: number[]; medianViews: (number | null)[]; total: number }[] };
  topCharactersByMedian: CategoryStat[];
}

export interface Evidence {
  kind: 'franchise' | 'character' | 'original';
  value: string;
  source: 'tag' | 'title' | 'description' | 'inferred';
  match: string;
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

/** Cuerpo de PUT /api/deviations/:id/classification: campo omitido = se mantiene, null = vuelve a lo automático. */
export interface ClassificationOverride {
  franchises?: string[] | null;
  characters?: string[] | null;
  rating?: RatingClass | null;
}

export interface DictionaryInfo {
  version: number | string | null;
  hash: string;
  franchises: { name: string; aliases: string[]; characters: string[] }[];
  artists: string[];
  custom: unknown;
  reclassified?: number;
}

export interface ReclassifyResult {
  works: number;
  hash: string;
  withFranchise: number;
  unclassified: number;
  original: number;
  overrides: number;
}

export interface Snapshot {
  takenAt: string;
  syncId: number | null;
  views: number;
  favourites: number;
  comments: number;
  downloads: number | null;
}

export interface WorkDetailResponse {
  deviation: Work;
  history: Snapshot[];
  detail: null | {
    work: WorkRow;
    rank: Record<'views' | 'favourites' | 'comments', number>;
    percentiles: Partial<Record<MetricKey, number | null>>;
    zScores: Partial<Record<MetricKey, number | null>>;
    artistMedians: Partial<Record<MetricKey, number | null>>;
    peers: number;
  };
  classification?: ClassificationRecord | null;
}

export interface Settings {
  enabled: boolean;
  intervalHours: number;
  minIntervalHours: number;
  maxIntervalHours: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
}
