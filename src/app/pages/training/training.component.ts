import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ActiveTraining } from './training.model';
import { ActiveTrainingRepository, WorkoutHistoryRepository, SelectedRoutineRepository, RoutinesRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { TranslationService } from '../../services/translation.service';


@Component({
  selector: 'app-training',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './training.component.html',
  styleUrls: ['./training.component.css']
})
export class TrainingComponent implements OnInit {
  training: ActiveTraining | null = null;
  loading = true;
  previousWorkouts: WorkoutHistory[] = [];
  showConfirmFinish = false;
  t = inject(TranslationService);

  constructor(private router: Router) {}

  async ngOnInit() {
    // Load previous workouts (excluding current active training)
    this.previousWorkouts = await WorkoutHistoryRepository.getAll();

    // Try to load active training from IndexedDB
    const existing = await ActiveTrainingRepository.get();
    if (existing) {
      this.training = existing;
      this.loading = false;
      return;
    }
    // If not found, create from selected routine in IndexedDB
    const selected = await SelectedRoutineRepository.get();
    if (!selected) {
      this.loading = false;
      return;
    }
    const routine = await RoutinesRepository.get(selected.routineId);
    if (!routine) {
      this.loading = false;
      return;
    }
    const now = new Date().toISOString();
    this.training = {
      id: 'active',
      routineId: routine.id,
      routineName: routine.name,
      startedAt: now,
      exercises: routine.exercises.map((ex, i) => ({
        exerciseId: ex.id,
        name: ex.name,
        sets: Array.from({ length: ex.setsCount }).map((_, j) => ({ setIndex: j, reps: null, weight: null })),
      })),
    };
    await ActiveTrainingRepository.save(this.training);
    this.loading = false;
  }

  /**
   * Returns the most recent set (reps, weight) for a given exercise name and set index, or null if not found.
   */
  getLastSetReference(exerciseName: string, setIndex: number): { reps: number|null, weight: number|null } | null {
    for (const workout of this.previousWorkouts) {
      const ex = workout.exercises.find(e => e.name === exerciseName);
      if (ex) {
        const set = ex.sets.find(s => s.setIndex === setIndex);
        if (set && (set.reps !== null || set.weight !== null)) {
          return { reps: set.reps, weight: set.weight };
        }
      }
    }
    return null;
  }

  /**
   * Returns the most recent non-empty observation for a given exercise.
   */
  getLastObservation(exerciseName: string): string | null {
    for (const workout of this.previousWorkouts) {
      const observation = workout.exercises
        .find(exercise => exercise.name === exerciseName)
        ?.observation
        ?.trim();

      if (observation) {
        return observation;
      }
    }
    return null;
  }

  async onSetChange() {
    if (this.training) {
      await ActiveTrainingRepository.save(this.training);
    }
  }

  /**
   * Check if there are incomplete sets (no reps or weight entered)
   */
  hasIncompleteSets(): boolean {
    if (!this.training) return false;
    for (const exercise of this.training.exercises) {
      for (const set of exercise.sets) {
        if (set.reps === null || set.weight === null) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Show confirmation dialog when user presses Finish
   */
  requestFinish() {
    this.showConfirmFinish = true;
  }

  /**
   * Cancel the finish action
   */
  cancelFinish() {
    this.showConfirmFinish = false;
  }

  /**
   * Confirm and actually finish the workout
   */
  async confirmFinish() {
    if (this.training) {
      const finishedAt = new Date().toISOString();
      const { id, ...rest } = this.training;
      await WorkoutHistoryRepository.add({
        id: `${this.training.startedAt}-${finishedAt}`,
        ...rest,
        finishedAt,
      });
      await ActiveTrainingRepository.clear();
    }
    this.router.navigate(['/home']);
  }
}
