import type { Work } from './models';

let n = 0;
export function makeWork(partial: Partial<Work> = {}): Work {
  n++;
  return {
    id: String(1000 + n),
    username: 'feithnoir',
    url: `https://www.deviantart.com/feithnoir/art/Obra-${1000 + n}`,
    title: `Obra ${n}`,
    thumbnail: null,
    publishedAt: '2026-01-15T15:00:00.000Z',
    rating: 'nonadult',
    tags: [],
    views: 100,
    favourites: 5,
    comments: 1,
    downloads: 0,
    metricsAt: '2026-10-24T16:00:00.000Z',
    statsSource: 'oembed',
    favRate: 0.05,
    commentRate: 0.01,
    viewsPerDay: 1,
    firstSeenAt: '2026-10-24T16:00:00.000Z',
    lastSeenAt: '2026-10-24T16:00:00.000Z',
    ...partial,
  };
}
