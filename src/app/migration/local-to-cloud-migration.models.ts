import { CreateMobileWorkoutRequest } from '../workouts/workout-api.models';

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
  /** Immutable proposal persisted before POST. Reconcile remote state before replay. */
  snapshotPayload?: CreateMobileWorkoutRequest;
  snapshotMode?: 'new' | 'recovery';
  /** Recovery failures do not erase the original migration error/reason. */
  recoveryError?: string;
  /** Historical confirmation belongs to this identity; original history stays untouched. */
  historicalZone?: string;
  automaticSync?: { classification?: 'A' | 'B' | 'C' | 'D'; confirmedAt?: string; attempts: number; nextAttemptAt?: number; originalStatus: MigrationRecordStatus; originalError?: string };
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
  /** Durable read-failure budget, including cold starts and application restarts. */
  syncRetry?: { attempts: number; nextAttemptAt: number };
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
