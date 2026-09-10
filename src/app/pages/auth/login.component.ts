import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthSessionService } from '../../auth/auth-session.service';
import { BackendErrorResponse, ValidationErrorResponse } from '../../auth/auth.models';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly auth = inject(AuthSessionService);
  private readonly router = inject(Router);

  email = typeof history.state?.email === 'string' ? history.state.email : '';
  password = '';
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  async submit(): Promise<void> {
    this.error.set(null);
    this.submitting.set(true);
    try {
      await this.auth.login({ email: this.email.trim(), password: this.password });
      await this.router.navigate(['/home']);
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.submitting.set(false);
    }
  }
}

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'No se pudo contactar con el servidor. Tus datos locales siguen disponibles.';
  }

  if (error.status === 0 || error.status >= 500) {
    return 'El servidor no está disponible todavía. Tus datos locales siguen disponibles; inténtalo de nuevo.';
  }

  const body = error.error as BackendErrorResponse | undefined;
  if (error.status === 401) {
    return 'Correo o contraseña incorrectos.';
  }
  if (error.status === 409 && body?.code === 'EMAIL_ALREADY_EXISTS') {
    return 'Ya existe una cuenta con este correo.';
  }
  if (error.status === 400 && body?.code === 'VALIDATION_ERROR') {
    const validation = body as ValidationErrorResponse;
    return Object.values(validation.errors).join(' ') || 'Revisa los datos introducidos.';
  }
  return (body && 'message' in body && body.message) || 'No se pudo completar la operación. Inténtalo de nuevo.';
}
