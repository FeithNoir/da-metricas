import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { UserSearch } from './pages/user-search';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, UserSearch],
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/" aria-label="DA Métricas, inicio">
        <span class="brand__mark" aria-hidden="true">◆</span> DA <strong>Métricas</strong>
      </a>
      <app-user-search class="topbar__search" compact />
    </header>
    <main class="page">
      <router-outlet />
    </main>
    <footer class="footer">
      Datos públicos de DeviantArt (RSS, oEmbed y páginas públicas), sin la API oficial. Proyecto no afiliado a DeviantArt.
    </footer>
  `,
})
export class App {}
