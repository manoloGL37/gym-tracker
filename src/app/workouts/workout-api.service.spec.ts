import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkoutApiService } from './workout-api.service';
import { CreateWorkoutRequest, WorkoutResponse } from './workout-api.models';

const create: CreateWorkoutRequest = { clientId: 'workout-client-id', routineId: 'routine-uuid', startedAt: '2026-09-10T14:30:00', completedAt: null, notes: null };
const workout: WorkoutResponse = { id: 'workout-uuid', clientId: create.clientId!, routineId: create.routineId, startedAt: create.startedAt!, completedAt: null, notes: null, createdAt: '2026-09-10T14:30:01', exercises: [{ id: 'workout-exercise-uuid', exerciseId: 'exercise-uuid', position: 0, notes: null, sets: [] }] };

describe('WorkoutApiService', () => {
  let service: WorkoutApiService;
  let requests: HttpTestingController;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(WorkoutApiService); requests = TestBed.inject(HttpTestingController); });
  afterEach(() => requests.verify());

  it('uses only the documented create, set and completion routes', () => {
    service.create(create).subscribe(value => expect(value).toEqual(workout));
    let call = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/workouts');
    expect(call.request.method).toBe('POST'); expect(call.request.body).toEqual(create); call.flush(workout);

    const set = { clientId: 'set-client-id', setNumber: 1, weight: 82.5, reps: 8, rpe: 8.5 };
    service.createSet(workout.id, workout.exercises[0].id, set).subscribe();
    call = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/workouts/workout-uuid/exercises/workout-exercise-uuid/sets');
    expect(call.request.method).toBe('POST'); expect(call.request.body).toEqual(set); call.flush({ id: 'set-uuid', ...set });

    service.update(workout.id, { completed: true }).subscribe();
    call = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/workouts/workout-uuid');
    expect(call.request.method).toBe('PATCH'); expect(call.request.body).toEqual({ completed: true }); call.flush({ ...workout, completedAt: '2026-09-10T15:00:00' });
  });
});
