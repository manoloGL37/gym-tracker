import { Component, OnInit, inject, computed, Signal } from '@angular/core';
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

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
  t = inject(TranslationService);
  lastWorkout: WorkoutHistory | null = null;
  activeTraining: ActiveTraining | CloudActiveTraining | null = null;
  weekWorkoutCount = 0;
  weekVolume = 0;
  latestWeight: BodyWeightEntry | null = null;
  routineShortcuts: Routine[] = [];
  readonly today = new Date();
  private readonly auth = inject(AuthSessionService);
  private readonly migration = inject(LocalToCloudMigrationService);

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

  constructor(private router: Router) {}

  async ngOnInit() {
    const [workouts, activeTraining, cloudActiveTraining, weightEntries, routines] = await Promise.all([
      WorkoutHistoryRepository.getAll(),
      ActiveTrainingRepository.get().then(training => training ?? null),
      CloudActiveTrainingRepository.get().then(training => training ?? null),
      BodyWeightRepository.getAll(),
      RoutinesRepository.getAll(),
    ]);

    const accountId = this.auth.currentUser?.()?.id;
    const migrated = accountId ? await Promise.all(workouts.map(workout => this.migration.isWorkoutMigrated(accountId, workout.id))) : workouts.map(() => false);
    const visibleWorkouts = workouts.filter((_, index) => !migrated[index]);
    this.lastWorkout = visibleWorkouts[0] ?? null;
    this.activeTraining = activeTraining ?? cloudActiveTraining;
    this.latestWeight = weightEntries[0] ?? null;
    this.weekWorkoutCount = this.getCurrentWeekWorkouts(visibleWorkouts).length;
    this.weekVolume = this.getCurrentWeekWorkouts(visibleWorkouts).reduce((sum, workout) => sum + this.calculateWorkoutVolume(workout), 0);
    this.routineShortcuts = routines.slice(0, 3);
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

  private calculateWorkoutVolume(workout: WorkoutHistory): number {
    return workout.exercises.reduce((exerciseSum, exercise) => {
      const setVolume = exercise.sets.reduce((setSum, set) => {
        return setSum + ((set.reps ?? 0) * (set.weight ?? 0));
      }, 0);
      return exerciseSum + setVolume;
    }, 0);
  }
}
