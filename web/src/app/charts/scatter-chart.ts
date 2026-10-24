import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
}

/** Dispersión en SVG con escala logarítmica opcional (útil para vistas, muy asimétricas). */
@Component({
  selector: 'app-scatter-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pts().length) {
      <svg class="chart" [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="label()">
        <line class="chart__axis" [attr.x1]="L" [attr.x2]="W - 6" [attr.y1]="H - B" [attr.y2]="H - B" />
        <line class="chart__axis" [attr.x1]="L" [attr.x2]="L" y1="6" [attr.y2]="H - B" />
        @for (p of pts(); track $index) {
          <circle class="chart__point" [attr.cx]="p.cx" [attr.cy]="p.cy" r="3"><title>{{ p.label }}</title></circle>
        }
        <text class="chart__tick" [attr.x]="W - 6" [attr.y]="H - 4" text-anchor="end">{{ xLabel() }} →</text>
        <text class="chart__tick" x="4" y="14">↑ {{ yLabel() }}</text>
      </svg>
    } @else {
      <p class="muted">Sin datos suficientes para graficar.</p>
    }
  `,
})
export class ScatterChart {
  readonly points = input.required<ScatterPoint[]>();
  readonly xLabel = input('x');
  readonly yLabel = input('y');
  readonly log = input(true);
  readonly label = input('Diagrama de dispersión');

  protected readonly W = 640;
  protected readonly H = 260;
  protected readonly L = 24;
  protected readonly B = 18;

  protected readonly pts = computed(() => {
    const t = (v: number) => (this.log() ? Math.log10(1 + Math.max(0, v)) : v);
    const ps = this.points().filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (!ps.length) return [];
    const xs = ps.map((p) => t(p.x));
    const ys = ps.map((p) => t(p.y));
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    return ps.map((p, i) => ({
      label: p.label,
      cx: this.L + 6 + (x1 === x0 ? 0.5 : (xs[i] - x0) / (x1 - x0)) * (this.W - this.L - 18),
      cy: 10 + (1 - (y1 === y0 ? 0.5 : (ys[i] - y0) / (y1 - y0))) * (this.H - this.B - 20),
    }));
  });
}
