import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../api.service';
import { compactKey, num } from '../format';
import type { DictionaryInfo } from '../models';

export const DICTIONARY_EXAMPLE = {
  franchises: [
    {
      name: 'Mi franquicia favorita',
      aliases: ['mifranquicia', 'MF'],
      characters: ['Personaje Uno', { name: 'Personaje Dos', aliases: ['pdos'], weak: ['Dos'] }],
    },
  ],
  artists: {
    feithnoir: { originalSeries: ['Mi serie original'], originalCharacters: ['Mi OC'] },
  },
};

/** Diccionario de franquicias y personajes: consulta del incorporado y ampliación propia en JSON. */
@Component({
  selector: 'app-dictionary-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <p class="crumbs"><a routerLink="/">← Inicio</a></p>
    <section class="card">
      <h1>Diccionario de franquicias y personajes</h1>
      <p class="explain">
        La clasificación automática busca estos nombres en las <strong>etiquetas</strong> y el <strong>título</strong> de cada obra (y en la descripción solo
        si no encuentra nada). Acepta variantes sin espacios, con guion bajo o en orden japonés: <code>sakuraharuno</code>, <code>sakura_haruno</code>,
        <code>harunosakura</code>. Si una obra se clasifica mal, corrígela en su página; si falta una franquicia o un personaje, agrégalo abajo.
      </p>
      @if (info(); as d) {
        <p class="muted small">
          Versión {{ d.version ?? '—' }} · huella <code>{{ d.hash }}</code> · {{ n(d.franchises.length) }} franquicias · {{ n(totalCharacters()) }} personajes
          @if (d.artists.length) {
            · reglas propias de: {{ d.artists.join(', ') }}
          }
        </p>
      }
    </section>

    <section class="card">
      <h2>Tu ampliación (JSON)</h2>
      <p class="explain">
        Se suma al diccionario incorporado (si repites el nombre de una franquicia, se fusionan sus alias y personajes). Al guardar se
        <strong>reclasifican todas las obras</strong> de todos los artistas sin volver a descargar nada; las correcciones manuales se respetan.
        Claves: <code>franchises</code> (con <code>name</code>, <code>aliases</code>, <code>characters</code>), <code>artists</code>
        (<code>originalSeries</code>, <code>originalCharacters</code> por usuario), <code>suffixes</code>, <code>prefixes</code>, <code>original</code>.
        En un personaje, <code>weak</code> son nombres ambiguos (como “Sakura”) que solo cuentan si la obra ya tiene esa franquicia.
      </p>
      <label class="sr-only" for="dict-json">JSON de la ampliación</label>
      <textarea id="dict-json" class="code" rows="14" spellcheck="false" [value]="text()" (input)="text.set($any($event.target).value)"></textarea>
      <div class="field--actions">
        <button type="button" class="btn btn--primary" (click)="save()" [disabled]="busy()">{{ busy() ? 'Guardando y reclasificando…' : 'Guardar y reclasificar' }}</button>
        <button type="button" class="btn" (click)="text.set(example)" [disabled]="busy()">Cargar ejemplo</button>
        <button type="button" class="btn" (click)="clear()" [disabled]="busy() || !info()?.custom">Borrar ampliación</button>
      </div>
      @if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
      }
      @if (notice()) {
        <p class="alert" role="status">{{ notice() }}</p>
      }
    </section>

    <section class="card">
      <h2>Franquicias incluidas</h2>
      <div class="field">
        <label for="dict-q">Buscar franquicia, alias o personaje</label>
        <input id="dict-q" type="search" [value]="q()" (input)="q.set($any($event.target).value)" placeholder="p. ej. Sarada, rwby, Bleach" />
      </div>
      <p class="muted small" aria-live="polite">{{ n(filtered().length) }} franquicias</p>
      <ul class="dict-list">
        @for (f of filtered().slice(0, limit()); track f.name) {
          <li>
            <strong>{{ f.name }}</strong>
            @if (f.aliases.length) {
              <small class="muted"> · alias: {{ f.aliases.join(', ') }}</small>
            }
            @if (f.characters.length) {
              <p class="small">{{ f.characters.join(' · ') }}</p>
            }
          </li>
        }
      </ul>
      @if (filtered().length > limit()) {
        <button type="button" class="btn" (click)="limit.set(limit() + 60)">Ver más</button>
      }
    </section>
  `,
})
export class DictionaryPage {
  private readonly api = inject(ApiService);
  protected readonly info = signal<DictionaryInfo | null>(null);
  protected readonly text = signal('');
  protected readonly q = signal('');
  protected readonly limit = signal(60);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly n = num;
  protected readonly example = JSON.stringify(DICTIONARY_EXAMPLE, null, 2);

  protected readonly totalCharacters = computed(() => (this.info()?.franchises ?? []).reduce((a, f) => a + f.characters.length, 0));
  protected readonly filtered = computed(() => {
    const list = this.info()?.franchises ?? [];
    const k = compactKey(this.q());
    if (!k) return list;
    return list.filter((f) => [f.name, ...f.aliases, ...f.characters].some((x) => compactKey(x).includes(k)));
  });

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      this.apply(await this.api.dictionary());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private apply(d: DictionaryInfo) {
    this.info.set(d);
    this.text.set(d.custom ? JSON.stringify(d.custom, null, 2) : '');
  }

  protected async save() {
    this.error.set('');
    this.notice.set('');
    let body: unknown;
    try {
      body = JSON.parse(this.text() || '{}');
    } catch (e) {
      this.error.set(`El JSON no es válido: ${(e as Error).message}`);
      return;
    }
    await this.run(() => this.api.saveDictionary(body));
  }

  protected clear() {
    this.error.set('');
    this.notice.set('');
    return this.run(() => this.api.clearDictionary());
  }

  private async run(fn: () => Promise<DictionaryInfo>) {
    this.busy.set(true);
    try {
      const d = await fn();
      this.apply(d);
      this.notice.set(`Guardado. Se reclasificaron ${num(d.reclassified ?? 0)} obras con el diccionario ${d.hash}.`);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
