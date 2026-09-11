import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import Dexie from 'dexie';
import { Subject, of, throwError } from 'rxjs';
import { AuthApiService } from './auth-api.service';
import { AuthResponse, UserResponse } from './auth.models';
import { AuthSessionService } from './auth-session.service';

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
    api = jasmine.createSpyObj<AuthApiService>('AuthApiService', [
      'register', 'login', 'refresh', 'logout', 'getCurrentUser',
    ]);
    TestBed.configureTestingModule({
      providers: [AuthSessionService, { provide: AuthApiService, useValue: api }],
    });
    service = TestBed.inject(AuthSessionService);
  });

  it('restores a session on app restart through refresh and /me', async () => {
    api.refresh.and.returnValue(of({ accessToken: 'restored-token' }));
    api.getCurrentUser.and.returnValue(of(user));

    await service.initialize();

    expect(api.refresh).toHaveBeenCalledOnceWith();
    expect(api.getCurrentUser).toHaveBeenCalledOnceWith();
    expect(service.accessToken()).toBe('restored-token');
    expect(service.currentUser()).toEqual(user);
    expect(service.persistenceMode()).toBe('cloud');
  });

  it('becomes a guest when the refresh cookie is explicitly invalid', async () => {
    localStorage.setItem('guest-data-check', 'keep');
    api.refresh.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

    await service.initialize();

    expect(service.isGuest()).toBeTrue();
    expect(service.accessToken()).toBeNull();
    expect(service.initializationStatus()).toBe('ready');
    expect(localStorage.getItem('guest-data-check')).toBe('keep');
  });

  it('does not log out when startup refresh fails due to the network', async () => {
    localStorage.setItem('guest-data-check', 'keep');
    api.refresh.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

    await service.initialize();

    expect(service.initializationStatus()).toBe('unavailable');
    expect(localStorage.getItem('guest-data-check')).toBe('keep');
  });

  it('establishes a usable in-memory session on login', async () => {
    api.login.and.returnValue(of({ accessToken: 'new-token' }));
    api.getCurrentUser.and.returnValue(of(user));

    await service.login({ email: user.email, password: 'password123' });

    expect(service.accessToken()).toBe('new-token');
    expect(service.currentUser()).toEqual(user);
    expect(localStorage.getItem('gym-tracker:auth:access-token')).toBeNull();
  });

  it('coalesces concurrent refresh attempts', async () => {
    const response = new Subject<AuthResponse>();
    api.refresh.and.returnValue(response);
    service.currentUser.set(user);

    const first = service.refreshAccessToken();
    const second = service.refreshAccessToken();
    response.next({ accessToken: 'rotated-token' });
    response.complete();

    await expectAsync(first).toBeResolvedTo('rotated-token');
    await expectAsync(second).toBeResolvedTo('rotated-token');
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(service.currentUser()).toEqual(user);
  });

  it('preserves an existing session assumption on refresh network failure', async () => {
    service.accessToken.set('expired-token');
    service.currentUser.set(user);
    api.refresh.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    await expectAsync(service.refreshAccessToken()).toBeRejected();

    expect(service.accessToken()).toBe('expired-token');
    expect(service.currentUser()).toEqual(user);
  });

  it('calls backend logout and removes only authentication state', async () => {
    localStorage.setItem('guest-data-check', 'keep');
    service.accessToken.set('token');
    service.currentUser.set(user);
    api.logout.and.returnValue(of(undefined));

    await service.logout();

    expect(api.logout).toHaveBeenCalledOnceWith();
    expect(service.accessToken()).toBeNull();
    expect(service.isGuest()).toBeTrue();
    expect(localStorage.getItem('guest-data-check')).toBe('keep');
  });

  it('leaves guest Dexie data untouched on logout', async () => {
    const db = new Dexie(`auth-session-local-data-${crypto.randomUUID()}`);
    db.version(1).stores({ routines: 'id' });
    try {
      await db.table('routines').put({ id: 'local-routine', name: 'Keep me' });
      api.logout.and.returnValue(of(undefined));

      await service.logout();

      expect(await db.table('routines').get('local-routine')).toEqual({
        id: 'local-routine',
        name: 'Keep me',
      });
    } finally {
      db.close();
      await db.delete();
    }
  });

  it('clears auth but retains local data when backend logout fails', async () => {
    localStorage.setItem('guest-data-check', 'keep');
    service.accessToken.set('token');
    service.currentUser.set(user);
    api.logout.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    await expectAsync(service.logout()).toBeRejected();

    expect(service.accessToken()).toBeNull();
    expect(service.isGuest()).toBeTrue();
    expect(localStorage.getItem('guest-data-check')).toBe('keep');
  });
});
