import { describe, expect, it } from 'vitest';
import { analyzeArtist, workDetail } from '../src/analysis.js';
import type { DeviationWithMetrics } from '../src/types.js';

let n = 0;
const dev = (p: Partial<DeviationWithMetrics>): DeviationWithMetrics => {
  n++;
  return {
    id: String(n),
    username: 'demo',
    url: `https://www.deviantart.com/demo/art/Obra-${n}`,
    title: `Obra ${n}`,
    thumbnail: null,
    publishedAt: '2026-01-01T15:00:00Z',
    rating: 'nonadult',
    tags: [],
    firstSeenAt: '2026-01-02T00:00:00Z',
    lastSeenAt: '2026-01-02T00:00:00Z',
    statsSource: 'oembed',
    views: 100,
    favourites: 10,
    comments: 1,
    downloads: 0,
    metricsAt: '2026-01-02T00:00:00Z',
    ...p,
  };
};

describe('análisis por artista', () => {
  const now = new Date('2026-01-11T15:00:00Z');
  const devs = [
    dev({ views: 100, favourites: 10, comments: 1, tags: ['a', 'b'] }),
    dev({ views: 200, favourites: 20, comments: 2, tags: ['a'] }),
    dev({ views: 300, favourites: 15, comments: 0, tags: ['a', 'b'] }),
    dev({ views: 400, favourites: 40, comments: 4, tags: ['a'] }),
    dev({ views: 5000, favourites: 100, comments: 9, tags: ['a', 'c'], publishedAt: '2026-01-06T15:00:00Z' }),
    dev({ views: 10, favourites: 1, comments: 0, metricsAt: null }),
  ];
  const a = analyzeArtist(devs, { now, tz: 'America/Bogota' });

  it('excluye obras sin métricas y suma totales', () => {
    expect(a.works).toBe(5);
    expect(a.worksWithoutMetrics).toBe(1);
    expect(a.totals).toEqual({ views: 6000, favourites: 185, comments: 16, downloads: 0 });
    expect(a.descriptive.views.median).toBe(300);
    expect(a.descriptive.views.mean).toBe(1200);
  });
  it('rankea interacción y detecta el atípico', () => {
    expect(a.engagement.topFavRate[0].favRate).toBeCloseTo(0.1);
    expect(a.engagement.bottomFavRate[0].title).toBe('Obra 5');
    const ov = a.outliers.find((o) => o.metric === 'views')!;
    expect(ov.high.map((h) => h.title)).toEqual(['Obra 5']);
    expect(a.top.views[0].title).toBe('Obra 5');
  });
  it('normaliza por antigüedad', () => {
    // Obra 5: 5000 vistas en 5 días
    expect(a.top.viewsPerDay[0]).toMatchObject({ title: 'Obra 5', viewsPerDay: 1000 });
  });
  it('agrupa por etiqueta (marcando muestras pequeñas) y por fecha en hora de Bogotá', () => {
    const tagA = a.tags.items.find((t) => t.key === 'a')!;
    expect(tagA).toMatchObject({ count: 5, meanViews: 1200, lowSample: false });
    expect(a.tags.items.find((t) => t.key === 'b')).toMatchObject({ count: 2, lowSample: true });
    expect(a.tags.items.find((t) => t.key === 'c')).toBeUndefined();
    expect(a.byMonth.map((m) => m.label)).toEqual(['enero 2026']);
    // 2026-01-01 15:00 UTC = jueves 10:00 en Bogotá
    expect(a.byWeekday.find((w) => w.label === 'jueves')!.count).toBe(4);
  });
  it('matriz de correlación y frases', () => {
    expect(a.correlations.labels[0]).toBe('Vistas');
    expect(a.correlations.pearson[0][0]).toBeCloseTo(1);
    expect(a.correlations.spearman[0][1]).toBeGreaterThan(0.8);
    expect(a.insights[0]).toContain('5 obras');
    expect(a.insights.join(' ')).toMatch(/mediana/);
  });
  it('crecimiento entre snapshots', () => {
    const g = analyzeArtist(devs, {
      now,
      firstLast: [
        {
          id: devs[0].id,
          first: { takenAt: '2026-01-01T00:00:00Z', syncId: 1, views: 50, favourites: 5, comments: 0, downloads: 0 },
          last: { takenAt: '2026-01-03T00:00:00Z', syncId: 2, views: 100, favourites: 10, comments: 1, downloads: 0 },
        },
      ],
    }).growth!;
    expect(g).toMatchObject({ works: 1, views: 50, favourites: 5, comments: 1 });
    expect(g.top[0].viewsPerDay).toBe(25);
  });
  it('detalle de obra: percentiles y rango', () => {
    const d = workDetail(devs[4], devs, now)!;
    expect(d.rank.views).toBe(1);
    expect(d.percentiles.views).toBe(90);
    expect(d.peers).toBe(5);
    expect(workDetail(devs[5], devs, now)).toBeNull();
  });
  it('sin obras no rompe', () => {
    const e = analyzeArtist([], { now });
    expect(e.works).toBe(0);
    expect(e.insights).toEqual([]);
  });
});

describe('análisis por franquicia, personaje y SFW/NSFW', () => {
  const now = new Date('2026-06-01T15:00:00Z');
  const devs: DeviationWithMetrics[] = [
    ...[100, 200, 300, 400, 500, 600].map((v, i) =>
      dev({ views: v, favourites: v / 10, franchises: ['Naruto'], characters: i < 3 ? ['Sakura Haruno'] : ['Tsunade'], ratingClass: i % 2 ? 'nsfw' : 'sfw', publishedAt: i < 3 ? '2025-03-01T15:00:00Z' : '2026-03-01T15:00:00Z' }),
    ),
    dev({ views: 5000, favourites: 100, franchises: ['Naruto', 'RWBY'], characters: ['Sakura Haruno', 'Weiss Schnee'], ratingClass: 'nsfw' }),
    dev({ views: 50, favourites: 1, franchises: ['Original'], characters: [], ratingClass: 'sfw' }),
    dev({ views: 70, favourites: 2, franchises: [], characters: [], ratingClass: 'desconocido' }),
  ];
  const c = analyzeArtist(devs, { now, characterFranchise: { 'Sakura Haruno': 'Naruto', Tsunade: 'Naruto', 'Weiss Schnee': 'RWBY' }, overrides: 2 }).classification;

  it('cobertura y categorías especiales (Original, Sin clasificar)', () => {
    expect(c.coverage).toMatchObject({ works: 9, withFranchise: 8, original: 1, unclassified: 1, fanart: 7, multiFranchise: 1, withCharacter: 7, overrides: 2 });
    const keys = c.franchises.map((f) => f.key);
    expect(keys[0]).toBe('Naruto');
    expect(keys).toEqual(expect.arrayContaining(['RWBY', 'Original', 'Sin clasificar']));
  });

  it('estadística por categoría coherente con el resto (medianas, cuotas, muestra pequeña, top)', () => {
    const n = c.franchises.find((f) => f.key === 'Naruto')!;
    expect(n.count).toBe(7);
    expect(n.medianViews).toBe(400);
    expect(n.totalViews).toBe(7100);
    expect(n.share).toBeCloseTo(7 / 9, 10);
    expect(n.viewsShare).toBeCloseTo(7100 / 7220, 10);
    expect(n.lowSample).toBe(false);
    expect(n.top[0].views).toBe(5000);
    expect(n.nsfwShare).toBeCloseTo(4 / 7, 10);
    expect(c.franchises.find((f) => f.key === 'RWBY')!.lowSample).toBe(true);
    const sakura = c.characters.find((x) => x.key === 'Sakura Haruno')!;
    expect(sakura).toMatchObject({ count: 4, franchise: 'Naruto', medianViews: 250 });
  });

  it('SFW vs NSFW: conteos, medianas, prueba de Mann–Whitney y cruce por franquicia', () => {
    expect(c.ratings.map((r) => [r.key, r.count])).toEqual([['sfw', 4], ['nsfw', 4], ['desconocido', 1]]);
    expect(c.ratingTest?.views?.n1).toBe(4); // NSFW
    expect(c.ratingTest?.views?.n2).toBe(4); // SFW
    const fx = c.franchiseByRating.find((f) => f.key === 'Naruto')!;
    expect(fx.sfw).toMatchObject({ count: 3, medianViews: 300, lowSample: true });
    expect(fx.nsfw).toMatchObject({ count: 4, medianViews: 500 });
    expect(fx.ratio).toBeNull(); // SFW tiene solo 3 obras: no se compara
    const big = analyzeArtist(
      [...[1, 2, 3, 4, 5].map((v) => dev({ views: v * 100, franchises: ['X'], ratingClass: 'sfw' })), ...[1, 2, 3, 4, 5].map((v) => dev({ views: v * 300, franchises: ['X'], ratingClass: 'nsfw' }))],
      { now },
    ).classification.franchiseByRating[0];
    expect(big.ratio).toBeCloseTo(3, 10);
    expect(c.franchiseByRating.find((f) => f.key === 'RWBY')).toBeUndefined(); // < 5 obras
  });

  it('tendencia por año y ranking de personajes por mediana (primero los de muestra suficiente)', () => {
    expect(c.franchiseByYear.years).toEqual(['2025', '2026']);
    const nar = c.franchiseByYear.series.find((s) => s.key === 'Naruto')!;
    expect(nar.counts).toEqual([3, 4]);
    expect(nar.medianViews[0]).toBe(200);
    expect(c.franchiseByYear.series.some((s) => s.key === 'Sin clasificar')).toBe(false);
    expect(c.topCharactersByMedian.map((x) => x.key)).toEqual(['Tsunade', 'Sakura Haruno']);
  });

  it('frases del resumen', () => {
    const a = analyzeArtist(devs, { now });
    expect(a.insights.some((i) => /tiene franquicia identificada/.test(i))).toBe(true);
    expect(a.insights.some((i) => /NSFW \(4\)/.test(i))).toBe(true);
  });
});
