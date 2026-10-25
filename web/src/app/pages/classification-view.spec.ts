import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { makeClassification } from '../testing';
import { ClassificationView } from './classification-view';

const tick = () => new Promise((r) => setTimeout(r));

describe('ClassificationView', () => {
  let http: HttpTestingController;
  async function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ClassificationView);
    fixture.componentRef.setInput('data', makeClassification());
    fixture.componentRef.setInput('username', 'feithnoir');
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  afterEach(() => http.verify());

  it('muestra cobertura, franquicias, personajes, SFW/NSFW con la prueba y los cruces', async () => {
    const { el } = await setup();
    const text = el.textContent!;
    expect(text).toContain('89 %'); // 574 / 644
    expect(text).toContain('Sin clasificar');
    expect(text).toContain('Sakura Haruno · Naruto');
    expect(text).toContain('< 0,001');
    expect(text).toContain('NSFW rinde más · diferencia moderada');
    expect(text).toContain('Sin diferencia clara');
    expect(text).toContain('No hay suficientes obras en ambos grupos');
    expect(text).toContain('3×');
    expect(text).toContain('Todas las obras traen la marca');
    // Muestra pequeña atenuada y marcada
    expect(el.querySelector('.bars__row--muted')?.textContent).toContain('Kill la Kill');
    // Enlaces que filtran la tabla de obras
    const link = [...el.querySelectorAll<HTMLAnchorElement>('.bars a')].find((a) => a.textContent === 'Naruto')!;
    expect(link.getAttribute('href')).toContain('franquicia=Naruto');
    const nsfw = el.querySelector<HTMLAnchorElement>('a.kpi--nsfw')!;
    expect(nsfw.getAttribute('href')).toContain('clasif=nsfw');
    expect(el.querySelectorAll('rect.stack')).toHaveLength(2);
  });

  it('al ordenar por mediana omite las de muestra pequeña y cambia la tendencia a mapa de calor', async () => {
    const { fixture, el } = await setup();
    const btn = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Métrica por franquicia"] button')].find((b) => b.textContent === 'Mediana de vistas')!;
    btn.click();
    await fixture.whenStable();
    const labels = [...el.querySelectorAll('section:nth-of-type(2) .bars__label')].map((x) => x.textContent);
    expect(labels).toEqual(['Naruto', 'Original', 'Sin clasificar']);
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Mediana de vistas por año')!.click();
    await fixture.whenStable();
    expect(el.querySelector('table.heat')?.textContent).toContain('3.000');
  });

  it('reclasifica y avisa', async () => {
    const { fixture, el } = await setup();
    let changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Reclasificar todo'))!.click();
    const req = http.expectOne('/api/artists/feithnoir/reclassify');
    expect(req.request.method).toBe('POST');
    req.flush({ works: 644, hash: 'x', withFranchise: 574, unclassified: 70, original: 212, overrides: 1 });
    await tick();
    await fixture.whenStable();
    expect(changed).toBe(1);
    expect(el.textContent).toContain('644 obras reclasificadas');
  });
});
