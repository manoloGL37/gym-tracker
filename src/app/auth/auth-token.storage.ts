import { Injectable } from '@angular/core';

export const AUTH_TOKEN_STORAGE_KEY = 'gym-tracker:auth:access-token';

@Injectable({ providedIn: 'root' })
export class AuthTokenStorage {
  // Tokens in localStorage survive refreshes, but are readable by same-origin JS (XSS risk).
  // ponytail: the API has no refresh token/cookie flow; revisit this when the backend supports one.
  get(): string | null {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  }

  set(accessToken: string): void {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, accessToken);
  }

  clear(): void {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
}
