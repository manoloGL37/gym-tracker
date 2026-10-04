import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthSessionService } from '../../auth/auth-session.service';
import { AccountSyncService, AccountSyncStatus } from '../../migration/account-sync.service';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { BackupService } from '../../services/backup.service';
import { TranslationService } from '../../services/translation.service';
import { SettingsComponent } from './settings.component';

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
