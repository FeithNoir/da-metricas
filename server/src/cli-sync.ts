// Sincroniza un artista desde la terminal: npm run sync -- feithnoir
import { buildApp } from './app.js';

const username = process.argv[2];
if (!username) {
  console.error('Uso: npm run sync -- <usuario>');
  process.exit(1);
}
const app = await buildApp({ log: (m) => console.log(m) });
const t0 = Date.now();
const { sync, done } = app.syncService.start(username);
const timer = setInterval(() => {
  const s = app.db.getSync(sync.id)!;
  console.log(`  fase=${s.phase} encontradas=${s.found} procesadas=${s.processed} fallidas=${s.failed}`);
}, 15_000);
const result = await done;
clearInterval(timer);
console.log(JSON.stringify(result, null, 2));
console.log(`Duración: ${Math.round((Date.now() - t0) / 1000)} s`);
await app.close();
