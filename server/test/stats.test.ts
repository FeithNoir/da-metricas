import { describe, expect, it } from 'vitest';
import { ageInDays, describe as desc, iqrFences, mean, median, pearson, percentileRank, quantile, ranks, rate, spearman, stdDev, zScore } from '../src/stats.js';

describe('estadística descriptiva con valores conocidos', () => {
  const xs = [2, 4, 4, 4, 5, 5, 7, 9];
  it('media, mediana, desviación muestral', () => {
    expect(mean(xs)).toBe(5);
    expect(median(xs)).toBe(4.5);
    // Varianza muestral = 32/7
    expect(stdDev(xs)).toBeCloseTo(Math.sqrt(32 / 7), 10);
    expect(mean([])).toBeNull();
    expect(stdDev([3])).toBe(0);
  });
  it('cuantiles tipo 7 (como Excel / NumPy)', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(quantile([10], 0.9)).toBe(10);
    const d = desc([1, 2, 3, 4, 100]);
    expect(d).toMatchObject({ n: 5, total: 110, min: 1, max: 100, q1: 2, q3: 4, iqr: 2, median: 3, mean: 22 });
  });
  it('ignora valores no finitos', () => {
    expect(mean([1, NaN, 3, Infinity])).toBe(2);
  });
});

describe('correlaciones', () => {
  it('Pearson perfecto y nulo', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull();
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });
  it('Pearson con un ejemplo de referencia', () => {
    // x = 1..5, y = 2,4,5,4,5 → r = 0,7745966…
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])).toBeCloseTo(0.7745966692, 9);
  });
  it('Spearman con empates (rangos promedio)', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    // Monótona pero no lineal → Spearman 1, Pearson < 1
    expect(spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 1000])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4, 5], [1, 4, 9, 16, 1000])!).toBeLessThan(0.8);
  });
});

describe('atípicos, percentiles y tasas', () => {
  it('vallas de Tukey', () => {
    expect(iqrFences([1, 2, 3, 4, 100])).toEqual({ lower: -1, upper: 7 });
  });
  it('z-score', () => {
    expect(zScore(7, 5, 2)).toBe(1);
    expect(zScore(7, 5, 0)).toBeNull();
  });
  it('percentil con empates a la mitad', () => {
    expect(percentileRank([1, 2, 3, 4], 4)).toBe(87.5);
    expect(percentileRank([1, 2, 3, 4], 1)).toBe(12.5);
    expect(percentileRank([], 1)).toBeNull();
  });
  it('tasa y antigüedad', () => {
    expect(rate(5, 100)).toBe(0.05);
    expect(rate(5, 0)).toBeNull();
    const now = new Date('2026-01-11T00:00:00Z');
    expect(ageInDays('2026-01-01T00:00:00Z', now)).toBe(10);
    expect(ageInDays('2026-01-10T23:00:00Z', now)).toBe(1);
    expect(ageInDays(null, now)).toBeNull();
  });
});
