import type { Routes } from '@angular/router';
import { ArtistPage } from './pages/artist-page';
import { DictionaryPage } from './pages/dictionary-page';
import { HomePage } from './pages/home-page';
import { WorkDetailPage } from './pages/work-detail-page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'DA Métricas' },
  { path: 'artista/:username', component: ArtistPage, title: 'Artista · DA Métricas' },
  { path: 'obra/:id', component: WorkDetailPage, title: 'Obra · DA Métricas' },
  { path: 'diccionario', component: DictionaryPage, title: 'Diccionario · DA Métricas' },
  { path: '**', redirectTo: '' },
];
