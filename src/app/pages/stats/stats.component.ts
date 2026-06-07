import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { TranslationService } from '../../services/translation.service';

type Period = 'week' | 'month';

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
  
  selectedPeriod = signal<Period>('week');
  currentStats = signal<PeriodStats>({ workoutCount: 0, totalVolume: 0, dailyDistribution: [] });
  previousStats = signal<PeriodStats>({ workoutCount: 0, totalVolume: 0, dailyDistribution: [] });
  loading = signal(true);

  async ngOnInit() {
    await this.loadStats();
  }

  async loadStats() {
    this.loading.set(true);
    const workouts = await WorkoutHistoryRepository.getAll();
    const period = this.selectedPeriod();
    
    const { start: currentStart, end: currentEnd } = this.getPeriodRange(period, 0);
    const { start: previousStart, end: previousEnd } = this.getPeriodRange(period, -1);

    this.currentStats.set(this.calculateStats(workouts, currentStart, currentEnd));
    this.previousStats.set(this.calculateStats(workouts, previousStart, previousEnd));
    this.loading.set(false);
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
