import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { ActiveTrainingRepository, CloudActiveTrainingRepository, RoutinesRepository, WorkoutHistoryRepository } from '../../data/active-training.repository';
import { BodyWeightRepository } from '../../data/body-weight.repository';
import { AccountSyncService } from '../../migration/account-sync.service';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { RoutineApiService } from '../../routines/routine-api.service';
import { StatisticsApiService } from '../../statistics/statistics-api.service';
import { TranslationService } from '../../services/translation.service';
import { WorkoutApiService } from '../../workouts/workout-api.service';
import { HomeComponent } from './home.component';

describe('HomeComponent unified workout count', () => {
  let fixture: ComponentFixture<HomeComponent>;
  const syncStatus = signal<'syncing' | 'synced'>('syncing');
  const pendingWorkouts = signal(2);
  let pending: any[];
  let serverCount: number;

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
    spyOn(WorkoutHistoryRepository, 'getAll').and.resolveTo(local);
    spyOn(ActiveTrainingRepository, 'get').and.resolveTo(undefined);
    spyOn(CloudActiveTrainingRepository, 'get').and.resolveTo(undefined);
    spyOn(BodyWeightRepository, 'getAll').and.resolveTo([]);
    spyOn(RoutinesRepository, 'getAll').and.resolveTo([]);

    const migration = jasmine.createSpyObj<LocalToCloudMigrationService>('LocalToCloudMigrationService', ['getPendingLocalWorkouts', 'getAccountLocalWorkouts', 'isRoutineMigrated']);
    migration.getPendingLocalWorkouts.and.callFake(async () => pending);
    migration.getAccountLocalWorkouts.and.resolveTo(local);
    const workoutApi = jasmine.createSpyObj<WorkoutApiService>('WorkoutApiService', ['list']);
    workoutApi.list.and.callFake(() => of({ content: [{ id: 'server-a', routineId: null, startedAt: '2026-09-08T10:00:00', completedAt: '2026-09-08T11:00:00', exercises: [] }], number: 0, totalPages: 1 } as any));
    const routineApi = jasmine.createSpyObj<RoutineApiService>('RoutineApiService', ['list', 'get']);
    routineApi.list.and.returnValue(of({ content: [] } as any));
    const statisticsApi = jasmine.createSpyObj<StatisticsApiService>('StatisticsApiService', ['summary']);
    statisticsApi.summary.and.callFake(() => of({ from: '2026-09-07', to: '2026-09-13', workouts: serverCount, sets: 0, reps: 0, volume: 0, maxWeight: 0 }));

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { isAuthenticated: signal(true), currentUser: signal({ id: 'account-a' }) } },
        { provide: LocalToCloudMigrationService, useValue: migration },
        { provide: AccountSyncService, useValue: { status: syncStatus, pendingWorkouts } },
        { provide: WorkoutApiService, useValue: workoutApi },
        { provide: RoutineApiService, useValue: routineApi },
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
    expect(fixture.componentInstance.weekWorkoutCount).toBe(3);
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
});
