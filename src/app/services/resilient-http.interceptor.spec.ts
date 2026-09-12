import { HttpContext, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { defer, of, throwError } from 'rxjs';
import { RETRY_SAFE_REQUEST, resilientHttpInterceptor } from './resilient-http.interceptor';

describe('resilientHttpInterceptor', () => {
  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  it('retries transient safe requests without changing the operation body', () => {
    const body = { clientId: 'stable-client-id', name: 'Press' };
    const request = new HttpRequest('POST', '/api/exercises', body, { context: new HttpContext().set(RETRY_SAFE_REQUEST, true) });
    const received: HttpRequest<unknown>[] = [];
    let completed = false;

    resilientHttpInterceptor(request, value => {
      return defer(() => {
        received.push(value);
        return received.length < 3 ? throwError(() => new HttpErrorResponse({ status: 503 })) : of({ type: 4 } as any);
      });
    }).subscribe({ complete: () => completed = true });

    jasmine.clock().tick(1_500);
    expect(completed).toBeTrue();
    expect(received).toHaveSize(3);
    expect(received.every(value => value.body === body)).toBeTrue();
  });

  it('does not retry validation failures', () => {
    let calls = 0;
    resilientHttpInterceptor(new HttpRequest('GET', '/api/statistics'), () => {
      calls++;
      return throwError(() => new HttpErrorResponse({ status: 400 }));
    }).subscribe({ error: () => undefined });
    expect(calls).toBe(1);
  });
});
