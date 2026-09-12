import { computed, Injectable, Injector, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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
export class AuthSessionService {
  private static readonly explicitLogoutKey = 'gym-tracker:auth:explicit-logout';
  private readonly api = inject(AuthApiService);
  private readonly injector = inject(Injector);
  private get accountSync(): AccountSyncService { return this.injector.get(AccountSyncService); }
  private initializationPromise: Promise<void> | null = null;
  private refreshRequest: { epoch: number; promise: Promise<string> } | null = null;
  private sessionEpoch = 0;

  readonly accessToken = signal<string | null>(null);
  readonly currentUser = signal<UserResponse | null>(null);
  readonly initializationStatus = signal<AuthInitializationStatus>('checking');
  readonly restoreAttemptFailed = signal(false);

  readonly isAuthenticated = computed(() => this.initializationStatus() === 'authenticated');
  readonly isGuest = computed(() => this.initializationStatus() === 'unauthenticated');
  readonly isInitializing = computed(() => this.initializationStatus() === 'checking');
  readonly persistenceMode = computed<PersistenceMode>(() => this.isAuthenticated() ? 'cloud' : 'local');
  // Resource repositories remain Dexie-backed in Phase 1, even for cloud-capable accounts.
  readonly resourcePersistenceMode = signal<ResourcePersistenceMode>('local');

  constructor() {
    // Remove access JWTs left by older frontend versions. The refresh cookie now restores sessions.
    globalThis.localStorage?.removeItem('gym-tracker:auth:access-token');
  }

  initialize(): Promise<void> {
    if (this.wasExplicitlyLoggedOut()) {
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
    await this.initialize();
  }

  async register(request: CreateUserRequest): Promise<UserResponse> {
    return firstValueFrom(this.api.register(request));
  }

  async login(request: LoginRequest): Promise<void> {
    const epoch = ++this.sessionEpoch;
    const response = await firstValueFrom(this.api.login(request));
    if (epoch !== this.sessionEpoch) return;

    this.clearExplicitLogout();
    this.currentUser.set(null);
    this.setAccessToken(response.accessToken);
    this.initializationStatus.set('checking');
    this.restoreAttemptFailed.set(false);

    try {
      const user = await firstValueFrom(this.api.getCurrentUser());
      if (epoch !== this.sessionEpoch) return;
      this.currentUser.set(user);
      this.initializationStatus.set('authenticated');
      this.accountSync.start(user.id);
    } catch (error) {
      if (epoch === this.sessionEpoch) this.handleSessionLoadError(error, true);
      throw error;
    }
  }

  async logout(): Promise<void> {
    ++this.sessionEpoch;
    this.rememberExplicitLogout();
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
    this.clearAuthState();
  }

  refreshAccessToken(): Promise<string> {
    const epoch = this.sessionEpoch;
    if (this.refreshRequest?.epoch === epoch) {
      return this.refreshRequest.promise;
    }

    let promise!: Promise<string>;
    promise = firstValueFrom(this.api.refresh())
      .then(({ accessToken }) => {
        if (epoch !== this.sessionEpoch) throw new SessionSupersededError();
        this.setAccessToken(accessToken);
        return accessToken;
      })
      .catch((error: unknown) => {
        if (epoch === this.sessionEpoch && isUnauthorized(error)) {
          this.invalidateSession();
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
    this.initializationStatus.set('checking');
    this.restoreAttemptFailed.set(false);
    try {
      await this.refreshAccessToken();
      if (epoch !== this.sessionEpoch) return;
      const user = await firstValueFrom(this.api.getCurrentUser());
      if (epoch !== this.sessionEpoch) return;
      this.currentUser.set(user);
      this.initializationStatus.set('authenticated');
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
    this.restoreAttemptFailed.set(false);
    this.initializationStatus.set('unauthenticated');
  }

  private handleSessionLoadError(error: unknown, missingUserIsDefinitive = false): void {
    if (isUnauthorized(error) || (missingUserIsDefinitive && isStatus(error, 404))) {
      this.invalidateSession();
      return;
    }

    // A network/5xx failure is not evidence of an invalid session. Stay in checking until retry.
    this.restoreAttemptFailed.set(true);
    this.initializationStatus.set('checking');
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
}

class SessionSupersededError extends Error {}

function isUnauthorized(error: unknown): boolean {
  return isStatus(error, 401);
}

function isStatus(error: unknown, status: number): boolean {
  return error instanceof HttpErrorResponse && error.status === status;
}
