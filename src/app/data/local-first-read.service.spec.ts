import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { LocalToCloudMigrationService } from '../migration/local-to-cloud-migration.service';
import { RoutineApiService } from '../routines/routine-api.service';
import { WorkoutApiService } from '../workouts/workout-api.service';
import { AccountReadCacheRepository } from './active-training.repository';
import { LocalFirstReadService } from './local-first-read.service';

const localRoutine = { id: 'local-routine', name: 'Fuerza', exercises: [] };
const localWorkout = { id: 'local-workout', routineId: localRoutine.id, routineName: 'Fuerza', startedAt: '2026-09-10T10:00:00', finishedAt: '2026-09-10T11:00:00', exercises: [] };
const cloudRoutine = { id: 'cloud-routine', clientId: 'routine-client', name: 'Fuerza', description: null, createdAt: '2026-09-10T10:00:00', updatedAt: '2026-09-10T10:00:00' };
const cloudWorkout = { id: 'cloud-workout', clientId: 'workout-client', routineId: cloudRoutine.id, startedAt: '2026-09-10T10:00:00', completedAt: '2026-09-10T11:00:00', notes: null, exercises: [], createdAt: '2026-09-10T11:00:00' };
const routinePage = { content: [cloudRoutine], number: 0, totalPages: 1 } as any;
const workoutPage = { content: [cloudWorkout], number: 0, totalPages: 1 } as any;

describe('LocalFirstReadService', () => {
  let service: LocalFirstReadService;
  let migration: jasmine.SpyObj<LocalToCloudMigrationService>;
  let routinesApi: jasmine.SpyObj<RoutineApiService>;
  let workoutsApi: jasmine.SpyObj<WorkoutApiService>;

  beforeEach(() => {
    migration = jasmine.createSpyObj<LocalToCloudMigrationService>('LocalToCloudMigrationService', [
      'getAccountLocalRoutines', 'getAccountLocalWorkouts', 'getRoutineMappings', 'getWorkoutMappings',
    ]);
    migration.getAccountLocalRoutines.and.resolveTo([localRoutine]);
    migration.getAccountLocalWorkouts.and.resolveTo([localWorkout]);
    migration.getRoutineMappings.and.resolveTo({});
    migration.getWorkoutMappings.and.resolveTo({});
    routinesApi = jasmine.createSpyObj<RoutineApiService>('RoutineApiService', ['list', 'get']);
    routinesApi.list.and.returnValue(of(routinePage));
    routinesApi.get.and.returnValue(of({ ...cloudRoutine, exercises: [] } as any));
    workoutsApi = jasmine.createSpyObj<WorkoutApiService>('WorkoutApiService', ['list']);
    workoutsApi.list.and.returnValue(of(workoutPage));
    spyOn(AccountReadCacheRepository, 'getRoutines').and.resolveTo(undefined);
    spyOn(AccountReadCacheRepository, 'getWorkouts').and.resolveTo(undefined);
    spyOn(AccountReadCacheRepository, 'saveRoutines').and.resolveTo('account-a');
    spyOn(AccountReadCacheRepository, 'saveWorkouts').and.resolveTo('account-a');
    TestBed.configureTestingModule({ providers: [
      LocalFirstReadService,
      { provide: LocalToCloudMigrationService, useValue: migration },
      { provide: RoutineApiService, useValue: routinesApi },
      { provide: WorkoutApiService, useValue: workoutsApi },
    ] });
    service = TestBed.inject(LocalFirstReadService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('emits local routines before any remote request completes', async () => {
    const snapshot = await service.routineSnapshot('account-a');
    expect(snapshot.items.map(item => item.routine.id)).toEqual(['local-routine']);
    expect(snapshot.remoteState).toBe('refreshing');
    expect(routinesApi.list).not.toHaveBeenCalled();
  });

  it('does not hide a mapped local routine until its remote representation is readable', async () => {
    migration.getRoutineMappings.and.resolveTo({ 'local-routine': { clientId: 'routine-client', serverId: 'cloud-routine', status: 'migrated' } });
    const snapshot = await service.routineSnapshot('account-a');
    expect(snapshot.items.map(item => item.routine.id)).toEqual(['local-routine']);
  });

  it('deduplicates a mapped routine by server UUID when cached remote data exists', async () => {
    migration.getRoutineMappings.and.resolveTo({ 'local-routine': { clientId: 'routine-client', serverId: 'cloud-routine', status: 'migrated' } });
    (AccountReadCacheRepository.getRoutines as jasmine.Spy).and.resolveTo({ accountId: 'account-a', page: routinePage, updatedAt: '2026-09-10' });
    const snapshot = await service.routineSnapshot('account-a');
    expect(snapshot.items.map(item => item.routine.id)).toEqual(['cloud-routine']);
  });

  it('deduplicates a workout by stable clientId even before its serverId is recorded', async () => {
    migration.getWorkoutMappings.and.resolveTo({ 'local-workout': { clientId: 'workout-client', status: 'pending' } });
    (AccountReadCacheRepository.getWorkouts as jasmine.Spy).and.resolveTo({ accountId: 'account-a', page: workoutPage, routineNames: { 'cloud-routine': 'Fuerza' }, updatedAt: '2026-09-10' });
    const snapshot = await service.workoutSnapshot('account-a');
    expect(snapshot.items.map(item => item.id)).toEqual(['cloud-workout']);
  });

  it('revalidates, persists and emits the confirmed remote view', async () => {
    const refreshed = await service.refreshRoutines('account-a');
    expect(refreshed.remoteState).toBe('confirmed');
    expect(refreshed.items.map(item => item.routine.id)).toEqual(['cloud-routine', 'local-routine']);
    expect(AccountReadCacheRepository.saveRoutines).toHaveBeenCalledWith('account-a', routinePage);
  });

  it('reads cache and local ownership only for the active account', async () => {
    await service.workoutSnapshot('account-b');
    expect(migration.getAccountLocalWorkouts).toHaveBeenCalledOnceWith('account-b');
    expect(AccountReadCacheRepository.getWorkouts).toHaveBeenCalledOnceWith('account-b');
  });
});
