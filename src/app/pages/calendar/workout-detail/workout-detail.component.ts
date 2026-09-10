import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkoutHistory } from '../../../data/workout-history.model';
import { WorkoutHistoryRepository } from '../../../data/active-training.repository';
import { TranslationService } from '../../../services/translation.service';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { WorkoutApiService } from '../../../workouts/workout-api.service';
import { WorkoutResponse } from '../../../workouts/workout-api.models';
import { RoutineApiService } from '../../../routines/routine-api.service';
import { ExerciseApiService } from '../../../exercises/exercise-api.service';
import { getExerciseName } from '../../../exercises/exercise-domain';

@Component({
  selector: 'app-workout-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workout-detail.component.html',
  styleUrls: ['./workout-detail.component.css']
})
export class WorkoutDetailComponent implements OnInit {
  t = inject(TranslationService);
  route = inject(ActivatedRoute);
  router = inject(Router);

  workout: WorkoutHistory | null = null;
  editMode = signal(false);
  editedWorkout: WorkoutHistory | null = null;
  cloudWorkout: WorkoutResponse | null = null;
  cloudRoutineName = 'Rutina cloud';
  cloudExerciseNames = new Map<string, string>();
  cloudError: string | null = null;
  private readonly workoutApi = inject(WorkoutApiService);
  private readonly routineApi = inject(RoutineApiService);
  private readonly exerciseApi = inject(ExerciseApiService);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      if (this.route.snapshot.queryParamMap.get('source') === 'cloud') await this.loadCloudWorkout(id);
      else this.workout = await WorkoutHistoryRepository.getById(id);
    }
  }

  private async loadCloudWorkout(id: string) {
    try {
      this.cloudWorkout = await firstValueFrom(this.workoutApi.get(id));
      if (this.cloudWorkout.routineId) {
        try { this.cloudRoutineName = (await firstValueFrom(this.routineApi.get(this.cloudWorkout.routineId))).name; } catch { /* snapshot remains readable without its routine. */ }
      }
      await Promise.all(this.cloudWorkout.exercises.map(async exercise => {
        try { this.cloudExerciseNames.set(exercise.exerciseId, getExerciseName(await firstValueFrom(this.exerciseApi.get(exercise.exerciseId)), this.t.lang())); } catch { /* use UUID below; no name matching */ }
      }));
    } catch { this.cloudError = 'No se pudo cargar este entrenamiento cloud.'; }
  }
  cloudExerciseName(exerciseId: string): string { return this.cloudExerciseNames.get(exerciseId) ?? exerciseId; }

  startEdit() {
    this.editMode.set(true);
    this.editedWorkout = this.workout ? JSON.parse(JSON.stringify(this.workout)) : null;
  }

  cancelEdit() {
    this.editMode.set(false);
    this.editedWorkout = null;
  }

  async saveEdit() {
    if (!this.editedWorkout) return;
    await WorkoutHistoryRepository.add(this.editedWorkout);
    this.workout = JSON.parse(JSON.stringify(this.editedWorkout));
    this.editMode.set(false);
  }
}
