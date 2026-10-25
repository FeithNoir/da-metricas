import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface StackSeries {
  name: string;
  values: number[];
}

/** Columnas apiladas en SVG: una columna por categoría del eje X (p. ej. año) y un color por serie. */
@Component({
  selector: 'app-stacked-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cols().length) {
      <svg class="chart" [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="label()">
        <line class="chart__axis" [attr.x1]="P" [attr.x2]="W - 4" [attr.y1]="H - B" [attr.y2]="H - B" />
        <text class="chart__tick" x="2" [attr.y]="T + 4">{{ max() }}</text>
        @for (c of cols(); track c.label) {
          @for (s of c.segs; track s.i) {
            <rect [attr.class]="'stack stack--' + s.i" [attr.x]="c.x" [attr.y]="s.y" [attr.width]="c.w" [attr.height]="s.h">
              <title>{{ c.label }} · {{ s.name }}: {{ s.v }}</title>
            </rect>
          }
          <text class="chart__tick" [attr.x]="c.x + c.w / 2" [attr.y]="H - B + 13" text-anchor="middle">{{ c.label }}</text>
        }
      </svg>
      <p class="legend legend--wrap">
        @for (s of series(); track s.name; let i = $index) {
          <span [attr.class]="'legend__item stack-key--' + (i % 9)">{{ s.name }}</span>
        }
      </p>
    } @else {
      <p class="muted">Sin datos suficientes para graficar.</p>
    }
  `,
})
export class StackedChart {
  readonly labels = input.required<string[]>();
  readonly series = input.required<StackSeries[]>();
  readonly label = input('Gráfico de columnas apiladas');

  protected readonly W = 640;
  protected readonly H = 220;
  protected readonly P = 30;
  protected readonly B = 20;
  protected readonly T = 8;

  protected readonly max = computed(() => Math.max(0, ...this.labels().map((_, i) => this.series().reduce((a, s) => a + (s.values[i] ?? 0), 0))));

  protected readonly cols = computed(() => {
    const labels = this.labels();
    const max = this.max();
    if (!labels.length || !max) return [];
    const step = (this.W - this.P - 4) / labels.length;
    const w = Math.max(2, step * 0.7);
    const scale = (this.H - this.B - this.T) / max;
    return labels.map((label, i) => {
      let base = this.H - this.B;
      const segs = this.series()
        .map((s, si) => ({ i: si % 9, name: s.name, v: s.values[i] ?? 0 }))
        .filter((s) => s.v > 0)
        .map((s) => {
          const h = s.v * scale;
          base -= h;
          return { ...s, h, y: base };
        });
      return { label, x: this.P + i * step + (step - w) / 2, w, segs };
    });
  });
}
