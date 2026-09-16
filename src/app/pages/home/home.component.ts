import { Component, inject, computed, effect } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslationService } from '../../services/translation.service';
import { Router, RouterLink } from '@angular/router';
import { ActiveTrainingRepository, CloudActiveTrainingRepository, Routine } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { ActiveTraining } from '../training/training.model';
import { BodyWeightRepository } from '../../data/body-weight.repository';
import { BodyWeightEntry } from '../../data/body-weight.model';
import { CloudActiveTraining } from '../../workouts/workout-domain';
import { AuthSessionService } from '../../auth/auth-session.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { StatisticsApiService } from '../../statistics/statistics-api.service';
import { firstValueFrom } from 'rxjs';
import { LocalFirstReadService, RemoteReadState, RoutineReadModel, WorkoutReadItem, WorkoutReadModel } from '../../data/local-first-read.service';
import { StatisticsSummaryResponse } from '../../statistics/statistics-api.models';

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
  routineRemoteState: RemoteReadState = 'local';
  workoutRemoteState: RemoteReadState = 'local';
  readonly today = new Date();
  private readonly auth = inject(AuthSessionService);
  private readonly accountSync = inject(AccountSyncService);
  private readonly reads = inject(LocalFirstReadService);
  private readonly statisticsApi = inject(StatisticsApiService);
  private loadId = 0;
  private snapshotAccountId: string | null | undefined;
  readonly workoutSyncText = computed(() => {
    if (!this.auth.isAuthenticated()) return null;
    const pending = this.accountSync.pendingWorkouts();
    if (this.accountSync.status() === 'syncing' || this.accountSync.status() === 'retrying') return 'Sincronizando entrenamientos...';
    if (pending > 0) return pending === 1 ? '1 entrenamiento pendiente' : `${pending} entrenamientos pendientes`;
    return null;
  });

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
    const loadId = ++this.loadId;
    const accountId = this.auth.isAuthenticated() ? this.auth.currentUser?.()?.id ?? null : null;
    if (this.snapshotAccountId !== undefined && this.snapshotAccountId !== accountId) {
      this.lastWorkout = null;
      this.routineShortcuts = [];
      this.weekWorkoutCount = 0;
      this.weekVolume = 0;
      this.snapshotAccountId = undefined;
    }
    this.loading = this.snapshotAccountId === undefined;
    const [workouts, routines, activeTraining, cloudActiveTraining, weightEntries] = await Promise.all([
      this.reads.workoutSnapshot(accountId),
      this.reads.routineSnapshot(accountId),
      ActiveTrainingRepository.get().then(training => training ?? null),
      CloudActiveTrainingRepository.get().then(training => training ?? null),
      BodyWeightRepository.getAll(),
    ]);
    if (loadId !== this.loadId) return;
    this.activeTraining = activeTraining ?? cloudActiveTraining;
    this.latestWeight = weightEntries[0] ?? null;
    this.applyWorkoutRead(workouts);
    this.applyRoutineRead(routines);
    this.snapshotAccountId = accountId;
    this.loading = false;
    if (accountId) this.refreshAccountDashboard(accountId, loadId, workouts);
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

  get canShowRoutineEmpty(): boolean { return this.routineRemoteState === 'local' || this.routineRemoteState === 'confirmed'; }
  get canShowWorkoutEmpty(): boolean { return this.workoutRemoteState === 'local' || this.workoutRemoteState === 'confirmed'; }

  private refreshAccountDashboard(accountId: string, loadId: number, snapshot: WorkoutReadModel): void {
    const isCurrent = () => loadId === this.loadId && this.auth.currentUser?.()?.id === accountId;
    const workouts = this.reads.refreshWorkouts(accountId, 0, 100);
    void workouts.then(read => {
      if (isCurrent()) this.applyWorkoutRead(read);
    }).catch(() => {
      if (isCurrent()) this.workoutRemoteState = 'unavailable';
    });
    void this.reads.refreshRoutines(accountId, 0, 3).then(read => {
      if (isCurrent()) this.applyRoutineRead(read);
    }).catch(() => {
      if (isCurrent()) this.routineRemoteState = 'unavailable';
    });
    void firstValueFrom(this.statisticsApi.summary(this.currentWeekRange())).then(async summary => {
      let currentWorkouts = snapshot;
      try { currentWorkouts = await workouts; } catch { /* The local snapshot remains coherent. */ }
      if (isCurrent()) this.applyServerSummary(summary, currentWorkouts.items);
    }).catch(() => undefined);
  }

  private applyRoutineRead(read: RoutineReadModel): void {
    this.routineRemoteState = read.remoteState;
    this.routineShortcuts = read.items.slice(0, 3).map(item => item.source === 'local'
      ? this.homeRoutine(item.routine)
      : { id: item.routine.id, name: item.routine.name, exerciseCount: null });
  }

  private applyWorkoutRead(read: WorkoutReadModel): void {
    this.workoutRemoteState = read.remoteState;
    const latest = read.items[0];
    this.lastWorkout = latest ? {
      id: latest.id,
      routineName: latest.routineName,
      finishedAt: latest.finishedAt ?? latest.startedAt,
      exerciseCount: latest.exerciseCount,
      accountBacked: latest.source === 'cloud',
    } : null;
    const currentWeek = this.getCurrentWeekItems(read.items);
    this.weekWorkoutCount = currentWeek.length;
    this.weekVolume = currentWeek.reduce((sum, workout) => sum + this.calculateReadWorkoutVolume(workout), 0);
  }

  private applyServerSummary(summary: StatisticsSummaryResponse, workouts: WorkoutReadItem[]): void {
    const pending = this.getCurrentWeekItems(workouts).filter(workout => workout.source === 'local' && !workout.serverRepresented);
    this.weekWorkoutCount = summary.workouts + pending.length;
    this.weekVolume = summary.volume + pending.reduce((sum, workout) => sum + this.calculateReadWorkoutVolume(workout), 0);
  }

  private getCurrentWeekItems(workouts: WorkoutReadItem[]): WorkoutReadItem[] {
    const start = new Date();
    const day = start.getDay();
    start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return workouts.filter(workout => {
      const date = new Date(workout.finishedAt ?? workout.startedAt);
      return date >= start && date <= end;
    });
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

  private calculateReadWorkoutVolume(workout: WorkoutReadItem): number {
    if (workout.local) return this.calculateWorkoutVolume(workout.local);
    return workout.cloud?.exercises.reduce((total, exercise) => total + exercise.sets.reduce((sum, set) => sum + set.reps * set.weight, 0), 0) ?? 0;
  }
}
