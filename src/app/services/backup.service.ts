import { Injectable } from '@angular/core';
import { db } from '../data/active-training.repository';

@Injectable({ providedIn: 'root' })
export class BackupService {
  async exportData(): Promise<Blob> {
    // Read all routines and workout history
    const routines = await db.routines.toArray();
    const workoutHistory = await db.workoutHistory.toArray();
    // Do not include activeTraining or selectedRoutine
    const data = { routines, workoutHistory };
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  }

  async importData(json: string): Promise<void> {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.routines) || !Array.isArray(parsed.workoutHistory)) {
      throw new Error('Invalid backup format');
    }
    // Replace (not merge) routines and workoutHistory
    await db.routines.clear();
    await db.workoutHistory.clear();
    await db.routines.bulkAdd(parsed.routines);
    await db.workoutHistory.bulkAdd(parsed.workoutHistory);
  }
}
