export type MigrationStatus =
  | 'available'
  | 'postponed'
  | 'needs-resolution'
  | 'ready'
  | 'migrating'
  | 'partial-failure'
  | 'completed'
  | 'completed-local-only'
  | 'no-local-data';

export type MigrationRecordStatus = 'pending' | 'migrated' | 'blocked' | 'failed' | 'unsupported';

export interface ExerciseMapping {
  localKey: string;
  name: string;
  /** Existing catalog selections are explicit; custom records are created during migration. */
  choice: 'catalog' | 'custom';
  clientId?: string;
  serverId?: string;
  status: MigrationRecordStatus;
  /** First account claim; used to keep shared-device legacy rows isolated. */
  claimedAt?: string;
  error?: string;
}

export interface ResourceMapping {
  clientId: string;
  serverId?: string;
  status: MigrationRecordStatus;
  /** First account claim; used to keep shared-device legacy rows isolated. */
  claimedAt?: string;
  error?: string;
  localOnlyReason?: string;
}

/** Stored under the authenticated `/me` UUID, never under an email or device identifier. */
export interface MigrationLedger {
  accountId: string;
  status: MigrationStatus;
  postponed: boolean;
  createdAt: string;
  updatedAt: string;
  /** Stable conversion values: legacy routines did not have these fields. Existing choices survive retries. */
  defaults: { targetReps: number; restSeconds: number };
  exercises: Record<string, ExerciseMapping>;
  routines: Record<string, ResourceMapping>;
  workouts: Record<string, ResourceMapping>;
  sets: Record<string, ResourceMapping>;
}

export interface MigrationPreview {
  routines: number;
  workouts: number;
  exerciseReferences: number;
  unresolvedExercises: number;
  unsupportedWorkouts: number;
  activeTraining: boolean;
  bodyWeightEntries: number;
  observations: number;
  hasOtherAccountMigration: boolean;
}
