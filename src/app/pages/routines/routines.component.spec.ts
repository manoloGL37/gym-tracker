import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { Routine, RoutinesRepository } from '../../data/active-training.repository';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { RoutineApiService } from '../../routines/routine-api.service';
import { RoutinePageResponse, RoutineResponse } from '../../routines/routine-api.models';
import { TranslationService } from '../../services/translation.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { RoutinesComponent } from './routines.component';

const local: Routine = { id: 'local-id', name: 'Fuerza', exercises: [{ id: 'local-exercise', name: 'Press', setsCount: 3 }] };
const cloud: RoutineResponse = { id: 'cloud-id', clientId: 'stable-client-id', name: 'Movilidad', description: null, exercises: [], createdAt: '2026-01-01T10:00:00', updatedAt: '2026-01-01T10:00:00' };
const page: RoutinePageResponse = { content: [{ id: cloud.id, clientId: cloud.clientId, name: cloud.name, description: cloud.description, createdAt: cloud.createdAt, updatedAt: cloud.updatedAt }], totalElements: 1, totalPages: 1, size: 10, number: 0, sort: { empty: false, sorted: true, unsorted: false }, pageable: { offset: 0, sort: { empty: false, sorted: true, unsorted: false }, pageNumber: 0, pageSize: 10, paged: true, unpaged: false }, first: true, last: true, numberOfElements: 1, empty: false };

describe('RoutinesComponent local/cloud boundary', () => {
  let fixture: ComponentFixture<RoutinesComponent>;
  let component: RoutinesComponent;
  let authenticated: ReturnType<typeof signal<boolean>>;
  let routineApi: jasmine.SpyObj<RoutineApiService>;
  let exerciseApi: jasmine.SpyObj<ExerciseApiService>;

  async function create(isAuthenticated: boolean): Promise<void> {
    authenticated = signal(isAuthenticated);
    routineApi = jasmine.createSpyObj<RoutineApiService>('RoutineApiService', ['list', 'get', 'create', 'update', 'delete']);
    routineApi.list.and.returnValue(of(page));
    exerciseApi = jasmine.createSpyObj<ExerciseApiService>('ExerciseApiService', ['list', 'get']);
    exerciseApi.list.and.returnValue(of({ content: [], page: 0, size: 10, totalElements: 0, totalPages: 0 }));
    spyOn(RoutinesRepository, 'getAll').and.resolveTo([local]);
    await TestBed.configureTestingModule({
      imports: [RoutinesComponent],
      providers: [
        { provide: AuthSessionService, useValue: { isAuthenticated: authenticated } },
        { provide: RoutineApiService, useValue: routineApi },
        { provide: ExerciseApiService, useValue: exerciseApi },
        { provide: AccountSyncService, useValue: { status: signal('synced') } },
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
});
