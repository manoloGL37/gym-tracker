/** API contract for /api/workouts. These DTOs never reuse Dexie's local workout records. */
export type WorkoutId = string;
export type WorkoutExerciseId = string;
export type WorkoutSetId = string;
export type WorkoutClientId = string;

export interface CreateWorkoutRequest {
  /** Optional UUID; a retry is idempotent for the authenticated user. */
  clientId?: WorkoutClientId | null;
  routineId: string;
  /** ISO LocalDateTime without an offset, for example 2026-09-10T14:30:00. */
  startedAt?: string | null;
  /** Accepted on create only; must not precede the effective startedAt. */
  completedAt?: string | null;
  notes?: string | null;
}

export interface UpdateWorkoutRequest {
  /** true records server time, false clears it, omitted leaves it unchanged. */
  completed?: boolean | null;
  /** Non-null replaces notes. Null/omitted cannot clear them. */
  notes?: string | null;
}

export interface CreateWorkoutSetRequest {
  /** Optional UUID; retry identity is scoped to the workout exercise. */
  clientId?: string | null;
  /** One-based and unique inside its workout exercise. */
  setNumber: number;
  weight: number;
  reps: number;
  rpe?: number | null;
}

export interface WorkoutSetResponse {
  id: WorkoutSetId;
  clientId: string | null;
  setNumber: number;
  weight: number;
  reps: number;
  rpe: number | null;
}

export interface WorkoutExerciseResponse {
  id: WorkoutExerciseId;
  exerciseId: string;
  /** Snapshot position copied from the routine; zero-based. */
  position: number;
  notes: string | null;
  /** Ascending setNumber order. */
  sets: WorkoutSetResponse[];
}

export interface WorkoutResponse {
  id: WorkoutId;
  clientId: WorkoutClientId | null;
  routineId: string | null;
  startedAt: string;
  completedAt: string | null;
  notes: string | null;
  /** Ascending position order. */
  exercises: WorkoutExerciseResponse[];
  createdAt: string;
}

/** The list endpoint returns the full workout DTO in a Spring Page. */
export type WorkoutSummary = WorkoutResponse;

export interface WorkoutPageResponse {
  content: WorkoutResponse[];
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

export interface WorkoutListParams { page?: number; size?: number; sort?: string; }
