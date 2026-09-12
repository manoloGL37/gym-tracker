import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
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

  it('automatically creates a safe local custom exercise and reuses its mapping in its routine', async () => {
    const exerciseId = crypto.randomUUID();
    await db.routines.put(localRoutine('routine-1', exerciseId, 'Mi press'));
    exerciseApi.create.and.returnValue(of({ id: 'server-exercise' } as any));
    routineApi.create.and.returnValue(of({ id: 'server-routine', clientId: 'routine-client', name: 'Local', description: null, exercises: [], createdAt: '', updatedAt: '' }));

    await service.start('account-a');

    const ledger = await service.getLedger('account-a');
    const mapping = ledger.exercises[routineExerciseKey('routine-1', exerciseId)];
    expect(mapping.status).toBe('migrated');
    expect(exerciseApi.create).toHaveBeenCalledWith(jasmine.objectContaining({ clientId: mapping.clientId, translations: [{ language: 'es', name: 'Mi press', instructions: null }] }));
    expect(routineApi.create).toHaveBeenCalledWith(jasmine.objectContaining({ exercises: [jasmine.objectContaining({ exerciseId: 'server-exercise' })] }));
  });

  it('keeps the custom exercise clientId across a temporary failure and retry', async () => {
    const exerciseId = crypto.randomUUID();
    await db.routines.put(localRoutine('routine-1', exerciseId));
    exerciseApi.create.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    await service.start('account-a');
    const first = (await service.getLedger('account-a')).exercises[routineExerciseKey('routine-1', exerciseId)];
    expect(first.status).toBe('pending');

    exerciseApi.create.and.returnValue(of({ id: 'server-exercise' } as any));
    routineApi.create.and.returnValue(of({ id: 'server-routine', clientId: 'routine-client', name: 'Local', description: null, exercises: [], createdAt: '', updatedAt: '' }));
    await service.start('account-a');
    const second = (await service.getLedger('account-a')).exercises[routineExerciseKey('routine-1', exerciseId)];

    expect(second.clientId).toBe(first.clientId);
    expect(second.status).toBe('migrated');
    expect(exerciseApi.create.calls.allArgs().map(args => args[0].clientId)).toEqual([first.clientId!, first.clientId!]);
  });

  it('leaves only an ambiguous legacy exercise for attention while synchronizing independent custom exercises', async () => {
    const customId = crypto.randomUUID();
    await db.routines.bulkPut([localRoutine('custom-routine', customId), localRoutine('legacy-routine', 'legacy-exercise')]);
    exerciseApi.create.and.returnValue(of({ id: 'server-exercise' } as any));
    routineApi.create.and.returnValue(of({ id: 'server-routine', clientId: 'routine-client', name: 'Local', description: null, exercises: [], createdAt: '', updatedAt: '' }));

    await service.start('account-a');

    expect((await service.unresolvedReferences('account-a'))).toEqual([{ key: routineExerciseKey('legacy-routine', 'legacy-exercise'), name: 'Press' }]);
    expect((await service.getLedger('account-a')).routines['custom-routine'].status).toBe('migrated');
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

  it('syncs independent routines while only the unresolved dependency remains blocked', async () => {
    await db.routines.bulkPut([
      localRoutine('resolved-routine', 'resolved-exercise'),
      localRoutine('pending-routine', 'pending-exercise'),
    ]);
    await service.chooseCatalogExercise('account-a', routineExerciseKey('resolved-routine', 'resolved-exercise'), { id: 'catalog-1' } as any);
    routineApi.create.and.returnValue(of({ id: 'server-routine', clientId: 'stable', name: 'Resolved', description: null, exercises: [], createdAt: '', updatedAt: '' }));

    await service.start('account-a');

    const ledger = await service.getLedger('account-a');
    expect(ledger.routines['resolved-routine'].status).toBe('migrated');
    expect(ledger.routines['pending-routine'].status).toBe('blocked');
    expect(routineApi.create).toHaveBeenCalledTimes(1);
  });

  it('keeps transient failures pending with the same clientId', async () => {
    await db.routines.put(localRoutine('routine-1', 'exercise-1'));
    await service.chooseCatalogExercise('account-a', routineExerciseKey('routine-1', 'exercise-1'), { id: 'catalog-1' } as any);
    routineApi.create.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    await service.start('account-a');
    const first = (await service.getLedger('account-a')).routines['routine-1'];
    await service.start('account-a');
    const second = (await service.getLedger('account-a')).routines['routine-1'];

    expect(first.status).toBe('pending');
    expect(second.clientId).toBe(first.clientId);
  });
});

function localRoutine(id: string, exerciseId: string, exerciseName = 'Press'): Routine {
  return { id, name: 'Local', exercises: [{ id: exerciseId, name: exerciseName, setsCount: 3 }] };
}
