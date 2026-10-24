import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/csv.js';

describe('CSV', () => {
  it('escapa comillas, comas, saltos y fórmulas', () => {
    expect(csvCell('Ecchitober: Day 23 - "Invocation"')).toBe('"Ecchitober: Day 23 - ""Invocation"""');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(['x', 'y'])).toBe('"x; y"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });
  it('genera cabecera, BOM y CRLF', () => {
    const out = toCsv([{ key: 'a', label: 'título' }], [{ a: 1 }, { a: 'ñ' }]);
    expect(out).toBe('\uFEFFtítulo\r\n1\r\nñ\r\n');
  });
});
