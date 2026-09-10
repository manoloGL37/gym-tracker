import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { StatisticsApiService } from './statistics-api.service';

describe('StatisticsApiService', () => {
  let service: StatisticsApiService;
  let requests: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(StatisticsApiService);
    requests = TestBed.inject(HttpTestingController);
  });
  afterEach(() => requests.verify());

  it('uses the exact documented inclusive LocalDate query values', () => {
    service.summary({ from: '2026-09-07', to: '2026-09-13' }).subscribe();
    let request = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/statistics/summary?from=2026-09-07&to=2026-09-13');
    expect(request.request.method).toBe('GET');
    request.flush(summary('2026-09-07', '2026-09-13'));

    service.comparison({ currentFrom: '2026-09-07', currentTo: '2026-09-13', previousFrom: '2026-08-31', previousTo: '2026-09-06' }).subscribe();
    const comparison = requests.expectOne(request => request.url === 'https://gym-tracker-api-s70k.onrender.com/api/statistics/comparison');
    expect(comparison.request.method).toBe('GET');
    expect(comparison.request.params.keys().sort()).toEqual(['currentFrom', 'currentTo', 'previousFrom', 'previousTo']);
    expect(comparison.request.params.get('currentFrom')).toBe('2026-09-07');
    expect(comparison.request.params.get('previousTo')).toBe('2026-09-06');
    comparison.flush({ current: summary('2026-09-07', '2026-09-13'), previous: summary('2026-08-31', '2026-09-06'), changes: { workouts: 0, sets: 0, reps: 0, volume: 0, maxWeight: 0 } });

    service.evolution({ from: '2026-09-07', to: '2026-09-13' }).subscribe();
    request = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/statistics/evolution?from=2026-09-07&to=2026-09-13');
    expect(request.request.method).toBe('GET');
    request.flush({ from: '2026-09-07', to: '2026-09-13', data: [] });

    service.exercise('e11e1111-1111-4111-8111-111111111111', { from: '2026-09-07', to: '2026-09-13' }).subscribe();
    const exercise = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/statistics/exercises/e11e1111-1111-4111-8111-111111111111?from=2026-09-07&to=2026-09-13');
    expect(exercise.request.method).toBe('GET');
    exercise.flush({ exerciseId: 'e11e1111-1111-4111-8111-111111111111', from: '2026-09-07', to: '2026-09-13', totalSets: 0, totalReps: 0, totalVolume: 0, maxWeight: 0, evolution: [] });
  });
});

function summary(from: string, to: string) {
  return { from, to, workouts: 0, sets: 0, reps: 0, volume: 0, maxWeight: 0 };
}
