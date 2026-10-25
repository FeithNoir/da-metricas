import type { CategoryStat, ClassificationAnalysis, ClassificationRecord, Work } from './models';

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
    franchises: [],
    characters: [],
    ratingClass: 'sfw',
    classificationOverridden: false,
    ...partial,
  };
}

export function makeCategory(p: Partial<CategoryStat> & { key: string }): CategoryStat {
  return {
    label: p.key,
    count: 10,
    share: 0.1,
    totalViews: 10000,
    viewsShare: 0.1,
    medianViews: 1000,
    meanViews: 1000,
    totalFavourites: 500,
    medianFavourites: 50,
    meanFavourites: 50,
    totalComments: 20,
    medianComments: 2,
    meanComments: 2,
    medianFavRate: 0.05,
    meanFavRate: 0.05,
    medianViewsPerDay: 3,
    nsfwShare: 0.5,
    lowSample: false,
    top: [{ id: '1', title: 'La más vista', url: 'https://www.deviantart.com/x/art/1', views: 5000, favourites: 100 }],
    ...p,
  };
}

export function makeClassification(): ClassificationAnalysis {
  const mw = { n1: 376, n2: 268, u: 66000, z: 7, p: 2e-12, probSuperiority: 0.66, rankBiserial: 0.32 };
  const cell = (count: number, medianViews: number) => ({ count, medianViews, medianFavRate: 0.04, medianViewsPerDay: 2, lowSample: count < 5 });
  return {
    minWorks: 5,
    dictionaryHash: 'abc123def456',
    coverage: { works: 644, withFranchise: 574, fanart: 362, original: 212, unclassified: 70, withCharacter: 300, multiFranchise: 20, overrides: 1, franchisesDistinct: 90, charactersDistinct: 210 },
    franchises: [
      makeCategory({ key: 'Original', count: 212, medianViews: 900 }),
      makeCategory({ key: 'Naruto', count: 36, medianViews: 1800 }),
      makeCategory({ key: 'Kill la Kill', count: 3, medianViews: 4174, lowSample: true }),
      makeCategory({ key: 'Sin clasificar', count: 70, medianViews: 300 }),
    ],
    characters: [
      makeCategory({ key: 'Sakura Haruno', count: 10, franchise: 'Naruto', medianViews: 2000 }),
      makeCategory({ key: 'Ino Yamanaka', count: 3, franchise: 'Naruto', medianViews: 4631, lowSample: true }),
    ],
    ratings: [
      makeCategory({ key: 'sfw', label: 'SFW', count: 268, medianViews: 485.5 }),
      makeCategory({ key: 'nsfw', label: 'NSFW', count: 376, medianViews: 1451.5 }),
    ],
    ratingTest: { views: mw, favRate: { ...mw, p: 0.4, probSuperiority: 0.52 }, viewsPerDay: null },
    franchiseByRating: [{ key: 'Naruto', label: 'Naruto', count: 36, sfw: cell(10, 800), nsfw: cell(26, 2400), ratio: 3 }],
    franchiseByYear: { years: ['2024', '2025'], series: [{ key: 'Naruto', label: 'Naruto', counts: [10, 26], medianViews: [3000, 1200], total: 36 }] },
    topCharactersByMedian: [makeCategory({ key: 'Sakura Haruno', count: 10, franchise: 'Naruto', medianViews: 2000 })],
  };
}

export function makeRecord(p: Partial<ClassificationRecord> = {}): ClassificationRecord {
  return {
    rawRating: 'adult',
    auto: { franchises: ['Naruto'], characters: ['Sakura Haruno'], ratingClass: 'nsfw' },
    evidence: [
      { kind: 'character', value: 'Sakura Haruno', source: 'tag', match: 'sakuraharuno' },
      { kind: 'franchise', value: 'Naruto', source: 'inferred', match: 'Sakura Haruno' },
    ],
    classifiedAt: '2026-10-24T20:00:00.000Z',
    dictHash: 'abc123def456',
    override: null,
    effective: { franchises: ['Naruto'], characters: ['Sakura Haruno'], ratingClass: 'nsfw' },
    ...p,
  };
}
