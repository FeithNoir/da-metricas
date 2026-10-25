import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage, isNotFound } from '../api.service';
import { ago, dateTime, num, SYNC_STATUS } from '../format';
import type { Analysis, ArtistResponse, SyncRecord, Work } from '../models';
import { AnalysisView } from './analysis-view';
import { type Filters, WorksTable } from './works-table';

type Tab = 'obras' | 'analisis';

@Component({
  selector: 'app-artist-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorksTable, AnalysisView, RouterLink],
  template: `
    @if (state() === 'loading') {
      <p class="loading" aria-live="polite"><span class="spinner" aria-hidden="true"></span> Cargando a {{ username() }}…</p>
    } @else {
      <section class="artist-head">
        <div class="artist-head__id">
          @if (data()?.artist?.avatar; as av) {
            <img [src]="av" alt="" width="64" height="64" referrerpolicy="no-referrer" />
          }
          <div>
            <h1>{{ data()?.artist?.displayName ?? username() }}</h1>
            <p class="muted small">
              <a [href]="'https://www.deviantart.com/' + username()" target="_blank" rel="noopener noreferrer">deviantart.com/{{ username() }} ↗</a>
              @if (data(); as d) {
                · {{ n(d.artist.works) }} obras públicas medidas
                @if (d.artist.galleryTotal !== null && d.artist.galleryTotal > d.artist.works) {
                  de {{ n(d.artist.galleryTotal) }} en su galería
                  <span class="info" title="La diferencia suele ser contenido premium o de pago, que no es público.">ⓘ</span>
                }
                · última sincronización {{ ago(d.artist.lastSyncAt) }}
              }
            </p>
          </div>
        </div>
        <div class="artist-head__actions">
          <button class="btn btn--primary" type="button" (click)="sync()" [disabled]="!!running()">
            {{ running() ? 'Sincronizando…' : data() ? 'Sincronizar de nuevo' : 'Sincronizar ahora' }}
          </button>
          @if (data() && works().length) {
            <a class="btn" [routerLink]="['/tendencias']" [queryParams]="{ tab: 'contraste', artista: username() }">Comparar con tendencias</a>
            <a class="btn" [href]="csvHref()" download>Exportar CSV</a>
          }
          @if (data(); as d) {
            <label class="check small">
              <input type="checkbox" [checked]="d.artist.autoSync" (change)="toggleAuto($any($event.target).checked)" /> Auto-sync
            </label>
          }
        </div>
      </section>

      @if (running(); as r) {
        <section class="card sync-progress" aria-live="polite">
          <p>
            <strong>Sincronizando</strong> · fase: {{ r.phase }} ·
            @if (r.found) {
              {{ n(r.processed) }} de {{ n(r.found) }} obras
            } @else {
              buscando obras…
            }
          </p>
          <progress [value]="r.processed" [max]="r.found || 1" aria-label="Progreso de la sincronización"></progress>
          <p class="muted small">Se piden los datos despacio a propósito (una o dos peticiones a la vez, con pausas). Una galería de 600 obras tarda unos minutos.</p>
        </section>
      }

      @if (notice(); as m) {
        <p [class]="noticeKind() === 'error' ? 'alert alert--error' : 'alert'" role="alert">{{ m }}</p>
      }

      @if (state() === 'missing' && !running()) {
        <section class="empty card">
          <h2>Aún no hay datos de “{{ username() }}”</h2>
          <p>Pulsa <strong>Sincronizar ahora</strong> para leer su galería pública. Si el usuario no existe o no tiene obras públicas, te lo diremos.</p>
        </section>
      } @else if (state() === 'error') {
        <p class="alert alert--error" role="alert">{{ loadError() }}</p>
      } @else if (data()) {
        @if (!works().length && !running()) {
          <section class="empty card"><p>Este artista no tiene obras públicas medidas todavía.</p></section>
        } @else if (works().length) {
          <nav class="tabs" aria-label="Secciones del artista">
            <button type="button" class="tabs__tab" [class.tabs__tab--on]="activeTab() === 'obras'" [attr.aria-current]="activeTab() === 'obras' ? 'page' : null" (click)="setTab('obras')">
              Obras ({{ n(works().length) }})
            </button>
            <button type="button" class="tabs__tab" [class.tabs__tab--on]="activeTab() === 'analisis'" [attr.aria-current]="activeTab() === 'analisis' ? 'page' : null" (click)="setTab('analisis')">
              Análisis estadístico
            </button>
          </nav>
          @if (activeTab() === 'obras') {
            <app-works-table [works]="works()" [username]="username()" [preset]="preset()" />
          } @else if (analysis(); as a) {
            <app-analysis-view [analysis]="a" [works]="works()" [username]="username()" (changed)="reload()" />
          } @else {
            <p class="loading" aria-live="polite"><span class="spinner" aria-hidden="true"></span> Calculando estadísticas…</p>
          }
        }
        @if (data()!.syncs.length) {
          <details class="card syncs">
            <summary>Historial de sincronizaciones ({{ data()!.syncs.length }})</summary>
            <ul class="plain small">
              @for (s of data()!.syncs; track s.id) {
                <li>
                  {{ dt(s.startedAt) }} — {{ status[s.status] }} · {{ n(s.processed) }}/{{ n(s.found) }} obras
                  @if (s.failed) {
                    · {{ s.failed }} fallidas
                  }
                  @if (s.message) {
                    <span class="muted"> · {{ s.message }}</span>
                  }
                </li>
              }
            </ul>
          </details>
        }
      }
    }
  `,
})
export class ArtistPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly username = input.required<string>();
  /** Pestaña desde ?tab=analisis */
  readonly tab = input<string | undefined>(undefined);
  /** Filtros desde el análisis: ?franquicia=Naruto, ?personaje=Sakura Haruno, ?clasif=nsfw */
  readonly franquicia = input<string | undefined>(undefined);
  readonly personaje = input<string | undefined>(undefined);
  readonly clasif = input<string | undefined>(undefined);
  protected readonly preset = computed<Partial<Filters> | null>(() => {
    const f = this.franquicia();
    const c = this.personaje();
    const r = this.clasif();
    if (!f && !c && !r) return null;
    return { franchise: f ?? '', character: c ?? '', rating: r && ['sfw', 'nsfw', 'desconocido'].includes(r) ? r : '' };
  });

  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly data = signal<ArtistResponse | null>(null);
  protected readonly works = signal<Work[]>([]);
  protected readonly analysis = signal<Analysis | null>(null);
  protected readonly running = signal<SyncRecord | null>(null);
  protected readonly notice = signal('');
  protected readonly noticeKind = signal<'info' | 'error'>('info');
  protected readonly loadError = signal('');
  protected readonly activeTab = computed<Tab>(() => (this.tab() === 'analisis' ? 'analisis' : 'obras'));
  protected readonly csvHref = computed(() => this.api.csvUrl(this.username()));
  protected readonly n = num;
  protected readonly ago = ago;
  protected readonly dt = dateTime;
  protected readonly status = SYNC_STATUS;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPolling());
    effect(() => {
      const u = this.username();
      untracked(() => void this.load(u));
    });
    effect(() => {
      if (this.activeTab() === 'analisis' && this.data() && !this.analysis()) untracked(() => void this.loadAnalysis());
    });
  }

  protected setTab(t: Tab) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: t === 'obras' ? null : t, franquicia: null, personaje: null, clasif: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Tras reclasificar: obras y análisis nuevos, sin parpadeo de carga. */
  protected async reload() {
    try {
      const u = this.username();
      const [w, a] = await Promise.all([this.api.works(u), this.api.analysis(u)]);
      this.works.set(w.items);
      this.analysis.set(a);
    } catch (e) {
      this.noticeKind.set('error');
      this.notice.set(errorMessage(e));
    }
  }

  private async load(u: string) {
    this.stopPolling();
    this.state.set('loading');
    this.notice.set('');
    this.analysis.set(null);
    try {
      const d = await this.api.artist(u);
      this.data.set(d);
      this.works.set((await this.api.works(u)).items);
      this.state.set('ready');
      const last = d.syncs[0];
      if (d.syncing && last?.status === 'running') this.poll(last.id);
    } catch (e) {
      this.data.set(null);
      this.works.set([]);
      if (isNotFound(e)) this.state.set('missing');
      else {
        this.loadError.set(errorMessage(e));
        this.state.set('error');
      }
    }
  }

  private async loadAnalysis() {
    try {
      this.analysis.set(await this.api.analysis(this.username()));
    } catch (e) {
      this.noticeKind.set('error');
      this.notice.set(errorMessage(e));
    }
  }

  protected async sync() {
    this.notice.set('');
    try {
      const { sync } = await this.api.startSync(this.username());
      this.running.set(sync);
      this.poll(sync.id);
    } catch (e) {
      this.noticeKind.set('error');
      this.notice.set(errorMessage(e));
    }
  }

  protected async toggleAuto(on: boolean) {
    try {
      const { artist } = await this.api.setAutoSync(this.username(), on);
      this.data.update((d) => (d ? { ...d, artist: { ...d.artist, autoSync: artist.autoSync } } : d));
    } catch (e) {
      this.noticeKind.set('error');
      this.notice.set(errorMessage(e));
    }
  }

  private poll(id: number) {
    this.stopPolling();
    const tick = async () => {
      try {
        const { sync } = await this.api.sync(id);
        if (sync.status === 'running') {
          this.running.set(sync);
          this.timer = setTimeout(tick, 2000);
          return;
        }
        this.running.set(null);
        this.finished(sync);
      } catch (e) {
        this.running.set(null);
        this.noticeKind.set('error');
        this.notice.set(errorMessage(e));
      }
    };
    void tick();
  }

  private async finished(s: SyncRecord) {
    const kind = s.status === 'ok' || s.status === 'partial' ? 'info' : 'error';
    this.noticeKind.set(kind);
    const msg: Record<string, string> = {
      ok: `Sincronización completa: ${num(s.processed)} obras actualizadas.`,
      partial: `Sincronización parcial: ${num(s.processed - s.failed)} de ${num(s.found)} obras con métricas. ${s.message ?? ''}`,
      not_found: s.message ?? 'El usuario no existe en DeviantArt.',
      empty: s.message ?? 'Este usuario no tiene obras públicas.',
      error: `La sincronización falló: ${s.message ?? 'error desconocido'}`,
    };
    this.notice.set(msg[s.status] ?? '');
    if (s.status === 'not_found') {
      this.data.set(null);
      this.state.set('missing');
      return;
    }
    await this.load(this.username());
    this.notice.set(msg[s.status] ?? '');
    this.noticeKind.set(kind);
  }

  private stopPolling() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
