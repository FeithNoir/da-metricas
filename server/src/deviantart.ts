import { HttpError, type PoliteClient } from './http.js';
import { parseOembed } from './parsers/oembed.js';
import { parseDeviationPage, parseGalleryPage, type GalleryInfo } from './parsers/page.js';
import { parseRssPage } from './parsers/rss.js';
import type { DeviationDetail, RssItem } from './types.js';

export const USERNAME_RE = /^[a-z0-9-]{1,20}$/i;

export const rssUrl = (username: string, offset = 0) =>
  `https://backend.deviantart.com/rss.xml?type=deviation&q=${encodeURIComponent(`gallery:${username}`)}${offset ? `&offset=${offset}` : ''}`;
export const oembedUrl = (deviationUrl: string) => `https://backend.deviantart.com/oembed?url=${encodeURIComponent(deviationUrl)}`;
export const galleryUrl = (username: string) => `https://www.deviantart.com/${encodeURIComponent(username)}/gallery`;

export type ProfileLookup = { exists: true; info: GalleryInfo | null } | { exists: false };

/** Acceso a las fuentes públicas (sin API oficial, sin OAuth). */
export class DeviantArtClient {
  constructor(private readonly http: PoliteClient) {}

  /** Comprueba si el perfil existe (404 = no existe) y lee el total de la galería si se puede. */
  async profile(username: string): Promise<ProfileLookup> {
    try {
      const res = await this.http.get(galleryUrl(username));
      return { exists: true, info: parseGalleryPage(res.body, username) };
    } catch (e) {
      if (e instanceof HttpError && (e.status === 404 || e.status === 410)) return { exists: false };
      // Si la página HTML no está disponible (bloqueo, cambio), no se asume nada: el RSS decide.
      return { exists: true, info: null };
    }
  }

  /** Recorre el RSS público siguiendo rel="next" hasta el final. */
  async listGallery(username: string, opts: { maxPages: number; onPage?: (count: number) => void }): Promise<RssItem[]> {
    const seen = new Map<string, RssItem>();
    let url: string | null = rssUrl(username);
    let pages = 0;
    const visited = new Set<string>();
    while (url && pages < opts.maxPages && !visited.has(url)) {
      visited.add(url);
      const res = await this.http.get(url, { useCache: pages > 0 });
      const page = parseRssPage(res.body);
      for (const it of page.items) if (!seen.has(it.id)) seen.set(it.id, it);
      pages++;
      opts.onPage?.(seen.size);
      // Una página vacía sin “next” marca el final; DeviantArt avanza el offset de 60 en 60 aunque devuelva menos.
      url = page.nextUrl;
    }
    return [...seen.values()];
  }

  /** Métricas y etiquetas: oEmbed primero; si falla, la página pública de la obra como respaldo. */
  async detail(item: Pick<RssItem, 'id' | 'url'>, { useCache = false } = {}): Promise<DeviationDetail> {
    try {
      const res = await this.http.get(oembedUrl(item.url), { useCache });
      return parseOembed(res.body);
    } catch (e) {
      if (e instanceof HttpError && e.status === 403 && /cloudflare/i.test(e.message)) throw e;
      const res = await this.http.get(item.url, { useCache });
      return parseDeviationPage(res.body, item.id);
    }
  }
}
