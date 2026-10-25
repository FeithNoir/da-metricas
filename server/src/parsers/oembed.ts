import type { DeviationDetail } from '../types.js';
import { fixMojibake, normalizeTags, toInt, toIso } from './text.js';

type Node = Record<string, unknown>;

/**
 * Parsea la respuesta del oEmbed público (https://backend.deviantart.com/oembed?url=…).
 * Trae título, autor, fecha, etiquetas y community.statistics._attributes
 * (views, favorites, comments, downloads).
 */
export function parseOembed(body: string): DeviationDetail {
  // Tolera basura al final (algunas respuestas traen un salto de línea o texto extra tras el JSON).
  const start = body.indexOf('{');
  if (start < 0) throw new Error('oEmbed: respuesta sin JSON');
  let data: Node;
  try {
    data = JSON.parse(body.slice(start, body.lastIndexOf('}') + 1)) as Node;
  } catch {
    throw new Error('oEmbed: JSON inválido');
  }
  const stats = (((data['community'] as Node | undefined)?.['statistics'] as Node | undefined)?.['_attributes'] ?? null) as Node | null;
  if (!stats) throw new Error('oEmbed: sin estadísticas');
  const views = toInt(stats['views']);
  const favourites = toInt(stats['favorites'] ?? stats['favourites']);
  const comments = toInt(stats['comments']);
  if (views === null || favourites === null || comments === null) throw new Error('oEmbed: estadísticas incompletas');
  const rawTags = data['tags'];
  const tags = typeof rawTags === 'string' ? normalizeTags(rawTags.split(',')) : Array.isArray(rawTags) ? normalizeTags(rawTags.map(String)) : [];
  return {
    title: typeof data['title'] === 'string' ? fixMojibake(data['title']) : null,
    author: typeof data['author_name'] === 'string' ? data['author_name'] : null,
    publishedAt: toIso(data['pubdate']),
    tags,
    thumbnail: typeof data['thumbnail_url'] === 'string' ? data['thumbnail_url'] : null,
    rating: typeof data['safety'] === 'string' ? data['safety'] : null,
    views,
    favourites,
    comments,
    downloads: toInt(stats['downloads']),
    source: 'oembed',
  };
}
