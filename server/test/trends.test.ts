import { describe, expect, it } from 'vitest';
import { BUILTIN_DICTIONARY } from '../src/classification.js';
import { compileDictionary } from '../src/classifier/classify.js';
import { ageAdjustedIndex, ageBuckets, ageStats, analyzeBenchmark, buildContrast, confidenceFor, percentiles } from '../src/trends.js';
import { toWorkRows } from '../src/analysis.js';
import type { BenchmarkItem, BenchmarkRun, DeviationWithMetrics } from '../src/types.js';

const compiled = compileDictionary(BUILTIN_DICTIONARY, '');
const NOW = new Date('2026-10-24T20:00:00Z');
const H = 3_600_000;

let n = 0;
const work = (p: Partial<DeviationWithMetrics>): DeviationWithMetrics => {
  n++;
  return {
    id: `a${n}`,
    username: 'demo',
    url: `https://www.deviantart.com/demo/art/Obra-${n}`,
    title: `Obra ${n}`,
    thumbnail: null,
    publishedAt: '2025-03-03T15:00:00Z',
    rating: 'nonadult',
    tags: [],
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    statsSource: 'oembed',
    views: 100,
    favourites: 20,
    comments: 1,
    downloads: 0,
    metricsAt: NOW.toISOString(),
    franchises: [],
    characters: [],
    ratingClass: 'sfw',
    classificationOverridden: false,
    ...p,
  };
};
const item = (p: Partial<BenchmarkItem>): BenchmarkItem => {
  n++;
  return {
    id: `b${n}`,
    rank: n,
    source: 'fanart',
    url: `https://www.deviantart.com/otro${n % 7}/art/Pieza-${n}`,
    title: `Pieza ${n}`,
    author: `otro${n % 7}`,
    thumbnail: null,
    publishedAt: '2020-01-01T00:00:00Z',
    rating: 'nonadult',
    tags: [],
    views: 50_000,
    favourites: 5_000,
    comments: 100,
    downloads: null,
    statsSource: 'oembed',
    measuredAt: NOW.toISOString(),
    ...p,
  };
};
const run = (id: number, kind: BenchmarkRun['kind'], items: number): BenchmarkRun => ({
  id,
  kind,
  scope: 'general',
  size: items,
  startedAt: NOW.toISOString(),
  finishedAt: NOW.toISOString(),
  status: 'ok',
  phase: 'métricas',
  found: items,
  processed: items,
  failed: 0,
  message: null,
  sources: [],
  items,
});

const TEN_TAGS = ['fanart', 'digitalart', 'anime', 'girl', 'cute', 'illustration', 'character', 'art', 'drawing', 'beautiful'];

// Artista: 30 obras, una por semana desde marzo de 2025. Cada 3.ª es de Naruto (lunes, 3000 vistas); el resto son
// originales (jueves, 500 vistas; las 10 primeras NSFW). Pocas etiquetas.
const MONDAY = Date.parse('2025-03-03T15:00:00Z');
let originals = 0;
const artistWorks = Array.from({ length: 30 }, (_, i) => {
  if (i % 3 === 0) return work({ franchises: ['Naruto'], tags: ['naruto', 'fanart'], views: 3000, favourites: 600, publishedAt: new Date(MONDAY + i * 7 * 86_400_000).toISOString() });
  const nsfw = originals++ < 10;
  return work({
    franchises: ['Original'],
    tags: ['oc', 'originalcharacter'],
    views: 500,
    favourites: 100,
    publishedAt: new Date(MONDAY + (i * 7 + 3) * 86_400_000).toISOString(),
    rating: nsfw ? 'adult' : 'nonadult',
    ratingClass: nsfw ? 'nsfw' : 'sfw',
  });
});
// 5 obras medidas a las 12 h de publicadas (50 vistas) y otra vez a los 3 días.
const artistSnapshots = artistWorks.slice(0, 5).flatMap((w) => [
  { id: w.id, takenAt: new Date(Date.parse(w.publishedAt!) + 6 * H).toISOString(), views: 20, favourites: 2, comments: 0 },
  { id: w.id, takenAt: new Date(Date.parse(w.publishedAt!) + 12 * H).toISOString(), views: 50, favourites: 5, comments: 0 },
  { id: w.id, takenAt: new Date(Date.parse(w.publishedAt!) + 72 * H).toISOString(), views: 400, favourites: 40, comments: 1 },
]);
// Populares: 12 de Genshin Impact + 18 varios, 10 etiquetas cada una, sin NSFW.
const popularItems = [
  ...Array.from({ length: 12 }, () => item({ title: 'Raiden Shogun', tags: ['genshinimpact', ...TEN_TAGS.slice(0, 9)] })),
  ...Array.from({ length: 18 }, () => item({ tags: TEN_TAGS })),
];
// Recientes: 20 obras de hace 10 h (una por minuto), 10 vistas cada una.
const recentItems = Array.from({ length: 20 }, (_, i) =>
  item({ publishedAt: new Date(NOW.getTime() - 10 * H - i * 60_000).toISOString(), views: 10, favourites: 1, comments: 0, tags: ['anime', 'aiart', 'girl'], rating: i % 2 ? 'adult' : 'nonadult' }),
);

describe('normalización por edad', () => {
  it('edad exacta en horas y vistas por hora (sin el mínimo de 1 día)', () => {
    const s = ageStats([
      { publishedAt: '2026-10-24T19:00:00Z', views: 10, measuredAt: NOW.toISOString() },
      { publishedAt: '2026-10-24T17:00:00Z', views: 60, measuredAt: NOW.toISOString() },
      { publishedAt: '2026-10-24T19:59:00Z', views: 1, measuredAt: NOW.toISOString() },
    ]);
    expect(s.medianAgeHours).toBe(1);
    expect(s.minAgeHours).toBeCloseTo(1 / 60, 5);
    expect(s.maxAgeHours).toBe(3);
    // 10/1, 60/3 y 1/0,25 (edad mínima 15 min) → mediana 10
    expect(s.medianViewsPerHour).toBe(10);
  });

  it('por ventana de edad usa, por obra, el último snapshot dentro de la ventana', () => {
    const rows = ageBuckets([
      {
        key: 'artist',
        points: [
          { id: 'x', point: { ageDays: 0.3, views: 30, favourites: 1 } },
          { id: 'x', point: { ageDays: 0.9, views: 90, favourites: 2 } },
          { id: 'y', point: { ageDays: 0.5, views: 50, favourites: 3 } },
          { id: 'x', point: { ageDays: 400, views: 9000, favourites: 9 } },
        ],
      },
    ]);
    const d1 = rows.find((r) => r.key === 'd1')!.cells.artist!;
    expect(d1.n).toBe(2);
    expect(d1.medianViews).toBe(70); // 90 (x, último) y 50 (y)
    expect(d1.medianViewsPerDay).toBe(100); // 90/0,9 y 50/0,5
    expect(d1.lowSample).toBe(true);
    expect(rows.find((r) => r.key === 'old')!.cells.artist!.n).toBe(1);
    expect(rows.find((r) => r.key === 'd7')!.cells.artist!).toMatchObject({ n: 0, medianViews: null });
  });

  it('índice ajustado por antigüedad: compara cada obra con las de edad parecida', () => {
    // Obras viejas con muchas vistas y nuevas con pocas: ninguna es “mejor” para su edad…
    const old = Array.from({ length: 10 }, (_, i) => work({ publishedAt: '2018-01-01T15:00:00Z', views: 5000 + i }));
    const fresh = Array.from({ length: 10 }, (_, i) => work({ publishedAt: '2026-10-01T15:00:00Z', views: 50 + i }));
    // …salvo esta, que dobla a las de su edad.
    const star = work({ publishedAt: '2026-10-01T15:00:00Z', views: 110 });
    const idx = ageAdjustedIndex(toWorkRows([...old, ...fresh, star], NOW), 11);
    expect(idx.get(old[0]!.id)).toBeCloseTo(1, 2);
    expect(idx.get(fresh[0]!.id)).toBeCloseTo(50 / 55, 2);
    expect(idx.get(star.id)).toBeCloseTo(2, 1);
    // Sin ajuste, las viejas parecerían 100× mejores
    const c = buildContrast({ username: 'demo', artistWorks: [...old, ...fresh], artistSnapshots: [], recent: null, popular: null, compiled, now: NOW });
    expect(c.advice.some((a) => a.id.startsWith('horario'))).toBe(false);
  });

  it('confianza por tamaño de muestra', () => {
    expect([confidenceFor(30), confidenceFor(29), confidenceFor(10), confidenceFor(9)]).toEqual(['alta', 'media', 'media', 'baja']);
  });
});

describe('análisis de una muestra', () => {
  it('reutiliza el análisis del artista y suma autores, ritmo de subida y edades', () => {
    const r = analyzeBenchmark(run(1, 'recent', 20), recentItems, compiled, {});
    expect(r.analysis.works).toBe(20);
    expect(r.analysis.classification.ratings.find((x) => x.key === 'nsfw')?.count).toBe(10);
    expect(r.extras.authors).toBe(7);
    expect(r.extras.spanMinutes).toBe(19);
    expect(r.extras.uploadsPerMinute).toBe(1);
    expect(r.extras.sources).toEqual([{ source: 'fanart', count: 20, spanMinutes: 19, perHour: 60 }]);
    expect(r.extras.ages.medianAgeHours).toBeCloseTo(10 + 9.5 / 60, 5);
    expect(r.extras.notes.join(' ')).toMatch(/minutos u horas/);
    const p = analyzeBenchmark(run(2, 'popular', 30), popularItems, compiled, {});
    expect(p.extras.uploadsPerMinute).toBeNull();
    expect(p.extras.sources[0]).toMatchObject({ perHour: null });
    // Varias fuentes en Recientes: no se mezcla el ritmo
    const mixed = analyzeBenchmark(run(3, 'recent', 20), recentItems.map((x, i) => ({ ...x, source: i % 2 ? 'anime' : 'fanart' })), compiled, {});
    expect(mixed.extras.uploadsPerMinute).toBeNull();
    expect(mixed.extras.sources.map((x) => x.source).sort()).toEqual(['anime', 'fanart']);
    expect(p.extras.medianTagCount).toBe(10);
    expect(p.analysis.classification.franchises.find((f) => f.label === 'Genshin Impact')?.count).toBe(12);
  });
});

describe('contraste y consejos', () => {
  const c = buildContrast({
    username: 'demo',
    artistWorks,
    artistSnapshots,
    recent: { run: run(1, 'recent', 20), items: recentItems, extras: analyzeBenchmark(run(1, 'recent', 20), recentItems, compiled, {}).extras },
    popular: { run: run(2, 'popular', 30), items: popularItems, extras: analyzeBenchmark(run(2, 'popular', 30), popularItems, compiled, {}).extras },
    compiled,
    now: NOW,
  });
  const get = (id: string) => c.advice.find((a) => a.id === id);

  it('resume los tres grupos con las mismas métricas', () => {
    const s = Object.fromEntries(c.summary.map((x) => [x.key, x]));
    expect(s['artist']).toMatchObject({ n: 30, medianViews: 500, medianTagCount: 2, nsfwShare: 10 / 30 });
    expect(s['artist']!.favsPer100Views).toBeCloseTo(20, 5);
    expect(s['popular']).toMatchObject({ n: 30, medianViews: 50_000, medianTagCount: 10, nsfwShare: 0, favsPer100Views: 10 });
    expect(s['recent']).toMatchObject({ n: 20, nsfwShare: 0.5, rateN: 0 }); // 10 vistas < 30: sin tasas
    expect(s['recent']!.medianAgeDays).toBeCloseTo((10 + 9.5 / 60) / 24, 5);
  });

  it('compara a igual edad con los snapshots del artista', () => {
    const d1 = c.ageBuckets.find((b) => b.key === 'd1')!;
    expect(d1.cells.artist).toMatchObject({ n: 5, medianViews: 50, medianViewsPerDay: 100 });
    expect(d1.cells.recent!.n).toBe(20);
    expect(d1.cells.recent!.medianViewsPerDay).toBeCloseTo(10 / ((10 + 9.5 / 60) / 24), 3);
    expect(c.artistEarlyPoints).toBe(5);
  });

  it('percentiles del artista dentro de cada muestra', () => {
    const v = c.percentiles.find((p) => p.benchmark === 'popular' && p.metric === 'views')!;
    expect(v).toMatchObject({ artistMedian: 500, benchmarkMedian: 50_000, percentileOfMedian: 0, shareAboveMedian: 0, n: 30 });
    const rv = c.percentiles.find((p) => p.benchmark === 'recent' && p.metric === 'views')!;
    expect(rv).toMatchObject({ percentileOfMedian: 100, shareAboveMedian: 1 });
    // percentileRank con empates = mitad
    const half = percentiles(toWorkRows([work({ views: 10 })], NOW), toWorkRows([work({ views: 10 }), work({ views: 20 })], NOW), 'popular');
    expect(half[0]!.percentileOfMedian).toBe(25);
  });

  it('etiquetas y franquicias: presencia en cada muestra y rendimiento propio', () => {
    const g = c.tags.find((t) => t.key === 'genshinimpact')!;
    expect(g).toMatchObject({ popularCount: 12, popularShare: 0.4, artistCount: 0, artistShare: 0 });
    const nar = c.franchises.find((f) => f.key === 'Naruto')!;
    expect(nar).toMatchObject({ artistCount: 10, artistMedianViews: 3000, artistLift: 6, popularCount: 0 });
    expect(c.timing.weekdays.find((w) => w.label === 'Lunes')).toMatchObject({ artistCount: 10, artistShare: 1 / 3 });
    expect(c.ratingMix.find((r) => r.key === 'artist')).toMatchObject({ sfw: 20, nsfw: 10, sfwMedianViews: 1750, nsfwMedianViews: 500 });
    expect(c.ratingTest?.views?.p).toBeLessThan(0.05);
  });

  it('activa las reglas esperadas con sus cifras y confianza', () => {
    expect(c.advice.length).toBeGreaterThan(5);
    const strong = get('franquicia-fuerte-naruto')!;
    expect(strong).toMatchObject({ area: 'franquicias', tone: 'fortaleza', confidence: 'media', n: 10 });
    expect(strong.text).toMatch(/6,0×/);
    expect(strong.evidence.map((e) => e.value).join(' ')).toMatch(/6,0× lo normal para su edad \(10 obras\) 3\.000 500/);

    const gap = get('franquicia-hueco-genshinimpact')!;
    expect(gap.text).toMatch(/40,0 %/);

    const tags = get('etiquetas-hueco')!;
    expect(tags.text).toMatch(/#genshinimpact/);
    expect(tags.text).toMatch(/#aiart/); // 100 % de Recientes, 0 % del artista
    // Las etiquetas con las que se reúne la muestra general no cuentan como tendencia
    expect(tags.text).not.toMatch(/#anime|#fanart|#digitalart/);
    expect(c.tags.find((t) => t.key === 'anime')?.sampling).toBe(true);

    const count = get('etiquetas-cantidad')!;
    expect(count.evidence).toEqual([
      { label: 'Tu mediana de etiquetas', value: '2' },
      { label: 'Mediana en Populares', value: '10' },
    ]);

    const sfw = get('clasificacion-sfw')!;
    expect(sfw.text).toMatch(/3,5×/); // 1750 / 500

    const eng = get('interaccion-alta')!;
    expect(eng.text).toMatch(/2,0×/);

    const day = get('horario-dia')!;
    expect(day.title).toMatch(/lunes/);
    expect(get('horario-franja')).toBeUndefined(); // todas en la misma franja

    expect(get('constancia-inactivo')).toBeDefined(); // nada en 90 días
    const first = get('alcance-primer-dia')!;
    expect(first.tone).toBe('fortaleza');
    expect(get('alcance-medir-temprano')).toBeUndefined();

    // Toda recomendación trae evidencia, confianza y orden por prioridad
    for (const a of c.advice) {
      expect(a.evidence.length).toBeGreaterThan(0);
      expect(['alta', 'media', 'baja']).toContain(a.confidence);
    }
    expect(c.advice.map((a) => a.score)).toEqual([...c.advice.map((a) => a.score)].sort((a, b) => b - a));
  });

  it('sin muestras de referencia solo usa los datos del artista y no inventa cifras', () => {
    const only = buildContrast({ username: 'demo', artistWorks, artistSnapshots: [], recent: null, popular: null, compiled, now: NOW });
    expect(only.summary.map((s) => s.key)).toEqual(['artist']);
    expect(only.advice.some((a) => a.id.startsWith('franquicia-hueco') || a.id === 'etiquetas-cantidad' || a.id.startsWith('interaccion'))).toBe(false);
    expect(only.advice.some((a) => a.id === 'franquicia-fuerte-naruto')).toBe(true);
  });

  it('NSFW que solo “gana” por ser más nuevo: sin diferencia a igual edad → consejo de alcance SFW', () => {
    // Obras viejas SFW con pocas vistas y nuevas NSFW con muchas; dentro de cada época, SFW y NSFW rinden igual.
    const ws: DeviationWithMetrics[] = [];
    for (let i = 0; i < 40; i++) {
      const recent = i >= 20;
      const nsfw = recent ? i % 4 !== 0 : i % 4 === 0;
      ws.push(
        work({
          publishedAt: new Date(Date.parse('2019-01-07T15:00:00Z') + i * 60 * 86_400_000).toISOString(),
          views: (recent ? 3000 : 300) + (i % 5) * 10,
          rating: nsfw ? 'adult' : 'nonadult',
          ratingClass: nsfw ? 'nsfw' : 'sfw',
        }),
      );
    }
    const pop = { run: run(9, 'popular', 30), items: popularItems, extras: analyzeBenchmark(run(9, 'popular', 30), popularItems, compiled, {}).extras };
    const c2 = buildContrast({ username: 'demo', artistWorks: ws, artistSnapshots: [], recent: null, popular: pop, compiled, now: NOW });
    const mix = c2.ratingMix.find((r) => r.key === 'artist')!;
    expect(mix.nsfwMedianViews! / mix.sfwMedianViews!).toBeGreaterThan(5); // en bruto parece enorme
    expect(c2.ratingTest!.index!.p).toBeGreaterThan(0.05); // a igual edad, no
    expect(c2.advice.find((a) => a.id === 'clasificacion-nsfw')).toBeUndefined();
    expect(c2.advice.find((a) => a.id === 'clasificacion-alcance')?.text).toMatch(/A igual edad no hay diferencia clara/);
  });

  it('alcance por etiqueta: subconjunto del artista', () => {
    const many = buildContrast({ username: 'demo', artistWorks, artistSnapshots: [], recent: null, popular: null, compiled, now: NOW });
    expect(many.franchises.some((f) => f.key === 'Naruto')).toBe(true);
    const scoped = buildContrast({ username: 'demo', artistWorks, artistSnapshots: [], recent: null, popular: null, compiled, now: NOW, scope: 'naruto' });
    expect(scoped.summary.find((s) => s.key === 'artistScoped')).toMatchObject({ n: 10, label: '@demo · #naruto' });
  });
});
