import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ClassificationRecord } from '../models';
import { makeRecord } from '../testing';
import { ClassificationCard } from './classification-card';

const tick = () => new Promise((r) => setTimeout(r));

describe('ClassificationCard', () => {
  let http: HttpTestingController;
  async function setup(record = makeRecord()) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ClassificationCard);
    fixture.componentRef.setInput('record', record);
    fixture.componentRef.setInput('workId', '42');
    fixture.componentRef.setInput('username', 'feithnoir');
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  afterEach(() => http.verify());
  const type = (el: HTMLElement, sel: string, v: string, ev = 'input') => {
    const i = el.querySelector<HTMLInputElement | HTMLSelectElement>(sel)!;
    i.value = v;
    i.dispatchEvent(new Event(ev));
  };

  it('muestra la clasificación efectiva, el dato de DeviantArt y la evidencia', async () => {
    const { el } = await setup();
    expect(el.querySelector('.chip--fr')?.textContent).toBe('Naruto');
    expect(el.querySelector('.chip--fr')?.getAttribute('href')).toContain('franquicia=Naruto');
    expect(el.querySelector('.chip--nsfw')?.textContent).toBe('NSFW');
    expect(el.textContent).toContain('DeviantArt dice: adult');
    expect(el.textContent).toContain('deducida del personaje');
    expect(el.textContent).toContain('automática');
  });

  it('guarda solo lo que cambia como corrección manual', async () => {
    const { fixture, el } = await setup();
    let saved: ClassificationRecord | null = null;
    fixture.componentInstance.saved.subscribe((r) => (saved = r));
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Corregir clasificación')!.click();
    await fixture.whenStable();
    http.expectOne('/api/dictionary').flush({ version: 1, hash: 'h', franchises: [{ name: 'Naruto', aliases: [], characters: ['Sarada Uchiha'] }], artists: [], custom: null });
    await tick();
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('#ov-fr')!.value).toBe('Naruto');
    expect(el.querySelectorAll('#ov-ch-list option')).toHaveLength(1);
    type(el, '#ov-ch', 'Sakura Haruno, sarada uchiha, Sarada Uchiha');
    type(el, '#ov-rt', 'sfw', 'change');
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/deviations/42/classification');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ franchises: null, characters: ['Sakura Haruno', 'sarada uchiha'], rating: 'sfw' });
    const rec = makeRecord({ override: { franchises: null, characters: ['Sakura Haruno', 'sarada uchiha'], rating: 'sfw', updatedAt: '2026-10-24T20:00:00Z' } });
    req.flush({ classification: rec });
    await tick();
    expect(saved).toEqual(rec);
  });

  it('vuelve a lo automático y muestra errores del servidor', async () => {
    const { fixture, el } = await setup(makeRecord({ override: { franchises: ['Bleach'], characters: null, rating: null, updatedAt: '2026-10-24T20:00:00Z' } }));
    expect(el.textContent).toContain('corregida a mano');
    expect(el.textContent).toContain('Automático: Naruto');
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Corregir clasificación')!.click();
    await fixture.whenStable();
    http.expectOne('/api/dictionary').flush({ version: 1, hash: 'h', franchises: [], artists: [], custom: null });
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Volver a lo automático')!.click();
    const req = http.expectOne('/api/deviations/42/classification');
    expect(req.request.method).toBe('DELETE');
    req.flush({ error: 'Obra no encontrada.' }, { status: 404, statusText: 'Not Found' });
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('.form-error')?.textContent).toContain('Obra no encontrada.');
  });
});
