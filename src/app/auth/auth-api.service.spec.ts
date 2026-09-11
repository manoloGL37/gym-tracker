import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { SKIP_AUTH_INTERCEPTOR } from './auth-http.context';
import { AuthApiService } from './auth-api.service';

describe('AuthApiService cookie credentials', () => {
  let api: AuthApiService;
  let requests: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(AuthApiService);
    requests = TestBed.inject(HttpTestingController);
  });

  afterEach(() => requests.verify());

  it('uses browser credentials for login, refresh and logout only', () => {
    api.login({ email: 'athlete@example.com', password: 'password123' }).subscribe();
    api.refresh().subscribe();
    api.logout().subscribe();
    api.getCurrentUser().subscribe();

    for (const path of ['login', 'refresh', 'logout']) {
      const request = requests.expectOne(`${environment.apiBaseUrl}/api/auth/${path}`).request;
      expect(request.withCredentials).toBeTrue();
      expect(request.context.get(SKIP_AUTH_INTERCEPTOR)).toBeTrue();
    }
    expect(requests.expectOne(`${environment.apiBaseUrl}/api/users/me`).request.withCredentials).toBeFalse();
  });
});
