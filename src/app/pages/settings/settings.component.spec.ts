import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthSessionService } from '../../auth/auth-session.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { BackupService } from '../../services/backup.service';
import { TranslationService } from '../../services/translation.service';
import { SettingsComponent } from './settings.component';

describe('SettingsComponent account data status', () => {
  let fixture: ComponentFixture<SettingsComponent>;
  let migration: jasmine.SpyObj<LocalToCloudMigrationService>;
  const status = signal<'synced' | 'attention' | 'syncing'>('synced');
  const attention = signal(0);
  const authenticated = signal(true);
  const reconnecting = signal(false);
  const currentUser = signal<{ id: string; email: string } | null>({ id: 'account-a', email: 'athlete@example.com' });

  beforeEach(async () => {
    status.set('synced');
    attention.set(0);
    authenticated.set(true);
    reconnecting.set(false);
    currentUser.set({ id: 'account-a', email: 'athlete@example.com' });
    migration = jasmine.createSpyObj<LocalToCloudMigrationService>('LocalToCloudMigrationService', [
      'unresolvedReferences', 'searchExercises', 'chooseCatalogExercise', 'chooseCustomExercise',
    ]);
    migration.unresolvedReferences.and.resolveTo([]);
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: {
          isAuthenticated: authenticated, isReconnecting: reconnecting,
          currentUser, logout: () => Promise.resolve(),
        } },
        { provide: AccountSyncService, useValue: {
          status, completed: signal(3), total: signal(3), attention, retryNow: jasmine.createSpy('retryNow'),
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
    expect(text).toContain('Todo lo compatible está sincronizado');
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

  it('renders real synchronization progress immediately', async () => {
    status.set('syncing');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sincronizando ejercicios · 3/3');
    expect(fixture.nativeElement.querySelector('.syncing')).not.toBeNull();
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
