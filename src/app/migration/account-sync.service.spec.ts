import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountSyncService } from './account-sync.service';
import { LocalToCloudMigrationService } from './local-to-cloud-migration.service';

describe('AccountSyncService', () => {
  let service: AccountSyncService;
  let migration: jasmine.SpyObj<LocalToCloudMigrationService>;

  beforeEach(() => {
    jasmine.clock().install();
    migration = jasmine.createSpyObj<LocalToCloudMigrationService>('LocalToCloudMigrationService', ['start', 'getProgress']);
    Object.assign(migration, { changes: signal(0) });
    migration.start.and.resolveTo({} as any);
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
    migration.start.and.returnValue(new Promise<void>(resolve => release = resolve) as any);

    service.start('account-a');

    expect(service.status()).toBe('syncing');
    expect(migration.start).toHaveBeenCalledOnceWith('account-a');
    release();
    await flushPromises();
    expect(service.completed()).toBe(3);
    expect(service.total()).toBe(3);
    expect(service.status()).toBe('synced');
  });

  it('settles 404 confirmed resources after a ledger-triggered progress read', async () => {
    let release!: () => void;
    migration.start.and.returnValue(new Promise<void>(resolve => release = resolve) as any);
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
    migration.start.and.returnValue(new Promise<void>(resolve => release = resolve) as any);

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
    migration.start.and.returnValue(new Promise<void>(resolve => release = resolve) as any);

    service.start('account-a');
    await flushPromises();
    (migration.changes as any).update((value: number) => value + 1);
    TestBed.flushEffects();
    await flushPromises();

    expect(service.state()).toEqual(jasmine.objectContaining({ completed: 2, total: 3, pending: 1, remaining: 1 }));
    release();
  });

  it('keeps a temporary failure pending and retries with bounded backoff', async () => {
    migration.start.and.rejectWith(new Error('offline'));
    service.start('account-a');
    await Promise.resolve();
    await Promise.resolve();
    expect(service.status()).toBe('waiting');

    migration.start.and.resolveTo({} as any);
    jasmine.clock().tick(5_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(migration.start).toHaveBeenCalledTimes(2);
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
    expect(migration.start).toHaveBeenCalledTimes(1);
  });

  it('does not start a duplicate run when foreground recovery happens during a sync', () => {
    let release!: () => void;
    migration.start.and.returnValue(new Promise<void>(resolve => release = resolve) as any);
    service.start('account-a');
    service.resumePendingSync();
    expect(migration.start).toHaveBeenCalledTimes(1);
    release();
  });

  it('ignores progress that arrives from a previous account run', async () => {
    let releaseFirst!: () => void;
    migration.start.and.callFake((accountId: string) => accountId === 'account-a'
      ? new Promise<void>(resolve => releaseFirst = resolve)
      : Promise.resolve({} as any),
    );

    service.start('account-a');
    service.start('account-b');
    await flushPromises();
    releaseFirst();
    await flushPromises();

    expect(service.status()).toBe('synced');
    expect(migration.start).toHaveBeenCalledWith('account-b');
  });

  it('starts a new pass when a local workout completes after a clean sync', async () => {
    service.start('account-a');
    await flushPromises();

    service.notifyPendingWork();

    expect(migration.start).toHaveBeenCalledTimes(2);
  });

  it('resumes known pending work after connectivity recovery', async () => {
    migration.getProgress.and.resolveTo({ completed: 1, total: 2, pending: 1, pendingWorkouts: 1, attention: 0 });
    service.start('account-a');
    await flushPromises();

    window.dispatchEvent(new Event('online'));

    expect(migration.start).toHaveBeenCalledTimes(2);
  });
});

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}
