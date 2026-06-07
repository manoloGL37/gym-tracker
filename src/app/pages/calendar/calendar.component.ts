
import { Component, OnInit, inject } from '@angular/core';
import { WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterModule],
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.css']
})
export class CalendarComponent implements OnInit {
  t = inject(TranslationService);
    async onDeleteWorkout(w: WorkoutHistory) {
      if (confirm(this.t.t('calendar.deleteConfirm'))) {
        // Remove from IndexedDB
        await WorkoutHistoryRepository.delete(w.id);
        // Refresh list
        await this.loadWorkouts();
      }
    }
  view: 'week' | 'list' = 'week';
  workouts: WorkoutHistory[] = [];
  weekStart: Date = CalendarComponent.getStartOfWeek(new Date());
  weekDays: Date[] = [];

  get weekWorkoutCount(): number {
    return this.weekDays.reduce((acc, d) => acc + this.getWorkoutsForDay(d).length, 0);
  }

  static getStartOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    // Monday as first day of week
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0,0,0,0);
    return d;
  }

  ngOnInit() {
    this.loadWorkouts();
    this.setWeekDays();
  }

  async loadWorkouts() {
    this.workouts = await WorkoutHistoryRepository.getAll();
  }

  setWeekDays() {
    this.weekDays = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(this.weekStart);
      d.setDate(this.weekStart.getDate() + i);
      return d;
    });
  }

  prevWeek() {
    this.weekStart.setDate(this.weekStart.getDate() - 7);
    this.setWeekDays();
  }

  nextWeek() {
    this.weekStart.setDate(this.weekStart.getDate() + 7);
    this.setWeekDays();
  }

  setView(view: 'week' | 'list') {
    this.view = view;
  }

  isSameDay(dateStr: string, day: Date): boolean {
    const d1 = new Date(dateStr);
    return d1.getFullYear() === day.getFullYear() && d1.getMonth() === day.getMonth() && d1.getDate() === day.getDate();
  }

  getWorkoutsForDay(day: Date): WorkoutHistory[] {
    return this.workouts.filter(w => this.isSameDay(w.startedAt, day));
  }
}
