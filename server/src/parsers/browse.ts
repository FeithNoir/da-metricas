import { extractInitialState } from './page.js';
import { toInt, toIso } from './text.js';

type Node = Record<string, unknown>;

/** Una obra tal como aparece en una página pública de exploración (etiqueta o portada). */
export interface BrowseItem {
  id: string;
  url: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  views: number | null;
  favourites: number | null;
  comments: number | null;
  downloads: number | null;
  /** 'adult' / 'nonadult' a partir de isMature (la misma marca que usa el RSS). */
  rating: string;
  type: string | null;
  /** Posición dentro de la página (0 = primera). */
  position: number;
}

export interface BrowsePage {
  items: BrowseItem[];
  /** DeviantArt indica si hay más páginas. */
  hasMore: boolean;
  /** 'tag', 'home', 'search'… (para detectar cambios de formato). */
  pageType: string | null;
  /** Parámetros que DeviantArt dice haber aplicado (p. ej. { tag, order }). */
  requestParams: Record<string, unknown> | null;
}

/**
 * Lee el estado embebido (window.__INITIAL_STATE__) de una página pública de exploración:
 * https://www.deviantart.com/tag/ETIQUETA?order=most-recent&page=N o la portada.
 * Las estadísticas (vistas, favoritos, comentarios) vienen en la propia página, sin API ni sesión.
 */
export function parseBrowsePage(html: string): BrowsePage {
  const st = extractInitialState(html);
  if (!st) throw new Error('Página de exploración sin estado embebido (¿bloqueo o cambio de formato?)');
  const ents = (st['@@entities'] ?? {}) as Record<string, Record<string, Node>>;
  const devs = ents['deviation'] ?? {};
  const users = ents['user'] ?? {};
  const stream = ((st['@@streams'] ?? {}) as Record<string, Node>)['@@BROWSE_PAGE_STREAM'];
  const streamIds = Array.isArray(stream?.['items']) ? (stream['items'] as unknown[]).map(String) : [];
  // El orden del “stream” es el de DeviantArt (más recientes o ranking); si no está, el de las entidades.
  const ids = [...new Set([...streamIds.filter((id) => devs[id]), ...Object.keys(devs)])];
  const items: BrowseItem[] = [];
  for (const id of ids) {
    const d = devs[id];
    if (!d || d['isJournal'] || d['isDeleted'] || d['isPublished'] === false || typeof d['url'] !== 'string') continue;
    const stats = (d['stats'] ?? {}) as Node;
    const author = users[String(d['author'])]?.['username'];
    items.push({
      id: String(d['deviationId'] ?? id),
      url: d['url'],
      title: typeof d['title'] === 'string' ? d['title'] : '(sin título)',
      author: typeof author === 'string' ? author.toLowerCase() : null,
      publishedAt: toIso(d['publishedTime']),
      views: toInt(stats['views']),
      favourites: toInt(stats['favourites']),
      comments: toInt(stats['comments']),
      downloads: toInt(stats['downloads']),
      rating: d['isMature'] ? 'adult' : 'nonadult',
      type: typeof d['type'] === 'string' ? d['type'] : null,
      position: items.length,
    });
  }
  const sp = (stream?.['streamParams'] ?? null) as Node | null;
  const cp = (st['currentPageData'] ?? null) as Node | null;
  return {
    items,
    hasMore: stream ? stream['hasMore'] === true : false,
    pageType: typeof cp?.['pageType'] === 'string' ? cp['pageType'] : null,
    requestParams: (sp?.['requestParams'] as Record<string, unknown> | undefined) ?? null,
  };
}
