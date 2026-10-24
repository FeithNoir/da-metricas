import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ApiService, errorMessage } from '../api.service';
import { dateTime } from '../format';
import type { Settings } from '../models';

export const INTERVAL_OPTIONS = [6, 12, 24, 48, 72, 168];
export const intervalLabel = (h: number) => (h === 24 ? 'Una vez al día' : h === 168 ? 'Una vez por semana' : h % 24 === 0 ? `Cada ${h / 24} días` : `Cada ${h} horas`);

/** Opciones de la sincronización automática. */
@Component({
  selector: 'app-settings-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="autosync-title">
      <h2 id="autosync-title">Sincronización automática</h2>
      @if (loading()) {
        <p class="muted" aria-live="polite">Cargando opciones…</p>
      } @else if (settings(); as s) {
        <form class="settings" (submit)="save($event)">
          <label class="check">
            <input type="checkbox" [checked]="enabled()" (change)="enabled.set($any($event.target).checked)" />
            Sincronizar automáticamente a los artistas guardados
          </label>
          <label for="interval">Frecuencia</label>
          <select id="interval" [value]="interval()" (change)="interval.set(+$any($event.target).value)" [disabled]="!enabled()">
            @for (h of options; track h) {
              <option [value]="h" [selected]="h === interval()">{{ label(h) }}</option>
            }
          </select>
          <button class="btn" type="submit">Guardar</button>
        </form>
        <p class="muted small">
          Mínimo cada {{ s.minIntervalHours }} horas, para no sobrecargar a DeviantArt.
          @if (s.enabled && s.nextRunAt) {
            Próxima: {{ dt(s.nextRunAt) }}.
          }
          @if (s.lastRunAt) {
            Última: {{ dt(s.lastRunAt) }}.
          }
        </p>
      }
      @if (message()) {
        <p class="ok" role="status">{{ message() }}</p>
      }
      @if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
      }
    </section>
  `,
})
export class SettingsPanel implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly options = INTERVAL_OPTIONS;
  protected readonly label = intervalLabel;
  protected readonly dt = dateTime;
  protected readonly settings = signal<Settings | null>(null);
  protected readonly loading = signal(true);
  protected readonly enabled = signal(true);
  protected readonly interval = signal(24);
  protected readonly error = signal('');
  protected readonly message = signal('');

  async ngOnInit() {
    try {
      this.apply(await this.api.settings());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private apply(s: Settings) {
    this.settings.set(s);
    this.enabled.set(s.enabled);
    this.interval.set(s.intervalHours);
  }

  protected async save(e: Event) {
    e.preventDefault();
    this.error.set('');
    this.message.set('');
    try {
      this.apply(await this.api.saveSettings({ enabled: this.enabled(), intervalHours: this.interval() }));
      this.message.set('Opciones guardadas.');
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
