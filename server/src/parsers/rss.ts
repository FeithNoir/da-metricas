import { XMLParser } from 'fast-xml-parser';
import type { RssItem, RssPage } from '../types.js';
import { decodeEntities, deviationIdFromUrl, normalizeTags, toIso } from './text.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  htmlEntities: false,
  isArray: (name) => ['item', 'media:thumbnail', 'media:credit', 'atom:link'].includes(name),
});

type Node = Record<string, unknown>;
const text = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return text((v as Node)['#text']);
  return decodeEntities(String(v)).trim();
};

/**
 * Parsea una página del feed RSS público de una galería
 * (https://backend.deviantart.com/rss.xml?type=deviation&q=gallery:USUARIO&offset=N).
 * El feed trae título, URL, fecha y miniatura, pero NO estadísticas y casi nunca etiquetas.
 */
export function parseRssPage(xml: string): RssPage {
  const doc = parser.parse(xml) as Node;
  const channel = ((doc['rss'] as Node | undefined)?.['channel'] ?? {}) as Node;
  if (!doc['rss']) throw new Error('La respuesta no es un feed RSS válido');
  const links = (channel['atom:link'] as Node[] | undefined) ?? [];
  const next = links.find((l) => l['@_rel'] === 'next');
  const items: RssItem[] = [];
  for (const it of (channel['item'] as Node[] | undefined) ?? []) {
    const url = text(it['link']) || text(it['guid']);
    const id = deviationIdFromUrl(url);
    if (!id) continue;
    const thumbs = ((it['media:thumbnail'] as Node[] | undefined) ?? [])
      .map((t) => ({ url: decodeEntities(String(t['@_url'] ?? '')), width: Number(t['@_width'] ?? 0) }))
      .filter((t) => t.url);
    const thumb = thumbs.find((t) => t.width === 300) ?? thumbs.sort((a, b) => b.width - a.width)[0];
    const credits = ((it['media:credit'] as unknown[] | undefined) ?? []).map(text);
    const keywords = text(it['media:keywords']);
    items.push({
      id,
      url,
      title: text(it['title']) || text(it['media:title']),
      publishedAt: toIso(text(it['pubDate'])),
      thumbnail: thumb?.url ?? null,
      author: credits.find((c) => c && !c.startsWith('http')) ?? null,
      rating: text(it['media:rating']) || null,
      keywords: keywords ? normalizeTags(keywords.split(',')) : [],
    });
  }
  return {
    channelTitle: text(channel['title']),
    items,
    nextUrl: next ? decodeEntities(String(next['@_href'])) : null,
  };
}
