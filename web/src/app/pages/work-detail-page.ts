import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage, isNotFound } from '../api.service';
import { LineChart, type LineSeries } from '../charts/line-chart';
import { date, dateTime, METRIC_LABEL, metricValue, num } from '../format';
import type { ClassificationRecord, MetricKey, WorkDetailResponse } from '../models';
import { ClassificationCard } from './classification-card';

@Component({
  selector: 'app-work-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LineChart, ClassificationCard],
  template: `
    @if (state() === 'loading') {
      <p class="loading" aria-live="polite"><span class="spinner" aria-hidden="true"></span> Cargando obra…</p>
    } @else if (state() === 'missing') {
      <section class="empty card"><h1>Obra no encontrada</h1><p>No está en la base local. <a routerLink="/">Volver al inicio</a>.</p></section>
    } @else if (state() === 'error') {
      <p class="alert alert--error" role="alert">{{ error() }}</p>
    } @else if (data(); as r) {
      @let w = r.deviation;
      <p class="crumbs"><a [routerLink]="['/artista', w.username]">← {{ w.username }}</a></p>
      <article class="work">
        <div class="work__media">
          @if (w.thumbnail) {
            <img [src]="w.thumbnail" [alt]="'Miniatura de ' + w.title" referrerpolicy="no-referrer" />
          }
        </div>
        <div class="work__info">
          <h1>{{ w.title }}</h1>
          <p class="muted">
            Publicada el {{ d(w.publishedAt) }} ·
            <a [href]="w.url" target="_blank" rel="noopener noreferrer">Ver en DeviantArt ↗</a>
          </p>
          <div class="kpis">
            <div class="kpi"><span>Vistas</span><strong>{{ n(w.views) }}</strong></div>
            <div class="kpi"><span>Favoritos</span><strong>{{ n(w.favourites) }}</strong></div>
            <div class="kpi"><span>Comentarios</span><strong>{{ n(w.comments) }}</strong></div>
            <div class="kpi"><span>Descargas</span><strong>{{ w.downloads === null ? '—' : n(w.downloads) }}</strong></div>
          </div>
          @if (w.tags.length) {
            <p class="tags">
              @for (t of w.tags; track t) {
                <span class="tag tag--static">{{ t }}</span>
              }
            </p>
          } @else {
            <p class="muted small">Sin etiquetas públicas.</p>
          }
          <p class="muted small">Métricas al {{ dt(w.metricsAt) }} · fuente: {{ w.statsSource === 'page' ? 'página pública' : 'oEmbed' }}</p>
        </div>
      </article>

      @if (r.classification; as cl) {
        <app-classification-card [record]="cl" [workId]="w.id" [username]="w.username" (saved)="onSaved($event)" />
      }

      @if (r.detail; as det) {
        <section class="card">
          <h2>Frente a las demás obras de {{ w.username }}</h2>
          <p class="explain">
            El <strong>percentil</strong> dice qué porcentaje de sus {{ n(det.peers) }} obras queda por debajo de esta.
            Percentil 90 = le va mejor que al 90 % de sus obras. Puesto {{ det.rank.views }} de {{ det.peers }} en vistas,
            {{ det.rank.favourites }} en favoritos y {{ det.rank.comments }} en comentarios.
          </p>
          <ul class="pct-list">
            @for (k of keys; track k) {
              @if (det.percentiles[k] !== null && det.percentiles[k] !== undefined) {
                <li>
                  <span class="pct-list__label">{{ label[k] }}</span>
                  <span class="pct-list__bar" aria-hidden="true"><span [style.width.%]="det.percentiles[k]"></span></span>
                  <span class="pct-list__value">
                    P{{ n(det.percentiles[k]) }} · {{ mv(k, det.work[k]) }}
                    <small class="muted">(mediana del artista: {{ mv(k, det.artistMedians[k]) }})</small>
                  </span>
                </li>
              }
            }
          </ul>
        </section>
      }

      <section class="card">
        <h2>Historial</h2>
        @if (r.history.length > 1) {
          <app-line-chart [series]="series()" label="Evolución de vistas y favoritos" />
          <div class="table-wrap">
            <table class="stats">
              <thead><tr><th scope="col">Fecha</th><th scope="col" class="num">Vistas</th><th scope="col" class="num">Favoritos</th><th scope="col" class="num">Comentarios</th></tr></thead>
              <tbody>
                @for (h of r.history; track $index) {
                  <tr><th scope="row">{{ dt(h.takenAt) }}</th><td class="num">{{ n(h.views) }}</td><td class="num">{{ n(h.favourites) }}</td><td class="num">{{ n(h.comments) }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="empty">Solo hay una medición ({{ dt(r.history[0]?.takenAt) }}). Tras la próxima sincronización verás cómo evoluciona.</p>
        }
      </section>
    }
  `,
})
export class WorkDetailPage {
  private readonly api = inject(ApiService);
  readonly id = input.required<string>();
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly data = signal<WorkDetailResponse | null>(null);
  protected readonly error = signal('');
  protected readonly keys: MetricKey[] = ['views', 'favourites', 'comments', 'favRate', 'commentRate', 'viewsPerDay'];
  protected readonly label = METRIC_LABEL;
  protected readonly n = num;
  protected readonly d = date;
  protected readonly dt = dateTime;
  protected readonly mv = metricValue;

  protected readonly series = computed<LineSeries[]>(() => {
    const h = this.data()?.history ?? [];
    return [
      { name: 'Vistas', cls: 's1', points: h.map((x) => ({ x: Date.parse(x.takenAt), y: x.views })) },
      { name: 'Favoritos', cls: 's2', points: h.map((x) => ({ x: Date.parse(x.takenAt), y: x.favourites })) },
    ];
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  protected onSaved(c: ClassificationRecord) {
    this.data.update((d) =>
      d
        ? {
            ...d,
            classification: c,
            deviation: { ...d.deviation, franchises: c.effective.franchises, characters: c.effective.characters, ratingClass: c.effective.ratingClass, classificationOverridden: !!c.override },
          }
        : d,
    );
  }

  private async load(id: string) {
    this.state.set('loading');
    try {
      this.data.set(await this.api.work(id));
      this.state.set('ready');
    } catch (e) {
      if (isNotFound(e)) this.state.set('missing');
      else {
        this.error.set(errorMessage(e));
        this.state.set('error');
      }
    }
  }
}
