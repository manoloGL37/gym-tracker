import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { SKIP_AUTH_INTERCEPTOR } from './auth-http.context';
import { AuthSessionService } from './auth-session.service';
import { AuthTokenStorage } from './auth-token.storage';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(`${environment.apiBaseUrl}/`) || request.context.get(SKIP_AUTH_INTERCEPTOR)) {
    return next(request);
  }

  const tokenStorage = inject(AuthTokenStorage);
  const session = inject(AuthSessionService);
  const token = tokenStorage.get();
  const authorizedRequest = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorizedRequest).pipe(
    catchError((error: unknown) => {
      if (token && error instanceof HttpErrorResponse && error.status === 401) {
        session.invalidateSession();
      }
      return throwError(() => error);
    }),
  );
};
