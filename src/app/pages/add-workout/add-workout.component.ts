import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoutinesRepository, Routine, WorkoutHistoryRepository } from '../../data/active-training.repository';
import { v4 as uuidv4 } from 'uuid';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-add-workout',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './add-workout.component.html',
  styleUrls: ['./add-workout.component.css']
})
export class AddWorkoutComponent {
  t = inject(TranslationService);
  date: string = new Date().toISOString().slice(0, 10);
  today: string = new Date().toISOString().slice(0, 10);
  routines: Routine[] = [];
  selectedRoutineId: string | null = null;
  selectedRoutine: Routine | null = null;
  exercises: { id: string; name: string; sets: { reps: number|null; weight: number|null; }[]; observation?: string }[] = [];
  saving = false;

  constructor(private router: Router) {
    this.loadRoutines();
  }

  async loadRoutines() {
    this.routines = await RoutinesRepository.getAll();
  }

  onRoutineChange() {
    this.selectedRoutine = this.routines.find(r => r.id === this.selectedRoutineId) ?? null;
    if (this.selectedRoutine) {
      this.exercises = this.selectedRoutine.exercises.map(ex => ({
        id: ex.id,
        name: ex.name,
        sets: Array.from({ length: ex.setsCount }).map(() => ({ reps: null, weight: null }))
      }));
    } else {
      this.exercises = [];
    }
  }

  async save() {
    if (!this.selectedRoutine || !this.date) return;
    this.saving = true;
    const startedAt = this.date + 'T00:00:00.000Z';
    const finishedAt = this.date + 'T00:00:00.000Z';
    await WorkoutHistoryRepository.add({
      id: uuidv4(),
      routineId: this.selectedRoutine.id,
      routineName: this.selectedRoutine.name,
      startedAt,
      finishedAt,
      exercises: this.exercises.map((ex, i) => ({
        exerciseId: ex.id,
        name: ex.name,
        sets: ex.sets.map((set, j) => ({ setIndex: j, reps: set.reps, weight: set.weight }))
      })),
    });
    this.saving = false;
    this.router.navigate(['/home']);
  }

  cancel() {
    this.router.navigate(['/home']);
  }
}
