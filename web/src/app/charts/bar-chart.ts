import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface Bar {
  label: string;
  value: number | null;
  /** Texto secundario (p. ej. “12 obras”). */
  hint?: string;
  /** Barra atenuada (p. ej. muestra pequeña). */
  muted?: boolean;
  link?: string[];
}

/** Barras horizontales accesibles (HTML + CSS, sin librerías). */
@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <ul class="bars" [attr.aria-label]="label()">
        @for (b of rows(); track b.label + $index) {
          <li class="bars__row" [class.bars__row--muted]="b.muted">
            <span class="bars__label" [title]="b.label">{{ b.label }}</span>
            <span class="bars__track" aria-hidden="true"><span class="bars__fill" [style.width.%]="b.width"></span></span>
            <span class="bars__value">{{ b.text }}@if (b.hint) {<small> · {{ b.hint }}</small>}</span>
          </li>
        }
      </ul>
    } @else {
      <p class="muted">Sin datos suficientes para graficar.</p>
    }
  `,
})
export class BarChart {
  readonly data = input.required<Bar[]>();
  readonly label = input('Gráfico de barras');
  readonly format = input<(v: number | null) => string>((v) => (v === null ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: 1 })));

  protected readonly rows = computed(() => {
    const d = this.data();
    const max = Math.max(0, ...d.map((b) => b.value ?? 0));
    return d.map((b) => ({ ...b, width: max > 0 && b.value ? Math.max(1, (b.value / max) * 100) : 0, text: this.format()(b.value) }));
  });
}
