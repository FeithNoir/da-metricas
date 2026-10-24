import type { DeviationDetail } from '../types.js';
import { normalizeTags, toInt, toIso } from './text.js';

type Node = Record<string, unknown>;

/** Extrae el objeto window.__INITIAL_STATE__ que DeviantArt embebe en sus páginas públicas. */
export function extractInitialState(html: string): Node | null {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/s);
  if (!m) return null;
  try {
    // Es un literal de cadena JS: \' no es válido en JSON, así que se normaliza antes.
    return JSON.parse(JSON.parse(m[1].replace(/\\'/g, "'")) as string) as Node;
  } catch {
    return null;
  }
}

const entities = (st: Node) => (st['@@entities'] ?? {}) as Record<string, Record<string, Node>>;

/** Respaldo: métricas y etiquetas desde la página pública de una obra. */
export function parseDeviationPage(html: string, id: string): DeviationDetail {
  const st = extractInitialState(html);
  if (!st) throw new Error('Página sin estado embebido (¿bloqueo o cambio de formato?)');
  const e = entities(st);
  const dev = e['deviation']?.[id];
  if (!dev) throw new Error(`La página no contiene la obra ${id}`);
  const ext = e['deviationExtended']?.[id] ?? {};
  const stats = (dev['stats'] ?? {}) as Node;
  const extStats = (ext['stats'] ?? {}) as Node;
  const views = toInt(stats['views'] ?? extStats['views']);
  const favourites = toInt(stats['favourites']);
  const comments = toInt(stats['comments']);
  if (views === null || favourites === null || comments === null) throw new Error('Página: estadísticas incompletas');
  const authorId = dev['author'];
  const author = authorId !== undefined ? (e['user']?.[String(authorId)]?.['username'] as string | undefined) : undefined;
  const tags = Array.isArray(ext['tags']) ? normalizeTags((ext['tags'] as Node[]).map((t) => String(t['name'] ?? ''))) : [];
  return {
    title: typeof dev['title'] === 'string' ? dev['title'] : null,
    author: author ?? null,
    publishedAt: toIso(dev['publishedTime']),
    tags,
    thumbnail: null,
    rating: typeof dev['matureLevel'] === 'string' ? dev['matureLevel'] : dev['isMature'] ? 'adult' : 'nonadult',
    views,
    favourites,
    comments,
    downloads: toInt(stats['downloads'] ?? extStats['downloads']),
    source: 'page',
  };
}

export interface GalleryInfo {
  username: string;
  displayName: string;
  avatar: string | null;
  /** Total de la carpeta “All” (incluye contenido premium que no es público). */
  total: number | null;
  /** Obras en carpetas de pago (premium), que no se pueden medir públicamente. */
  premiumFolders: number;
}

/** Información del perfil desde la página pública de la galería. */
export function parseGalleryPage(html: string, username: string): GalleryInfo | null {
  const st = extractInitialState(html);
  if (!st) return null;
  const e = entities(st);
  const user = Object.values(e['user'] ?? {}).find((u) => String(u['username']).toLowerCase() === username.toLowerCase());
  if (!user) return null;
  const folders = Object.values(e['galleryFolder'] ?? {}).filter((f) => f['owner'] === user['userId'] || f['folderId'] === -1);
  const all = folders.find((f) => f['folderId'] === -1);
  return {
    username: String(user['username']).toLowerCase(),
    displayName: String(user['username']),
    avatar: typeof user['usericon'] === 'string' ? user['usericon'] : null,
    total: all ? toInt(all['totalItemCount'] ?? all['size']) : null,
    premiumFolders: folders.filter((f) => f['premiumFolderData']).length,
  };
}
