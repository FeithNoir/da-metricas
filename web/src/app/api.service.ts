import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Analysis, Artist, ArtistResponse, Settings, SyncRecord, Work, WorkDetailResponse } from './models';

/** Mensaje en español a partir de un error HTTP. */
export function errorMessage(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const body = e.error as { error?: string } | null;
    if (body && typeof body === 'object' && body.error) return body.error;
    if (e.status === 0) return 'No hay conexión con el servidor local. ¿Está corriendo?';
    return `Error ${e.status} del servidor.`;
  }
  return (e as Error)?.message ?? 'Error desconocido.';
}

export const isNotFound = (e: unknown) => e instanceof HttpErrorResponse && e.status === 404;

export interface WorksFilter {
  q?: string;
  tag?: string;
  from?: string;
  to?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly u = (name: string) => encodeURIComponent(name.trim().toLowerCase());

  artists() {
    return firstValueFrom(this.http.get<{ artists: Artist[] }>('/api/artists'));
  }
  artist(username: string) {
    return firstValueFrom(this.http.get<ArtistResponse>(`/api/artists/${this.u(username)}`));
  }
  setAutoSync(username: string, autoSync: boolean) {
    return firstValueFrom(this.http.patch<{ artist: Artist }>(`/api/artists/${this.u(username)}`, { autoSync }));
  }
  startSync(username: string) {
    return firstValueFrom(this.http.post<{ sync: SyncRecord }>(`/api/artists/${this.u(username)}/sync`, {}));
  }
  sync(id: number) {
    return firstValueFrom(this.http.get<{ sync: SyncRecord }>(`/api/syncs/${id}`));
  }
  works(username: string) {
    return firstValueFrom(this.http.get<{ total: number; items: Work[] }>(`/api/artists/${this.u(username)}/deviations`));
  }
  analysis(username: string) {
    return firstValueFrom(this.http.get<Analysis>(`/api/artists/${this.u(username)}/analysis`));
  }
  work(id: string) {
    return firstValueFrom(this.http.get<WorkDetailResponse>(`/api/deviations/${encodeURIComponent(id)}`));
  }
  settings() {
    return firstValueFrom(this.http.get<Settings>('/api/settings'));
  }
  saveSettings(s: Partial<Pick<Settings, 'enabled' | 'intervalHours'>>) {
    return firstValueFrom(this.http.put<Settings>('/api/settings', s));
  }
  csvUrl(username: string, f: WorksFilter = {}) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) p = p.set(k, v);
    const qs = p.toString();
    return `/api/artists/${this.u(username)}/export.csv${qs ? `?${qs}` : ''}`;
  }
}
