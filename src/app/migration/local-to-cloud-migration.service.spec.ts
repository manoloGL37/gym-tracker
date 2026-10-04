import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthApiService } from '../auth/auth-api.service';
import { from, of, throwError } from 'rxjs';
import { db, Routine } from '../data/active-training.repository';
import { WorkoutHistory } from '../data/workout-history.model';
import Dexie from 'dexie';
import { ExerciseApiService } from '../exercises/exercise-api.service';
import { RoutineApiService } from '../routines/routine-api.service';
import { WorkoutApiService } from '../workouts/workout-api.service';
import { LocalToCloudMigrationService, routineExerciseKey } from './local-to-cloud-migration.service';

describe('LocalToCloudMigrationService', () => {
  let service: LocalToCloudMigrationService;
  const exerciseApi = jasmine.createSpyObj<ExerciseApiService>('ExerciseApiService', ['list', 'create']);
  const routineApi = jasmine.createSpyObj<RoutineApiService>('RoutineApiService', ['create']);
  const workoutApi = jasmine.createSpyObj<WorkoutApiService>('WorkoutApiService', ['create', 'createSet', 'createMobile', 'list', 'get']);

  beforeEach(async () => {
    await Promise.all([db.routines.clear(), db.workoutHistory.clear(), db.activeTraining.clear(), db.bodyWeight.clear(), db.migrationLedgers.clear()]);
    TestBed.configureTestingModule({ providers: [
      LocalToCloudMigrationService,
      { provide: AuthApiService, useValue: { getCurrentUser: () => of({ id: 'account-a' }) } },
      { provide: ExerciseApiService, useValue: exerciseApi },
      { provide: RoutineApiService, useValue: routineApi },
      { provide: WorkoutApiService, useValue: workoutApi },
    ] });
    service = TestBed.inject(LocalToCloudMigrationService);
    exerciseApi.list.calls.reset(); exerciseApi.create.calls.reset(); routineApi.create.calls.reset(); workoutApi.create.calls.reset(); workoutApi.createSet.calls.reset(); workoutApi.createMobile.calls.reset(); workoutApi.list.calls.reset(); workoutApi.get.calls.reset();
    workoutApi.createMobile.and.callFake(request => of(mobileResponse(request)));
    workoutApi.list.and.returnValue(of({ content: [], number: 0, totalPages: 1, totalElements: 0, last: true } as any));
  });

  afterEach(async () => { await Promise.all([db.routines.clear(), db.workoutHistory.clear(), db.migrationLedgers.clear()]); });

  it('exports a consistent readonly recovery copy without creating ledger or exposing authentication', async () => {
    const routine = localRoutine('synthetic', 'synthetic');
    const workout = localWorkout('synthetic', 'synthetic', 'synthetic');
    await db.routines.put(routine); await db.workoutHistory.put(workout);
    const originalRead = db.migrationLedgers.toArray.bind(db.migrationLedgers);
    spyOn(db.migrationLedgers, 'toArray').and.callFake(() => {
      expect(Dexie.currentTransaction?.mode).toBe('readonly');
      return originalRead();
    });
    spyOn(service, 'getLedger').and.callThrough();
    const exported = await service.exportRecoveryBackup();
    expect(exported.stores.workoutHistory).toEqual([workout]);
    expect(exported.stores.routines).toEqual([routine]);
    expect(exported.stores.migrationLedgers).toEqual([]);
    expect(Object.keys(exported.stores).sort()).toEqual(['migrationLedgers', 'routines', 'workoutHistory']);
    expect(service.getLedger).not.toHaveBeenCalled();
    expect(await db.migrationLedgers.count()).toBe(0);
    expect(await db.workoutHistory.get(workout.id)).toEqual(workout);
    expect(workoutApi.createMobile).not.toHaveBeenCalled();
  });

  async function readyRoutine(routine: Routine): Promise<void> {
    await db.routines.put(routine);
    const ledger = await service.getLedger('account-a');
    ledger.routines[routine.id] = { clientId: crypto.randomUUID(), serverId: '00000000-0000-4000-8000-000000000011', status: 'migrated' };
    for (const exercise of routine.exercises) {
      const key = routineExerciseKey(routine.id, exercise.id);
      ledger.exercises[key] = { localKey: key, name: exercise.name, choice: 'custom',
        clientId: crypto.randomUUID(), serverId: crypto.randomUUID(), status: 'migrated' };
    }
    await db.migrationLedgers.put(ledger);
  }

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
    expect(exerciseApi.create).toHaveBeenCalledWith(jasmine.objectContaining({ clientId: mapping.clientId, translations: [{ language: 'es', name: 'Mi press', instructions: null }] }), 'account-a');
    expect(routineApi.create).toHaveBeenCalledWith(jasmine.objectContaining({ exercises: [jasmine.objectContaining({ exerciseId: 'server-exercise' })] }), 'account-a');
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

  it('holds unzoned historical records without changing their unsupported ledger', async () => {
    const workout = localWorkout('legacy', 'deleted', 'gone');
    delete workout.calendarZone;
    await db.workoutHistory.put(workout);
    const ledger = await service.getLedger('account-a');
    ledger.workouts[workout.id] = { clientId: crypto.randomUUID(), status: 'unsupported', localOnlyReason: 'Original rejection' };
    await db.migrationLedgers.put(ledger);
    await service.start('account-a');
    expect((await service.getLedger('account-a')).workouts[workout.id]).toEqual(ledger.workouts[workout.id]);
    expect(await db.workoutHistory.get(workout.id)).toEqual(workout);
    expect(workoutApi.createMobile).not.toHaveBeenCalled();
    expect((await service.getProgress('account-a')).pending).toBe(0);
  });

  it('shows that a failed unresolved exercise contributes twice to the attention count', async () => {
    await db.routines.put(localRoutine('routine-1', 'legacy-exercise'));
    const ledger = await service.getLedger('account-a');
    const key = routineExerciseKey('routine-1', 'legacy-exercise');
    ledger.exercises[key] = { localKey: key, name: 'Press', choice: 'custom', status: 'failed', error: 'HTTP 400' };
    await db.migrationLedgers.put(ledger);

    expect(await service.unresolvedReferences('account-a')).toEqual([{ key, name: 'Press' }]);
    expect((await service.getProgress('account-a')).attention).toBe(2);
  });

  for (const scenario of ['complete', 'partial', 'skipped', 'edited', 'removed', 'early']) {
    it(`sends ${scenario} actual snapshot atomically without routine dependencies`, async () => {
      const workout = localWorkout('workout', 'routine', 'exercise');
      workout.startedAt = '2026-09-08T10:00:00.123Z';
      workout.finishedAt = '2026-09-08T10:02:00.456Z';
      workout.exercises[0].observation = 'Historical note';
      workout.exercises[0].sets.push({ setIndex: 1, reps: 6, weight: 22.75 });
      if (scenario === 'partial' || scenario === 'early') workout.exercises[0].sets.push({ setIndex: 2, reps: null, weight: null });
      if (scenario === 'skipped') workout.exercises.push({ exerciseId: 'skipped', name: 'Skipped snapshot', sets: [{ setIndex: 0, reps: null, weight: null }] });
      if (scenario === 'edited') await readyRoutine(localRoutine('routine', 'different', 'New name'));
      // 'removed': the source routine and exercise no longer exist at all.
      await db.workoutHistory.put(workout);
      await service.start('account-a');
      const mapping = (await service.getLedger('account-a')).workouts[workout.id];
      const payload = workoutApi.createMobile.calls.mostRecent().args[0];
      expect(workoutApi.createMobile.calls.mostRecent().args[1]).toBe('account-a');
      expect(payload).toEqual(mapping.snapshotPayload!);
      expect(payload).toEqual(jasmine.objectContaining({ clientId: mapping.clientId, routineId: null, calendarZone: 'Europe/Madrid', startedAt: workout.startedAt, completedAt: workout.finishedAt, nameSnapshot: 'Local' }));
      expect(payload.exercises[0]).toEqual(jasmine.objectContaining({ exerciseId: null, exerciseNameSnapshot: 'Press', position: 0, notes: 'Historical note' }));
      expect(payload.exercises[0].sets.map(set => [set.setNumber, set.weight, set.reps])).toEqual([[1, 20, 8], [2, 22.75, 6]]);
      if (scenario === 'skipped') expect(payload.exercises[1].sets).toEqual([]);
      expect(mapping.status).toBe('migrated');
      expect(workoutApi.create).not.toHaveBeenCalled();
      expect(workoutApi.createSet).not.toHaveBeenCalled();
      expect(await db.workoutHistory.get(workout.id)).toEqual(workout);
    });
  }

  it('persists the exact payload before POST and retries it after a lost committed response', async () => {
    const workout = localWorkout('retry', 'missing', 'gone');
    await db.workoutHistory.put(workout);
    let committed: any;
    workoutApi.createMobile.and.callFake(request => {
      committed ??= mobileResponse(request);
      return workoutApi.createMobile.calls.count() === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of(committed);
    });
    await service.start('account-a');
    const first = (await service.getLedger('account-a')).workouts[workout.id];
    expect(first.status).toBe('pending');
    expect(first.snapshotPayload).toEqual(workoutApi.createMobile.calls.first().args[0]);
    workout.exercises[0].sets[0].weight = 99;
    await db.workoutHistory.put(workout);
    await service.start('account-a');
    const second = (await service.getLedger('account-a')).workouts[workout.id];
    expect(workoutApi.createMobile.calls.allArgs().map(args => args[0])).toEqual([first.snapshotPayload!, first.snapshotPayload!]);
    expect(second.clientId).toBe(first.clientId);
    expect(second.serverId).toBe(committed.id);
    expect(second.status).toBe('blocked'); // Immutable retry succeeded; later local edit requires reconciliation.
  });

  it('blocks an old web snapshot returned idempotently instead of claiming it repaired', async () => {
    await db.workoutHistory.put(localWorkout('old-web', 'routine', 'exercise'));
    workoutApi.createMobile.and.callFake(request => of({ ...mobileResponse(request), exercises: [] }));
    await service.start('account-a');
    expect((await service.getLedger('account-a')).workouts['old-web'].status).toBe('blocked');
    await service.start('account-a');
    expect(workoutApi.createMobile).toHaveBeenCalledTimes(1);
  });

  it('has a durable exact proposal at the moment the HTTP client is invoked', async () => {
    await db.workoutHistory.put(localWorkout('durable', 'missing', 'missing'));
    workoutApi.createMobile.and.callFake(request => from(db.migrationLedgers.get('account-a').then(ledger => {
      expect(ledger!.workouts['durable'].snapshotPayload).toEqual(request);
      expect(ledger!.workouts['durable'].clientId).toBe(request.clientId);
      return mobileResponse(request);
    })));
    await service.start('account-a');
    expect(workoutApi.createMobile).toHaveBeenCalledTimes(1);
  });

  it('confirms one remote workout after a lost response with unchanged local facts', async () => {
    await db.workoutHistory.put(localWorkout('lost', 'deleted', 'deleted'));
    const committed = new Map<string, any>();
    workoutApi.createMobile.and.callFake(request => {
      committed.set(request.clientId, committed.get(request.clientId) ?? mobileResponse(request));
      return workoutApi.createMobile.calls.count() === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of(committed.get(request.clientId));
    });
    await service.start('account-a');
    await service.start('account-a');
    expect(committed.size).toBe(1);
    expect((await service.getLedger('account-a')).workouts['lost'].status).toBe('migrated');
    expect(workoutApi.createMobile.calls.allArgs()[0]).toEqual(workoutApi.createMobile.calls.allArgs()[1]);
  });

  it('holds legacy pending operations and previously failed/blocked/unsupported operations unchanged', async () => {
    const ledger = await service.getLedger('account-a');
    for (const status of ['pending', 'failed', 'blocked', 'unsupported'] as const) {
      const workout = localWorkout(status, 'missing', 'missing');
      delete workout.calendarZone;
      await db.workoutHistory.put(workout);
      ledger.workouts[status] = { clientId: crypto.randomUUID(), status, error: 'original evidence' };
    }
    await db.migrationLedgers.put(ledger);
    await service.start('account-a');
    expect((await service.getLedger('account-a')).workouts).toEqual(ledger.workouts);
    expect(workoutApi.createMobile).not.toHaveBeenCalled();
    expect((await service.getProgress('account-a')).pending).toBe(0);
  });

  it('omits half-filled planned sets without inventing zero values', async () => {
    const workout = localWorkout('half', 'missing', 'missing');
    workout.exercises[0].sets.push({ setIndex: 1, weight: 10, reps: null }, { setIndex: 2, weight: null, reps: 8 });
    await db.workoutHistory.put(workout);
    await service.start('account-a');
    expect(workoutApi.createMobile.calls.first().args[0].exercises[0].sets.map(set => [set.weight, set.reps])).toEqual([[20, 8]]);
  });

  it('does not transmit corrupt performed values', async () => {
    const workout = localWorkout('invalid', 'missing', 'missing');
    workout.exercises[0].sets[0].weight = -1;
    await db.workoutHistory.put(workout);
    await service.start('account-a');
    expect(workoutApi.createMobile).not.toHaveBeenCalled();
    expect((await service.getLedger('account-a')).workouts[workout.id].status).toBe('failed');
  });

  it('reconciles every page/detail read-only into A/B/C/D without modifying the ledger', async () => {
    const ledger = await service.getLedger('account-a');
    for (const id of ['correct', 'absent', 'partial', 'ambiguous']) {
      const workout = localWorkout(id, 'missing', 'missing');
      workout.startedAt = `2026-09-${{ correct: '01', absent: '02', partial: '03', ambiguous: '04' }[id]}T10:00:00.000Z`;
      workout.finishedAt = workout.startedAt;
      await db.workoutHistory.put(workout);
      ledger.workouts[id] = { clientId: crypto.randomUUID(), status: 'unsupported' };
    }
    await db.migrationLedgers.put(ledger);
    // Prepare remote fixtures with the normal builder; only synthetic data.
    const { snapshotPayload } = await import('./workout-snapshot');
    const remote = await Promise.all(['correct', 'partial', 'ambiguous'].map(async id => mobileResponse(snapshotPayload((await db.workoutHistory.get(id))!, ledger.workouts[id], ledger, 'Europe/Madrid'))));
    remote[1].exercises = [];
    remote[2].clientId = crypto.randomUUID();
    workoutApi.list.and.callFake(({ page } = {}) => of({ number: page, totalPages: 2, totalElements: 3, last: page === 1, content: page === 0 ? remote.slice(0, 2) : remote.slice(2) } as any));
    workoutApi.get.and.callFake(id => of(remote.find(value => value.id === id)));
    const result = await service.inspectRecovery('account-a', 'Europe/Madrid');
    expect(Object.fromEntries(result.map(row => [row.localId, row.classification]))).toEqual({ correct: 'A', absent: 'B', partial: 'C', ambiguous: 'D' });
    expect(workoutApi.list).toHaveBeenCalledTimes(2);
    expect(workoutApi.get).toHaveBeenCalledTimes(3);
    expect(await db.migrationLedgers.get('account-a')).toEqual(ledger);
    expect(workoutApi.createMobile).not.toHaveBeenCalled();
    ledger.workouts['partial'].snapshotMode = 'recovery';
    ledger.workouts['partial'].snapshotPayload = snapshotPayload((await db.workoutHistory.get('partial'))!, ledger.workouts['partial'], ledger, 'Europe/Madrid');
    await db.migrationLedgers.put(ledger);
    await expectAsync(service.recoverPreparedWorkout('account-a', 'partial', { backupsVerified: true, historicalZoneConfirmed: true, replayApproved: true })).toBeRejected();
    expect(workoutApi.createMobile).not.toHaveBeenCalled(); // Old web clientId does not authorize a repair POST.
  });

  it('rejects mismatched accounts and incomplete remote listings', async () => {
    spyOn(TestBed.inject(AuthApiService), 'getCurrentUser').and.returnValue(of({ id: 'other-account' } as any));
    await expectAsync(service.inspectRecovery('account-a', 'Europe/Madrid')).toBeRejected();
    expect(workoutApi.list).not.toHaveBeenCalled();
  });

  it('cancels incomplete pages instead of reporting records absent', async () => {
    workoutApi.list.and.returnValue(of({ content: [], number: 0, totalPages: 1, totalElements: 1, last: true } as any));
    await expectAsync(service.inspectRecovery('account-a', 'Europe/Madrid')).toBeRejected();
    expect(workoutApi.createMobile).not.toHaveBeenCalled();
  });

  it('requires verified backups and confirmed historical zone, prepares without resetting/replaying', async () => {
    const workout = localWorkout('recover', 'deleted', 'deleted');
    delete workout.calendarZone;
    await db.workoutHistory.put(workout);
    const ledger = await service.getLedger('account-a');
    ledger.workouts[workout.id] = { clientId: crypto.randomUUID(), status: 'unsupported', localOnlyReason: 'Original rejection' };
    await db.migrationLedgers.put(ledger);
    await expectAsync(service.prepareRecovery('account-a', workout.id, 'Europe/Madrid', { backupsVerified: false, historicalZoneConfirmed: true })).toBeRejected();
    await expectAsync(service.prepareRecovery('account-a', workout.id, 'Europe/Madrid', { backupsVerified: true, historicalZoneConfirmed: false })).toBeRejected();
    await expectAsync(service.prepareRecovery('account-a', workout.id, 'Invalid/Zone', { backupsVerified: true, historicalZoneConfirmed: true })).toBeRejected();
    await service.prepareRecovery('account-a', workout.id, 'Europe/Madrid', { backupsVerified: true, historicalZoneConfirmed: true });
    await service.start('account-a');
    const mapping = (await service.getLedger('account-a')).workouts[workout.id];
    expect(mapping.status).toBe('unsupported');
    expect(mapping.localOnlyReason).toBe('Original rejection');
    expect(mapping.clientId).toBe(ledger.workouts[workout.id].clientId);
    expect(mapping.snapshotMode).toBe('recovery');
    expect(mapping.snapshotPayload!.startedAt).toBe(workout.startedAt);
    expect(mapping.snapshotPayload!.calendarZone).toBe('Europe/Madrid');
    expect(workoutApi.createMobile).not.toHaveBeenCalled();
    expect(await db.workoutHistory.get(workout.id)).toEqual(workout);
  });

  it('recovers one explicitly approved absent snapshot, then reconciles a lost response without another POST', async () => {
    const workout = localWorkout('explicit', 'deleted', 'deleted');
    delete workout.calendarZone;
    await db.workoutHistory.put(workout);
    const ledger = await service.getLedger('account-a');
    ledger.workouts[workout.id] = { clientId: crypto.randomUUID(), status: 'unsupported', error: 'Original evidence' };
    await db.migrationLedgers.put(ledger);
    await service.prepareRecovery('account-a', workout.id, 'Europe/Madrid', { backupsVerified: true, historicalZoneConfirmed: true });
    await expectAsync(service.recoverPreparedWorkout('account-a', workout.id, { backupsVerified: true, historicalZoneConfirmed: true, replayApproved: false })).toBeRejected();
    expect(workoutApi.createMobile).not.toHaveBeenCalled();
    const payload = (await service.getLedger('account-a')).workouts[workout.id].snapshotPayload!;
    const remote = mobileResponse(payload);
    workoutApi.createMobile.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    await expectAsync(service.recoverPreparedWorkout('account-a', workout.id, { backupsVerified: true, historicalZoneConfirmed: true, replayApproved: true })).toBeRejected();
    expect((await service.getLedger('account-a')).workouts[workout.id].status).toBe('unsupported');
    expect((await service.getLedger('account-a')).workouts[workout.id].error).toBe('Original evidence');
    workoutApi.list.and.returnValue(of({ content: [remote], number: 0, totalPages: 1, totalElements: 1, last: true } as any));
    workoutApi.get.and.returnValue(of(remote));
    await service.start('account-a'); // Does NOT replay the prepared recovery.
    await service.recoverPreparedWorkout('account-a', workout.id, { backupsVerified: true, historicalZoneConfirmed: true, replayApproved: true });
    expect(workoutApi.createMobile).toHaveBeenCalledOnceWith(payload, 'account-a');
    expect((await service.getLedger('account-a')).workouts[workout.id].status).toBe('migrated');
    expect(await db.workoutHistory.get(workout.id)).toEqual(workout);
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

  it('synchronizes multiple snapshots despite unavailable current dependencies', async () => {
    const exerciseId = crypto.randomUUID();
    await db.routines.put(localRoutine('routine-1', exerciseId));
    await db.workoutHistory.bulkPut([localWorkout('workout-a', 'routine-1', exerciseId), localWorkout('workout-b', 'routine-1', exerciseId), localWorkout('workout-c', 'routine-1', exerciseId)]);
    exerciseApi.create.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    await service.start('account-a');

    const ledger = await service.getLedger('account-a');
    expect(Object.values(ledger.workouts).map(mapping => mapping.status)).toEqual(['migrated', 'migrated', 'migrated']);
    expect((await service.getProgress('account-a')).pendingWorkouts).toBe(0);
  });

  it('syncs snapshots even when current exercise and routine dependencies are unresolved', async () => {
    await db.routines.put(localRoutine('routine', 'legacy-exercise'));
    await db.workoutHistory.put(localWorkout('independent', 'routine', 'legacy-exercise'));
    await service.start('account-a');
    await service.start('account-a');
    expect((await service.getLedger('account-a')).workouts['independent'].status).toBe('migrated');
    expect(workoutApi.createMobile).toHaveBeenCalledTimes(1);
    expect(await service.getPendingLocalWorkouts('account-a')).toEqual([]);
    expect(await db.workoutHistory.get('independent')).toBeDefined();
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
    workoutApi.createMobile.and.callFake(request => of(mobileResponse(request)));
    workoutApi.createSet.and.callFake((_workoutId, _exerciseId, request) => of({ id: `server-${request.clientId}` } as any));

    const pendingBefore = await service.getPendingLocalWorkouts('account-a');
    expect(1 + pendingBefore.length).toBe(3);
    await service.start('account-a');
    await service.start('account-a');

    expect(workoutApi.createMobile).toHaveBeenCalledTimes(2);
    expect(workoutApi.createSet).not.toHaveBeenCalled();
    const finalServerCount = 1 + workoutApi.createMobile.calls.count();
    expect(finalServerCount + (await service.getPendingLocalWorkouts('account-a')).length).toBe(3);
  });
});

describe('Automatic historical account synchronization', () => {
  let service: LocalToCloudMigrationService;
  let api: jasmine.SpyObj<WorkoutApiService>;
  let auth: jasmine.SpyObj<AuthApiService>;
  let remote: any[];

  beforeEach(async () => {
    await Promise.all([db.routines.clear(), db.workoutHistory.clear(), db.migrationLedgers.clear()]);
    remote = [];
    api = jasmine.createSpyObj('WorkoutApiService', ['list', 'get', 'createMobile']);
    auth = jasmine.createSpyObj('AuthApiService', ['getCurrentUser']);
    auth.getCurrentUser.and.returnValue(of({ id: 'account-a' } as any));
    api.list.and.callFake(() => of({ content: remote, number: 0, totalPages: 1, totalElements: remote.length, last: true } as any));
    api.get.and.callFake(id => of(remote.find(value => value.id === id)));
    api.createMobile.and.callFake(payload => {
      const response = remote.find(value => value.clientId === payload.clientId) ?? mobileResponse(payload);
      if (!remote.includes(response)) remote.push(response);
      return of(response);
    });
    TestBed.configureTestingModule({ providers: [LocalToCloudMigrationService,
      { provide: AuthApiService, useValue: auth }, { provide: WorkoutApiService, useValue: api },
    ] });
    service = TestBed.inject(LocalToCloudMigrationService);
  });

  afterEach(async () => {
    await Promise.all([db.routines.clear(), db.workoutHistory.clear(), db.migrationLedgers.clear()]);
    TestBed.resetTestingModule();
  });

  async function historical(id: string, zoned = true) {
    const workout = localWorkout(id, 'deleted-routine', 'deleted-exercise');
    if (!zoned) delete workout.calendarZone;
    await db.workoutHistory.put(workout);
    const ledger = await service.getLedger('account-a');
    ledger.workouts[id] = { clientId: crypto.randomUUID(), status: 'unsupported', error: 'Old rejection', localOnlyReason: 'Original reason' };
    await db.migrationLedgers.put(ledger);
    return workout;
  }

  it('automatically recovers unsupported, incomplete and skipped exercise snapshots without current routines', async () => {
    const workout = await historical('historical');
    workout.exercises[0].observation = 'Historical note';
    workout.exercises[0].sets.push({ setIndex: 1, weight: 25, reps: null });
    workout.exercises.push({ exerciseId: 'skipped', name: 'Skipped exercise', sets: [{ setIndex: 0, weight: null, reps: null }] });
    await db.workoutHistory.put(workout);
    api.createMobile.and.callFake(payload => from((async () => {
      const saved = (await service.getLedger('account-a')).workouts[workout.id];
      expect(saved.snapshotPayload).toEqual(payload);
      expect(saved.automaticSync?.attempts).toBe(1);
      remote.push(mobileResponse(payload)); return remote[0];
    })()));
    await service.synchronizeAccount('account-a');
    const mapping = (await service.getLedger('account-a')).workouts[workout.id];
    expect(mapping.status).toBe('migrated');
    expect(mapping.automaticSync?.originalStatus).toBe('unsupported');
    expect(mapping.automaticSync?.originalError).toBe('Old rejection');
    expect(mapping.snapshotPayload!.exercises[0].sets.length).toBe(1);
    expect(mapping.snapshotPayload!.exercises[1].sets).toEqual([]);
    expect(mapping.snapshotPayload!.startedAt).toBe(workout.startedAt);
    expect(mapping.snapshotPayload!.exercises[0].notes).toBe('Historical note');
    expect(await db.workoutHistory.get(workout.id)).toEqual(workout);
    await service.synchronizeAccount('account-a');
    expect(api.createMobile).toHaveBeenCalledTimes(1);
  });

  it('confirms already synchronized records by remote detail without POST', async () => {
    const workout = await historical('confirmed');
    const ledger = await service.getLedger('account-a');
    const { snapshotPayload } = await import('./workout-snapshot');
    remote.push(mobileResponse(snapshotPayload(workout, ledger.workouts[workout.id], ledger, workout.calendarZone!)));
    await service.synchronizeAccount('account-a');
    expect(api.createMobile).not.toHaveBeenCalled();
    expect((await service.getLedger('account-a')).workouts[workout.id].automaticSync?.confirmedAt).toBeDefined();
  });

  it('holds a partial remote and continues uploading independent absent records', async () => {
    const partial = await historical('partial');
    const absent = await historical('absent');
    absent.startedAt = '2026-09-09T10:00:00.000Z'; absent.finishedAt = '2026-09-09T11:00:00.000Z';
    await db.workoutHistory.put(absent);
    const ledger = await service.getLedger('account-a');
    const { snapshotPayload } = await import('./workout-snapshot');
    remote.push({ ...mobileResponse(snapshotPayload(partial, ledger.workouts[partial.id], ledger, partial.calendarZone!)), exercises: [] });
    await service.synchronizeAccount('account-a');
    const final = await service.getLedger('account-a');
    expect(final.workouts['partial'].automaticSync?.classification).toBe('C');
    expect(final.workouts['partial'].status).toBe('blocked');
    expect(final.workouts['absent'].status).toBe('migrated');
    expect(api.createMobile).toHaveBeenCalledTimes(1);
    expect(remote.length).toBe(2);
  });

  it('reconciles a committed POST with lost response after restart without another POST', async () => {
    await historical('lost');
    api.createMobile.and.callFake(payload => {
      remote.push(mobileResponse(payload));
      return throwError(() => new HttpErrorResponse({ status: 0 }));
    });
    await service.synchronizeAccount('account-a');
    expect((await service.getLedger('account-a')).workouts['lost'].status).toBe('pending');
    // A new injector recreates the service; only IndexedDB carries the proposal and attempts.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [LocalToCloudMigrationService,
      { provide: AuthApiService, useValue: auth }, { provide: WorkoutApiService, useValue: api },
    ] });
    service = TestBed.inject(LocalToCloudMigrationService);
    await service.synchronizeAccount('account-a');
    expect(api.createMobile).toHaveBeenCalledTimes(1);
    expect((await service.getLedger('account-a')).workouts['lost'].status).toBe('migrated');
  });

  it('persists bounded backoff across passes, preserving exact body and originals', async () => {
    const workout = await historical('backoff');
    api.createMobile.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await service.synchronizeAccount('account-a');
    const payload = (await service.getLedger('account-a')).workouts['backoff'].snapshotPayload;
    await service.synchronizeAccount('account-a');
    expect(api.createMobile).toHaveBeenCalledTimes(1);
    for (let attempt = 2; attempt <= 5; attempt++) {
      const ledger = await service.getLedger('account-a');
      ledger.workouts['backoff'].automaticSync!.nextAttemptAt = 0;
      await db.migrationLedgers.put(ledger);
      await service.synchronizeAccount('account-a');
    }
    await service.synchronizeAccount('account-a');
    expect(api.createMobile).toHaveBeenCalledTimes(5);
    expect(api.createMobile.calls.allArgs().every(args => JSON.stringify(args[0]) === JSON.stringify(payload))).toBeTrue();
    expect((await service.getLedger('account-a')).workouts['backoff'].status).toBe('failed');
    expect(await db.workoutHistory.get(workout.id)).toEqual(workout);
  });

  it('bounds failed remote reads durably and never infers absence from offline reads', async () => {
    await historical('offline');
    api.list.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await expectAsync(service.synchronizeAccount('account-a')).toBeRejected();
    await expectAsync(service.synchronizeAccount('account-a')).toBeRejected();
    expect(api.list).toHaveBeenCalledTimes(1);
    for (let attempt = 2; attempt <= 5; attempt++) {
      const ledger = await service.getLedger('account-a'); ledger.syncRetry!.nextAttemptAt = 0;
      await db.migrationLedgers.put(ledger);
      await expectAsync(service.synchronizeAccount('account-a')).toBeRejected();
    }
    await expectAsync(service.synchronizeAccount('account-a')).toBeRejected();
    expect(api.list).toHaveBeenCalledTimes(5);
    expect(api.createMobile).not.toHaveBeenCalled();
    api.list.and.returnValue(of({ content: [], number: 0, totalPages: 1, totalElements: 0, last: true } as any));
    await service.resetAutomaticRetries('account-a');
    await service.synchronizeAccount('account-a');
    expect((await service.getLedger('account-a')).workouts['offline'].status).toBe('migrated');
  });

  it('serializes concurrent account passes through native Web Locks', async () => {
    await historical('concurrent');
    await Promise.all([service.synchronizeAccount('account-a'), service.synchronizeAccount('account-a')]);
    expect(api.createMobile).toHaveBeenCalledTimes(1);
    expect(remote.length).toBe(1);
  });

  it('never confirms a response without a server identity even when all facts match', async () => {
    await historical('invalid-response');
    api.createMobile.and.callFake(payload => of({ ...mobileResponse(payload), id: undefined }));
    await service.synchronizeAccount('account-a');
    const mapping = (await service.getLedger('account-a')).workouts['invalid-response'];
    expect(mapping.status).toBe('failed');
    expect(mapping.automaticSync?.confirmedAt).toBeUndefined();
    expect(mapping.serverId).toBeUndefined();
    expect((await service.getProgress('account-a')).attention).toBeGreaterThan(0);
  });

  it('keeps offline work local and resumes after connectivity returns', async () => {
    const workout = await historical('offline-online');
    const online = spyOnProperty(navigator, 'onLine', 'get').and.returnValue(false);
    await expectAsync(service.synchronizeAccount('account-a')).toBeRejected();
    expect(api.list).not.toHaveBeenCalled(); expect(api.createMobile).not.toHaveBeenCalled();
    expect(await db.workoutHistory.get(workout.id)).toEqual(workout);
    online.and.returnValue(true);
    await service.synchronizeAccount('account-a');
    expect((await service.getLedger('account-a')).workouts[workout.id].status).toBe('migrated');
  });

  it('journals POST timeouts and consults remote state before an identical retry', async () => {
    await historical('timeout');
    api.createMobile.and.returnValue(throwError(() => Object.assign(new Error('Timeout'), { name: 'TimeoutError' })));
    await service.synchronizeAccount('account-a');
    const ledger = await service.getLedger('account-a');
    const payload = ledger.workouts['timeout'].snapshotPayload;
    expect(ledger.workouts['timeout'].status).toBe('pending');
    ledger.workouts['timeout'].automaticSync!.nextAttemptAt = 0;
    await db.migrationLedgers.put(ledger);
    api.list.calls.reset();
    api.createMobile.and.callFake(request => {
      expect(api.list).toHaveBeenCalled();
      expect(request).toEqual(payload!);
      return of(mobileResponse(request));
    });
    await service.synchronizeAccount('account-a');
    expect(ledger.workouts['timeout'].snapshotPayload).toEqual(payload);
    expect((await service.getLedger('account-a')).workouts['timeout'].status).toBe('migrated');
  });

  it('detects duplicated remote pages and refuses to upload any records', async () => {
    const workout = await historical('remote-duplicate');
    const ledger = await service.getLedger('account-a');
    const { snapshotPayload } = await import('./workout-snapshot');
    const value = mobileResponse(snapshotPayload(workout, ledger.workouts[workout.id], ledger, workout.calendarZone!));
    remote.push(value, value);
    await expectAsync(service.synchronizeAccount('account-a')).toBeRejected();
    expect(api.createMobile).not.toHaveBeenCalled();
    expect(await db.workoutHistory.get(workout.id)).toEqual(workout);
  });

  it('cancels when the authenticated account changes before transmission', async () => {
    await historical('account-change');
    auth.getCurrentUser.and.returnValues(of({ id: 'account-a' } as any), of({ id: 'account-b' } as any));
    await expectAsync(service.synchronizeAccount('account-a')).toBeRejected();
    expect(api.createMobile).not.toHaveBeenCalled();
    expect(await service.getAccountLocalWorkouts('account-b')).toEqual([]);
  });

  it('holds unknown zones while the rest advances, then uses one explicit zone confirmation', async () => {
    const unknown = await historical('unknown', false);
    const known = await historical('known');
    known.startedAt = '2026-09-10T10:00:00.000Z'; known.finishedAt = '2026-09-10T11:00:00.000Z';
    await db.workoutHistory.put(known);
    await service.synchronizeAccount('account-a');
    expect((await service.getLedger('account-a')).workouts['unknown'].automaticSync?.classification).toBe('D');
    expect((await service.getLedger('account-a')).workouts['known'].status).toBe('migrated');
    await service.confirmHistoricalZone('account-a', 'Europe/Madrid', ['unknown']);
    await service.synchronizeAccount('account-a');
    expect((await service.getLedger('account-a')).workouts['unknown'].status).toBe('migrated');
    expect(await db.workoutHistory.get(unknown.id)).toEqual(unknown);
  });

  it('uses remote zone metadata only when identity and exact original instants agree', async () => {
    const unknown = await historical('remote-zone', false);
    const ledger = await service.getLedger('account-a');
    const { snapshotPayload } = await import('./workout-snapshot');
    remote.push(mobileResponse(snapshotPayload(unknown, ledger.workouts[unknown.id], ledger, 'Europe/Madrid')));
    await service.synchronizeAccount('account-a');
    expect((await service.getLedger('account-a')).workouts[unknown.id].status).toBe('migrated');
    expect(api.createMobile).not.toHaveBeenCalled();
  });

  it('retains missing legacy identity and duplicate local identities as ambiguous', async () => {
    const unmapped = localWorkout('unmapped', 'missing', 'missing'); delete unmapped.calendarZone;
    await db.workoutHistory.put(unmapped);
    await historical('duplicate-a'); await historical('duplicate-b');
    const ledger = await service.getLedger('account-a');
    ledger.workouts['duplicate-b'].clientId = ledger.workouts['duplicate-a'].clientId;
    await db.migrationLedgers.put(ledger);
    await service.synchronizeAccount('account-a');
    expect(api.createMobile).not.toHaveBeenCalled();
    expect((await service.getLedger('account-a')).workouts['duplicate-a'].automaticSync?.classification).toBe('D');
    expect((await service.getProgress('account-a')).attention).toBeGreaterThan(0);
    expect(await db.workoutHistory.get('unmapped')).toEqual(unmapped);
  });

  it('refuses changed local history after a durable proposal without sending again', async () => {
    const workout = await historical('changed');
    api.createMobile.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await service.synchronizeAccount('account-a');
    workout.exercises[0].sets[0].weight = 99;
    await db.workoutHistory.put(workout);
    const ledger = await service.getLedger('account-a'); ledger.workouts[workout.id].automaticSync!.nextAttemptAt = 0;
    await db.migrationLedgers.put(ledger);
    await service.synchronizeAccount('account-a');
    expect(api.createMobile).toHaveBeenCalledTimes(1);
    expect((await service.getLedger('account-a')).workouts[workout.id].status).toBe('failed');
    expect(await db.workoutHistory.get(workout.id)).toEqual(workout);
  });
});

function localRoutine(id: string, exerciseId: string, exerciseName = 'Press'): Routine {
  return { id, name: 'Local', exercises: [{ id: exerciseId, name: exerciseName, setsCount: 3 }] };
}

function localWorkout(id: string, routineId: string, exerciseId: string): WorkoutHistory {
  return {
    id, routineId, routineName: 'Local', startedAt: '2026-09-08T10:00:00.000Z', finishedAt: '2026-09-08T11:00:00.000Z', calendarZone: 'Europe/Madrid',
    exercises: [{ exerciseId, name: 'Press', sets: [{ setIndex: 0, reps: 8, weight: 20 }] }],
  };
}

function serverWorkout(id: string) {
  return { id, exercises: [{ id: '00000000-0000-4000-8000-000000000012', position: 0, sets: [] }] } as any;
}

function mobileResponse(request: import('../workouts/workout-api.models').CreateMobileWorkoutRequest): any {
  return { ...request, id: `server-${request.clientId}`, startedAtInstant: request.startedAt, completedAtInstant: request.completedAt,
    exercises: request.exercises.map(ex => ({ ...ex, id: `server-${ex.clientId}`, sets: ex.sets.map(set => ({ ...set, id: `server-${set.clientId}` })) })) };
}
