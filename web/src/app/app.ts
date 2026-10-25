import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { UserSearch } from './pages/user-search';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UserSearch],
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/" aria-label="DA Métricas, inicio">
        <span class="brand__mark" aria-hidden="true">◆</span> DA <strong>Métricas</strong>
      </a>
      <nav class="topbar__nav" aria-label="Principal">
        <a routerLink="/tendencias" routerLinkActive="topbar__link--on" class="topbar__link">Tendencias</a>
      </nav>
      <app-user-search class="topbar__search" compact />
    </header>
    <main class="page">
      <router-outlet />
    </main>
    <footer class="footer">
      Datos públicos de DeviantArt (RSS, oEmbed y páginas públicas), sin la API oficial. Proyecto no afiliado a DeviantArt. ·
      <a routerLink="/diccionario">Diccionario de franquicias y personajes</a> · <a routerLink="/tendencias">Tendencias</a>
    </footer>
  `,
})
export class App {}
