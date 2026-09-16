import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthSessionService } from '../../auth/auth-session.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { TranslationService } from '../../services/translation.service';
import { CalendarComponent } from './calendar.component';
import { LocalFirstReadService, WorkoutReadItem } from '../../data/local-first-read.service';

describe('CalendarComponent unified history', () => {
  let fixture: ComponentFixture<CalendarComponent>;
  let reads: jasmine.SpyObj<LocalFirstReadService>;

  beforeEach(async () => {
    const local = (id: string, name: string, day: string): WorkoutReadItem => ({ source: 'local', id, routineName: name, startedAt: `${day}T10:00:00`, finishedAt: `${day}T11:00:00`, exerciseCount: 0, local: { id, routineId: 'routine', routineName: name, startedAt: `${day}T10:00:00`, finishedAt: `${day}T11:00:00`, exercises: [] } });
    const snapshot = [local('pending', 'Movilidad', '2026-09-02'), local('already-synced', 'Fuerza', '2026-09-01')];
    const refreshed = [snapshot[0], { source: 'cloud' as const, id: 'server-copy', routineName: 'Fuerza', startedAt: '2026-09-01T10:00:00', finishedAt: '2026-09-01T11:00:00', exerciseCount: 0 }];
    reads = jasmine.createSpyObj<LocalFirstReadService>('LocalFirstReadService', ['workoutSnapshot', 'refreshWorkouts']);
    reads.workoutSnapshot.and.resolveTo({ items: snapshot, remoteState: 'refreshing', pageNumber: 0, totalPages: 1 });
    reads.refreshWorkouts.and.resolveTo({ items: refreshed, remoteState: 'confirmed', pageNumber: 0, totalPages: 1 });
    await TestBed.configureTestingModule({
      imports: [CalendarComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { isAuthenticated: signal(true), currentUser: signal({ id: 'account-a' }) } },
        { provide: AccountSyncService, useValue: { status: signal('synced') } },
        { provide: LocalFirstReadService, useValue: reads },
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
    reads.refreshWorkouts.and.rejectWith(new Error('sleeping'));
    await fixture.componentInstance.loadWorkouts();
    expect(fixture.componentInstance.workouts.map(workout => workout.id)).toEqual(['pending', 'already-synced']);
    expect(fixture.componentInstance.cloudError).not.toBeNull();
    expect(fixture.componentInstance.loading).toBeFalse();
  });

  it('keeps pending local history interactive while remote refresh is pending', async () => {
    let release!: (value: any) => void;
    reads.refreshWorkouts.and.returnValue(new Promise(resolve => release = resolve));
    const load = fixture.componentInstance.loadWorkouts();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.componentInstance.loading).toBeFalse();
    expect(fixture.componentInstance.workouts.map(workout => workout.id)).toContain('pending');
    expect(fixture.nativeElement.textContent).toContain('Movilidad');
    release({ items: fixture.componentInstance.workouts, remoteState: 'confirmed', pageNumber: 0, totalPages: 1 });
    await load;
  });
});
