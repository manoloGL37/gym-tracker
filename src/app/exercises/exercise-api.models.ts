/** API contract for /api/exercises. Keep separate from Dexie's free-text exercise references. */
export type ExerciseSource = 'EXERCISES_DATASET' | 'USER';

export interface ExerciseTranslation {
  language: string;
  name: string;
  instructions: string | null;
}

export interface ExerciseAlias {
  language: string;
  alias: string;
}

export interface ExerciseResponse {
  id: string;
  clientId: string | null;
  source: ExerciseSource;
  sourceId: string | null;
  editable: boolean;
  deletable: boolean;
  category: string | null;
  equipment: string | null;
  targetMuscle: string | null;
  muscleGroup: string | null;
  secondaryMuscles: string[] | null;
  translations: ExerciseTranslation[];
  aliases: ExerciseAlias[];
}

export interface CreateExerciseRequest {
  clientId: string | null;
  category: string | null;
  equipment: string | null;
  targetMuscle: string | null;
  muscleGroup: string | null;
  secondaryMuscles: string[] | null;
  translations: ExerciseTranslation[];
}

/** The contract specifies the same payload for POST and PUT. */
export type UpdateExerciseRequest = CreateExerciseRequest;

export interface ExercisePageResponse {
  content: ExerciseResponse[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface ExerciseFilterOptionsResponse {
  categories: string[];
  equipment: string[];
  muscleGroups: string[];
  targetMuscles: string[];
}

export interface ExerciseListParams {
  page?: number;
  size?: number;
  search?: string;
  category?: string;
  equipment?: string;
  muscleGroup?: string;
  targetMuscle?: string;
}
