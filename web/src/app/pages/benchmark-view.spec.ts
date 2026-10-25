import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { POPULAR_SAMPLE } from '../fixtures/benchmark-popular';
import { BenchmarkView } from './benchmark-view';

describe('BenchmarkView (muestra Populares real)', () => {
  async function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    const fixture = TestBed.createComponent(BenchmarkView);
    fixture.componentRef.setInput('data', POPULAR_SAMPLE);
    await fixture.whenStable();
    return { el: fixture.nativeElement as HTMLElement };
  }

  it('resume la muestra y reutiliza el análisis completo', async () => {
    const { el } = await setup();
    const text = el.textContent!;
    expect(text).toContain('Muestra Populares · General');
    expect(text).toContain('Autores distintos');
    expect(text).toContain('Portada de DeviantArt');
    expect(text).toContain('oculta el contenido maduro');
    expect(text).toContain('Estadística descriptiva');
    expect(text).toContain('Franquicias, personajes y SFW/NSFW');
    expect(el.querySelectorAll('.thumbs__item')).toHaveLength(8);
  });

  it('enlaza a DeviantArt y oculta lo que solo aplica a una galería propia', async () => {
    const { el } = await setup();
    const links = [...el.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.some((a) => a.getAttribute('href')?.includes('/obra/'))).toBe(false);
    const top = el.querySelector<HTMLAnchorElement>('.bars a.bars__label')!;
    expect(top.getAttribute('href')).toMatch(/^https:\/\/www\.deviantart\.com\//);
    expect(top.getAttribute('target')).toBe('_blank');
    const text = el.textContent!;
    expect(text).not.toContain('Reclasificar todo');
    expect(text).not.toContain('Crecimiento entre sincronizaciones');
    expect(text).not.toContain('Correcciones manuales');
    expect(links.some((a) => a.getAttribute('href')?.includes('franquicia='))).toBe(false);
  });
});
