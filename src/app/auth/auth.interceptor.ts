import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, of, switchMap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AUTH_RETRY_ATTEMPTED, SKIP_AUTH_INTERCEPTOR } from './auth-http.context';
import { AuthSessionService } from './auth-session.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(`${environment.apiBaseUrl}/`) || request.context.get(SKIP_AUTH_INTERCEPTOR)) {
    return next(request);
  }

  const session = inject(AuthSessionService);
  const token = session.accessToken();
  const authorizedRequest = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorizedRequest).pipe(
    catchError((error: unknown) => {
      if (
        !token
        || !(error instanceof HttpErrorResponse)
        || error.status !== 401
        || request.context.get(AUTH_RETRY_ATTEMPTED)
      ) {
        return throwError(() => error);
      }

      const currentToken = session.accessToken();
      const nextToken = currentToken && currentToken !== token
        ? of(currentToken)
        : from(session.refreshAccessToken());

      return nextToken.pipe(
        switchMap((accessToken) => next(request.clone({
          context: request.context.set(AUTH_RETRY_ATTEMPTED, true),
          setHeaders: { Authorization: `Bearer ${accessToken}` },
        }))),
        catchError((refreshError: unknown) => throwError(() => refreshError)),
      );
    }),
  );
};
