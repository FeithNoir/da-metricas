import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { makeWork } from '../testing';
import { applyFilters, EMPTY_FILTERS, WorksTable } from './works-table';

const works = [
  makeWork({ title: 'Ecchitober: Day 1', views: 500, favourites: 20, tags: ['ecchitober', 'demon'], publishedAt: '2026-10-02T03:00:00.000Z', franchises: ['Original'], ratingClass: 'nsfw' }),
  makeWork({
    title: 'Gymnastics Training',
    views: 1500,
    favourites: 30,
    tags: ['jinx'],
    publishedAt: '2026-10-05T19:00:00.000Z',
    franchises: ['League of Legends', 'Naruto'],
    characters: ['Jinx', 'Sakura Haruno'],
    classificationOverridden: true,
  }),
  makeWork({ title: 'Old sketch', views: 50, favourites: 1, tags: ['sketch'], publishedAt: '2019-01-01T12:00:00.000Z', metricsAt: null, ratingClass: 'desconocido' }),
];

describe('applyFilters', () => {
  it('filtra por título, etiqueta y rango de fechas (hora de Bogotá) y ordena', () => {
    const base = EMPTY_FILTERS;
    expect(applyFilters(works, { ...base, q: 'ecchi' }, 'views', -1).map((w) => w.title)).toEqual(['Ecchitober: Day 1']);
    expect(applyFilters(works, { ...base, tag: 'JINX' }, 'views', -1)).toHaveLength(1);
    // 2026-10-02T03:00Z es el 1 de octubre a las 22:00 en Bogotá
    expect(applyFilters(works, { ...base, from: '2026-10-02' }, 'views', -1).map((w) => w.title)).toEqual(['Gymnastics Training']);
    expect(applyFilters(works, { ...base, to: '2026-10-01' }, 'publishedAt', 1).map((w) => w.title)).toEqual(['Old sketch', 'Ecchitober: Day 1']);
    expect(applyFilters(works, base, 'views', -1).map((w) => w.views)).toEqual([1500, 500, 50]);
    expect(applyFilters(works, base, 'title', 1)[0].title).toBe('Ecchitober: Day 1');
  });
});

describe('filtros de clasificación', () => {
  const titles = (f: Partial<typeof EMPTY_FILTERS>) => applyFilters(works, { ...EMPTY_FILTERS, ...f }, 'views', -1).map((w) => w.title);
  it('franquicia (sin distinguir mayúsculas ni tildes), “Sin clasificar”, personaje y SFW/NSFW', () => {
    expect(titles({ franchise: 'naruto' })).toEqual(['Gymnastics Training']);
    expect(titles({ franchise: 'Original' })).toEqual(['Ecchitober: Day 1']);
    expect(titles({ franchise: 'Sin clasificar' })).toEqual(['Old sketch']);
    expect(titles({ character: 'sakura  haruno' })).toEqual(['Gymnastics Training']);
    expect(titles({ character: 'Sakura' })).toEqual([]);
    expect(titles({ rating: 'nsfw' })).toEqual(['Ecchitober: Day 1']);
    expect(titles({ rating: 'sfw' })).toEqual(['Gymnastics Training']);
    expect(titles({ rating: 'desconocido' })).toEqual(['Old sketch']);
    expect(titles({ franchise: 'Naruto', rating: 'nsfw' })).toEqual([]);
  });
});

describe('WorksTable', () => {
  async function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideRouter([])] });
    const fixture = TestBed.createComponent(WorksTable);
    fixture.componentRef.setInput('works', works);
    fixture.componentRef.setInput('username', 'feithnoir');
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('muestra filas, totales, enlaces y la marca “sin métricas”', async () => {
    const { el } = await setup();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(el.textContent).toContain('3 de 3 obras');
    expect(el.textContent).toContain('2.050 vistas');
    const ext = el.querySelector<HTMLAnchorElement>('a.ext')!;
    expect(ext.target).toBe('_blank');
    expect(ext.href).toContain('deviantart.com');
    expect(el.querySelector('.badge--warn')?.textContent).toContain('sin métricas');
  });

  it('ordena al pulsar una columna y filtra al pulsar una etiqueta', async () => {
    const { fixture, el } = await setup();
    const viewsBtn = [...el.querySelectorAll<HTMLButtonElement>('th button.sort')].find((b) => b.textContent?.startsWith('Vistas'))!;
    viewsBtn.click();
    await fixture.whenStable();
    expect(el.querySelector('tbody tr .title a')?.textContent).toBe('Gymnastics Training');
    expect(viewsBtn.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    [...el.querySelectorAll<HTMLButtonElement>('button.tag')].find((b) => b.textContent === 'sketch')!.click();
    await fixture.whenStable();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(el.querySelector<HTMLAnchorElement>('a[download]')!.getAttribute('href')).toContain('tag=sketch');
  });

  it('avisa cuando ningún resultado coincide', async () => {
    const { fixture, el } = await setup();
    const q = el.querySelector<HTMLInputElement>('#f-q')!;
    q.value = 'zzz';
    q.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.textContent).toContain('Ninguna obra coincide');
  });

  it('muestra franquicias y personajes como chips que filtran, marca NSFW/manual y pasa los filtros al CSV', async () => {
    const { fixture, el } = await setup();
    expect(el.querySelector('.badge--nsfw')?.textContent).toBe('NSFW');
    expect(el.querySelector('.badge--manual')).not.toBeNull();
    expect(el.querySelector('.chip--none')?.textContent).toContain('sin clasificar');
    const opts = [...el.querySelectorAll<HTMLOptionElement>('#f-fr option')].map((o) => o.textContent?.trim());
    expect(opts).toEqual(['Todas', 'League of Legends (1)', 'Naruto (1)', 'Original (1)', 'Sin clasificar (1)']);
    [...el.querySelectorAll<HTMLButtonElement>('button.chip--ch')].find((b) => b.textContent === 'Sakura Haruno')!.click();
    await fixture.whenStable();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(el.querySelector<HTMLAnchorElement>('a[download]')!.getAttribute('href')).toContain('character=Sakura%20Haruno');
    const rt = el.querySelector<HTMLSelectElement>('#f-rt')!;
    rt.value = 'nsfw';
    rt.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(el.textContent).toContain('Ninguna obra coincide');
  });

  it('aplica filtros iniciales (preset) desde el análisis', async () => {
    const { fixture, el } = await setup();
    fixture.componentRef.setInput('preset', { franchise: 'Original' });
    await fixture.whenStable();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(el.querySelector<HTMLSelectElement>('#f-fr')!.value).toBe('Original');
  });
});
