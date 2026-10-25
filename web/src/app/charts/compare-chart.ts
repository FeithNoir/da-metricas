import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Grupo comparado: artista, Recientes o Populares (cada uno con su color). */
export interface CompareGroup {
  key: 'artist' | 'artistScoped' | 'recent' | 'popular';
  name: string;
}

export interface CompareRow {
  label: string;
  /** Un valor por grupo (mismo orden que `groups`). */
  values: (number | null)[];
  /** Texto por grupo para la ayuda emergente (p. ej. “12 obras”). */
  hints?: (string | null)[];
  badge?: string;
}



/** Barras horizontales agrupadas (HTML + CSS, se adaptan a pantallas pequeñas): ideal para etiquetas o franquicias. */
@Component({
  selector: 'app-compare-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <p class="legend legend--wrap">
    @for (g of groups(); track g.key) {
      <span [attr.class]="'legend__item cmp-key--' + g.key">{{ g.name }}</span>
    }
  </p>
      <ul class="cmp" [attr.aria-label]="label()">
        @for (r of rows(); track r.label + $index) {
          <li class="cmp__row">
            <span class="cmp__label" [title]="r.label">{{ r.label }}@if (r.badge) { <span class="badge">{{ r.badge }}</span>}</span>
            <span class="cmp__bars">
              @for (b of r.bars; track $index) {
                <span class="cmp__bar">
                  <span class="cmp__track" aria-hidden="true"><span [attr.class]="'cmp__fill cmp-fill--' + b.key" [style.width.%]="b.width"></span></span>
                  <span class="cmp__value">{{ b.text }}<span class="visually-hidden"> ({{ b.name }})</span></span>
                </span>
              }
            </span>
          </li>
        }
      </ul>
    } @else {
      <p class="muted">Sin datos suficientes para graficar.</p>
    }
  `,
})
export class CompareBars {
  readonly groups = input.required<CompareGroup[]>();
  readonly data = input.required<CompareRow[]>();
  readonly label = input('Comparación');
  readonly format = input<(v: number | null) => string>((v) => (v === null ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: 1 })));

  protected readonly rows = computed(() => {
    const d = this.data();
    const g = this.groups();
    const max = Math.max(0, ...d.flatMap((r) => r.values.map((v) => v ?? 0)));
    return d.map((r) => ({
      ...r,
      bars: g.map((grp, i) => {
        const v = r.values[i] ?? null;
        return { key: grp.key, name: grp.name, width: max > 0 && v ? Math.max(1, (v / max) * 100) : 0, text: this.format()(v) + (r.hints?.[i] ? ` · ${r.hints[i]}` : '') };
      }),
    }));
  });
}

/** Columnas agrupadas en SVG (pocas categorías: días, franjas, edades). */
@Component({
  selector: 'app-compare-columns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cols().length) {
      <p class="legend legend--wrap">
    @for (g of groups(); track g.key) {
      <span [attr.class]="'legend__item cmp-key--' + g.key">{{ g.name }}</span>
    }
  </p>
      <svg class="chart" [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="label()">
        <line class="chart__axis" [attr.x1]="P" [attr.x2]="W - 4" [attr.y1]="H - B" [attr.y2]="H - B" />
        <text class="chart__tick" x="2" [attr.y]="T + 4">{{ maxText() }}</text>
        @for (c of cols(); track c.label + $index) {
          @for (b of c.bars; track $index) {
            <rect [attr.class]="'cmp-fill--' + b.key" [class.chart__col--muted]="b.muted" [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h">
              <title>{{ c.label }} · {{ b.name }}: {{ b.text }}</title>
            </rect>
          }
          <text class="chart__tick" [attr.x]="c.mid" [attr.y]="H - B + 13" text-anchor="middle">{{ c.short }}</text>
        }
      </svg>
    } @else {
      <p class="muted">Sin datos suficientes para graficar.</p>
    }
  `,
})
export class CompareColumns {
  readonly groups = input.required<CompareGroup[]>();
  readonly data = input.required<CompareRow[]>();
  readonly label = input('Comparación');
  /** Categorías con muy pocos datos (por grupo) se atenúan. */
  readonly muted = input<(row: CompareRow, groupIndex: number) => boolean>(() => false);
  readonly format = input<(v: number | null) => string>((v) => (v === null ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: 1 })));

  protected readonly W = 640;
  protected readonly H = 220;
  protected readonly P = 34;
  protected readonly B = 20;
  protected readonly T = 8;

  private readonly max = computed(() => Math.max(0, ...this.data().flatMap((r) => r.values.map((v) => v ?? 0))));
  protected readonly maxText = computed(() => this.format()(this.max()));

  protected readonly cols = computed(() => {
    const d = this.data();
    const g = this.groups();
    const max = this.max();
    if (!d.length || !max || !g.length) return [];
    const step = (this.W - this.P - 4) / d.length;
    const inner = step * 0.8;
    const w = Math.max(2, inner / g.length);
    const scale = (this.H - this.B - this.T) / max;
    return d.map((r, i) => {
      const x0 = this.P + i * step + (step - inner) / 2;
      return {
        label: r.label,
        short: r.label.length > 10 ? r.label.slice(0, 9) + '…' : r.label,
        mid: x0 + inner / 2,
        bars: g.map((grp, gi) => {
          const v = r.values[gi] ?? 0;
          const h = Math.max(0, v * scale);
          return {
            key: grp.key,
            name: grp.name,
            x: x0 + gi * w,
            w: Math.max(1, w - 1),
            h,
            y: this.H - this.B - h,
            text: this.format()(r.values[gi] ?? null) + (r.hints?.[gi] ? ` (${r.hints[gi]})` : ''),
            muted: this.muted()(r, gi),
          };
        }),
      };
    });
  });
}
