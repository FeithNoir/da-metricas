import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

export const USERNAME_RE = /^[a-z0-9-]{1,20}$/i;

/** Formulario para escribir un usuario de DeviantArt e ir a su página. */
@Component({
  selector: 'app-user-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="usersearch" [class.usersearch--compact]="compact()" (submit)="go($event)" role="search">
      <label class="sr-only" [attr.for]="id">Usuario de DeviantArt</label>
      <input
        [id]="id"
        type="text"
        autocomplete="off"
        spellcheck="false"
        placeholder="usuario de DeviantArt (p. ej. feithnoir)"
        [value]="value()"
        (input)="value.set($any($event.target).value)"
        [attr.aria-invalid]="!!error()"
        [attr.aria-describedby]="error() ? id + '-err' : null"
      />
      <button type="submit" class="btn btn--primary">{{ compact() ? 'Ir' : 'Ver métricas' }}</button>
    </form>
    @if (error()) {
      <p class="form-error" role="alert" [id]="id + '-err'">{{ error() }}</p>
    }
  `,
})
export class UserSearch {
  private readonly router = inject(Router);
  readonly compact = input(false, { transform: (v: boolean | string) => v === '' || v === true || v === 'true' });
  protected readonly value = signal('');
  protected readonly error = signal('');
  private static seq = 0;
  protected readonly id = `user-${++UserSearch.seq}`;

  protected go(e: Event) {
    e.preventDefault();
    const u = this.value()
      .trim()
      .replace(/^https?:\/\/(www\.)?deviantart\.com\//i, '')
      .replace(/^@/, '')
      .split(/[/?#]/)[0]
      .toLowerCase();
    if (!USERNAME_RE.test(u)) {
      this.error.set('Escribe un usuario válido: solo letras, números y guiones (máx. 20).');
      return;
    }
    this.error.set('');
    this.value.set('');
    void this.router.navigate(['/artista', u]);
  }
}
