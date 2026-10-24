import { buildApp } from './app.js';
import { config } from './config.js';

const production = process.env.NODE_ENV === 'production';
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const app = await buildApp({ serveStatic: production, scheduler: true, log });
await app.listen({ port: config.port, host: config.host });
log(`DA Métricas escuchando en http://localhost:${config.port}${production ? ` (sirviendo ${config.webDist})` : ''}`);
const s = app.scheduler.settings;
log(`[auto-sync] ${s.enabled ? `cada ${s.intervalHours} h; próxima: ${app.scheduler.nextRunAt?.toISOString()}` : 'desactivada'}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void app.close().then(() => process.exit(0)));
