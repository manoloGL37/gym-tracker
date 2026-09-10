import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { RoutinesRepository, Routine } from '../../data/active-training.repository';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { ExercisePageResponse, ExerciseResponse } from '../../exercises/exercise-api.models';
import { getExerciseName } from '../../exercises/exercise-domain';
import { RoutineApiService } from '../../routines/routine-api.service';
import { RoutineResponse } from '../../routines/routine-api.models';
import { CloudRoutineDraft, cloudDraftFromResponse, cloudExerciseDraft, newCloudRoutineDraft, RoutineListItem, toCreateRoutineRequest } from '../../routines/routine-domain';
import { TranslationService } from '../../services/translation.service';

@Component({ selector: 'app-routines', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './routines.component.html', styleUrls: ['./routines.component.css'] })
export class RoutinesComponent {
  readonly t = inject(TranslationService);
  readonly auth = inject(AuthSessionService);
  private readonly routineApi = inject(RoutineApiService);
  private readonly exerciseApi = inject(ExerciseApiService);

  routines: RoutineListItem[] = [];
  loading = true;
  cloudLoading = false;
  saving = signal(false);
  error = signal<string | null>(null);
  cloudPageNumber = 0;
  cloudTotalPages = 0;
  readonly cloudPageSize = 10;

  editingLocal: Routine | null = null;
  editingCloud: RoutineResponse | null = null;
  localName = '';
  localExercises: { id: string; name: string; setsCount: number }[] = [];
  cloudDraft: CloudRoutineDraft = newCloudRoutineDraft();

  selectorOpen = false;
  selectorLoading = false;
  selectorError = signal<string | null>(null);
  selectorPage = signal<ExercisePageResponse | null>(null);
  selectorSearch = '';
  selectorPageNumber = 0;

  constructor() {
    effect(() => void this.loadRoutines());
  }

  get isCloudEditor(): boolean {
    // Keep an already-open cloud detail cloud if a token expires; never redirect its save into Dexie.
    return this.editingCloud !== null || (this.auth.isAuthenticated() && this.editingLocal === null);
  }

  routineKey(item: RoutineListItem): string { return `${item.source}:${item.routine.id}`; }

  async loadRoutines(page = this.cloudPageNumber): Promise<void> {
    this.loading = true;
    const localItems: RoutineListItem[] = (await RoutinesRepository.getAll()).map(routine => ({ source: 'local', routine }));
    if (!this.auth.isAuthenticated()) {
      this.routines = localItems;
      this.loading = false;
      return;
    }

    this.cloudLoading = true;
    this.error.set(null);
    try {
      const cloud = await firstValueFrom(this.routineApi.list({ page, size: this.cloudPageSize }));
      this.cloudPageNumber = cloud.number;
      this.cloudTotalPages = cloud.totalPages;
      this.routines = [...localItems, ...cloud.content.map(routine => ({ source: 'cloud' as const, routine }))];
    } catch (error) {
      // Local data is independent of the cloud request and must remain on screen on failure.
      this.routines = localItems;
      this.error.set(routineErrorMessage(error));
    } finally {
      this.cloudLoading = false;
      this.loading = false;
    }
  }

  startCreate(): void {
    this.error.set(null);
    this.editingLocal = null;
    this.editingCloud = null;
    this.localName = '';
    this.localExercises = [];
    if (this.auth.isAuthenticated()) this.cloudDraft = newCloudRoutineDraft();
  }

  async startEdit(item: RoutineListItem): Promise<void> {
    this.error.set(null);
    if (item.source === 'local') {
      this.editingCloud = null;
      this.editingLocal = { ...item.routine };
      this.localName = item.routine.name;
      this.localExercises = item.routine.exercises.map(exercise => ({ ...exercise }));
      return;
    }
    this.saving.set(true);
    try {
      const detail = await firstValueFrom(this.routineApi.get(item.routine.id));
      this.editingLocal = null;
      this.editingCloud = detail;
      this.cloudDraft = cloudDraftFromResponse(detail, await this.loadCloudExerciseNames(detail));
    } catch (error) {
      this.error.set(routineErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  addLocalExerciseBlock(): void { this.localExercises.push({ id: crypto.randomUUID(), name: '', setsCount: 3 }); }
  removeLocalExercise(index: number): void { this.localExercises.splice(index, 1); }

  async saveRoutine(): Promise<void> {
    if (this.isCloudEditor) await this.saveCloudRoutine();
    else await this.saveLocalRoutine();
  }

  private async saveLocalRoutine(): Promise<void> {
    if (!this.localName.trim() || !this.localExercises.length) return;
    const routine: Routine = this.editingLocal
      ? { ...this.editingLocal, name: this.localName, exercises: this.localExercises.map(exercise => ({ ...exercise })) }
      : { id: crypto.randomUUID(), name: this.localName, exercises: this.localExercises.map(exercise => ({ ...exercise })) };
    if (this.editingLocal) await RoutinesRepository.update(routine);
    else await RoutinesRepository.add(routine);
    this.cancelEdit();
    await this.loadRoutines();
  }

  private async saveCloudRoutine(): Promise<void> {
    if (!this.cloudDraft.name.trim()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const request = toCreateRoutineRequest(this.cloudDraft);
      if (this.editingCloud) await firstValueFrom(this.routineApi.update(this.editingCloud.id, request));
      else await firstValueFrom(this.routineApi.create(request));
      await this.loadRoutines();
      this.cancelEdit();
    } catch (error) {
      // Keep the same draft/clientId so a network retry remains idempotent.
      this.error.set(routineErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  async deleteRoutine(item: RoutineListItem): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      if (item.source === 'local') await RoutinesRepository.delete(item.routine.id);
      else await firstValueFrom(this.routineApi.delete(item.routine.id));
      await this.loadRoutines();
    } catch (error) {
      this.error.set(routineErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  cancelEdit(): void {
    this.editingLocal = null;
    this.editingCloud = null;
    this.localName = '';
    this.localExercises = [];
    this.cloudDraft = newCloudRoutineDraft();
    this.closeSelector();
  }

  async openSelector(): Promise<void> { this.selectorOpen = true; await this.loadSelectorPage(0); }
  async searchSelector(): Promise<void> { await this.loadSelectorPage(0); }
  async loadSelectorPage(page: number): Promise<void> {
    this.selectorLoading = true;
    this.selectorError.set(null);
    try {
      const response = await firstValueFrom(this.exerciseApi.list({ page, size: 10, search: this.selectorSearch.trim() || undefined }));
      this.selectorPage.set(response);
      this.selectorPageNumber = response.page;
    } catch (error) {
      this.selectorError.set(routineErrorMessage(error));
    } finally {
      this.selectorLoading = false;
    }
  }
  selectCloudExercise(exercise: ExerciseResponse): void { this.cloudDraft.exercises.push(cloudExerciseDraft(exercise, this.t.lang())); this.closeSelector(); }
  removeCloudExercise(index: number): void { this.cloudDraft.exercises.splice(index, 1); }
  closeSelector(): void { this.selectorOpen = false; this.selectorError.set(null); }
  async previousCloudPage(): Promise<void> { if (this.cloudPageNumber > 0) await this.loadRoutines(this.cloudPageNumber - 1); }
  async nextCloudPage(): Promise<void> { if (this.cloudPageNumber + 1 < this.cloudTotalPages) await this.loadRoutines(this.cloudPageNumber + 1); }
  async previousSelectorPage(): Promise<void> { if (this.selectorPageNumber > 0) await this.loadSelectorPage(this.selectorPageNumber - 1); }
  async nextSelectorPage(): Promise<void> { const page = this.selectorPage(); if (page && this.selectorPageNumber + 1 < page.totalPages) await this.loadSelectorPage(this.selectorPageNumber + 1); }
  exerciseName(exercise: ExerciseResponse): string { return getExerciseName(exercise, this.t.lang()); }

  private async loadCloudExerciseNames(routine: RoutineResponse): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    await Promise.all(routine.exercises.map(async exercise => {
      try {
        const catalogExercise = await firstValueFrom(this.exerciseApi.get(exercise.exerciseId));
        names.set(exercise.exerciseId, this.exerciseName(catalogExercise));
      } catch {
        // A missing catalog label never changes the UUID sent back to the routine API.
      }
    }));
    return names;
  }
}

function routineErrorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500) return 'No se pudo contactar con la nube. Tus rutinas locales siguen disponibles; inténtalo de nuevo.';
  if (error.status === 401) return 'La sesión ha caducado. Inicia sesión de nuevo para usar las rutinas cloud.';
  if (error.status === 403) return 'No tienes permiso para esta rutina cloud.';
  if (error.status === 404) return 'La rutina o alguno de sus ejercicios ya no está disponible en la nube.';
  if (error.status === 400) return 'El servidor rechazó los datos de la rutina. Revisa los campos.';
  return 'No se pudo completar la operación cloud.';
}
