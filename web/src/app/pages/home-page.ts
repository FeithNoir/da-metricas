import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../api.service';
import { ago, num, SYNC_STATUS } from '../format';
import type { Artist } from '../models';
import { SettingsPanel } from './settings-panel';
import { UserSearch } from './user-search';

@Component({
  selector: 'app-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UserSearch, SettingsPanel],
  template: `
    <section class="hero">
      <h1>¿Cómo les va a tus obras en DeviantArt?</h1>
      <p class="lead">
        Escribe un usuario, sincroniza sus obras públicas y mira vistas, favoritos, comentarios y etiquetas,
        con estadísticas explicadas en lenguaje sencillo. Sin la API oficial y sin cuentas: solo datos públicos.
      </p>
      <app-user-search />
    </section>

    <section class="card" aria-labelledby="artists-title">
      <h2 id="artists-title">Artistas guardados</h2>
      @if (loading()) {
        <p class="muted" aria-live="polite">Cargando…</p>
      } @else if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
      } @else if (!artists().length) {
        <p class="empty">Todavía no has sincronizado a nadie. Prueba con <a routerLink="/artista/feithnoir">feithnoir</a>.</p>
      } @else {
        <ul class="artists">
          @for (a of artists(); track a.username) {
            <li>
              <a class="artist-chip" [routerLink]="['/artista', a.username]">
                @if (a.avatar) {
                  <img [src]="a.avatar" alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer" />
                }
                <span>
                  <strong>{{ a.displayName }}</strong>
                  <small>{{ n(a.works) }} obras · sincronizado {{ ago(a.lastSyncAt) }}@if (a.lastSyncStatus && a.lastSyncStatus !== 'ok') { ({{ status[a.lastSyncStatus] }})}</small>
                </span>
              </a>
            </li>
          }
        </ul>
      }
    </section>

    <app-settings-panel />

    <section class="card" aria-labelledby="how-title">
      <h2 id="how-title">De dónde salen los datos</h2>
      <ul class="plain">
        <li><strong>Feed RSS público</strong> de la galería: lista de obras con título, enlace, fecha y miniatura.</li>
        <li><strong>oEmbed público</strong> de cada obra: vistas, favoritos, comentarios, descargas y etiquetas.</li>
        <li><strong>Página pública</strong> de la obra: solo como respaldo si el oEmbed falla.</li>
      </ul>
      <p class="muted small">
        El contenido premium o de pago no aparece en el feed público, así que no se puede medir. Las peticiones van
        de una en una o de dos en dos, con pausas, reintentos y caché, para respetar a DeviantArt.
      </p>
    </section>
  `,
})
export class HomePage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly artists = signal<Artist[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly n = num;
  protected readonly ago = ago;
  protected readonly status = SYNC_STATUS;

  async ngOnInit() {
    try {
      this.artists.set((await this.api.artists()).artists);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
