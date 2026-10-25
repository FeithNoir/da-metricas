import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DictionaryInfo } from '../models';
import { DictionaryPage } from './dictionary-page';

const tick = () => new Promise((r) => setTimeout(r));
const info = (p: Partial<DictionaryInfo> = {}): DictionaryInfo => ({
  version: 3,
  hash: 'abc123def456',
  franchises: [
    { name: 'Naruto', aliases: ['naruto shippuden'], characters: ['Sakura Haruno', 'Sarada Uchiha'] },
    { name: 'Bleach', aliases: [], characters: ['Rukia Kuchiki'] },
  ],
  artists: ['feithnoir'],
  custom: null,
  ...p,
});

describe('DictionaryPage', () => {
  let http: HttpTestingController;
  async function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DictionaryPage);
    http.expectOne('/api/dictionary').flush(info());
    await tick();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  afterEach(() => http.verify());

  it('lista y busca franquicias por nombre, alias o personaje (sin tildes ni mayúsculas)', async () => {
    const { fixture, el } = await setup();
    expect(el.textContent).toContain('2 franquicias · 3 personajes');
    const q = el.querySelector<HTMLInputElement>('#dict-q')!;
    q.value = 'SARADA';
    q.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect([...el.querySelectorAll('.dict-list strong')].map((x) => x.textContent)).toEqual(['Naruto']);
  });

  it('valida el JSON, guarda la ampliación y muestra cuántas obras se reclasificaron', async () => {
    const { fixture, el } = await setup();
    const ta = el.querySelector<HTMLTextAreaElement>('#dict-json')!;
    ta.value = '{ mal';
    ta.dispatchEvent(new Event('input'));
    const save = () => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith('Guardar'))!.click();
    save();
    await fixture.whenStable();
    expect(el.querySelector('.form-error')?.textContent).toContain('El JSON no es válido');
    const custom = { franchises: [{ name: 'Mi serie', aliases: ['miserie'] }] };
    ta.value = JSON.stringify(custom);
    ta.dispatchEvent(new Event('input'));
    save();
    const req = http.expectOne('/api/dictionary/custom');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(custom);
    req.flush(info({ custom, hash: 'nuevo', reclassified: 644 }));
    await tick();
    await fixture.whenStable();
    expect(el.textContent).toContain('Se reclasificaron 644 obras');
    expect(el.querySelector('.form-error')).toBeNull();
  });
});
