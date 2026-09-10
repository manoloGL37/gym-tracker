import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { TranslationService } from '../../services/translation.service';
import { AuthSessionService } from '../../auth/auth-session.service';
import { StatisticsApiService } from '../../statistics/statistics-api.service';
import { StatisticsEvolutionPoint, StatisticsSummaryResponse } from '../../statistics/statistics-api.models';

type Period = 'week' | 'month';
type StatisticsSource = 'local' | 'cloud';

interface PeriodStats {
  workoutCount: number;
  totalVolume: number;
  dailyDistribution: { date: Date; count: number; volume: number }[];
}

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './stats.component.html',
  styleUrls: ['./stats.component.css']
})
export class StatsComponent implements OnInit {
  t = inject(TranslationService);
  readonly auth = inject(AuthSessionService);
  private readonly statisticsApi = inject(StatisticsApiService);
  
  selectedPeriod = signal<Period>('week');
  currentStats = signal<PeriodStats>({ workoutCount: 0, totalVolume: 0, dailyDistribution: [] });
  previousStats = signal<PeriodStats>({ workoutCount: 0, totalVolume: 0, dailyDistribution: [] });
  loading = signal(true);
  source = signal<StatisticsSource>('local');
  error = signal<string | null>(null);
  private initialized = signal(false);
  private loadVersion = 0;

  constructor() {
    effect(() => {
      const nextSource: StatisticsSource = this.auth.isAuthenticated() ? 'cloud' : 'local';
      if (!this.initialized()) return;
      this.source.set(nextSource);
      void this.loadStats();
    });
  }

  async ngOnInit() {
    this.source.set(this.auth.isAuthenticated() ? 'cloud' : 'local');
    this.initialized.set(true);
    await this.loadStats();
  }

  async loadStats() {
    const requestVersion = ++this.loadVersion;
    this.loading.set(true);
    this.error.set(null);
    if (this.source() === 'cloud' && this.auth.isAuthenticated()) {
      await this.loadCloudStats(requestVersion);
      return;
    }

    await this.loadLocalStats(requestVersion);
  }

  private async loadLocalStats(requestVersion: number): Promise<void> {
    const workouts = await WorkoutHistoryRepository.getAll();
    if (requestVersion !== this.loadVersion) return;
    const period = this.selectedPeriod();
    
    const { start: currentStart, end: currentEnd } = this.getPeriodRange(period, 0);
    const { start: previousStart, end: previousEnd } = this.getPeriodRange(period, -1);

    this.currentStats.set(this.calculateStats(workouts, currentStart, currentEnd));
    this.previousStats.set(this.calculateStats(workouts, previousStart, previousEnd));
    this.loading.set(false);
  }

  private async loadCloudStats(requestVersion: number): Promise<void> {
    const period = this.selectedPeriod();
    const current = this.getPeriodRange(period, 0);
    const previous = this.getPeriodRange(period, -1);
    const currentRange = { from: toCalendarDate(current.start), to: toCalendarDate(current.end) };

    try {
      const [comparison, evolution] = await Promise.all([
        firstValueFrom(this.statisticsApi.comparison({
          currentFrom: currentRange.from,
          currentTo: currentRange.to,
          previousFrom: toCalendarDate(previous.start),
          previousTo: toCalendarDate(previous.end),
        })),
        firstValueFrom(this.statisticsApi.evolution(currentRange)),
      ]);
      if (requestVersion !== this.loadVersion || this.source() !== 'cloud') return;
      this.currentStats.set(this.cloudPeriodStats(comparison.current, evolution.data));
      this.previousStats.set(this.cloudPeriodStats(comparison.previous, []));
    } catch {
      if (requestVersion !== this.loadVersion || this.source() !== 'cloud') return;
      // Zero aggregates are a successful cloud response. Only a failed request reaches here.
      this.currentStats.set({ workoutCount: 0, totalVolume: 0, dailyDistribution: [] });
      this.previousStats.set({ workoutCount: 0, totalVolume: 0, dailyDistribution: [] });
      this.error.set('No se pudieron cargar las estadísticas cloud. Tus estadísticas locales siguen disponibles.');
    } finally {
      if (requestVersion === this.loadVersion) this.loading.set(false);
    }
  }

  private cloudPeriodStats(summary: StatisticsSummaryResponse, evolution: StatisticsEvolutionPoint[]): PeriodStats {
    const days = new Map(evolution.map(point => [point.date, point]));
    const dailyDistribution: PeriodStats['dailyDistribution'] = [];
    for (const date of calendarDates(summary.from, summary.to)) {
      const point = days.get(toCalendarDate(date));
      dailyDistribution.push({ date, count: point?.workouts ?? 0, volume: point?.volume ?? 0 });
    }
    return { workoutCount: summary.workouts, totalVolume: summary.volume, dailyDistribution };
  }

  getPeriodRange(period: Period, offset: number): { start: Date; end: Date } {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (period === 'week') {
      // Week starts on Monday
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const start = new Date(now);
      start.setDate(now.getDate() + diff + (offset * 7));
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    } else {
      // Month
      const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }
  }

  calculateStats(workouts: WorkoutHistory[], start: Date, end: Date): PeriodStats {
    const filtered = workouts.filter(w => {
      const date = new Date(w.finishedAt);
      return date >= start && date <= end;
    });

    const workoutCount = filtered.length;
    let totalVolume = 0;

    // Calculate daily distribution
    const dailyMap = new Map<string, { count: number; volume: number }>();
    
    for (const workout of filtered) {
      const date = new Date(workout.finishedAt);
      date.setHours(0, 0, 0, 0);
      const key = date.toISOString();

      if (!dailyMap.has(key)) {
        dailyMap.set(key, { count: 0, volume: 0 });
      }
      
      const daily = dailyMap.get(key)!;
      daily.count++;

      // Calculate volume for this workout
      for (const exercise of workout.exercises) {
        for (const set of exercise.sets) {
          if (set.reps && set.weight) {
            const volume = set.reps * set.weight;
            totalVolume += volume;
            daily.volume += volume;
          }
        }
      }
    }

    // Convert to array and fill missing days
    const dailyDistribution: { date: Date; count: number; volume: number }[] = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const key = new Date(currentDate).toISOString();
      const data = dailyMap.get(key) || { count: 0, volume: 0 };
      dailyDistribution.push({
        date: new Date(currentDate),
        count: data.count,
        volume: data.volume
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return { workoutCount, totalVolume, dailyDistribution };
  }

  async setPeriod(period: Period) {
    this.selectedPeriod.set(period);
    await this.loadStats();
  }

  async setSource(source: StatisticsSource): Promise<void> {
    if (source === 'cloud' && !this.auth.isAuthenticated()) return;
    this.source.set(source);
    await this.loadStats();
  }

  getTrend(current: number, previous: number): 'up' | 'down' | 'equal' | 'none' {
    if (previous === 0) return 'none';
    if (current > previous) return 'up';
    if (current < previous) return 'down';
    return 'equal';
  }

  getMaxVolume(): number {
    const current = this.currentStats();
    return Math.max(...current.dailyDistribution.map(d => d.volume), 1);
  }

  getPeriodLabel(): string {
    const { start, end } = this.getPeriodRange(this.selectedPeriod(), 0);
    const fmt = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    return `${fmt(start)} – ${fmt(end)}`;
  }
}

/** Formats a calendar date without converting its local day to UTC. */
function toCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calendarDates(from: string, to: string): Date[] {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const cursor = new Date(fromYear, fromMonth - 1, fromDay);
  const end = new Date(toYear, toMonth - 1, toDay);
  const dates: Date[] = [];
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
