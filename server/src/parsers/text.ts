const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** Decodifica entidades HTML/XML (nombradas básicas y numéricas). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** ID numérico de una obra a partir de su URL (…/art/Titulo-123456789). */
export function deviationIdFromUrl(url: string): string | null {
  const m = url.match(/-(\d+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/** Normaliza una fecha a ISO 8601 UTC; null si no es válida. */
export function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  // DeviantArt usa a veces "-0700" (sin dos puntos), que Date.parse sí entiende en V8.
  const t = Date.parse(value.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function toInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Etiquetas en minúsculas, sin duplicados ni vacías. */
export function normalizeTags(tags: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const v = t.trim().toLowerCase();
    if (v) out.add(v);
  }
  return [...out];
}
