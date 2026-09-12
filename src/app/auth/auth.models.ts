/** Types for the implemented authentication endpoints only. */
export interface CreateUserRequest {
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
}

export interface UserResponse {
  id: string;
  email: string;
  /** ISO-8601 local date-time supplied by the API; it has no timezone contract. */
  createdAt: string;
}

export interface ValidationErrorResponse {
  status: 400;
  code: 'VALIDATION_ERROR';
  errors: Record<string, string>;
  timestamp: string;
}

export interface ApiErrorResponse {
  status: number;
  code: string;
  message?: string;
  timestamp?: string;
}

export type BackendErrorResponse = ValidationErrorResponse | ApiErrorResponse;

export type PersistenceMode = 'local' | 'cloud';
export type ResourcePersistenceMode = 'local';
export type AuthInitializationStatus = 'checking' | 'authenticated' | 'unauthenticated';
