import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountSyncService } from './account-sync.service';
import { LocalToCloudMigrationService } from './local-to-cloud-migration.service';
import { SyncDiagnosticsService } from './sync-diagnostics.service';

describe('AccountSyncService', () => {
  let service: AccountSyncService;
  let migration: jasmine.SpyObj<LocalToCloudMigrationService>;

  beforeEach(() => {
    jasmine.clock().install();
    migration = jasmine.createSpyObj<LocalToCloudMigrationService>('LocalToCloudMigrationService', ['synchronizeAccount', 'getProgress']);
    Object.assign(migration, { changes: signal(0) });
    migration.synchronizeAccount.and.resolveTo({} as any);
    migration.getProgress.and.resolveTo({ completed: 3, total: 3, pending: 0, pendingWorkouts: 0, attention: 0 });
    TestBed.configureTestingModule({ providers: [
      AccountSyncService,
      { provide: LocalToCloudMigrationService, useValue: migration },
    ] });
    service = TestBed.inject(AccountSyncService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    jasmine.clock().uninstall();
    TestBed.resetTestingModule();
  });

  it('starts in the background and exposes only confirmed progress', async () => {
    let release!: () => void;
    migration.synchronizeAccount.and.returnValue(new Promise<void>(resolve => release = resolve) as any);

    service.start('account-a');

    expect(service.status()).toBe('syncing');
    expect(migration.synchronizeAccount).toHaveBeenCalledOnceWith('account-a');
    await flushPromises();
    expect(service.status()).toBe('syncing'); // An empty local queue is not remote confirmation.
    release();
    await flushPromises();
    expect(service.completed()).toBe(3);
    expect(service.total()).toBe(3);
    expect(service.status()).toBe('synced');
  });

  it('settles 404 confirmed resources after a ledger-triggered progress read', async () => {
    let release!: () => void;
    migration.synchronizeAccount.and.returnValue(new Promise<void>(resolve => release = resolve) as any);
    migration.getProgress.and.returnValue(Promise.resolve({ completed: 404, total: 404, pending: 0, pendingWorkouts: 0, attention: 0 }));

    service.start('account-a');
    release();
    (migration.changes as any).update((value: number) => value + 1);
    TestBed.flushEffects();
    await flushPromises();

    expect(service.state()).toEqual(jasmine.objectContaining({ completed: 404, total: 404, pending: 0, attention: 0 }));
    expect(service.status()).toBe('synced');
  });

  it('shows existing progress immediately while exercise synchronization is running', async () => {
    let release!: () => void;
    migration.getProgress.and.resolveTo({ completed: 1, total: 3, pending: 2, pendingWorkouts: 1, attention: 0 });
    migration.synchronizeAccount.and.returnValue(new Promise<void>(resolve => release = resolve) as any);

    service.start('account-a');
    await Promise.resolve();
    await Promise.resolve();

    expect(service.status()).toBe('syncing');
    expect(service.completed()).toBe(1);
    expect(service.total()).toBe(3);
    release();
  });

  it('updates global progress after each confirmed ledger change', async () => {
    let release!: () => void;
    migration.getProgress.and.returnValues(
      Promise.resolve({ completed: 1, total: 3, pending: 2, pendingWorkouts: 1, attention: 0 }),
      Promise.resolve({ completed: 2, total: 3, pending: 1, pendingWorkouts: 1, attention: 0 }),
    );
    migration.synchronizeAccount.and.returnValue(new Promise<void>(resolve => release = resolve) as any);

    service.start('account-a');
    await flushPromises();
    (migration.changes as any).update((value: number) => value + 1);
    TestBed.flushEffects();
    await flushPromises();

    expect(service.state()).toEqual(jasmine.objectContaining({ completed: 2, total: 3, pending: 1, remaining: 1 }));
    release();
  });

  it('keeps a temporary failure pending and retries with bounded backoff', async () => {
    migration.synchronizeAccount.and.rejectWith(new Error('offline'));
    service.start('account-a');
    await flushPromises();
    expect(service.status()).toBe('waiting');

    migration.synchronizeAccount.and.resolveTo({} as any);
    jasmine.clock().tick(5_000);
    await flushPromises();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(2);
  });

  it('stops automatic retry timers after five failed passes and resumes on a connectivity hint', async () => {
    migration.synchronizeAccount.and.rejectWith(new Error('cold start'));
    service.start('account-a'); await flushPromises();
    for (const delay of [5_000, 15_000, 45_000, 60_000]) {
      jasmine.clock().tick(delay); await flushPromises();
    }
    jasmine.clock().tick(600_000); await flushPromises();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(5);
    expect(service.status()).toBe('waiting');
    migration.synchronizeAccount.and.resolveTo({} as any);
    window.dispatchEvent(new Event('online')); await flushPromises();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(6);
    expect(service.status()).toBe('synced');
    expect(TestBed.inject(SyncDiagnosticsService).events().some(value => value.operation === 'complete' && value.result === 'success')).toBeTrue();
  });

  it('does not mark blocked or failed resources as synchronized', async () => {
    migration.getProgress.and.resolveTo({ completed: 404, total: 404, pending: 0, pendingWorkouts: 1, attention: 1 });

    service.start('account-a');
    await flushPromises();

    expect(service.status()).toBe('attention');
    expect(service.pending()).toBe(0);
    expect(service.attention()).toBe(1);
  });

  it('stops work on logout without deleting persisted migration state', () => {
    service.start('account-a');
    service.stop();
    expect(service.status()).toBe('idle');
    expect(service.total()).toBe(0);
  });

  it('does not start periodic recovery work when the last progress was fully synced', async () => {
    service.start('account-a');
    await Promise.resolve();
    await Promise.resolve();
    service.resumePendingSync();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(1);
  });

  it('does not start a duplicate run when foreground recovery happens during a sync', () => {
    let release!: () => void;
    migration.synchronizeAccount.and.returnValue(new Promise<void>(resolve => release = resolve) as any);
    service.start('account-a');
    service.resumePendingSync();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(1);
    release();
  });

  it('ignores progress that arrives from a previous account run', async () => {
    let releaseFirst!: () => void;
    migration.synchronizeAccount.and.callFake((accountId: string) => accountId === 'account-a'
      ? new Promise<void>(resolve => releaseFirst = resolve)
      : Promise.resolve({} as any),
    );

    service.start('account-a');
    service.start('account-b');
    await flushPromises();
    releaseFirst();
    await flushPromises();

    expect(service.status()).toBe('synced');
    expect(migration.synchronizeAccount).toHaveBeenCalledWith('account-b');
  });

  it('starts a new pass when a local workout completes after a clean sync', async () => {
    service.start('account-a');
    await flushPromises();

    service.notifyPendingWork();

    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(2);
  });

  it('shows waiting after a failed local progress read instead of hanging or claiming success', async () => {
    migration.getProgress.and.rejectWith(new Error('IndexedDB unavailable'));
    service.start('account-a'); await flushPromises();
    expect(service.status()).toBe('waiting');
    expect(TestBed.inject(SyncDiagnosticsService).events().some(value => value.operation === 'retry' && value.source === 'automatic')).toBeTrue();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(1);
  });

  it('drains one pass before handling a workout completed during reconciliation', async () => {
    let release!: () => void;
    migration.synchronizeAccount.and.returnValue(new Promise(resolve => release = () => resolve({} as any)));
    service.start('account-a');
    service.notifyPendingWork();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(1);
    migration.synchronizeAccount.and.resolveTo({} as any);
    release(); await flushPromises();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(2);
  });

  it('resumes known pending work after connectivity recovery', async () => {
    migration.getProgress.and.resolveTo({ completed: 1, total: 2, pending: 1, pendingWorkouts: 1, attention: 0 });
    service.start('account-a');
    await flushPromises();

    window.dispatchEvent(new Event('online'));

    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(2);
  });

  it('drains normal sync and blocks login/online retries while recovery is open', async () => {
    let release!: () => void;
    migration.synchronizeAccount.and.returnValue(new Promise(resolve => release = () => resolve({} as any)));
    service.start('account-a');
    let paused = false;
    const pause = service.pauseForRecovery().then(() => paused = true);
    await flushPromises(); expect(paused).toBeFalse();
    service.start('account-a'); service.retryNow(); service.notifyPendingWork();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(1);
    release(); await pause; expect(paused).toBeTrue();
    service.retryNow(); service.resumePendingSync();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(1);
    migration.synchronizeAccount.and.resolveTo({} as any);
    service.resumeAfterRecovery();
    expect(migration.synchronizeAccount).toHaveBeenCalledTimes(2);
  });
});

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}
