import { computed, Injectable, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthApiService } from './auth-api.service';
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
  private readonly api = inject(AuthApiService);
  private initializationPromise: Promise<void> | null = null;
  private refreshPromise: Promise<string> | null = null;

  readonly accessToken = signal<string | null>(null);
  readonly currentUser = signal<UserResponse | null>(null);
  readonly initializationStatus = signal<AuthInitializationStatus>('idle');

  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly isGuest = computed(() => !this.isAuthenticated());
  readonly isInitializing = computed(() => this.initializationStatus() === 'checking');
  readonly persistenceMode = computed<PersistenceMode>(() => this.isAuthenticated() ? 'cloud' : 'local');
  // Resource repositories remain Dexie-backed in Phase 1, even for cloud-capable accounts.
  readonly resourcePersistenceMode = signal<ResourcePersistenceMode>('local');

  constructor() {
    // Remove access JWTs left by older frontend versions. The refresh cookie now restores sessions.
    globalThis.localStorage?.removeItem('gym-tracker:auth:access-token');
  }

  initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.restoreSession().finally(() => {
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
    const response = await firstValueFrom(this.api.login(request));
    this.currentUser.set(null);
    this.setAccessToken(response.accessToken);
    this.initializationStatus.set('checking');

    try {
      this.currentUser.set(await firstValueFrom(this.api.getCurrentUser()));
      this.initializationStatus.set('ready');
    } catch (error) {
      this.handleSessionLoadError(error);
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      // Auth cleanup deliberately leaves Dexie, migration state, backups and guest settings untouched.
      this.clearAuthState();
    }
  }

  invalidateSession(): void {
    this.clearAuthState();
  }

  refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = firstValueFrom(this.api.refresh())
      .then(({ accessToken }) => {
        this.setAccessToken(accessToken);
        return accessToken;
      })
      .catch((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.clearAuthState();
        }
        throw error;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  private async restoreSession(): Promise<void> {
    this.initializationStatus.set('checking');
    try {
      await this.refreshAccessToken();
      this.currentUser.set(await firstValueFrom(this.api.getCurrentUser()));
      this.initializationStatus.set('ready');
    } catch (error) {
      this.handleSessionLoadError(error);
    }
  }

  private setAccessToken(accessToken: string): void {
    this.accessToken.set(accessToken);
  }

  private clearAuthState(): void {
    this.accessToken.set(null);
    this.currentUser.set(null);
    this.initializationStatus.set('ready');
  }

  private handleSessionLoadError(error: unknown): void {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      this.clearAuthState();
      return;
    }

    // A network/5xx failure is not evidence of an invalid token. Preserve it for an explicit retry.
    this.currentUser.set(null);
    this.initializationStatus.set('unavailable');
  }
}
