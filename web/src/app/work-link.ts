import { ChangeDetectionStrategy, Component, computed, inject, InjectionToken, input, type Signal } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Contexto de “muestra de tendencias”: las obras no son del artista analizado, así que los enlaces van a DeviantArt
 * y se ocultan las acciones que solo tienen sentido para una galería propia (reclasificar, filtros, crecimiento).
 */
export interface BenchmarkContext {
  /** id de la obra → URL pública en DeviantArt. */
  urls: Signal<ReadonlyMap<string, string>>;
}
export const BENCHMARK_CONTEXT = new InjectionToken<BenchmarkContext>('BENCHMARK_CONTEXT');

/** Enlace a una obra: ficha interna (galerías sincronizadas) o DeviantArt (muestras de tendencias). */
@Component({
  selector: 'app-work-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (external(); as href) {
      <a [href]="href" target="_blank" rel="noopener noreferrer" [title]="title() + ' (abre DeviantArt)'">{{ title() }}</a>
    } @else if (bench) {
      <span>{{ title() }}</span>
    } @else {
      <a [routerLink]="['/obra', id()]">{{ title() }}</a>
    }
  `,
  styles: [':host { display: inline; }'],
})
export class WorkLink {
  readonly id = input.required<string>();
  readonly title = input.required<string>();
  protected readonly bench = inject(BENCHMARK_CONTEXT, { optional: true });
  protected readonly external = computed(() => this.bench?.urls().get(this.id()) ?? null);
}
