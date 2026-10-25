import { TestBed } from '@angular/core/testing';
import { CONTRAST } from '../fixtures/contrast';
import { ContrastView } from './contrast-view';

describe('ContrastView (datos reales de feithnoir)', () => {
  async function setup() {
    const fixture = TestBed.createComponent(ContrastView);
    fixture.componentRef.setInput('data', CONTRAST);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('muestra los 5 consejos principales con evidencia y confianza, y permite ver todos', async () => {
    const { fixture, el } = await setup();
    const items = el.querySelectorAll('.advice__item');
    expect(items).toHaveLength(5);
    expect(items[0]!.querySelector('h3')!.textContent).toContain(CONTRAST.advice[0]!.title);
    expect(items[0]!.querySelectorAll('.evidence dt').length).toBe(CONTRAST.advice[0]!.evidence.length);
    expect(items[0]!.querySelector('.conf')!.textContent).toContain(`confianza ${CONTRAST.advice[0]!.confidence}`);
    const more = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes('consejos'))!;
    more.click();
    await fixture.whenStable();
    expect(el.querySelectorAll('.advice__item')).toHaveLength(CONTRAST.advice.length);
  });

  it('compara artista, Recientes y Populares lado a lado', async () => {
    const { el } = await setup();
    const head = [...el.querySelectorAll('section:nth-of-type(2) thead th')].map((t) => t.textContent!.trim());
    expect(head).toEqual(['Métrica', '@feithnoir', 'Recientes', 'Populares']);
    expect(el.textContent).toContain('Favoritos ÷ vistas (mediana)');
    expect(el.textContent).toContain('¿Dónde quedas dentro de cada muestra?');
    expect(el.textContent).toContain('A igual edad');
    // Gráficos SVG con un color por grupo
    expect(el.querySelectorAll('rect.cmp-fill--popular').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('rect.cmp-fill--artist').length).toBeGreaterThan(0);
  });

  it('marca las etiquetas de muestreo y cambia a franquicias', async () => {
    const { fixture, el } = await setup();
    expect([...el.querySelectorAll('.cmp__label')].some((x) => x.textContent!.includes('#digitalart') && x.textContent!.includes('muestreo'))).toBe(true);
    [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Qué comparar"] button')].find((b) => b.textContent === 'Franquicias')!.click();
    await fixture.whenStable();
    const strengths = [...el.querySelectorAll('.cmp__label')].map((x) => x.textContent!.trim());
    expect(strengths).toContain('Kill la Kill');
    expect(strengths).not.toContain('Sin clasificar');
  });
});
