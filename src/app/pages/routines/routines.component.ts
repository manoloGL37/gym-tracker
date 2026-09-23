import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, effect, ElementRef, inject, Injector, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { RoutinesRepository, Routine } from '../../data/active-training.repository';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { ExercisePageResponse, ExerciseResponse } from '../../exercises/exercise-api.models';
import { createCustomExerciseDraft, getExerciseName, isCustomExerciseDraftValid, toCreateExerciseRequest } from '../../exercises/exercise-domain';
import { RoutineApiService } from '../../routines/routine-api.service';
import { RoutineResponse } from '../../routines/routine-api.models';
import { CloudRoutineDraft, cloudDraftFromResponse, cloudExerciseDraft, newCloudRoutineDraft, RoutineListItem, toCreateRoutineRequest } from '../../routines/routine-domain';
import { TranslationService } from '../../services/translation.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { LocalFirstReadService, RemoteReadState } from '../../data/local-first-read.service';

@Component({ selector: 'app-routines', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './routines.component.html', styleUrls: ['./routines.component.css'] })
export class RoutinesComponent {
  readonly t = inject(TranslationService);
  readonly auth = inject(AuthSessionService);
  private readonly routineApi = inject(RoutineApiService);
  private readonly exerciseApi = inject(ExerciseApiService);
  private readonly accountSync = inject(AccountSyncService);
  private readonly reads = inject(LocalFirstReadService);
  private readonly injector = inject(Injector);
  private loadId = 0;
  private snapshotAccountId: string | null | undefined;

  routines: RoutineListItem[] = [];
  loading = true;
  cloudLoading = false;
  saving = signal(false);
  error = signal<string | null>(null);
  cloudPageNumber = 0;
  cloudTotalPages = 0;
  remoteState: RemoteReadState = 'local';
  readonly cloudPageSize = 10;

  editingLocal: Routine | null = null;
  editingCloud: RoutineResponse | null = null;
  localName = '';
  localExercises: { id: string; name: string; setsCount: number }[] = [];
  cloudDraft: CloudRoutineDraft = newCloudRoutineDraft();
  editorOpen = false;
  editorLoading = false;
  editingRoutineName = '';

  @ViewChild('routineEditorTitle') private routineEditorTitle?: ElementRef<HTMLElement>;

  selectorOpen = false;
  selectorLoading = false;
  selectorError = signal<string | null>(null);
  selectorPage = signal<ExercisePageResponse | null>(null);
  selectorSearch = '';
  selectorPageNumber = 0;
  selectorCreateSaving = false;

  constructor() {
    effect(() => {
      this.auth.isAuthenticated();
      this.auth.currentUser?.();
      this.accountSync.status();
      void this.loadRoutines();
    });
  }

  get isCloudEditor(): boolean {
    // Keep an already-open cloud detail cloud if a token expires; never redirect its save into Dexie.
    return this.editingCloud !== null || (this.auth.isAuthenticated() && this.editingLocal === null);
  }

  get canShowEmpty(): boolean { return this.remoteState === 'local' || this.remoteState === 'confirmed'; }

  routineKey(item: RoutineListItem): string { return `${item.source}:${item.routine.id}`; }

  async loadRoutines(page = this.cloudPageNumber): Promise<void> {
    const loadId = ++this.loadId;
    this.cloudLoading = false;
    const accountId = this.auth.isAuthenticated() ? this.auth.currentUser?.()?.id ?? null : null;
    if (this.snapshotAccountId !== undefined && this.snapshotAccountId !== accountId) {
      this.routines = [];
      this.error.set(null);
      this.snapshotAccountId = undefined;
    }
    this.loading = this.snapshotAccountId === undefined;
    const snapshot = await this.reads.routineSnapshot(accountId);
    if (loadId !== this.loadId) return;
    this.applyRead(snapshot);
    this.snapshotAccountId = accountId;
    this.loading = false;
    if (!accountId) return;
    this.cloudLoading = true;
    this.error.set(null);
    try {
      const refreshed = await this.reads.refreshRoutines(accountId, page, this.cloudPageSize);
      if (loadId !== this.loadId || this.auth.currentUser?.()?.id !== accountId) return;
      this.applyRead(refreshed);
    } catch (error) {
      if (loadId !== this.loadId || this.auth.currentUser?.()?.id !== accountId) return;
      this.remoteState = 'unavailable';
      this.error.set(routineErrorMessage(error));
    } finally {
      if (loadId === this.loadId) this.cloudLoading = false;
    }
  }

  startCreate(): void {
    this.error.set(null);
    this.editingLocal = null;
    this.editingCloud = null;
    this.localName = '';
    this.localExercises = [];
    if (this.auth.isAuthenticated()) this.cloudDraft = newCloudRoutineDraft();
    this.editingRoutineName = '';
    this.editorLoading = false;
    this.openEditor();
  }

  async startEdit(item: RoutineListItem): Promise<void> {
    this.error.set(null);
    this.editingRoutineName = item.routine.name;
    if (item.source === 'local') {
      this.editingCloud = null;
      this.editingLocal = { ...item.routine };
      this.localName = item.routine.name;
      this.localExercises = item.routine.exercises.map(exercise => ({ ...exercise }));
      this.editorLoading = false;
      this.openEditor();
      return;
    }
    this.editingLocal = null;
    this.editingCloud = null;
    this.editorLoading = true;
    this.openEditor();
    this.saving.set(true);
    try {
      const detail = await firstValueFrom(this.routineApi.get(item.routine.id));
      this.editingCloud = detail;
      this.cloudDraft = cloudDraftFromResponse(detail, await this.loadCloudExerciseNames(detail));
    } catch (error) {
      this.error.set(routineErrorMessage(error));
    } finally {
      this.editorLoading = false;
      this.saving.set(false);
    }
  }

  addLocalExerciseBlock(): void { this.localExercises.push({ id: crypto.randomUUID(), name: '', setsCount: 3 }); }
  removeLocalExercise(index: number): void { this.localExercises.splice(index, 1); }
  moveLocalExercise(index: number, direction: -1 | 1): void { this.moveExercise(this.localExercises, index, direction); }
  moveCloudExercise(index: number, direction: -1 | 1): void { this.moveExercise(this.cloudDraft.exercises, index, direction); }

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
    this.editorOpen = false;
    this.editorLoading = false;
    this.editingRoutineName = '';
    this.editingLocal = null;
    this.editingCloud = null;
    this.localName = '';
    this.localExercises = [];
    this.cloudDraft = newCloudRoutineDraft();
    this.closeSelector();
  }

  private openEditor(): void {
    this.editorOpen = true;
    afterNextRender(() => {
      const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      this.routineEditorTitle?.nativeElement.focus({ preventScroll: true });
    }, { injector: this.injector });
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
  get canCreateSelectorExercise(): boolean {
    const name = this.normalizedSelectorName();
    return Boolean(name) && !(this.selectorPage()?.content ?? []).some(exercise => this.normalizeExerciseName(this.exerciseName(exercise)) === name);
  }

  async createSelectorExercise(): Promise<void> {
    if (!this.canCreateSelectorExercise || this.selectorCreateSaving) return;
    const draft = createCustomExerciseDraft(this.t.lang());
    draft.name = this.selectorSearch.trim().replace(/\s+/g, ' ');
    if (!isCustomExerciseDraftValid(draft)) {
      this.selectorError.set('Revisa el nombre del ejercicio antes de crearlo.');
      return;
    }
    this.selectorCreateSaving = true;
    this.selectorError.set(null);
    try {
      const exercise = await firstValueFrom(this.exerciseApi.create(toCreateExerciseRequest(draft)));
      this.selectCloudExercise(exercise);
    } catch (error) {
      // Keep the search text and routine draft intact so the deliberate creation can be retried.
      this.selectorError.set(exerciseCreationErrorMessage(error));
    } finally {
      this.selectorCreateSaving = false;
    }
  }
  removeCloudExercise(index: number): void { this.cloudDraft.exercises.splice(index, 1); }
  closeSelector(): void { this.selectorOpen = false; this.selectorError.set(null); this.selectorCreateSaving = false; }
  async previousCloudPage(): Promise<void> { if (this.cloudPageNumber > 0) await this.loadRoutines(this.cloudPageNumber - 1); }
  async nextCloudPage(): Promise<void> { if (this.cloudPageNumber + 1 < this.cloudTotalPages) await this.loadRoutines(this.cloudPageNumber + 1); }
  async previousSelectorPage(): Promise<void> { if (this.selectorPageNumber > 0) await this.loadSelectorPage(this.selectorPageNumber - 1); }
  async nextSelectorPage(): Promise<void> { const page = this.selectorPage(); if (page && this.selectorPageNumber + 1 < page.totalPages) await this.loadSelectorPage(this.selectorPageNumber + 1); }
  exerciseName(exercise: ExerciseResponse): string { return getExerciseName(exercise, this.t.lang()); }

  private normalizedSelectorName(): string { return this.normalizeExerciseName(this.selectorSearch); }
  private normalizeExerciseName(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }

  private moveExercise<T>(items: T[], index: number, direction: -1 | 1): void {
    const destination = index + direction;
    if (destination < 0 || destination >= items.length) return;
    [items[index], items[destination]] = [items[destination], items[index]];
  }

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

  private applyRead(read: Awaited<ReturnType<LocalFirstReadService['routineSnapshot']>>): void {
    this.routines = read.items;
    this.remoteState = read.remoteState;
    this.cloudPageNumber = read.pageNumber;
    this.cloudTotalPages = read.totalPages;
  }
}

function routineErrorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500) return 'No se pudieron actualizar todas tus rutinas. Las que ya estaban disponibles siguen aquí; inténtalo de nuevo.';
  if (error.status === 401) return 'La sesión ha caducado. Inicia sesión de nuevo para continuar.';
  if (error.status === 403) return 'No tienes permiso para modificar esta rutina.';
  if (error.status === 404) return 'La rutina o alguno de sus ejercicios ya no está disponible.';
  if (error.status === 400) return 'No se pudieron guardar los datos de la rutina. Revisa los campos.';
  return 'No se pudo completar la operación.';
}

function exerciseCreationErrorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500) return 'No se pudo crear el ejercicio. Conservamos tu búsqueda para que puedas reintentar.';
  if (error.status === 401) return 'La sesión ha caducado. Inicia sesión de nuevo para crear un ejercicio personalizado.';
  if (error.status === 400) return 'No se pudo crear el ejercicio. Revisa el nombre e inténtalo de nuevo.';
  return 'No se pudo crear el ejercicio. Puedes reintentar.';
}
