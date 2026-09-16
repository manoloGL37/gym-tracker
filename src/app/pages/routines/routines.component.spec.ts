import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { Routine, RoutinesRepository } from '../../data/active-training.repository';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { ExerciseResponse } from '../../exercises/exercise-api.models';
import { RoutineApiService } from '../../routines/routine-api.service';
import { RoutinePageResponse, RoutineResponse } from '../../routines/routine-api.models';
import { TranslationService } from '../../services/translation.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { RoutinesComponent } from './routines.component';
import { LocalFirstReadService } from '../../data/local-first-read.service';

const local: Routine = { id: 'local-id', name: 'Fuerza', exercises: [{ id: 'local-exercise', name: 'Press', setsCount: 3 }] };
const cloud: RoutineResponse = { id: 'cloud-id', clientId: 'stable-client-id', name: 'Movilidad', description: null, exercises: [], createdAt: '2026-01-01T10:00:00', updatedAt: '2026-01-01T10:00:00' };
const page: RoutinePageResponse = { content: [{ id: cloud.id, clientId: cloud.clientId, name: cloud.name, description: cloud.description, createdAt: cloud.createdAt, updatedAt: cloud.updatedAt }], totalElements: 1, totalPages: 1, size: 10, number: 0, sort: { empty: false, sorted: true, unsorted: false }, pageable: { offset: 0, sort: { empty: false, sorted: true, unsorted: false }, pageNumber: 0, pageSize: 10, paged: true, unpaged: false }, first: true, last: true, numberOfElements: 1, empty: false };
const customExercise: ExerciseResponse = { id: 'custom-id', clientId: 'exercise-client-id', source: 'USER', sourceId: null, editable: true, deletable: true, category: null, equipment: null, targetMuscle: null, muscleGroup: null, secondaryMuscles: null, translations: [{ language: 'en', name: 'Press unilateral en máquina', instructions: null }], aliases: [] };

describe('RoutinesComponent local/cloud boundary', () => {
  let fixture: ComponentFixture<RoutinesComponent>;
  let component: RoutinesComponent;
  let authenticated: ReturnType<typeof signal<boolean>>;
  let routineApi: jasmine.SpyObj<RoutineApiService>;
  let exerciseApi: jasmine.SpyObj<ExerciseApiService>;
  let reads: jasmine.SpyObj<LocalFirstReadService>;

  async function create(isAuthenticated: boolean): Promise<void> {
    authenticated = signal(isAuthenticated);
    routineApi = jasmine.createSpyObj<RoutineApiService>('RoutineApiService', ['list', 'get', 'create', 'update', 'delete']);
    routineApi.list.and.returnValue(of(page));
    exerciseApi = jasmine.createSpyObj<ExerciseApiService>('ExerciseApiService', ['list', 'get', 'create']);
    exerciseApi.list.and.returnValue(of({ content: [], page: 0, size: 10, totalElements: 0, totalPages: 0 }));
    exerciseApi.create.and.returnValue(of(customExercise));
    spyOn(RoutinesRepository, 'getAll').and.resolveTo([local]);
    const readItems = [
      { source: 'local' as const, routine: local },
      ...(isAuthenticated ? [{ source: 'cloud' as const, routine: page.content[0] }] : []),
    ];
    reads = jasmine.createSpyObj<LocalFirstReadService>('LocalFirstReadService', ['routineSnapshot', 'refreshRoutines']);
    reads.routineSnapshot.and.resolveTo({ items: readItems, remoteState: isAuthenticated ? 'refreshing' : 'local', pageNumber: 0, totalPages: isAuthenticated ? 1 : 0 });
    reads.refreshRoutines.and.resolveTo({ items: readItems, remoteState: 'confirmed', pageNumber: 0, totalPages: isAuthenticated ? 1 : 0 });
    await TestBed.configureTestingModule({
      imports: [RoutinesComponent],
      providers: [
        { provide: AuthSessionService, useValue: { isAuthenticated: authenticated, currentUser: signal(isAuthenticated ? { id: 'account-a' } : null) } },
        { provide: RoutineApiService, useValue: routineApi },
        { provide: ExerciseApiService, useValue: exerciseApi },
        { provide: AccountSyncService, useValue: { status: signal('synced') } },
        { provide: LocalFirstReadService, useValue: reads },
        { provide: TranslationService, useValue: { lang: signal<'en' | 'es'>('en'), t: (key: string) => key } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RoutinesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('keeps a guest routine entirely in Dexie and never calls cloud CRUD', async () => {
    await create(false);
    const add = spyOn(RoutinesRepository, 'add').and.resolveTo();
    component.localName = 'Nueva local';
    component.localExercises = [{ id: 'exercise', name: 'Nombre libre', setsCount: 3 }];
    await component.saveRoutine();
    expect(add).toHaveBeenCalled();
    expect(routineApi.list).not.toHaveBeenCalled();
    expect(routineApi.create).not.toHaveBeenCalled();
    expect(routineApi.update).not.toHaveBeenCalled();
    expect(routineApi.delete).not.toHaveBeenCalled();
  });

  it('keeps the generated cloud clientId through a failed create retry', async () => {
    await create(true);
    routineApi.create.and.returnValues(
      throwError(() => new HttpErrorResponse({ status: 0 })),
      of(cloud),
    );
    component.cloudDraft.name = 'Cloud';
    const clientId = component.cloudDraft.clientId;
    await component.saveRoutine();
    await component.saveRoutine();
    expect(routineApi.create.calls.count()).toBe(2);
    expect(routineApi.create.calls.argsFor(0)[0].clientId).toBe(clientId);
    expect(routineApi.create.calls.argsFor(1)[0].clientId).toBe(clientId);
  });

  it('shows local and cloud resources together and delegates the selector to ExerciseApiService', async () => {
    await create(true);
    expect(component.routines.map(item => item.source)).toEqual(['local', 'cloud']);
    await component.openSelector();
    expect(exerciseApi.list).toHaveBeenCalledWith({ page: 0, size: 10, search: undefined });
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent as string).toLowerCase();
    expect(text).not.toContain('local');
    expect(text).not.toContain('cloud');
  });

  it('reorders editor exercises without changing their identities', async () => {
    await create(false);
    component.localExercises = [
      { id: 'first', name: 'Sentadilla', setsCount: 3 },
      { id: 'second', name: 'Press', setsCount: 3 },
    ];
    component.moveLocalExercise(0, 1);
    component.moveLocalExercise(0, -1);
    expect(component.localExercises.map(exercise => exercise.id)).toEqual(['second', 'first']);
  });

  it('selects an existing catalog exercise without creating one', async () => {
    await create(true);
    const catalogExercise = { ...customExercise, id: 'catalog-id', source: 'EXERCISES_DATASET' as const };
    component.selectorPage.set({ content: [catalogExercise], page: 0, size: 10, totalElements: 1, totalPages: 1 });
    component.selectCloudExercise(catalogExercise);
    expect(component.cloudDraft.exercises.map(exercise => exercise.exerciseId)).toEqual(['catalog-id']);
    expect(exerciseApi.create).not.toHaveBeenCalled();
  });

  it('offers deliberate inline creation for a missing normalized name and adds the created exercise', async () => {
    await create(true);
    component.cloudDraft.exercises.push({ exerciseId: 'kept-id', exerciseName: 'Sentadilla', exerciseSource: 'EXERCISES_DATASET', sets: 3, targetReps: 10, restSeconds: 90, notes: '' });
    component.selectorSearch = '  Press   unilateral en máquina  ';
    component.selectorPage.set({ content: [], page: 0, size: 10, totalElements: 0, totalPages: 0 });
    expect(component.canCreateSelectorExercise).toBeTrue();
    await component.createSelectorExercise();
    expect(exerciseApi.create.calls.count()).toBe(1);
    expect(exerciseApi.create.calls.argsFor(0)[0].translations[0].name).toBe('Press unilateral en máquina');
    expect(component.cloudDraft.exercises.map(exercise => exercise.exerciseId)).toEqual(['kept-id', 'custom-id']);
    expect(component.selectorOpen).toBeFalse();
  });

  it('does not offer creation when an exact normalized result already exists', async () => {
    await create(true);
    component.selectorSearch = ' press   unilateral EN máquina ';
    component.selectorPage.set({ content: [customExercise], page: 0, size: 10, totalElements: 1, totalPages: 1 });
    expect(component.canCreateSelectorExercise).toBeFalse();
    await component.createSelectorExercise();
    expect(exerciseApi.create).not.toHaveBeenCalled();
  });

  it('keeps the routine draft and search text when inline creation fails so it can be retried', async () => {
    await create(true);
    component.cloudDraft.name = 'Torso';
    component.cloudDraft.exercises.push({ exerciseId: 'kept-id', exerciseName: 'Remo', exerciseSource: 'EXERCISES_DATASET', sets: 3, targetReps: 10, restSeconds: 90, notes: '' });
    component.selectorSearch = 'Press nuevo';
    component.selectorOpen = true;
    exerciseApi.create.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    await component.createSelectorExercise();
    expect(component.selectorOpen).toBeTrue();
    expect(component.selectorSearch).toBe('Press nuevo');
    expect(component.cloudDraft.name).toBe('Torso');
    expect(component.cloudDraft.exercises.map(exercise => exercise.exerciseId)).toEqual(['kept-id']);
    expect(component.selectorError()).toContain('reintentar');
  });

  it('renders known local routines during remote refresh without showing the empty state', async () => {
    await create(true);
    component.routines = [{ source: 'local', routine: local }];
    component.loading = false;
    component.cloudLoading = true;
    component.remoteState = 'refreshing';
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Fuerza');
    expect(text).not.toContain('Crear primera rutina');
    expect(text).toContain('Actualizando');
  });

  it('shows the true empty state only after the remote account confirms empty', async () => {
    await create(true);
    component.routines = [];
    component.loading = false;
    component.cloudLoading = false;
    component.remoteState = 'confirmed';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Crear primera rutina');
  });

  it('retains local routines after a 503 instead of replacing them with an empty state', async () => {
    await create(true);
    reads.refreshRoutines.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    await component.loadRoutines();
    fixture.detectChanges();
    expect(component.routines.some(item => item.routine.id === local.id)).toBeTrue();
    expect(fixture.nativeElement.textContent).not.toContain('Crear primera rutina');
    expect(component.remoteState).toBe('unavailable');
  });
});
