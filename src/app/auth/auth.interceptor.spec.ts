import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { authInterceptor } from './auth.interceptor';
import { AuthSessionService } from './auth-session.service';

const apiUrl = 'https://gym-tracker-api-s70k.onrender.com/api/routines';

describe('authInterceptor', () => {
  let http: HttpClient;
  let requests: HttpTestingController;
  let session: {
    accessToken: ReturnType<typeof signal<string | null>>;
    refreshAccessToken: jasmine.Spy<() => Promise<string>>;
    invalidateSession: jasmine.Spy<() => void>;
  };

  beforeEach(() => {
    session = {
      accessToken: signal<string | null>('access-token'),
      refreshAccessToken: jasmine.createSpy('refreshAccessToken'),
      invalidateSession: jasmine.createSpy('invalidateSession'),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthSessionService, useValue: session },
      ],
    });
    http = TestBed.inject(HttpClient);
    requests = TestBed.inject(HttpTestingController);
  });

  afterEach(() => requests.verify());

  it('adds bearer only to the configured API and never credentials globally', () => {
    http.get(apiUrl).subscribe();
    http.get('https://example.test/telemetry').subscribe();

    const apiRequest = requests.expectOne(apiUrl).request;
    expect(apiRequest.headers.get('Authorization')).toBe('Bearer access-token');
    expect(apiRequest.withCredentials).toBeFalse();
    expect(requests.expectOne('https://example.test/telemetry').request.headers.has('Authorization')).toBeFalse();
  });

  it('refreshes an expired token and retries the original request once', fakeAsync(() => {
    session.refreshAccessToken.and.resolveTo('fresh-token');
    let result: { ok: boolean } | undefined;
    http.get<{ ok: boolean }>(apiUrl).subscribe((value) => result = value);

    requests.expectOne(apiUrl).flush(null, { status: 401, statusText: 'Unauthorized' });
    flushMicrotasks();
    const retry = requests.expectOne(apiUrl);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh-token');
    retry.flush({ ok: true });

    expect(result).toEqual({ ok: true });
    expect(session.refreshAccessToken).toHaveBeenCalledTimes(1);
  }));

  it('waits for a shared in-flight refresh before retrying concurrent 401 requests', fakeAsync(() => {
    let resolveRefresh!: (token: string) => void;
    const pendingRefresh = new Promise<string>((resolve) => resolveRefresh = resolve);
    session.refreshAccessToken.and.returnValue(pendingRefresh);
    http.get(`${apiUrl}/one`).subscribe();
    http.get(`${apiUrl}/two`).subscribe();

    requests.expectOne(`${apiUrl}/one`).flush(null, { status: 401, statusText: 'Unauthorized' });
    requests.expectOne(`${apiUrl}/two`).flush(null, { status: 401, statusText: 'Unauthorized' });

    resolveRefresh('fresh-token');
    flushMicrotasks();
    expect(requests.expectOne(`${apiUrl}/one`).request.headers.get('Authorization')).toBe('Bearer fresh-token');
    expect(requests.expectOne(`${apiUrl}/two`).request.headers.get('Authorization')).toBe('Bearer fresh-token');
  }));

  it('lets the coordinated session service own definitive refresh rejection', fakeAsync(() => {
    session.refreshAccessToken.and.rejectWith(new HttpErrorResponse({ status: 401 }));
    http.get(apiUrl).subscribe({ error: () => undefined });

    requests.expectOne(apiUrl).flush(null, { status: 401, statusText: 'Unauthorized' });
    flushMicrotasks();

    expect(session.invalidateSession).not.toHaveBeenCalled();
  }));

  it('does not log out on network or server failure during refresh', fakeAsync(() => {
    session.refreshAccessToken.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    http.get(apiUrl).subscribe({ error: () => undefined });

    requests.expectOne(apiUrl).flush(null, { status: 401, statusText: 'Unauthorized' });
    flushMicrotasks();

    expect(session.invalidateSession).not.toHaveBeenCalled();
  }));
});
