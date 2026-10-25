import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { POPULAR_SAMPLE } from '../fixtures/benchmark-popular';
import type { BenchmarkList, BenchmarkRun } from '../models';
import { TrendsPage } from './trends-page';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const run = (p: Partial<BenchmarkRun>): BenchmarkRun => ({ ...POPULAR_SAMPLE.run, ...p });
const list = (runs: BenchmarkRun[], running: BenchmarkRun | null = null): BenchmarkList => ({
  runs,
  running,
  minSize: 24,
  maxSize: 300,
  defaultSize: 100,
  generalTags: ['digitalart', 'fanart'],
  estimate: { pages: 9, requests: 109, seconds: 75, megabytes: 12 },
  auto: { enabled: false, size: 100, scope: 'general' },
  nextAutoRunAt: null,
});

describe('TrendsPage', () => {
  let http: HttpTestingController;
  async function setup(tab = 'populares') {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TrendsPage);
    fixture.componentRef.setInput('tab', tab);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  afterEach(() => http.verify());

  it('carga la última medición de Populares y muestra su análisis y el costo estimado', async () => {
    const { fixture, el } = await setup();
    http.expectOne('/api/benchmarks').flush(list([POPULAR_SAMPLE.run]));
    http.expectOne('/api/artists').flush({ artists: [] });
    await fixture.whenStable();
    await wait();
    fixture.detectChanges();
    http.expectOne(`/api/benchmarks/${POPULAR_SAMPLE.run.id}/analysis`).flush(POPULAR_SAMPLE);
    await wait(300);
    http.expectOne((r) => r.url === '/api/benchmarks/estimate').flush({ size: 100, pages: 9, requests: 109, seconds: 75, megabytes: 12 });
    await wait();
    await fixture.whenStable();
    const text = el.textContent!;
    expect(text).toContain('Muestra Populares · General');
    expect(text).toContain('~109 peticiones');
    expect(text).toContain('unos 75 s');
    expect(el.querySelector<HTMLSelectElement>('#run-select')!.options[0]!.textContent).toContain('General · 100 obras');
  });

  it('mide recientes: muestra el progreso y el error en español si ya hay una en curso', async () => {
    const { fixture, el } = await setup('recientes');
    http.expectOne('/api/benchmarks').flush(list([]));
    http.expectOne('/api/artists').flush({ artists: [] });
    await fixture.whenStable();
    expect(el.textContent).toContain('Aún no hay mediciones de Recientes');
    const btn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Medir recientes')!;
    btn.click();
    const req = http.expectOne('/api/benchmarks');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ kind: 'recent', scope: 'general', size: 100 });
    req.flush({ run: run({ id: 5, kind: 'recent', status: 'running', phase: 'métricas', found: 100, processed: 40, items: 40 }) });
    await fixture.whenStable();
    expect(el.textContent).toContain('Midiendo Recientes · General');
    expect(el.textContent).toContain('40 de 100 obras con métricas');
    expect(el.querySelector('progress')).not.toBeNull();
    expect([...el.querySelectorAll<HTMLButtonElement>('.trends-controls__actions button')].every((b) => b.disabled)).toBe(true);
    fixture.destroy();
    http.match(() => true).forEach((r) => r.flush({}));
  });

  it('valida el tamaño en el servidor y muestra el mensaje', async () => {
    const { fixture, el } = await setup('recientes');
    http.expectOne('/api/benchmarks').flush(list([]));
    http.expectOne('/api/artists').flush({ artists: [] });
    await fixture.whenStable();
    const size = el.querySelector<HTMLInputElement>('#size')!;
    size.value = '5000';
    size.dispatchEvent(new Event('input'));
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Medir recientes')!.click();
    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body.size).toBe(5000);
    req.flush({ error: 'El tamaño de la muestra debe estar entre 24 y 300 obras.' }, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('entre 24 y 300');
    fixture.destroy();
    http.match(() => true).forEach((r) => r.flush({}));
  });
});
