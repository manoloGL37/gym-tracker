import { Component, OnInit, effect, inject } from '@angular/core';
import { WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslationService } from '../../services/translation.service';
import { AuthSessionService } from '../../auth/auth-session.service';
import { WorkoutApiService } from '../../workouts/workout-api.service';
import { RoutineApiService } from '../../routines/routine-api.service';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { AccountSyncService } from '../../migration/account-sync.service';

interface CalendarWorkoutItem {
  source: 'local' | 'cloud'; id: string; routineName: string; startedAt: string; finishedAt: string | null; exerciseCount: number; local?: WorkoutHistory;
}

@Component({ selector: 'app-calendar', standalone: true, imports: [CommonModule, DatePipe, RouterModule], templateUrl: './calendar.component.html', styleUrls: ['./calendar.component.css'] })
export class CalendarComponent implements OnInit {
  t = inject(TranslationService);
  readonly auth = inject(AuthSessionService);
  private readonly workoutApi = inject(WorkoutApiService);
  private readonly routineApi = inject(RoutineApiService);
  private readonly migration = inject(LocalToCloudMigrationService);
  private readonly accountSync = inject(AccountSyncService);
  // Chronological sessions answer the primary question first; the week view remains one tap away.
  view: 'week' | 'list' = 'list';
  workouts: CalendarWorkoutItem[] = [];
  cloudPageNumber = 0;
  cloudTotalPages = 0;
  cloudError: string | null = null;
  loading = true;
  weekStart: Date = CalendarComponent.getStartOfWeek(new Date());
  weekDays: Date[] = [];

  get weekWorkoutCount(): number { return this.weekDays.reduce((acc, day) => acc + this.getWorkoutsForDay(day).length, 0); }
  static getStartOfWeek(date: Date): Date { const d = new Date(date); const day = d.getDay(); d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); d.setHours(0, 0, 0, 0); return d; }
  constructor() {
    effect(() => {
      this.auth.isAuthenticated();
      this.auth.currentUser?.();
      this.accountSync.status();
      void this.loadWorkouts();
    });
  }
  ngOnInit() { this.setWeekDays(); }

  async loadWorkouts(page = this.cloudPageNumber) {
    this.loading = true;
    const rawLocal = await WorkoutHistoryRepository.getAll();
    const accountId = this.auth.currentUser?.()?.id;
    const migrated = accountId ? await Promise.all(rawLocal.map(workout => this.migration.isWorkoutMigrated(accountId, workout.id))) : rawLocal.map(() => false);
    const local = rawLocal.filter((_, index) => !migrated[index]);
    const localItems = local.map(workout => ({ source: 'local' as const, id: workout.id, routineName: workout.routineName, startedAt: workout.startedAt, finishedAt: workout.finishedAt, exerciseCount: workout.exercises.length, local: workout }));
    if (!this.auth.isAuthenticated()) { this.workouts = localItems; this.loading = false; return; }
    try {
      const cloud = await firstValueFrom(this.workoutApi.list({ page, size: 10 }));
      const names = await Promise.all(cloud.content.map(async workout => {
        if (!workout.routineId) return 'Rutina sin nombre';
        try { return (await firstValueFrom(this.routineApi.get(workout.routineId))).name; } catch { return 'Rutina sin nombre'; }
      }));
      this.cloudPageNumber = cloud.number; this.cloudTotalPages = cloud.totalPages;
      this.workouts = [...localItems, ...cloud.content.map((workout, index) => ({ source: 'cloud' as const, id: workout.id, routineName: names[index], startedAt: workout.startedAt, finishedAt: workout.completedAt, exerciseCount: workout.exercises.length }))];
      this.cloudError = null;
      this.loading = false;
    } catch {
      // Deliberately retain legacy records even when cloud history cannot load.
      this.workouts = rawLocal.map(workout => ({ source: 'local' as const, id: workout.id, routineName: workout.routineName, startedAt: workout.startedAt, finishedAt: workout.finishedAt, exerciseCount: workout.exercises.length, local: workout }));
      this.cloudError = 'No se pudo cargar todo el historial. Tus sesiones anteriores siguen disponibles.';
      this.loading = false;
    }
  }
  async onDeleteWorkout(workout: CalendarWorkoutItem) { if (workout.source === 'local' && workout.local && confirm(this.t.t('calendar.deleteConfirm'))) { await WorkoutHistoryRepository.delete(workout.local.id); await this.loadWorkouts(); } }
  setWeekDays() { this.weekDays = Array.from({ length: 7 }, (_, i) => { const day = new Date(this.weekStart); day.setDate(day.getDate() + i); return day; }); }
  prevWeek() { this.weekStart.setDate(this.weekStart.getDate() - 7); this.setWeekDays(); }
  nextWeek() { this.weekStart.setDate(this.weekStart.getDate() + 7); this.setWeekDays(); }
  setView(view: 'week' | 'list') { this.view = view; }
  isSameDay(dateStr: string, day: Date): boolean { const date = new Date(dateStr); return date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth() && date.getDate() === day.getDate(); }
  getWorkoutsForDay(day: Date): CalendarWorkoutItem[] { return this.workouts.filter(workout => this.isSameDay(workout.startedAt, day)); }
  async previousCloudPage() { if (this.cloudPageNumber > 0) await this.loadWorkouts(this.cloudPageNumber - 1); }
  async nextCloudPage() { if (this.cloudPageNumber + 1 < this.cloudTotalPages) await this.loadWorkouts(this.cloudPageNumber + 1); }
}
