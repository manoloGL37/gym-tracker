/** API contract for /api/routines. These DTOs deliberately do not reuse Dexie's local Routine. */
export type RoutineId = string;
export type ExerciseId = string;

export interface RoutineExerciseRequest {
  exerciseId: ExerciseId;
  /** Zero-based and unique within the routine. */
  position: number;
  sets: number;
  targetReps: number;
  restSeconds: number;
  notes: string | null;
}

export interface CreateRoutineRequest {
  /** Optional UUID; POST retries are idempotent per authenticated user. */
  clientId?: string | null;
  name: string;
  description: string | null;
  exercises: RoutineExerciseRequest[];
}

/** The API uses the create DTO for full replacement PUT updates. */
export type UpdateRoutineRequest = CreateRoutineRequest;

export interface RoutineExerciseResponse {
  id: string;
  exerciseId: ExerciseId;
  position: number;
  sets: number;
  targetReps: number;
  restSeconds: number;
  notes: string | null;
}

export interface RoutineSummaryResponse {
  id: RoutineId;
  clientId: string | null;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineResponse extends RoutineSummaryResponse {
  exercises: RoutineExerciseResponse[];
}

/** Spring Page response used by GET /api/routines, unlike the exercise catalog page. */
export interface RoutinePageResponse {
  content: RoutineSummaryResponse[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  sort: { empty: boolean; sorted: boolean; unsorted: boolean };
  pageable: {
    offset: number;
    sort: { empty: boolean; sorted: boolean; unsorted: boolean };
    pageNumber: number;
    pageSize: number;
    paged: boolean;
    unpaged: boolean;
  };
  first: boolean;
  last: boolean;
  numberOfElements: number;
  empty: boolean;
}

export interface RoutineListParams {
  page?: number;
  size?: number;
  sort?: string;
}
