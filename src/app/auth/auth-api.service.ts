import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { SKIP_AUTH_INTERCEPTOR } from './auth-http.context';
import { AuthResponse, CreateUserRequest, LoginRequest, UserResponse } from './auth.models';

@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly publicAuthContext = new HttpContext().set(SKIP_AUTH_INTERCEPTOR, true);

  register(request: CreateUserRequest): Observable<UserResponse> {
    return this.http.post<UserResponse>(`${this.apiBaseUrl}/api/users`, request, {
      context: this.publicAuthContext,
    });
  }

  login(request: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiBaseUrl}/api/auth/login`, request, {
      context: this.publicAuthContext,
      withCredentials: true,
    });
  }

  refresh(): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiBaseUrl}/api/auth/refresh`, null, {
      context: this.publicAuthContext,
      withCredentials: true,
    });
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.apiBaseUrl}/api/auth/logout`, null, {
      context: this.publicAuthContext,
      withCredentials: true,
    });
  }

  getCurrentUser(): Observable<UserResponse> {
    return this.http.get<UserResponse>(`${this.apiBaseUrl}/api/users/me`);
  }
}
