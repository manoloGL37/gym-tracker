
import Dexie, { Table } from 'dexie';
import { ActiveTraining } from '../pages/training/training.model';
import { WorkoutHistory } from './workout-history.model';

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
  constructor() {
    super('GymTrackerDB');
    this.version(4).stores({
      activeTraining: 'id',
      workoutHistory: 'id, finishedAt',
      routines: 'id',
      selectedRoutine: 'id',
    });
  }
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
  },
  async update(routine: Routine) {
    await db.routines.put(routine);
  },
  async delete(id: string) {
    await db.routines.delete(id);
  },
};

export const db = new GymTrackerDB();


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
  },
  async add(history: WorkoutHistory) {
    await db.workoutHistory.put(history);
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
