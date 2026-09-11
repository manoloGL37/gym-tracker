import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SKIP_AUTH_INTERCEPTOR } from '../auth/auth-http.context';
import { BackendWarmupService } from './backend-warmup.service';

describe('BackendWarmupService', () => {
  let service: BackendWarmupService;
  let requests: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(BackendWarmupService);
    requests = TestBed.inject(HttpTestingController);
  });

  afterEach(() => requests.verify());

  it('warms the documented public endpoint once without propagating a network failure', () => {
    expect(() => service.warm()).not.toThrow();
    const request = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/v3/api-docs');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    expect(request.request.context.get(SKIP_AUTH_INTERCEPTOR)).toBeTrue();
    request.error(new ProgressEvent('error'));
    service.warm();
    requests.expectNone('https://gym-tracker-api-s70k.onrender.com/v3/api-docs');
  });
});
