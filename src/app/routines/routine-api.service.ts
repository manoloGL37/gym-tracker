import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CreateRoutineRequest,
  RoutineId,
  RoutineListParams,
  RoutinePageResponse,
  RoutineResponse,
  UpdateRoutineRequest,
} from './routine-api.models';
import { RETRY_SAFE_REQUEST } from '../services/resilient-http.interceptor';

@Injectable({ providedIn: 'root' })
export class RoutineApiService {
  private readonly http = inject(HttpClient);
  private readonly routinesUrl = `${environment.apiBaseUrl}/api/routines`;

  list(filters: RoutineListParams = {}): Observable<RoutinePageResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<RoutinePageResponse>(this.routinesUrl, { params });
  }

  get(id: RoutineId): Observable<RoutineResponse> {
    return this.http.get<RoutineResponse>(`${this.routinesUrl}/${id}`);
  }

  create(request: CreateRoutineRequest): Observable<RoutineResponse> {
    return this.http.post<RoutineResponse>(this.routinesUrl, request, { context: new HttpContext().set(RETRY_SAFE_REQUEST, true) });
  }

  update(id: RoutineId, request: UpdateRoutineRequest): Observable<RoutineResponse> {
    return this.http.put<RoutineResponse>(`${this.routinesUrl}/${id}`, request);
  }

  delete(id: RoutineId): Observable<void> {
    return this.http.delete<void>(`${this.routinesUrl}/${id}`);
  }
}
