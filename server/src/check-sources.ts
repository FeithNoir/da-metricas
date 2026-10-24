// Verifica en vivo que las fuentes públicas responden con el formato esperado: npm run check:sources [-- usuario]
import { DeviantArtClient, oembedUrl, rssUrl } from './deviantart.js';
import { PoliteClient } from './http.js';
import { parseOembed } from './parsers/oembed.js';
import { parseRssPage } from './parsers/rss.js';

const user = process.argv[2] ?? 'feithnoir';
const http = new PoliteClient({ cacheTtlMinutes: 0 });
const da = new DeviantArtClient(http);
const ok = (m: string) => console.log(`✔ ${m}`);
const bad = (m: string) => {
  console.log(`✘ ${m}`);
  process.exitCode = 1;
};
try {
  const page = parseRssPage((await http.get(rssUrl(user))).body);
  if (page.items.length) ok(`RSS: ${page.items.length} obras en la primera página; siguiente: ${page.nextUrl ? 'sí' : 'no'}`);
  else bad('RSS sin obras');
  const first = page.items[0];
  if (first) {
    const d = parseOembed((await http.get(oembedUrl(first.url))).body);
    ok(`oEmbed: “${d.title}” vistas=${d.views} favs=${d.favourites} coment=${d.comments} desc=${d.downloads} etiquetas=${d.tags.length}`);
  }
  const p = await da.profile(user);
  if (p.exists) ok(`Galería HTML: total “All” = ${p.info?.total ?? 'desconocido'}`);
  else bad('Perfil no encontrado');
} catch (e) {
  bad((e as Error).message);
}
