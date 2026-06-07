import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { TranslationService } from '../../services/translation.service';

interface ExerciseSession {
  workoutId: string;
  routineName: string;
  finishedAt: string;
  sets: { setIndex: number; reps: number | null; weight: number | null }[];
  volume: number;
  bestWeight: number;
  estimatedOneRepMax: number;
  observation?: string;
}

interface ExerciseSummary {
  name: string;
  sessions: ExerciseSession[];
  totalVolume: number;
  bestWeight: number;
  estimatedOneRepMax: number;
  totalSets: number;
}

@Component({
  selector: 'app-exercise-history',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './exercise-history.component.html',
  styleUrls: ['./exercise-history.component.css'],
})
export class ExerciseHistoryComponent implements OnInit {
  t = inject(TranslationService);

  loading = signal(true);
  summaries = signal<ExerciseSummary[]>([]);
  selectedExerciseName = signal<string>('');

  selectedSummary = computed(() => {
    const name = this.selectedExerciseName();
    return this.summaries().find(summary => summary.name === name) ?? null;
  });

  async ngOnInit() {
    const workouts = await WorkoutHistoryRepository.getAll();
    const summaries = this.buildSummaries(workouts);
    this.summaries.set(summaries);
    this.selectedExerciseName.set(summaries[0]?.name ?? '');
    this.loading.set(false);
  }

  selectExercise(name: string) {
    this.selectedExerciseName.set(name);
  }

  private buildSummaries(workouts: WorkoutHistory[]): ExerciseSummary[] {
    const map = new Map<string, ExerciseSession[]>();

    for (const workout of workouts) {
      for (const exercise of workout.exercises) {
        const session = this.buildSession(workout, exercise);
        const sessions = map.get(exercise.name) ?? [];
        sessions.push(session);
        map.set(exercise.name, sessions);
      }
    }

    return Array.from(map.entries())
      .map(([name, sessions]) => ({
        name,
        sessions,
        totalVolume: sessions.reduce((sum, session) => sum + session.volume, 0),
        bestWeight: Math.max(...sessions.map(session => session.bestWeight), 0),
        estimatedOneRepMax: Math.max(...sessions.map(session => session.estimatedOneRepMax), 0),
        totalSets: sessions.reduce((sum, session) => sum + session.sets.length, 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private buildSession(workout: WorkoutHistory, exercise: WorkoutHistory['exercises'][number]): ExerciseSession {
    let volume = 0;
    let bestWeight = 0;
    let estimatedOneRepMax = 0;

    for (const set of exercise.sets) {
      const reps = set.reps ?? 0;
      const weight = set.weight ?? 0;
      volume += reps * weight;
      bestWeight = Math.max(bestWeight, weight);
      if (reps > 0 && weight > 0) {
        estimatedOneRepMax = Math.max(estimatedOneRepMax, weight * (1 + reps / 30));
      }
    }

    return {
      workoutId: workout.id,
      routineName: workout.routineName,
      finishedAt: workout.finishedAt,
      sets: exercise.sets,
      volume,
      bestWeight,
      estimatedOneRepMax,
      observation: exercise.observation,
    };
  }
}
