/** Exact DTOs and query values exposed by /api/statistics. Dates are backend LocalDate strings. */
export type StatisticsDate = string;
export type ExerciseStatisticsId = string;

export interface StatisticsDateRange {
  /** Required LocalDate, YYYY-MM-DD. The backend includes both calendar endpoints. */
  from: StatisticsDate;
  to: StatisticsDate;
}

export interface StatisticsSummaryResponse extends StatisticsDateRange {
  workouts: number;
  sets: number;
  reps: number;
  volume: number;
  maxWeight: number;
}

export interface StatisticsChanges {
  workouts: number;
  sets: number;
  reps: number;
  volume: number;
  maxWeight: number;
}

export interface StatisticsComparisonParams {
  currentFrom: StatisticsDate;
  currentTo: StatisticsDate;
  previousFrom: StatisticsDate;
  previousTo: StatisticsDate;
}

export interface StatisticsComparisonResponse {
  current: StatisticsSummaryResponse;
  previous: StatisticsSummaryResponse;
  changes: StatisticsChanges;
}

export interface StatisticsEvolutionPoint {
  date: StatisticsDate;
  workouts: number;
  sets: number;
  reps: number;
  volume: number;
  maxWeight: number;
}

export interface StatisticsEvolutionResponse extends StatisticsDateRange {
  /** Non-null, ascending date order and not zero-filled by the server. */
  data: StatisticsEvolutionPoint[];
}

export interface ExerciseStatisticsEvolutionPoint {
  date: StatisticsDate;
  volume: number;
  maxWeight: number;
}

export interface ExerciseStatisticsResponse extends StatisticsDateRange {
  exerciseId: ExerciseStatisticsId;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  maxWeight: number;
  /** Non-null, ascending date order; empty for no caller data. */
  evolution: ExerciseStatisticsEvolutionPoint[];
}
