import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ArtistResponse, SyncRecord } from '../models';
import { makeWork } from '../testing';
import { ArtistPage } from './artist-page';

const tick = () => new Promise((r) => setTimeout(r));
const artist = (): ArtistResponse => ({
  artist: { username: 'feithnoir', displayName: 'FeithNoir', avatar: null, galleryTotal: 702, autoSync: true, createdAt: '', lastSyncAt: new Date().toISOString(), lastSyncStatus: 'ok', works: 2, worksWithMetrics: 2 },
  syncing: false,
  syncs: [],
});
const sync = (p: Partial<SyncRecord> = {}): SyncRecord => ({ id: 7, username: 'x', startedAt: '', finishedAt: null, status: 'running', phase: 'perfil', found: 0, processed: 0, failed: 0, message: null, ...p });

describe('ArtistPage', () => {
  let http: HttpTestingController;
  async function setup(username: string) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ArtistPage);
    fixture.componentRef.setInput('username', username);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  afterEach(() => http.verify());

  it('muestra estado de carga y luego las obras', async () => {
    const { fixture, el } = await setup('feithnoir');
    expect(el.textContent).toContain('Cargando a feithnoir');
    http.expectOne('/api/artists/feithnoir').flush(artist());
    await tick();
    http.expectOne('/api/artists/feithnoir/deviations').flush({ total: 2, items: [makeWork(), makeWork()] });
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('FeithNoir');
    expect(el.textContent).toContain('de 702 en su galería');
    expect(el.textContent).toContain('Obras (2)');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('si no hay datos invita a sincronizar y avisa si el usuario no existe', async () => {
    const { fixture, el } = await setup('nadie-123');
    http.expectOne('/api/artists/nadie-123').flush({ error: 'Aún no hay datos' }, { status: 404, statusText: 'Not Found' });
    await tick();
    await fixture.whenStable();
    expect(el.textContent).toContain('Aún no hay datos de “nadie-123”');
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Sincronizar ahora'))!.click();
    http.expectOne({ method: 'POST', url: '/api/artists/nadie-123/sync' }).flush({ sync: sync() }, { status: 202, statusText: 'Accepted' });
    await tick();
    http.expectOne('/api/syncs/7').flush({ sync: sync({ status: 'not_found', message: 'El usuario “nadie-123” no existe en DeviantArt.' }) });
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('no existe en DeviantArt');
  });

  it('muestra el error del servidor', async () => {
    const { fixture, el } = await setup('feithnoir');
    http.expectOne('/api/artists/feithnoir').flush({ error: 'Base de datos bloqueada' }, { status: 500, statusText: 'Error' });
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Base de datos bloqueada');
  });
});
