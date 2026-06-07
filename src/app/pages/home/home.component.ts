import { Component, OnInit, inject, computed, Signal } from '@angular/core';
import { LowerCasePipe, DatePipe, DecimalPipe } from '@angular/common';
import { TranslationService } from '../../services/translation.service';
import { Router, RouterLink } from '@angular/router';
import { ActiveTrainingRepository, WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { ActiveTraining } from '../training/training.model';
import { BodyWeightRepository } from '../../data/body-weight.repository';
import { BodyWeightEntry } from '../../data/body-weight.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [LowerCasePipe, DatePipe, DecimalPipe, RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
  t = inject(TranslationService);
  lastWorkout: WorkoutHistory | null = null;
  activeTraining: ActiveTraining | null = null;
  weekWorkoutCount = 0;
  weekVolume = 0;
  latestWeight: BodyWeightEntry | null = null;
  readonly today = new Date();

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
    const [workouts, activeTraining, weightEntries] = await Promise.all([
      WorkoutHistoryRepository.getAll(),
      ActiveTrainingRepository.get().then(training => training ?? null),
      BodyWeightRepository.getAll(),
    ]);

    this.lastWorkout = workouts[0] ?? null;
    this.activeTraining = activeTraining;
    this.latestWeight = weightEntries[0] ?? null;
    this.weekWorkoutCount = this.getCurrentWeekWorkouts(workouts).length;
    this.weekVolume = this.getCurrentWeekWorkouts(workouts).reduce((sum, workout) => sum + this.calculateWorkoutVolume(workout), 0);
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
