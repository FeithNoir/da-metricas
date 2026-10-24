import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../src/http.js';

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string) => readFileSync(join(here, 'fixtures', name), 'utf8');

export type Route = (url: string) => { status?: number; body: string; headers?: Record<string, string> } | undefined;

/** fetch falso que responde con fixtures según la URL y registra las peticiones. */
export function fakeFetch(route: Route): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const r = route(url);
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r.body, { status: r.status ?? 200, headers: r.headers });
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}
