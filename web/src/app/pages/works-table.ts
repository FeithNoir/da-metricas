import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../api.service';
import { compactKey, date, num, pct, RATING_LABEL, UNCLASSIFIED } from '../format';
import type { Work } from '../models';

export type SortKey = 'title' | 'publishedAt' | 'views' | 'favourites' | 'comments' | 'downloads' | 'favRate' | 'viewsPerDay';
export const PAGE_SIZE = 25;

export interface Filters {
  q: string;
  tag: string;
  /** Franquicia o fuente; “Sin clasificar” = obras sin franquicia. */
  franchise: string;
  character: string;
  /** '' | 'sfw' | 'nsfw' | 'desconocido' */
  rating: string;
  from: string;
  to: string;
}

export const EMPTY_FILTERS: Filters = { q: '', tag: '', franchise: '', character: '', rating: '', from: '', to: '' };

/** Filtra y ordena en el cliente (las galerías caben de sobra en memoria). */
export function applyFilters(works: Work[], f: Filters, sort: SortKey, dir: 1 | -1): Work[] {
  const q = f.q.trim().toLowerCase();
  const tag = f.tag.trim().toLowerCase();
  const from = f.from ? Date.parse(`${f.from}T00:00:00-05:00`) : NaN;
  const to = f.to ? Date.parse(`${f.to}T23:59:59.999-05:00`) : NaN;
  const fr = compactKey(f.franchise);
  const unclassified = fr === compactKey(UNCLASSIFIED);
  const ch = compactKey(f.character);
  const out = works.filter((w) => {
    if (q && !w.title.toLowerCase().includes(q)) return false;
    if (tag && !w.tags.includes(tag)) return false;
    if (fr && (unclassified ? (w.franchises ?? []).length > 0 : !(w.franchises ?? []).some((x) => compactKey(x) === fr))) return false;
    if (ch && !(w.characters ?? []).some((x) => compactKey(x) === ch)) return false;
    if (f.rating && (w.ratingClass ?? 'desconocido') !== f.rating) return false;
    const t = w.publishedAt ? Date.parse(w.publishedAt) : NaN;
    if (!Number.isNaN(from) && !(t >= from)) return false;
    if (!Number.isNaN(to) && !(t <= to)) return false;
    return true;
  });
  return out.sort((a, b) => {
    const x = a[sort];
    const y = b[sort];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === 'string' ? x.localeCompare(String(y), 'es') : (x as number) - (y as number)) * dir;
  });
}

@Component({
  selector: 'app-works-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <form class="filters card" (submit)="$event.preventDefault()" aria-label="Filtros de obras">
      <div class="field">
        <label for="f-q">Buscar por título</label>
        <input id="f-q" type="search" [value]="filters().q" (input)="set('q', $any($event.target).value)" placeholder="p. ej. Ecchitober" />
      </div>
      <div class="field">
        <label for="f-tag">Etiqueta</label>
        <input id="f-tag" list="tag-list" [value]="filters().tag" (input)="set('tag', $any($event.target).value)" placeholder="todas" />
        <datalist id="tag-list">
          @for (t of tagOptions(); track t.tag) {
            <option [value]="t.tag">{{ t.tag }} ({{ t.count }})</option>
          }
        </datalist>
      </div>
      <div class="field">
        <label for="f-fr">Franquicia o fuente</label>
        <select id="f-fr" [value]="filters().franchise" (change)="set('franchise', $any($event.target).value)">
          <option value="">Todas</option>
          @for (o of franchiseOptions(); track o.name) {
            <option [value]="o.name" [selected]="o.name === filters().franchise">{{ o.name }} ({{ o.count }})</option>
          }
        </select>
      </div>
      <div class="field">
        <label for="f-ch">Personaje</label>
        <input id="f-ch" list="char-list" [value]="filters().character" (input)="set('character', $any($event.target).value)" placeholder="todos" />
        <datalist id="char-list">
          @for (o of characterOptions(); track o.name) {
            <option [value]="o.name">{{ o.name }} ({{ o.count }})</option>
          }
        </datalist>
      </div>
      <div class="field">
        <label for="f-rt">SFW / NSFW</label>
        <select id="f-rt" [value]="filters().rating" (change)="set('rating', $any($event.target).value)">
          <option value="">Todas</option>
          @for (o of ratingOptions(); track o.key) {
            <option [value]="o.key" [selected]="o.key === filters().rating">{{ o.label }} ({{ o.count }})</option>
          }
        </select>
      </div>
      <div class="field">
        <label for="f-from">Desde</label>
        <input id="f-from" type="date" [value]="filters().from" (input)="set('from', $any($event.target).value)" />
      </div>
      <div class="field">
        <label for="f-to">Hasta</label>
        <input id="f-to" type="date" [value]="filters().to" (input)="set('to', $any($event.target).value)" />
      </div>
      <div class="field field--actions">
        <button type="button" class="btn" (click)="reset()" [disabled]="!hasFilters()">Limpiar</button>
        <a class="btn" [href]="csvHref()" download>CSV filtrado</a>
      </div>
    </form>

    <p class="muted small" aria-live="polite">
      {{ n(filtered().length) }} de {{ n(works().length) }} obras ·
      {{ n(totals().views) }} vistas · {{ n(totals().favourites) }} favoritos · {{ n(totals().comments) }} comentarios
    </p>

    @if (!filtered().length) {
      <p class="empty card">Ninguna obra coincide con los filtros.</p>
    } @else {
      <div class="table-wrap">
        <table class="works">
          <caption class="sr-only">Obras del artista</caption>
          <thead>
            <tr>
              <th scope="col"><span class="sr-only">Miniatura</span></th>
              @for (c of columns; track c.key) {
                <th scope="col" [attr.aria-sort]="sort() === c.key ? (dir() === 1 ? 'ascending' : 'descending') : 'none'" [class.num]="c.num">
                  <button type="button" class="sort" (click)="toggleSort(c.key)">{{ c.label }}{{ sort() === c.key ? (dir() === 1 ? ' ▲' : ' ▼') : '' }}</button>
                </th>
              }
              <th scope="col">Franquicia y personajes</th>
              <th scope="col">Etiquetas</th>
            </tr>
          </thead>
          <tbody>
            @for (w of pageItems(); track w.id) {
              <tr>
                <td class="thumb">
                  @if (w.thumbnail) {
                    <img [src]="w.thumbnail" alt="" width="56" height="42" loading="lazy" referrerpolicy="no-referrer" />
                  }
                </td>
                <td class="title">
                  <a [routerLink]="['/obra', w.id]">{{ w.title }}</a>
                  <a class="ext" [href]="w.url" target="_blank" rel="noopener noreferrer" [attr.aria-label]="'Abrir ' + w.title + ' en DeviantArt'">↗</a>
                  @if (w.ratingClass === 'nsfw') {
                    <span class="badge badge--nsfw" title="Marcada como contenido maduro en DeviantArt">NSFW</span>
                  } @else if (w.ratingClass === 'desconocido') {
                    <span class="badge" title="DeviantArt no informó la clasificación">¿SFW?</span>
                  }
                  @if (w.classificationOverridden) {
                    <span class="badge badge--manual" title="Clasificación corregida a mano">manual</span>
                  }
                  @if (!w.metricsAt) {
                    <span class="badge badge--warn">sin métricas</span>
                  }
                </td>
                <td class="nowrap">{{ d(w.publishedAt) }}</td>
                <td class="num">{{ n(w.views) }}</td>
                <td class="num">{{ n(w.favourites) }}</td>
                <td class="num">{{ n(w.comments) }}</td>
                <td class="num">{{ w.downloads === null ? '—' : n(w.downloads) }}</td>
                <td class="num">{{ p(w.favRate, 2) }}</td>
                <td class="num">{{ n(w.viewsPerDay, 1) }}</td>
                <td class="classif">
                  <div class="tags">
                    @for (f of w.franchises ?? []; track f) {
                      <button type="button" class="chip chip--fr" [class.chip--orig]="f === 'Original'" (click)="set('franchise', f)" [attr.aria-label]="'Filtrar por ' + f">{{ f }}</button>
                    } @empty {
                      <button type="button" class="chip chip--none" (click)="set('franchise', unclassified)">sin clasificar</button>
                    }
                    @for (c of (w.characters ?? []).slice(0, 3); track c) {
                      <button type="button" class="chip chip--ch" (click)="set('character', c)" [attr.aria-label]="'Filtrar por ' + c">{{ c }}</button>
                    }
                    @if ((w.characters ?? []).length > 3) {
                      <span class="muted small" [title]="(w.characters ?? []).join(', ')">+{{ (w.characters ?? []).length - 3 }}</span>
                    }
                  </div>
                </td>
                <td>
                  <div class="tags">
                  @for (t of w.tags.slice(0, 4); track t) {
                    <button type="button" class="tag" (click)="set('tag', t)">{{ t }}</button>
                  }
                  @if (w.tags.length > 4) {
                    <span class="muted small">+{{ w.tags.length - 4 }}</span>
                  }
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (pages() > 1) {
        <nav class="pager" aria-label="Paginación">
          <button type="button" class="btn" (click)="page.set(page() - 1)" [disabled]="page() === 1">← Anterior</button>
          <span>Página {{ page() }} de {{ pages() }}</span>
          <button type="button" class="btn" (click)="page.set(page() + 1)" [disabled]="page() === pages()">Siguiente →</button>
        </nav>
      }
    }
  `,
})
export class WorksTable {
  private readonly api = inject(ApiService);
  readonly works = input.required<Work[]>();
  readonly username = input.required<string>();
  /** Filtros iniciales (p. ej. al llegar desde el análisis con ?franquicia=Naruto). */
  readonly preset = input<Partial<Filters> | null>(null);

  protected readonly columns: { key: SortKey; label: string; num?: boolean }[] = [
    { key: 'title', label: 'Título' },
    { key: 'publishedAt', label: 'Publicada' },
    { key: 'views', label: 'Vistas', num: true },
    { key: 'favourites', label: 'Favoritos', num: true },
    { key: 'comments', label: 'Coment.', num: true },
    { key: 'downloads', label: 'Descargas', num: true },
    { key: 'favRate', label: 'Fav/vistas', num: true },
    { key: 'viewsPerDay', label: 'Vistas/día', num: true },
  ];
  protected readonly filters = signal<Filters>({ ...EMPTY_FILTERS });
  protected readonly unclassified = UNCLASSIFIED;
  protected readonly sort = signal<SortKey>('publishedAt');
  protected readonly dir = signal<1 | -1>(-1);
  protected readonly page = signal(1);
  protected readonly n = num;
  protected readonly p = pct;
  protected readonly d = date;

  protected readonly filtered = computed(() => applyFilters(this.works(), this.filters(), this.sort(), this.dir()));
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE_SIZE)));
  protected readonly pageItems = computed(() => {
    const pg = Math.min(this.page(), this.pages());
    return this.filtered().slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE);
  });
  protected readonly totals = computed(() =>
    this.filtered().reduce((a, w) => ({ views: a.views + w.views, favourites: a.favourites + w.favourites, comments: a.comments + w.comments }), { views: 0, favourites: 0, comments: 0 }),
  );
  protected readonly tagOptions = computed(() => {
    const m = new Map<string, number>();
    for (const w of this.works()) for (const t of w.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 300);
  });
  protected readonly franchiseOptions = computed(() => {
    const m = new Map<string, number>();
    let none = 0;
    for (const w of this.works()) {
      if (!w.franchises?.length) none++;
      for (const f of w.franchises ?? []) m.set(f, (m.get(f) ?? 0) + 1);
    }
    const out = [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
    if (none) out.push({ name: UNCLASSIFIED, count: none });
    return out;
  });
  /** Personajes; si hay una franquicia elegida, solo los que aparecen en ella. */
  protected readonly characterOptions = computed(() => {
    const fr = compactKey(this.filters().franchise);
    const m = new Map<string, number>();
    for (const w of this.works()) {
      if (fr && !(w.franchises ?? []).some((x) => compactKey(x) === fr)) continue;
      for (const c of w.characters ?? []) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
  });
  protected readonly ratingOptions = computed(() => {
    const m = new Map<string, number>();
    for (const w of this.works()) m.set(w.ratingClass ?? 'desconocido', (m.get(w.ratingClass ?? 'desconocido') ?? 0) + 1);
    return ['sfw', 'nsfw', 'desconocido'].filter((k) => m.get(k)).map((k) => ({ key: k, label: RATING_LABEL[k], count: m.get(k) ?? 0 }));
  });
  protected readonly hasFilters = computed(() => Object.values(this.filters()).some(Boolean));
  protected readonly csvHref = computed(() => {
    const f = this.filters();
    return this.api.csvUrl(this.username(), {
      q: f.q,
      tag: f.tag,
      franchise: f.franchise,
      character: f.character,
      rating: f.rating,
      from: f.from,
      to: f.to,
      sort: this.sort(),
      order: this.dir() === 1 ? 'asc' : 'desc',
    });
  });

  constructor() {
    effect(() => {
      const p = this.preset();
      if (!p) return;
      untracked(() => {
        this.filters.set({ ...EMPTY_FILTERS, ...Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'string')) });
        this.page.set(1);
      });
    });
  }

  protected set(k: keyof Filters, v: string) {
    this.filters.update((f) => ({ ...f, [k]: v }));
    this.page.set(1);
  }
  protected reset() {
    this.filters.set({ ...EMPTY_FILTERS });
    this.page.set(1);
  }
  protected toggleSort(k: SortKey) {
    if (this.sort() === k) this.dir.set(this.dir() === 1 ? -1 : 1);
    else {
      this.sort.set(k);
      this.dir.set(k === 'title' ? 1 : -1);
    }
    this.page.set(1);
  }
}
