import { Component, OnInit, inject, computed, Signal } from '@angular/core';
import { LowerCasePipe, DatePipe } from '@angular/common';
import { TranslationService } from '../../services/translation.service';
import { Router, RouterLink } from '@angular/router';
import { ActiveTrainingRepository, WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { ActiveTraining } from '../training/training.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [LowerCasePipe, DatePipe, RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
  t = inject(TranslationService);
  lastWorkout: WorkoutHistory | null = null;
  activeTraining: ActiveTraining | null = null;
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
    [this.lastWorkout, this.activeTraining] = await Promise.all([
      WorkoutHistoryRepository.getLast().then(workout => workout ?? null),
      ActiveTrainingRepository.get().then(training => training ?? null),
    ]);
  }

  startTraining() {
    this.router.navigate([this.activeTraining ? '/training' : '/select-routine']);
  }

  addWorkout() {
    this.router.navigate(['/add-workout']);
  }
}
