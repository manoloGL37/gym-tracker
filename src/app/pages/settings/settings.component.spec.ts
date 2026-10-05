import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthSessionService } from '../../auth/auth-session.service';
import { AccountSyncService, AccountSyncStatus } from '../../migration/account-sync.service';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { BackupService } from '../../services/backup.service';
import { TranslationService } from '../../services/translation.service';
import { SettingsComponent } from './settings.component';
import { SyncDiagnosticsService } from '../../migration/sync-diagnostics.service';

describe('SettingsComponent account data status', () => {
  let fixture: ComponentFixture<SettingsComponent>;
  let migration: jasmine.SpyObj<LocalToCloudMigrationService>;
  const status = signal<AccountSyncStatus>('synced');
  const attention = signal(0);
  const completed = signal(3);
  const total = signal(3);
  const pending = signal(0);
  const authenticated = signal(true);
  const reconnecting = signal(false);
  const currentUser = signal<{ id: string; email: string } | null>({ id: 'account-a', email: 'athlete@example.com' });

  beforeEach(async () => {
    status.set('synced');
    attention.set(0);
    completed.set(3);
    total.set(3);
    pending.set(0);
    authenticated.set(true);
    reconnecting.set(false);
    currentUser.set({ id: 'account-a', email: 'athlete@example.com' });
    migration = jasmine.createSpyObj<LocalToCloudMigrationService>('LocalToCloudMigrationService', [
      'unresolvedReferences', 'searchExercises', 'chooseCatalogExercise', 'chooseCustomExercise', 'historicalZoneNeeds', 'getWorkoutMappings', 'getAccountLocalWorkouts', 'confirmHistoricalZone', 'resetAutomaticRetries',
    ]);
    migration.unresolvedReferences.and.resolveTo([]);
    migration.historicalZoneNeeds.and.resolveTo([]);
    migration.getWorkoutMappings.and.resolveTo({});
    migration.getAccountLocalWorkouts.and.resolveTo([]);
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: {
          isAuthenticated: authenticated, isReconnecting: reconnecting,
          currentUser, logout: () => Promise.resolve(),
        } },
        { provide: AccountSyncService, useValue: {
          status, completed, total, pending, attention, retryNow: jasmine.createSpy('retryNow'),
          state: () => ({ status: status(), completed: completed(), total: total(), pending: pending(), remaining: total() - completed(), attention: attention() }),
        } },
        { provide: LocalToCloudMigrationService, useValue: migration },
        { provide: BackupService, useValue: {} },
        { provide: TranslationService, useValue: { lang: signal('es'), setLang: () => undefined, t: (key: string) => key } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SettingsComponent);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows automatic sync status without optional migration controls', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Tus datos');
    expect(fixture.nativeElement.querySelector('.backup-section a[href="/settings/sync-recovery"]')?.textContent).toContain('Copia y revisión manual opcionales');
    expect(text).toContain('Tus datos están sincronizados');
    expect(text).not.toContain('Guardar datos en tu cuenta');
    expect(text).not.toContain('Ahora no');
  });

  it('keeps diagnostics collapsed and clearing them does not touch sync or stored data', async () => {
    fixture.detectChanges(); await fixture.whenStable();
    const diagnostics = TestBed.inject(SyncDiagnosticsService);
    diagnostics.record({ category: 'reference', operation: 'resolve', result: 'attention', reason: 'unresolved-reference' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sync-diagnostics').open).toBeFalse();
    expect(fixture.nativeElement.querySelector('.diagnostic-feed').textContent).toContain('referencia de ejercicio sin resolver');
    fixture.componentInstance.clearDiagnostics();
    expect(diagnostics.events().length).toBe(0);
    expect(migration.resetAutomaticRetries).not.toHaveBeenCalled();
    expect(TestBed.inject(AccountSyncService).retryNow).not.toHaveBeenCalled();
  });

  it('copies only sanitized diagnostics with live counts, excluding the account email', async () => {
    fixture.detectChanges(); await fixture.whenStable();
    const diagnostics = TestBed.inject(SyncDiagnosticsService);
    diagnostics.record({ category: 'workout', operation: 'create', result: 'success' });
    const copy = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    await fixture.componentInstance.copyDiagnostics();
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.calls.mostRecent().args[0]).toContain('Confirmados/total: 3/3');
    expect(copy.calls.mostRecent().args[0]).not.toContain('athlete@example.com');
    expect(fixture.componentInstance.diagnosticCopyMessage()).toBe('Diagnóstico copiado.');
  });

  it('explains a clipboard failure without copying error details or altering sync', async () => {
    spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('secret clipboard context'));
    await fixture.componentInstance.copyDiagnostics();
    expect(fixture.componentInstance.diagnosticCopyMessage()).toContain('No se pudo copiar');
    expect(fixture.componentInstance.diagnosticCopyMessage()).not.toContain('secret');
    expect(TestBed.inject(AccountSyncService).retryNow).not.toHaveBeenCalled();
  });

  it('observes the existing manual Retry action without adding another retry or reset', async () => {
    await fixture.componentInstance.retrySync();
    expect(migration.resetAutomaticRetries).toHaveBeenCalledOnceWith('account-a');
    expect(TestBed.inject(AccountSyncService).retryNow).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(SyncDiagnosticsService).events().filter(value => value.source === 'manual').length).toBe(1);
  });

  it('shows a focused exercise task only when intervention is required', async () => {
    status.set('attention'); attention.set(1);
    migration.unresolvedReferences.and.resolveTo([{ key: 'exercise:legacy', name: 'Press' }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('1 elemento necesita tu atención');
    expect(text).toContain('Necesitamos identificar estos ejercicios');
  });

  it('confirms only the selected historical period without files or a recovery wizard', async () => {
    const workouts = ['2025-01-01', '2025-06-01'].map((date, index) => ({ id: String(index), startedAt: date + 'T10:00:00Z' } as any));
    migration.historicalZoneNeeds.and.resolveTo(workouts);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    fixture.componentInstance.historicalZone = 'Europe/Madrid';
    fixture.componentInstance.historicalFrom = '2025-05-01';
    await fixture.componentInstance.confirmZone();
    expect(migration.confirmHistoricalZone).toHaveBeenCalledOnceWith('account-a', 'Europe/Madrid', ['1']);
    expect(fixture.nativeElement.querySelector('.sync-section input[type="file"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.sync-section a[href="/settings/sync-recovery"]')).toBeNull();
  });

  it('renders real synchronization progress immediately', async () => {
    status.set('syncing');
    completed.set(3); total.set(5); pending.set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sincronizando · 3 de 5');
    expect(fixture.nativeElement.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('60');
    expect(fixture.nativeElement.querySelector('.syncing')).not.toBeNull();
  });

  it('updates its open view when shared progress changes without a reload', async () => {
    status.set('syncing'); completed.set(1); total.set(3); pending.set(2);
    fixture.detectChanges();
    await fixture.whenStable();

    completed.set(2); pending.set(1);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Sincronizando · 2 de 3');
    expect(fixture.nativeElement.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('67');
  });

  it('transitions its open view from complete progress to the confirmed state without a reload', async () => {
    status.set('syncing'); completed.set(404); total.set(404); pending.set(0);
    fixture.detectChanges();
    await fixture.whenStable();

    status.set('synced');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Tus datos están sincronizados');
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('does not present a full progress bar as success when attention is required', async () => {
    status.set('attention'); attention.set(1); completed.set(404); total.set(404); pending.set(0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('1 elemento necesita tu atención');
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('shows reconnecting state instead of guest actions while restoration is pending', async () => {
    authenticated.set(false);
    reconnecting.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Reconectando tu cuenta…');
    expect(text).toContain('athlete@example.com');
    expect(text).not.toContain('Iniciar sesión');
    expect(text).not.toContain('Crear cuenta');
  });
});
