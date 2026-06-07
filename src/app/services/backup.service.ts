import { Injectable, signal } from '@angular/core';
import { db } from '../data/active-training.repository';

const BACKEND_URL = 'https://gym-tracker-backup-api.onrender.com';
const DEVICE_ID_KEY = 'gym-tracker-device-id';
const BACKUP_SCHEMA_VERSION = 2;

export interface BackupSnapshot {
  schemaVersion: number;
  exportedAt: string;
  app: 'gym-tracker';
  routines: any[];
  workoutHistory: any[];
  bodyWeight: any[];
}


@Injectable({ providedIn: 'root' })
export class BackupService {
  // Public signal for last backup timestamp (for UI display)
  lastBackupTime = signal<Date | null>(null);
  lastServerStatus = signal<'online' | 'offline' | 'unknown'>('unknown');

  private deviceId: string;
  private isSendingBackup = false;

  constructor() {
    this.deviceId = this.getOrCreateDeviceId();
    this.loadBackupStatusFromStorage();
  }

  /**
   * Load backup status from localStorage
   */
  private loadBackupStatusFromStorage(): void {
    const lastSuccessAt = localStorage.getItem('backup:lastSuccessAt');
    if (lastSuccessAt) {
      this.lastBackupTime.set(new Date(lastSuccessAt));
    }
    const lastStatus = localStorage.getItem('backup:lastStatus');
    if (lastStatus === 'online' || lastStatus === 'offline') {
      this.lastServerStatus.set(lastStatus);
    } else {
      this.lastServerStatus.set('unknown');
    }
  }

  /**
   * Load last server status from localStorage
   */
  private loadLastServerStatus(): void {
    const stored = localStorage.getItem('last-server-status');
    if (stored === 'online' || stored === 'offline') {
      this.lastServerStatus.set(stored);
    }
  }

  /**
   * Get or create persistent device ID
   */
  private getOrCreateDeviceId(): string {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  }

  /**
   * Load last backup time from localStorage
   */
  private loadLastBackupTime(): void {
    const stored = localStorage.getItem('last-backup-time');
    if (stored) {
      this.lastBackupTime.set(new Date(stored));
    }
  }

  /**
   * Trigger a backup after a data change
   * This is the main method repositories should call
   */
  async triggerBackup(): Promise<void> {
    // Silent, best-effort: don't block if offline or already sending
    if (!navigator.onLine || this.isSendingBackup) {
      // If offline, update server status only
      this.lastServerStatus.set('offline');
      localStorage.setItem('backup:lastStatus', 'offline');
      return;
    }

    try {
      this.isSendingBackup = true;
      await this.sendBackupToServer();
      // If successful, update server status and last success time
      this.lastServerStatus.set('online');
      localStorage.setItem('backup:lastStatus', 'online');
      const now = new Date();
      this.lastBackupTime.set(now);
      localStorage.setItem('backup:lastSuccessAt', now.toISOString());
    } catch (error) {
      // On failure, update server status only
      this.lastServerStatus.set('offline');
      localStorage.setItem('backup:lastStatus', 'offline');
      // Silent failure - do nothing
      console.debug('Backup failed (silent):', error);
    } finally {
      this.isSendingBackup = false;
    }
  }

  /**
   * Create a full snapshot of all app data
   */
  private async createSnapshot(): Promise<BackupSnapshot> {
    const [routines, workoutHistory, bodyWeight] = await Promise.all([
      db.routines.toArray(),
      db.workoutHistory.toArray(),
      db.bodyWeight.toArray(),
    ]);

    return {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      app: 'gym-tracker',
      routines,
      workoutHistory,
      bodyWeight,
    };
  }

  /**
   * Send backup to production backend
   */
  private async sendBackupToServer(): Promise<void> {
    const snapshot = await this.createSnapshot();
    const timestamp = new Date().toISOString();

    const response = await fetch(`${BACKEND_URL}/backup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: this.deviceId,
        timestamp,
        data: snapshot,
      }),
    });

    if (!response.ok) {
      throw new Error(`Backup failed: ${response.status}`);
    }
    // Success: handled in triggerBackup
  }

  /**
   * Manual restore from server
   */
  async restoreFromServer(): Promise<string | null> {
    try {
      const response = await fetch(`${BACKEND_URL}/backup/${this.deviceId}`);
      if (!response.ok) {
        return 'Could not fetch backup from server.';
      }
      const result = await response.json();
      if (!result || typeof result !== 'object' || !result.data) {
        return 'Invalid backup format from server.';
      }
      const { routines, workoutHistory, bodyWeight } = this.normalizeBackupSnapshot(result.data);
      if (!Array.isArray(routines) || !Array.isArray(workoutHistory)) {
        return 'Server backup is missing required data.';
      }
      // Clear local data
      await db.routines.clear();
      await db.workoutHistory.clear();
      await db.bodyWeight.clear();
      await db.routines.bulkAdd(routines);
      await db.workoutHistory.bulkAdd(workoutHistory);
      // Restore body weight if present
      if (Array.isArray(bodyWeight)) {
        await db.bodyWeight.bulkPut(bodyWeight);
      }
      return null; // Success
    } catch (e) {
      return 'Restore failed.';
    }
  }

  /**
   * Export data as JSON file (for manual backup)
   */
  async exportData(): Promise<Blob> {
    const snapshot = await this.createSnapshot();
    return new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  }

  /**
   * Import data from JSON file (for manual restore)
   */
  async importData(json: string): Promise<void> {
    const parsed = this.normalizeBackupSnapshot(JSON.parse(json));

    // Replace (not merge) routines and workoutHistory
    await db.routines.clear();
    await db.workoutHistory.clear();
    await db.bodyWeight.clear();
    await db.routines.bulkAdd(parsed.routines);
    await db.workoutHistory.bulkAdd(parsed.workoutHistory);

    // Import body weight if present
    if (Array.isArray(parsed.bodyWeight)) {
      await db.bodyWeight.bulkPut(parsed.bodyWeight);
    }
  }

  previewData(json: string): { routines: number; workoutHistory: number; bodyWeight: number; exportedAt: string | null; schemaVersion: number | null } {
    const parsed = this.normalizeBackupSnapshot(JSON.parse(json));
    return {
      routines: parsed.routines.length,
      workoutHistory: parsed.workoutHistory.length,
      bodyWeight: parsed.bodyWeight.length,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : null,
    };
  }

  private normalizeBackupSnapshot(value: any): BackupSnapshot {
    if (!value || !Array.isArray(value.routines) || !Array.isArray(value.workoutHistory)) {
      throw new Error('Invalid backup format');
    }

    return {
      schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : 1,
      exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
      app: 'gym-tracker',
      routines: value.routines,
      workoutHistory: value.workoutHistory,
      bodyWeight: Array.isArray(value.bodyWeight) ? value.bodyWeight : [],
    };
  }
}
