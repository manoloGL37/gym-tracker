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
    expect(await service.getProgress('account-a')).toEqual(jasmine.objectContaining({ pending: 0, attention: 2 }));
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

  it('marks multiple completed workouts pending automatically when their safe dependency is temporarily unavailable', async () => {
    const exerciseId = crypto.randomUUID();
    await db.routines.put(localRoutine('routine-1', exerciseId));
    await db.workoutHistory.bulkPut([localWorkout('workout-a', 'routine-1', exerciseId), localWorkout('workout-b', 'routine-1', exerciseId), localWorkout('workout-c', 'routine-1', exerciseId)]);
    exerciseApi.create.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    await service.start('account-a');

    const ledger = await service.getLedger('account-a');
    expect(Object.values(ledger.workouts).map(mapping => mapping.status)).toEqual(['pending', 'pending', 'pending']);
    expect((await service.getProgress('account-a')).pendingWorkouts).toBe(3);
  });

  it('migrates a safe workout and its sets once, then suppresses its local copy', async () => {
    const exerciseId = crypto.randomUUID();
    await db.routines.put(localRoutine('routine-1', exerciseId));
    await db.workoutHistory.put(localWorkout('workout-1', 'routine-1', exerciseId));
    exerciseApi.create.and.returnValue(of({ id: 'server-exercise' } as any));
    routineApi.create.and.returnValue(of({ id: 'server-routine' } as any));
    workoutApi.create.and.returnValue(of(serverWorkout('server-workout')));
    workoutApi.createSet.and.returnValue(of({ id: 'server-set' } as any));

    await service.start('account-a');
    await service.start('account-a');

    const ledger = await service.getLedger('account-a');
    expect(ledger.workouts['workout-1']).toEqual(jasmine.objectContaining({ serverId: 'server-workout', status: 'migrated' }));
    expect(workoutApi.create).toHaveBeenCalledTimes(1);
    expect(workoutApi.createSet).toHaveBeenCalledTimes(1);
    expect(await service.getPendingLocalWorkouts('account-a')).toEqual([]);
    expect(await db.workoutHistory.get('workout-1')).toBeDefined();
  });

  it('reuses workout and set operation identities after ambiguous transient failures', async () => {
    const exerciseId = crypto.randomUUID();
    await db.routines.put(localRoutine('routine-1', exerciseId));
    await db.workoutHistory.put(localWorkout('workout-1', 'routine-1', exerciseId));
    exerciseApi.create.and.returnValue(of({ id: 'server-exercise' } as any));
    routineApi.create.and.returnValue(of({ id: 'server-routine' } as any));
    workoutApi.create.and.returnValues(
      throwError(() => new HttpErrorResponse({ status: 503 })),
      of(serverWorkout('server-workout')),
      of(serverWorkout('server-workout')),
    );
    workoutApi.createSet.and.returnValues(
      throwError(() => new HttpErrorResponse({ status: 503 })),
      of({ id: 'server-set' } as any),
    );

    await service.start('account-a');
    const firstLedger = await service.getLedger('account-a');
    const workoutClientId = firstLedger.workouts['workout-1'].clientId;
    const setClientId = Object.values(firstLedger.sets)[0].clientId;
    await service.start('account-a');
    await service.start('account-a');
    await service.start('account-a');

    expect(workoutApi.create.calls.allArgs().map(args => args[0].clientId)).toEqual([workoutClientId, workoutClientId, workoutClientId]);
    expect(workoutApi.createSet.calls.allArgs().map(args => args[2].clientId)).toEqual([setClientId, setClientId]);
    expect((await service.getLedger('account-a')).workouts['workout-1'].status).toBe('migrated');
  });

  it('blocks only the workout with an unresolved exercise and resumes it after resolution', async () => {
    const resolvedId = 'legacy-resolved';
    const blockedId = 'legacy-blocked';
    await db.routines.bulkPut([localRoutine('resolved-routine', resolvedId), localRoutine('blocked-routine', blockedId)]);
    await db.workoutHistory.bulkPut([localWorkout('resolved-workout', 'resolved-routine', resolvedId), localWorkout('blocked-workout', 'blocked-routine', blockedId)]);
    await service.chooseCatalogExercise('account-a', routineExerciseKey('resolved-routine', resolvedId), { id: 'server-exercise-a' } as any);
    routineApi.create.and.callFake((request: any) => of({ id: request.name === 'Local' ? `server-routine-${request.exercises[0].exerciseId}` : 'server-routine' } as any));
    workoutApi.create.and.returnValue(of(serverWorkout('server-workout')));
    workoutApi.createSet.and.returnValue(of({ id: 'server-set' } as any));

    await service.start('account-a');
    let ledger = await service.getLedger('account-a');
    expect(ledger.workouts['resolved-workout'].status).toBe('migrated');
    expect(ledger.workouts['blocked-workout'].status).toBe('blocked');

    await service.chooseCatalogExercise('account-a', routineExerciseKey('blocked-routine', blockedId), { id: 'server-exercise-b' } as any);
    await service.start('account-a');
    ledger = await service.getLedger('account-a');
    expect(ledger.workouts['blocked-workout'].status).toBe('migrated');
    expect(workoutApi.create).toHaveBeenCalledTimes(2);
  });

  it('does not expose or migrate workout rows already claimed by another account', async () => {
    await db.workoutHistory.put(localWorkout('private-workout', 'routine-1', 'exercise-1'));
    const first = await service.getLedger('account-a');
    first.workouts['private-workout'] = { clientId: crypto.randomUUID(), status: 'pending', claimedAt: '2026-01-01T00:00:00.000Z' };
    await db.migrationLedgers.put(first);

    expect(await service.getPendingLocalWorkouts('account-b')).toEqual([]);
    expect(await service.getAccountLocalWorkouts('account-b')).toEqual([]);
  });

  it('keeps the mandatory 3-local/1-server scenario at three through automatic synchronization', async () => {
    const exerciseId = crypto.randomUUID();
    await db.routines.put(localRoutine('routine-1', exerciseId));
    await db.workoutHistory.bulkPut([localWorkout('workout-a', 'routine-1', exerciseId), localWorkout('workout-b', 'routine-1', exerciseId), localWorkout('workout-c', 'routine-1', exerciseId)]);
    const ledger = await service.getLedger('account-a');
    ledger.exercises[routineExerciseKey('routine-1', exerciseId)] = { localKey: routineExerciseKey('routine-1', exerciseId), name: 'Press', choice: 'custom', clientId: crypto.randomUUID(), serverId: 'server-exercise', status: 'migrated', claimedAt: ledger.createdAt };
    ledger.routines['routine-1'] = { clientId: crypto.randomUUID(), serverId: 'server-routine', status: 'migrated', claimedAt: ledger.createdAt };
    ledger.workouts['workout-a'] = { clientId: crypto.randomUUID(), serverId: 'server-workout-a', status: 'migrated', claimedAt: ledger.createdAt };
    await db.migrationLedgers.put(ledger);
    workoutApi.create.and.callFake(request => of(serverWorkout(`server-${request.clientId}`)));
    workoutApi.createSet.and.callFake((_workoutId, _exerciseId, request) => of({ id: `server-${request.clientId}` } as any));

    const pendingBefore = await service.getPendingLocalWorkouts('account-a');
    expect(1 + pendingBefore.length).toBe(3);
    await service.start('account-a');
    await service.start('account-a');

    expect(workoutApi.create).toHaveBeenCalledTimes(2);
    expect(workoutApi.createSet).toHaveBeenCalledTimes(2);
    const finalServerCount = 1 + workoutApi.create.calls.count();
    expect(finalServerCount + (await service.getPendingLocalWorkouts('account-a')).length).toBe(3);
  });
});

function localRoutine(id: string, exerciseId: string, exerciseName = 'Press'): Routine {
  return { id, name: 'Local', exercises: [{ id: exerciseId, name: exerciseName, setsCount: 3 }] };
}

function localWorkout(id: string, routineId: string, exerciseId: string) {
  return {
    id, routineId, routineName: 'Local', startedAt: '2026-09-08T10:00:00.000Z', finishedAt: '2026-09-08T11:00:00.000Z',
    exercises: [{ exerciseId, name: 'Press', sets: [{ setIndex: 0, reps: 8, weight: 20 }] }],
  };
}

function serverWorkout(id: string) {
  return { id, exercises: [{ id: 'server-workout-exercise', position: 0, sets: [] }] } as any;
}
