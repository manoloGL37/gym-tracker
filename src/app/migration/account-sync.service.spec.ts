import { TestBed } from '@angular/core/testing';
import { AccountSyncService } from './account-sync.service';
import { LocalToCloudMigrationService } from './local-to-cloud-migration.service';

describe('AccountSyncService', () => {
  let service: AccountSyncService;
  let migration: jasmine.SpyObj<LocalToCloudMigrationService>;

  beforeEach(() => {
    jasmine.clock().install();
    migration = jasmine.createSpyObj<LocalToCloudMigrationService>('LocalToCloudMigrationService', ['start', 'getProgress']);
    migration.start.and.resolveTo({} as any);
    migration.getProgress.and.resolveTo({ completed: 3, total: 3, pending: 0, attention: 0 });
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
    await Promise.resolve();
    await Promise.resolve();
    expect(service.completed()).toBe(3);
    expect(service.total()).toBe(3);
    expect(service.status()).toBe('synced');
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

  it('stops work on logout without deleting persisted migration state', () => {
    service.start('account-a');
    service.stop();
    expect(service.status()).toBe('idle');
    expect(service.total()).toBe(0);
  });
});
