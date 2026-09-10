import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CreateExerciseRequest,
  ExerciseListParams,
  ExerciseFilterOptionsResponse,
  ExercisePageResponse,
  ExerciseResponse,
  UpdateExerciseRequest,
} from './exercise-api.models';

@Injectable({ providedIn: 'root' })
export class ExerciseApiService {
  private readonly http = inject(HttpClient);
  private readonly exercisesUrl = `${environment.apiBaseUrl}/api/exercises`;

  list(filters: ExerciseListParams = {}): Observable<ExercisePageResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<ExercisePageResponse>(this.exercisesUrl, { params });
  }

  getFilterOptions(): Observable<ExerciseFilterOptionsResponse> {
    return this.http.get<ExerciseFilterOptionsResponse>(`${this.exercisesUrl}/filter-options`);
  }

  get(id: string): Observable<ExerciseResponse> {
    return this.http.get<ExerciseResponse>(`${this.exercisesUrl}/${id}`);
  }

  create(request: CreateExerciseRequest): Observable<ExerciseResponse> {
    return this.http.post<ExerciseResponse>(this.exercisesUrl, request);
  }

  update(id: string, request: UpdateExerciseRequest): Observable<ExerciseResponse> {
    return this.http.put<ExerciseResponse>(`${this.exercisesUrl}/${id}`, request);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.exercisesUrl}/${id}`);
  }
}
