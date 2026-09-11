import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { SKIP_AUTH_INTERCEPTOR } from '../auth/auth-http.context';

/** Wakes the production host without making startup depend on it. */
@Injectable({ providedIn: 'root' })
export class BackendWarmupService {
  private readonly http = inject(HttpClient);
  private warmed = false;

  warm(): void {
    if (!environment.production || this.warmed) return;
    this.warmed = true;
    // /v3/api-docs is the only documented public GET endpoint; do not attach a token
    // or let a failed warm-up affect authentication state.
    this.http.get(`${environment.apiBaseUrl}/v3/api-docs`, {
      context: new HttpContext().set(SKIP_AUTH_INTERCEPTOR, true),
    }).pipe(catchError(() => EMPTY)).subscribe();
  }
}
