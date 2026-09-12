import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { retry, throwError, timer } from 'rxjs';

/** Opt in idempotent mutations only after their request identity is persisted. */
export const RETRY_SAFE_REQUEST = new HttpContextToken<boolean>(() => false);

const retryableStatus = (error: unknown): boolean => error instanceof HttpErrorResponse
  && (error.status === 0 || error.status === 408 || error.status === 429 || error.status === 502 || error.status === 503 || error.status >= 500);

/** Reads are safe to replay; mutations must opt in explicitly to avoid duplicate work. */
export const resilientHttpInterceptor: HttpInterceptorFn = (request, next) => {
  const safeToRetry = request.method === 'GET' || request.context.get(RETRY_SAFE_REQUEST);
  if (!safeToRetry) return next(request);

  return next(request).pipe(retry({
    count: 2,
    delay: (error, attempt) => retryableStatus(error)
      // ponytail: two bounded retries (350 ms, 1 s); queued work handles longer outages.
      ? timer(Math.min(1_000, 350 * 3 ** (attempt - 1)))
      : throwError(() => error),
  }));
};
