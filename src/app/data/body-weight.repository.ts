import { BodyWeightEntry } from './body-weight.model';

const STORE_NAME = 'bodyWeight';

export class BodyWeightRepository {
  static dbPromise: Promise<IDBDatabase> = openDB();

  private static async getStore(mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE_NAME, mode);
    return tx.objectStore(STORE_NAME);
  }

  static async getAll(): Promise<BodyWeightEntry[]> {
    const store = await this.getStore();
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const result = req.result as BodyWeightEntry[];
        // Sort descending by date
        resolve(result.sort((a, b) => b.date.localeCompare(a.date)));
      };
      req.onerror = () => reject(req.error);
    });
  }

  static async getByDate(date: string): Promise<BodyWeightEntry | null> {
    const store = await this.getStore();
    return new Promise((resolve, reject) => {
      const req = store.get(date);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  static async upsert(entry: BodyWeightEntry): Promise<void> {
    const store = await this.getStore('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(entry, entry.date);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  static async delete(date: string): Promise<void> {
    const store = await this.getStore('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(date);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

// --- IndexedDB setup ---
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gym-tracker', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
