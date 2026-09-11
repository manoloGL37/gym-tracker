import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { ActiveTrainingRepository, CloudActiveTrainingRepository, SelectedRoutineRepository, WorkoutHistoryRepository } from '../../data/active-training.repository';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { TranslationService } from '../../services/translation.service';
import { WorkoutApiService } from '../../workouts/workout-api.service';
import { TrainingComponent } from './training.component';

describe('TrainingComponent', () => {
  let fixture: ComponentFixture<TrainingComponent>;
  let component: TrainingComponent;

  beforeEach(async () => {
    spyOn(WorkoutHistoryRepository, 'getAll').and.resolveTo([]);
    spyOn(ActiveTrainingRepository, 'get').and.resolveTo(undefined);
    spyOn(CloudActiveTrainingRepository, 'get').and.resolveTo(undefined);
    spyOn(SelectedRoutineRepository, 'get').and.resolveTo(undefined);
    await TestBed.configureTestingModule({
      imports: [TrainingComponent],
      providers: [
        { provide: AuthSessionService, useValue: { isAuthenticated: () => false } },
        { provide: WorkoutApiService, useValue: jasmine.createSpyObj<WorkoutApiService>('WorkoutApiService', ['list', 'get', 'create', 'update', 'createSet']) },
        { provide: ExerciseApiService, useValue: jasmine.createSpyObj<ExerciseApiService>('ExerciseApiService', ['get']) },
        { provide: TranslationService, useValue: { lang: signal<'es' | 'en'>('es'), t: (key: string) => key } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TrainingComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders the actual previous local set even when it also has a suggested target', () => {
    component.previousWorkouts = [{ id: 'history', routineId: 'r', routineName: 'Anterior', startedAt: '2026-01-01T10:00:00Z', finishedAt: '2026-01-01T11:00:00Z', exercises: [{ exerciseId: 'legacy-id', name: 'Press', sets: [{ setIndex: 0, reps: 10, weight: 50 }] }] }];
    component.training = { id: 'active', routineId: 'r', routineName: 'Hoy', startedAt: '2026-01-02T10:00:00Z', exercises: [{ exerciseId: 'legacy-id', name: 'Press', sets: [{ setIndex: 0, reps: null, weight: null }] }] };
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Última: 10 × 50 kg');
    expect(fixture.nativeElement.textContent).toContain('Objetivo: 11 × 50 kg');
  });

  it('maps cloud history by stable exercise UUID, not by the display name', () => {
    component.previousCloudWorkouts = [{ id: 'history', clientId: null, routineId: 'r', startedAt: '2026-01-01T10:00:00', completedAt: '2026-01-01T11:00:00', notes: null, createdAt: '2026-01-01T10:00:00', exercises: [{ id: 'workout-exercise', exerciseId: 'exercise-uuid', position: 0, notes: null, sets: [{ id: 'set', clientId: null, setNumber: 1, reps: 8, weight: 72.5, rpe: null }] }] }];
    expect(component.getCloudLastSetReference('exercise-uuid', 1)).toEqual({ reps: 8, weight: 72.5 });
    expect(component.getCloudLastSetReference('same-name-but-other-uuid', 1)).toBeNull();
  });

  it('derives elapsed time from startedAt and clears its one-second clock on destroy', () => {
    component.training = { id: 'active', routineId: 'r', routineName: 'Hoy', startedAt: '2026-01-01T10:00:00Z', exercises: [] };
    component.now = new Date('2026-01-01T10:01:05Z').getTime();
    expect(component.elapsed()).toBe('01:05');
    const set = spyOn(window, 'setInterval').and.callThrough();
    const clear = spyOn(window, 'clearInterval').and.callThrough();
    component['startClock']();
    expect(set).toHaveBeenCalledWith(jasmine.any(Function), 1_000);
    component.ngOnDestroy();
    expect(clear).toHaveBeenCalled();
  });

  it('counts only complete local sets and persisted cloud sets as workout progress', () => {
    component.training = { id: 'active', routineId: 'r', routineName: 'Hoy', startedAt: '2026-01-01T10:00:00Z', exercises: [{ exerciseId: 'e', name: 'Press', sets: [{ setIndex: 0, reps: 8, weight: 50 }, { setIndex: 1, reps: 8, weight: null }] }] };
    expect(component.completedSetCount()).toBe(1);
    expect(component.totalSetCount()).toBe(2);
    component.training = null;
    component.cloudTraining = { id: 'active', source: 'cloud', workoutId: 'w', workoutClientId: 'c', routineId: 'r', routineName: 'Hoy', startedAt: '2026-01-01T10:00:00', notes: null, exercises: [{ id: 'we', exerciseId: 'e', position: 0, name: 'Press', notes: null, sets: [{ clientId: 'saved', setNumber: 1, reps: 8, weight: 50, rpe: null, persisted: { id: 'set', clientId: 'saved', setNumber: 1, reps: 8, weight: 50, rpe: null } }, { clientId: 'draft', setNumber: 2, reps: 8, weight: 50, rpe: null, persisted: null }] }] };
    expect(component.completedSetCount()).toBe(1);
    expect(component.totalSetCount()).toBe(2);
  });
});
