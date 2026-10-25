import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../api.service';
import { BarChart, type Bar } from '../charts/bar-chart';
import { StackedChart, type StackSeries } from '../charts/stacked-chart';
import { compact, num, pct, pValue, RATING_LABEL } from '../format';
import type { CategoryStat, ClassificationAnalysis, MannWhitney } from '../models';

type CatMetric = 'count' | 'medianViews' | 'totalViews' | 'viewsShare' | 'medianFavRate' | 'medianViewsPerDay';

const METRICS: { key: CatMetric; label: string }[] = [
  { key: 'count', label: 'N.º de obras' },
  { key: 'medianViews', label: 'Mediana de vistas' },
  { key: 'totalViews', label: 'Vistas totales' },
  { key: 'viewsShare', label: '% de las vistas' },
  { key: 'medianFavRate', label: 'Tasa de favoritos' },
  { key: 'medianViewsPerDay', label: 'Vistas por día' },
];

/** Análisis por franquicia o fuente, por personaje y SFW/NSFW, con sus cruces. */
@Component({
  selector: 'app-classification-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BarChart, StackedChart],
  template: `
    @let c = data();
    <section class="card" id="clasificacion">
      <div class="card-head">
        <h2>Franquicias, personajes y SFW/NSFW</h2>
        <div class="card-head__actions">
          <button type="button" class="btn" (click)="reclassify()" [disabled]="busy()">{{ busy() ? 'Reclasificando…' : 'Reclasificar todo' }}</button>
          <a class="btn" routerLink="/diccionario">Diccionario</a>
        </div>
      </div>
      <p class="explain">
        Cada obra se clasifica con reglas sobre sus <strong>etiquetas</strong> y su <strong>título</strong> (y, si no hay nada, su descripción), usando un
        diccionario de franquicias y personajes que puedes ampliar. Un personaje identificado implica su franquicia (Sarada Uchiha → Naruto).
        Una obra puede tener varias franquicias, por eso los porcentajes pueden sumar más de 100 %. <strong>SFW/NSFW</strong> no se adivina: es la
        marca de contenido maduro que pone DeviantArt. Las categorías con menos de {{ c.minWorks }} obras van atenuadas y marcadas como
        <em>muestra pequeña</em>. Toca un nombre para ver sus obras.
      </p>
      <div class="kpis">
        <div class="kpi"><span>Con franquicia o fuente</span><strong>{{ p(cov().withFranchise / (cov().works || 1), 0) }}</strong><small class="muted">{{ n(cov().withFranchise) }} de {{ n(cov().works) }}</small></div>
        <div class="kpi"><span>Fanart (franquicia existente)</span><strong>{{ n(cov().fanart) }}</strong><small class="muted">{{ n(cov().franchisesDistinct) }} franquicias distintas</small></div>
        <div class="kpi"><span>Originales</span><strong>{{ n(cov().original) }}</strong></div>
        <div class="kpi"><span>Sin clasificar</span><strong>{{ n(cov().unclassified) }}</strong></div>
        <div class="kpi"><span>Con personaje identificado</span><strong>{{ n(cov().withCharacter) }}</strong><small class="muted">{{ n(cov().charactersDistinct) }} personajes</small></div>
        <div class="kpi"><span>Correcciones manuales</span><strong>{{ n(cov().overrides) }}</strong></div>
      </div>
      @if (notice()) {
        <p class="alert" role="status">{{ notice() }}</p>
      }
    </section>

    <section class="card">
      <h2>Por franquicia o fuente</h2>
      <div class="seg" role="group" aria-label="Métrica por franquicia">
        @for (m of metrics; track m.key) {
          <button type="button" [class.seg--on]="frMetric() === m.key" (click)="frMetric.set(m.key)">{{ m.label }}</button>
        }
      </div>
      <app-bar-chart [data]="frBars()" label="Franquicias" [format]="fmt(frMetric())" />
      @if (frMetric() !== 'count') {
        <p class="muted small">Al ordenar por una métrica se omiten las categorías con menos de {{ c.minWorks }} obras (se ven en la tabla).</p>
      }
      <details>
        <summary>Ver tabla completa de franquicias ({{ c.franchises.length }})</summary>
        <div class="table-wrap">
          <table class="stats cat-table">
            <thead>
              <tr>
                <th scope="col">Franquicia</th><th scope="col" class="num">Obras</th><th scope="col" class="num">% obras</th><th scope="col" class="num">Vistas totales</th>
                <th scope="col" class="num">% vistas</th><th scope="col" class="num">Mediana vistas</th><th scope="col" class="num">Media vistas</th>
                <th scope="col" class="num">Mediana favs</th><th scope="col" class="num">Mediana coment.</th><th scope="col" class="num">Tasa fav.</th>
                <th scope="col" class="num">Vistas/día</th><th scope="col" class="num">% NSFW</th><th scope="col">Obra más vista</th>
              </tr>
            </thead>
            <tbody>
              @for (r of c.franchises; track r.key) {
                <tr [class.muted]="r.lowSample">
                  <th scope="row"><a [routerLink]="[]" [queryParams]="{ tab: null, franquicia: r.key }">{{ r.label }}</a>@if (r.lowSample) { <span class="badge">muestra pequeña</span>}</th>
                  <td class="num">{{ n(r.count) }}</td><td class="num">{{ p(r.share) }}</td><td class="num">{{ n(r.totalViews) }}</td><td class="num">{{ p(r.viewsShare) }}</td>
                  <td class="num"><strong>{{ n(r.medianViews) }}</strong></td><td class="num">{{ n(r.meanViews) }}</td><td class="num">{{ n(r.medianFavourites) }}</td>
                  <td class="num">{{ n(r.medianComments) }}</td><td class="num">{{ p(r.medianFavRate, 2) }}</td><td class="num">{{ n(r.medianViewsPerDay, 1) }}</td>
                  <td class="num">{{ p(r.nsfwShare, 0) }}</td>
                  <td class="top-work">@if (r.top[0]; as t) {<a [routerLink]="['/obra', t.id]">{{ t.title }}</a> <small class="muted">({{ c2(t.views) }})</small>}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </details>
    </section>

    <section class="card">
      <h2>Por personaje</h2>
      <div class="seg" role="group" aria-label="Métrica por personaje">
        @for (m of metrics; track m.key) {
          <button type="button" [class.seg--on]="chMetric() === m.key" (click)="chMetric.set(m.key)">{{ m.label }}</button>
        }
      </div>
      <app-bar-chart [data]="chBars()" label="Personajes" [format]="fmt(chMetric())" />
      @if (chMetric() !== 'count') {
        <p class="muted small">Al ordenar por una métrica se omiten los personajes con menos de {{ c.minWorks }} obras (se ven en la tabla).</p>
      }
      <h3>Personajes con más vistas por obra (mediana, al menos 2 obras)</h3>
      <p class="muted small">Primero los que tienen {{ c.minWorks }} obras o más; con menos, el resultado puede ser casualidad.</p>
      <app-bar-chart [data]="topChBars()" label="Top personajes por mediana de vistas" [format]="fmt('medianViews')" />
      <details>
        <summary>Ver tabla de personajes ({{ c.characters.length }})</summary>
        <div class="table-wrap">
          <table class="stats cat-table">
            <thead>
              <tr>
                <th scope="col">Personaje</th><th scope="col">Franquicia</th><th scope="col" class="num">Obras</th><th scope="col" class="num">Vistas totales</th>
                <th scope="col" class="num">Mediana vistas</th><th scope="col" class="num">Media vistas</th><th scope="col" class="num">Mediana favs</th>
                <th scope="col" class="num">Tasa fav.</th><th scope="col" class="num">Vistas/día</th><th scope="col" class="num">% NSFW</th><th scope="col">Obra más vista</th>
              </tr>
            </thead>
            <tbody>
              @for (r of c.characters; track r.key) {
                <tr [class.muted]="r.lowSample">
                  <th scope="row"><a [routerLink]="[]" [queryParams]="{ tab: null, personaje: r.key }">{{ r.label }}</a>@if (r.lowSample) { <span class="badge">muestra pequeña</span>}</th>
                  <td>{{ r.franchise ?? '—' }}</td>
                  <td class="num">{{ n(r.count) }}</td><td class="num">{{ n(r.totalViews) }}</td><td class="num"><strong>{{ n(r.medianViews) }}</strong></td>
                  <td class="num">{{ n(r.meanViews) }}</td><td class="num">{{ n(r.medianFavourites) }}</td><td class="num">{{ p(r.medianFavRate, 2) }}</td>
                  <td class="num">{{ n(r.medianViewsPerDay, 1) }}</td><td class="num">{{ p(r.nsfwShare, 0) }}</td>
                  <td class="top-work">@if (r.top[0]; as t) {<a [routerLink]="['/obra', t.id]">{{ t.title }}</a> <small class="muted">({{ c2(t.views) }})</small>}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </details>
    </section>

    <section class="card">
      <h2>SFW vs. NSFW</h2>
      <p class="explain">
        Según la marca de contenido maduro de DeviantArt (<code>media:rating</code> del RSS y <code>safety</code> de oEmbed).
        @if (unknown()) {
          {{ n(unknown()) }} obra(s) no traen la marca y quedan como “desconocido”.
        } @else {
          Todas las obras traen la marca; ninguna queda como “desconocido”.
        }
      </p>
      <div class="kpis">
        @for (r of c.ratings; track r.key) {
          <a class="kpi kpi--link" [class.kpi--nsfw]="r.key === 'nsfw'" [routerLink]="[]" [queryParams]="{ tab: null, clasif: r.key }">
            <span>{{ r.label }} · {{ n(r.count) }} obras ({{ p(r.share, 0) }})</span>
            <strong>{{ n(r.medianViews) }}</strong>
            <small class="muted">mediana de vistas · tasa fav. {{ p(r.medianFavRate, 2) }} · {{ n(r.medianViewsPerDay, 1) }} vistas/día · {{ p(r.viewsShare, 0) }} de las vistas</small>
          </a>
        }
      </div>
      @if (c.ratingTest; as t) {
        <h3>¿La diferencia es real o casualidad?</h3>
        <p class="explain">
          Prueba de <strong>Mann–Whitney</strong> (compara posiciones, no promedios, así una obra viral no decide el resultado). Un p-valor menor que
          0,05 sugiere que la diferencia no es casualidad. La <strong>probabilidad de superioridad</strong> es la probabilidad de que una obra NSFW al
          azar supere a una SFW al azar (50 % = sin diferencia).
        </p>
        <div class="table-wrap">
          <table class="stats">
            <thead><tr><th scope="col">Métrica</th><th scope="col" class="num">NSFW (n)</th><th scope="col" class="num">SFW (n)</th><th scope="col" class="num">p-valor</th><th scope="col" class="num">P(NSFW &gt; SFW)</th><th scope="col">Lectura</th></tr></thead>
            <tbody>
              @for (row of testRows(); track row.label) {
                <tr>
                  <th scope="row">{{ row.label }}</th>
                  @if (row.t; as m) {
                    <td class="num">{{ n(m.n1) }}</td><td class="num">{{ n(m.n2) }}</td><td class="num">{{ pv(m.p) }}</td><td class="num">{{ p(m.probSuperiority, 0) }}</td>
                    <td>{{ reading(m) }}</td>
                  } @else {
                    <td colspan="5" class="muted">No hay suficientes obras en ambos grupos.</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <h3>SFW vs. NSFW por franquicia (con al menos {{ c.minWorks }} obras)</h3>
      @if (c.franchiseByRating.length) {
        <div class="table-wrap">
          <table class="stats">
            <thead>
              <tr>
                <th scope="col">Franquicia</th><th scope="col" class="num">Obras SFW</th><th scope="col" class="num">Mediana vistas SFW</th>
                <th scope="col" class="num">Obras NSFW</th><th scope="col" class="num">Mediana vistas NSFW</th><th scope="col" class="num">NSFW ÷ SFW</th>
              </tr>
            </thead>
            <tbody>
              @for (r of c.franchiseByRating; track r.key) {
                <tr>
                  <th scope="row"><a [routerLink]="[]" [queryParams]="{ tab: null, franquicia: r.key }">{{ r.label }}</a></th>
                  <td class="num" [class.muted]="r.sfw.lowSample">{{ n(r.sfw.count) }}</td>
                  <td class="num" [class.muted]="r.sfw.lowSample">{{ n(r.sfw.medianViews) }}@if (r.sfw.count && r.sfw.lowSample) {<span class="badge" title="Menos de {{ c.minWorks }} obras">poca</span>}</td>
                  <td class="num" [class.muted]="r.nsfw.lowSample">{{ n(r.nsfw.count) }}</td>
                  <td class="num" [class.muted]="r.nsfw.lowSample">{{ n(r.nsfw.medianViews) }}@if (r.nsfw.count && r.nsfw.lowSample) {<span class="badge" title="Menos de {{ c.minWorks }} obras">poca</span>}</td>
                  <td class="num">@if (r.ratio !== null) {<strong>{{ n(r.ratio, 1) }}×</strong>} @else {—}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="muted small">“NSFW ÷ SFW” = cuántas veces más vistas (en mediana) tiene una obra NSFW de esa franquicia que una SFW. Solo se calcula si ambos grupos tienen al menos {{ c.minWorks }} obras.</p>
      } @else {
        <p class="muted">Ninguna franquicia tiene suficientes obras para comparar.</p>
      }
    </section>

    <section class="card">
      <h2>Franquicias a lo largo del tiempo</h2>
      <p class="explain">Obras publicadas por año de las franquicias o fuentes con más obras (hasta {{ c.franchiseByYear.series.length }}; hora de Bogotá). Los años recientes tienen obras con menos tiempo para acumular vistas.</p>
      <div class="seg" role="group" aria-label="Vista de la tendencia">
        <button type="button" [class.seg--on]="yearView() === 'count'" (click)="yearView.set('count')">Obras por año</button>
        <button type="button" [class.seg--on]="yearView() === 'median'" (click)="yearView.set('median')">Mediana de vistas por año</button>
      </div>
      @if (yearView() === 'count') {
        <app-stacked-chart [labels]="c.franchiseByYear.years" [series]="yearSeries()" label="Obras por año y franquicia" />
      } @else {
        <div class="table-wrap">
          <table class="stats heat">
            <thead><tr><th scope="col">Franquicia</th>@for (y of c.franchiseByYear.years; track y) {<th scope="col" class="num">{{ y }}</th>}</tr></thead>
            <tbody>
              @for (s of c.franchiseByYear.series; track s.key) {
                <tr>
                  <th scope="row">{{ s.label }}</th>
                  @for (v of s.medianViews; track $index; let i = $index) {
                    <td class="num" [style.background]="heat(v)" [title]="s.counts[i] + ' obras'" [class.muted]="s.counts[i] > 0 && s.counts[i] < c.minWorks">{{ s.counts[i] ? c2(v) : '' }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="muted small">Cada celda es la mediana de vistas de las obras de ese año; las celdas atenuadas tienen menos de {{ c.minWorks }} obras.</p>
      }
    </section>
  `,
})
export class ClassificationView {
  private readonly api = inject(ApiService);
  readonly data = input.required<ClassificationAnalysis>();
  readonly username = input.required<string>();
  /** Se emite tras reclasificar, para recargar obras y análisis. */
  readonly changed = output<void>();

  protected readonly metrics = METRICS;
  protected readonly frMetric = signal<CatMetric>('count');
  protected readonly chMetric = signal<CatMetric>('count');
  protected readonly yearView = signal<'count' | 'median'>('count');
  protected readonly busy = signal(false);
  protected readonly notice = signal('');
  protected readonly n = num;
  protected readonly p = pct;
  protected readonly c2 = compact;
  protected readonly pv = pValue;

  protected readonly cov = computed(() => this.data().coverage);
  protected readonly unknown = computed(() => this.data().ratings.find((r) => r.key === 'desconocido')?.count ?? 0);

  protected fmt(m: CatMetric) {
    if (m === 'viewsShare' || m === 'medianFavRate') return (v: number | null) => pct(v, m === 'medianFavRate' ? 2 : 1);
    return (v: number | null) => num(v, m === 'medianViewsPerDay' ? 1 : 0);
  }

  private bars(rows: CategoryStat[], m: CatMetric, param: 'franquicia' | 'personaje', limit = 15): Bar[] {
    // Al ordenar por una métrica, una categoría con 1–4 obras puede quedar primera por casualidad: se omiten (salvo que no haya otras).
    const reliable = rows.filter((r) => !r.lowSample);
    const pool = m === 'count' || !reliable.length ? rows : reliable;
    return [...pool]
      .sort((a, b) => (m === 'count' ? 0 : (b[m] ?? -1) - (a[m] ?? -1)) || b.count - a.count)
      .slice(0, limit)
      .map((r) => ({
        label: r.franchise ? `${r.label} · ${r.franchise}` : r.label,
        value: r[m],
        hint: m === 'count' ? (r.lowSample ? 'muestra pequeña' : undefined) : `${r.count} obras${r.lowSample ? ', muestra pequeña' : ''}`,
        muted: r.lowSample,
        link: [],
        query: { tab: null, [param]: r.key },
      }));
  }
  protected readonly frBars = computed(() => this.bars(this.data().franchises, this.frMetric(), 'franquicia'));
  protected readonly chBars = computed(() => this.bars(this.data().characters, this.chMetric(), 'personaje'));
  protected readonly topChBars = computed<Bar[]>(() =>
    this.data()
      .topCharactersByMedian.slice(0, 12)
      .map((r) => ({
        label: r.franchise ? `${r.label} · ${r.franchise}` : r.label,
        value: r.medianViews,
        hint: `${r.count} obras${r.lowSample ? ', muestra pequeña' : ''}`,
        muted: r.lowSample,
        link: [],
        query: { tab: null, personaje: r.key },
      })),
  );

  protected readonly testRows = computed(() => {
    const t = this.data().ratingTest;
    return [
      { label: 'Vistas', t: t?.views ?? null },
      { label: 'Favoritos / vistas', t: t?.favRate ?? null },
      { label: 'Vistas por día', t: t?.viewsPerDay ?? null },
    ];
  });
  protected reading(m: MannWhitney): string {
    if (m.p >= 0.05) return 'Sin diferencia clara (podría ser casualidad).';
    const s = Math.abs(m.probSuperiority - 0.5);
    const size = s >= 0.21 ? 'grande' : s >= 0.14 ? 'moderada' : 'pequeña';
    return `${m.probSuperiority > 0.5 ? RATING_LABEL['nsfw'] : RATING_LABEL['sfw']} rinde más · diferencia ${size}.`;
  }

  protected readonly yearSeries = computed<StackSeries[]>(() => this.data().franchiseByYear.series.map((s) => ({ name: s.label, values: s.counts })));
  private readonly heatMax = computed(() => Math.max(1, ...this.data().franchiseByYear.series.flatMap((s) => s.medianViews.map((v) => v ?? 0))));
  protected heat(v: number | null) {
    if (!v) return 'transparent';
    return `rgba(0, 229, 155, ${(Math.sqrt(v / this.heatMax()) * 0.55).toFixed(3)})`;
  }

  protected async reclassify() {
    this.busy.set(true);
    this.notice.set('');
    try {
      const r = await this.api.reclassify(this.username());
      this.notice.set(`Listo: ${num(r.works)} obras reclasificadas · ${num(r.withFranchise)} con franquicia, ${num(r.unclassified)} sin clasificar, ${num(r.overrides)} correcciones manuales respetadas.`);
      this.changed.emit();
    } catch (e) {
      this.notice.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
