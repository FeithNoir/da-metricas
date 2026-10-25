import builtin from './classifier/dictionary.json' with { type: 'json' };
import {
  characterIndex,
  classifyWith,
  compileDictionary,
  dictionaryHash,
  mergeDictionaries,
  validateDictionaryExtension,
  type Dictionary,
} from './classifier/classify.js';
import type { Db } from './db.js';
import { parseRssPage } from './parsers/rss.js';
import type { RatingClass } from './types.js';

export const BUILTIN_DICTIONARY = builtin as Dictionary;
const CUSTOM_KEY = 'dictionary.custom';
const MAX_LIST = 25;
const MAX_NAME = 80;

/** Valida la lista de nombres de una corrección manual (null = volver a lo automático). */
function cleanList(v: unknown, what: string): string[] | null {
  if (v === null) return null;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error(`“${what}” debe ser una lista de textos o null.`);
  const out = [...new Set(v.map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean))];
  if (out.length > MAX_LIST) throw new Error(`Máximo ${MAX_LIST} elementos en “${what}”.`);
  if (out.some((x) => x.length > MAX_NAME)) throw new Error(`Cada nombre en “${what}” admite hasta ${MAX_NAME} caracteres.`);
  return out;
}

export interface OverrideInput {
  franchises?: unknown;
  characters?: unknown;
  rating?: unknown;
}

/**
 * Clasificación de obras: une el diccionario del repositorio con las ampliaciones del usuario (guardadas en SQLite),
 * reclasifica cuando cambia el diccionario y aplica las correcciones manuales.
 */
export class ClassificationService {
  private cache: { key: string; dict: Dictionary; hash: string } | null = null;

  constructor(
    private readonly db: Db,
    private readonly base: Dictionary = BUILTIN_DICTIONARY,
  ) {}

  customExtension(): Partial<Dictionary> | null {
    const raw = this.db.getSetting(CUSTOM_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Partial<Dictionary>;
    } catch {
      return null;
    }
  }

  dictionary(): Dictionary {
    const raw = this.db.getSetting(CUSTOM_KEY) ?? '';
    const key = `${raw.length}:${raw}`;
    if (this.cache?.key !== key) {
      const dict = mergeDictionaries(this.base, this.customExtension());
      this.cache = { key, dict, hash: dictionaryHash(dict) };
    }
    return this.cache.dict;
  }

  hash(): string {
    this.dictionary();
    return this.cache!.hash;
  }

  characterFranchises(): Record<string, string> {
    return Object.fromEntries(characterIndex(this.dictionary()));
  }

  /** Reclasifica todas las obras de un artista (no hace peticiones: usa título, etiquetas y descripción guardados). */
  reclassify(username: string): { works: number; hash: string } {
    const dict = this.dictionary();
    const hash = this.hash();
    const compiled = compileDictionary(dict, username);
    const works = this.db.worksToClassify(username);
    this.db.saveClassifications(
      works.map((w) => ({ id: w.id, ...classifyWith(compiled, { title: w.title, tags: w.tags, description: w.description, username }) })),
      hash,
    );
    return { works: works.length, hash };
  }

  /** Reclasifica solo si hay obras sin clasificar o con otra versión del diccionario. */
  ensure(username: string): boolean {
    if (!this.db.staleClassifications(username, this.hash())) return false;
    this.reclassify(username);
    return true;
  }

  reclassifyAll(): number {
    let n = 0;
    for (const a of this.db.listArtists()) n += this.reclassify(a.username).works;
    return n;
  }

  saveCustom(input: unknown): Partial<Dictionary> | null {
    if (input === null) {
      this.db.setSetting(CUSTOM_KEY, '');
      return null;
    }
    const ext = validateDictionaryExtension(input);
    // Comprueba que el resultado compila antes de guardarlo.
    compileDictionary(mergeDictionaries(this.base, ext));
    this.db.setSetting(CUSTOM_KEY, JSON.stringify(ext));
    return ext;
  }

  /**
   * Rellena descripciones (y clasificación de DeviantArt si faltara) desde los RSS guardados en la caché HTTP,
   * sin nuevas peticiones. Útil tras la migración para obras sincronizadas antes de guardar descripciones.
   */
  backfillFromCache(): number {
    let n = 0;
    for (const { body } of this.db.cachedBodies('%rss.xml%')) {
      try {
        for (const it of parseRssPage(body).items) if (this.db.fillFromRss(it)) n++;
      } catch {
        // cuerpo inválido en caché: se ignora
      }
    }
    return n;
  }

  /** Valida y guarda una corrección manual. Campos omitidos conservan su valor actual. */
  override(id: string, body: OverrideInput) {
    if (!body || typeof body !== 'object') throw new Error('Cuerpo inválido: se esperaba un objeto JSON.');
    const cur = this.db.getClassification(id)?.override ?? null;
    const franchises = body.franchises === undefined ? (cur?.franchises ?? null) : cleanList(body.franchises, 'franchises');
    const characters = body.characters === undefined ? (cur?.characters ?? null) : cleanList(body.characters, 'characters');
    let rating: RatingClass | null = cur?.rating ?? null;
    if (body.rating !== undefined) {
      if (body.rating !== null && !['sfw', 'nsfw', 'desconocido'].includes(String(body.rating))) throw new Error('“rating” debe ser "sfw", "nsfw", "desconocido" o null.');
      rating = body.rating as RatingClass | null;
    }
    // Sin ningún campo corregido no queda nada que guardar: vuelve a lo automático.
    if (franchises === null && characters === null && rating === null) this.db.clearOverride(id);
    else this.db.setOverride(id, { franchises, characters, rating });
    return this.db.getClassification(id);
  }
}
