import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ColumnChart, type Column } from '../charts/column-chart';
import { CompareBars, CompareColumns, type CompareGroup, type CompareRow } from '../charts/compare-chart';
import { ageText, compact, dateTime, num, pct, pValue, scopeLabel } from '../format';
import type { Advice, Contrast, GroupKey, GroupSummary, ShareRow, TimingRow } from '../models';

type ShareKind = 'tags' | 'franchises' | 'characters';

const TONE_LABEL: Record<Advice['tone'], string> = { fortaleza: 'Fortaleza', oportunidad: 'Oportunidad', alerta: 'Alerta', info: 'Dato' };

/** Contraste artista ↔ Recientes ↔ Populares y consejos basados en reglas, con sus cifras. */
@Component({
  selector: 'app-contrast-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CompareBars, CompareColumns, ColumnChart],
  template: `
    @let c = data();
    <section class="card">
      <h2>Consejos para @{{ c.username }}</h2>
      <p class="explain">
        Reglas explícitas sobre tus datos y las muestras (nada de IA): cada consejo muestra las cifras en las que se basa y una
        <strong>confianza</strong> según el tamaño de la muestra (alta ≥ 30 datos, media ≥ 10, baja con menos). Están ordenados por importancia
        (tamaño del efecto × confianza). Son correlaciones: pruébalos y vuelve a medir.
      </p>
      @if (!c.advice.length) {
        <p class="empty">No hay datos suficientes para recomendar algo con respaldo. Sincroniza más obras o mide muestras más grandes.</p>
      }
      <ol class="advice">
        @for (a of shownAdvice(); track a.id; let i = $index) {
          <li class="advice__item" [attr.data-tone]="a.tone">
            <div class="advice__head">
              <span class="advice__n">{{ i + 1 }}</span>
              <h3>{{ a.title }}</h3>
              <span class="badge">{{ tone[a.tone] }} · {{ a.area }}</span>
              <span class="badge conf" [attr.data-conf]="a.confidence">confianza {{ a.confidence }}</span>
            </div>
            <p>{{ a.text }}</p>
            <dl class="evidence">
              @for (e of a.evidence; track $index) {
                <div><dt>{{ e.label }}</dt><dd>{{ e.value }}</dd></div>
              }
            </dl>
          </li>
        }
      </ol>
      @if (c.advice.length > 5) {
        <button type="button" class="btn" (click)="allAdvice.set(!allAdvice())">{{ allAdvice() ? 'Ver solo los 5 principales' : 'Ver los ' + c.advice.length + ' consejos' }}</button>
      }
    </section>

    <section class="card">
      <h2>Cara a cara</h2>
      <p class="explain">
        Las mismas métricas para tu galería y para cada muestra. Las tasas (favoritos ÷ vistas) solo cuentan obras con al menos 30 vistas.
        Las muestras se midieron {{ measuredText() }}.
      </p>
      <div class="table-wrap">
        <table class="stats">
          <thead>
            <tr>
              <th scope="col">Métrica</th>
              @for (g of c.summary; track g.key) {
                <th scope="col" class="num"><span [attr.class]="'legend__item cmp-key--' + g.key">{{ g.label }}</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (m of summaryRows; track m.key) {
              <tr>
                <th scope="row">{{ m.label }}</th>
                @for (g of c.summary; track g.key) {
                  <td class="num">{{ m.fmt(g) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      @for (note of c.notes; track $index) {
        <p class="muted small">{{ note }}</p>
      }
    </section>

    @if (c.percentiles.length) {
      <section class="card">
        <h2>¿Dónde quedas dentro de cada muestra?</h2>
        <p class="explain">
          El <strong>percentil</strong> dice qué parte de la muestra queda por debajo: percentil 70 = superas al 70 % de esas obras. Se calcula con
          la obra típica (mediana) de tu galería y con tu mejor obra.
        </p>
        <div class="table-wrap">
          <table class="stats">
            <thead>
              <tr>
                <th scope="col">Muestra</th><th scope="col">Métrica</th><th scope="col" class="num">Tu mediana</th><th scope="col" class="num">Mediana muestra</th>
                <th scope="col">Percentil de tu obra típica</th><th scope="col" class="num">Tus obras sobre su mediana</th><th scope="col" class="num">Percentil de tu mejor obra</th>
              </tr>
            </thead>
            <tbody>
              @for (r of c.percentiles; track r.benchmark + r.metric) {
                <tr>
                  <td>{{ r.benchmark === 'recent' ? 'Recientes' : 'Populares' }}</td>
                  <th scope="row">{{ r.label }}</th>
                  <td class="num">{{ fmtMetric(r.metric, r.artistMedian) }}</td>
                  <td class="num">{{ fmtMetric(r.metric, r.benchmarkMedian) }}</td>
                  <td>
                    <span class="meter" role="img" [attr.aria-label]="'Percentil ' + n(r.percentileOfMedian)"><span class="meter__fill" [style.width.%]="r.percentileOfMedian ?? 0"></span></span>
                    {{ n(r.percentileOfMedian) }}
                  </td>
                  <td class="num">{{ p(r.shareAboveMedian, 0) }}</td>
                  <td class="num">{{ n(r.percentileOfBest) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="muted small">Ojo: las obras de Recientes tienen minutos de vida y las de Populares, años. Para comparar a igual edad, mira la siguiente sección.</p>
      </section>
    }

    <section class="card">
      <h2>A igual edad</h2>
      <p class="explain">
        Vistas por día según la edad que tenía cada obra al medirla. Para tu galería se usa el historial de sincronizaciones (cuántas vistas tenía cada obra
        a esa edad), así una obra tuya de 10 horas se compara con obras de Recientes de 10 horas. Las celdas con menos de 5 obras van atenuadas.
      </p>
      <app-compare-columns [groups]="groups()" [data]="ageRows()" [muted]="ageMuted" label="Vistas por día según la edad de la obra" />
      <div class="table-wrap">
        <table class="stats">
          <thead>
            <tr>
              <th scope="col">Edad de la obra</th>
              @for (g of groups(); track g.key) {
                <th scope="col" class="num">{{ g.name }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (b of c.ageBuckets; track b.key) {
              <tr>
                <th scope="row">{{ b.label }}</th>
                @for (g of groups(); track g.key) {
                  @let cell = b.cells[g.key];
                  <td class="num" [class.muted]="!cell || cell.lowSample">
                    @if (cell && cell.n) {
                      {{ n(cell.medianViewsPerDay, 1) }} <small>vistas/día · {{ c2(cell.medianViews) }} vistas · {{ cell.n }} obras</small>
                    } @else {
                      —
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (c.artistEarlyPoints < 3) {
        <p class="muted small">Tienes {{ c.artistEarlyPoints }} obra(s) medidas antes de cumplir 1 día: sincroniza el día en que publicas para comparar tu arranque.</p>
      }
    </section>

    <section class="card">
      <h2>Etiquetas, franquicias y personajes</h2>
      <p class="explain">
        Qué fracción de cada grupo usa cada etiqueta o franquicia. <strong>Tu rendimiento</strong> compara tus obras con ella frente a tus obras de edad
        parecida (2× = el doble de vistas de lo normal para su edad). Las etiquetas marcadas <em>muestreo</em> son las que se usaron para reunir la muestra general: aparecen
        mucho por cómo se tomó la muestra, no por tendencia.
      </p>
      <div class="seg" role="group" aria-label="Qué comparar">
        <button type="button" [class.seg--on]="shareKind() === 'tags'" (click)="shareKind.set('tags')">Etiquetas</button>
        <button type="button" [class.seg--on]="shareKind() === 'franchises'" (click)="shareKind.set('franchises')">Franquicias</button>
        <button type="button" [class.seg--on]="shareKind() === 'characters'" (click)="shareKind.set('characters')">Personajes</button>
      </div>
      <div class="grid2">
        <div>
          <h3>Más presentes en las muestras</h3>
          <app-compare-bars [groups]="shareGroups()" [data]="trendBars()" [format]="pct0" label="Presencia en cada grupo" />
        </div>
        <div>
          <h3>Tus fuertes (sobre lo normal para su edad)</h3>
          @if (strengthRows().length) {
            <app-compare-bars [groups]="liftGroup" [data]="strengthRows()" [format]="lift" label="Tu rendimiento relativo" />
          } @else {
            <p class="muted">Ninguna con 5 obras o más.</p>
          }
        </div>
      </div>
      <details>
        <summary>Ver tabla completa</summary>
        <div class="table-wrap">
          <table class="stats">
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                @if (c.popular) {<th scope="col" class="num">Populares</th>}
                @if (c.recent) {<th scope="col" class="num">Recientes</th>}
                <th scope="col" class="num">Tú</th><th scope="col" class="num">Tus obras</th><th scope="col" class="num">Tu mediana de vistas</th><th scope="col" class="num">Tu rendimiento</th>
              </tr>
            </thead>
            <tbody>
              @for (r of shareRows(); track r.key) {
                <tr>
                  <th scope="row">{{ shareKind() === 'tags' ? '#' + r.label : r.label }}@if (r.sampling) { <span class="badge">muestreo</span>}</th>
                  @if (c.popular) {<td class="num">{{ p(r.popularShare, 0) }} <small class="muted">({{ r.popularCount }})</small></td>}
                  @if (c.recent) {<td class="num">{{ p(r.recentShare, 0) }} <small class="muted">({{ r.recentCount }})</small></td>}
                  <td class="num">{{ p(r.artistShare, 0) }}</td>
                  <td class="num">{{ r.artistCount }}</td>
                  <td class="num">{{ n(r.artistMedianViews) }}</td>
                  <td class="num" [class.muted]="r.artistCount < 5">{{ lift(r.artistLift) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </details>
    </section>

    <section class="card">
      <h2>Horarios (hora de Bogotá)</h2>
      <p class="explain">
        Cuándo publicas tú y cuándo se publicaron las obras de las muestras. Para ti también se muestra tu <strong>rendimiento ajustado por antigüedad</strong>
        según el día de publicación: cada obra se compara con tus obras de edad parecida (1× = lo normal), así una obra nueva no parece mejor solo por ser nueva.
        Solo los días con 5 obras o más cuentan para los consejos.
      </p>
      <div class="grid2">
        <div>
          <h3>Día de la semana · % de las obras</h3>
          <app-compare-columns [groups]="shareGroups()" [data]="timingRows(c.timing.weekdays)" [format]="pct0" label="Obras por día de la semana" />
        </div>
        <div>
          <h3>Franja horaria · % de las obras</h3>
          <app-compare-columns [groups]="shareGroups()" [data]="timingRows(c.timing.blocks)" [format]="pct0" label="Obras por franja horaria" />
        </div>
      </div>
      <h3>Tu rendimiento según el día de publicación (× lo normal para su edad)</h3>
      <app-column-chart [data]="dayPerf()" [format]="lift" label="Tu rendimiento ajustado por antigüedad según el día de publicación" />
    </section>

    <section class="card">
      <h2>SFW y NSFW</h2>
      <div class="table-wrap">
        <table class="stats">
          <thead>
            <tr><th scope="col">Grupo</th><th scope="col" class="num">Obras</th><th scope="col" class="num">NSFW</th><th scope="col" class="num">Mediana SFW</th><th scope="col" class="num">Mediana NSFW</th></tr>
          </thead>
          <tbody>
            @for (r of c.ratingMix; track r.key) {
              <tr>
                <th scope="row">{{ r.label }}</th>
                <td class="num">{{ n(r.n) }}</td>
                <td class="num">{{ p(r.nsfwShare, 0) }}</td>
                <td class="num">{{ n(r.sfwMedianViews) }}</td>
                <td class="num">{{ n(r.nsfwMedianViews) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (c.ratingTest; as rt) {
        @if (rt.index; as t) {
          <p class="muted small">
            En tu galería, a igual edad: NSFW {{ lift(rt.nsfwIndex) }} lo normal vs. SFW {{ lift(rt.sfwIndex) }} · Mann–Whitney {{ pv(t.p) }} · probabilidad de que
            una obra NSFW supere a una SFW de edad parecida: {{ p(t.probSuperiority, 0) }}.
          </p>
        }
      }
      <p class="muted small">DeviantArt oculta el contenido maduro a quien no inicia sesión: por eso las muestras Populares casi no tienen NSFW.</p>
    </section>

    <section class="card">
      <h2>Constancia</h2>
      <p class="explain">
        Obras publicadas por mes (últimos 24 meses). La correlación de Spearman entre obras por mes y vistas por día de esas obras
        es {{ c.cadence.spearman === null ? 'incalculable (pocos meses)' : n(c.cadence.spearman, 2) }} en {{ c.cadence.months }} meses ·
        {{ c.cadence.last90Days }} obra(s) en los últimos 90 días.
      </p>
      <app-column-chart [data]="cadenceCols()" label="Obras publicadas por mes" [maxLabels]="12" />
    </section>
    <p class="muted small">Contraste generado {{ dt(c.generatedAt) }} · alcance: {{ scope(c.scope) }}.</p>
  `,
})
export class ContrastView {
  readonly data = input.required<Contrast>();

  protected readonly n = num;
  protected readonly c2 = compact;
  protected readonly p = pct;
  protected readonly pv = pValue;
  protected readonly dt = dateTime;
  protected readonly scope = scopeLabel;
  protected readonly tone = TONE_LABEL;
  protected readonly pct0 = (v: number | null) => pct(v, 0);
  protected readonly lift = (v: number | null) => (v === null ? '—' : `${num(v, 1)}×`);
  protected readonly allAdvice = signal(false);
  protected readonly shareKind = signal<ShareKind>('tags');
  protected readonly liftGroup: CompareGroup[] = [{ key: 'artist', name: 'Tu rendimiento (× lo normal para su edad)' }];

  protected readonly shownAdvice = computed(() => (this.allAdvice() ? this.data().advice : this.data().advice.slice(0, 5)));

  protected readonly measuredText = computed(() => {
    const c = this.data();
    const parts = [c.recent ? `Recientes ${dateTime(c.recent.extras.measuredAt)}` : '', c.popular ? `Populares ${dateTime(c.popular.extras.measuredAt)}` : ''].filter(Boolean);
    return parts.join(' y ') || '—';
  });

  protected readonly summaryRows: { key: string; label: string; fmt: (g: GroupSummary) => string }[] = [
    { key: 'n', label: 'Obras', fmt: (g) => num(g.n) },
    { key: 'mv', label: 'Vistas (mediana)', fmt: (g) => compact(g.medianViews) },
    { key: 'mean', label: 'Vistas (media)', fmt: (g) => compact(g.meanViews) },
    { key: 'fav', label: 'Favoritos (mediana)', fmt: (g) => compact(g.medianFavourites) },
    { key: 'com', label: 'Comentarios (mediana)', fmt: (g) => num(g.medianComments) },
    { key: 'fr', label: 'Favoritos ÷ vistas (mediana)', fmt: (g) => `${pct(g.medianFavRate, 2)}${g.rateN ? '' : ' (sin datos)'}` },
    { key: 'f100', label: 'Favoritos por 100 vistas', fmt: (g) => num(g.favsPer100Views, 1) },
    { key: 'c100', label: 'Comentarios por 100 vistas', fmt: (g) => num(g.commentsPer100Views, 2) },
    { key: 'vpd', label: 'Vistas por día (mediana)', fmt: (g) => num(g.medianViewsPerDay, 1) },
    { key: 'age', label: 'Edad mediana', fmt: (g) => ageText(g.medianAgeDays === null ? null : g.medianAgeDays * 24) },
    { key: 'nsfw', label: 'NSFW', fmt: (g) => pct(g.nsfwShare, 0) },
    { key: 'orig', label: 'Originales', fmt: (g) => pct(g.originalShare, 0) },
    { key: 'fan', label: 'Fanart', fmt: (g) => pct(g.fanartShare, 0) },
    { key: 'tags', label: 'Etiquetas por obra (mediana)', fmt: (g) => num(g.medianTagCount) },
  ];

  protected fmtMetric(metric: string, v: number | null) {
    if (metric === 'favRate') return pct(v, 2);
    if (metric === 'viewsPerDay') return num(v, 1);
    return compact(v);
  }

  /** Grupos presentes (artista, su subconjunto por etiqueta, Recientes, Populares). */
  protected readonly groups = computed<CompareGroup[]>(() => this.data().summary.map((s) => ({ key: s.key, name: s.label })));
  /** Para tablas de presencia: artista completo + muestras. */
  protected readonly shareGroups = computed<CompareGroup[]>(() => this.groups().filter((g) => g.key !== 'artistScoped'));

  protected readonly ageRows = computed<CompareRow[]>(() =>
    this.data().ageBuckets.map((b) => ({
      label: b.label,
      values: this.groups().map((g) => b.cells[g.key]?.medianViewsPerDay ?? null),
      hints: this.groups().map((g) => `${b.cells[g.key]?.n ?? 0} obras`),
    })),
  );
  protected readonly ageMuted = (row: CompareRow, gi: number) => Number.parseInt(row.hints?.[gi] ?? '0', 10) < 5;

  protected readonly shareRows = computed<ShareRow[]>(() => this.data()[this.shareKind()]);

  private shareValue(r: ShareRow, key: GroupKey) {
    return key === 'recent' ? r.recentShare : key === 'popular' ? r.popularShare : r.artistShare;
  }

  protected readonly trendBars = computed<CompareRow[]>(() => {
    const kind = this.shareKind();
    return this.shareRows()
      .filter((r) => r.popularCount + r.recentCount > 0 && !(kind === 'franchises' && r.key === 'Sin clasificar'))
      .slice(0, 12)
      .map((r) => ({
        label: kind === 'tags' ? `#${r.label}` : r.label,
        values: this.shareGroups().map((g) => this.shareValue(r, g.key)),
        badge: r.sampling ? 'muestreo' : undefined,
      }));
  });

  protected readonly strengthRows = computed<CompareRow[]>(() => {
    const kind = this.shareKind();
    return this.shareRows()
      .filter((r) => r.artistCount >= 5 && r.artistLift !== null && r.key !== 'Sin clasificar')
      .sort((a, b) => (b.artistLift ?? 0) - (a.artistLift ?? 0))
      .slice(0, 10)
      .map((r) => ({ label: kind === 'tags' ? `#${r.label}` : r.label, values: [r.artistLift], hints: [`${r.artistCount} obras`] }));
  });

  protected timingRows(rows: TimingRow[]): CompareRow[] {
    return rows.map((r) => ({
      label: r.label,
      values: this.shareGroups().map((g) => (g.key === 'recent' ? r.recentShare : g.key === 'popular' ? r.popularShare : r.artistShare)),
    }));
  }

  protected readonly dayPerf = computed<Column[]>(() =>
    this.data().timing.weekdays.map((r) => ({ label: r.label, value: r.artistIndex, hint: `${r.artistCount} obras · ${num(r.artistMedianViewsPerDay, 1)} vistas/día`, muted: r.artistCount < 5 })),
  );

  protected readonly cadenceCols = computed<Column[]>(() =>
    this.data()
      .cadence.perMonth.slice(-24)
      .map((m) => ({ label: m.month, value: m.count, hint: `${num(m.medianViewsPerDay, 1)} vistas/día (mediana)` })),
  );
}
