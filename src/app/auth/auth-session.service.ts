import { computed, Injectable, Injector, inject, OnDestroy, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { AuthApiService } from './auth-api.service';
import { AccountSyncService } from '../migration/account-sync.service';
import {
  AuthInitializationStatus,
  CreateUserRequest,
  LoginRequest,
  PersistenceMode,
  ResourcePersistenceMode,
  UserResponse,
} from './auth.models';

@Injectable({ providedIn: 'root' })
export class AuthSessionService implements OnDestroy {
  private static readonly restoreRequestTimeoutMs = 15_000;
  private static readonly explicitLogoutKey = 'gym-tracker:auth:explicit-logout';
  private static readonly sessionHintKey = 'gym-tracker:auth:session-expected';
  private static readonly cachedUserKey = 'gym-tracker:auth:cached-user';
  private static readonly guestProbeKey = 'gym-tracker:auth:guest-probe-v2';
  private readonly api = inject(AuthApiService);
  private readonly injector = inject(Injector);
  private get accountSync(): AccountSyncService { return this.injector.get(AccountSyncService); }
  private initializationPromise: Promise<void> | null = null;
  private refreshRequest: { epoch: number; promise: Promise<string> } | null = null;
  private sessionEpoch = 0;
  private restoreRetryAttempt = 0;
  private restoreRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onlineListener = () => void this.retryInitialization();
  private readonly visibilityListener = () => {
    if (globalThis.document?.visibilityState === 'visible') void this.retryInitialization();
  };

  readonly accessToken = signal<string | null>(null);
  readonly currentUser = signal<UserResponse | null>(this.readCachedUser());
  readonly initializationStatus = signal<AuthInitializationStatus>(this.shouldRestore() ? 'restoring' : 'guest');
  readonly restoreAttemptFailed = computed(() => this.initializationStatus() === 'unreachable');

  readonly isAuthenticated = computed(() => this.initializationStatus() === 'authenticated');
  readonly isGuest = computed(() => this.initializationStatus() === 'guest');
  readonly isReconnecting = computed(() => {
    const status = this.initializationStatus();
    return status === 'restoring' || status === 'unreachable';
  });
  readonly isInitializing = this.isReconnecting;
  readonly persistenceMode = computed<PersistenceMode>(() => this.isAuthenticated() ? 'cloud' : 'local');
  // Resource repositories remain Dexie-backed in Phase 1, even for cloud-capable accounts.
  readonly resourcePersistenceMode = signal<ResourcePersistenceMode>('local');

  constructor() {
    // Remove access JWTs left by older frontend versions. The refresh cookie now restores sessions.
    globalThis.localStorage?.removeItem('gym-tracker:auth:access-token');
    globalThis.addEventListener?.('online', this.onlineListener);
    globalThis.document?.addEventListener?.('visibilitychange', this.visibilityListener);
  }

  initialize(): Promise<void> {
    if (!this.shouldRestore()) {
      this.clearAuthState();
      return Promise.resolve();
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    const epoch = this.sessionEpoch;
    this.initializationPromise = this.restoreSession(epoch).finally(() => {
      this.initializationPromise = null;
    });
    return this.initializationPromise;
  }

  async retryInitialization(): Promise<void> {
    if (!this.shouldRestore()) return;
    this.clearRestoreRetry();
    await this.initialize();
  }

  ngOnDestroy(): void {
    this.clearRestoreRetry();
    globalThis.removeEventListener?.('online', this.onlineListener);
    globalThis.document?.removeEventListener?.('visibilitychange', this.visibilityListener);
  }

  async register(request: CreateUserRequest): Promise<UserResponse> {
    return firstValueFrom(this.api.register(request));
  }

  async login(request: LoginRequest): Promise<void> {
    const epoch = ++this.sessionEpoch;
    const response = await firstValueFrom(this.api.login(request));
    if (epoch !== this.sessionEpoch) return;

    this.clearExplicitLogout();
    this.rememberSessionExpected();
    this.currentUser.set(null);
    this.setAccessToken(response.accessToken);
    this.initializationStatus.set('restoring');

    try {
      const user = await firstValueFrom(this.api.getCurrentUser().pipe(timeout(AuthSessionService.restoreRequestTimeoutMs)));
      if (epoch !== this.sessionEpoch) return;
      this.currentUser.set(user);
      this.initializationStatus.set('authenticated');
      this.rememberAuthenticatedUser(user);
      this.resetRestoreRetry();
      this.accountSync.start(user.id);
    } catch (error) {
      if (epoch === this.sessionEpoch) this.handleSessionLoadError(error, true);
      throw error;
    }
  }

  async logout(): Promise<void> {
    ++this.sessionEpoch;
    this.rememberExplicitLogout();
    this.clearRestoreRetry();
    this.forgetSessionExpected();
    this.accountSync.stop();
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      // Auth cleanup deliberately leaves Dexie, migration state, backups and guest settings untouched.
      this.clearAuthState();
    }
  }

  invalidateSession(): void {
    ++this.sessionEpoch;
    this.clearRestoreRetry();
    this.forgetSessionExpected();
    this.clearAuthState();
  }

  refreshAccessToken(): Promise<string> {
    const epoch = this.sessionEpoch;
    if (this.refreshRequest?.epoch === epoch) {
      return this.refreshRequest.promise;
    }

    let promise!: Promise<string>;
    promise = firstValueFrom(this.api.refresh().pipe(timeout(AuthSessionService.restoreRequestTimeoutMs)))
      .then(({ accessToken }) => {
        if (epoch !== this.sessionEpoch) throw new SessionSupersededError();
        this.setAccessToken(accessToken);
        return accessToken;
      })
      .catch((error: unknown) => {
        if (epoch === this.sessionEpoch) {
          if (isUnauthorized(error)) this.invalidateSession();
          else this.markTemporarilyUnreachable();
        }
        throw error;
      })
      .finally(() => {
        if (this.refreshRequest?.promise === promise) this.refreshRequest = null;
      });

    this.refreshRequest = { epoch, promise };
    return promise;
  }

  private async restoreSession(epoch: number): Promise<void> {
    this.initializationStatus.set('restoring');
    try {
      await this.refreshAccessToken();
      if (epoch !== this.sessionEpoch) return;
      const user = await firstValueFrom(this.api.getCurrentUser().pipe(timeout(AuthSessionService.restoreRequestTimeoutMs)));
      if (epoch !== this.sessionEpoch) return;
      this.currentUser.set(user);
      this.initializationStatus.set('authenticated');
      this.rememberAuthenticatedUser(user);
      this.resetRestoreRetry();
      this.accountSync.start(user.id);
    } catch (error) {
      if (epoch === this.sessionEpoch) this.handleSessionLoadError(error, true);
    }
  }

  private setAccessToken(accessToken: string): void {
    this.accessToken.set(accessToken);
  }

  private clearAuthState(): void {
    this.accountSync.stop();
    this.accessToken.set(null);
    this.currentUser.set(null);
    this.initializationStatus.set('guest');
  }

  private handleSessionLoadError(error: unknown, missingUserIsDefinitive = false): void {
    if (isUnauthorized(error) || (missingUserIsDefinitive && isStatus(error, 404))) {
      this.invalidateSession();
      return;
    }

    this.markTemporarilyUnreachable();
  }

  private markTemporarilyUnreachable(): void {
    // A network/5xx failure is not evidence of an invalid session. Retry in the background.
    this.initializationStatus.set('unreachable');
    this.scheduleRestoreRetry();
  }

  private rememberExplicitLogout(): void {
    try {
      globalThis.localStorage?.setItem(AuthSessionService.explicitLogoutKey, 'true');
    } catch {
      // The server still revokes the HttpOnly refresh session when storage is unavailable.
    }
  }

  private clearExplicitLogout(): void {
    try {
      globalThis.localStorage?.removeItem(AuthSessionService.explicitLogoutKey);
    } catch {
      // Login remains valid in memory when browser storage is unavailable.
    }
  }

  private wasExplicitlyLoggedOut(): boolean {
    try {
      return globalThis.localStorage?.getItem(AuthSessionService.explicitLogoutKey) === 'true';
    } catch {
      return false;
    }
  }

  private shouldRestore(): boolean {
    if (this.wasExplicitlyLoggedOut()) return false;
    try {
      return globalThis.localStorage?.getItem(AuthSessionService.sessionHintKey) === 'true'
        || globalThis.localStorage?.getItem(AuthSessionService.guestProbeKey) !== 'complete';
    } catch {
      return true;
    }
  }

  private rememberSessionExpected(): void {
    try {
      globalThis.localStorage?.setItem(AuthSessionService.sessionHintKey, 'true');
      globalThis.localStorage?.removeItem(AuthSessionService.guestProbeKey);
    } catch {
      // The HttpOnly cookie remains authoritative when local metadata is unavailable.
    }
  }

  private rememberAuthenticatedUser(user: UserResponse): void {
    this.rememberSessionExpected();
    try {
      globalThis.localStorage?.setItem(AuthSessionService.cachedUserKey, JSON.stringify(user));
    } catch {
      // Cached display data is optional and never grants authorization.
    }
  }

  private forgetSessionExpected(): void {
    try {
      globalThis.localStorage?.removeItem(AuthSessionService.sessionHintKey);
      globalThis.localStorage?.removeItem(AuthSessionService.cachedUserKey);
      globalThis.localStorage?.setItem(AuthSessionService.guestProbeKey, 'complete');
    } catch {
      // In-memory guest state is still definitive for this application lifetime.
    }
  }

  private readCachedUser(): UserResponse | null {
    try {
      const raw = globalThis.localStorage?.getItem(AuthSessionService.cachedUserKey);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      return isUserResponse(value) ? value : null;
    } catch {
      return null;
    }
  }

  private scheduleRestoreRetry(): void {
    if (this.restoreRetryTimer || !this.shouldRestore()) return;
    this.restoreRetryAttempt++;
    // ponytail: bounded background retry capped at one minute; online/visibility retry sooner.
    const delay = Math.min(60_000, 5_000 * 3 ** Math.min(this.restoreRetryAttempt - 1, 3));
    this.restoreRetryTimer = setTimeout(() => {
      this.restoreRetryTimer = null;
      void this.initialize();
    }, delay);
  }

  private resetRestoreRetry(): void {
    this.restoreRetryAttempt = 0;
    this.clearRestoreRetry();
  }

  private clearRestoreRetry(): void {
    if (this.restoreRetryTimer) clearTimeout(this.restoreRetryTimer);
    this.restoreRetryTimer = null;
  }
}

class SessionSupersededError extends Error {}

function isUnauthorized(error: unknown): boolean {
  return isStatus(error, 401);
}

function isStatus(error: unknown, status: number): boolean {
  return error instanceof HttpErrorResponse && error.status === status;
}

function isUserResponse(value: unknown): value is UserResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UserResponse>;
  return typeof candidate.id === 'string'
    && typeof candidate.email === 'string'
    && typeof candidate.createdAt === 'string';
}
