import { CreateExerciseRequest, ExerciseResponse, ExerciseTranslation } from './exercise-api.models';

/** A server exercise has a server UUID; names are display data, never identity. */
export type BackendExercise = ExerciseResponse;

/** Documents the existing Dexie shape without changing any local persistence. */
export interface LocalExerciseReference {
  localId: string;
  name: string;
}

export interface CustomExerciseDraft {
  clientId: string | null;
  language: string;
  name: string;
  instructions: string;
  category: string;
  equipment: string;
  targetMuscle: string;
  muscleGroup: string;
  secondaryMuscles: string;
}

export function createCustomExerciseDraft(language: string): CustomExerciseDraft {
  return {
    clientId: crypto.randomUUID(),
    language,
    name: '',
    instructions: '',
    category: '',
    equipment: '',
    targetMuscle: '',
    muscleGroup: '',
    secondaryMuscles: '',
  };
}

export function isCustomExerciseDraftValid(draft: CustomExerciseDraft): boolean {
  return Boolean(draft.name.trim())
    && Boolean(draft.language.trim())
    && draft.name.trim().length <= 255
    && draft.language.trim().length <= 10
    && [draft.category, draft.equipment, draft.targetMuscle, draft.muscleGroup]
      .every(value => value.trim().length <= 100);
}

export function getExerciseTranslation(exercise: BackendExercise, language: string): ExerciseTranslation | null {
  return exercise.translations.find(translation => translation.language === language)
    ?? exercise.translations.find(translation => translation.language === 'en')
    ?? exercise.translations[0]
    ?? null;
}

export function getExerciseName(exercise: BackendExercise, language: string): string {
  return getExerciseTranslation(exercise, language)?.name ?? exercise.id;
}

export function canEditExercise(exercise: BackendExercise): boolean {
  return exercise.editable;
}

export function canDeleteExercise(exercise: BackendExercise): boolean {
  return exercise.deletable;
}

export function toCreateExerciseRequest(
  draft: CustomExerciseDraft,
  preservedTranslations: ExerciseTranslation[] = [],
): CreateExerciseRequest {
  const updatedTranslation: ExerciseTranslation = {
    language: draft.language.trim(),
    name: draft.name.trim(),
    instructions: optionalText(draft.instructions),
  };
  const existingIndex = preservedTranslations.findIndex(
    translation => translation.language === updatedTranslation.language,
  );
  const translations = [...preservedTranslations];

  if (existingIndex === -1) {
    translations.push(updatedTranslation);
  } else {
    translations[existingIndex] = updatedTranslation;
  }

  const secondaryMuscles = draft.secondaryMuscles
    .split(',')
    .map(muscle => muscle.trim())
    .filter(Boolean);

  return {
    clientId: draft.clientId,
    category: optionalText(draft.category),
    equipment: optionalText(draft.equipment),
    targetMuscle: optionalText(draft.targetMuscle),
    muscleGroup: optionalText(draft.muscleGroup),
    secondaryMuscles: secondaryMuscles.length ? secondaryMuscles : null,
    translations,
  };
}

function optionalText(value: string): string | null {
  return value.trim() || null;
}
