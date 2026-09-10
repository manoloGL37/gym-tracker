import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { TranslationService } from '../../services/translation.service';
import { StatisticsApiService } from '../../statistics/statistics-api.service';
import { StatsComponent } from './stats.component';

const local: WorkoutHistory = {
  id: 'local-workout', routineId: 'local-routine', routineName: 'Local', startedAt: '2026-09-08T10:00:00', finishedAt: '2026-09-08T11:00:00',
  exercises: [{ exerciseId: 'free-text-id', name: 'Press local', sets: [{ setIndex: 0, reps: 8, weight: 50 }] }],
};

describe('StatsComponent local/cloud boundary', () => {
  let fixture: ComponentFixture<StatsComponent>;
  let component: StatsComponent;
  let authenticated: ReturnType<typeof signal<boolean>>;
  let api: jasmine.SpyObj<StatisticsApiService>;

  async function create(isAuthenticated: boolean): Promise<void> {
    authenticated = signal(isAuthenticated);
    api = jasmine.createSpyObj<StatisticsApiService>('StatisticsApiService', ['summary', 'comparison', 'evolution', 'exercise']);
    api.comparison.and.returnValue(of({ current: summary(2, 1600), previous: summary(1, 800), changes: { workouts: 100, sets: 0, reps: 0, volume: 100, maxWeight: 0 } }));
    api.evolution.and.returnValue(of({ from: '2026-09-07', to: '2026-09-13', data: [] }));
    spyOn(WorkoutHistoryRepository, 'getAll').and.resolveTo([local]);
    await TestBed.configureTestingModule({
      imports: [StatsComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { isAuthenticated: authenticated } },
        { provide: StatisticsApiService, useValue: api },
        { provide: TranslationService, useValue: { t: (key: string) => key } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(StatsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('keeps guests on Dexie statistics and does not call cloud endpoints', async () => {
    await create(false);
    expect(component.source()).toBe('local');
    expect(component.currentStats().totalVolume).toBe(50 * 8);
    expect(api.comparison).not.toHaveBeenCalled();
  });

  it('uses cloud aggregates without adding legacy local totals', async () => {
    await create(true);
    expect(component.source()).toBe('cloud');
    expect(component.currentStats().workoutCount).toBe(2);
    expect(component.currentStats().totalVolume).toBe(1600);
    expect(api.comparison).toHaveBeenCalled();
  });

  it('refreshes cloud aggregates from the backend after a completed cloud workout', async () => {
    await create(true);
    api.comparison.and.returnValue(of({ current: summary(3, 2000), previous: summary(1, 800), changes: { workouts: 200, sets: 0, reps: 0, volume: 150, maxWeight: 0 } }));
    await component.loadStats();
    expect(component.currentStats().workoutCount).toBe(3);
    expect(component.currentStats().totalVolume).toBe(2000);
  });

  it('treats a successful zero aggregate as empty data, not an error', async () => {
    await create(true);
    api.comparison.and.returnValue(of({ current: summary(0, 0), previous: summary(0, 0), changes: { workouts: 0, sets: 0, reps: 0, volume: 0, maxWeight: 0 } }));
    await component.loadStats();
    expect(component.currentStats().workoutCount).toBe(0);
    expect(component.error()).toBeNull();
  });

  it('keeps local statistics selectable after a cloud failure and on logout', async () => {
    await create(true);
    api.comparison.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    await component.loadStats();
    expect(component.error()).not.toBeNull();
    await component.setSource('local');
    expect(component.currentStats().totalVolume).toBe(400);
    authenticated.set(false);
    await fixture.whenStable();
    expect(component.source()).toBe('local');
  });
});

function summary(workouts: number, volume: number) {
  return { from: '2026-09-07', to: '2026-09-13', workouts, sets: 0, reps: 0, volume, maxWeight: 0 };
}
