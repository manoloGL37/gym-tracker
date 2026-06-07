import { db } from './active-training.repository';
import { BodyWeightEntry } from './body-weight.model';

const LEGACY_DB_NAME = 'gym-tracker';
const STORE_NAME = 'bodyWeight';
const MIGRATION_KEY = 'bodyWeight:dexieMigrated';

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
  setTimeout(() => {
    const service = getBackupService();
    if (service) {
      service.triggerBackup().catch(() => {/* silent */});
    }
  }, 0);
}

async function migrateLegacyBodyWeight(): Promise<void> {
  if (localStorage.getItem(MIGRATION_KEY) === 'true') {
    return;
  }

  try {
    const legacyEntries = await readLegacyBodyWeight();
    if (legacyEntries.length) {
      await db.bodyWeight.bulkPut(legacyEntries);
    }
  } catch {
    // Keep the app usable even if the old store cannot be read.
  } finally {
    localStorage.setItem(MIGRATION_KEY, 'true');
  }
}

async function readLegacyBodyWeight(): Promise<BodyWeightEntry[]> {
  const databases = await indexedDB.databases?.();
  if (databases && !databases.some(database => database.name === LEGACY_DB_NAME)) {
    return [];
  }

  const legacyDb = await openLegacyDB();
  try {
    if (!legacyDb.objectStoreNames.contains(STORE_NAME)) {
      return [];
    }

    return await new Promise<BodyWeightEntry[]>((resolve, reject) => {
      const tx = legacyDb.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as BodyWeightEntry[]).filter(isValidBodyWeightEntry));
      req.onerror = () => reject(req.error);
    });
  } finally {
    legacyDb.close();
  }
}

function openLegacyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function isValidBodyWeightEntry(entry: unknown): entry is BodyWeightEntry {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  const candidate = entry as Partial<BodyWeightEntry>;
  return typeof candidate.date === 'string' && typeof candidate.weight === 'number';
}

export class BodyWeightRepository {
  private static async ensureMigrated(): Promise<void> {
    await migrateLegacyBodyWeight();
  }

  static async getAll(): Promise<BodyWeightEntry[]> {
    await this.ensureMigrated();
    const entries = await db.bodyWeight.toArray();
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }

  static async getByDate(date: string): Promise<BodyWeightEntry | null> {
    await this.ensureMigrated();
    return (await db.bodyWeight.get(date)) ?? null;
  }

  static async upsert(entry: BodyWeightEntry): Promise<void> {
    await this.ensureMigrated();
    await db.bodyWeight.put(entry);
    triggerBackupAsync();
  }

  static async delete(date: string): Promise<void> {
    await this.ensureMigrated();
    await db.bodyWeight.delete(date);
    triggerBackupAsync();
  }
}
