import { Component, OnInit, effect, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslationService } from '../../services/translation.service';
import { AuthSessionService } from '../../auth/auth-session.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { LocalFirstReadService, RemoteReadState, WorkoutReadItem } from '../../data/local-first-read.service';
import { WorkoutHistoryRepository } from '../../data/active-training.repository';

@Component({ selector: 'app-calendar', standalone: true, imports: [CommonModule, DatePipe, RouterModule], templateUrl: './calendar.component.html', styleUrls: ['./calendar.component.css'] })
export class CalendarComponent implements OnInit {
  t = inject(TranslationService);
  readonly auth = inject(AuthSessionService);
  private readonly accountSync = inject(AccountSyncService);
  private readonly reads = inject(LocalFirstReadService);
  private loadId = 0;
  private snapshotAccountId: string | null | undefined;
  // Chronological sessions answer the primary question first; the week view remains one tap away.
  view: 'week' | 'list' = 'list';
  workouts: WorkoutReadItem[] = [];
  cloudPageNumber = 0;
  cloudTotalPages = 0;
  cloudError: string | null = null;
  loading = true;
  cloudLoading = false;
  remoteState: RemoteReadState = 'local';
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
    const loadId = ++this.loadId;
    this.cloudLoading = false;
    const accountId = this.auth.isAuthenticated() ? this.auth.currentUser?.()?.id ?? null : null;
    if (this.snapshotAccountId !== undefined && this.snapshotAccountId !== accountId) {
      this.workouts = [];
      this.cloudError = null;
      this.snapshotAccountId = undefined;
    }
    this.loading = this.snapshotAccountId === undefined;
    const snapshot = await this.reads.workoutSnapshot(accountId);
    if (loadId !== this.loadId) return;
    this.applyRead(snapshot);
    this.snapshotAccountId = accountId;
    this.loading = false;
    if (!accountId) return;
    this.cloudLoading = true;
    try {
      const refreshed = await this.reads.refreshWorkouts(accountId, page, 10);
      if (loadId !== this.loadId || this.auth.currentUser?.()?.id !== accountId) return;
      this.applyRead(refreshed);
      this.cloudError = null;
    } catch {
      if (loadId !== this.loadId || this.auth.currentUser?.()?.id !== accountId) return;
      this.remoteState = 'unavailable';
      this.cloudError = 'No se pudo cargar todo el historial. Tus sesiones anteriores siguen disponibles.';
    } finally {
      if (loadId === this.loadId) this.cloudLoading = false;
    }
  }
  async onDeleteWorkout(workout: WorkoutReadItem) { if (workout.source === 'local' && workout.local && confirm(this.t.t('calendar.deleteConfirm'))) { await WorkoutHistoryRepository.delete(workout.local.id); await this.loadWorkouts(); } }
  setWeekDays() { this.weekDays = Array.from({ length: 7 }, (_, i) => { const day = new Date(this.weekStart); day.setDate(day.getDate() + i); return day; }); }
  prevWeek() { this.weekStart.setDate(this.weekStart.getDate() - 7); this.setWeekDays(); }
  nextWeek() { this.weekStart.setDate(this.weekStart.getDate() + 7); this.setWeekDays(); }
  setView(view: 'week' | 'list') { this.view = view; }
  isSameDay(dateStr: string, day: Date): boolean { const date = new Date(dateStr); return date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth() && date.getDate() === day.getDate(); }
  getWorkoutsForDay(day: Date): WorkoutReadItem[] { return this.workouts.filter(workout => this.isSameDay(workout.startedAt, day)); }
  workoutKey(workout: WorkoutReadItem): string { return `${workout.source}:${workout.id}`; }
  get canShowEmpty(): boolean { return this.remoteState === 'local' || this.remoteState === 'confirmed'; }
  async previousCloudPage() { if (this.cloudPageNumber > 0) await this.loadWorkouts(this.cloudPageNumber - 1); }
  async nextCloudPage() { if (this.cloudPageNumber + 1 < this.cloudTotalPages) await this.loadWorkouts(this.cloudPageNumber + 1); }

  private applyRead(read: Awaited<ReturnType<LocalFirstReadService['workoutSnapshot']>>): void {
    this.workouts = read.items;
    this.remoteState = read.remoteState;
    this.cloudPageNumber = read.pageNumber;
    this.cloudTotalPages = read.totalPages;
  }
}
