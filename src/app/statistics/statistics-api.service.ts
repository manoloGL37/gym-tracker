import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ExerciseStatisticsId, ExerciseStatisticsResponse, StatisticsComparisonParams, StatisticsComparisonResponse, StatisticsDateRange, StatisticsEvolutionResponse, StatisticsSummaryResponse } from './statistics-api.models';

/** Raw backend statistics access. It deliberately contains no chart or source-selection state. */
@Injectable({ providedIn: 'root' })
export class StatisticsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/statistics`;

  summary(range: StatisticsDateRange): Observable<StatisticsSummaryResponse> {
    return this.http.get<StatisticsSummaryResponse>(`${this.baseUrl}/summary`, { params: rangeParams(range) });
  }

  comparison(params: StatisticsComparisonParams): Observable<StatisticsComparisonResponse> {
    return this.http.get<StatisticsComparisonResponse>(`${this.baseUrl}/comparison`, {
      params: new HttpParams()
        .set('currentFrom', params.currentFrom)
        .set('currentTo', params.currentTo)
        .set('previousFrom', params.previousFrom)
        .set('previousTo', params.previousTo),
    });
  }

  evolution(range: StatisticsDateRange): Observable<StatisticsEvolutionResponse> {
    return this.http.get<StatisticsEvolutionResponse>(`${this.baseUrl}/evolution`, { params: rangeParams(range) });
  }

  exercise(exerciseId: ExerciseStatisticsId, range: StatisticsDateRange): Observable<ExerciseStatisticsResponse> {
    return this.http.get<ExerciseStatisticsResponse>(`${this.baseUrl}/exercises/${exerciseId}`, { params: rangeParams(range) });
  }
}

function rangeParams(range: StatisticsDateRange): HttpParams {
  return new HttpParams().set('from', range.from).set('to', range.to);
}
