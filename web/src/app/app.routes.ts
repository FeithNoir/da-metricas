import type { Routes } from '@angular/router';
import { ArtistPage } from './pages/artist-page';
import { HomePage } from './pages/home-page';
import { WorkDetailPage } from './pages/work-detail-page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'DA Métricas' },
  { path: 'artista/:username', component: ArtistPage, title: 'Artista · DA Métricas' },
  { path: 'obra/:id', component: WorkDetailPage, title: 'Obra · DA Métricas' },
  { path: '**', redirectTo: '' },
];
