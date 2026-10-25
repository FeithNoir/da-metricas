import { ChangeDetectionStrategy, Component, computed, forwardRef, input } from '@angular/core';
import { ageText, compact, dateTime, num, pct, scopeLabel, SYNC_STATUS } from '../format';
import type { BenchmarkAnalysis, Work } from '../models';
import { BENCHMARK_CONTEXT, type BenchmarkContext } from '../work-link';
import { AnalysisView } from './analysis-view';

/** Una muestra de tendencias (Recientes o Populares): datos de la muestra + el mismo análisis que una galería. */
@Component({
  selector: 'app-benchmark-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnalysisView],
  providers: [{ provide: BENCHMARK_CONTEXT, useExisting: forwardRef(() => BenchmarkView) }],
  template: `
    @let d = data();
    @let e = d.extras;
    <section class="card">
      <div class="card-head">
        <h2>Muestra {{ kindName() }} · {{ scope(e.scope) }}</h2>
        <span class="badge" [class.badge--warn]="d.run.status !== 'ok'">{{ status[d.run.status] ?? d.run.status }}</span>
      </div>
      <p class="explain">
        @if (e.kind === 'recent') {
          Las <strong>{{ n(e.items) }} obras más nuevas</strong> publicadas en DeviantArt
          @if (e.scope === 'general') {
            en etiquetas amplias ({{ sourceList() }}),
          } @else {
            con la etiqueta <strong>#{{ e.scope }}</strong>,
          }
          medidas {{ dt(e.measuredAt) }}. Sirve para ver <strong>qué se está subiendo ahora</strong> (la competencia del momento).
        } @else {
          Las <strong>{{ n(e.items) }} obras más populares</strong> que DeviantArt muestra a un visitante sin sesión
          @if (e.scope === 'general') {
            (portada + populares de etiquetas amplias),
          } @else {
            con la etiqueta <strong>#{{ e.scope }}</strong>,
          }
          medidas {{ dt(e.measuredAt) }}. Sirve para ver <strong>qué funciona</strong> en la plataforma.
        }
      </p>
      @for (note of e.notes; track $index) {
        <p class="alert small">{{ note }}</p>
      }
      @if (d.run.message) {
        <p class="muted small">{{ d.run.message }}</p>
      }
      <div class="kpis">
        <div class="kpi"><span>Obras</span><strong>{{ n(e.items) }}</strong><small class="muted">{{ n(e.withTags) }} con etiquetas (oEmbed)</small></div>
        <div class="kpi"><span>Autores distintos</span><strong>{{ n(e.authors) }}</strong><small class="muted">el que más aparece: {{ p(e.topAuthorShare, 0) }} de la muestra</small></div>
        <div class="kpi"><span>Edad mediana al medir</span><strong>{{ age(e.ages.medianAgeHours) }}</strong><small class="muted">de {{ age(e.ages.minAgeHours) }} a {{ age(e.ages.maxAgeHours) }}</small></div>
        @if (e.kind === 'recent') {
          <div class="kpi"><span>Vistas por hora (mediana)</span><strong>{{ n(e.ages.medianViewsPerHour, 1) }}</strong><small class="muted">desde la publicación</small></div>
          @if (e.uploadsPerMinute !== null) {
            <div class="kpi"><span>Ritmo de publicación</span><strong>{{ n(e.uploadsPerMinute * 60, 0) }}/h</strong><small class="muted">obras nuevas por hora en #{{ e.scope }}</small></div>
          }
        } @else {
          <div class="kpi"><span>Vistas (mediana)</span><strong>{{ c(d.analysis.descriptive.views.median) }}</strong><small class="muted">favoritos: {{ c(d.analysis.descriptive.favourites.median) }}</small></div>
        }
        <div class="kpi"><span>Etiquetas por obra</span><strong>{{ n(e.medianTagCount) }}</strong><small class="muted">mediana</small></div>
      </div>

      <div class="grid2">
        <div>
          <h3>Fuentes</h3>
          <div class="table-wrap">
            <table class="stats">
              <thead>
                <tr>
                  <th scope="col">Fuente</th><th scope="col" class="num">Obras</th>
                  @if (e.kind === 'recent') {
                    <th scope="col" class="num">Obras nuevas por hora</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (s of e.sources; track s.source) {
                  <tr>
                    <th scope="row">{{ s.source === 'portada' ? 'Portada de DeviantArt' : '#' + s.source }}</th>
                    <td class="num">{{ n(s.count) }}</td>
                    @if (e.kind === 'recent') {
                      <td class="num">{{ n(s.perHour, s.perHour !== null && s.perHour < 10 ? 1 : 0) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (e.kind === 'recent') {
            <p class="muted small">Ritmo = obras de la muestra ÷ tiempo entre la más vieja y la más nueva de esa etiqueta: cuánta competencia llega por hora.</p>
          }
        </div>
        <div>
          <h3>Autores con más obras en la muestra</h3>
          <ol class="rank">
            @for (a of e.topAuthors.slice(0, 6); track a.author) {
              <li><a [href]="'https://www.deviantart.com/' + a.author" target="_blank" rel="noopener noreferrer">{{ a.author }}</a><span class="muted"> · {{ a.count }} {{ a.count === 1 ? 'obra' : 'obras' }}</span></li>
            }
          </ol>
        </div>
      </div>

      <h3>{{ e.kind === 'recent' ? 'Lo último que se subió' : 'Las más vistas de la muestra' }}</h3>
      <ul class="thumbs">
        @for (w of gallery(); track w.id) {
          <li class="thumbs__item">
            <a [href]="w.url" target="_blank" rel="noopener noreferrer" [title]="w.title + ' — ' + (w.author ?? '')">
              @if (w.rating !== 'adult' && w.thumbnail) {
                <img [src]="w.thumbnail" alt="" loading="lazy" referrerpolicy="no-referrer" />
              } @else {
                <span class="thumbs__ph">{{ w.rating === 'adult' ? 'NSFW' : 'Sin vista previa' }}</span>
              }
              <span class="thumbs__meta"><span class="thumbs__title">{{ w.title }}</span><small>{{ w.author }} · {{ c(w.views) }} vistas</small></span>
            </a>
          </li>
        }
      </ul>
      <p class="muted small">Las miniaturas de obras NSFW no se muestran. Los enlaces abren DeviantArt.</p>
    </section>

    <app-analysis-view [analysis]="d.analysis" [works]="works()" />
  `,
})
export class BenchmarkView implements BenchmarkContext {
  readonly data = input.required<BenchmarkAnalysis>();

  readonly urls = computed<ReadonlyMap<string, string>>(() => new Map(this.data().items.map((i) => [i.id, i.url])));

  protected readonly n = num;
  protected readonly c = compact;
  protected readonly p = pct;
  protected readonly dt = dateTime;
  protected readonly age = ageText;
  protected readonly scope = scopeLabel;
  protected readonly status = SYNC_STATUS;
  protected readonly kindName = computed(() => (this.data().run.kind === 'recent' ? 'Recientes' : 'Populares'));
  protected readonly sourceList = computed(() =>
    this.data()
      .extras.sources.map((s) => (s.source === 'portada' ? 'portada' : `#${s.source}`))
      .join(', '),
  );

  protected readonly gallery = computed(() => {
    const items = [...this.data().items];
    if (this.data().run.kind === 'popular') items.sort((a, b) => b.views - a.views);
    else items.sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? ''));
    return items.slice(0, 12);
  });

  /** Para la dispersión vistas–favoritos del análisis. */
  protected readonly works = computed(() =>
    this.data().items.map((i) => ({ ...i, metricsAt: i.measuredAt, username: i.author ?? '' }) as unknown as Work),
  );
}
