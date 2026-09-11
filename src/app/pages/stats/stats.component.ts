import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CategoryScale,
  ChartData,
  ChartOptions,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { BaseChartDirective, provideCharts } from 'ng2-charts';
import { firstValueFrom } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { WorkoutHistoryRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { ExerciseResponse } from '../../exercises/exercise-api.models';
import { getExerciseName } from '../../exercises/exercise-domain';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { TranslationService } from '../../services/translation.service';
import { StatisticsApiService } from '../../statistics/statistics-api.service';
import {
  ExerciseStatisticsResponse,
  StatisticsChanges,
  StatisticsEvolutionPoint,
  StatisticsSummaryResponse,
} from '../../statistics/statistics-api.models';

type Period = 'week' | 'month';
type StatisticsSource = 'local' | 'cloud';
type ComparableMetric = 'workouts' | 'sets' | 'reps' | 'volume';

interface DailyTrainingPoint {
  date: string;
  workouts: number;
  sets: number;
  reps: number;
  volume: number;
}

interface PeriodStats {
  workoutCount: number;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  dailyDistribution: DailyTrainingPoint[];
}

interface WeeklyTrainingPoint extends DailyTrainingPoint {
  to: string;
}

interface WeeklyExercisePoint {
  date: string;
  to: string;
  volume: number;
  maxWeight: number;
}

const EMPTY_STATS: PeriodStats = {
  workoutCount: 0,
  totalSets: 0,
  totalReps: 0,
  totalVolume: 0,
  dailyDistribution: [],
};

const EMPTY_CHANGES: Record<ComparableMetric, number> = { workouts: 0, sets: 0, reps: 0, volume: 0 };
const CHART_INK = '#596577';
const CHART_PLATE = '#db4829';
const CHART_PLATE_FILL = 'rgba(219, 72, 41, 0.14)';
const CHART_CLOUD = '#256dba';
const CHART_CLOUD_FILL = 'rgba(37, 109, 186, 0.12)';
const CHART_GRID = 'rgba(20, 25, 35, 0.08)';

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, BaseChartDirective],
  providers: [
    provideCharts({
      registerables: [
        LineController,
        LineElement,
        PointElement,
        CategoryScale,
        LinearScale,
        Tooltip,
        Filler,
      ],
    }),
  ],
  templateUrl: './stats.component.html',
  styleUrl: './stats.component.css',
})
export class StatsComponent implements OnInit {
  readonly t = inject(TranslationService);
  readonly auth = inject(AuthSessionService);
  private readonly statisticsApi = inject(StatisticsApiService);
  private readonly exercisesApi = inject(ExerciseApiService);
  private readonly migration = inject(LocalToCloudMigrationService);

  readonly selectedPeriod = signal<Period>('week');
  readonly currentStats = signal<PeriodStats>({ ...EMPTY_STATS });
  readonly previousStats = signal<PeriodStats>({ ...EMPTY_STATS });
  readonly comparisonChanges = signal<Record<ComparableMetric, number>>({ ...EMPTY_CHANGES });
  readonly loading = signal(true);
  readonly source = signal<StatisticsSource>('local');
  readonly error = signal<string | null>(null);

  exerciseSearch = '';
  selectedExerciseId = '';
  readonly exerciseResults = signal<ExerciseResponse[]>([]);
  readonly selectedExercise = signal<ExerciseResponse | null>(null);
  readonly exerciseStats = signal<ExerciseStatisticsResponse | null>(null);
  readonly exercisesLoading = signal(false);
  readonly exerciseStatsLoading = signal(false);
  readonly exerciseSearchError = signal<string | null>(null);
  readonly exerciseStatsError = signal<string | null>(null);
  readonly weeklyProgress = signal<WeeklyTrainingPoint[]>([]);
  readonly weeklyLoading = signal(false);
  readonly weeklyError = signal<string | null>(null);
  private localWorkouts: WorkoutHistory[] = [];

  weekFrom = toIsoWeek(addCalendarDays(new Date(), -49));
  weekTo = toIsoWeek(new Date());

  readonly evolutionChartData = computed<ChartData<'line', number[], string>>(() => {
    const points = this.currentStats().dailyDistribution;
    return {
      labels: points.map(point => this.chartDateLabel(point.date)),
      datasets: [{
        label: this.t.t('stats.volumeKg'),
        data: points.map(point => point.volume),
        yAxisID: 'volume',
        borderColor: CHART_PLATE,
        backgroundColor: CHART_PLATE_FILL,
        pointBackgroundColor: CHART_PLATE,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: points.length === 1 ? 5 : 3,
        pointHoverRadius: 6,
        borderWidth: 3,
        tension: 0.32,
        fill: true,
      }],
    };
  });

  readonly weeklyChartData = computed<ChartData<'line', number[], string>>(() => {
    const points = this.weeklyProgress();
    return {
      labels: points.map(point => this.weekLabel(point.date)),
      datasets: [{
        label: this.t.t('stats.volumeKg'),
        data: points.map(point => point.volume),
        yAxisID: 'volume',
        borderColor: CHART_PLATE,
        backgroundColor: CHART_PLATE_FILL,
        pointBackgroundColor: CHART_PLATE,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 3,
        borderWidth: 3,
        tension: 0.28,
        fill: true,
      }],
    };
  });

  readonly exerciseWeeklyProgress = computed<WeeklyExercisePoint[]>(() => aggregateExerciseWeeks(this.exerciseStats()?.evolution ?? []));

  readonly exerciseChartData = computed<ChartData<'line', number[], string>>(() => {
    const points = this.exerciseWeeklyProgress();
    return {
      labels: points.map(point => this.weekLabel(point.date)),
      datasets: [
        {
          label: this.t.t('stats.volumeKg'),
          data: points.map(point => point.volume),
          yAxisID: 'volume',
          borderColor: CHART_CLOUD,
          backgroundColor: CHART_CLOUD_FILL,
          pointBackgroundColor: CHART_CLOUD,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: points.length === 1 ? 5 : 3,
          borderWidth: 3,
          tension: 0.28,
          fill: true,
        },
        {
          label: this.t.t('stats.maxWeightKg'),
          data: points.map(point => point.maxWeight),
          yAxisID: 'weight',
          borderColor: CHART_INK,
          backgroundColor: CHART_INK,
          pointBackgroundColor: CHART_INK,
          pointRadius: points.length === 1 ? 5 : 3,
          borderWidth: 2,
          tension: 0.28,
          fill: false,
        },
      ],
    };
  });

  readonly evolutionChartOptions = computed<ChartOptions<'line'>>(() => this.lineOptions(false));
  readonly exerciseChartOptions = computed<ChartOptions<'line'>>(() => this.lineOptions(true));
  readonly weeklyChartOptions = computed<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    animation: { duration: 180 },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: items => this.weekRangeLabel(this.weeklyProgress()[items[0]?.dataIndex ?? 0]),
          label: context => `${this.t.t('stats.volume')}: ${formatNumber(Number(context.parsed.y ?? 0))} kg`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: CHART_INK, maxRotation: 0, autoSkip: true, maxTicksLimit: this.selectedPeriod() === 'week' ? 7 : 8 },
        border: { display: false },
      },
      volume: {
        beginAtZero: true,
        ticks: { color: CHART_INK, maxTicksLimit: 5, callback: value => compactNumber(Number(value)) },
        grid: { color: CHART_GRID },
        border: { display: false },
      },
    },
  }));

  private initialized = signal(false);
  private loadVersion = 0;
  private exerciseLoadVersion = 0;
  private weeklyLoadVersion = 0;
  private previousAuthentication: boolean | null = null;

  constructor() {
    effect(() => {
      const authenticated = this.auth.isAuthenticated();
      if (this.previousAuthentication === null) {
        this.previousAuthentication = authenticated;
        return;
      }
      if (authenticated === this.previousAuthentication) return;
      this.previousAuthentication = authenticated;
      if (!this.initialized()) return;

      untracked(() => {
        this.source.set(authenticated ? 'cloud' : 'local');
        if (!authenticated) this.clearExerciseSelection();
        void this.loadStats();
      });
    });
  }

  async ngOnInit(): Promise<void> {
    this.source.set(this.auth.isAuthenticated() ? 'cloud' : 'local');
    this.initialized.set(true);
    await this.loadStats();
  }

  async loadStats(): Promise<void> {
    const requestVersion = ++this.loadVersion;
    this.loading.set(true);
    this.error.set(null);
    if (this.source() === 'cloud' && this.auth.isAuthenticated()) {
      await this.loadCloudStats(requestVersion);
      return;
    }
    await this.loadLocalStats(requestVersion);
  }

  async setPeriod(period: Period): Promise<void> {
    if (period === this.selectedPeriod()) return;
    this.selectedPeriod.set(period);
    await this.loadStats();
  }

  async searchExercises(): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    this.exercisesLoading.set(true);
    this.exerciseSearchError.set(null);
    try {
      const page = await firstValueFrom(this.exercisesApi.list({
        page: 0,
        size: 8,
        search: this.exerciseSearch.trim() || undefined,
      }));
      this.exerciseResults.set(page.content);
      if (!page.content.length) this.clearExerciseSelection();
    } catch {
      this.exerciseResults.set([]);
      this.exerciseSearchError.set(this.t.t('stats.exerciseSearchError'));
    } finally {
      this.exercisesLoading.set(false);
    }
  }

  async applyWeeklyRange(): Promise<void> {
    if (!this.selectedWeekRange()) {
      this.weeklyError.set(this.t.t('stats.weekRangeError'));
      return;
    }
    await Promise.all([
      this.loadWeeklyProgress(),
      this.source() === 'cloud' && this.selectedExerciseId ? this.loadExerciseStats() : Promise.resolve(),
    ]);
  }

  async loadWeeklyProgress(): Promise<void> {
    const range = this.selectedWeekRange();
    if (!range) {
      this.weeklyError.set(this.t.t('stats.weekRangeError'));
      return;
    }

    const requestVersion = ++this.weeklyLoadVersion;
    const requestedSource = this.source();
    this.weeklyLoading.set(true);
    this.weeklyError.set(null);
    try {
      const dailyPoints = requestedSource === 'cloud' && this.auth.isAuthenticated()
        ? (await firstValueFrom(this.statisticsApi.evolution({
            from: toCalendarDate(range.start),
            to: toCalendarDate(range.end),
          }))).data.map(point => ({
            date: point.date,
            workouts: point.workouts,
            sets: point.sets,
            reps: point.reps,
            volume: point.volume,
          }))
        : this.calculateStats(this.localWorkouts, range.start, range.end).dailyDistribution;

      if (requestVersion === this.weeklyLoadVersion && requestedSource === this.source()) {
        this.weeklyProgress.set(aggregateTrainingWeeks(dailyPoints));
      }
    } catch {
      if (requestVersion === this.weeklyLoadVersion) {
        this.weeklyProgress.set([]);
        this.weeklyError.set(this.t.t('stats.weeklyError'));
      }
    } finally {
      if (requestVersion === this.weeklyLoadVersion) this.weeklyLoading.set(false);
    }
  }

  async selectExercise(exerciseId: string): Promise<void> {
    this.selectedExerciseId = exerciseId;
    this.selectedExercise.set(this.exerciseResults().find(exercise => exercise.id === exerciseId) ?? null);
    this.exerciseStats.set(null);
    this.exerciseStatsError.set(null);
    if (exerciseId) await this.loadExerciseStats();
  }

  async loadExerciseStats(): Promise<void> {
    if (!this.auth.isAuthenticated() || !this.selectedExerciseId) return;
    const requestVersion = ++this.exerciseLoadVersion;
    const range = this.selectedWeekRange();
    if (!range) {
      this.exerciseStatsError.set(this.t.t('stats.weekRangeError'));
      return;
    }
    this.exerciseStatsLoading.set(true);
    this.exerciseStatsError.set(null);
    try {
      const stats = await firstValueFrom(this.statisticsApi.exercise(this.selectedExerciseId, {
        from: toCalendarDate(range.start),
        to: toCalendarDate(range.end),
      }));
      if (requestVersion === this.exerciseLoadVersion && this.selectedExerciseId === stats.exerciseId) {
        this.exerciseStats.set(stats);
      }
    } catch {
      if (requestVersion === this.exerciseLoadVersion) {
        this.exerciseStats.set(null);
        this.exerciseStatsError.set(this.t.t('stats.exerciseStatsError'));
      }
    } finally {
      if (requestVersion === this.exerciseLoadVersion) this.exerciseStatsLoading.set(false);
    }
  }

  exerciseName(exercise: ExerciseResponse): string {
    return getExerciseName(exercise, this.t.lang());
  }

  comparisonFor(metric: ComparableMetric): number {
    return this.comparisonChanges()[metric];
  }

  hasPreviousValue(metric: ComparableMetric): boolean {
    return this.previousMetric(metric) !== 0;
  }

  previousMetric(metric: ComparableMetric): number {
    const stats = this.previousStats();
    if (metric === 'workouts') return stats.workoutCount;
    if (metric === 'sets') return stats.totalSets;
    if (metric === 'reps') return stats.totalReps;
    return stats.totalVolume;
  }

  getPeriodRange(period: Period, offset: number): { start: Date; end: Date } {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (period === 'week') {
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const start = new Date(now);
      start.setDate(now.getDate() + diff + (offset * 7));
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  calculateStats(workouts: WorkoutHistory[], start: Date, end: Date): PeriodStats {
    const daily = new Map<string, DailyTrainingPoint>();
    let workoutCount = 0;
    let totalSets = 0;
    let totalReps = 0;
    let totalVolume = 0;

    for (const workout of workouts) {
      const finishedAt = new Date(workout.finishedAt);
      if (finishedAt < start || finishedAt > end) continue;

      workoutCount++;
      const date = toCalendarDate(finishedAt);
      const point = daily.get(date) ?? { date, workouts: 0, sets: 0, reps: 0, volume: 0 };
      point.workouts++;

      for (const exercise of workout.exercises) {
        for (const set of exercise.sets) {
          totalSets++;
          point.sets++;
          const reps = set.reps ?? 0;
          const volume = set.reps !== null && set.weight !== null ? set.reps * set.weight : 0;
          totalReps += reps;
          totalVolume += volume;
          point.reps += reps;
          point.volume += volume;
        }
      }
      daily.set(date, point);
    }

    return {
      workoutCount,
      totalSets,
      totalReps,
      totalVolume,
      dailyDistribution: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  getPeriodLabel(): string {
    const { start, end } = this.getPeriodRange(this.selectedPeriod(), 0);
    const format = (date: Date) => date.toLocaleDateString(this.t.lang(), { day: 'numeric', month: 'short' });
    return `${format(start)} – ${format(end)}`;
  }

  evolutionDescription(): string {
    const stats = this.currentStats();
    return `${this.t.t('stats.evolutionDescription')} ${stats.dailyDistribution
      .map(point => `${this.fullDate(point.date)}: ${formatNumber(point.volume)} kg`)
      .join('; ')}`;
  }

  weekRangeLabel(point: { date: string; to: string } | undefined): string {
    return point ? `${this.shortDate(point.date)} – ${this.shortDate(point.to)}` : '';
  }

  exerciseEvolutionDescription(): string {
    const stats = this.exerciseStats();
    if (!stats) return '';
    return `${this.t.t('stats.exerciseEvolutionDescription')} ${this.exerciseWeeklyProgress()
      .map(point => `${this.weekRangeLabel(point)}: ${formatNumber(point.volume)} kg, ${formatNumber(point.maxWeight)} kg`)
      .join('; ')}`;
  }

  private async loadLocalStats(requestVersion: number): Promise<void> {
    try {
      const rawWorkouts = await WorkoutHistoryRepository.getAll();
      const accountId = this.auth.currentUser?.()?.id;
      const migrated = accountId
        ? await Promise.all(rawWorkouts.map(workout => this.migration.isWorkoutMigrated(accountId, workout.id)))
        : rawWorkouts.map(() => false);
      if (requestVersion !== this.loadVersion || this.source() !== 'local') return;
      const workouts = rawWorkouts.filter((_, index) => !migrated[index]);
      this.localWorkouts = workouts;
      const current = this.getPeriodRange(this.selectedPeriod(), 0);
      const previous = this.getPeriodRange(this.selectedPeriod(), -1);
      const currentStats = this.calculateStats(workouts, current.start, current.end);
      const previousStats = this.calculateStats(workouts, previous.start, previous.end);
      this.currentStats.set(currentStats);
      this.previousStats.set(previousStats);
      this.comparisonChanges.set(calculateChanges(currentStats, previousStats));
      await this.loadWeeklyProgress();
    } catch {
      if (requestVersion !== this.loadVersion) return;
      this.currentStats.set({ ...EMPTY_STATS });
      this.previousStats.set({ ...EMPTY_STATS });
      this.comparisonChanges.set({ ...EMPTY_CHANGES });
      this.error.set(this.t.t('stats.localError'));
    } finally {
      if (requestVersion === this.loadVersion) this.loading.set(false);
    }
  }

  private async loadCloudStats(requestVersion: number): Promise<void> {
    const current = this.getPeriodRange(this.selectedPeriod(), 0);
    const previous = this.getPeriodRange(this.selectedPeriod(), -1);
    const range = { from: toCalendarDate(current.start), to: toCalendarDate(current.end) };

    try {
      const [comparison, evolution] = await Promise.all([
        firstValueFrom(this.statisticsApi.comparison({
          currentFrom: range.from,
          currentTo: range.to,
          previousFrom: toCalendarDate(previous.start),
          previousTo: toCalendarDate(previous.end),
        })),
        firstValueFrom(this.statisticsApi.evolution(range)),
      ]);
      if (requestVersion !== this.loadVersion || this.source() !== 'cloud') return;
      this.currentStats.set(this.cloudPeriodStats(comparison.current, evolution.data));
      this.previousStats.set(this.cloudPeriodStats(comparison.previous, []));
      this.comparisonChanges.set(pickComparableChanges(comparison.changes));
      await this.loadWeeklyProgress();
    } catch {
      if (requestVersion !== this.loadVersion || this.source() !== 'cloud') return;
      this.currentStats.set({ ...EMPTY_STATS });
      this.previousStats.set({ ...EMPTY_STATS });
      this.comparisonChanges.set({ ...EMPTY_CHANGES });
      this.error.set(this.t.t('stats.cloudError'));
    } finally {
      if (requestVersion === this.loadVersion) this.loading.set(false);
    }
  }

  private cloudPeriodStats(summary: StatisticsSummaryResponse, evolution: StatisticsEvolutionPoint[]): PeriodStats {
    return {
      workoutCount: summary.workouts,
      totalSets: summary.sets,
      totalReps: summary.reps,
      totalVolume: summary.volume,
      // The API deliberately omits dates without data. Preserve that shape for the chart.
      dailyDistribution: evolution.map(point => ({
        date: point.date,
        workouts: point.workouts,
        sets: point.sets,
        reps: point.reps,
        volume: point.volume,
      })),
    };
  }

  private lineOptions(twoAxes: boolean): ChartOptions<'line'> {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      animation: { duration: 180 },
      plugins: {
        legend: {
          display: twoAxes,
          position: 'bottom',
          labels: { color: CHART_INK, usePointStyle: true, boxWidth: 8, padding: 18 },
        },
        tooltip: {
          displayColors: twoAxes,
          callbacks: {
            title: items => {
              if (twoAxes) return this.weekRangeLabel(this.exerciseWeeklyProgress()[items[0]?.dataIndex ?? 0]);
              return this.tooltipDate(items[0]?.dataIndex ?? 0, this.currentStats().dailyDistribution);
            },
            label: context => `${context.dataset.label}: ${formatNumber(Number(context.parsed.y ?? 0))} kg`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: CHART_INK, maxRotation: 0, autoSkip: true, maxTicksLimit: twoAxes ? 8 : this.selectedPeriod() === 'week' ? 7 : 8 },
          border: { display: false },
        },
        volume: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          ticks: { color: CHART_INK, maxTicksLimit: 5, callback: value => compactNumber(Number(value)) },
          grid: { color: CHART_GRID },
          border: { display: false },
          title: { display: twoAxes, text: this.t.t('stats.volumeAxis'), color: CHART_CLOUD },
        },
        ...(twoAxes ? {
          weight: {
            type: 'linear' as const,
            position: 'right' as const,
            beginAtZero: true,
            ticks: { color: CHART_INK, maxTicksLimit: 5 },
            grid: { drawOnChartArea: false },
            border: { display: false },
            title: { display: true, text: this.t.t('stats.weightAxis'), color: CHART_INK },
          },
        } : {}),
      },
    };
  }

  private chartDateLabel(date: string): string {
    return parseCalendarDate(date).toLocaleDateString(this.t.lang(), this.selectedPeriod() === 'week'
      ? { weekday: 'short' }
      : { day: 'numeric', month: 'short' });
  }

  private weekLabel(date: string): string {
    return this.shortDate(date);
  }

  private shortDate(date: string): string {
    return parseCalendarDate(date).toLocaleDateString(this.t.lang(), { day: 'numeric', month: 'short' });
  }

  private selectedWeekRange(): { start: Date; end: Date } | null {
    const from = isoWeekBounds(this.weekFrom);
    const to = isoWeekBounds(this.weekTo);
    return from && to && from.start <= to.end ? { start: from.start, end: to.end } : null;
  }

  private tooltipDate(index: number, points: Array<{ date: string }>): string {
    return points[index] ? this.fullDate(points[index].date) : '';
  }

  private fullDate(date: string): string {
    return parseCalendarDate(date).toLocaleDateString(this.t.lang(), { weekday: 'short', day: 'numeric', month: 'short' });
  }

  private clearExerciseSelection(): void {
    this.selectedExerciseId = '';
    this.selectedExercise.set(null);
    this.exerciseStats.set(null);
    this.exerciseStatsError.set(null);
  }
}

/** Formats a calendar date without converting its local day to UTC. */
export function toCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function aggregateTrainingWeeks(points: DailyTrainingPoint[]): WeeklyTrainingPoint[] {
  const weeks = new Map<string, WeeklyTrainingPoint>();
  for (const point of points) {
    const monday = startOfIsoWeek(parseCalendarDate(point.date));
    const date = toCalendarDate(monday);
    const week = weeks.get(date) ?? {
      date,
      to: toCalendarDate(addCalendarDays(monday, 6)),
      workouts: 0,
      sets: 0,
      reps: 0,
      volume: 0,
    };
    week.workouts += point.workouts;
    week.sets += point.sets;
    week.reps += point.reps;
    week.volume += point.volume;
    weeks.set(date, week);
  }
  return [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateExerciseWeeks(points: Array<{ date: string; volume: number; maxWeight: number }>): WeeklyExercisePoint[] {
  const weeks = new Map<string, WeeklyExercisePoint>();
  for (const point of points) {
    const monday = startOfIsoWeek(parseCalendarDate(point.date));
    const date = toCalendarDate(monday);
    const week = weeks.get(date) ?? {
      date,
      to: toCalendarDate(addCalendarDays(monday, 6)),
      volume: 0,
      maxWeight: 0,
    };
    week.volume += point.volume;
    week.maxWeight = Math.max(week.maxWeight, point.maxWeight);
    weeks.set(date, week);
  }
  return [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function toIsoWeek(date: Date): string {
  const thursday = addCalendarDays(startOfIsoWeek(date), 3);
  const weekYear = thursday.getFullYear();
  const firstThursday = addCalendarDays(startOfIsoWeek(new Date(weekYear, 0, 4)), 3);
  const week = 1 + Math.round((calendarDayNumber(thursday) - calendarDayNumber(firstThursday)) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

function isoWeekBounds(value: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const start = addCalendarDays(startOfIsoWeek(new Date(year, 0, 4)), (week - 1) * 7);
  if (toIsoWeek(start) !== value) return null;
  const end = addCalendarDays(start, 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function startOfIsoWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function calendarDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function pickComparableChanges(changes: StatisticsChanges): Record<ComparableMetric, number> {
  return { workouts: changes.workouts, sets: changes.sets, reps: changes.reps, volume: changes.volume };
}

function calculateChanges(current: PeriodStats, previous: PeriodStats): Record<ComparableMetric, number> {
  return {
    workouts: percentageChange(current.workoutCount, previous.workoutCount),
    sets: percentageChange(current.totalSets, previous.totalSets),
    reps: percentageChange(current.totalReps, previous.totalReps),
    volume: percentageChange(current.totalVolume, previous.totalVolume),
  };
}

function percentageChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}
