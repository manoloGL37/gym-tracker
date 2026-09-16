import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthSessionService } from '../../auth/auth-session.service';
import { ActiveTrainingRepository, CloudActiveTrainingRepository } from '../../data/active-training.repository';
import { BodyWeightRepository } from '../../data/body-weight.repository';
import { AccountSyncService } from '../../migration/account-sync.service';
import { StatisticsApiService } from '../../statistics/statistics-api.service';
import { TranslationService } from '../../services/translation.service';
import { HomeComponent } from './home.component';
import { LocalFirstReadService, WorkoutReadItem } from '../../data/local-first-read.service';

describe('HomeComponent unified workout count', () => {
  let fixture: ComponentFixture<HomeComponent>;
  const syncStatus = signal<'syncing' | 'synced'>('syncing');
  const pendingWorkouts = signal(2);
  let pending: any[];
  let serverCount: number;
  let reads: jasmine.SpyObj<LocalFirstReadService>;
  let statisticsApi: jasmine.SpyObj<StatisticsApiService>;

  beforeEach(async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 8, 10, 12));
    const local = ['a', 'b', 'c'].map((id, index) => {
      const day = String(8 + index).padStart(2, '0');
      return ({
      id, routineId: 'local-routine', routineName: 'Fuerza',
      startedAt: `2026-09-${day}T10:00:00`, finishedAt: `2026-09-${day}T11:00:00`, exercises: [],
      });
    });
    pending = local.slice(1);
    serverCount = 1;
    spyOn(ActiveTrainingRepository, 'get').and.resolveTo(undefined);
    spyOn(CloudActiveTrainingRepository, 'get').and.resolveTo(undefined);
    spyOn(BodyWeightRepository, 'getAll').and.resolveTo([]);
    reads = jasmine.createSpyObj<LocalFirstReadService>('LocalFirstReadService', ['workoutSnapshot', 'routineSnapshot', 'refreshWorkouts', 'refreshRoutines']);
    const localItems = (): WorkoutReadItem[] => local.map(workout => ({ source: 'local', id: workout.id, routineName: workout.routineName, startedAt: workout.startedAt, finishedAt: workout.finishedAt, exerciseCount: 0, local: workout, serverRepresented: workout.id === 'a' }));
    reads.workoutSnapshot.and.callFake(async () => ({ items: localItems(), remoteState: 'refreshing', pageNumber: 0, totalPages: 1 }));
    reads.routineSnapshot.and.resolveTo({ items: [], remoteState: 'refreshing', pageNumber: 0, totalPages: 0 });
    reads.refreshRoutines.and.resolveTo({ items: [], remoteState: 'confirmed', pageNumber: 0, totalPages: 0 });
    reads.refreshWorkouts.and.callFake(async () => {
      const cloudItems: WorkoutReadItem[] = local.slice(0, serverCount).map(workout => ({ source: 'cloud', id: `server-${workout.id}`, routineName: workout.routineName, startedAt: workout.startedAt, finishedAt: workout.finishedAt, exerciseCount: 0 }));
      const pendingItems = pending.map(workout => ({ source: 'local' as const, id: workout.id, routineName: workout.routineName, startedAt: workout.startedAt, finishedAt: workout.finishedAt, exerciseCount: 0, local: workout, serverRepresented: false }));
      return { items: [...pendingItems, ...cloudItems], remoteState: 'confirmed' as const, pageNumber: 0, totalPages: 1 };
    });
    statisticsApi = jasmine.createSpyObj<StatisticsApiService>('StatisticsApiService', ['summary']);
    statisticsApi.summary.and.callFake(() => of({ from: '2026-09-07', to: '2026-09-13', workouts: serverCount, sets: 0, reps: 0, volume: 0, maxWeight: 0 }));

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { isAuthenticated: signal(true), currentUser: signal({ id: 'account-a' }) } },
        { provide: AccountSyncService, useValue: { status: syncStatus, pendingWorkouts } },
        { provide: LocalFirstReadService, useValue: reads },
        { provide: StatisticsApiService, useValue: statisticsApi },
        { provide: TranslationService, useValue: { lang: signal('es') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    TestBed.resetTestingModule();
  });

  it('keeps the exact 3-local/1-server scenario at three before and after synchronization', async () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.weekWorkoutCount).toBe(3);
    expect(fixture.componentInstance.loading).toBeFalse();
    expect(fixture.nativeElement.textContent).not.toContain('Cargando tu espacio de entrenamiento');
    expect(fixture.componentInstance.workoutSyncText()).toBe('Sincronizando entrenamientos...');

    pending = [];
    serverCount = 3;
    pendingWorkouts.set(0);
    syncStatus.set('synced');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.weekWorkoutCount).toBe(3);
    expect(fixture.componentInstance.workoutSyncText()).toBeNull();
  });

  it('renders the known dashboard while remote refresh remains pending', async () => {
    let releaseWorkouts!: (value: any) => void;
    let releaseRoutines!: (value: any) => void;
    reads.refreshWorkouts.and.returnValue(new Promise(resolve => releaseWorkouts = resolve));
    reads.refreshRoutines.and.returnValue(new Promise(resolve => releaseRoutines = resolve));
    const load = (fixture.componentInstance as any).loadDashboard();
    await load;
    fixture.detectChanges();
    expect(fixture.componentInstance.loading).toBeFalse();
    expect(fixture.componentInstance.weekWorkoutCount).toBe(3);
    expect(fixture.nativeElement.textContent).not.toContain('Cargando tu espacio de entrenamiento');
    releaseWorkouts({ items: [], remoteState: 'confirmed', pageNumber: 0, totalPages: 0 });
    releaseRoutines({ items: [], remoteState: 'confirmed', pageNumber: 0, totalPages: 0 });
  });

  it('keeps local Home data visible after a 503', async () => {
    reads.refreshWorkouts.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    reads.refreshRoutines.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    statisticsApi.summary.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await (fixture.componentInstance as any).loadDashboard();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.componentInstance.weekWorkoutCount).toBe(3);
    expect(fixture.componentInstance.lastWorkout).not.toBeNull();
  });
});
