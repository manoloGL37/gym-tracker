import { Component, inject, computed, effect } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslationService } from '../../services/translation.service';
import { Router, RouterLink } from '@angular/router';
import { ActiveTrainingRepository, CloudActiveTrainingRepository, RoutinesRepository, Routine, WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { ActiveTraining } from '../training/training.model';
import { BodyWeightRepository } from '../../data/body-weight.repository';
import { BodyWeightEntry } from '../../data/body-weight.model';
import { CloudActiveTraining } from '../../workouts/workout-domain';
import { AuthSessionService } from '../../auth/auth-session.service';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { RoutineApiService } from '../../routines/routine-api.service';
import { WorkoutApiService } from '../../workouts/workout-api.service';
import { StatisticsApiService } from '../../statistics/statistics-api.service';
import { firstValueFrom } from 'rxjs';

interface HomeWorkout {
  id: string;
  routineName: string;
  finishedAt: string;
  exerciseCount: number;
  accountBacked: boolean;
}

interface HomeRoutine {
  id: string;
  name: string;
  exerciseCount: number | null;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent {
  t = inject(TranslationService);
  lastWorkout: HomeWorkout | null = null;
  activeTraining: ActiveTraining | CloudActiveTraining | null = null;
  weekWorkoutCount = 0;
  weekVolume = 0;
  latestWeight: BodyWeightEntry | null = null;
  routineShortcuts: HomeRoutine[] = [];
  loading = true;
  readonly today = new Date();
  private readonly auth = inject(AuthSessionService);
  private readonly migration = inject(LocalToCloudMigrationService);
  private readonly accountSync = inject(AccountSyncService);
  private readonly routineApi = inject(RoutineApiService);
  private readonly workoutApi = inject(WorkoutApiService);
  private readonly statisticsApi = inject(StatisticsApiService);

  // Signal for formatted date, recalculated on language change
  formattedDate = computed(() => {
    const lang = this.t.lang();
    const locale = lang === 'es' ? 'es-ES' : 'en-US';
    // Example: Tuesday, Jan 30 (en-US), martes, 30 de enero (es-ES)
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(this.today);
  });

  constructor(private router: Router) {
    effect(() => {
      this.auth.isAuthenticated();
      this.auth.currentUser?.();
      this.accountSync.status();
      void this.loadDashboard();
    });
  }

  private async loadDashboard(): Promise<void> {
    this.loading = true;
    const [workouts, activeTraining, cloudActiveTraining, weightEntries, routines] = await Promise.all([
      WorkoutHistoryRepository.getAll(),
      ActiveTrainingRepository.get().then(training => training ?? null),
      CloudActiveTrainingRepository.get().then(training => training ?? null),
      BodyWeightRepository.getAll(),
      RoutinesRepository.getAll(),
    ]);

    const accountId = this.auth.currentUser?.()?.id;
    const migrated = accountId ? await Promise.all(workouts.map(workout => this.migration.isWorkoutMigrated(accountId, workout.id))) : workouts.map(() => false);
    this.activeTraining = activeTraining ?? cloudActiveTraining;
    this.latestWeight = weightEntries[0] ?? null;
    if (!accountId) {
      this.useStoredDashboard(workouts, routines);
      this.loading = false;
      return;
    }

    try {
      const range = this.currentWeekRange();
      const [summary, accountWorkouts, accountRoutines] = await Promise.all([
        firstValueFrom(this.statisticsApi.summary(range)),
        firstValueFrom(this.workoutApi.list({ page: 0, size: 1 })),
        firstValueFrom(this.routineApi.list({ page: 0, size: 3 })),
      ]);
      this.weekWorkoutCount = summary.workouts;
      this.weekVolume = summary.volume;
      const latest = accountWorkouts.content[0];
      let routineName = 'Rutina sin nombre';
      if (latest?.routineId) {
        try { routineName = (await firstValueFrom(this.routineApi.get(latest.routineId))).name; } catch { /* The workout remains readable. */ }
      }
      this.lastWorkout = latest ? {
        id: latest.id,
        routineName,
        finishedAt: latest.completedAt ?? latest.startedAt,
        exerciseCount: latest.exercises.length,
        accountBacked: true,
      } : null;
      const visibleStored = routines.filter((_, index) => !migrated[index]).map(routine => this.homeRoutine(routine));
      this.routineShortcuts = [
        ...accountRoutines.content.map(routine => ({ id: routine.id, name: routine.name, exerciseCount: null })),
        ...visibleStored,
      ].slice(0, 3);
      this.loading = false;
    } catch {
      // A temporary account failure is not an empty dashboard.
      this.useStoredDashboard(workouts, routines);
      this.loading = false;
    }
  }

  startTraining() {
    this.router.navigate([this.activeTraining ? '/training' : '/select-routine']);
  }

  addWorkout() {
    this.router.navigate(['/add-workout']);
  }

  private getCurrentWeekWorkouts(workouts: WorkoutHistory[]): WorkoutHistory[] {
    const start = new Date();
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return workouts.filter(workout => {
      const finishedAt = new Date(workout.finishedAt);
      return finishedAt >= start && finishedAt <= end;
    });
  }

  private currentWeekRange(): { from: string; to: string } {
    const start = new Date();
    const day = start.getDay();
    start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const date = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    return { from: date(start), to: date(end) };
  }

  private useStoredDashboard(workouts: WorkoutHistory[], routines: Routine[]): void {
    const currentWeek = this.getCurrentWeekWorkouts(workouts);
    const latest = workouts[0];
    this.lastWorkout = latest ? { id: latest.id, routineName: latest.routineName, finishedAt: latest.finishedAt, exerciseCount: latest.exercises.length, accountBacked: false } : null;
    this.weekWorkoutCount = currentWeek.length;
    this.weekVolume = currentWeek.reduce((sum, workout) => sum + this.calculateWorkoutVolume(workout), 0);
    this.routineShortcuts = routines.slice(0, 3).map(routine => this.homeRoutine(routine));
  }

  private homeRoutine(routine: Routine): HomeRoutine {
    return { id: routine.id, name: routine.name, exerciseCount: routine.exercises.length };
  }

  private calculateWorkoutVolume(workout: WorkoutHistory): number {
    return workout.exercises.reduce((exerciseSum, exercise) => {
      const setVolume = exercise.sets.reduce((setSum, set) => {
        return setSum + ((set.reps ?? 0) * (set.weight ?? 0));
      }, 0);
      return exerciseSum + setVolume;
    }, 0);
  }
}
