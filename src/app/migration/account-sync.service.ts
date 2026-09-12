import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { LocalToCloudMigrationService } from './local-to-cloud-migration.service';

export type AccountSyncStatus = 'idle' | 'syncing' | 'retrying' | 'synced' | 'waiting' | 'attention';

@Injectable({ providedIn: 'root' })
export class AccountSyncService implements OnDestroy {
  private readonly migration = inject(LocalToCloudMigrationService);
  private accountId: string | null = null;
  private runId = 0;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private hasPendingWork = false;
  private readonly onlineListener = () => this.resumePendingSync();
  private readonly visibilityListener = () => {
    if (globalThis.document?.visibilityState === 'visible') this.resumePendingSync();
  };

  readonly status = signal<AccountSyncStatus>('idle');
  readonly completed = signal(0);
  readonly total = signal(0);
  readonly attention = signal(0);

  constructor() {
    globalThis.addEventListener?.('online', this.onlineListener);
    globalThis.document?.addEventListener?.('visibilitychange', this.visibilityListener);
  }

  start(accountId: string): void {
    if (this.accountId !== accountId) {
      this.stop();
      this.accountId = accountId;
    }
    if (!this.running && !this.retryTimer) void this.run();
  }

  retryNow(): void {
    if (!this.accountId || this.running) return;
    this.clearRetry();
    void this.run();
  }

  /** Connectivity and foreground are hints: only resume work known to be pending. */
  resumePendingSync(): void {
    if (this.hasPendingWork) this.retryNow();
  }

  stop(): void {
    this.runId++;
    this.accountId = null;
    this.running = null;
    this.retryAttempt = 0;
    this.hasPendingWork = false;
    this.clearRetry();
    this.status.set('idle');
    this.completed.set(0);
    this.total.set(0);
    this.attention.set(0);
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
    const task = this.synchronize(accountId, runId).finally(() => {
      if (this.running === task) this.running = null;
    });
    this.running = task;
    return task;
  }

  private async synchronize(accountId: string | null, runId: number): Promise<void> {
    if (!accountId) return;
    try {
      // Show real pending work as soon as it is available without delaying the sync POSTs.
      void this.migration.getProgress(accountId).then(initial => {
        if (runId !== this.runId || accountId !== this.accountId || this.status() !== 'syncing') return;
        this.completed.set(initial.completed);
        this.total.set(initial.total);
        this.attention.set(initial.attention);
      }).catch(() => undefined);
      await this.migration.start(accountId);
      const progress = await this.migration.getProgress(accountId);
      if (runId !== this.runId || accountId !== this.accountId) return;
      this.completed.set(progress.completed);
      this.total.set(progress.total);
      this.attention.set(progress.attention);
      this.retryAttempt = progress.pending ? this.retryAttempt + 1 : 0;
      this.hasPendingWork = progress.pending > 0;
      this.status.set(progress.attention ? 'attention' : progress.pending ? 'waiting' : 'synced');
      if (progress.pending) this.scheduleRetry(runId);
    } catch {
      if (runId !== this.runId || accountId !== this.accountId) return;
      this.retryAttempt++;
      this.hasPendingWork = true;
      this.status.set('waiting');
      this.scheduleRetry(runId);
    }
  }

  private scheduleRetry(runId: number): void {
    this.clearRetry();
    // ponytail: bounded exponential backoff capped at one minute; online events can retry sooner.
    const delay = Math.min(60_000, 5_000 * 3 ** Math.min(this.retryAttempt - 1, 3));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (runId === this.runId && this.accountId) void this.run();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
