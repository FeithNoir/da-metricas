import type { Db } from './db.js';
import type { SyncService } from './sync.js';

export const MIN_INTERVAL_HOURS = 6;
export const MAX_INTERVAL_HOURS = 24 * 7;
export const DEFAULT_INTERVAL_HOURS = 24;

export interface AutoSyncSettings {
  enabled: boolean;
  intervalHours: number;
}

export function validateSettings(input: unknown, current: AutoSyncSettings): AutoSyncSettings {
  if (!input || typeof input !== 'object') throw new Error('Cuerpo inválido: se esperaba un objeto JSON.');
  const b = input as Record<string, unknown>;
  const next = { ...current };
  if (b['enabled'] !== undefined) {
    if (typeof b['enabled'] !== 'boolean') throw new Error('“enabled” debe ser verdadero o falso.');
    next.enabled = b['enabled'];
  }
  if (b['intervalHours'] !== undefined) {
    const h = Number(b['intervalHours']);
    if (!Number.isInteger(h)) throw new Error('“intervalHours” debe ser un número entero de horas.');
    if (h < MIN_INTERVAL_HOURS) throw new Error(`Para no sobrecargar DeviantArt, el intervalo mínimo es de ${MIN_INTERVAL_HOURS} horas.`);
    if (h > MAX_INTERVAL_HOURS) throw new Error(`El intervalo máximo es de ${MAX_INTERVAL_HOURS} horas (una semana).`);
    next.intervalHours = h;
  }
  return next;
}

/** Sincronización automática y sencilla: cada N horas sincroniza, uno tras otro, los artistas con auto-sync activo. */
export class AutoSyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  nextRunAt: Date | null = null;
  lastRunAt: Date | null = null;
  private runningNow = false;

  constructor(
    private readonly db: Db,
    private readonly sync: SyncService,
    private readonly log: (m: string) => void = () => {},
  ) {
    const last = db.getSetting('autosync.lastRunAt');
    this.lastRunAt = last ? new Date(last) : null;
  }

  get settings(): AutoSyncSettings {
    const raw = this.db.getSetting('autosync');
    const def = { enabled: true, intervalHours: DEFAULT_INTERVAL_HOURS };
    if (!raw) return def;
    try {
      return { ...def, ...(JSON.parse(raw) as Partial<AutoSyncSettings>) };
    } catch {
      return def;
    }
  }

  update(input: unknown): AutoSyncSettings {
    const s = validateSettings(input, this.settings);
    this.db.setSetting('autosync', JSON.stringify(s));
    this.schedule();
    return s;
  }

  start() {
    this.schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextRunAt = null;
  }

  schedule(now = Date.now()) {
    this.stop();
    const s = this.settings;
    if (!s.enabled) return;
    const base = this.lastRunAt?.getTime() ?? now;
    const at = Math.max(now + 60_000, base + s.intervalHours * 3600_000);
    this.nextRunAt = new Date(at);
    // setTimeout admite como máximo ~24,8 días; el intervalo máximo es 7 días.
    this.timer = setTimeout(() => void this.runOnce(), at - now);
    this.timer.unref();
  }

  async runOnce() {
    if (this.runningNow) return;
    this.runningNow = true;
    try {
      this.lastRunAt = new Date();
      this.db.setSetting('autosync.lastRunAt', this.lastRunAt.toISOString());
      for (const a of this.db.listArtists().filter((x) => x.autoSync)) {
        this.log(`[auto-sync] ${a.username}`);
        await this.sync.start(a.username).done;
      }
    } finally {
      this.runningNow = false;
      this.schedule();
    }
  }
}
