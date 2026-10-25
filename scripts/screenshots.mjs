// Capturas de escritorio (1280 px) y móvil (390 px) para el README.
// Uso: con el servidor corriendo y feithnoir sincronizado, `npm run screenshots`
// (o `npm run screenshots -- analisis` para generar solo las que contengan ese texto).
// Requiere Chrome/Chromium instalado (o define CHROME_PATH). APP_URL por defecto: http://localhost:3100/
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const APP_URL = (process.env.APP_URL ?? 'http://localhost:3100/').replace(/\/$/, '');
const USER = process.env.SHOT_USER ?? 'feithnoir';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
mkdirSync(OUT, { recursive: true });

const desktop = { viewport: { width: 1280, height: 900 } };
const mobile = { viewport: { width: 390, height: 844 }, mobile: true };
const res = await fetch(`${APP_URL}/api/artists/${USER}/analysis`).then((r) => r.json());
const workId = res.top?.views?.[0]?.id;
// Obra de fanart con personaje identificado (para la tarjeta de clasificación)
const charWork = res.classification?.characters?.find((c) => c.franchise && c.franchise !== 'Original')?.top?.[0]?.id ?? workId;
const openEditor = async (page) => {
  await page.getByRole('button', { name: 'Corregir clasificación' }).click();
  await page.waitForSelector('#ov-fr');
};

const shots = [
  { name: 'inicio-escritorio.png', path: '/', wait: '.artist-chip', fullPage: true, ...desktop },
  { name: 'inicio-movil.png', path: '/', wait: '.artist-chip', fullPage: true, ...mobile },
  { name: 'obras-escritorio.png', path: `/artista/${USER}`, wait: 'table.works', fullPage: false, ...desktop },
  { name: 'obras-movil.png', path: `/artista/${USER}`, wait: 'table.works', fullPage: false, ...mobile },
  { name: 'analisis-escritorio.png', path: `/artista/${USER}?tab=analisis`, wait: '.kpis', fullPage: true, ...desktop },
  { name: 'analisis-movil.png', path: `/artista/${USER}?tab=analisis`, wait: '.kpis', fullPage: false, ...mobile },
  { name: 'obra-escritorio.png', path: `/obra/${workId}`, wait: '.pct-list', fullPage: true, ...desktop },
  { name: 'obra-movil.png', path: `/obra/${workId}`, wait: '.pct-list', fullPage: false, ...mobile },
  // Franquicias, personajes y SFW/NSFW
  { name: 'franquicias-escritorio.png', path: `/artista/${USER}?tab=analisis`, wait: 'app-classification-view', element: 'app-classification-view section:nth-of-type(2)', ...desktop },
  { name: 'personajes-escritorio.png', path: `/artista/${USER}?tab=analisis`, wait: 'app-classification-view', element: 'app-classification-view section:nth-of-type(3)', ...desktop },
  { name: 'sfw-nsfw-escritorio.png', path: `/artista/${USER}?tab=analisis`, wait: 'app-classification-view', element: 'app-classification-view section:nth-of-type(4)', ...desktop },
  { name: 'tendencia-escritorio.png', path: `/artista/${USER}?tab=analisis`, wait: 'app-classification-view', element: 'app-classification-view section:nth-of-type(5)', ...desktop },
  { name: 'franquicias-movil.png', path: `/artista/${USER}?tab=analisis`, wait: 'app-classification-view', element: 'app-classification-view section:nth-of-type(1)', ...mobile },
  { name: 'sfw-nsfw-movil.png', path: `/artista/${USER}?tab=analisis`, wait: 'app-classification-view', element: 'app-classification-view section:nth-of-type(4)', ...mobile },
  { name: 'obras-filtros-escritorio.png', path: `/artista/${USER}?franquicia=Naruto&clasif=nsfw`, wait: 'table.works', fullPage: false, ...desktop },
  { name: 'obras-filtros-movil.png', path: `/artista/${USER}?franquicia=Naruto&clasif=nsfw`, wait: 'table.works', fullPage: false, ...mobile },
  { name: 'clasificacion-obra-escritorio.png', path: `/obra/${charWork}`, wait: 'app-classification-card', element: 'app-classification-card', action: openEditor, ...desktop },
  { name: 'clasificacion-obra-movil.png', path: `/obra/${charWork}`, wait: 'app-classification-card', element: 'app-classification-card', action: openEditor, ...mobile },
  { name: 'diccionario-escritorio.png', path: '/diccionario', wait: '.dict-list li', fullPage: false, ...desktop },
];
const only = process.argv[2];
const browser = await chromium.launch({ executablePath, headless: true });
const problems = [];
for (const s of shots.filter((x) => !only || x.name.includes(only))) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: !!s.mobile, hasTouch: !!s.mobile, locale: 'es-CO', timezoneId: 'America/Bogota' });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`${s.name}: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${s.name}: ${e.message}`));
  await page.goto(APP_URL + s.path, { waitUntil: 'networkidle' });
  await page.waitForSelector(s.wait);
  if (s.action) await s.action(page);
  await page.waitForTimeout(1200);
  // Sin desbordamiento horizontal (en móvil la página no debe moverse de lado)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`${s.name}: la página desborda ${overflow}px en horizontal`);
  if (s.element) {
    // La barra superior es “sticky”: en capturas de un elemento alto se repetiría encima
    await page.addStyleTag({ content: '.topbar { position: static !important; }' });
    await page.locator(s.element).first().screenshot({ path: OUT + s.name });
  }
  else await page.screenshot({ path: OUT + s.name, fullPage: s.fullPage });
  console.log('✔', OUT + s.name);
  await ctx.close();
}
await browser.close();
if (problems.length) {
  console.error('Problemas en el navegador:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('Sin errores en la consola.');
