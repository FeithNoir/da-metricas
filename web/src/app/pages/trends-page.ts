import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../api.service';
import { ago, dateTime, KIND_LABEL, num, scopeLabel, SYNC_STATUS } from '../format';
import type { Artist, BenchmarkAnalysis, BenchmarkKind, BenchmarkList, BenchmarkRun, Contrast, Estimate } from '../models';
import { BenchmarkView } from './benchmark-view';
import { ContrastView } from './contrast-view';

type Tab = 'recientes' | 'populares' | 'contraste';
const TAB_KIND: Record<Exclude<Tab, 'contraste'>, BenchmarkKind> = { recientes: 'recent', populares: 'popular' };

/** Tendencias: muestras Recientes y Populares de DeviantArt, su análisis y el contraste con un artista. */
@Component({
  selector: 'app-trends-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BenchmarkView, ContrastView],
  template: `
    <section class="trends-head">
      <h1>Tendencias</h1>
      <p class="lead">
        Compara una galería con lo que se está subiendo ahora (<strong>Recientes</strong>) y con lo que más se ve (<strong>Populares</strong>) en DeviantArt,
        con consejos basados en los datos.
      </p>
    </section>

    <section class="card trends-controls" aria-labelledby="medir">
      <h2 id="medir">Medir una muestra</h2>
      <div class="form-row">
        <div class="field">
          <label for="scope">Alcance</label>
          <input id="scope" list="scope-suggestions" [value]="scopeText()" (input)="scopeText.set($any($event.target).value)" placeholder="general o una etiqueta (p. ej. naruto)" autocomplete="off" />
          <datalist id="scope-suggestions">
            <option value="general"></option>
            @for (s of suggestions(); track s) {
              <option [value]="s"></option>
            }
          </datalist>
        </div>
        <div class="field field--narrow">
          <label for="size">Obras por muestra</label>
          <input id="size" type="number" [min]="list()?.minSize ?? 24" [max]="list()?.maxSize ?? 300" step="1" [value]="size()" (input)="setSize($any($event.target).value)" />
        </div>
        <div class="trends-controls__actions">
          <button type="button" class="btn btn--primary" (click)="measure(['recent'])" [disabled]="busy()">Medir recientes</button>
          <button type="button" class="btn btn--primary" (click)="measure(['popular'])" [disabled]="busy()">Medir populares</button>
          <button type="button" class="btn" (click)="measure(['recent', 'popular'])" [disabled]="busy()">Medir ambas</button>
        </div>
      </div>
      <p class="muted small">
        @if (estimate(); as e) {
          Cada muestra: ~{{ n(e.requests) }} peticiones ({{ n(e.pages) }} páginas de ~1,3 MB + una consulta oEmbed por obra), unos {{ minutes(e.seconds) }}, con pausas
          para no sobrecargar DeviantArt.
        }
        General = varias etiquetas amplias{{ list()?.generalTags?.length ? ' (' + list()!.generalTags.join(', ') + ')' : '' }}; una etiqueta acota la muestra a ese tema.
      </p>
      @if (list(); as l) {
        <label class="check small">
          <input type="checkbox" [checked]="l.auto.enabled" (change)="toggleAuto($any($event.target).checked)" />
          Medir Recientes y Populares ({{ scope(l.auto.scope) }}, {{ l.auto.size }} obras) después de cada sincronización automática
          @if (l.auto.enabled && l.nextAutoRunAt) {
            <span class="muted">· próxima {{ dt(l.nextAutoRunAt) }}</span>
          }
        </label>
      }
      @if (running(); as r) {
        <div class="sync-progress" aria-live="polite">
          <p>
            <strong>Midiendo {{ kind(r.kind) }} · {{ scope(r.scope) }}</strong> · fase: {{ r.phase }} ·
            @if (r.phase === 'lista') {
              {{ n(r.found) }} de {{ n(r.size) }} obras encontradas
            } @else {
              {{ n(r.processed) }} de {{ n(r.found) }} obras con métricas
            }
            @if (queue().length) {
              · luego: {{ kind(queue()[0]) }}
            }
          </p>
          <progress [max]="r.phase === 'lista' ? r.size : r.found || 1" [value]="r.phase === 'lista' ? r.found : r.processed"></progress>
        </div>
      }
      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }
    </section>

    <nav class="tabs" aria-label="Secciones de tendencias">
      @for (t of tabs; track t.key) {
        <button type="button" class="tabs__tab" [class.tabs__tab--on]="activeTab() === t.key" [attr.aria-current]="activeTab() === t.key ? 'page' : null" (click)="go({ tab: t.key })">
          {{ t.label }}
        </button>
      }
    </nav>

    @if (activeTab() !== 'contraste') {
      @let k = tabKind();
      <section class="card run-picker">
        <div class="field">
          <label for="run-select">Medición de {{ kind(k) }}</label>
          <select id="run-select" (change)="pick(k, $any($event.target).value)">
            @for (r of runsOf(k); track r.id) {
              <option [value]="r.id" [selected]="r.id === selectedId(k)">{{ runLabel(r) }}</option>
            } @empty {
              <option value="">Sin mediciones todavía</option>
            }
          </select>
        </div>
        @if (selectedRun(k); as r) {
          <p class="muted small">Actualizada {{ ago(r.finishedAt ?? r.startedAt) }} · {{ dt(r.finishedAt ?? r.startedAt) }}</p>
          <button type="button" class="btn btn--small" (click)="remove(r)" [disabled]="r.status === 'running'">Borrar esta medición</button>
        }
      </section>
      @if (sample(); as s) {
        <app-benchmark-view [data]="s" />
      } @else if (loadingSample()) {
        <p class="loading" aria-live="polite"><span class="spinner" aria-hidden="true"></span> Cargando la muestra…</p>
      } @else if (!runsOf(k).length) {
        <p class="empty card">Aún no hay mediciones de {{ kind(k) }}. Usa “Medir {{ kind(k).toLowerCase() }}” arriba (tarda un par de minutos).</p>
      }
    } @else {
      <section class="card run-picker">
        <div class="field">
          <label for="artist-select">Artista</label>
          <select id="artist-select" (change)="go({ artista: $any($event.target).value })">
            @for (a of artists(); track a.username) {
              <option [value]="a.username" [selected]="a.username === artistName()">{{ a.displayName }} ({{ a.username }})</option>
            } @empty {
              <option value="">Sin artistas sincronizados</option>
            }
          </select>
        </div>
        @for (k of kinds; track k) {
          <div class="field">
            <label [for]="'cmp-' + k">{{ kind(k) }}</label>
            <select [id]="'cmp-' + k" (change)="pick(k, $any($event.target).value)">
              @for (r of runsOf(k); track r.id) {
                <option [value]="r.id" [selected]="r.id === selectedId(k)">{{ runLabel(r) }}</option>
              } @empty {
                <option value="">Sin mediciones</option>
              }
            </select>
          </div>
        }
        @if (artistName()) {
          <a class="btn btn--small" [routerLink]="['/artista', artistName()]">Ver la galería</a>
        }
      </section>
      @if (contrast(); as c) {
        <app-contrast-view [data]="c" />
      } @else if (loadingContrast()) {
        <p class="loading" aria-live="polite"><span class="spinner" aria-hidden="true"></span> Comparando…</p>
      } @else if (!artists().length) {
        <p class="empty card">Primero sincroniza un artista desde el <a routerLink="/">inicio</a>.</p>
      } @else if (contrastError()) {
        <p class="empty card">{{ contrastError() }}</p>
      }
    }
  `,
})
export class TrendsPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly tab = input<string>();
  readonly artista = input<string>();
  readonly reciente = input<string>();
  readonly popular = input<string>();

  protected readonly tabs: { key: Tab; label: string }[] = [
    { key: 'recientes', label: 'Recientes' },
    { key: 'populares', label: 'Populares' },
    { key: 'contraste', label: 'Contraste y consejos' },
  ];
  protected readonly kinds: BenchmarkKind[] = ['recent', 'popular'];
  protected readonly n = num;
  protected readonly dt = dateTime;
  protected readonly ago = ago;
  protected readonly scope = scopeLabel;
  protected readonly kind = (k: BenchmarkKind) => KIND_LABEL[k];
  protected readonly minutes = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : `${num(s / 60, 0)} min`);

  protected readonly list = signal<BenchmarkList | null>(null);
  protected readonly artists = signal<Artist[]>([]);
  protected readonly scopeText = signal('general');
  protected readonly size = signal(100);
  protected readonly estimate = signal<Estimate | null>(null);
  protected readonly running = signal<BenchmarkRun | null>(null);
  protected readonly queue = signal<BenchmarkKind[]>([]);
  protected readonly error = signal('');
  protected readonly sample = signal<BenchmarkAnalysis | null>(null);
  protected readonly loadingSample = signal(false);
  protected readonly contrast = signal<Contrast | null>(null);
  protected readonly loadingContrast = signal(false);
  protected readonly contrastError = signal('');
  private readonly starting = signal(false);

  protected readonly busy = computed(() => !!this.running() || this.starting());
  protected readonly activeTab = computed<Tab>(() => (['recientes', 'populares', 'contraste'].includes(this.tab() ?? '') ? (this.tab() as Tab) : 'recientes'));
  protected readonly tabKind = computed<BenchmarkKind>(() => TAB_KIND[this.activeTab() as Exclude<Tab, 'contraste'>] ?? 'recent');
  protected readonly artistName = computed(() => this.artista() || this.artists()[0]?.username || '');

  protected readonly suggestions = computed(() => {
    const fromContrast = (this.contrast()?.franchises ?? [])
      .filter((f) => f.artistCount >= 5 && f.key !== 'Sin clasificar' && f.key !== 'Original')
      .map((f) => f.key.toLowerCase().replace(/[^a-z0-9]/g, ''));
    return [...new Set([...(this.list()?.generalTags ?? []), ...fromContrast])];
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  private estimateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
      if (this.estimateTimer) clearTimeout(this.estimateTimer);
    });
    void this.reload();
    this.api.artists().then(
      (r) => this.artists.set(r.artists),
      () => this.artists.set([]),
    );
    // Estimación de costo al cambiar alcance o tamaño (con una pequeña espera).
    effect(() => {
      const scope = this.scopeText().trim() || 'general';
      const size = this.size();
      if (this.estimateTimer) clearTimeout(this.estimateTimer);
      this.estimateTimer = setTimeout(() => this.api.estimate('recent', scope, size).then((e) => this.estimate.set(e), () => undefined), 250);
    });
    // Muestra del tab activo.
    effect(() => {
      const tab = this.activeTab();
      if (tab === 'contraste') return;
      const id = this.selectedId(this.tabKind());
      untracked(() => void this.loadSample(id));
    });
    // Contraste.
    effect(() => {
      if (this.activeTab() !== 'contraste') return;
      const u = this.artistName();
      const r = this.selectedId('recent');
      const p = this.selectedId('popular');
      untracked(() => void this.loadContrast(u, r, p));
    });
  }

  protected runsOf(k: BenchmarkKind) {
    return (this.list()?.runs ?? []).filter((r) => r.kind === k && (r.status === 'ok' || r.status === 'partial') && r.items > 0);
  }

  /** Medición elegida (parámetro de la URL) o la más reciente terminada. */
  protected selectedId(k: BenchmarkKind): number | null {
    const raw = k === 'recent' ? this.reciente() : this.popular();
    const runs = this.runsOf(k);
    const id = Number(raw);
    if (raw && runs.some((r) => r.id === id)) return id;
    // Por defecto, la última muestra general (como el contraste del servidor); si no hay, la última.
    return (runs.find((r) => r.scope === 'general') ?? runs[0])?.id ?? null;
  }

  protected selectedRun(k: BenchmarkKind) {
    const id = this.selectedId(k);
    return this.runsOf(k).find((r) => r.id === id) ?? null;
  }

  protected runLabel(r: BenchmarkRun) {
    return `${scopeLabel(r.scope)} · ${r.items} obras · ${dateTime(r.finishedAt ?? r.startedAt).replace(' (hora de Bogotá)', '')}${r.status === 'partial' ? ' · parcial' : ''}`;
  }

  protected go(q: Record<string, string | null>) {
    void this.router.navigate([], { queryParams: q, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected pick(k: BenchmarkKind, id: string) {
    this.go(k === 'recent' ? { reciente: id || null } : { popular: id || null });
  }

  protected setSize(v: string) {
    const x = Math.round(Number(v));
    if (Number.isFinite(x) && x > 0) this.size.set(x);
  }

  private async reload() {
    try {
      const l = await this.api.benchmarks();
      this.list.set(l);
      if (!this.running() && l.running) {
        this.running.set(l.running);
        this.poll(l.running.id);
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected async measure(kinds: BenchmarkKind[]) {
    this.error.set('');
    this.queue.set(kinds.slice(1));
    await this.start(kinds[0]!);
  }

  private async start(k: BenchmarkKind) {
    this.starting.set(true);
    try {
      const { run } = await this.api.startBenchmark({ kind: k, scope: this.scopeText().trim() || 'general', size: this.size() });
      this.running.set(run);
      this.poll(run.id);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.queue.set([]);
    } finally {
      this.starting.set(false);
    }
  }

  private poll(id: number) {
    const tick = async () => {
      try {
        const { run } = await this.api.benchmark(id);
        if (run.status === 'running') {
          this.running.set(run);
          this.timer = setTimeout(tick, 2000);
          return;
        }
        this.running.set(null);
        if (run.status === 'error' || run.status === 'empty') this.error.set(`${KIND_LABEL[run.kind]}: ${SYNC_STATUS[run.status]}. ${run.message ?? ''}`);
        await this.reload();
        if (run.status === 'ok' || run.status === 'partial') {
          this.go({ [run.kind === 'recent' ? 'reciente' : 'popular']: String(run.id), tab: this.activeTab() === 'contraste' ? 'contraste' : run.kind === 'recent' ? 'recientes' : 'populares' });
        }
        const next = this.queue()[0];
        if (next) {
          this.queue.set(this.queue().slice(1));
          await this.start(next);
        }
      } catch (e) {
        this.error.set(errorMessage(e));
        this.running.set(null);
      }
    };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(tick, 1000);
  }

  private async loadSample(id: number | null) {
    if (!id) {
      this.sample.set(null);
      return;
    }
    if (this.sample()?.run.id === id) return;
    this.loadingSample.set(true);
    this.sample.set(null);
    try {
      const s = await this.api.benchmarkAnalysis(id);
      if (this.selectedId(s.run.kind) === id) this.sample.set(s);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loadingSample.set(false);
    }
  }

  private async loadContrast(u: string, recent: number | null, popular: number | null) {
    this.contrastError.set('');
    if (!u || (!recent && !popular)) {
      this.contrast.set(null);
      if (u) this.contrastError.set('Aún no hay mediciones de tendencias: mide Recientes y Populares arriba.');
      return;
    }
    const c = this.contrast();
    if (c && c.username === u && (c.recent?.run.id ?? null) === recent && (c.popular?.run.id ?? null) === popular) return;
    this.loadingContrast.set(true);
    this.contrast.set(null);
    try {
      this.contrast.set(await this.api.contrast(u, { recent, popular }));
    } catch (e) {
      this.contrastError.set(errorMessage(e));
    } finally {
      this.loadingContrast.set(false);
    }
  }

  protected async remove(r: BenchmarkRun) {
    if (!confirm(`¿Borrar la medición de ${KIND_LABEL[r.kind]} (${scopeLabel(r.scope)}, ${r.items} obras)?`)) return;
    try {
      await this.api.deleteBenchmark(r.id);
      this.go({ [r.kind === 'recent' ? 'reciente' : 'popular']: null });
      this.sample.set(null);
      await this.reload();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected async toggleAuto(enabled: boolean) {
    try {
      this.list.set(await this.api.saveBenchmarkAuto({ enabled, scope: this.scopeText().trim() || 'general', size: this.size() }));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
