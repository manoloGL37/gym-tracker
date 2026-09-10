import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthApiService } from './auth-api.service';
import { AuthSessionService } from './auth-session.service';
import { AUTH_TOKEN_STORAGE_KEY, AuthTokenStorage } from './auth-token.storage';
import { UserResponse } from './auth.models';

const user: UserResponse = {
  id: '0f3f10cc-932d-4b02-bd2b-7ecf8f2305f2',
  email: 'athlete@example.com',
  createdAt: '2026-09-10T14:30:00',
};

describe('AuthSessionService', () => {
  let service: AuthSessionService;
  let api: jasmine.SpyObj<AuthApiService>;

  beforeEach(() => {
    localStorage.clear();
    api = jasmine.createSpyObj<AuthApiService>('AuthApiService', ['register', 'login', 'getCurrentUser']);
    TestBed.configureTestingModule({
      providers: [
        AuthSessionService,
        AuthTokenStorage,
        { provide: AuthApiService, useValue: api },
      ],
    });
  });

  it('initializes as a guest without a token', async () => {
    service = TestBed.inject(AuthSessionService);
    await service.initialize();

    expect(service.isGuest()).toBeTrue();
    expect(service.persistenceMode()).toBe('local');
    expect(service.initializationStatus()).toBe('ready');
    expect(api.getCurrentUser).not.toHaveBeenCalled();
  });

  it('restores a valid stored session', async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'valid-token');
    api.getCurrentUser.and.returnValue(of(user));
    service = TestBed.inject(AuthSessionService);

    await service.initialize();

    expect(service.isAuthenticated()).toBeTrue();
    expect(service.currentUser()).toEqual(user);
    expect(service.persistenceMode()).toBe('cloud');
  });

  it('clears only auth state after a confirmed 401', async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'expired-token');
    localStorage.setItem('guest-data-check', 'keep');
    api.getCurrentUser.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    service = TestBed.inject(AuthSessionService);

    await service.initialize();

    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('guest-data-check')).toBe('keep');
    expect(service.isGuest()).toBeTrue();
  });

  it('keeps a stored token when the backend is unavailable', async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'still-valid-maybe');
    api.getCurrentUser.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    service = TestBed.inject(AuthSessionService);

    await service.initialize();

    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('still-valid-maybe');
    expect(service.initializationStatus()).toBe('unavailable');
    expect(service.isGuest()).toBeTrue();
  });

  it('stores a token and current user on login', async () => {
    api.login.and.returnValue(of({ accessToken: 'new-token' }));
    api.getCurrentUser.and.returnValue(of(user));
    service = TestBed.inject(AuthSessionService);

    await service.login({ email: user.email, password: 'password123' });

    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('new-token');
    expect(service.currentUser()).toEqual(user);
  });

  it('keeps guest mode when login credentials are rejected', async () => {
    api.login.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    service = TestBed.inject(AuthSessionService);

    await expectAsync(service.login({ email: user.email, password: 'wrong-password' })).toBeRejected();

    expect(service.isGuest()).toBeTrue();
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('logout removes only the token and session state', () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'token');
    localStorage.setItem('guest-data-check', 'keep');
    service = TestBed.inject(AuthSessionService);

    service.logout();

    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('guest-data-check')).toBe('keep');
    expect(service.isGuest()).toBeTrue();
  });
});
