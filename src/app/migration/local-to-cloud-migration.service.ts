import { Injectable, Injector, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ActiveTrainingRepository, db, Routine, RoutinesRepository, WorkoutHistoryRepository } from '../data/active-training.repository';
import { WorkoutHistory } from '../data/workout-history.model';
import { BodyWeightRepository } from '../data/body-weight.repository';
import { ExerciseApiService } from '../exercises/exercise-api.service';
import { ExerciseResponse } from '../exercises/exercise-api.models';
import { RoutineApiService } from '../routines/routine-api.service';
import { WorkoutApiService } from '../workouts/workout-api.service';
import { snapshotPayload, sameSnapshot, sameProposedSnapshot, validateCalendarZone } from './workout-snapshot';
import { AuthApiService } from '../auth/auth-api.service';
import { WorkoutResponse } from '../workouts/workout-api.models';
import { ExerciseMapping, MigrationLedger, MigrationPreview, MigrationRecordStatus, MigrationStatus, ResourceMapping } from './local-to-cloud-migration.models';

/**
 * A deliberately narrow one-way synchronizer. Successful records remain mapped and
 * legacy Dexie rows stay intact; orchestration and retry timing live in AccountSyncService.
 */
@Injectable({ providedIn: 'root' })
export class LocalToCloudMigrationService {
  // Lazily resolve HTTP clients so read-only duplicate suppression stays usable in guest
  // screens and isolated tests without constructing unrelated API services.
  private readonly injector = inject(Injector);
  private get exercises(): ExerciseApiService { return this.injector.get(ExerciseApiService); }
  private get routinesApi(): RoutineApiService { return this.injector.get(RoutineApiService); }
  private get workoutsApi(): WorkoutApiService { return this.injector.get(WorkoutApiService); }

  /** Changes after a confirmed ledger write, including each individual resource. */
  readonly changes = signal(0);

  async getLedger(accountId: string): Promise<MigrationLedger> {
    const existing = await db.migrationLedgers.get(accountId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const ledger: MigrationLedger = {
      accountId, status: 'available', postponed: false, createdAt: now, updatedAt: now,
      defaults: { targetReps: 10, restSeconds: 90 }, exercises: {}, routines: {}, workouts: {}, sets: {},
    };
    await db.migrationLedgers.put(ledger);
    return ledger;
  }

  async getPreview(accountId: string): Promise<MigrationPreview> {
    const [routines, workouts, active, weights, ledgers] = await Promise.all([
      RoutinesRepository.getAll(), WorkoutHistoryRepository.getAll(), ActiveTrainingRepository.get(), BodyWeightRepository.getAll(), db.migrationLedgers.toArray(),
    ]);
    const ledger = await this.getLedger(accountId);
    const references = localExerciseReferences(routines);
    const unsupported = workouts.filter(workout => !workout.calendarZone || ledger.workouts[workout.id]?.status === 'unsupported').length;
    return {
      routines: routines.length, workouts: workouts.length, exerciseReferences: references.length,
      // A pending custom choice is resolved by the user and can be safely retried; only a
      // missing choice needs another decision.
      unresolvedExercises: references.filter(reference => !ledger.exercises[reference.key] || ledger.exercises[reference.key].status === 'failed').length,
      unsupportedWorkouts: unsupported, activeTraining: active !== undefined, bodyWeightEntries: weights.length,
      observations: workouts.flatMap(workout => workout.exercises).filter(exercise => Boolean(exercise.observation?.trim())).length,
      hasOtherAccountMigration: ledgers.some(value => value.accountId !== accountId && Object.keys(value.routines).length + Object.keys(value.workouts).length > 0),
    };
  }

  async postpone(accountId: string): Promise<void> {
    const ledger = await this.getLedger(accountId);
    ledger.postponed = true; ledger.status = 'postponed';
    await this.save(ledger);
  }

  async setDefaults(accountId: string, targetReps: number, restSeconds: number): Promise<void> {
    if (!Number.isInteger(targetReps) || targetReps < 1 || !Number.isInteger(restSeconds) || restSeconds < 0) throw new Error('Invalid routine defaults');
    const ledger = await this.getLedger(accountId);
    ledger.defaults = { targetReps, restSeconds };
    await this.save(ledger);
  }

  async searchExercises(query: string): Promise<ExerciseResponse[]> {
    return (await firstValueFrom(this.exercises.list({ page: 0, size: 20, search: query.trim() || undefined }))).content;
  }

  async unresolvedReferences(accountId: string): Promise<{ key: string; name: string }[]> {
    const [ledger, ownership] = await Promise.all([this.getLedger(accountId), this.getOwnership()]);
    return localExerciseReferences(await RoutinesRepository.getAll()).filter(reference => {
      if (isOwnedByAnother(ownership.exercises, reference.key, accountId)) return false;
      const mapping = ledger.exercises[reference.key];
      return !mapping || mapping.status === 'failed';
    });
  }

  /** Unclaimed rows plus this account's pending rows form the transitional local view. */
  async getPendingLocalWorkouts(accountId: string): Promise<WorkoutHistory[]> {
    const [ledger, ownership, workouts] = await Promise.all([
      this.getLedger(accountId),
      this.getOwnership(),
      WorkoutHistoryRepository.getAll(),
    ]);
    return workouts.filter(workout => {
      if (isOwnedByAnother(ownership.workouts, workout.id, accountId)) return false;
      return ledger.workouts[workout.id]?.status !== 'migrated';
    });
  }

  /** Fallback view when the account API is unavailable; excludes another account's rows. */
  async getAccountLocalWorkouts(accountId: string): Promise<WorkoutHistory[]> {
    const [ownership, workouts] = await Promise.all([this.getOwnership(), WorkoutHistoryRepository.getAll()]);
    return workouts.filter(workout => !isOwnedByAnother(ownership.workouts, workout.id, accountId));
  }

  async getAccountLocalRoutines(accountId: string): Promise<Routine[]> {
    const [ownership, routines] = await Promise.all([this.getOwnership(), RoutinesRepository.getAll()]);
    return routines.filter(routine => !isOwnedByAnother(ownership.routines, routine.id, accountId));
  }

  async getRoutineMappings(accountId: string): Promise<Record<string, ResourceMapping>> {
    return { ...(await this.getLedger(accountId)).routines };
  }

  async getWorkoutMappings(accountId: string): Promise<Record<string, ResourceMapping>> {
    return { ...(await this.getLedger(accountId)).workouts };
  }

  async chooseCatalogExercise(accountId: string, localKey: string, exercise: ExerciseResponse): Promise<void> {
    const ledger = await this.getLedger(accountId);
    const reference = await this.referenceByKey(localKey);
    if (!reference) throw new Error('Local exercise reference no longer exists');
    ledger.exercises[localKey] = { localKey, name: reference.name, choice: 'catalog', serverId: exercise.id, status: 'migrated', claimedAt: new Date().toISOString() };
    await this.save(ledger);
  }

  async chooseCustomExercise(accountId: string, localKey: string): Promise<void> {
    const ledger = await this.getLedger(accountId);
    const reference = await this.referenceByKey(localKey);
    if (!reference || !reference.name.trim()) throw new Error('A custom exercise needs a name');
    const previous = ledger.exercises[localKey];
    ledger.exercises[localKey] = {
      localKey, name: reference.name, choice: 'custom', clientId: previous?.clientId ?? crypto.randomUUID(), status: 'pending',
      claimedAt: previous?.claimedAt ?? new Date().toISOString(),
    };
    await this.save(ledger);
  }

  async start(accountId: string): Promise<MigrationLedger> {
    const ledger = await this.getLedger(accountId);
    const [localRoutines, localWorkouts] = await Promise.all([RoutinesRepository.getAll(), WorkoutHistoryRepository.getAll()]);
    const runnable = [...Object.values(ledger.exercises), ...Object.values(ledger.routines)].some(mapping => mapping.status === 'pending') ||
      localRoutines.some(routine => !ledger.routines[routine.id]) ||
      localWorkouts.some(workout => (!ledger.workouts[workout.id] && Boolean(workout.calendarZone)) ||
        (ledger.workouts[workout.id]?.snapshotMode === 'new' && ledger.workouts[workout.id].status === 'pending'));
    if (!runnable) return ledger; // Attention states and evidence stay untouched on startup.
    ledger.postponed = false;
    const ownership = await this.getOwnership();
    await this.ensureClientIds(ledger, ownership);
    await this.classifyExercises(ledger, ownership);
    const preview = await this.getPreview(accountId);
    if (preview.routines === 0 && preview.workouts === 0) {
      ledger.status = preview.bodyWeightEntries || preview.activeTraining ? 'completed-local-only' : 'no-local-data';
      await this.save(ledger); return ledger;
    }
    ledger.status = 'migrating'; await this.save(ledger);
    await this.migrateResolvedExercises(ledger);
    await this.migrateRoutines(ledger, ownership);
    await this.migrateWorkouts(ledger, ownership);
    await this.finalize(ledger);
    return ledger;
  }

  async isRoutineMigrated(accountId: string, localRoutineId: string): Promise<boolean> {
    return (await this.getLedger(accountId)).routines[localRoutineId]?.status === 'migrated';
  }

  async isWorkoutMigrated(accountId: string, localWorkoutId: string): Promise<boolean> {
    return (await this.getLedger(accountId)).workouts[localWorkoutId]?.status === 'migrated';
  }

  async getProgress(accountId: string): Promise<{ completed: number; total: number; pending: number; pendingWorkouts: number; attention: number }> {
    const [ledger, unresolved] = await Promise.all([this.getLedger(accountId), this.unresolvedReferences(accountId)]);
    const records = [
      ...Object.values(ledger.exercises),
      ...Object.values(ledger.routines),
      ...Object.values(ledger.workouts),
      ...Object.values(ledger.sets),
    ];
    const primaryRecords = [
      ...Object.values(ledger.exercises),
      ...Object.values(ledger.routines),
      ...Object.values(ledger.workouts),
    ];
    const supported = records.filter(record => record.status !== 'unsupported');
    return {
      completed: supported.filter(record => record.status === 'migrated').length,
      total: supported.length + unresolved.length,
      // Pending set rows inherit their workout's state and must not create an unresolved retry loop.
      pending: [...Object.values(ledger.exercises), ...Object.values(ledger.routines)].filter(record => record.status === 'pending').length + Object.values(ledger.workouts).filter(record => record.status === 'pending' && record.snapshotMode === 'new').length,
      pendingWorkouts: Object.values(ledger.workouts).filter(record => record.status !== 'migrated').length,
      attention: unresolved.length + primaryRecords.filter(record => record.status === 'blocked' || record.status === 'failed' || record.status === 'unsupported').length,
    };
  }

  private async ensureClientIds(ledger: MigrationLedger, ownership: MigrationOwnership): Promise<void> {
    const [routines, workouts] = await Promise.all([RoutinesRepository.getAll(), WorkoutHistoryRepository.getAll()]);
    for (const routine of routines) {
      if (!isOwnedByAnother(ownership.routines, routine.id, ledger.accountId)) ledger.routines[routine.id] ??= pendingMapping();
    }
    for (const workout of workouts) {
      if (isOwnedByAnother(ownership.workouts, workout.id, ledger.accountId)) continue;
      // Legacy records without a captured zone are held without changing their existing states.
      if (!workout.calendarZone && !ledger.workouts[workout.id]) continue;
      const workoutMapping = ledger.workouts[workout.id] ??= { ...pendingMapping(), snapshotMode: 'new' };
      if (workoutMapping.snapshotMode !== 'new') continue;
      if (workoutMapping.status !== 'pending' || !workout.calendarZone) continue;
      for (const exercise of workout.exercises) for (const set of exercise.sets) {
        if (set.reps === null || set.weight === null) continue;
        const key = setKey(workout.id, exercise.exerciseId, set.setIndex);
        if (!isOwnedByAnother(ownership.sets, key, ledger.accountId)) ledger.sets[key] ??= pendingMapping();
      }
    }
    await this.save(ledger);
  }

  /**
   * Routine editing has always generated a UUID for each free-text local exercise.
   * That UUID is therefore an unambiguous local custom identity, unlike older opaque ids.
   */
  private async classifyExercises(ledger: MigrationLedger, ownership: MigrationOwnership): Promise<void> {
    for (const reference of localExerciseReferences(await RoutinesRepository.getAll())) {
      if (isOwnedByAnother(ownership.exercises, reference.key, ledger.accountId)) continue;
      const existing = ledger.exercises[reference.key];
      if (existing && existing.status !== 'pending') continue;
      if (existing?.serverId) {
        existing.status = 'migrated';
        delete existing.error;
        continue;
      }
      if (!existing && isSafeLocalCustomExercise(reference)) {
        ledger.exercises[reference.key] = {
          localKey: reference.key,
          name: reference.name.trim(),
          choice: 'custom',
          clientId: crypto.randomUUID(),
          status: 'pending',
          claimedAt: new Date().toISOString(),
        };
      }
    }
    // Persist the clientId before the first POST, so an interrupted request is idempotent.
    await this.save(ledger);
  }

  private async migrateResolvedExercises(ledger: MigrationLedger): Promise<void> {
    for (const mapping of Object.values(ledger.exercises)) {
      if (mapping.choice !== 'custom' || mapping.status !== 'pending') continue;
      try {
        const result = await firstValueFrom(this.exercises.create({
          clientId: mapping.clientId ?? (mapping.clientId = crypto.randomUUID()), category: null, equipment: null, targetMuscle: null, muscleGroup: null, secondaryMuscles: null,
          translations: [{ language: 'es', name: mapping.name.trim(), instructions: null }],
        }));
        mapping.serverId = result.id; mapping.status = 'migrated'; delete mapping.error;
      } catch (error) { mapping.status = failureStatus(error); mapping.error = errorMessage(error); }
      await this.save(ledger);
    }
  }

  private async migrateRoutines(ledger: MigrationLedger, ownership: MigrationOwnership): Promise<void> {
    for (const routine of await RoutinesRepository.getAll()) {
      if (isOwnedByAnother(ownership.routines, routine.id, ledger.accountId)) continue;
      const mapping = ledger.routines[routine.id] ?? (ledger.routines[routine.id] = pendingMapping());
      if (mapping.status !== 'pending') continue;
      const exerciseMappings = routine.exercises.map(exercise => ledger.exercises[routineExerciseKey(routine.id, exercise.id)]);
      const exerciseIds = exerciseMappings.map(exercise => exercise?.serverId);
      if (exerciseIds.some(id => !id)) {
        mapping.status = exerciseMappings.some(exercise => exercise?.status === 'pending') ? 'pending' : 'blocked';
        mapping.error = 'Tiene ejercicios sin resolver o sin confirmar.';
        await this.save(ledger); continue;
      }
      try {
        const response = await firstValueFrom(this.routinesApi.create({
          clientId: mapping.clientId, name: routine.name.trim(), description: null,
          exercises: routine.exercises.map((exercise, position) => ({ exerciseId: exerciseIds[position]!, position, sets: integerAtLeast(exercise.setsCount, 1), targetReps: ledger.defaults.targetReps, restSeconds: ledger.defaults.restSeconds, notes: null })),
        }));
        mapping.serverId = response.id; mapping.status = 'migrated'; delete mapping.error;
      } catch (error) { mapping.status = failureStatus(error); mapping.error = errorMessage(error); }
      await this.save(ledger);
    }
  }

  private async migrateWorkouts(ledger: MigrationLedger, ownership: MigrationOwnership): Promise<void> {
    for (const workout of await WorkoutHistoryRepository.getAll()) {
      if (isOwnedByAnother(ownership.workouts, workout.id, ledger.accountId)) continue;
      const mapping = ledger.workouts[workout.id];
      if (!mapping || mapping.status !== 'pending' || mapping.snapshotMode !== 'new') continue;
      // Existing web operations may already have committed. Never convert/replay them implicitly.
      if (!mapping.snapshotPayload && (!workout.calendarZone || mapping.serverId)) continue;
      try {
        if (!mapping.snapshotPayload) {
          mapping.snapshotPayload = snapshotPayload(workout, mapping, ledger, workout.calendarZone!);
          mapping.snapshotMode = 'new';
          await this.save(ledger); // identity AND exact body durable before any recoverable POST
        }
        const response = await firstValueFrom(this.workoutsApi.createMobile(mapping.snapshotPayload));
        mapping.serverId = response.id;
        const current = await db.workoutHistory.get(workout.id);
        if (!sameSnapshot(mapping.snapshotPayload, response) || !current ||
            !sameSnapshot(snapshotPayload(current, mapping, ledger, mapping.snapshotPayload.calendarZone), response)) {
          mapping.status = 'blocked';
          mapping.error = 'El snapshot remoto o el historial local cambió; conciliar, no reenviar.';
        } else {
          mapping.status = 'migrated'; delete mapping.error;
          for (const exercise of mapping.snapshotPayload.exercises) for (const set of exercise.sets) {
            const setMapping = Object.values(ledger.sets).find(value => value.clientId === set.clientId);
            const remoteSet = response.exercises.flatMap(value => value.sets).find(value => value.clientId === set.clientId);
            if (setMapping && remoteSet) { setMapping.status = 'migrated'; setMapping.serverId = remoteSet.id; }
          }
        }
      } catch (error) { mapping.status = failureStatus(error); mapping.error = errorMessage(error); }
      await this.save(ledger);
    }
  }

  /** READ ONLY: no getLedger(), cache writes, state resets or HTTP mutations. */
  async inspectRecovery(accountId: string, confirmedZone: string, localIds?: readonly string[]): Promise<RecoveryInspection[]> {
    validateCalendarZone(confirmedZone);
    const [ledger, workouts, ownership] = await Promise.all([
      db.migrationLedgers.get(accountId), WorkoutHistoryRepository.getAll(), this.getOwnership(),
    ]);
    const verifyAccount = async () => {
      if ((await firstValueFrom(this.injector.get(AuthApiService).getCurrentUser())).id !== accountId) throw new Error('La cuenta autenticada no coincide; conciliación cancelada.');
    };
    const remote: WorkoutResponse[] = [];
    let expectedTotal: number | undefined;
    let page = 0;
    while (true) {
      await verifyAccount();
      const result = await firstValueFrom(this.workoutsApi.list({ page, size: 50, sort: 'id,asc' }));
      expectedTotal ??= result.totalElements;
      if (result.totalElements !== expectedTotal) throw new Error('El historial remoto cambió; repetir conciliación.');
      if (result.number !== page) throw new Error('Paginación remota incoherente; conciliación cancelada.');
      for (const value of result.content) remote.push(await firstValueFrom(this.workoutsApi.get(value.id)));
      if (result.last) break;
      if (!result.content.length || ++page >= result.totalPages) throw new Error('Listado remoto incompleto; conciliación cancelada.');
    }
    await verifyAccount();
    if (remote.length !== expectedTotal) throw new Error('Faltan detalles remotos; conciliación cancelada.');
    if (new Set(remote.map(value => value.id)).size !== remote.length) throw new Error('Listado remoto duplicado; repetir conciliación.');
    return workouts.filter(workout => (!localIds || localIds.includes(workout.id)) && !isOwnedByAnother(ownership.workouts, workout.id, accountId)).map(workout => {
      const mapping = ledger?.workouts[workout.id];
      const row: RecoveryInspection = { localId: workout.id, clientId: mapping?.clientId, remoteId: mapping?.serverId, classification: 'D', reason: 'Sin identidad persistida; revisión manual necesaria.' };
      if (!mapping || !ledger) return row;
      let payload;
      try { payload = mapping.snapshotPayload ?? snapshotPayload(workout, mapping, ledger, confirmedZone); }
      catch (error) { return { ...row, reason: errorMessage(error) }; }
      const candidates = remote.filter(value => value.id === mapping.serverId || value.clientId === mapping.clientId);
      if (candidates.length > 1) return { ...row, reason: 'Identidades remotas contradictorias.' };
      if (candidates.length === 1 && ((mapping.serverId && mapping.serverId !== candidates[0].id) ||
          candidates[0].clientId !== mapping.clientId)) return { ...row, reason: 'El remoteId y el clientId no confirman la misma identidad.' };
      if (candidates.length === 1) return { ...row, remoteId: candidates[0].id,
        classification: sameSnapshot(payload, candidates[0]) ? 'A' : 'C',
        reason: sameSnapshot(payload, candidates[0]) ? 'Snapshot confirmado.' : 'Identidad existente con datos diferentes/incompletos; POST mobile no lo reparará.' };
      // Timestamp equality is only an ambiguity signal, NEVER an automatic merge.
      const wallTime = new Intl.DateTimeFormat('sv-SE', { timeZone: payload.calendarZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(payload.startedAt)).replace(' ', 'T');
      if (mapping.serverId || remote.some(value => Date.parse(value.startedAtInstant ?? '') === Date.parse(payload.startedAt) || value.startedAt?.slice(0, 19) === wallTime)) return { ...row, reason: 'Posible registro sin identidad coincidente o remoteId desaparecido.' };
      return { ...row, classification: 'B', reason: 'Identidad ausente en todas las páginas; sin coincidencias temporales.' };
    });
  }

  /** Explicit preparation ONLY. Never sends or changes status, even unsupported. */
  async prepareRecovery(accountId: string, localId: string, historicalZone: string, confirmation: { backupsVerified: boolean; historicalZoneConfirmed: boolean }): Promise<void> {
    if (!confirmation.backupsVerified || !confirmation.historicalZoneConfirmed) throw new Error('Verifica ambas copias y confirma la zona histórica antes de preparar.');
    const inspection = (await this.inspectRecovery(accountId, historicalZone, [localId])).find(value => value.localId === localId);
    if (inspection?.classification !== 'B') throw new Error('Solo se puede preparar una identidad confirmada ausente; los demás casos requieren revisión.');
    await db.transaction('rw', db.migrationLedgers, db.workoutHistory, async () => {
      const ledger = await db.migrationLedgers.get(accountId);
      const workout = await db.workoutHistory.get(localId);
      const mapping = ledger?.workouts[localId];
      if (!ledger || !workout || !mapping || mapping.serverId) throw new Error('Identidad local cambiada; repetir conciliación.');
      if (mapping.snapshotPayload && mapping.snapshotPayload.calendarZone !== historicalZone) throw new Error('La propuesta ya tiene otra zona; requiere revisión, no regeneración.');
      mapping.snapshotPayload ??= snapshotPayload(workout, mapping, ledger, historicalZone);
      mapping.snapshotMode = 'recovery';
      await db.migrationLedgers.put(ledger);
    });
    // Preparation never sends. Execution is a separate explicitly approved call.
  }

  /** Single-record recovery; never called by startup, timers, settings or normal sync. */
  async recoverPreparedWorkout(accountId: string, localId: string, confirmation: { backupsVerified: boolean; historicalZoneConfirmed: boolean; replayApproved: boolean }): Promise<void> {
    if (!confirmation.backupsVerified || !confirmation.historicalZoneConfirmed || !confirmation.replayApproved) throw new Error('La ejecución requiere ambas copias verificadas, zona confirmada y aprobación separada del replay.');
    const ledger = await db.migrationLedgers.get(accountId);
    const mapping = ledger?.workouts[localId];
    const payload = mapping?.snapshotPayload;
    if (!ledger || !mapping || !payload || mapping.snapshotMode !== 'recovery') throw new Error('Preparar y revisar primero una propuesta histórica individual.');
    const beforeSend = await db.workoutHistory.get(localId);
    if (!beforeSend || !sameProposedSnapshot(payload, snapshotPayload(beforeSend, mapping, ledger, payload.calendarZone))) throw new Error('El historial cambió desde la propuesta; revisión requerida antes del envío.');
    const inspection = (await this.inspectRecovery(accountId, payload.calendarZone, [localId]))[0];
    if (!inspection || (inspection.classification !== 'A' && inspection.classification !== 'B')) throw new Error('Conciliación ambigua o snapshot remoto diferente; no se autoriza envío.');
    try {
      const response = inspection.classification === 'A'
        ? await firstValueFrom(this.workoutsApi.get(inspection.remoteId!))
        : await firstValueFrom(this.workoutsApi.createMobile(payload));
      const current = await db.workoutHistory.get(localId);
      mapping.serverId = response.id;
      if (!sameSnapshot(payload, response) || !current || !sameSnapshot(snapshotPayload(current, mapping, ledger, payload.calendarZone), response)) throw new Error('Snapshot remoto o local diferente; conservar datos y revisar sin otro envío.');
      mapping.status = 'migrated'; delete mapping.recoveryError;
      for (const remoteSet of response.exercises.flatMap(exercise => exercise.sets)) {
        const setMapping = Object.values(ledger.sets).find(value => value.clientId === remoteSet.clientId);
        if (setMapping) { setMapping.status = 'migrated'; setMapping.serverId = remoteSet.id; }
      }
    } catch (error) { mapping.recoveryError = errorMessage(error); }
    await this.save(ledger);
    if (mapping.recoveryError) throw new Error(mapping.recoveryError);
  }

  private async finalize(ledger: MigrationLedger): Promise<void> {
    const all = [...Object.values(ledger.exercises), ...Object.values(ledger.routines), ...Object.values(ledger.workouts)];
    if (all.some(mapping => mapping.status === 'pending')) ledger.status = 'partial-failure';
    else if (all.some(mapping => mapping.status === 'failed' || mapping.status === 'blocked')) ledger.status = 'needs-resolution';
    else if (all.some(mapping => mapping.status === 'unsupported')) ledger.status = 'completed-local-only';
    else ledger.status = 'completed';
    await this.save(ledger);
  }

  private async referenceByKey(key: string): Promise<{ key: string; name: string } | null> {
    return localExerciseReferences(await RoutinesRepository.getAll()).find(reference => reference.key === key) ?? null;
  }

  private async save(ledger: MigrationLedger): Promise<void> {
    ledger.updatedAt = new Date().toISOString();
    await db.migrationLedgers.put(ledger);
    this.changes.update(value => value + 1);
  }

  private async getOwnership(): Promise<MigrationOwnership> {
    // ponytail: ledgers are device/account bounded, so a full scan is simpler; add indexed claims if multi-user device history becomes large.
    const ledgers = await db.migrationLedgers.toArray();
    return {
      exercises: mappingOwners(ledgers, 'exercises'),
      routines: mappingOwners(ledgers, 'routines'),
      workouts: mappingOwners(ledgers, 'workouts'),
      sets: mappingOwners(ledgers, 'sets'),
    };
  }
}

/** The local exercise UUID is its identity. A shared UUID is resolved once; equal names are not. */
export function routineExerciseKey(_routineId: string, exerciseId: string): string { return `exercise:${exerciseId}`; }
function setKey(workoutId: string, exerciseId: string, setIndex: number): string { return `workout:${workoutId}:exercise:${exerciseId}:set:${setIndex}`; }
interface MigrationOwnership {
  exercises: Map<string, string>;
  routines: Map<string, string>;
  workouts: Map<string, string>;
  sets: Map<string, string>;
}

function pendingMapping(): ResourceMapping { return { clientId: crypto.randomUUID(), status: 'pending', claimedAt: new Date().toISOString() }; }
function isOwnedByAnother(owners: Map<string, string>, key: string, accountId: string): boolean { const owner = owners.get(key); return owner !== undefined && owner !== accountId; }
function mappingOwners(ledgers: MigrationLedger[], section: keyof Pick<MigrationLedger, 'exercises' | 'routines' | 'workouts' | 'sets'>): Map<string, string> {
  const claims = new Map<string, { accountId: string; claimedAt: string }>();
  for (const ledger of ledgers) for (const [key, mapping] of Object.entries(ledger[section])) {
    const claimedAt = mapping.claimedAt ?? ledger.createdAt;
    const existing = claims.get(key);
    if (!existing || claimedAt < existing.claimedAt || (claimedAt === existing.claimedAt && ledger.accountId < existing.accountId)) claims.set(key, { accountId: ledger.accountId, claimedAt });
  }
  return new Map([...claims].map(([key, claim]) => [key, claim.accountId]));
}
function integerAtLeast(value: number, minimum: number): number { return Number.isInteger(value) && value >= minimum ? value : minimum; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'La solicitud no fue confirmada; se puede reintentar con el mismo clientId.'; }
function failureStatus(error: unknown): MigrationRecordStatus {
  if (error instanceof HttpErrorResponse && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500)) return 'pending';
  if (error instanceof Error && error.name === 'TimeoutError') return 'pending';
  return 'failed';
}

function isSafeLocalCustomExercise(reference: { key: string; name: string }): boolean {
  const localId = reference.key.slice('exercise:'.length);
  const name = reference.name.trim();
  return isUuid(localId) && Boolean(name) && name.length <= 255;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function localExerciseReferences(routines: Routine[]): { key: string; name: string }[] {
  return [...new Map(routines.flatMap(routine => routine.exercises.map(exercise => {
    const reference = { key: routineExerciseKey(routine.id, exercise.id), name: exercise.name };
    return [reference.key, reference] as const;
  }))).values()];
}

export interface RecoveryInspection { localId: string; clientId?: string; remoteId?: string; classification: 'A' | 'B' | 'C' | 'D'; reason: string; }
