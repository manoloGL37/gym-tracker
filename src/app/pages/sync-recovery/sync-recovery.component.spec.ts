import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AuthSessionService } from '../../auth/auth-session.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { SyncRecoveryComponent } from './sync-recovery.component';
import { snapshotPayload } from '../../migration/workout-snapshot';

describe('Self-service sync recovery', () => {
  let fixture: ComponentFixture<SyncRecoveryComponent>;
  let page: SyncRecoveryComponent;
  let migration: jasmine.SpyObj<LocalToCloudMigrationService>;
  let backup: Awaited<ReturnType<LocalToCloudMigrationService['exportRecoveryBackup']>>;
  const user = signal({ id: 'synthetic-account', email: 'synthetic@example.test' });

  beforeEach(async () => {
    user.set({ id: 'synthetic-account', email: 'synthetic@example.test' });
    backup = { app: 'gym-tracker-sync-recovery', schemaVersion: 1, exportedAt: '2026-01-01T00:00:00Z', stores: {
      workoutHistory: ['missing', 'existing', 'different', 'unknown'].map(id => ({ id, routineId: 'deleted', routineName: 'Synthetic snapshot', startedAt: '2026-01-01T10:00:00.123Z', finishedAt: '2026-01-01T10:02:00.456Z', exercises: [{ exerciseId: 'deleted', name: 'Historical press', sets: [{ setIndex: 0, reps: 8, weight: 22.75 }, { setIndex: 1, reps: null, weight: null }] }] })),
      routines: [], migrationLedgers: [{ accountId: user().id, status: 'completed-local-only', postponed: false, createdAt: '', updatedAt: '', defaults: { targetReps: 10, restSeconds: 90 }, exercises: {}, routines: {}, sets: {}, workouts: Object.fromEntries(['missing', 'existing', 'different', 'unknown'].map(id => [id, { clientId: crypto.randomUUID(), status: 'unsupported' as const }])) }],
    } };
    migration = jasmine.createSpyObj('Migration', ['exportRecoveryBackup', 'inspectRecovery', 'prepareRecovery', 'recoverPreparedWorkout']);
    migration.exportRecoveryBackup.and.callFake(async () => structuredClone(backup));
    migration.inspectRecovery.and.resolveTo(['B', 'A', 'C', 'D'].map((classification, i) => ({ localId: backup.stores.workoutHistory[i].id, classification, reason: 'Synthetic review' } as any)));
    migration.prepareRecovery.and.resolveTo(); migration.recoverPreparedWorkout.and.resolveTo();
    await TestBed.configureTestingModule({ imports: [SyncRecoveryComponent], providers: [
      provideRouter([]),
      { provide: AuthSessionService, useValue: { currentUser: user, isAuthenticated: () => true } },
      { provide: AccountSyncService, useValue: { pauseForRecovery: async () => undefined, resumeAfterRecovery: () => undefined } },
      { provide: LocalToCloudMigrationService, useValue: migration },
    ] }).compileComponents();
    fixture = TestBed.createComponent(SyncRecoveryComponent); page = fixture.componentInstance;
    fixture.detectChanges(); await fixture.whenStable();
    spyOn(HTMLAnchorElement.prototype, 'click');
    spyOn(URL, 'createObjectURL').and.returnValue('blob:synthetic');
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  async function savedCopy() {
    await page.downloadBackup();
    const blob = (URL.createObjectURL as jasmine.Spy).calls.mostRecent().args[0] as Blob;
    const file = new File([await blob.text()], 'synthetic-backup.json');
    await page.verifyBackup({ target: { files: [file], value: '' } } as unknown as Event);
    page.zone = 'Europe/Madrid'; page.zoneConfirmed = true;
  }

  it('does not reconcile or recover on entry or backup download', async () => {
    await page.downloadBackup();
    expect(migration.inspectRecovery).not.toHaveBeenCalled();
    expect(migration.prepareRecovery).not.toHaveBeenCalled();
    expect(migration.recoverPreparedWorkout).not.toHaveBeenCalled();
    expect(page.backupVerified()).toBeFalse();
  });

  it('rejects an incomplete/wrong file and requires explicit zone confirmation', async () => {
    await page.downloadBackup();
    await page.verifyBackup({ target: { files: [new File(['{}'], 'wrong.json')], value: '' } } as unknown as Event);
    expect(page.backupVerified()).toBeFalse();
    await savedCopy(); page.zoneConfirmed = false;
    await page.review();
    expect(migration.inspectRecovery).not.toHaveBeenCalled();
    expect(page.canReview()).toBeFalse();
    page.zoneConfirmed = true; fixture.detectChanges(); await fixture.whenStable();
    const from = fixture.nativeElement.querySelector('input[type="date"]') as HTMLInputElement;
    from.value = '2026-01-01'; from.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges(); await fixture.whenStable();
    expect(page.zoneConfirmed).toBeFalse(); // Confirmation covers the chosen period, not future date changes.
  });

  it('reviews read-only and uploads only a selected B after separate confirmation', async () => {
    await savedCopy(); await page.review();
    expect(page.groups.map(group => page.count(group.kind))).toEqual([1, 1, 1, 1]);
    expect(page.selected()).toEqual(['missing']);
    await page.recover(); expect(migration.recoverPreparedWorkout).not.toHaveBeenCalled();
    page.confirm.set(true); await page.recover();
    expect(migration.prepareRecovery).toHaveBeenCalledOnceWith(user().id, 'missing', 'Europe/Madrid', { backupsVerified: true, historicalZoneConfirmed: true });
    expect(migration.recoverPreparedWorkout).toHaveBeenCalledOnceWith(user().id, 'missing', { backupsVerified: true, historicalZoneConfirmed: true, replayApproved: true });
    expect(page.processed()).toBe(1); expect(page.count('A')).toBe(2);
    fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Gym Tracker Android');
  });

  it('does not send after the account or backed-up history changes', async () => {
    await savedCopy(); await page.review();
    backup.stores.workoutHistory[0].exercises[0].sets[0].weight = 99;
    page.confirm.set(true); await page.recover();
    expect(migration.recoverPreparedWorkout).not.toHaveBeenCalled();
    expect(page.error()).toContain('cambió');
    user.set({ id: 'another-account', email: 'another@example.test' });
    fixture.detectChanges(); await fixture.whenStable();
    expect(page.backupVerified()).toBeFalse(); expect(page.rows()).toEqual([]);
  });

  it('stops after an interrupted request and demands fresh reconciliation', async () => {
    await savedCopy(); await page.review();
    migration.recoverPreparedWorkout.and.rejectWith(new Error('Synthetic lost response'));
    page.confirm.set(true); await page.recover();
    expect(page.rows()).toEqual([]); expect(page.processed()).toBe(0);
    expect(page.message()).toContain('puede haberse guardado');
    expect(migration.recoverPreparedWorkout).toHaveBeenCalledTimes(1);
    // No retry on visibility/login/entry; a new review is an explicit user action.
  });

  it('can stop a batch after the current workout without preparing the next', async () => {
    await savedCopy();
    migration.inspectRecovery.and.resolveTo([{ localId: 'missing', classification: 'B', reason: '' }, { localId: 'existing', classification: 'B', reason: '' }]);
    await page.review();
    migration.recoverPreparedWorkout.and.callFake(async () => { page.stopped.set(true); });
    page.confirm.set(true); await page.recover();
    expect(migration.recoverPreparedWorkout).toHaveBeenCalledTimes(1);
    expect(migration.prepareRecovery).toHaveBeenCalledTimes(1);
    expect(page.processed()).toBe(1); expect(page.selected()).toEqual(['existing']);
  });

  it('offers explicit link confirmation for an interrupted recovery found already remote', async () => {
    const ledger = backup.stores.migrationLedgers[0];
    ledger.workouts['missing'].snapshotMode = 'recovery';
    ledger.workouts['missing'].snapshotPayload = snapshotPayload(backup.stores.workoutHistory[0], ledger.workouts['missing'], ledger, 'Europe/Madrid');
    await savedCopy();
    migration.inspectRecovery.and.resolveTo([{ localId: 'missing', classification: 'A', reason: 'Confirmed' }]);
    await page.review();
    expect(page.rows()[0].confirmOnly).toBeTrue(); expect(page.selected()).toEqual(['missing']);
    page.confirm.set(true); await page.recover();
    expect(migration.prepareRecovery).not.toHaveBeenCalled();
    expect(migration.recoverPreparedWorkout).toHaveBeenCalledTimes(1);
  });
});
