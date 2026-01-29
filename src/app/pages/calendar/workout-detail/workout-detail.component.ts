import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkoutHistory } from '../../../data/workout-history.model';
import { WorkoutHistoryRepository } from '../../../data/active-training.repository';
import { TranslationService } from '../../../services/translation.service';
import { ActivatedRoute, Router } from '@angular/router';

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

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.workout = await WorkoutHistoryRepository.getById(id);
    }
  }

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
