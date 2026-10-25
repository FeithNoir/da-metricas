import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../api.service';
import { dateTime, RATING_LABEL, splitList } from '../format';
import type { ClassificationRecord, DictionaryInfo, Evidence, RatingClass } from '../models';

const SOURCE: Record<Evidence['source'], string> = { tag: 'etiqueta', title: 'título', description: 'descripción', inferred: 'deducida del personaje' };

/** Franquicia, personajes y SFW/NSFW de una obra: por qué se clasificó así y corrección manual. */
@Component({
  selector: 'app-classification-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @let r = record();
    <section class="card" aria-labelledby="clasif-title">
      <div class="card-head">
        <h2 id="clasif-title">Franquicia, personajes y SFW/NSFW</h2>
        @if (r.override) {
          <span class="badge badge--manual">corregida a mano</span>
        } @else {
          <span class="badge">automática</span>
        }
      </div>
      <dl class="classif-dl">
        <dt>Franquicia o fuente</dt>
        <dd>
          @for (f of r.effective.franchises; track f) {
            <a class="chip chip--fr" [class.chip--orig]="f === 'Original'" [routerLink]="['/artista', username()]" [queryParams]="{ franquicia: f }">{{ f }}</a>
          } @empty {
            <span class="chip chip--none">sin clasificar</span>
          }
        </dd>
        <dt>Personajes</dt>
        <dd>
          @for (c of r.effective.characters; track c) {
            <a class="chip chip--ch" [routerLink]="['/artista', username()]" [queryParams]="{ personaje: c }">{{ c }}</a>
          } @empty {
            <span class="muted">ninguno identificado</span>
          }
        </dd>
        <dt>SFW / NSFW</dt>
        <dd>
          <span class="chip" [class.chip--nsfw]="r.effective.ratingClass === 'nsfw'">{{ rl[r.effective.ratingClass] }}</span>
          <small class="muted">DeviantArt dice: {{ r.rawRating ?? 'sin dato' }}</small>
        </dd>
      </dl>

      @if (r.evidence.length) {
        <details>
          <summary>¿Por qué se clasificó así? ({{ r.evidence.length }})</summary>
          <ul class="plain small">
            @for (e of r.evidence; track $index) {
              <li><strong>{{ e.value }}</strong> — {{ src[e.source] }}: <code>{{ e.match }}</code></li>
            }
          </ul>
        </details>
      }
      @if (r.override) {
        <p class="muted small">
          Automático: {{ r.auto.franchises.join(', ') || 'sin clasificar' }}
          @if (r.auto.characters.length) {
            · {{ r.auto.characters.join(', ') }}
          }
          · {{ rl[r.auto.ratingClass] }}. Corregido {{ dt(r.override.updatedAt) }}.
        </p>
      }

      @if (!editing()) {
        <button type="button" class="btn" (click)="startEdit()">Corregir clasificación</button>
      } @else {
        <form class="classif-form" (submit)="$event.preventDefault(); save()" aria-label="Corregir clasificación">
          <div class="field">
            <label for="ov-fr">Franquicias o fuentes (separadas por comas)</label>
            <input id="ov-fr" list="ov-fr-list" [value]="fr()" (input)="fr.set($any($event.target).value)" placeholder="p. ej. Naruto, Original" />
            <datalist id="ov-fr-list">
              @for (f of franchiseNames(); track f) {
                <option [value]="f"></option>
              }
            </datalist>
            <small class="muted">Vacío = sin clasificar. Escribe “Original” para creaciones propias.</small>
          </div>
          <div class="field">
            <label for="ov-ch">Personajes (separados por comas)</label>
            <input id="ov-ch" list="ov-ch-list" [value]="ch()" (input)="ch.set($any($event.target).value)" placeholder="p. ej. Sakura Haruno, Sarada Uchiha" />
            <datalist id="ov-ch-list">
              @for (c of characterNames(); track c) {
                <option [value]="c"></option>
              }
            </datalist>
          </div>
          <div class="field">
            <label for="ov-rt">SFW / NSFW</label>
            <select id="ov-rt" [value]="rt()" (change)="rt.set($any($event.target).value)">
              <option value="auto" [selected]="rt() === 'auto'">Según DeviantArt ({{ rl[r.auto.ratingClass] }})</option>
              <option value="sfw" [selected]="rt() === 'sfw'">SFW</option>
              <option value="nsfw" [selected]="rt() === 'nsfw'">NSFW</option>
              <option value="desconocido" [selected]="rt() === 'desconocido'">Desconocido</option>
            </select>
          </div>
          <div class="field--actions">
            <button type="submit" class="btn btn--primary" [disabled]="busy()">Guardar</button>
            <button type="button" class="btn" (click)="editing.set(false)" [disabled]="busy()">Cancelar</button>
            @if (r.override) {
              <button type="button" class="btn" (click)="clear()" [disabled]="busy()">Volver a lo automático</button>
            }
          </div>
        </form>
      }
      @if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
      }
    </section>
  `,
})
export class ClassificationCard {
  private readonly api = inject(ApiService);
  readonly record = input.required<ClassificationRecord>();
  readonly workId = input.required<string>();
  readonly username = input.required<string>();
  readonly saved = output<ClassificationRecord>();

  protected readonly rl = RATING_LABEL;
  protected readonly src = SOURCE;
  protected readonly dt = dateTime;
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly fr = signal('');
  protected readonly ch = signal('');
  protected readonly rt = signal<RatingClass | 'auto'>('auto');
  private readonly dict = signal<DictionaryInfo | null>(null);
  protected readonly franchiseNames = computed(() => ['Original', ...(this.dict()?.franchises.map((f) => f.name) ?? [])]);
  protected readonly characterNames = computed(() => {
    const names = this.dict()?.franchises.flatMap((f) => f.characters) ?? [];
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'es'));
  });

  protected startEdit() {
    const r = this.record();
    this.fr.set(r.effective.franchises.join(', '));
    this.ch.set(r.effective.characters.join(', '));
    this.rt.set(r.override?.rating ?? 'auto');
    this.error.set('');
    this.editing.set(true);
    if (!this.dict()) this.api.dictionary().then((d) => this.dict.set(d), () => undefined);
  }

  protected async save() {
    const r = this.record();
    const franchises = splitList(this.fr());
    const characters = splitList(this.ch());
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    // Solo se guarda como corrección lo que difiere de lo automático; lo igual queda en automático (null).
    const body = {
      franchises: same(franchises, r.auto.franchises) ? null : franchises,
      characters: same(characters, r.auto.characters) ? null : characters,
      rating: this.rt() === 'auto' ? null : (this.rt() as RatingClass),
    };
    await this.run(() => this.api.saveClassification(this.workId(), body));
  }

  protected clear() {
    return this.run(() => this.api.clearClassification(this.workId()));
  }

  private async run(fn: () => Promise<{ classification: ClassificationRecord }>) {
    this.busy.set(true);
    this.error.set('');
    try {
      const { classification } = await fn();
      this.saved.emit(classification);
      this.editing.set(false);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
