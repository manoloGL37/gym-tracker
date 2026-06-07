
import Dexie, { Table } from 'dexie';
import { ActiveTraining } from '../pages/training/training.model';
import { WorkoutHistory } from './workout-history.model';
import { BodyWeightEntry } from './body-weight.model';

export interface Routine {
  id: string;
  name: string;
  exercises: {
    id: string;
    name: string;
    setsCount: number;
  }[];
}


interface SelectedRoutine {
  id: string; // always 'selected'
  routineId: string;
}

class GymTrackerDB extends Dexie {
  activeTraining!: Table<ActiveTraining, string>;
  workoutHistory!: Table<WorkoutHistory, string>;
  routines!: Table<Routine, string>;
  selectedRoutine!: Table<SelectedRoutine, string>;
  bodyWeight!: Table<BodyWeightEntry, string>;

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
  }
}

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
    await db.selectedRoutine.put({ id: 'selected', routineId });
  },
  async get() {
    return db.selectedRoutine.get('selected');
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

