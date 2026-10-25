import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { BarChart, type Bar } from '../charts/bar-chart';
import { ColumnChart, type Column } from '../charts/column-chart';
import { LineChart, type LineSeries } from '../charts/line-chart';
import { ScatterChart, type ScatterPoint } from '../charts/scatter-chart';
import { compact, corr, corrLabel, date, dateTime, METRIC_LABEL, metricValue, num, pct } from '../format';
import type { Analysis, Descriptive, GroupStat, Work, WorkRow } from '../models';
import { BENCHMARK_CONTEXT, WorkLink } from '../work-link';
import { ClassificationView } from './classification-view';

type DateGroup = 'byMonth' | 'byYear' | 'byWeekday' | 'byHour';
type GroupMetric = 'medianViews' | 'meanViews' | 'meanFavourites' | 'count';

@Component({
  selector: 'app-analysis-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkLink, BarChart, ColumnChart, LineChart, ScatterChart, ClassificationView],
  template: `
    @let a = analysis();
    <section class="card">
      <h2>Resumen</h2>
      <div class="kpis">
        <div class="kpi"><span>Obras analizadas</span><strong>{{ n(a.works) }}</strong></div>
        <div class="kpi"><span>Vistas totales</span><strong>{{ c(a.totals.views) }}</strong></div>
        <div class="kpi"><span>Favoritos totales</span><strong>{{ c(a.totals.favourites) }}</strong></div>
        <div class="kpi"><span>Comentarios totales</span><strong>{{ c(a.totals.comments) }}</strong></div>
        <div class="kpi"><span>Favoritos por cada 100 vistas</span><strong>{{ n(a.totals.views ? (a.totals.favourites / a.totals.views) * 100 : null, 2) }}</strong></div>
      </div>
      @if (a.insights.length) {
        <h3>Lo más destacado</h3>
        <ul class="insights">
          @for (i of a.insights; track $index) {
            <li>{{ i }}</li>
          }
        </ul>
      }
      @if (a.worksWithoutMetrics) {
        <p class="muted small">{{ a.worksWithoutMetrics }} obra(s) no tienen métricas todavía y no entran en el análisis.</p>
      }
    </section>

    @if (a.classification; as cl) {
      <app-classification-view [data]="cl" [username]="username()" (changed)="changed.emit()" />
    }

    <section class="card">
      <h2>Estadística descriptiva</h2>
      <p class="explain">
        <strong>Media</strong> = promedio; <strong>mediana</strong> = la obra del medio (la mitad tiene más y la mitad menos), más fiable cuando
        unas pocas obras se disparan; <strong>desviación estándar</strong> = cuánto se alejan las obras del promedio;
        <strong>Q1 y Q3</strong> = el 25 % y el 75 % de las obras están por debajo de esos valores.
      </p>
      <div class="table-wrap">
        <table class="stats">
          <thead>
            <tr>
              <th scope="col">Métrica</th><th scope="col" class="num">Media</th><th scope="col" class="num">Mediana</th><th scope="col" class="num">Desv. est.</th>
              <th scope="col" class="num">Mín.</th><th scope="col" class="num">Q1</th><th scope="col" class="num">Q3</th><th scope="col" class="num">Máx.</th><th scope="col" class="num">n</th>
            </tr>
          </thead>
          <tbody>
            @for (row of descRows(); track row.key) {
              <tr>
                <th scope="row">{{ row.label }}</th>
                <td class="num">{{ mv(row.key, row.d.mean) }}</td>
                <td class="num"><strong>{{ mv(row.key, row.d.median) }}</strong></td>
                <td class="num">{{ mv(row.key, row.d.stdDev) }}</td>
                <td class="num">{{ mv(row.key, row.d.min) }}</td>
                <td class="num">{{ mv(row.key, row.d.q1) }}</td>
                <td class="num">{{ mv(row.key, row.d.q3) }}</td>
                <td class="num">{{ mv(row.key, row.d.max) }}</td>
                <td class="num">{{ n(row.d.n) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted small">Las tasas solo cuentan obras con al menos {{ a.engagement.minViews }} vistas, para que una obra con 2 vistas y 1 favorito no parezca un 50 %.</p>
    </section>

    <section class="card">
      <h2>Las más vistas y las de mejor ritmo</h2>
      <p class="explain">
        Las obras antiguas han tenido más tiempo para acumular vistas. <strong>Vistas por día</strong> divide las vistas entre los días desde su
        publicación, así se comparan obras nuevas y viejas en igualdad de condiciones.
      </p>
      <div class="grid2">
        <div>
          <h3>Top 10 por vistas</h3>
          <app-bar-chart [data]="bars(a.top.views, 'views')" label="Top 10 obras por vistas" />
        </div>
        <div>
          <h3>Top 10 por vistas por día</h3>
          <app-bar-chart [data]="bars(a.top.viewsPerDay, 'viewsPerDay')" label="Top 10 por vistas por día" [format]="fmt1" />
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Interacción (engagement)</h2>
      <p class="explain">
        La <strong>tasa de favoritos</strong> es favoritos ÷ vistas: qué fracción de quienes vieron la obra la marcaron como favorita.
        Mide cuánto gusta una obra, independientemente de cuánta gente la vio.
      </p>
      <div class="grid2">
        <div>
          <h3>Mayor tasa de favoritos</h3>
          <ol class="rank">
            @for (w of a.engagement.topFavRate; track w.id) {
              <li><app-work-link [id]="w.id" [title]="w.title" /> <span class="num">{{ p(w.favRate, 2) }}</span> <small class="muted">({{ n(w.favourites) }}/{{ n(w.views) }})</small></li>
            }
          </ol>
        </div>
        <div>
          <h3>Menor tasa de favoritos</h3>
          <ol class="rank">
            @for (w of a.engagement.bottomFavRate; track w.id) {
              <li><app-work-link [id]="w.id" [title]="w.title" /> <span class="num">{{ p(w.favRate, 2) }}</span> <small class="muted">({{ n(w.favourites) }}/{{ n(w.views) }})</small></li>
            }
          </ol>
        </div>
      </div>
      @if (a.engagement.topCommentRate.length && a.engagement.topCommentRate[0].commentRate) {
        <h3>Mayor tasa de comentarios</h3>
        <ol class="rank rank--inline">
          @for (w of a.engagement.topCommentRate.slice(0, 5); track w.id) {
            <li><app-work-link [id]="w.id" [title]="w.title" /> <span class="num">{{ p(w.commentRate, 2) }}</span></li>
          }
        </ol>
      }
    </section>

    <section class="card">
      <h2>Valores atípicos</h2>
      <p class="explain">
        Se usa el criterio <strong>IQR</strong> (de Tukey): una obra es atípica si queda por encima de Q3 + 1,5 × (Q3 − Q1) o por debajo de
        Q1 − 1,5 × (Q3 − Q1). El <strong>z</strong> indica a cuántas desviaciones estándar está del promedio.
      </p>
      <div class="grid2">
        @for (o of a.outliers; track o.metric) {
          <div>
            <h3>{{ label[o.metric] }}</h3>
            <p class="muted small">Rango normal: {{ mv(o.metric, max0(o.lower)) }} – {{ mv(o.metric, o.upper) }} · {{ o.high.length }} altas, {{ o.low.length }} bajas</p>
            @if (o.high.length) {
              <ul class="plain small">
                @for (h of o.high.slice(0, 5); track h.id) {
                  <li>▲ <app-work-link [id]="h.id" [title]="h.title" /> — {{ mv(o.metric, h.value) }} <span class="muted">(z = {{ n(h.z, 1) }})</span></li>
                }
                @if (o.high.length > 5) {
                  <li class="muted">… y {{ o.high.length - 5 }} más</li>
                }
              </ul>
            }
            @for (l of o.low.slice(0, 3); track l.id) {
              <p class="small">▼ <app-work-link [id]="l.id" [title]="l.title" /> — {{ mv(o.metric, l.value) }}</p>
            }
            @if (!o.high.length && !o.low.length) {
              <p class="muted small">Sin atípicos.</p>
            }
          </div>
        }
      </div>
    </section>

    <section class="card">
      <h2>Correlación entre métricas</h2>
      <p class="explain">
        La correlación va de −1 a 1: cerca de 1, cuando una sube la otra también; cerca de 0, no hay relación; negativa, una sube cuando la otra baja.
        <strong>Pearson</strong> mide relación lineal y se deja llevar por los extremos; <strong>Spearman</strong> usa posiciones (rangos) y es más
        robusta con datos tan desiguales como las vistas. Correlación no implica causalidad.
      </p>
      <div class="seg" role="group" aria-label="Tipo de correlación">
        <button type="button" [class.seg--on]="corrKind() === 'spearman'" (click)="corrKind.set('spearman')">Spearman</button>
        <button type="button" [class.seg--on]="corrKind() === 'pearson'" (click)="corrKind.set('pearson')">Pearson</button>
      </div>
      <div class="table-wrap">
        <table class="corr">
          <thead>
            <tr>
              <th scope="col"></th>
              @for (l of a.correlations.labels; track l) {
                <th scope="col">{{ l }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of corrMatrix(); track $index; let i = $index) {
              <tr>
                <th scope="row">{{ a.correlations.labels[i] }}</th>
                @for (v of row; track $index) {
                  <td [style.background]="heat(v)" [title]="corrLabel(v)">{{ corr(v) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <h3>Vistas vs. favoritos (escala logarítmica)</h3>
      <app-scatter-chart [points]="scatter()" xLabel="vistas" yLabel="favoritos" label="Dispersión de vistas contra favoritos" />
    </section>

    <section class="card">
      <h2>Rendimiento por etiqueta</h2>
      <p class="explain">
        Promedio de vistas de las obras que llevan cada etiqueta. Las etiquetas con menos de {{ a.tags.minWorks }} obras se muestran atenuadas
        y marcadas: con tan pocas obras, el promedio puede ser casualidad. Hay {{ n(a.tags.totalDistinct) }} etiquetas distintas en total.
      </p>
      <app-bar-chart [data]="tagBars()" label="Vistas promedio por etiqueta" [format]="fmt0" />
      <details>
        <summary>Ver tabla de etiquetas</summary>
        <div class="table-wrap">
          <table class="stats">
            <thead>
              <tr><th scope="col">Etiqueta</th><th scope="col" class="num">Obras</th><th scope="col" class="num">Vistas (media)</th><th scope="col" class="num">Vistas (mediana)</th><th scope="col" class="num">Favs (media)</th><th scope="col" class="num">Tasa fav.</th></tr>
            </thead>
            <tbody>
              @for (t of a.tags.items; track t.key) {
                <tr [class.muted]="t.lowSample">
                  <th scope="row">{{ t.label }}@if (t.lowSample) { <span class="badge">muestra pequeña</span>}</th>
                  <td class="num">{{ t.count }}</td><td class="num">{{ n(t.meanViews) }}</td><td class="num">{{ n(t.medianViews) }}</td>
                  <td class="num">{{ n(t.meanFavourites, 1) }}</td><td class="num">{{ p(t.meanFavRate, 2) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </details>
    </section>

    <section class="card">
      <h2>Rendimiento por fecha de publicación</h2>
      <p class="explain">
        Agrupa las obras según cuándo se publicaron (hora de Bogotá). Se muestra la <strong>mediana</strong> de vistas por defecto, que no se
        distorsiona por una sola obra viral. Ojo: los periodos recientes tienen obras con menos tiempo para acumular vistas.
      </p>
      <div class="seg" role="group" aria-label="Agrupar por">
        @for (g of dateGroups; track g.key) {
          <button type="button" [class.seg--on]="dateGroup() === g.key" (click)="dateGroup.set(g.key)">{{ g.label }}</button>
        }
      </div>
      <div class="seg" role="group" aria-label="Métrica">
        @for (m of groupMetrics; track m.key) {
          <button type="button" [class.seg--on]="groupMetric() === m.key" (click)="groupMetric.set(m.key)">{{ m.label }}</button>
        }
      </div>
      <app-column-chart [data]="dateCols()" [label]="'Obras por ' + dateGroup()" [maxLabels]="dateGroup() === 'byMonth' ? 10 : 24" />
    </section>

    @if (!bench) {
    <section class="card">
      <h2>Crecimiento entre sincronizaciones</h2>
      @if (a.growth; as g) {
        <p class="explain">Cambio entre la primera y la última sincronización de cada obra ({{ dt(g.from) }} → {{ dt(g.to) }}).</p>
        <div class="kpis">
          <div class="kpi"><span>Vistas ganadas</span><strong>+{{ n(g.views) }}</strong></div>
          <div class="kpi"><span>Favoritos ganados</span><strong>+{{ n(g.favourites) }}</strong></div>
          <div class="kpi"><span>Comentarios ganados</span><strong>+{{ n(g.comments) }}</strong></div>
        </div>
        <h3>Las que más crecieron</h3>
        <app-bar-chart [data]="growthBars()" label="Obras con más vistas ganadas" />
        @if (timeline().length) {
          <h3>Evolución de los totales</h3>
          <app-line-chart [series]="timeline()" label="Totales del artista por sincronización" />
        }
      } @else {
        <p class="empty">
          Aún no hay historial: se necesitan al menos dos sincronizaciones. Cada sincronización guarda una “foto” de las métricas;
          vuelve a sincronizar más tarde (o activa la sincronización automática) para ver cuánto crece cada obra.
        </p>
      }
    </section>
    }
    <p class="muted small">Análisis generado {{ dt(a.generatedAt) }}.</p>
  `,
})
export class AnalysisView {
  readonly analysis = input.required<Analysis>();
  readonly works = input<Work[]>([]);
  readonly username = input('');
  /** Reclasificación hecha desde la sección de franquicias: hay que recargar. */
  readonly changed = output<void>();
  /** Presente cuando se analiza una muestra de tendencias (no una galería). */
  protected readonly bench = inject(BENCHMARK_CONTEXT, { optional: true });

  protected readonly n = num;
  protected readonly c = compact;
  protected readonly p = pct;
  protected readonly d = date;
  protected readonly dt = dateTime;
  protected readonly corr = corr;
  protected readonly corrLabel = corrLabel;
  protected readonly mv = metricValue;
  protected readonly label = METRIC_LABEL;
  protected readonly fmt1 = (v: number | null) => num(v, 1);
  protected readonly fmt0 = (v: number | null) => num(v, 0);
  protected readonly max0 = (v: number) => Math.max(0, v);

  protected readonly corrKind = signal<'spearman' | 'pearson'>('spearman');
  protected readonly dateGroup = signal<DateGroup>('byMonth');
  protected readonly groupMetric = signal<GroupMetric>('medianViews');
  protected readonly dateGroups: { key: DateGroup; label: string }[] = [
    { key: 'byMonth', label: 'Mes' },
    { key: 'byYear', label: 'Año' },
    { key: 'byWeekday', label: 'Día de la semana' },
    { key: 'byHour', label: 'Hora' },
  ];
  protected readonly groupMetrics: { key: GroupMetric; label: string }[] = [
    { key: 'medianViews', label: 'Mediana de vistas' },
    { key: 'meanViews', label: 'Media de vistas' },
    { key: 'meanFavourites', label: 'Media de favoritos' },
    { key: 'count', label: 'N.º de obras' },
  ];

  protected readonly descRows = computed(() => {
    const d = this.analysis().descriptive;
    return (['views', 'favourites', 'comments', 'viewsPerDay', 'favRate', 'commentRate'] as const).map((key) => ({ key, label: METRIC_LABEL[key], d: d[key] as Descriptive }));
  });

  protected bars(rows: WorkRow[], key: 'views' | 'viewsPerDay'): Bar[] {
    const urls = this.bench?.urls();
    return rows.map((w) => (urls ? { label: w.title, value: w[key], href: urls.get(w.id) } : { label: w.title, value: w[key], link: ['/obra', w.id] }));
  }

  protected readonly corrMatrix = computed(() => this.analysis().correlations[this.corrKind()]);
  protected heat(v: number | null) {
    if (v === null) return 'transparent';
    const a = Math.min(1, Math.abs(v)) * 0.55;
    return v >= 0 ? `rgba(0, 229, 155, ${a})` : `rgba(255, 99, 99, ${a})`;
  }

  protected readonly scatter = computed<ScatterPoint[]>(() =>
    this.works()
      .filter((w) => w.metricsAt)
      .map((w) => ({ x: w.views, y: w.favourites, label: `${w.title}: ${num(w.views)} vistas, ${num(w.favourites)} favoritos` })),
  );

  protected readonly tagBars = computed<Bar[]>(() =>
    this.analysis()
      .tags.items.slice(0, 20)
      .map((t) => ({ label: t.label, value: t.meanViews, hint: `${t.count} obras${t.lowSample ? ', muestra pequeña' : ''}`, muted: t.lowSample })),
  );

  protected readonly dateCols = computed<Column[]>(() => {
    const m = this.groupMetric();
    return (this.analysis()[this.dateGroup()] as GroupStat[]).map((g) => ({
      label: g.label,
      value: g[m],
      hint: `${g.count} obras`,
      muted: g.lowSample,
    }));
  });

  protected readonly growthBars = computed<Bar[]>(() =>
    (this.analysis().growth?.top ?? []).map((g) => ({ label: g.title, value: g.views, hint: `+${num(g.favourites)} favs` })),
  );

  protected readonly timeline = computed<LineSeries[]>(() => {
    const t = this.analysis().timeline;
    if (t.length < 2) return [];
    return [
      { name: 'Vistas', cls: 's1', points: t.map((x) => ({ x: Date.parse(x.takenAt), y: x.views })) },
      { name: 'Favoritos', cls: 's2', points: t.map((x) => ({ x: Date.parse(x.takenAt), y: x.favourites })) },
    ];
  });
}
