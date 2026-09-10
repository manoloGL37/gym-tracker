import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthSessionService } from '../../auth/auth-session.service';
import { authErrorMessage } from './login.component';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  private readonly auth = inject(AuthSessionService);
  private readonly router = inject(Router);

  email = '';
  password = '';
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  async submit(): Promise<void> {
    this.error.set(null);
    this.submitting.set(true);
    try {
      await this.auth.register({ email: this.email.trim(), password: this.password });
      await this.router.navigate(['/login'], { state: { email: this.email.trim() } });
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.submitting.set(false);
    }
  }
}
