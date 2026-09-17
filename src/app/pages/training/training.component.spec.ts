import { ComponentFixture, fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { ActiveTrainingRepository, CloudActiveTrainingRepository, SelectedRoutineRepository, WorkoutHistoryRepository } from '../../data/active-training.repository';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { RoutineApiService } from '../../routines/routine-api.service';
import { TranslationService } from '../../services/translation.service';
import { WorkoutApiService } from '../../workouts/workout-api.service';
import { CloudActiveTraining } from '../../workouts/workout-domain';
import { WorkoutResponse } from '../../workouts/workout-api.models';
import { TrainingComponent } from './training.component';

describe('TrainingComponent', () => {
  let fixture: ComponentFixture<TrainingComponent>;
  let component: TrainingComponent;
  let workoutApi: jasmine.SpyObj<WorkoutApiService>;
  let router: jasmine.SpyObj<Router>;
  let selectedGet: jasmine.Spy;
  let activeGet: jasmine.Spy;
  let selectedClear: jasmine.Spy;
  let activeClear: jasmine.Spy;
  let cloudClear: jasmine.Spy;

  beforeEach(async () => {
    workoutApi = jasmine.createSpyObj<WorkoutApiService>('WorkoutApiService', ['list', 'get', 'create', 'update', 'createSet']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    spyOn(WorkoutHistoryRepository, 'getAll').and.resolveTo([]);
    spyOn(WorkoutHistoryRepository, 'add').and.resolveTo();
    activeGet = spyOn(ActiveTrainingRepository, 'get').and.resolveTo(undefined);
    activeClear = spyOn(ActiveTrainingRepository, 'clear').and.resolveTo();
    spyOn(ActiveTrainingRepository, 'save').and.resolveTo();
    spyOn(CloudActiveTrainingRepository, 'get').and.resolveTo(undefined);
    cloudClear = spyOn(CloudActiveTrainingRepository, 'clear').and.resolveTo();
    spyOn(CloudActiveTrainingRepository, 'save').and.resolveTo();
    selectedGet = spyOn(SelectedRoutineRepository, 'get').and.resolveTo(undefined);
    selectedClear = spyOn(SelectedRoutineRepository, 'clear').and.resolveTo();
    spyOn(SelectedRoutineRepository, 'setCloud').and.resolveTo();
    await TestBed.configureTestingModule({
      imports: [TrainingComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: AuthSessionService, useValue: { isAuthenticated: () => false } },
        { provide: WorkoutApiService, useValue: workoutApi },
        { provide: RoutineApiService, useValue: jasmine.createSpyObj<RoutineApiService>('RoutineApiService', ['get']) },
        { provide: ExerciseApiService, useValue: jasmine.createSpyObj<ExerciseApiService>('ExerciseApiService', ['get']) },
        { provide: TranslationService, useValue: { lang: signal<'es' | 'en'>('es'), t: (key: string) => key } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TrainingComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows real previous values and no generated objective', () => {
    component.setLocalBenchmarkHistory([localHistory('latest', '2026-01-01T11:00:00Z', 'exercise-id', 'Press', [
      { setIndex: 0, reps: 10, weight: 50 },
    ])]);
    component.training = localTraining('exercise-id', 'Press', [{ setIndex: 0, reps: null, weight: null }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Anterior: 10 reps · 50 kg');
    expect(fixture.nativeElement.textContent).not.toContain('Objetivo');
  });

  it('uses the local exercise id and only the most recent session containing it', () => {
    component.setLocalBenchmarkHistory([
      localHistory('old', '2026-01-01T11:00:00Z', 'exercise-id', 'Press antiguo', [
        { setIndex: 0, reps: 8, weight: 45 }, { setIndex: 1, reps: 8, weight: 45 },
      ]),
      localHistory('latest', '2026-01-03T11:00:00Z', 'exercise-id', 'Press renombrado', [
        { setIndex: 0, reps: 10, weight: 50 },
      ]),
      localHistory('same-name', '2026-01-04T11:00:00Z', 'other-id', 'Press renombrado', [
        { setIndex: 0, reps: 20, weight: 100 },
      ]),
    ]);

    expect(component.getLastSetReference('exercise-id', 0)).toEqual({ reps: 10, weight: 50 });
    expect(component.getLastSetReference('exercise-id', 1)).toBeNull();
  });

  it('maps account history by UUID and set number within the latest matching session', () => {
    component.setCloudBenchmarkHistory([
      cloudWorkout('old', '2026-01-01T11:00:00', 'exercise-uuid', [cloudSet(1, 8, 70), cloudSet(2, 8, 70)]),
      cloudWorkout('latest', '2026-01-03T11:00:00', 'exercise-uuid', [cloudSet(1, 9, 72.5)]),
      cloudWorkout('same-name-is-irrelevant', '2026-01-04T11:00:00', 'other-uuid', [cloudSet(1, 20, 100)]),
    ]);

    expect(component.getCloudLastSetReference('exercise-uuid', 1)).toEqual({ reps: 9, weight: 72.5 });
    expect(component.getCloudLastSetReference('exercise-uuid', 2)).toBeNull();
    expect(component.getCloudLastSetReference('missing-uuid', 1)).toBeNull();
  });

  it('shows a subtle empty benchmark when the corresponding set has no history', () => {
    component.setLocalBenchmarkHistory([]);
    component.training = localTraining('exercise-id', 'Press', [{ setIndex: 0, reps: null, weight: null }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin registro anterior');
  });

  it('keeps the compact session status in a sticky header', () => {
    component.training = localTraining('exercise-id', 'Press', []);
    component.now = new Date(component.training.startedAt).getTime();
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('.session-commandbar') as HTMLElement;
    expect(header).not.toBeNull();
    expect(getComputedStyle(header).position).toBe('sticky');
    expect(header.textContent).toContain('Sesión en curso');
    expect(header.textContent).toContain('00:00');
  });

  it('derives elapsed time from startedAt and clears its one-second clock on destroy', () => {
    component.training = localTraining('exercise-id', 'Press', []);
    component.training.startedAt = '2026-01-01T10:00:00Z';
    component.now = new Date('2026-01-01T10:01:05Z').getTime();
    expect(component.elapsed()).toBe('01:05');
    const set = spyOn(window, 'setInterval').and.callThrough();
    const clear = spyOn(window, 'clearInterval').and.callThrough();
    component['startClock']();
    expect(set).toHaveBeenCalledWith(jasmine.any(Function), 1_000);
    component.ngOnDestroy();
    expect(clear).toHaveBeenCalled();
  });

  it('restores an active local workout immediately without backend access', async () => {
    const active = localTraining('exercise-id', 'Press', [{ setIndex: 0, reps: 8, weight: 50 }]);
    activeGet.and.resolveTo(active);

    await component.ngOnInit();

    expect(component.training).toEqual(active);
    expect(component.loading).toBeFalse();
    expect(workoutApi.create).not.toHaveBeenCalled();
    component.now = new Date(active.startedAt).getTime() + 65_000;
    expect(component.elapsed()).toBe('01:05');
  });

  it('counts valid local sets and only server-confirmed account sets', () => {
    component.training = localTraining('e', 'Press', [
      { setIndex: 0, reps: 8, weight: 50 },
      { setIndex: 1, reps: 8, weight: null },
      { setIndex: 2, reps: 0, weight: 50 },
    ]);
    expect(component.completedSetCount()).toBe(1);
    expect(component.totalSetCount()).toBe(3);
    expect(component.progressPercentage()).toBe(33);

    component.training = null;
    component.cloudTraining = cloudTraining([
      { clientId: 'saved', setNumber: 1, reps: 8, weight: 50, rpe: null, persisted: cloudSet(1, 8, 50) },
      { clientId: 'draft', setNumber: 2, reps: 8, weight: 50, rpe: null, persisted: null },
    ]);
    expect(component.completedSetCount()).toBe(1);
    expect(component.totalSetCount()).toBe(2);
    expect(component.progressPercentage()).toBe(50);
  });

  it('does not count a set when the server save fails', async () => {
    component.cloudTraining = cloudTraining([
      { clientId: 'retryable', setNumber: 1, reps: 8, weight: 50, rpe: null, persisted: null },
    ]);
    workoutApi.createSet.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

    await component.saveCloudSet(component.cloudTraining.exercises[0], 0);

    expect(component.completedSetCount()).toBe(0);
    expect(component.cloudTraining.exercises[0].sets[0].clientId).toBe('retryable');
    expect(component.cloudTraining.exercises[0].sets[0].syncState).toBe('pending');
    expect(CloudActiveTrainingRepository.save).toHaveBeenCalledWith(component.cloudTraining);
  });

  it('autosaves a complete set after 600ms without requesting on every keystroke', fakeAsync(() => {
    component.cloudTraining = cloudTraining([{ clientId: 'stable', setNumber: 1, reps: null, weight: null, rpe: null, persisted: null }]);
    const exercise = component.cloudTraining.exercises[0];
    workoutApi.createSet.and.returnValue(of(cloudSet(1, 8, 50)));

    exercise.sets[0].weight = 5;
    component.onCloudSetChange(exercise, 0);
    tick(250);
    exercise.sets[0].weight = 50;
    component.onCloudSetChange(exercise, 0);
    exercise.sets[0].reps = 8;
    component.onCloudSetChange(exercise, 0);
    tick(599);
    expect(workoutApi.createSet).not.toHaveBeenCalled();

    tick(1);
    flushMicrotasks();
    expect(workoutApi.createSet).toHaveBeenCalledOnceWith('w', 'we', jasmine.objectContaining({ clientId: 'stable', weight: 50, reps: 8 }));
    expect(exercise.sets[0].syncState).toBe('saved');
  }));

  it('keeps an incomplete draft local and does not autosave it', fakeAsync(() => {
    component.cloudTraining = cloudTraining([{ clientId: 'draft', setNumber: 1, reps: null, weight: 50, rpe: null, persisted: null }]);
    const exercise = component.cloudTraining.exercises[0];

    component.onCloudSetChange(exercise, 0);
    tick(1_000);
    flushMicrotasks();

    expect(CloudActiveTrainingRepository.save).toHaveBeenCalledWith(component.cloudTraining);
    expect(workoutApi.createSet).not.toHaveBeenCalled();
  }));

  it('uses only the latest rapid edit and creates the set once', fakeAsync(() => {
    component.cloudTraining = cloudTraining([{ clientId: 'one-client-id', setNumber: 1, reps: 8, weight: 40, rpe: null, persisted: null }]);
    const exercise = component.cloudTraining.exercises[0];
    workoutApi.createSet.and.callFake((_workoutId, _exerciseId, request) => of({ id: 'server-set', clientId: request.clientId ?? null, setNumber: request.setNumber, weight: request.weight, reps: request.reps, rpe: request.rpe ?? null }));

    component.onCloudSetChange(exercise, 0);
    tick(300);
    exercise.sets[0].weight = 42.5;
    component.onCloudSetChange(exercise, 0);
    tick(300);
    exercise.sets[0].reps = 9;
    component.onCloudSetChange(exercise, 0);
    tick(600);
    flushMicrotasks();

    expect(workoutApi.createSet).toHaveBeenCalledTimes(1);
    expect(workoutApi.createSet.calls.mostRecent().args[2]).toEqual(jasmine.objectContaining({ clientId: 'one-client-id', weight: 42.5, reps: 9 }));
    expect(exercise.sets[0].weight).toBe(42.5);
    expect(exercise.sets[0].reps).toBe(9);
  }));

  it('does not let a stale debounce start a second request or overwrite the latest edit', fakeAsync(() => {
    component.cloudTraining = cloudTraining([{ clientId: 'race-safe', setNumber: 1, reps: 8, weight: 50, rpe: null, persisted: null }]);
    const exercise = component.cloudTraining.exercises[0];
    const response = new Subject<ReturnType<typeof cloudSet>>();
    workoutApi.createSet.and.returnValue(response);

    component.onCloudSetChange(exercise, 0);
    tick(400);
    exercise.sets[0].weight = 55;
    component.onCloudSetChange(exercise, 0);
    tick(600);
    flushMicrotasks();

    expect(workoutApi.createSet).toHaveBeenCalledTimes(1);
    expect(workoutApi.createSet.calls.mostRecent().args[2].weight).toBe(55);
    response.next({ ...cloudSet(1, 8, 55), clientId: 'race-safe' });
    response.complete();
    flushMicrotasks();
    expect(exercise.sets[0].weight).toBe(55);
  }));

  it('retries a pending create with the same client identity and cannot duplicate it', async () => {
    component.cloudTraining = cloudTraining([{ clientId: 'idempotent', setNumber: 1, reps: 8, weight: 50, rpe: null, persisted: null }]);
    const exercise = component.cloudTraining.exercises[0];
    workoutApi.createSet.and.returnValues(
      throwError(() => new HttpErrorResponse({ status: 0 })),
      of({ ...cloudSet(1, 8, 50), clientId: 'idempotent' }),
    );

    await component.saveCloudSet(exercise, 0);
    await component.saveCloudSet(exercise, 0);
    await component.saveCloudSet(exercise, 0);

    expect(workoutApi.createSet).toHaveBeenCalledTimes(2);
    expect(workoutApi.createSet.calls.allArgs().map(args => args[2].clientId)).toEqual(['idempotent', 'idempotent']);
    expect(exercise.sets[0].persisted?.id).toBe('set-1');
  });

  it('shows pending sync feedback and removes the normal per-set Save button', () => {
    component.cloudTraining = cloudTraining([{ clientId: 'pending', setNumber: 1, reps: 8, weight: 50, rpe: null, persisted: null, syncState: 'pending' }]);
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('.cloud-set') as HTMLElement;
    expect(row.textContent).toContain('Pendiente de sincronizar');
    expect(Array.from(row.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Guardar')).toBeFalse();
  });

  it('keeps confirmed sets immutable because the backend has no set update endpoint', async () => {
    component.cloudTraining = cloudTraining([{ clientId: 'saved', setNumber: 1, reps: 8, weight: 50, rpe: null, persisted: cloudSet(1, 8, 50), syncState: 'saved' }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const inputs = fixture.nativeElement.querySelectorAll('.cloud-set input') as NodeListOf<HTMLInputElement>;
    expect(Array.from(inputs).every(input => input.disabled)).toBeTrue();
    expect(fixture.nativeElement.querySelector('.cloud-set')?.textContent).toContain('Guardado');
  });

  it('cancels a local workout without creating history or touching unrelated data', async () => {
    component.training = localTraining('exercise-id', 'Press', [{ setIndex: 0, reps: 8, weight: 50 }]);

    await component.confirmCancellation();

    expect(activeClear).toHaveBeenCalled();
    expect(selectedClear).toHaveBeenCalled();
    expect(WorkoutHistoryRepository.add).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/home']);
  });

  it('preserves an account workout because the backend has no cancellation endpoint', async () => {
    component.cloudTraining = cloudTraining([]);

    await component.confirmCancellation();

    expect(cloudClear).not.toHaveBeenCalled();
    expect(workoutApi.update).not.toHaveBeenCalled();
    expect(component.cloudTraining).not.toBeNull();
    expect(component.cloudError).toContain('no permite cancelar');
  });

  it('preserves the original clientId and startedAt after a failed account-workout start', async () => {
    selectedGet.and.resolveTo({ id: 'selected', source: 'cloud', routineId: 'routine', routineName: 'Día A', workoutClientId: 'stable-client-id', startedAt: '2026-09-11T08:15:00' });
    workoutApi.create.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

    await component.ngOnInit();
    await component.retryCloudStart();

    expect(workoutApi.create).toHaveBeenCalledTimes(2);
    expect(workoutApi.create.calls.allArgs().map(args => args[0].clientId)).toEqual(['stable-client-id', 'stable-client-id']);
    expect(workoutApi.create.calls.allArgs().map(args => args[0].startedAt)).toEqual(['2026-09-11T08:15:00', '2026-09-11T08:15:00']);
    expect(selectedClear).not.toHaveBeenCalled();
  });
});

function localTraining(exerciseId: string, name: string, sets: Array<{ setIndex: number; reps: number | null; weight: number | null }>) {
  return { id: 'active', routineId: 'r', routineName: 'Hoy', startedAt: '2026-01-02T10:00:00Z', exercises: [{ exerciseId, name, sets }] };
}

function localHistory(id: string, finishedAt: string, exerciseId: string, name: string, sets: Array<{ setIndex: number; reps: number | null; weight: number | null }>) {
  return { id, routineId: 'r', routineName: 'Anterior', startedAt: '2026-01-01T10:00:00Z', finishedAt, exercises: [{ exerciseId, name, sets }] };
}

function cloudSet(setNumber: number, reps: number, weight: number) {
  return { id: `set-${setNumber}`, clientId: `client-${setNumber}`, setNumber, reps, weight, rpe: null };
}

function cloudWorkout(id: string, completedAt: string, exerciseId: string, sets: ReturnType<typeof cloudSet>[]): WorkoutResponse {
  return { id, clientId: null, routineId: 'r', startedAt: completedAt, completedAt, notes: null, createdAt: completedAt, exercises: [{ id: `workout-exercise-${id}`, exerciseId, position: 0, notes: null, sets }] };
}

function cloudTraining(sets: CloudActiveTraining['exercises'][number]['sets']): CloudActiveTraining {
  return { id: 'active', source: 'cloud', workoutId: 'w', workoutClientId: 'c', routineId: 'r', routineName: 'Hoy', startedAt: '2026-01-01T10:00:00', notes: null, exercises: [{ id: 'we', exerciseId: 'e', position: 0, name: 'Press', notes: null, sets }] };
}
