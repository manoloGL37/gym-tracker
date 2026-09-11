import { WorkoutHistory } from '../data/workout-history.model';
import type { RoutineResponse } from '../routines/routine-api.models';
import { WorkoutExerciseResponse, WorkoutResponse, WorkoutSetResponse } from './workout-api.models';

export type WorkoutSource = 'local' | 'cloud';
export interface LocalWorkoutItem { source: 'local'; workout: WorkoutHistory; }
export interface CloudWorkoutItem { source: 'cloud'; workout: WorkoutResponse; routineName: string; exerciseNames: Map<string, string>; }
export type WorkoutListItem = LocalWorkoutItem | CloudWorkoutItem;

export interface CloudSetDraft {
  clientId: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  persisted: WorkoutSetResponse | null;
  saving?: boolean;
}

export interface CloudActiveExercise {
  id: string;
  exerciseId: string;
  position: number;
  name: string;
  notes: string | null;
  sets: CloudSetDraft[];
}

/** A small local resume cache; backend responses remain the source of truth for persisted records. */
export interface CloudActiveTraining {
  id: 'active';
  source: 'cloud';
  workoutId: string;
  workoutClientId: string;
  routineId: string;
  routineName: string;
  startedAt: string;
  notes: string | null;
  exercises: CloudActiveExercise[];
}

export function cloudActiveFromWorkout(workout: WorkoutResponse, routineName: string, names: Map<string, string>): CloudActiveTraining {
  return {
    id: 'active', source: 'cloud', workoutId: workout.id, workoutClientId: workout.clientId ?? crypto.randomUUID(),
    routineId: workout.routineId ?? '', routineName, startedAt: workout.startedAt, notes: workout.notes,
    exercises: workout.exercises.slice().sort((a, b) => a.position - b.position).map(exercise => cloudExerciseFromResponse(exercise, names)),
  };
}

/** Restores the plan omitted by the workout snapshot contract without replacing saved or retryable sets. */
export function fillCloudPlannedSets(training: CloudActiveTraining, routine: RoutineResponse): CloudActiveTraining {
  const plannedByExercise = new Map(routine.exercises.map(exercise => [exercise.exerciseId, exercise.sets]));
  for (const exercise of training.exercises) {
    const planned = plannedByExercise.get(exercise.exerciseId) ?? exercise.sets.length;
    while (exercise.sets.length < planned) exercise.sets.push(newCloudSetDraft(exercise));
  }
  return training;
}

export function cloudExerciseFromResponse(exercise: WorkoutExerciseResponse, names: Map<string, string>): CloudActiveExercise {
  const persisted = exercise.sets.slice().sort((a, b) => a.setNumber - b.setNumber);
  return {
    id: exercise.id, exerciseId: exercise.exerciseId, position: exercise.position,
    name: names.get(exercise.exerciseId) ?? 'Ejercicio sin nombre', notes: exercise.notes,
    sets: persisted.map(set => ({ clientId: set.clientId ?? crypto.randomUUID(), setNumber: set.setNumber, reps: set.reps, weight: set.weight, rpe: set.rpe, persisted: set })),
  };
}

/** Adds only an editable draft. Existing cloud sets cannot be changed because the API has no PATCH/DELETE set route. */
export function newCloudSetDraft(exercise: CloudActiveExercise): CloudSetDraft {
  const nextSetNumber = exercise.sets.reduce((max, set) => Math.max(max, set.setNumber), 0) + 1;
  return { clientId: crypto.randomUUID(), setNumber: nextSetNumber, reps: null, weight: null, rpe: null, persisted: null };
}

/** Serializes a browser Date as the API's zone-less Java LocalDateTime; it intentionally never appends Z. */
export function toBackendLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
