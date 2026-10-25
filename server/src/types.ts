/** Métricas públicas de una obra en un instante dado. */
export interface Metrics {
  views: number;
  favourites: number;
  comments: number;
  /** null cuando la fuente no lo informa. */
  downloads: number | null;
}

/** Entrada del feed RSS público de la galería. */
export interface RssItem {
  id: string;
  url: string;
  title: string;
  publishedAt: string | null;
  thumbnail: string | null;
  author: string | null;
  rating: string | null;
  /** media:keywords del RSS (casi siempre vacío; las etiquetas reales vienen de oEmbed). */
  keywords: string[];
  /** media:description del RSS (HTML del autor; se usa para clasificar franquicia/personajes). */
  description?: string | null;
}

export interface RssPage {
  channelTitle: string;
  items: RssItem[];
  nextUrl: string | null;
}

/** Detalle público de una obra (oEmbed o página HTML). */
export interface DeviationDetail extends Metrics {
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  tags: string[];
  thumbnail: string | null;
  rating: string | null;
  source: 'oembed' | 'page';
}

export interface Deviation {
  id: string;
  username: string;
  url: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string | null;
  rating: string | null;
  tags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  /** Fuente de las métricas de la última sincronización. */
  statsSource: string | null;
}

export type RatingClass = 'sfw' | 'nsfw' | 'desconocido';

/** Clasificación efectiva de una obra (manual si existe; si no, automática). */
export interface WorkClassification {
  franchises: string[];
  characters: string[];
  ratingClass: RatingClass;
  /** true si alguna parte viene de una corrección manual. */
  classificationOverridden: boolean;
}

export interface DeviationWithMetrics extends Deviation, Metrics, Partial<WorkClassification> {
  /** Fecha del último snapshot (null si nunca se obtuvieron métricas). */
  metricsAt: string | null;
}

export interface Snapshot extends Metrics {
  takenAt: string;
  syncId: number | null;
}

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
  /** Total de obras que DeviantArt dice tener en “All” (incluye premium/privadas que no son públicas). */
  galleryTotal: number | null;
  autoSync: boolean;
  createdAt: string;
  lastSyncAt: string | null;
  lastSyncStatus: SyncStatus | null;
}
