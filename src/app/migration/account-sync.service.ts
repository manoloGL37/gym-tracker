import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { LocalToCloudMigrationService } from './local-to-cloud-migration.service';
import { SyncDiagnosticsService } from './sync-diagnostics.service';

export type AccountSyncStatus = 'idle' | 'syncing' | 'retrying' | 'synced' | 'waiting' | 'attention';

export interface AccountSyncState {
  status: AccountSyncStatus;
  completed: number;
  total: number;
  pending: number;
  remaining: number;
  attention: number;
}

@Injectable({ providedIn: 'root' })
export class AccountSyncService implements OnDestroy {
  private readonly migration = inject(LocalToCloudMigrationService);
  private readonly diagnostics = inject(SyncDiagnosticsService);
  private accountId: string | null = null;
  private runId = 0;
  private retryAttempt = 0;
  private progressReadId = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private hasPendingWork = false;
  private workArrivedDuringSync = false;
  private recoveryPaused = 0;
  private readonly onlineListener = () => this.resumePendingSync();
  private readonly visibilityListener = () => {
    if (globalThis.document?.visibilityState === 'visible') this.resumePendingSync();
  };

  readonly status = signal<AccountSyncStatus>('idle');
  readonly completed = signal(0);
  readonly total = signal(0);
  readonly pending = signal(0);
  readonly attention = signal(0);
  readonly pendingWorkouts = signal(0);
  readonly state = computed<AccountSyncState>(() => ({
    status: this.status(),
    completed: this.completed(),
    total: this.total(),
    pending: this.pending(),
    remaining: Math.max(0, this.total() - this.completed()),
    attention: this.attention(),
  }));

  constructor() {
    globalThis.addEventListener?.('online', this.onlineListener);
    globalThis.document?.addEventListener?.('visibilitychange', this.visibilityListener);
    effect(() => {
      this.migration.changes();
      if (this.accountId && this.running) void this.refreshProgress(this.accountId, this.runId);
    });
  }

  start(accountId: string): void {
    if (this.accountId !== accountId) {
      this.stop();
      this.accountId = accountId;
    }
    if (!this.recoveryPaused && !this.running && !this.retryTimer) void this.run();
  }

  retryNow(): void {
    if (this.recoveryPaused || !this.accountId || this.running) return;
    this.clearRetry();
    this.retryAttempt = 0;
    void this.run();
  }

  /** A newly completed local workout is a new queue item, even after a previously clean pass. */
  notifyPendingWork(): void {
    if (!this.accountId) return;
    this.hasPendingWork = true;
    if (this.running) this.workArrivedDuringSync = true;
    this.retryNow();
  }

  /** Connectivity and foreground are hints: only resume work known to be pending. */
  resumePendingSync(): void {
    if (this.hasPendingWork) this.retryNow();
  }

  /** Drain the current pass before the recovery page takes the cross-tab lock. */
  async pauseForRecovery(): Promise<void> {
    this.diagnostics.record({ category: 'migration', operation: 'pause', result: 'pending' });
    this.recoveryPaused++;
    this.clearRetry();
    await this.running;
    this.clearRetry();
    this.diagnostics.retryState.set('Sincronización pausada');
  }

  resumeAfterRecovery(): void {
    this.recoveryPaused = Math.max(0, this.recoveryPaused - 1);
    if (!this.recoveryPaused && this.accountId) this.retryNow();
  }

  stop(): void {
    if (this.accountId) {
      this.diagnostics.record({ category: 'migration', operation: 'pause', result: 'pending' });
      this.diagnostics.retryState.set('Sincronización detenida');
    }
    this.runId++;
    this.accountId = null;
    this.running = null;
    this.retryAttempt = 0;
    this.hasPendingWork = false;
    this.workArrivedDuringSync = false;
    this.clearRetry();
    this.status.set('idle');
    this.completed.set(0);
    this.total.set(0);
    this.pending.set(0);
    this.attention.set(0);
    this.pendingWorkouts.set(0);
  }

  ngOnDestroy(): void {
    this.stop();
    globalThis.removeEventListener?.('online', this.onlineListener);
    globalThis.document?.removeEventListener?.('visibilitychange', this.visibilityListener);
  }

  private run(): Promise<void> {
    const accountId = this.accountId;
    const runId = ++this.runId;
    this.status.set(this.retryAttempt ? 'retrying' : 'syncing');
    this.diagnostics.begin('migration', 'reconcile', this.retryAttempt + 1);
    this.diagnostics.retryState.set('Pasada en curso');
    const task = this.synchronize(accountId, runId).finally(() => {
      if (this.running !== task) return;
      this.running = null;
      if (this.workArrivedDuringSync) {
        this.workArrivedDuringSync = false;
        this.retryNow();
      }
    });
    this.running = task;
    return task;
  }

  private async synchronize(accountId: string | null, runId: number): Promise<void> {
    if (!accountId) return;
    try {
      // Show the ledger's real queue without delaying its POSTs.
      void this.refreshProgress(accountId, runId);
      await this.migration.synchronizeAccount(accountId);
      const progress = await this.refreshProgress(accountId, runId, true);
      if (runId !== this.runId || accountId !== this.accountId) return;
      if (!progress) throw new Error('No se pudo confirmar el estado local de sincronización.');
      this.retryAttempt = progress.pending ? this.retryAttempt + 1 : 0;
      this.hasPendingWork = progress.pending > 0;
      this.status.set(progress.attention ? 'attention' : progress.pending ? 'waiting' : 'synced');
      this.diagnostics.record({ category: 'migration', operation: progress.pending || progress.attention ? 'pause' : 'complete', result: progress.attention ? 'attention' : progress.pending ? 'pending' : 'success' });
      this.diagnostics.retryState.set(progress.pending ? 'Datos pendientes' : 'Sin reintento programado');
      if (progress.pending) this.scheduleRetry(runId);
    } catch (error) {
      if (runId !== this.runId || accountId !== this.accountId) return;
      this.diagnostics.failure('migration', 'reconcile', error, 'failed', this.retryAttempt + 1);
      this.diagnostics.retryState.set(globalThis.navigator?.onLine === false ? 'Esperando conectividad' : 'Esperando confirmación');
      this.retryAttempt++;
      this.hasPendingWork = true;
      const progress = await this.refreshProgress(accountId, runId, true);
      if (runId !== this.runId || accountId !== this.accountId) return;
      this.status.set(progress?.attention && this.retryAttempt >= 5 ? 'attention' : 'waiting');
      this.scheduleRetry(runId);
    }
  }

  private async refreshProgress(accountId: string, runId: number, final = false) {
    const progressReadId = ++this.progressReadId;
    try {
      const progress = await this.migration.getProgress(accountId);
      if ((!final && progressReadId !== this.progressReadId) || runId !== this.runId || accountId !== this.accountId) return null;
      this.applyProgress(progress);
      return progress;
    } catch (error) {
      this.diagnostics.failure('migration', 'verify', error);
      return null;
    }
  }

  /** Reconcile every accepted ledger read, including reads triggered by ledger changes. */
  private applyProgress(progress: { completed: number; total: number; pending: number; pendingWorkouts: number; attention: number }): void {
    this.completed.set(progress.completed);
    this.total.set(progress.total);
    this.pending.set(progress.pending);
    this.attention.set(progress.attention);
    this.pendingWorkouts.set(progress.pendingWorkouts);

    if (progress.pending > 0) {
      this.hasPendingWork = true;
      if (this.running) this.status.set(this.retryAttempt ? 'retrying' : 'syncing');
      return;
    }

    // Ledger reads update counters only. Success is set after the remote reconciliation resolves.
  }

  private scheduleRetry(runId: number): void {
    this.clearRetry();
    if (this.recoveryPaused || this.retryAttempt >= 5) {
      this.diagnostics.retryState.set(this.recoveryPaused ? 'Sincronización pausada' : 'Límite de reintentos automáticos alcanzado');
      this.diagnostics.record({ category: 'migration', operation: 'pause', result: this.recoveryPaused ? 'pending' : 'attention', reason: this.retryAttempt >= 5 ? 'retry-budget' : undefined });
      return;
    }
    // ponytail: bounded exponential backoff capped at one minute; online events can retry sooner.
    const delay = Math.min(60_000, 5_000 * 3 ** Math.min(this.retryAttempt - 1, 3));
    this.diagnostics.retryState.set('Reintento programado');
    this.diagnostics.record({ category: 'migration', operation: 'retry', result: 'retrying', attempt: this.retryAttempt + 1, source: 'automatic' });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.diagnostics.record({ category: 'migration', operation: 'retry', result: 'pending', attempt: this.retryAttempt + 1, source: 'automatic' });
      if (runId === this.runId && this.accountId) void this.run();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
