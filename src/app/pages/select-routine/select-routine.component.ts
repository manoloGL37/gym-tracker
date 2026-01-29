import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { RoutinesRepository, Routine, SelectedRoutineRepository } from '../../data/active-training.repository';
import { CommonModule } from '@angular/common';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-select-routine',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './select-routine.component.html',
  styleUrls: ['./select-routine.component.css']
})
export class SelectRoutineComponent {
  t = inject(TranslationService);
  routines: Routine[] = [];
  loading = true;

  constructor(private router: Router) {
    this.loadRoutines();
  }

  async loadRoutines() {
    this.routines = await RoutinesRepository.getAll();
    this.loading = false;
  }

  async selectRoutine(routine: Routine) {
    await SelectedRoutineRepository.set(routine.id);
    this.router.navigate(['/training']);
  }
}
