import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CreateWorkoutRequest, CreateWorkoutSetRequest, UpdateWorkoutRequest, WorkoutExerciseId, WorkoutId, WorkoutListParams, WorkoutPageResponse, WorkoutResponse, WorkoutSetResponse } from './workout-api.models';
import { RETRY_SAFE_REQUEST } from '../services/resilient-http.interceptor';
import { CreateMobileWorkoutRequest } from './workout-api.models';
import { EXPECTED_ACCOUNT_ID } from '../auth/auth-http.context';

@Injectable({ providedIn: 'root' })
export class WorkoutApiService {
  private readonly http = inject(HttpClient);
  private readonly workoutsUrl = `${environment.apiBaseUrl}/api/workouts`;

  list(filters: WorkoutListParams = {}, accountId?: string): Observable<WorkoutPageResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<WorkoutPageResponse>(this.workoutsUrl, { params, context: new HttpContext().set(EXPECTED_ACCOUNT_ID, accountId ?? null) });
  }

  get(id: WorkoutId, accountId?: string): Observable<WorkoutResponse> { return this.http.get<WorkoutResponse>(`${this.workoutsUrl}/${id}`, { context: new HttpContext().set(EXPECTED_ACCOUNT_ID, accountId ?? null) }); }
  createMobile(request: CreateMobileWorkoutRequest, accountId?: string): Observable<WorkoutResponse> {
    return this.http.post<WorkoutResponse>(`${this.workoutsUrl}/mobile`, request, { context: new HttpContext().set(RETRY_SAFE_REQUEST, true).set(EXPECTED_ACCOUNT_ID, accountId ?? null) });
  }
  create(request: CreateWorkoutRequest): Observable<WorkoutResponse> { return this.http.post<WorkoutResponse>(this.workoutsUrl, request, { context: new HttpContext().set(RETRY_SAFE_REQUEST, true) }); }
  update(id: WorkoutId, request: UpdateWorkoutRequest): Observable<WorkoutResponse> { return this.http.patch<WorkoutResponse>(`${this.workoutsUrl}/${id}`, request); }
  createSet(workoutId: WorkoutId, workoutExerciseId: WorkoutExerciseId, request: CreateWorkoutSetRequest): Observable<WorkoutSetResponse> {
    return this.http.post<WorkoutSetResponse>(`${this.workoutsUrl}/${workoutId}/exercises/${workoutExerciseId}/sets`, request, { context: new HttpContext().set(RETRY_SAFE_REQUEST, true) });
  }
}
