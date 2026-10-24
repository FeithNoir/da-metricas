/** Escapa un valor para CSV (RFC 4180). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  // Evita inyección de fórmulas al abrir en Excel/Sheets.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const lines = [headers.map((h) => csvCell(h.label)).join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h.key])).join(','));
  // BOM para que Excel detecte UTF-8 (tildes y eñes).
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
