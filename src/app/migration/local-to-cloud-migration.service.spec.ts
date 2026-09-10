import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { db, Routine } from '../data/active-training.repository';
import { ExerciseApiService } from '../exercises/exercise-api.service';
import { RoutineApiService } from '../routines/routine-api.service';
import { WorkoutApiService } from '../workouts/workout-api.service';
import { LocalToCloudMigrationService, routineExerciseKey } from './local-to-cloud-migration.service';

describe('LocalToCloudMigrationService', () => {
  let service: LocalToCloudMigrationService;
  const exerciseApi = jasmine.createSpyObj<ExerciseApiService>('ExerciseApiService', ['list', 'create']);
  const routineApi = jasmine.createSpyObj<RoutineApiService>('RoutineApiService', ['create']);
  const workoutApi = jasmine.createSpyObj<WorkoutApiService>('WorkoutApiService', ['create', 'createSet']);

  beforeEach(async () => {
    await Promise.all([db.routines.clear(), db.workoutHistory.clear(), db.activeTraining.clear(), db.bodyWeight.clear(), db.migrationLedgers.clear()]);
    TestBed.configureTestingModule({ providers: [
      LocalToCloudMigrationService,
      { provide: ExerciseApiService, useValue: exerciseApi },
      { provide: RoutineApiService, useValue: routineApi },
      { provide: WorkoutApiService, useValue: workoutApi },
    ] });
    service = TestBed.inject(LocalToCloudMigrationService);
    exerciseApi.list.calls.reset(); exerciseApi.create.calls.reset(); routineApi.create.calls.reset(); workoutApi.create.calls.reset(); workoutApi.createSet.calls.reset();
  });

  afterEach(async () => { await Promise.all([db.routines.clear(), db.workoutHistory.clear(), db.migrationLedgers.clear()]); });

  it('keeps ledgers and server mappings account-scoped', async () => {
    const first = await service.getLedger('account-a');
    first.routines['local'] = { clientId: 'client-a', serverId: 'server-a', status: 'migrated' };
    await db.migrationLedgers.put(first);

    const second = await service.getLedger('account-b');

    expect(second.routines['local']).toBeUndefined();
    expect(second.accountId).toBe('account-b');
  });

  it('generates one stable routine clientId before asking for exercise resolution', async () => {
    await db.routines.put(localRoutine('routine-1', 'exercise-1'));

    await service.start('account-a');
    const firstId = (await service.getLedger('account-a')).routines['routine-1'].clientId;
    await service.start('account-a');

    expect((await service.getLedger('account-a')).routines['routine-1'].clientId).toBe(firstId);
    expect((await service.getLedger('account-a')).status).toBe('needs-resolution');
  });

  it('does not upload a historical snapshot that differs from its original routine and never deletes it', async () => {
    await db.routines.put(localRoutine('routine-1', 'exercise-1'));
    await db.workoutHistory.put({
      id: 'workout-1', routineId: 'routine-1', routineName: 'Local', startedAt: '2026-01-02T10:00:00.000Z', finishedAt: '2026-01-02T11:00:00.000Z',
      exercises: [{ exerciseId: 'other-exercise', name: 'Other', sets: [{ setIndex: 0, reps: 8, weight: 20 }]}],
    });
    routineApi.create.and.returnValue(of({ id: 'cloud-routine', clientId: 'x', name: 'Local', description: null, exercises: [], createdAt: '', updatedAt: '' }));
    await service.chooseCatalogExercise('account-a', routineExerciseKey('routine-1', 'exercise-1'), { id: 'catalog-1' } as any);

    await service.start('account-a');

    const ledger = await service.getLedger('account-a');
    expect(ledger.workouts['workout-1'].status).toBe('unsupported');
    expect(await db.workoutHistory.get('workout-1')).not.toBeUndefined();
    expect(workoutApi.create).not.toHaveBeenCalled();
  });

  it('reuses a real local exercise identity across routines without using its display name', () => {
    expect(routineExerciseKey('routine-a', 'local-exercise-1')).toBe(routineExerciseKey('routine-b', 'local-exercise-1'));
    expect(routineExerciseKey('routine-a', 'local-exercise-1')).not.toBe(routineExerciseKey('routine-a', 'local-exercise-2'));
  });
});

function localRoutine(id: string, exerciseId: string): Routine {
  return { id, name: 'Local', exercises: [{ id: exerciseId, name: 'Press', setsCount: 3 }] };
}
