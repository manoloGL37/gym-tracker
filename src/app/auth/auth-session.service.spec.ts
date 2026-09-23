import { HttpErrorResponse } from '@angular/common/http';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import Dexie from 'dexie';
import { Subject, of, throwError } from 'rxjs';
import { AuthApiService } from './auth-api.service';
import { AuthResponse, UserResponse } from './auth.models';
import { AuthSessionService } from './auth-session.service';
import { AccountSyncService } from '../migration/account-sync.service';

const user: UserResponse = {
  id: '0f3f10cc-932d-4b02-bd2b-7ecf8f2305f2',
  email: 'athlete@example.com',
  createdAt: '2026-09-10T14:30:00',
};

describe('AuthSessionService', () => {
  let service: AuthSessionService;
  let api: jasmine.SpyObj<AuthApiService>;
  let accountSync: jasmine.SpyObj<AccountSyncService>;

  beforeEach(() => {
    localStorage.clear();
    api = jasmine.createSpyObj<AuthApiService>('AuthApiService', [
      'register', 'login', 'refresh', 'logout', 'getCurrentUser',
    ]);
    accountSync = jasmine.createSpyObj<AccountSyncService>('AccountSyncService', ['start', 'stop']);
    TestBed.configureTestingModule({
      providers: [
        AuthSessionService,
        { provide: AuthApiService, useValue: api },
        { provide: AccountSyncService, useValue: accountSync },
      ],
    });
    service = TestBed.inject(AuthSessionService);
  });

  it('starts in restoring state before restoration completes', () => {
    const response = new Subject<AuthResponse>();
    api.refresh.and.returnValue(response);

    void service.initialize();

    expect(service.initializationStatus()).toBe('restoring');
    expect(service.isAuthenticated()).toBeFalse();
    expect(service.isGuest()).toBeFalse();
  });

  it('restores a session on app restart through refresh and /me', async () => {
    api.refresh.and.returnValue(of({ accessToken: 'restored-token' }));
    api.getCurrentUser.and.returnValue(of(user));

    await service.initialize();

    expect(api.refresh).toHaveBeenCalledOnceWith();
    expect(api.getCurrentUser).toHaveBeenCalledOnceWith();
    expect(service.accessToken()).toBe('restored-token');
    expect(service.currentUser()).toEqual(user);
    expect(service.initializationStatus()).toBe('authenticated');
    expect(service.persistenceMode()).toBe('cloud');
    expect(accountSync.start).toHaveBeenCalledOnceWith(user.id);
  });

  it('becomes a guest when the refresh cookie is explicitly invalid', async () => {
    localStorage.setItem('guest-data-check', 'keep');
    api.refresh.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

    await service.initialize();

    expect(service.isGuest()).toBeTrue();
    expect(service.accessToken()).toBeNull();
    expect(service.initializationStatus()).toBe('guest');
    expect(localStorage.getItem('guest-data-check')).toBe('keep');
  });

  it('does not log out when startup refresh fails due to the network', async () => {
    localStorage.setItem('guest-data-check', 'keep');
    api.refresh.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

    await service.initialize();

    expect(service.initializationStatus()).toBe('unreachable');
    expect(service.isGuest()).toBeFalse();
    expect(service.restoreAttemptFailed()).toBeTrue();
    expect(localStorage.getItem('guest-data-check')).toBe('keep');
  });

  it('does not log out when startup refresh fails with a server error', async () => {
    api.refresh.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    await service.initialize();

    expect(service.initializationStatus()).toBe('unreachable');
    expect(service.isGuest()).toBeFalse();
    expect(service.restoreAttemptFailed()).toBeTrue();
  });

  it('turns a stalled restoration into a recoverable unreachable state', fakeAsync(() => {
    api.refresh.and.returnValue(new Subject<AuthResponse>());

    void service.initialize();
    tick(15_001);
    flushMicrotasks();

    expect(service.initializationStatus()).toBe('unreachable');
    expect(service.isGuest()).toBeFalse();
    service.ngOnDestroy();
  }));

  it('restores in the background on connectivity recovery and resumes sync', async () => {
    api.refresh.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await service.initialize();
    expect(service.initializationStatus()).toBe('unreachable');

    api.refresh.and.returnValue(of({ accessToken: 'delayed-token' }));
    api.getCurrentUser.and.returnValue(of(user));
    window.dispatchEvent(new Event('online'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(service.initializationStatus()).toBe('authenticated');
    expect(service.accessToken()).toBe('delayed-token');
    expect(accountSync.start).toHaveBeenCalledWith(user.id);
  });

  it('establishes a usable in-memory session on login', async () => {
    api.login.and.returnValue(of({ accessToken: 'new-token' }));
    api.getCurrentUser.and.returnValue(of(user));

    await service.login({ email: user.email, password: 'password123' });

    expect(service.accessToken()).toBe('new-token');
    expect(service.currentUser()).toEqual(user);
    expect(service.initializationStatus()).toBe('authenticated');
    expect(localStorage.getItem('gym-tracker:auth:access-token')).toBeNull();
    expect(localStorage.getItem('gym-tracker:auth:session-expected')).toBe('true');
    expect(accountSync.start).toHaveBeenCalledOnceWith(user.id);
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
    expect(service.initializationStatus()).toBe('unreachable');
  });

  it('calls backend logout and removes only authentication state', async () => {
    localStorage.setItem('guest-data-check', 'keep');
    localStorage.setItem('gym-tracker:auth:session-expected', 'true');
    localStorage.setItem('gym-tracker:auth:cached-user', JSON.stringify(user));
    service.accessToken.set('token');
    service.currentUser.set(user);
    api.logout.and.returnValue(of(undefined));

    await service.logout();

    expect(api.logout).toHaveBeenCalledOnceWith();
    expect(service.accessToken()).toBeNull();
    expect(service.isGuest()).toBeTrue();
    expect(service.initializationStatus()).toBe('guest');
    expect(localStorage.getItem('guest-data-check')).toBe('keep');
    expect(localStorage.getItem('gym-tracker:auth:session-expected')).toBeNull();
    expect(localStorage.getItem('gym-tracker:auth:cached-user')).toBeNull();
    expect(accountSync.stop).toHaveBeenCalled();
  });

  it('does not restore again after explicit logout', async () => {
    service.accessToken.set('token');
    service.currentUser.set(user);
    service.initializationStatus.set('authenticated');
    api.logout.and.returnValue(of(undefined));

    await service.logout();
    api.refresh.calls.reset();
    await service.initialize();

    expect(api.refresh).not.toHaveBeenCalled();
    expect(service.initializationStatus()).toBe('guest');
  });

  it('ignores an in-flight restoration that completes after logout', async () => {
    const refresh = new Subject<AuthResponse>();
    api.refresh.and.returnValue(refresh);
    api.logout.and.returnValue(of(undefined));

    const initialization = service.initialize();
    await service.logout();
    refresh.next({ accessToken: 'stale-token' });
    refresh.complete();
    await initialization;

    expect(service.accessToken()).toBeNull();
    expect(service.initializationStatus()).toBe('guest');
    expect(api.getCurrentUser).not.toHaveBeenCalled();
  });

  it('does not let a stale failed restoration overwrite a successful login', async () => {
    const staleRefresh = new Subject<AuthResponse>();
    api.refresh.and.returnValue(staleRefresh);
    const initialization = service.initialize();

    api.login.and.returnValue(of({ accessToken: 'login-token' }));
    api.getCurrentUser.and.returnValue(of(user));
    await service.login({ email: user.email, password: 'password123' });

    staleRefresh.error(new HttpErrorResponse({ status: 401 }));
    await initialization;

    expect(service.initializationStatus()).toBe('authenticated');
    expect(service.accessToken()).toBe('login-token');
    expect(service.currentUser()).toEqual(user);
  });

  it('uses cached profile metadata only as reconnecting UI continuity after reload', () => {
    service.ngOnDestroy();
    TestBed.resetTestingModule();
    localStorage.setItem('gym-tracker:auth:session-expected', 'true');
    localStorage.setItem('gym-tracker:auth:cached-user', JSON.stringify(user));
    TestBed.configureTestingModule({ providers: [
      AuthSessionService,
      { provide: AuthApiService, useValue: api },
      { provide: AccountSyncService, useValue: accountSync },
    ] });

    const restored = TestBed.inject(AuthSessionService);

    expect(restored.initializationStatus()).toBe('restoring');
    expect(restored.isAuthenticated()).toBeFalse();
    expect(restored.currentUser()).toEqual(user);
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
