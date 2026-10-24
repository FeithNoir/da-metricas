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

const shots = [
  { name: 'inicio-escritorio.png', path: '/', wait: '.artist-chip', fullPage: true, ...desktop },
  { name: 'inicio-movil.png', path: '/', wait: '.artist-chip', fullPage: true, ...mobile },
  { name: 'obras-escritorio.png', path: `/artista/${USER}`, wait: 'table.works', fullPage: false, ...desktop },
  { name: 'obras-movil.png', path: `/artista/${USER}`, wait: 'table.works', fullPage: false, ...mobile },
  { name: 'analisis-escritorio.png', path: `/artista/${USER}?tab=analisis`, wait: '.kpis', fullPage: true, ...desktop },
  { name: 'analisis-movil.png', path: `/artista/${USER}?tab=analisis`, wait: '.kpis', fullPage: false, ...mobile },
  { name: 'obra-escritorio.png', path: `/obra/${workId}`, wait: '.pct-list', fullPage: true, ...desktop },
  { name: 'obra-movil.png', path: `/obra/${workId}`, wait: '.pct-list', fullPage: false, ...mobile },
];
const only = process.argv[2];
const browser = await chromium.launch({ executablePath, headless: true });
for (const s of shots.filter((x) => !only || x.name.includes(only))) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: !!s.mobile, hasTouch: !!s.mobile, locale: 'es-CO', timezoneId: 'America/Bogota' });
  const page = await ctx.newPage();
  await page.goto(APP_URL + s.path, { waitUntil: 'networkidle' });
  await page.waitForSelector(s.wait);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + s.name, fullPage: s.fullPage });
  console.log('✔', OUT + s.name);
  await ctx.close();
}
await browser.close();
