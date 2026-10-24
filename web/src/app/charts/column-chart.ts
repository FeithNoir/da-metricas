import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface Column {
  label: string;
  value: number | null;
  hint?: string;
  muted?: boolean;
}

/** Columnas verticales en SVG (meses, días de la semana, horas). */
@Component({
  selector: 'app-column-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cols().length) {
      <svg class="chart" [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="label()" preserveAspectRatio="none">
        <line class="chart__axis" [attr.x1]="P" [attr.x2]="W - 4" [attr.y1]="H - B" [attr.y2]="H - B" />
        <text class="chart__tick" x="2" [attr.y]="T + 4">{{ maxText() }}</text>
        @for (c of cols(); track c.label + $index) {
          <rect class="chart__col" [class.chart__col--muted]="c.muted" [attr.x]="c.x" [attr.y]="c.y" [attr.width]="c.w" [attr.height]="c.h">
            <title>{{ c.label }}: {{ c.text }}{{ c.hint ? ' · ' + c.hint : '' }}</title>
          </rect>
          @if (c.showLabel) {
            <text class="chart__tick" [attr.x]="c.x + c.w / 2" [attr.y]="H - B + 13" text-anchor="middle">{{ c.short }}</text>
          }
        }
      </svg>
    } @else {
      <p class="muted">Sin datos suficientes para graficar.</p>
    }
  `,
})
export class ColumnChart {
  readonly data = input.required<Column[]>();
  readonly label = input('Gráfico de columnas');
  readonly format = input<(v: number | null) => string>((v) => (v === null ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: 0 })));
  /** Cuántas etiquetas del eje X mostrar como máximo. */
  readonly maxLabels = input(12);

  protected readonly W = 640;
  protected readonly H = 200;
  protected readonly P = 36;
  protected readonly B = 20;
  protected readonly T = 8;

  protected readonly maxText = computed(() => this.format()(Math.max(0, ...this.data().map((c) => c.value ?? 0))));

  protected readonly cols = computed(() => {
    const d = this.data();
    if (!d.length) return [];
    const max = Math.max(0, ...d.map((c) => c.value ?? 0)) || 1;
    const inner = this.W - this.P - 4;
    const step = inner / d.length;
    const w = Math.max(1, step * 0.75);
    const every = Math.ceil(d.length / this.maxLabels());
    return d.map((c, i) => {
      const h = ((c.value ?? 0) / max) * (this.H - this.B - this.T);
      return {
        ...c,
        x: this.P + i * step + (step - w) / 2,
        w,
        h,
        y: this.H - this.B - h,
        text: this.format()(c.value),
        showLabel: i % every === 0,
        short: c.label.length > 8 ? c.label.slice(0, 3) + (c.label.match(/\d{4}$/) ? ` ${c.label.slice(-2)}` : '') : c.label,
      };
    });
  });
}
