import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface LineSeries {
  name: string;
  points: { x: number; y: number }[];
  cls?: string;
}

/** Líneas en SVG con eje X temporal (milisegundos). Cada serie se escala a su propio máximo si `normalize`. */
@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (paths().length) {
      <svg class="chart" [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="label()">
        <line class="chart__axis" x1="8" [attr.x2]="W - 8" [attr.y1]="H - 22" [attr.y2]="H - 22" />
        @for (p of paths(); track p.name) {
          <path [attr.class]="'chart__line ' + (p.cls ?? '')" [attr.d]="p.d" />
          @for (pt of p.pts; track $index) {
            <circle [attr.class]="'chart__dot ' + (p.cls ?? '')" [attr.cx]="pt.x" [attr.cy]="pt.y" r="3"><title>{{ p.name }}: {{ pt.label }}</title></circle>
          }
        }
        <text class="chart__tick" x="8" [attr.y]="H - 6">{{ xFrom() }}</text>
        <text class="chart__tick" [attr.x]="W - 8" [attr.y]="H - 6" text-anchor="end">{{ xTo() }}</text>
      </svg>
      <p class="legend">
        @for (p of paths(); track p.name) {
          <span [attr.class]="'legend__item ' + (p.cls ?? '')">{{ p.name }}: {{ p.last }}</span>
        }
      </p>
    } @else {
      <p class="muted">Sin datos suficientes para graficar.</p>
    }
  `,
})
export class LineChart {
  readonly series = input.required<LineSeries[]>();
  readonly label = input('Gráfico de líneas');
  readonly normalize = input(true);

  protected readonly W = 640;
  protected readonly H = 200;

  private readonly xRange = computed(() => {
    const xs = this.series().flatMap((s) => s.points.map((p) => p.x));
    return xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 0];
  });
  protected readonly xFrom = computed(() => fmtDate(this.xRange()[0]));
  protected readonly xTo = computed(() => fmtDate(this.xRange()[1]));

  protected readonly paths = computed(() => {
    const [x0, x1] = this.xRange();
    const all = this.series().filter((s) => s.points.length);
    const gmax = Math.max(1, ...all.flatMap((s) => s.points.map((p) => p.y)));
    const gmin = Math.min(...all.flatMap((s) => s.points.map((p) => p.y)));
    return all.map((s) => {
      const ys = s.points.map((p) => p.y);
      const max = this.normalize() ? Math.max(...ys) : gmax;
      const min = this.normalize() ? Math.min(...ys) : gmin;
      const sx = (x: number) => (x1 === x0 ? this.W / 2 : 12 + ((x - x0) / (x1 - x0)) * (this.W - 24));
      const sy = (y: number) => (max === min ? (this.H - 22) / 2 : 10 + (1 - (y - min) / (max - min)) * (this.H - 40));
      const pts = s.points.map((p) => ({ x: sx(p.x), y: sy(p.y), label: `${p.y.toLocaleString('es-CO')} (${fmtDate(p.x)})` }));
      return { name: s.name, cls: s.cls, pts, d: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), last: (s.points.at(-1)?.y ?? 0).toLocaleString('es-CO') };
    });
  });
}

function fmtDate(ms: number) {
  return ms ? new Date(ms).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
}
