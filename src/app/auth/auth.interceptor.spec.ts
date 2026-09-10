import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthApiService } from './auth-api.service';
import { authInterceptor } from './auth.interceptor';
import { AuthSessionService } from './auth-session.service';
import { AuthTokenStorage } from './auth-token.storage';

describe('authInterceptor', () => {
  let http: HttpClient;
  let requests: HttpTestingController;
  let tokenStorage: AuthTokenStorage;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        AuthTokenStorage,
        AuthSessionService,
        { provide: AuthApiService, useValue: {} },
      ],
    });
    http = TestBed.inject(HttpClient);
    requests = TestBed.inject(HttpTestingController);
    tokenStorage = TestBed.inject(AuthTokenStorage);
    localStorage.clear();
  });

  afterEach(() => requests.verify());

  it('adds a bearer token only to the configured API', () => {
    tokenStorage.set('jwt-token');

    http.get('https://gym-tracker-api-s70k.onrender.com/api/users/me').subscribe();
    http.get('https://example.test/telemetry').subscribe();

    expect(requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/users/me').request.headers.get('Authorization'))
      .toBe('Bearer jwt-token');
    expect(requests.expectOne('https://example.test/telemetry').request.headers.has('Authorization')).toBeFalse();
  });

  it('clears only the auth token after a protected API returns 401', () => {
    tokenStorage.set('expired-token');
    localStorage.setItem('guest-data-check', 'keep');

    http.get('https://gym-tracker-api-s70k.onrender.com/api/users/me').subscribe({ error: () => undefined });
    requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/users/me').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(tokenStorage.get()).toBeNull();
    expect(localStorage.getItem('guest-data-check')).toBe('keep');
  });
});
