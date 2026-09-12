import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { Observable, of, throwError } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { ExerciseResponse } from '../../exercises/exercise-api.models';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { TranslationService } from '../../services/translation.service';
import { StatisticsApiService } from '../../statistics/statistics-api.service';
import { StatsComponent, toCalendarDate } from './stats.component';

const local: WorkoutHistory = {
  id: 'local-workout',
  routineId: 'local-routine',
  routineName: 'Local',
  startedAt: '2026-09-08T10:00:00',
  finishedAt: '2026-09-08T11:00:00',
  exercises: [{
    exerciseId: 'free-text-id',
    name: 'Press local',
    sets: [
      { setIndex: 0, reps: 8, weight: 50 },
      { setIndex: 1, reps: 6, weight: 55 },
    ],
  }],
};

const exerciseId = 'e11e1111-1111-4111-8111-111111111111';
const catalogExercise: ExerciseResponse = {
  id: exerciseId,
  clientId: null,
  source: 'EXERCISES_DATASET',
  sourceId: 'bench-press',
  editable: false,
  deletable: false,
  category: 'strength',
  equipment: 'barbell',
  targetMuscle: 'chest',
  muscleGroup: 'chest',
  secondaryMuscles: [],
  translations: [{ language: 'es', name: 'Press de banca', instructions: null }],
  aliases: [],
};

describe('StatsComponent', () => {
  let fixture: ComponentFixture<StatsComponent>;
  let component: StatsComponent;
  let authenticated: ReturnType<typeof signal<boolean>>;
  let currentUser: ReturnType<typeof signal<{ id: string } | null>>;
  let api: jasmine.SpyObj<StatisticsApiService>;
  let exercisesApi: jasmine.SpyObj<ExerciseApiService>;
  let migration: jasmine.SpyObj<LocalToCloudMigrationService>;

  async function create(isAuthenticated: boolean, pendingWorkoutCount = 0): Promise<void> {
    authenticated = signal(isAuthenticated);
    currentUser = signal(isAuthenticated ? { id: 'account-id' } : null);
    api = jasmine.createSpyObj<StatisticsApiService>('StatisticsApiService', ['summary', 'comparison', 'evolution', 'exercise']);
    api.comparison.and.returnValue(of({
      current: summary(2, 1600, 8, 64),
      previous: summary(1, 800, 5, 40),
      changes: { workouts: 100, sets: 60, reps: 60, volume: 100, maxWeight: 5 },
    }));
    api.evolution.and.returnValue(of({
      from: '2026-09-07',
      to: '2026-09-13',
      data: [{ date: '2026-09-08', workouts: 2, sets: 8, reps: 64, volume: 1600, maxWeight: 80 }],
    }));
    api.exercise.and.returnValue(of({
      exerciseId,
      from: '2026-09-07',
      to: '2026-09-13',
      totalSets: 4,
      totalReps: 32,
      totalVolume: 2400,
      maxWeight: 85,
      evolution: [{ date: '2026-09-08', volume: 2400, maxWeight: 85 }],
    }));
    exercisesApi = jasmine.createSpyObj<ExerciseApiService>('ExerciseApiService', ['list']);
    exercisesApi.list.and.returnValue(of({ content: [catalogExercise], page: 0, size: 8, totalElements: 1, totalPages: 1 }));
    migration = jasmine.createSpyObj<LocalToCloudMigrationService>('LocalToCloudMigrationService', ['isWorkoutMigrated']);
    migration.isWorkoutMigrated.and.resolveTo(false);
    spyOn(WorkoutHistoryRepository, 'getAll').and.resolveTo([local]);

    await TestBed.configureTestingModule({
      imports: [StatsComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { isAuthenticated: authenticated, currentUser } },
        { provide: StatisticsApiService, useValue: api },
        { provide: ExerciseApiService, useValue: exercisesApi },
        { provide: LocalToCloudMigrationService, useValue: migration },
        { provide: AccountSyncService, useValue: { status: signal(pendingWorkoutCount ? 'waiting' : 'synced'), pendingWorkouts: signal(pendingWorkoutCount) } },
        { provide: TranslationService, useValue: { t: (key: string) => key, lang: signal('es') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(StatsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 8, 10, 12));
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    TestBed.resetTestingModule();
  });

  it('uses guest statistics and calculates only real stored sets, reps and volume', async () => {
    await create(false);
    expect(component.source()).toBe('local');
    expect(component.currentStats()).toEqual(jasmine.objectContaining({
      workoutCount: 1,
      totalSets: 2,
      totalReps: 14,
      totalVolume: 730,
    }));
    expect(component.currentStats().dailyDistribution.map(point => point.date)).toEqual(['2026-09-08']);
    expect(api.comparison).not.toHaveBeenCalled();
  });

  it('automatically uses account aggregates without adding legacy totals', async () => {
    await create(true);
    expect(component.source()).toBe('cloud');
    expect(component.currentStats().workoutCount).toBe(2);
    expect(component.currentStats().totalVolume).toBe(1600);
    expect(component.currentStats().totalVolume).not.toBe(2330);
    expect(api.comparison).toHaveBeenCalledTimes(1);
  });

  it('warns that account statistics are still updating while workouts are pending', async () => {
    await create(true, 2);
    fixture.detectChanges();
    expect((fixture.nativeElement.textContent as string)).toContain('Sincronizando entrenamientos');
    expect(component.currentStats().workoutCount).toBe(2);
  });

  it('maps backend evolution directly into the volume chart without artificial missing dates', async () => {
    await create(true);
    expect(component.currentStats().dailyDistribution.length).toBe(1);
    expect(component.evolutionChartData().labels).toEqual(['mar']);
    expect(component.evolutionChartData().datasets[0].data).toEqual([1600]);
  });

  it('requests complete week boundaries and groups real daily evolution into weekly volume', async () => {
    await create(true);
    api.evolution.and.returnValue(of({
      from: '2026-08-31',
      to: '2026-09-13',
      data: [
        { date: '2026-09-01', workouts: 1, sets: 4, reps: 32, volume: 800, maxWeight: 60 },
        { date: '2026-09-03', workouts: 1, sets: 5, reps: 40, volume: 1000, maxWeight: 65 },
        { date: '2026-09-08', workouts: 1, sets: 6, reps: 48, volume: 1200, maxWeight: 70 },
      ],
    }));
    component.weekFrom = '2026-W36';
    component.weekTo = '2026-W37';
    await component.applyWeeklyRange();
    expect(api.evolution).toHaveBeenCalledWith({ from: '2026-08-31', to: '2026-09-13' });
    expect(component.weeklyProgress().map(point => point.volume)).toEqual([1800, 1200]);
    expect(component.weeklyChartData().datasets[0].data).toEqual([1800, 1200]);
  });

  it('uses comparison percentages returned by the backend without assigning positive semantics', async () => {
    await create(true);
    expect(component.comparisonFor('workouts')).toBe(100);
    expect(component.comparisonFor('sets')).toBe(60);
    expect(component.previousMetric('volume')).toBe(800);
  });

  it('changes weekly/monthly ranges using inclusive local calendar dates', async () => {
    await create(true);
    await component.setPeriod('month');
    expect(component.selectedPeriod()).toBe('month');
    expect(api.comparison).toHaveBeenCalledWith({
      currentFrom: '2026-09-01',
      currentTo: '2026-09-30',
      previousFrom: '2026-08-01',
      previousTo: '2026-08-31',
    });
    expect(api.evolution).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('commits only the latest period response when a slower earlier request finishes last', async () => {
    await create(true);
    const comparisons: Array<(value: ReturnType<typeof comparisonResponse>) => void> = [];
    const evolutions: Array<(value: ReturnType<typeof evolutionResponse>) => void> = [];
    api.comparison.and.callFake(() => new Observable(observer => { comparisons.push(value => { observer.next(value); observer.complete(); }); }));
    api.evolution.and.callFake(() => new Observable(observer => { evolutions.push(value => { observer.next(value); observer.complete(); }); }));

    const month = component.setPeriod('month');
    const week = component.setPeriod('week');
    expect(api.comparison.calls.count()).toBe(3);

    comparisons[1](comparisonResponse(7, 700));
    evolutions[1](evolutionResponse(7, 700));
    await week;
    expect(component.currentStats().workoutCount).toBe(7);
    expect(component.confirmedPeriod()).toBe('week');

    comparisons[0](comparisonResponse(31, 3100));
    evolutions[0](evolutionResponse(31, 3100));
    await month;
    expect(component.currentStats().workoutCount).toBe(7);
    expect(component.evolutionChartData().datasets[0].data).toEqual([700]);
  });

  it('captures the applied week interval, even if form controls change before selecting an exercise', async () => {
    await create(true);
    component.weekFrom = '2026-W36';
    component.weekTo = '2026-W37';
    await component.applyWeeklyRange();
    component.weekFrom = '2026-W38';
    component.weekTo = '2026-W38';
    await component.searchExercises();
    await component.selectExercise(exerciseId);
    expect(api.exercise).toHaveBeenCalledWith(exerciseId, { from: '2026-08-31', to: '2026-09-13' });
  });

  it('does not let an older exercise response replace the last selected exercise', async () => {
    await create(true);
    const secondExerciseId = 'e22e2222-2222-4222-8222-222222222222';
    component.exerciseResults.set([catalogExercise, { ...catalogExercise, id: secondExerciseId }]);
    const responses: Array<(value: ReturnType<typeof exerciseResponse>) => void> = [];
    api.exercise.and.callFake(() => new Observable(observer => { responses.push(value => { observer.next(value); observer.complete(); }); }));

    const first = component.selectExercise(exerciseId);
    const second = component.selectExercise(secondExerciseId);
    responses[1](exerciseResponse(secondExerciseId, 2200));
    await second;
    responses[0](exerciseResponse(exerciseId, 1100));
    await first;

    expect(component.selectedExerciseId).toBe(secondExerciseId);
    expect(component.exerciseStats()?.exerciseId).toBe(secondExerciseId);
    expect(component.exerciseChartData().datasets[0].data).toEqual([2200]);
  });

  it('treats successful zero aggregates as empty data, not an error', async () => {
    await create(true);
    api.comparison.and.returnValue(of({
      current: summary(0, 0),
      previous: summary(0, 0),
      changes: { workouts: 0, sets: 0, reps: 0, volume: 0, maxWeight: 0 },
    }));
    api.evolution.and.returnValue(of({ from: '2026-09-07', to: '2026-09-13', data: [] }));
    await component.loadStats();
    expect(component.currentStats().workoutCount).toBe(0);
    expect(component.currentStats().dailyDistribution).toEqual([]);
    expect(component.error()).toBeNull();
  });

  it('keeps account statistics authoritative after a temporary API error and removes the source switch', async () => {
    await create(true);
    api.comparison.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    await component.loadStats();
    expect(component.error()).toBe('stats.cloudError');
    fixture.detectChanges();
    expect(component.source()).toBe('cloud');
    expect(component.currentStats().workoutCount).toBe(2);
    expect(fixture.debugElement.query(By.css('.source-switch'))).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('stats.viewLocal');
  });

  it('shows extended waiting without losing the selected period or confirmed statistics', async () => {
    await create(true);
    let release!: () => void;
    api.comparison.and.returnValue(new Observable(observer => {
      release = () => { observer.next({
        current: summary(2, 1600, 8, 64), previous: summary(1, 800, 5, 40),
        changes: { workouts: 100, sets: 60, reps: 60, volume: 100, maxWeight: 5 },
      }); observer.complete(); };
    }));
    const load = component.loadStats();
    expect(component.loading()).toBeTrue();
    jasmine.clock().tick(6_000);
    expect(component.statsRequest.waitingForServer()).toBeTrue();
    expect(component.selectedPeriod()).toBe('week');
    expect(component.currentStats().workoutCount).toBe(2);
    release();
    await load;
    expect(component.loading()).toBeFalse();
    expect(component.statsRequest.waitingForServer()).toBeFalse();
  });

  it('searches the backend catalog and looks up exercise statistics by UUID and current range', async () => {
    await create(true);
    component.exerciseSearch = 'Press';
    await component.searchExercises();
    await component.selectExercise(exerciseId);
    expect(exercisesApi.list).toHaveBeenCalledWith({ page: 0, size: 8, search: 'Press' });
    expect(api.exercise).toHaveBeenCalledWith(exerciseId, { from: '2026-07-20', to: '2026-09-13' });
    expect(component.selectedExercise()?.id).toBe(exerciseId);
    expect(component.exerciseChartData().datasets.map(dataset => dataset.data)).toEqual([[2400], [85]]);
    fixture.detectChanges();
    await fixture.whenStable();
    const canvas = fixture.debugElement.query(By.css('.chart-wrap--exercise canvas'));
    expect(canvas).not.toBeNull();
    expect(canvas.injector.get(BaseChartDirective).chart).toBeDefined();
  });

  it('keeps an empty exercise response as a successful no-data state', async () => {
    await create(true);
    api.exercise.and.returnValue(of({
      exerciseId,
      from: '2026-09-07',
      to: '2026-09-13',
      totalSets: 0,
      totalReps: 0,
      totalVolume: 0,
      maxWeight: 0,
      evolution: [],
    }));
    await component.searchExercises();
    await component.selectExercise(exerciseId);
    expect(component.exerciseStats()?.evolution).toEqual([]);
    expect(component.exerciseStatsError()).toBeNull();
  });

  it('formats query dates without UTC conversion', () => {
    expect(toCalendarDate(new Date(2026, 8, 7, 0, 30))).toBe('2026-09-07');
  });
});

function summary(workouts: number, volume: number, sets = 0, reps = 0) {
  return { from: '2026-09-07', to: '2026-09-13', workouts, sets, reps, volume, maxWeight: 0 };
}

function comparisonResponse(workouts: number, volume: number) {
  return {
    current: summary(workouts, volume),
    previous: summary(0, 0),
    changes: { workouts: 0, sets: 0, reps: 0, volume: 0, maxWeight: 0 },
  };
}

function evolutionResponse(workouts: number, volume: number) {
  return {
    from: '2026-09-07',
    to: '2026-09-13',
    data: [{ date: '2026-09-08', workouts, sets: 1, reps: 1, volume, maxWeight: volume }],
  };
}

function exerciseResponse(id: string, volume: number) {
  return {
    exerciseId: id,
    from: '2026-07-20',
    to: '2026-09-13',
    totalSets: 1,
    totalReps: 1,
    totalVolume: volume,
    maxWeight: volume,
    evolution: [{ date: '2026-09-08', volume, maxWeight: volume }],
  };
}
