import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LocalToCloudMigrationService } from '../migration/local-to-cloud-migration.service';
import { ResourceMapping } from '../migration/local-to-cloud-migration.models';
import { RoutineApiService } from '../routines/routine-api.service';
import { RoutineListItem } from '../routines/routine-domain';
import { RoutinePageResponse, RoutineSummaryResponse } from '../routines/routine-api.models';
import { WorkoutApiService } from '../workouts/workout-api.service';
import { WorkoutPageResponse, WorkoutResponse } from '../workouts/workout-api.models';
import { AccountReadCacheRepository, RoutinesRepository, WorkoutHistoryRepository } from './active-training.repository';
import { WorkoutHistory } from './workout-history.model';

export type RemoteReadState = 'local' | 'refreshing' | 'confirmed' | 'unavailable';

export interface RoutineReadModel {
  items: RoutineListItem[];
  remoteState: RemoteReadState;
  pageNumber: number;
  totalPages: number;
}

export interface WorkoutReadItem {
  source: 'local' | 'cloud';
  id: string;
  routineName: string;
  startedAt: string;
  finishedAt: string | null;
  exerciseCount: number;
  local?: WorkoutHistory;
  cloud?: WorkoutResponse;
  serverRepresented?: boolean;
}

export interface WorkoutReadModel {
  items: WorkoutReadItem[];
  remoteState: RemoteReadState;
  pageNumber: number;
  totalPages: number;
}

@Injectable({ providedIn: 'root' })
export class LocalFirstReadService {
  private readonly migration = inject(LocalToCloudMigrationService);
  private readonly routinesApi = inject(RoutineApiService);
  private readonly workoutsApi = inject(WorkoutApiService);

  async routineSnapshot(accountId: string | null): Promise<RoutineReadModel> {
    const local = accountId ? await this.migration.getAccountLocalRoutines(accountId) : await RoutinesRepository.getAll();
    if (!accountId) return { items: local.map(routine => ({ source: 'local', routine })), remoteState: 'local', pageNumber: 0, totalPages: 0 };
    const [cache, mappings] = await Promise.all([
      AccountReadCacheRepository.getRoutines(accountId),
      this.migration.getRoutineMappings(accountId),
    ]);
    return this.routineModel(local, cache?.page, mappings, 'refreshing');
  }

  async refreshRoutines(accountId: string, page = 0, size = 10): Promise<RoutineReadModel> {
    const response = await firstValueFrom(this.routinesApi.list({ page, size }));
    if (page === 0) await AccountReadCacheRepository.saveRoutines(accountId, response);
    const [local, mappings] = await Promise.all([
      this.migration.getAccountLocalRoutines(accountId),
      this.migration.getRoutineMappings(accountId),
    ]);
    return this.routineModel(local, response, mappings, 'confirmed');
  }

  async workoutSnapshot(accountId: string | null): Promise<WorkoutReadModel> {
    const local = accountId ? await this.migration.getAccountLocalWorkouts(accountId) : await WorkoutHistoryRepository.getAll();
    if (!accountId) return { items: local.map(workout => toLocalWorkout(workout)), remoteState: 'local', pageNumber: 0, totalPages: 0 };
    const [cache, mappings] = await Promise.all([
      AccountReadCacheRepository.getWorkouts(accountId),
      this.migration.getWorkoutMappings(accountId),
    ]);
    return this.workoutModel(local, cache?.page, cache?.routineNames ?? {}, mappings, 'refreshing');
  }

  async refreshWorkouts(accountId: string, page = 0, size = 10): Promise<WorkoutReadModel> {
    const response = await firstValueFrom(this.workoutsApi.list({ page, size }));
    const routineNames = await this.loadRoutineNames(response);
    if (page === 0) await AccountReadCacheRepository.saveWorkouts(accountId, response, routineNames);
    const [local, mappings] = await Promise.all([
      this.migration.getAccountLocalWorkouts(accountId),
      this.migration.getWorkoutMappings(accountId),
    ]);
    return this.workoutModel(local, response, routineNames, mappings, 'confirmed');
  }

  private routineModel(
    local: Awaited<ReturnType<typeof RoutinesRepository.getAll>>,
    remote: RoutinePageResponse | undefined,
    mappings: Record<string, ResourceMapping>,
    remoteState: RemoteReadState,
  ): RoutineReadModel {
    const cloud = uniqueRemote(remote?.content ?? []);
    const visibleLocal = local.filter(routine => !representedRemotely(mappings[routine.id], cloud));
    return {
      items: [...cloud.map(routine => ({ source: 'cloud' as const, routine })), ...visibleLocal.map(routine => ({ source: 'local' as const, routine }))],
      remoteState,
      pageNumber: remote?.number ?? 0,
      totalPages: remote?.totalPages ?? 0,
    };
  }

  private workoutModel(
    local: WorkoutHistory[],
    remote: WorkoutPageResponse | undefined,
    routineNames: Record<string, string>,
    mappings: Record<string, ResourceMapping>,
    remoteState: RemoteReadState,
  ): WorkoutReadModel {
    const cloud = uniqueRemote(remote?.content ?? []);
    const visibleLocal = local.filter(workout => !representedRemotely(mappings[workout.id], cloud));
    const cloudItems = cloud.map(workout => toCloudWorkout(workout, routineNames[workout.routineId ?? '']));
    return {
      items: [...cloudItems, ...visibleLocal.map(workout => toLocalWorkout(workout, mappings[workout.id]))].sort(byNewestWorkout),
      remoteState,
      pageNumber: remote?.number ?? 0,
      totalPages: remote?.totalPages ?? 0,
    };
  }

  private async loadRoutineNames(page: WorkoutPageResponse): Promise<Record<string, string>> {
    const ids = [...new Set(page.content.map(workout => workout.routineId).filter((id): id is string => Boolean(id)))];
    const entries = await Promise.all(ids.map(async id => {
      try { return [id, (await firstValueFrom(this.routinesApi.get(id))).name] as const; }
      catch { return [id, 'Rutina sin nombre'] as const; }
    }));
    return Object.fromEntries(entries);
  }
}

function representedRemotely<T extends { id: string; clientId: string | null }>(mapping: ResourceMapping | undefined, remote: T[]): boolean {
  if (!mapping) return false;
  return remote.some(item => item.id === mapping.serverId || Boolean(item.clientId && item.clientId === mapping.clientId));
}

function uniqueRemote<T extends { id: string; clientId: string | null }>(items: T[]): T[] {
  const seenIds = new Set<string>();
  const seenClientIds = new Set<string>();
  return items.filter(item => {
    if (seenIds.has(item.id) || Boolean(item.clientId && seenClientIds.has(item.clientId))) return false;
    seenIds.add(item.id);
    if (item.clientId) seenClientIds.add(item.clientId);
    return true;
  });
}

function toLocalWorkout(workout: WorkoutHistory, mapping?: ResourceMapping): WorkoutReadItem {
  return {
    source: 'local', id: workout.id, routineName: workout.routineName, startedAt: workout.startedAt,
    finishedAt: workout.finishedAt, exerciseCount: workout.exercises.length, local: workout,
    serverRepresented: Boolean(mapping?.serverId || mapping?.status === 'migrated'),
  };
}

function toCloudWorkout(workout: WorkoutResponse, routineName = 'Rutina sin nombre'): WorkoutReadItem {
  return { source: 'cloud', id: workout.id, routineName, startedAt: workout.startedAt, finishedAt: workout.completedAt, exerciseCount: workout.exercises.length, cloud: workout };
}

function byNewestWorkout(a: WorkoutReadItem, b: WorkoutReadItem): number {
  return new Date(b.finishedAt ?? b.startedAt).getTime() - new Date(a.finishedAt ?? a.startedAt).getTime();
}
