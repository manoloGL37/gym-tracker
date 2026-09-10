import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ActiveTrainingRepository, db, Routine, RoutinesRepository, WorkoutHistoryRepository } from '../data/active-training.repository';
import { WorkoutHistory } from '../data/workout-history.model';
import { BodyWeightRepository } from '../data/body-weight.repository';
import { ExerciseApiService } from '../exercises/exercise-api.service';
import { ExerciseResponse } from '../exercises/exercise-api.models';
import { RoutineApiService } from '../routines/routine-api.service';
import { WorkoutApiService } from '../workouts/workout-api.service';
import { toBackendLocalDateTime } from '../workouts/workout-domain';
import { ExerciseMapping, MigrationLedger, MigrationPreview, MigrationRecordStatus, MigrationStatus, ResourceMapping } from './local-to-cloud-migration.models';

/**
 * A deliberately narrow one-way importer. It is not a sync queue: only explicit user
 * actions call it, successful records remain mapped, and legacy Dexie rows stay intact.
 */
@Injectable({ providedIn: 'root' })
export class LocalToCloudMigrationService {
  // Lazily resolve HTTP clients so read-only duplicate suppression stays usable in guest
  // screens and isolated tests without constructing unrelated API services.
  private readonly injector = inject(Injector);
  private get exercises(): ExerciseApiService { return this.injector.get(ExerciseApiService); }
  private get routinesApi(): RoutineApiService { return this.injector.get(RoutineApiService); }
  private get workoutsApi(): WorkoutApiService { return this.injector.get(WorkoutApiService); }

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
    const unsupported = workouts.filter(workout => this.unsupportedWorkoutReason(workout, routines) !== null).length;
    return {
      routines: routines.length, workouts: workouts.length, exerciseReferences: references.length,
      // A pending custom choice is resolved by the user and can be safely retried; only a
      // missing choice needs another decision.
      unresolvedExercises: references.filter(reference => !ledger.exercises[reference.key]).length,
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
    const ledger = await this.getLedger(accountId);
    return localExerciseReferences(await RoutinesRepository.getAll()).filter(reference => !ledger.exercises[reference.key]);
  }

  async chooseCatalogExercise(accountId: string, localKey: string, exercise: ExerciseResponse): Promise<void> {
    const ledger = await this.getLedger(accountId);
    const reference = await this.referenceByKey(localKey);
    if (!reference) throw new Error('Local exercise reference no longer exists');
    ledger.exercises[localKey] = { localKey, name: reference.name, choice: 'catalog', serverId: exercise.id, status: 'migrated' };
    await this.save(ledger);
  }

  async chooseCustomExercise(accountId: string, localKey: string): Promise<void> {
    const ledger = await this.getLedger(accountId);
    const reference = await this.referenceByKey(localKey);
    if (!reference || !reference.name.trim()) throw new Error('A custom exercise needs a name');
    const previous = ledger.exercises[localKey];
    ledger.exercises[localKey] = {
      localKey, name: reference.name, choice: 'custom', clientId: previous?.clientId ?? crypto.randomUUID(), status: 'pending',
    };
    await this.save(ledger);
  }

  async start(accountId: string): Promise<MigrationLedger> {
    const ledger = await this.getLedger(accountId);
    ledger.postponed = false;
    await this.ensureClientIds(ledger);
    const preview = await this.getPreview(accountId);
    if (preview.routines === 0 && preview.workouts === 0) {
      ledger.status = preview.bodyWeightEntries || preview.activeTraining ? 'completed-local-only' : 'no-local-data';
      await this.save(ledger); return ledger;
    }
    if (preview.unresolvedExercises > 0) { ledger.status = 'needs-resolution'; await this.save(ledger); return ledger; }
    ledger.status = 'migrating'; await this.save(ledger);
    await this.migrateResolvedExercises(ledger);
    await this.migrateRoutines(ledger);
    await this.migrateWorkouts(ledger);
    await this.finalize(ledger);
    return ledger;
  }

  async isRoutineMigrated(accountId: string, localRoutineId: string): Promise<boolean> {
    return (await this.getLedger(accountId)).routines[localRoutineId]?.status === 'migrated';
  }

  async isWorkoutMigrated(accountId: string, localWorkoutId: string): Promise<boolean> {
    return (await this.getLedger(accountId)).workouts[localWorkoutId]?.status === 'migrated';
  }

  private async ensureClientIds(ledger: MigrationLedger): Promise<void> {
    const [routines, workouts] = await Promise.all([RoutinesRepository.getAll(), WorkoutHistoryRepository.getAll()]);
    for (const routine of routines) ledger.routines[routine.id] ??= pendingMapping();
    for (const workout of workouts) {
      ledger.workouts[workout.id] ??= pendingMapping();
      for (const exercise of workout.exercises) for (const set of exercise.sets) ledger.sets[setKey(workout.id, exercise.exerciseId, set.setIndex)] ??= pendingMapping();
    }
    await this.save(ledger);
  }

  private async migrateResolvedExercises(ledger: MigrationLedger): Promise<void> {
    for (const mapping of Object.values(ledger.exercises)) {
      if (mapping.choice !== 'custom' || mapping.status === 'migrated') continue;
      try {
        const result = await firstValueFrom(this.exercises.create({
          clientId: mapping.clientId ?? (mapping.clientId = crypto.randomUUID()), category: null, equipment: null, targetMuscle: null, muscleGroup: null, secondaryMuscles: null,
          translations: [{ language: 'es', name: mapping.name.trim(), instructions: null }],
        }));
        mapping.serverId = result.id; mapping.status = 'migrated'; delete mapping.error;
      } catch (error) { mapping.status = 'failed'; mapping.error = errorMessage(error); }
      await this.save(ledger);
    }
  }

  private async migrateRoutines(ledger: MigrationLedger): Promise<void> {
    for (const routine of await RoutinesRepository.getAll()) {
      const mapping = ledger.routines[routine.id] ?? (ledger.routines[routine.id] = pendingMapping());
      if (mapping.status === 'migrated') continue;
      const exerciseIds = routine.exercises.map(exercise => ledger.exercises[routineExerciseKey(routine.id, exercise.id)]?.serverId);
      if (exerciseIds.some(id => !id)) { mapping.status = 'blocked'; mapping.error = 'Tiene ejercicios sin resolver o sin confirmar.'; await this.save(ledger); continue; }
      try {
        const response = await firstValueFrom(this.routinesApi.create({
          clientId: mapping.clientId, name: routine.name.trim(), description: null,
          exercises: routine.exercises.map((exercise, position) => ({ exerciseId: exerciseIds[position]!, position, sets: integerAtLeast(exercise.setsCount, 1), targetReps: ledger.defaults.targetReps, restSeconds: ledger.defaults.restSeconds, notes: null })),
        }));
        mapping.serverId = response.id; mapping.status = 'migrated'; delete mapping.error;
      } catch (error) { mapping.status = 'failed'; mapping.error = errorMessage(error); }
      await this.save(ledger);
    }
  }

  private async migrateWorkouts(ledger: MigrationLedger): Promise<void> {
    const routines = await RoutinesRepository.getAll();
    for (const workout of await WorkoutHistoryRepository.getAll()) {
      const mapping = ledger.workouts[workout.id] ?? (ledger.workouts[workout.id] = pendingMapping());
      if (mapping.status === 'migrated' || mapping.status === 'unsupported') continue;
      const unsupported = this.unsupportedWorkoutReason(workout, routines);
      if (unsupported) { mapping.status = 'unsupported'; mapping.localOnlyReason = unsupported; delete mapping.error; await this.save(ledger); continue; }
      const routineMapping = ledger.routines[workout.routineId];
      if (!routineMapping?.serverId) { mapping.status = 'blocked'; mapping.error = 'La rutina vinculada todavía no se ha migrado.'; await this.save(ledger); continue; }
      try {
        const response = await firstValueFrom(this.workoutsApi.create({ clientId: mapping.clientId, routineId: routineMapping.serverId, startedAt: localDateTime(workout.startedAt), completedAt: localDateTime(workout.finishedAt), notes: null }));
        mapping.serverId = response.id;
        await this.save(ledger); // persist before set calls: an ambiguous retry reuses this clientId.
        for (const localExercise of workout.exercises) {
          const serverExercise = response.exercises.find(value => value.position === workout.exercises.indexOf(localExercise));
          if (!serverExercise) throw new Error('El servidor no devolvió el snapshot esperado');
          for (const localSet of localExercise.sets) {
            const setMapping = ledger.sets[setKey(workout.id, localExercise.exerciseId, localSet.setIndex)] ?? (ledger.sets[setKey(workout.id, localExercise.exerciseId, localSet.setIndex)] = pendingMapping());
            if (setMapping.status === 'migrated') continue;
            const set = await firstValueFrom(this.workoutsApi.createSet(response.id, serverExercise.id, { clientId: setMapping.clientId, setNumber: localSet.setIndex + 1, weight: localSet.weight!, reps: localSet.reps!, rpe: null }));
            setMapping.serverId = set.id; setMapping.status = 'migrated'; delete setMapping.error;
            await this.save(ledger);
          }
        }
        mapping.status = 'migrated';
        mapping.localOnlyReason = workout.exercises.some(exercise => Boolean(exercise.observation?.trim()))
          ? 'Las observaciones por ejercicio permanecen solo en local.'
          : undefined;
        delete mapping.error;
      } catch (error) { mapping.status = 'failed'; mapping.error = errorMessage(error); }
      await this.save(ledger);
    }
  }

  private unsupportedWorkoutReason(workout: WorkoutHistory, routines: Routine[]): string | null {
    const routine = routines.find(value => value.id === workout.routineId);
    if (!routine) return 'La rutina local original ya no existe.';
    if (routine.exercises.length !== workout.exercises.length || routine.exercises.some((exercise, index) => exercise.id !== workout.exercises[index]?.exerciseId)) return 'El histórico tiene un snapshot que la API no permite reconstruir.';
    for (const exercise of workout.exercises) for (const set of exercise.sets) {
      if (!Number.isInteger(set.reps) || (set.reps ?? 0) < 1 || typeof set.weight !== 'number' || !Number.isFinite(set.weight) || set.weight < 0 || set.weight > 9999.99) return 'Tiene series incompletas o fuera de los límites de la API.';
    }
    return null;
  }

  private async finalize(ledger: MigrationLedger): Promise<void> {
    const all = [...Object.values(ledger.exercises), ...Object.values(ledger.routines), ...Object.values(ledger.workouts)];
    if (all.some(mapping => mapping.status === 'failed' || mapping.status === 'blocked')) ledger.status = 'partial-failure';
    else if (all.some(mapping => mapping.status === 'unsupported')) ledger.status = 'completed-local-only';
    else ledger.status = 'completed';
    await this.save(ledger);
  }

  private async referenceByKey(key: string): Promise<{ key: string; name: string } | null> {
    return localExerciseReferences(await RoutinesRepository.getAll()).find(reference => reference.key === key) ?? null;
  }

  private async save(ledger: MigrationLedger): Promise<void> { ledger.updatedAt = new Date().toISOString(); await db.migrationLedgers.put(ledger); }
}

/** The local exercise UUID is its identity. A shared UUID is resolved once; equal names are not. */
export function routineExerciseKey(_routineId: string, exerciseId: string): string { return `exercise:${exerciseId}`; }
function setKey(workoutId: string, exerciseId: string, setIndex: number): string { return `workout:${workoutId}:exercise:${exerciseId}:set:${setIndex}`; }
function pendingMapping(): ResourceMapping { return { clientId: crypto.randomUUID(), status: 'pending' }; }
function integerAtLeast(value: number, minimum: number): number { return Number.isInteger(value) && value >= minimum ? value : minimum; }
function localDateTime(value: string): string { const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) throw new Error('Fecha local no válida'); return toBackendLocalDateTime(parsed); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'La solicitud no fue confirmada; se puede reintentar con el mismo clientId.'; }

function localExerciseReferences(routines: Routine[]): { key: string; name: string }[] {
  return routines.flatMap(routine => routine.exercises.map(exercise => ({ key: routineExerciseKey(routine.id, exercise.id), name: exercise.name })));
}
