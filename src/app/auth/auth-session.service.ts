import { computed, Injectable, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthApiService } from './auth-api.service';
import { AuthTokenStorage } from './auth-token.storage';
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
  private readonly tokenStorage = inject(AuthTokenStorage);
  private initializationPromise: Promise<void> | null = null;

  readonly accessToken = signal<string | null>(this.tokenStorage.get());
  readonly currentUser = signal<UserResponse | null>(null);
  readonly initializationStatus = signal<AuthInitializationStatus>('idle');

  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly isGuest = computed(() => !this.isAuthenticated());
  readonly isInitializing = computed(() => this.initializationStatus() === 'checking');
  readonly hasStoredToken = computed(() => this.accessToken() !== null);
  readonly persistenceMode = computed<PersistenceMode>(() => this.isAuthenticated() ? 'cloud' : 'local');
  // Resource repositories remain Dexie-backed in Phase 1, even for cloud-capable accounts.
  readonly resourcePersistenceMode = signal<ResourcePersistenceMode>('local');

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

  logout(): void {
    // This deliberately affects only auth state. Dexie, backup metadata and guest settings remain untouched.
    this.tokenStorage.clear();
    this.accessToken.set(null);
    this.currentUser.set(null);
    this.initializationStatus.set('ready');
  }

  invalidateSession(): void {
    this.logout();
  }

  private async restoreSession(): Promise<void> {
    if (!this.accessToken()) {
      this.currentUser.set(null);
      this.initializationStatus.set('ready');
      return;
    }

    this.initializationStatus.set('checking');
    try {
      this.currentUser.set(await firstValueFrom(this.api.getCurrentUser()));
      this.initializationStatus.set('ready');
    } catch (error) {
      this.handleSessionLoadError(error);
    }
  }

  private setAccessToken(accessToken: string): void {
    this.tokenStorage.set(accessToken);
    this.accessToken.set(accessToken);
    this.currentUser.set(null);
  }

  private handleSessionLoadError(error: unknown): void {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      this.logout();
      return;
    }

    // A network/5xx failure is not evidence of an invalid token. Preserve it for an explicit retry.
    this.currentUser.set(null);
    this.initializationStatus.set('unavailable');
  }
}
