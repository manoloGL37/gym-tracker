import { WorkoutHistory } from '../data/workout-history.model';
import { CreateMobileWorkoutRequest, WorkoutResponse } from '../workouts/workout-api.models';
import { MigrationLedger, ResourceMapping } from './local-to-cloud-migration.models';

export function validateCalendarZone(zone: string): void {
  if (!zone || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(zone)) throw new Error('Confirma una zona IANA histórica válida.');
  new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
}

export function snapshotPayload(workout: WorkoutHistory, mapping: ResourceMapping, ledger: MigrationLedger, zone: string): CreateMobileWorkoutRequest {
  validateCalendarZone(zone);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(mapping.clientId)) throw new Error('clientId persistido inválido; no sustituirlo sin conciliación.');
  const instant = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  if (!instant(workout.startedAt) || !instant(workout.finishedAt) || Date.parse(workout.finishedAt) < Date.parse(workout.startedAt)) throw new Error('Instantes históricos inválidos.');
  const name = (value: string, max: number) => {
    if (!value?.trim() || value.length > max) throw new Error('Nombre histórico fuera del contrato V15.');
    return value;
  };
  if (workout.exercises.length > 50) throw new Error('El snapshot supera 50 ejercicios.');
  const usedSetIds = new Set<string>();
  return {
    clientId: mapping.clientId, routineId: null, startedAt: workout.startedAt, completedAt: workout.finishedAt,
    calendarZone: zone, notes: null, nameSnapshot: name(workout.routineName, 150),
    // Snapshot-only references avoid depending on mutable or physically deleted sources.
    exercises: workout.exercises.map((exercise, position) => {
      if ((exercise.observation?.length ?? 0) > 500) throw new Error('Observación de ejercicio superior a 500 caracteres.');
      const numbers = new Set<number>();
      return {
        clientId: crypto.randomUUID(), exerciseId: null, exerciseNameSnapshot: name(exercise.name, 255),
        position, notes: exercise.observation ?? null,
        sets: exercise.sets.filter(set => set.reps !== null && set.weight !== null).map(set => {
          if (!Number.isInteger(set.setIndex) || set.setIndex < 0 || set.setIndex >= 2147483647 || numbers.has(set.setIndex) ||
              !Number.isInteger(set.reps) || set.reps! < 1 || set.reps! > 2147483647 || !Number.isFinite(set.weight) || set.weight! < 0 || set.weight! > 9999.99) throw new Error('Serie realizada inválida; requiere revisión sin inventar valores.');
          numbers.add(set.setIndex);
          const key = `workout:${workout.id}:exercise:${exercise.exerciseId}:set:${set.setIndex}`;
          const clientId = ledger.sets[key]?.clientId ?? crypto.randomUUID();
          if (!uuid.test(clientId) || usedSetIds.has(clientId)) throw new Error('Identidad de serie inválida o compartida; requiere revisión.');
          usedSetIds.add(clientId);
          return { clientId, setNumber: set.setIndex + 1, weight: set.weight!, reps: set.reps!, rpe: null };
        }),
      };
    }),
  };
}

/** Compare facts, not mutable source references or server-generated row IDs. */
export function sameSnapshot(payload: CreateMobileWorkoutRequest, remote: WorkoutResponse): boolean {
  const facts = (exercises: CreateMobileWorkoutRequest['exercises']) => exercises.map(ex => ({
    name: ex.exerciseNameSnapshot, position: ex.position, notes: ex.notes,
    sets: [...ex.sets].sort((a, b) => a.setNumber - b.setNumber).map(set => ({ number: set.setNumber, weight: set.weight, reps: set.reps, rpe: set.rpe ?? null })),
  })).sort((a, b) => a.position - b.position);
  return Date.parse(payload.startedAt) === Date.parse(remote.startedAtInstant ?? '') &&
    Date.parse(payload.completedAt) === Date.parse(remote.completedAtInstant ?? '') &&
    payload.calendarZone === remote.calendarZone && payload.nameSnapshot === remote.nameSnapshot && payload.notes === remote.notes &&
    JSON.stringify(facts(payload.exercises)) === JSON.stringify(facts(remote.exercises.map(ex => ({
      ...ex, clientId: ex.clientId ?? '', exerciseNameSnapshot: ex.exerciseNameSnapshot ?? '',
    }))));
}

/** New row UUIDs generated for a validation-only proposal are not historical facts. */
export function sameProposedSnapshot(a: CreateMobileWorkoutRequest, b: CreateMobileWorkoutRequest): boolean {
  const facts = (value: CreateMobileWorkoutRequest) => ({ ...value, exercises: value.exercises.map(({ clientId, sets, ...exercise }) => ({
    ...exercise, sets: sets.map(({ clientId, ...set }) => set),
  })) });
  return JSON.stringify(facts(a)) === JSON.stringify(facts(b));
}
