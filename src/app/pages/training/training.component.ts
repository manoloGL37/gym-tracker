import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActiveTraining } from './training.model';
import { ActiveTrainingRepository, CloudActiveTrainingRepository, WorkoutHistoryRepository, SelectedRoutineRepository, RoutinesRepository } from '../../data/active-training.repository';
import { WorkoutHistory } from '../../data/workout-history.model';
import { TranslationService } from '../../services/translation.service';
import { AuthSessionService } from '../../auth/auth-session.service';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { getExerciseName } from '../../exercises/exercise-domain';
import { WorkoutApiService } from '../../workouts/workout-api.service';
import { CloudActiveExercise, CloudActiveTraining, cloudActiveFromWorkout, newCloudSetDraft, toBackendLocalDateTime } from '../../workouts/workout-domain';
import { WorkoutResponse } from '../../workouts/workout-api.models';

@Component({ selector: 'app-training', standalone: true, imports: [FormsModule, DecimalPipe], templateUrl: './training.component.html', styleUrls: ['./training.component.css'], changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingComponent implements OnInit, OnDestroy {
  training: ActiveTraining | null = null;
  cloudTraining: CloudActiveTraining | null = null;
  loading = true;
  previousWorkouts: WorkoutHistory[] = [];
  previousCloudWorkouts: WorkoutResponse[] = [];
  showConfirmFinish = false;
  cloudError: string | null = null;
  cloudSaving = false;
  now = Date.now();
  private clock: ReturnType<typeof setInterval> | null = null;
  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  t = inject(TranslationService);
  private readonly auth = inject(AuthSessionService);
  private readonly workoutApi = inject(WorkoutApiService);
  private readonly exerciseApi = inject(ExerciseApiService);

  constructor(private router: Router) {}

  async ngOnInit() {
    this.startClock();
    this.previousWorkouts = await WorkoutHistoryRepository.getAll();
    const local = await ActiveTrainingRepository.get();
    if (local) { this.training = local; this.loading = false; this.cdr.markForCheck(); return; }

    const cloud = await CloudActiveTrainingRepository.get();
    if (cloud) {
      this.cloudTraining = cloud;
      this.loading = false;
      void this.refreshCloudTraining(cloud);
      void this.loadCloudBenchmarks(cloud.workoutId);
      this.cdr.markForCheck();
      return;
    }

    const selected = await SelectedRoutineRepository.get();
    if (!selected) { this.loading = false; return; }
    if (selected.source === 'cloud') {
      await this.startCloudTraining(selected.routineId, selected.routineName, selected.workoutClientId);
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }
    const routine = await RoutinesRepository.get(selected.routineId);
    if (routine) {
      const now = new Date().toISOString();
      this.training = { id: 'active', routineId: routine.id, routineName: routine.name, startedAt: now,
        exercises: routine.exercises.map(ex => ({ exerciseId: ex.id, name: ex.name, sets: Array.from({ length: ex.setsCount }).map((_, j) => ({ setIndex: j, reps: null, weight: null })) })), };
      await ActiveTrainingRepository.save(this.training);
    }
    this.loading = false;
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void { if (this.clock) clearInterval(this.clock); }

  private startClock(): void {
    this.zone.runOutsideAngular(() => {
      this.clock = setInterval(() => {
        this.now = Date.now();
        this.cdr.markForCheck();
      }, 1_000);
    });
  }

  completedSetCount(): number {
    if (this.training) return this.training.exercises.flatMap(exercise => exercise.sets).filter(set => set.reps !== null && set.weight !== null).length;
    return this.cloudTraining?.exercises.flatMap(exercise => exercise.sets).filter(set => set.persisted).length ?? 0;
  }

  totalSetCount(): number {
    return this.training?.exercises.flatMap(exercise => exercise.sets).length ?? this.cloudTraining?.exercises.flatMap(exercise => exercise.sets).length ?? 0;
  }

  exerciseHasPendingSets(exercise: ActiveTraining['exercises'][number]): boolean {
    return exercise.sets.some(set => set.reps === null || set.weight === null);
  }

  exerciseNumber(index: number): string { return (index + 1).toString().padStart(2, '0'); }

  elapsed(): string {
    const startedAt = this.training?.startedAt ?? this.cloudTraining?.startedAt;
    if (!startedAt) return '00:00';
    const seconds = Math.max(0, Math.floor((this.now - new Date(startedAt).getTime()) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private async startCloudTraining(routineId: string, routineName: string, clientId: string): Promise<void> {
    this.cloudSaving = true;
    try {
      const workout = await firstValueFrom(this.workoutApi.create({ clientId, routineId, startedAt: toBackendLocalDateTime(new Date()), completedAt: null, notes: null }));
      const names = await this.loadExerciseNames(workout.exercises.map(exercise => exercise.exerciseId));
      this.cloudTraining = cloudActiveFromWorkout(workout, routineName, names);
      await CloudActiveTrainingRepository.save(this.cloudTraining);
      await SelectedRoutineRepository.clear();
      await this.loadCloudBenchmarks(workout.id);
    } catch (error) {
      // The selected routine/clientId remains in Dexie, so a retry cannot duplicate an ambiguous POST.
      this.cloudError = cloudErrorMessage(error);
    } finally { this.cloudSaving = false; }
  }
  async retryCloudStart(): Promise<void> {
    const selected = await SelectedRoutineRepository.get();
    if (selected?.source === 'cloud') await this.startCloudTraining(selected.routineId, selected.routineName, selected.workoutClientId);
  }

  private async refreshCloudTraining(cached: CloudActiveTraining): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    try {
      const workout = await firstValueFrom(this.workoutApi.get(cached.workoutId));
      if (workout.completedAt !== null) { await CloudActiveTrainingRepository.clear(); this.cloudTraining = null; return; }
      const names = await this.loadExerciseNames(workout.exercises.map(exercise => exercise.exerciseId));
      const fresh = cloudActiveFromWorkout(workout, cached.routineName, names);
      for (const exercise of fresh.exercises) {
        const cachedExercise = cached.exercises.find(value => value.id === exercise.id);
        if (cachedExercise) {
          const confirmedClientIds = new Set(exercise.sets.map(set => set.clientId));
          exercise.sets.push(...cachedExercise.sets.filter(set => !set.persisted && !confirmedClientIds.has(set.clientId)));
        }
      }
      this.cloudTraining = fresh;
      await CloudActiveTrainingRepository.save(fresh);
      await this.loadCloudBenchmarks(fresh.workoutId);
    } catch (error) { this.cloudError = cloudErrorMessage(error); }
  }

  /** The API has no per-exercise history endpoint, so paginate workouts and match by stable exercise UUID. */
  private async loadCloudBenchmarks(activeWorkoutId: string): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    try {
      const first = await firstValueFrom(this.workoutApi.list({ page: 0, size: 100 }));
      const pages = await Promise.all(Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
        firstValueFrom(this.workoutApi.list({ page: index + 1, size: 100 }))));
      this.previousCloudWorkouts = [first, ...pages]
        .flatMap(page => page.content)
        .filter(workout => workout.id !== activeWorkoutId && workout.completedAt !== null)
        .sort((a, b) => new Date(b.completedAt ?? b.startedAt).getTime() - new Date(a.completedAt ?? a.startedAt).getTime());
      this.cdr.markForCheck();
    } catch {
      // Benchmarks are an enhancement: a history failure must not block a usable active workout.
      this.previousCloudWorkouts = [];
    }
  }

  private async loadExerciseNames(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    await Promise.all(ids.map(async id => {
      try { names.set(id, getExerciseName(await firstValueFrom(this.exerciseApi.get(id)), this.t.lang())); } catch { /* UUID fallback is safer than name matching. */ }
    }));
    return names;
  }

  getLastSetReference(exerciseName: string, setIndex: number): { reps: number|null, weight: number|null } | null {
    for (const workout of this.previousWorkouts) {
      const ex = workout.exercises.find(e => e.name === exerciseName);
      const set = ex?.sets.find(s => s.setIndex === setIndex);
      if (set && (set.reps !== null || set.weight !== null)) return { reps: set.reps, weight: set.weight };
    }
    return null;
  }
  getCloudLastSetReference(exerciseId: string, setNumber: number): { reps: number, weight: number } | null {
    for (const workout of this.previousCloudWorkouts) {
      const set = workout.exercises.find(exercise => exercise.exerciseId === exerciseId)?.sets.find(value => value.setNumber === setNumber);
      if (set) return { reps: set.reps, weight: set.weight };
    }
    return null;
  }
  getSuggestedSetTarget(exerciseName: string, setIndex: number): { reps: number; weight: number } | null {
    const last = this.getLastSetReference(exerciseName, setIndex);
    if (!last?.reps || !last?.weight) return null;
    return last.reps < 12 ? { reps: last.reps + 1, weight: last.weight } : { reps: 8, weight: this.roundToNearestIncrement(last.weight + 2.5) };
  }
  isEstimatedRecord(exerciseName: string, reps: number | null, weight: number | null): boolean {
    if (!reps || !weight) return false;
    const previous = this.previousWorkouts.flatMap(workout => workout.exercises.filter(ex => ex.name === exerciseName).flatMap(ex => ex.sets)).reduce((best, set) => set.reps && set.weight ? Math.max(best, this.estimateOneRepMax(set.reps, set.weight)) : best, 0);
    return previous > 0 && this.estimateOneRepMax(reps, weight) > previous;
  }
  getLastObservation(exerciseName: string): string | null {
    for (const workout of this.previousWorkouts) {
      const observation = workout.exercises.find(exercise => exercise.name === exerciseName)?.observation?.trim();
      if (observation) return observation;
    }
    return null;
  }
  private estimateOneRepMax(reps: number, weight: number): number { return weight * (1 + reps / 30); }
  private roundToNearestIncrement(value: number): number { return Math.round(value * 2) / 2; }

  async onSetChange() { if (this.training) await ActiveTrainingRepository.save(this.training); }
  async onCloudChange() { if (this.cloudTraining) await CloudActiveTrainingRepository.save(this.cloudTraining); }
  addCloudSet(exercise: CloudActiveExercise): void { exercise.sets.push(newCloudSetDraft(exercise)); void this.onCloudChange(); }
  isCloudSetComplete(set: { reps: number | null; weight: number | null }): boolean { return set.reps !== null && set.reps >= 1 && set.weight !== null && set.weight >= 0; }
  async saveCloudSet(exercise: CloudActiveExercise, setIndex: number): Promise<void> {
    const training = this.cloudTraining;
    const set = exercise.sets[setIndex];
    if (!training || !set || set.persisted || !this.isCloudSetComplete(set)) return;
    set.saving = true; this.cloudError = null; await this.onCloudChange();
    try {
      const persisted = await firstValueFrom(this.workoutApi.createSet(training.workoutId, exercise.id, { clientId: set.clientId, setNumber: set.setNumber, weight: Number(set.weight), reps: Number(set.reps), rpe: set.rpe }));
      set.persisted = persisted; set.setNumber = persisted.setNumber; set.reps = persisted.reps; set.weight = persisted.weight; set.rpe = persisted.rpe;
    } catch (error) { this.cloudError = cloudErrorMessage(error); }
    finally { set.saving = false; await this.onCloudChange(); }
  }
  async saveCloudNotes(): Promise<void> {
    if (!this.cloudTraining) return;
    this.cloudSaving = true; this.cloudError = null;
    try {
      const workout = await firstValueFrom(this.workoutApi.update(this.cloudTraining.workoutId, { notes: this.cloudTraining.notes?.trim() || undefined }));
      this.cloudTraining.notes = workout.notes;
    } catch (error) { this.cloudError = cloudErrorMessage(error); }
    finally { this.cloudSaving = false; await this.onCloudChange(); }
  }

  hasIncompleteSets(): boolean { return this.training?.exercises.some(exercise => exercise.sets.some(set => set.reps === null || set.weight === null)) ?? false; }
  hasUnsubmittedCloudSets(): boolean { return this.cloudTraining?.exercises.some(exercise => exercise.sets.some(set => !set.persisted && (set.reps !== null || set.weight !== null || set.rpe !== null))) ?? false; }
  requestFinish() { this.showConfirmFinish = true; }
  cancelFinish() { this.showConfirmFinish = false; }
  async confirmFinish() {
    if (this.training) {
      const finishedAt = new Date().toISOString(); const { id, ...rest } = this.training;
      await WorkoutHistoryRepository.add({ id: `${this.training.startedAt}-${finishedAt}`, ...rest, finishedAt });
      await ActiveTrainingRepository.clear(); this.router.navigate(['/home']); return;
    }
    if (!this.cloudTraining || this.hasUnsubmittedCloudSets()) { if (this.hasUnsubmittedCloudSets()) this.cloudError = 'Guarda o elimina los borradores de series antes de finalizar.'; return; }
    this.cloudSaving = true; this.cloudError = null;
    try {
      // PATCH completed:true is the documented completion action; server supplies completedAt and preserves startedAt.
      const workout = await firstValueFrom(this.workoutApi.update(this.cloudTraining.workoutId, { completed: true }));
      if (workout.completedAt === null) throw new Error('Workout completion was not confirmed');
      await CloudActiveTrainingRepository.clear(); await SelectedRoutineRepository.clear(); this.cloudTraining = null; this.router.navigate(['/calendar']);
    } catch (error) { this.cloudError = cloudErrorMessage(error); }
    finally { this.cloudSaving = false; this.showConfirmFinish = false; }
  }
}

function cloudErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 401) return 'La sesión ha caducado. El entrenamiento y los borradores se conservan en este dispositivo hasta que vuelvas a iniciar sesión.';
  if (!(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500) return 'No se pudo contactar con la nube. No se ha descartado ningún dato; inténtalo de nuevo.';
  if (error instanceof HttpErrorResponse && error.status === 400) return 'El servidor rechazó la serie. Revisa repeticiones, peso, RPE y número de serie.';
  return 'No se pudo guardar el entrenamiento cloud.';
}
