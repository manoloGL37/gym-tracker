import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CreateWorkoutRequest, CreateWorkoutSetRequest, UpdateWorkoutRequest, WorkoutExerciseId, WorkoutId, WorkoutListParams, WorkoutPageResponse, WorkoutResponse, WorkoutSetResponse } from './workout-api.models';

@Injectable({ providedIn: 'root' })
export class WorkoutApiService {
  private readonly http = inject(HttpClient);
  private readonly workoutsUrl = `${environment.apiBaseUrl}/api/workouts`;

  list(filters: WorkoutListParams = {}): Observable<WorkoutPageResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<WorkoutPageResponse>(this.workoutsUrl, { params });
  }

  get(id: WorkoutId): Observable<WorkoutResponse> { return this.http.get<WorkoutResponse>(`${this.workoutsUrl}/${id}`); }
  create(request: CreateWorkoutRequest): Observable<WorkoutResponse> { return this.http.post<WorkoutResponse>(this.workoutsUrl, request); }
  update(id: WorkoutId, request: UpdateWorkoutRequest): Observable<WorkoutResponse> { return this.http.patch<WorkoutResponse>(`${this.workoutsUrl}/${id}`, request); }
  createSet(workoutId: WorkoutId, workoutExerciseId: WorkoutExerciseId, request: CreateWorkoutSetRequest): Observable<WorkoutSetResponse> {
    return this.http.post<WorkoutSetResponse>(`${this.workoutsUrl}/${workoutId}/exercises/${workoutExerciseId}/sets`, request);
  }
}
