
import { Component, inject } from '@angular/core';
import { TranslationService } from '../../services/translation.service';
import { RoutinesRepository, Routine } from '../../data/active-training.repository';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
// @ts-ignore
import { v4 as uuidv4 } from 'uuid';

@Component({
  selector: 'app-routines',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './routines.component.html',
  styleUrls: ['./routines.component.css']
})
export class RoutinesComponent {
  t = inject(TranslationService);
  routines: Routine[] = [];
  loading = true;
  editingRoutine: Routine | null = null;
  newRoutineName = '';
  exercises: { id: string; name: string; setsCount: number }[] = [];

  constructor() {
    this.loadRoutines();
  }

  async loadRoutines() {
    this.routines = await RoutinesRepository.getAll();
    this.loading = false;
  }

  startCreate() {
    this.editingRoutine = null;
    this.newRoutineName = '';
    this.exercises = [];
  }

  startEdit(routine: Routine) {
    this.editingRoutine = { ...routine };
    this.newRoutineName = routine.name;
    this.exercises = routine.exercises.map(e => ({ ...e }));
  }

  addExerciseBlock() {
    this.exercises.push({ id: uuidv4(), name: '', setsCount: 3 });
  }

  removeExercise(idx: number) {
    this.exercises.splice(idx, 1);
  }

  async saveRoutine() {
    if (!this.newRoutineName.trim() || this.exercises.length === 0) return;
    if (this.editingRoutine) {
      const updated: Routine = { ...this.editingRoutine, name: this.newRoutineName, exercises: this.exercises.map(e => ({ ...e })) };
      await RoutinesRepository.update(updated);
    } else {
      const newRoutine: Routine = { id: uuidv4(), name: this.newRoutineName, exercises: this.exercises.map(e => ({ ...e })) };
      await RoutinesRepository.add(newRoutine);
    }
    this.editingRoutine = null;
    this.newRoutineName = '';
    this.exercises = [];
    await this.loadRoutines();
  }

  async deleteRoutine(routine: Routine) {
    await RoutinesRepository.delete(routine.id);
    await this.loadRoutines();
  }

  cancelEdit() {
    this.editingRoutine = null;
    this.newRoutineName = '';
    this.exercises = [];
  }

  updateSets(idx: number, sets: number) {
    this.exercises[idx].setsCount = sets;
  }
  updateName(idx: number, name: string) {
    this.exercises[idx].name = name;
  }
}
