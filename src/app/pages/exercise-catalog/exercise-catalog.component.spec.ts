import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { AuthInitializationStatus, UserResponse } from '../../auth/auth.models';
import { AuthSessionService } from '../../auth/auth-session.service';
import { AccountReadCacheRepository } from '../../data/active-training.repository';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { ExercisePageResponse, ExerciseResponse } from '../../exercises/exercise-api.models';
import { TranslationService } from '../../services/translation.service';
import { ExerciseCatalogComponent } from './exercise-catalog.component';

const accountA: UserResponse = { id: 'account-a', email: 'a@example.com', createdAt: '2026-09-01T10:00:00' };
const accountB: UserResponse = { id: 'account-b', email: 'b@example.com', createdAt: '2026-09-02T10:00:00' };

describe('ExerciseCatalogComponent', () => {
  let fixture: ComponentFixture<ExerciseCatalogComponent>;
  let api: jasmine.SpyObj<ExerciseApiService>;
  let initializationStatus: ReturnType<typeof signal<AuthInitializationStatus>>;
  let currentUser: ReturnType<typeof signal<UserResponse | null>>;
  let retryInitialization: jasmine.Spy<() => Promise<void>>;
  let getCache: jasmine.Spy;

  beforeEach(async () => {
    initializationStatus = signal<AuthInitializationStatus>('restoring');
    currentUser = signal<UserResponse | null>(accountA);
    retryInitialization = jasmine.createSpy('retryInitialization').and.resolveTo();
    api = jasmine.createSpyObj<ExerciseApiService>('ExerciseApiService', [
      'list', 'getFilterOptions', 'get', 'create', 'update', 'delete',
    ]);
    api.list.and.returnValue(of(page([exercise('remote', 'Sentadilla')])));
    api.getFilterOptions.and.returnValue(of({ categories: [], equipment: [], muscleGroups: [], targetMuscles: [] }));
    getCache = spyOn(AccountReadCacheRepository, 'getExercises').and.resolveTo(undefined);
    spyOn(AccountReadCacheRepository, 'saveExercises').and.resolveTo('cache-key');

    await TestBed.configureTestingModule({
      imports: [ExerciseCatalogComponent],
      providers: [
        { provide: ExerciseApiService, useValue: api },
        provideRouter([]),
        {
          provide: AuthSessionService,
          useValue: {
            initializationStatus,
            currentUser,
            isAuthenticated: computed(() => initializationStatus() === 'authenticated'),
            isGuest: computed(() => initializationStatus() === 'guest'),
            isReconnecting: computed(() => initializationStatus() === 'restoring' || initializationStatus() === 'unreachable'),
            retryInitialization,
          },
        },
        { provide: TranslationService, useValue: { lang: signal<'en' | 'es'>('es') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ExerciseCatalogComponent);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows session restoration instead of login-required UI', async () => {
    await render();
    expect(text()).toContain('Recuperando tu catálogo');
    expect(text()).not.toContain('requiere una cuenta');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('loads the catalog automatically after delayed restoration succeeds', async () => {
    const response = new Subject<ExercisePageResponse>();
    api.list.and.returnValue(response);
    await render();
    initializationStatus.set('authenticated');
    fixture.detectChanges();
    await flushEffects();
    expect(api.list).toHaveBeenCalled();
    response.next(page([exercise('fresh', 'Peso muerto')]));
    response.complete();
    await render();
    expect(text()).toContain('Peso muerto');
  });

  it('keeps a transient backend error distinct from an empty catalog', async () => {
    initializationStatus.set('authenticated');
    api.list.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await render();
    expect(text()).toContain('No se pudo contactar con el catálogo');
    expect(text()).not.toContain('Ningún ejercicio coincide');
    expect(text()).not.toContain('requiere una cuenta');
  });

  it('shows login-required UI only for a definitive guest state', async () => {
    currentUser.set(null);
    initializationStatus.set('guest');
    await render();
    expect(text()).toContain('requiere una cuenta');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('renders same-account cached exercises during restoration', async () => {
    getCache.and.resolveTo({ accountId: accountA.id, key: 'a', page: page([exercise('cached-a', 'Press guardado')]), updatedAt: '2026-09-23T10:00:00Z' });
    await render();
    expect(text()).toContain('Press guardado');
    expect(text()).toContain('mostrando el catálogo guardado');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('shows a recoverable offline state when no cache exists', async () => {
    initializationStatus.set('unreachable');
    await render();
    expect(text()).toContain('temporalmente sin conexión');
    expect(text()).toContain('Reintentar conexión');
    expect(fixture.nativeElement.querySelector('.catalog-reconnecting')?.getAttribute('aria-busy')).toBe('false');
  });

  it('does not expose the previous account cache while switching accounts', async () => {
    getCache.and.callFake(async (accountId: string) => accountId === accountA.id
      ? { accountId, key: 'a', page: page([exercise('cached-a', 'Privado A')]), updatedAt: '2026-09-23T10:00:00Z' }
      : { accountId, key: 'b', page: page([exercise('cached-b', 'Privado B')]), updatedAt: '2026-09-23T10:00:00Z' });
    await render();
    expect(text()).toContain('Privado A');
    currentUser.set(accountB);
    fixture.detectChanges();
    expect(text()).not.toContain('Privado A');
    await render();
    expect(text()).toContain('Privado B');
  });

  it('revalidates cached data automatically after reconnection', async () => {
    initializationStatus.set('unreachable');
    getCache.and.resolveTo({ accountId: accountA.id, key: 'a', page: page([exercise('cached', 'Versión guardada')]), updatedAt: '2026-09-23T10:00:00Z' });
    api.list.and.returnValue(of(page([exercise('fresh', 'Versión actualizada')])));
    await render();
    expect(text()).toContain('Versión guardada');
    initializationStatus.set('authenticated');
    await render();
    expect(text()).toContain('Versión actualizada');
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('shows an empty result only after a confirmed empty response', async () => {
    initializationStatus.set('authenticated');
    api.list.and.returnValue(of(page([])));
    await render();
    expect(text()).toContain('Ningún ejercicio coincide');
    expect(text()).not.toContain('No se pudo contactar');
  });

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function flushEffects(): Promise<void> {
    await Promise.resolve();
    fixture.detectChanges();
  }

  function text(): string { return fixture.nativeElement.textContent as string; }
});

function exercise(id: string, name: string): ExerciseResponse {
  return {
    id, clientId: null, source: 'EXERCISES_DATASET', sourceId: id, editable: false, deletable: false,
    category: 'Fuerza', equipment: null, targetMuscle: null, muscleGroup: 'Pierna', secondaryMuscles: null,
    translations: [{ language: 'es', name, instructions: null }], aliases: [],
  };
}

function page(content: ExerciseResponse[]): ExercisePageResponse {
  return { content, page: 0, size: 20, totalElements: content.length, totalPages: content.length ? 1 : 0 };
}
