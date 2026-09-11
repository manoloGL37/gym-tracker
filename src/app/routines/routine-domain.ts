import { LocalRoutine } from '../data/active-training.repository';
import { ExerciseResponse } from '../exercises/exercise-api.models';
import { getExerciseName } from '../exercises/exercise-domain';
import { CreateRoutineRequest, RoutineExerciseResponse, RoutineResponse, RoutineSummaryResponse } from './routine-api.models';

export interface LocalRoutineItem {
  source: 'local';
  routine: LocalRoutine;
}

export interface CloudRoutineItem {
  source: 'cloud';
  routine: RoutineSummaryResponse;
}

export type RoutineListItem = LocalRoutineItem | CloudRoutineItem;

export interface CloudRoutineExerciseDraft {
  exerciseId: string;
  exerciseName: string;
  exerciseSource: ExerciseResponse['source'];
  sets: number;
  targetReps: number;
  restSeconds: number;
  notes: string;
}

export interface CloudRoutineDraft {
  clientId: string;
  name: string;
  description: string;
  exercises: CloudRoutineExerciseDraft[];
}

export function newCloudRoutineDraft(): CloudRoutineDraft {
  return { clientId: crypto.randomUUID(), name: '', description: '', exercises: [] };
}

export function cloudExerciseDraft(exercise: ExerciseResponse, language: string): CloudRoutineExerciseDraft {
  return {
    exerciseId: exercise.id,
    exerciseName: getExerciseName(exercise, language),
    exerciseSource: exercise.source,
    sets: 3,
    targetReps: 10,
    restSeconds: 90,
    notes: '',
  };
}

export function cloudDraftFromResponse(response: RoutineResponse, names: Map<string, string>): CloudRoutineDraft {
  return {
    clientId: response.clientId ?? crypto.randomUUID(),
    name: response.name,
    description: response.description ?? '',
    exercises: response.exercises
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(exercise => cloudExerciseFromResponse(exercise, names)),
  };
}

function cloudExerciseFromResponse(exercise: RoutineExerciseResponse, names: Map<string, string>): CloudRoutineExerciseDraft {
  return {
    exerciseId: exercise.exerciseId,
    exerciseName: names.get(exercise.exerciseId) ?? 'Ejercicio sin nombre',
    exerciseSource: 'EXERCISES_DATASET',
    sets: exercise.sets,
    targetReps: exercise.targetReps,
    restSeconds: exercise.restSeconds,
    notes: exercise.notes ?? '',
  };
}

/** Explicit index-to-position mapping prevents duplicated/stale positions after removals or reordering. */
export function toCreateRoutineRequest(draft: CloudRoutineDraft): CreateRoutineRequest {
  return {
    clientId: draft.clientId,
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    exercises: draft.exercises.map((exercise, position) => ({
      exerciseId: exercise.exerciseId,
      position,
      sets: Number(exercise.sets),
      targetReps: Number(exercise.targetReps),
      restSeconds: Number(exercise.restSeconds),
      notes: exercise.notes.trim() || null,
    })),
  };
}
