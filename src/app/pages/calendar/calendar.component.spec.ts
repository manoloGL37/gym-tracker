import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { WorkoutHistoryRepository } from '../../data/active-training.repository';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { RoutineApiService } from '../../routines/routine-api.service';
import { TranslationService } from '../../services/translation.service';
import { WorkoutApiService } from '../../workouts/workout-api.service';
import { CalendarComponent } from './calendar.component';

describe('CalendarComponent unified history', () => {
  let fixture: ComponentFixture<CalendarComponent>;
  let workoutsApi: jasmine.SpyObj<WorkoutApiService>;

  beforeEach(async () => {
    spyOn(WorkoutHistoryRepository, 'getAll').and.resolveTo([
      { id: 'already-synced', routineId: 'r1', routineName: 'Fuerza', startedAt: '2026-09-01T10:00:00', finishedAt: '2026-09-01T11:00:00', exercises: [] },
      { id: 'pending', routineId: 'r2', routineName: 'Movilidad', startedAt: '2026-09-02T10:00:00', finishedAt: '2026-09-02T11:00:00', exercises: [] },
    ]);
    const migration = jasmine.createSpyObj<LocalToCloudMigrationService>('LocalToCloudMigrationService', ['getPendingLocalWorkouts', 'getAccountLocalWorkouts']);
    migration.getPendingLocalWorkouts.and.resolveTo([
      { id: 'pending', routineId: 'r2', routineName: 'Movilidad', startedAt: '2026-09-02T10:00:00', finishedAt: '2026-09-02T11:00:00', exercises: [] },
    ]);
    migration.getAccountLocalWorkouts.and.resolveTo(await WorkoutHistoryRepository.getAll());
    workoutsApi = jasmine.createSpyObj<WorkoutApiService>('WorkoutApiService', ['list']);
    workoutsApi.list.and.returnValue(of({ content: [{ id: 'server-copy', routineId: 'server-routine', startedAt: '2026-09-01T10:00:00', completedAt: '2026-09-01T11:00:00', exercises: [] }], number: 0, totalPages: 1 } as any));
    const routines = jasmine.createSpyObj<RoutineApiService>('RoutineApiService', ['get']);
    routines.get.and.returnValue(of({ name: 'Fuerza' } as any));
    await TestBed.configureTestingModule({
      imports: [CalendarComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { isAuthenticated: signal(true), currentUser: signal({ id: 'account-a' }) } },
        { provide: LocalToCloudMigrationService, useValue: migration },
        { provide: AccountSyncService, useValue: { status: signal('synced') } },
        { provide: WorkoutApiService, useValue: workoutsApi },
        { provide: RoutineApiService, useValue: routines },
        { provide: TranslationService, useValue: { t: (key: string) => key } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CalendarComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows a synchronized workout once and exposes no persistence labels', () => {
    const component = fixture.componentInstance;
    expect(component.workouts.map(workout => workout.id)).toEqual(['pending', 'server-copy']);
    const text = (fixture.nativeElement.textContent as string).toLowerCase();
    expect(text).not.toContain('local');
    expect(text).not.toContain('cloud');
    expect(text).not.toContain('dispositivo');
    expect(text).not.toContain('en tu cuenta');
  });

  it('keeps account-owned local history visible while the backend is unavailable', async () => {
    workoutsApi.list.and.returnValue(throwError(() => new Error('sleeping')));
    await fixture.componentInstance.loadWorkouts();
    expect(fixture.componentInstance.workouts.map(workout => workout.id)).toEqual(['already-synced', 'pending']);
    expect(fixture.componentInstance.cloudError).not.toBeNull();
  });
});
