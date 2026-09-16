
import Dexie, { Table } from 'dexie';
import { ActiveTraining } from '../pages/training/training.model';
import { WorkoutHistory } from './workout-history.model';
import { BodyWeightEntry } from './body-weight.model';
import { CloudActiveTraining, toBackendLocalDateTime } from '../workouts/workout-domain';
import { MigrationLedger } from '../migration/local-to-cloud-migration.models';
import { RoutinePageResponse } from '../routines/routine-api.models';
import { WorkoutPageResponse } from '../workouts/workout-api.models';

export interface Routine {
  id: string;
  name: string;
  exercises: {
    id: string;
    name: string;
    setsCount: number;
  }[];
}

export interface AccountRoutineCache {
  accountId: string;
  page: RoutinePageResponse;
  updatedAt: string;
}

export interface AccountWorkoutCache {
  accountId: string;
  page: WorkoutPageResponse;
  routineNames: Record<string, string>;
  updatedAt: string;
}


export type SelectedRoutine = LocalSelectedRoutine | CloudSelectedRoutine;

export interface LocalSelectedRoutine {
  id: string; // always 'selected'
  routineId: string;
  /** Missing in pre-Phase-3 records is also interpreted as local. */
  source?: 'local';
}

export interface CloudSelectedRoutine {
  id: string; // always 'selected'
  source: 'cloud';
  routineId: string;
  routineName: string;
  /** Generated once at selection time so an ambiguous POST retry stays idempotent. */
  workoutClientId: string;
  /** Captured with the first attempt so retries keep the real session start time. */
  startedAt?: string;
}

class GymTrackerDB extends Dexie {
  activeTraining!: Table<ActiveTraining, string>;
  cloudActiveTraining!: Table<CloudActiveTraining, string>;
  workoutHistory!: Table<WorkoutHistory, string>;
  routines!: Table<Routine, string>;
  selectedRoutine!: Table<SelectedRoutine, string>;
  bodyWeight!: Table<BodyWeightEntry, string>;
  migrationLedgers!: Table<MigrationLedger, string>;
  accountRoutineCache!: Table<AccountRoutineCache, string>;
  accountWorkoutCache!: Table<AccountWorkoutCache, string>;

  constructor() {
    super('GymTrackerDB');
    const stores = {
      activeTraining: 'id',
      workoutHistory: 'id, finishedAt',
      routines: 'id',
      selectedRoutine: 'id',
      bodyWeight: 'date',
    };

    this.version(4).stores({
      activeTraining: 'id',
      workoutHistory: 'id, finishedAt',
      routines: 'id',
      selectedRoutine: 'id',
    });
    this.version(5).stores(stores);
    this.version(6).stores({ ...stores, cloudActiveTraining: 'id' });
    // Account-scoped migration metadata is deliberately separate from the legacy data.
    // No migration path clears routines, history, active training or body-weight stores.
    this.version(7).stores({ ...stores, cloudActiveTraining: 'id', migrationLedgers: 'accountId' });
    this.version(8).stores({
      ...stores,
      cloudActiveTraining: 'id',
      migrationLedgers: 'accountId',
      accountRoutineCache: 'accountId',
      accountWorkoutCache: 'accountId',
    });
  }
}

/** Explicit name for consumers that need to distinguish the Dexie model from API DTOs. */
export type LocalRoutine = Routine;

export const db = new GymTrackerDB();

/**
 * Helper to get BackupService lazily to avoid circular dependencies
 */
let backupServiceInstance: any = null;
function getBackupService() {
  if (!backupServiceInstance) {
    // Lazy import to avoid circular dependency
    import('../services/backup.service').then(m => {
      backupServiceInstance = new m.BackupService();
    });
  }
  return backupServiceInstance;
}

function triggerBackupAsync() {
  // Async, non-blocking backup trigger
  setTimeout(() => {
    const service = getBackupService();
    if (service) {
      service.triggerBackup().catch(() => {/* silent */});
    }
  }, 0);
}

export const SelectedRoutineRepository = {
  async set(routineId: string) {
    await db.selectedRoutine.put({ id: 'selected', routineId, source: 'local' });
  },
  async get() {
    return db.selectedRoutine.get('selected');
  },
  async setCloud(routineId: string, routineName: string, workoutClientId: string, startedAt = toBackendLocalDateTime(new Date())) {
    await db.selectedRoutine.put({ id: 'selected', source: 'cloud', routineId, routineName, workoutClientId, startedAt });
  },
  async clear() {
    await db.selectedRoutine.delete('selected');
  },
};

export const RoutinesRepository = {
  async getAll() {
    return db.routines.toArray();
  },
  async get(id: string) {
    return db.routines.get(id);
  },
  async add(routine: Routine) {
    await db.routines.put(routine);
    triggerBackupAsync(); // Trigger backup after routine created
  },
  async update(routine: Routine) {
    await db.routines.put(routine);
    triggerBackupAsync(); // Trigger backup after routine updated
  },
  async delete(id: string) {
    await db.routines.delete(id);
    triggerBackupAsync(); // Trigger backup after routine deleted
  },
};

export const ActiveTrainingRepository = {
  async get() {
    return db.activeTraining.get('active');
  },
  async save(training: ActiveTraining) {
    await db.activeTraining.put(training);
  },
  async clear() {
    await db.activeTraining.delete('active');
  },
};

/** Separate cache so a cloud UUID never leaks into the existing local active-training record. */
export const CloudActiveTrainingRepository = {
  async get() {
    return db.cloudActiveTraining.get('active');
  },
  async save(training: CloudActiveTraining) {
    await db.cloudActiveTraining.put(training);
  },
  async clear() {
    await db.cloudActiveTraining.delete('active');
  },
};

export const WorkoutHistoryRepository = {
  async delete(id: string) {
    await db.workoutHistory.delete(id);
    triggerBackupAsync(); // Trigger backup after workout deleted
  },
  async add(history: WorkoutHistory) {
    await db.workoutHistory.put(history);
    triggerBackupAsync(); // Trigger backup after workout saved
  },
  async getLast() {
    return db.workoutHistory.orderBy('finishedAt').reverse().first();
  },
  async getAll() {
    return db.workoutHistory.orderBy('finishedAt').reverse().toArray();
  },
  async getById(id: string) {
    return (await db.workoutHistory.get(id)) ?? null;
  },
};

/** Last confirmed account reads, keyed by `/me` UUID so stale data cannot cross accounts. */
export const AccountReadCacheRepository = {
  getRoutines(accountId: string) { return db.accountRoutineCache.get(accountId); },
  saveRoutines(accountId: string, page: RoutinePageResponse) {
    return db.accountRoutineCache.put({ accountId, page, updatedAt: new Date().toISOString() });
  },
  getWorkouts(accountId: string) { return db.accountWorkoutCache.get(accountId); },
  saveWorkouts(accountId: string, page: WorkoutPageResponse, routineNames: Record<string, string>) {
    return db.accountWorkoutCache.put({ accountId, page, routineNames, updatedAt: new Date().toISOString() });
  },
};

