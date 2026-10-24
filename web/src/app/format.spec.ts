import { ago, compact, corrLabel, metricValue, num, pct } from './format';

describe('formato es-CO', () => {
  it('números, porcentajes y compactos', () => {
    expect(num(1234567)).toBe('1.234.567');
    expect(num(1.25, 1)).toMatch(/^1,[23]$/);
    expect(num(null)).toBe('—');
    expect(pct(0.0523, 2)).toBe('5,23 %');
    expect(compact(15300)).toBe('15,3 mil');
    expect(compact(2_500_000)).toBe('2,5 M');
  });
  it('etiqueta de correlación', () => {
    expect(corrLabel(0.85)).toBe('fuerte');
    expect(corrLabel(-0.5)).toBe('moderada negativa');
    expect(corrLabel(0.05)).toBe('casi nula');
    expect(corrLabel(null)).toBe('sin datos');
  });
  it('tiempo relativo y métricas', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    expect(ago('2026-10-24T09:00:00Z', now)).toBe('hace 3 h');
    expect(ago(null, now)).toBe('nunca');
    expect(metricValue('favRate', 0.1)).toBe('10 %');
    expect(metricValue('views', 1500)).toBe('1.500');
  });
});
