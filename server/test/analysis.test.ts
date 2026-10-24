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
