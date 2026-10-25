import { config } from './config.js';
import type { Db } from './db.js';
import { DeviantArtClient, USERNAME_RE } from './deviantart.js';
import type { SyncRecord, SyncStatus } from './types.js';

export interface SyncOptions {
  maxRssPages?: number;
  /** Concurrencia para pedir detalles (respeta el límite global del cliente HTTP). */
  detailConcurrency?: number;
  log?: (msg: string) => void;
  /** Se llama al terminar una sincronización con obras (p. ej. para reclasificar). */
  onFinished?: (username: string) => void;
}

/**
 * Orquesta una sincronización: perfil → RSS (lista completa) → detalle de cada obra (oEmbed / página)
 * → snapshot por obra. Solo una sincronización a la vez por artista.
 */
export class SyncService {
  private readonly running = new Map<string, Promise<SyncRecord>>();

  constructor(
    private readonly db: Db,
    private readonly da: DeviantArtClient,
    private readonly opts: SyncOptions = {},
  ) {}

  isRunning(username: string) {
    return this.running.has(username.toLowerCase());
  }

  /** Inicia (o reutiliza) la sincronización y devuelve el registro inicial sin esperar a que termine. */
  start(rawUsername: string): { sync: SyncRecord; done: Promise<SyncRecord> } {
    const username = rawUsername.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Nombre de usuario inválido: solo letras, números y guiones (máx. 20).');
    const current = this.running.get(username);
    if (current) {
      const last = this.db.listSyncs(username, 1)[0];
      return { sync: last, done: current };
    }
    this.db.upsertArtist({ username, displayName: username, avatar: null, galleryTotal: null });
    const sync = this.db.startSync(username);
    const done = this.run(username, sync.id).finally(() => this.running.delete(username));
    this.running.set(username, done);
    return { sync, done };
  }

  private async run(username: string, syncId: number): Promise<SyncRecord> {
    const log = this.opts.log ?? (() => {});
    const finish = (status: SyncStatus, message: string | null) => {
      this.db.finishSync(syncId, status, message);
      log(`[sync ${username}] ${status}${message ? `: ${message}` : ''}`);
      return this.db.getSync(syncId)!;
    };
    try {
      const profile = await this.da.profile(username);
      if (!profile.exists) {
        // No se guarda un artista que no existe.
        const rec = finish('not_found', `El usuario “${username}” no existe en DeviantArt.`);
        if (!this.db.listDeviations(username).length) this.db.deleteArtist(username);
        return rec;
      }
      if (profile.info) this.db.upsertArtist({ username, displayName: profile.info.displayName, avatar: profile.info.avatar, galleryTotal: profile.info.total });

      this.db.updateSync(syncId, { phase: 'lista' });
      const items = await this.da.listGallery(username, {
        maxPages: this.opts.maxRssPages ?? config.maxRssPages,
        onPage: (found) => this.db.updateSync(syncId, { found }),
      });
      this.db.updateSync(syncId, { found: items.length, phase: 'métricas' });
      if (!items.length) return finish('empty', `“${username}” no tiene obras públicas en su galería.`);

      const seenAt = new Date().toISOString();
      for (const it of items) this.db.upsertFromRss(username, it, seenAt);

      let processed = 0;
      let failed = 0;
      let firstError: string | null = null;
      const queue = [...items];
      const worker = async () => {
        for (let it = queue.shift(); it; it = queue.shift()) {
          try {
            const d = await this.da.detail(it);
            this.db.applyDetail(it.id, d, syncId, new Date().toISOString());
          } catch (e) {
            failed++;
            firstError ??= (e as Error).message;
            if (/cloudflare/i.test((e as Error).message)) {
              queue.length = 0;
            }
          }
          processed++;
          if (processed % 5 === 0 || processed === items.length) this.db.updateSync(syncId, { processed, failed });
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, Math.max(1, this.opts.detailConcurrency ?? config.concurrency)) }, worker));
      this.db.updateSync(syncId, { processed, failed });
      try {
        this.opts.onFinished?.(username);
      } catch (e) {
        log(`[sync ${username}] no se pudo reclasificar: ${(e as Error).message}`);
      }
      if (failed === items.length) return finish('error', `No se pudieron leer las métricas: ${firstError}`);
      return finish(failed ? 'partial' : 'ok', failed ? `${failed} obra(s) sin métricas en esta pasada (${firstError}).` : null);
    } catch (e) {
      return finish('error', (e as Error).message);
    }
  }
}
