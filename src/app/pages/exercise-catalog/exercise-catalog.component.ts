import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { TranslationService } from '../../services/translation.service';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import {
  ExerciseFilterOptionsResponse,
  ExerciseListParams,
  ExercisePageResponse,
  ExerciseResponse,
  ExerciseTranslation,
} from '../../exercises/exercise-api.models';
import {
  canDeleteExercise,
  canEditExercise,
  createCustomExerciseDraft,
  CustomExerciseDraft,
  getExerciseName,
  getExerciseTranslation,
  isCustomExerciseDraftValid,
  toCreateExerciseRequest,
} from '../../exercises/exercise-domain';
import { AccountReadCacheRepository } from '../../data/active-training.repository';

type CatalogView = 'reconnecting' | 'guest' | 'catalog' | 'detail' | 'form';

@Component({
  selector: 'app-exercise-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './exercise-catalog.component.html',
  styleUrl: './exercise-catalog.component.css',
})
export class ExerciseCatalogComponent {
  readonly auth = inject(AuthSessionService);
  readonly t = inject(TranslationService);
  private readonly api = inject(ExerciseApiService);

  readonly view = signal<CatalogView>('reconnecting');
  readonly page = signal<ExercisePageResponse | null>(null);
  readonly filterOptions = signal<ExerciseFilterOptionsResponse | null>(null);
  readonly detail = signal<ExerciseResponse | null>(null);
  readonly loading = signal(false);
  readonly filtersLoading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly filtersError = signal<string | null>(null);

  search = '';
  category = '';
  equipment = '';
  muscleGroup = '';
  targetMuscle = '';
  pageSize = 20;
  pageNumber = 0;
  editingExercise: ExerciseResponse | null = null;
  private preservedTranslations: ExerciseTranslation[] = [];
  private visibleAccountId: string | null = null;
  private authStateVersion = 0;
  private pageRequestVersion = 0;
  private filterRequestVersion = 0;
  draft: CustomExerciseDraft = createCustomExerciseDraft(this.t.lang());

  constructor() {
    effect(() => {
      const status = this.auth.initializationStatus();
      const accountId = this.auth.currentUser()?.id ?? null;
      const version = ++this.authStateVersion;

      if (status === 'guest') {
        this.changeVisibleAccount(null);
        this.view.set('guest');
        return;
      }

      if (status === 'authenticated' && accountId) {
        void this.activateCatalog(accountId, version);
        return;
      }

      void this.showCachedCatalogWhileReconnecting(accountId, version);
    });
  }

  get nameForDetail(): string {
    const exercise = this.detail();
    return exercise ? getExerciseName(exercise, this.t.lang()) : '';
  }

  get detailTranslation(): ExerciseTranslation | null {
    const exercise = this.detail();
    return exercise ? getExerciseTranslation(exercise, this.t.lang()) : null;
  }

  nameFor(exercise: ExerciseResponse): string {
    return getExerciseName(exercise, this.t.lang());
  }

  canEdit(exercise: ExerciseResponse): boolean {
    return canEditExercise(exercise);
  }

  canDelete(exercise: ExerciseResponse): boolean {
    return canDeleteExercise(exercise);
  }

  async applyFilters(): Promise<void> {
    await this.loadPage(0);
  }

  async loadPage(page: number): Promise<void> {
    const accountId = this.auth.currentUser()?.id;
    if (!this.auth.isAuthenticated() || !accountId) return;

    const requestVersion = ++this.pageRequestVersion;
    const query = this.catalogQuery(page);
    this.loading.set(true);
    this.error.set(null);
    this.view.set('catalog');
    try {
      const response = await firstValueFrom(this.api.list(query));
      if (!this.isCurrentRequest(accountId, requestVersion)) return;
      this.pageNumber = response.page;
      this.page.set(response);
      this.view.set('catalog');
      void AccountReadCacheRepository.saveExercises(accountId, query, response).catch(() => undefined);
    } catch (error) {
      if (!this.isCurrentRequest(accountId, requestVersion) || this.auth.isGuest()) return;
      this.error.set(exerciseErrorMessage(error));
      this.view.set('catalog');
    } finally {
      if (requestVersion === this.pageRequestVersion) this.loading.set(false);
    }
  }

  async loadFilterOptions(): Promise<void> {
    const accountId = this.auth.currentUser()?.id;
    if (!this.auth.isAuthenticated() || !accountId) return;

    const requestVersion = ++this.filterRequestVersion;
    this.filtersLoading.set(true);
    this.filtersError.set(null);
    try {
      const options = await firstValueFrom(this.api.getFilterOptions());
      if (requestVersion === this.filterRequestVersion && this.auth.currentUser()?.id === accountId) this.filterOptions.set(options);
    } catch {
      // The catalog remains usable with text filters if filter metadata is temporarily unavailable.
      if (requestVersion === this.filterRequestVersion && this.auth.currentUser()?.id === accountId) this.filtersError.set('No se pudieron cargar las opciones de filtro.');
    } finally {
      if (requestVersion === this.filterRequestVersion) this.filtersLoading.set(false);
    }
  }

  async retryConnection(): Promise<void> {
    if (this.auth.isAuthenticated()) {
      await this.loadPage(this.pageNumber);
      return;
    }
    await this.auth.retryInitialization();
  }

  async openDetail(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.detail.set(await firstValueFrom(this.api.get(id)));
      this.view.set('detail');
    } catch (error) {
      this.error.set(exerciseErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void {
    this.editingExercise = null;
    this.preservedTranslations = [];
    this.draft = createCustomExerciseDraft(this.t.lang());
    this.error.set(null);
    this.view.set('form');
  }

  openEdit(exercise: ExerciseResponse): void {
    if (!canEditExercise(exercise)) {
      return;
    }

    const translation = getExerciseTranslation(exercise, this.t.lang());
    if (!translation) {
      this.error.set('El ejercicio no tiene ninguna traducción editable.');
      return;
    }

    this.editingExercise = exercise;
    this.preservedTranslations = exercise.translations.map(item => ({ ...item }));
    this.draft = {
      clientId: exercise.clientId,
      language: translation.language,
      name: translation.name,
      instructions: translation.instructions ?? '',
      category: exercise.category ?? '',
      equipment: exercise.equipment ?? '',
      targetMuscle: exercise.targetMuscle ?? '',
      muscleGroup: exercise.muscleGroup ?? '',
      secondaryMuscles: exercise.secondaryMuscles?.join(', ') ?? '',
    };
    this.error.set(null);
    this.view.set('form');
  }

  async save(): Promise<void> {
    if (!isCustomExerciseDraftValid(this.draft)) {
      this.error.set('Revisa los campos obligatorios y sus límites de longitud.');
      return;
    }

    const request = toCreateExerciseRequest(this.draft, this.preservedTranslations);
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = this.editingExercise
        ? await firstValueFrom(this.api.update(this.editingExercise.id, request))
        : await firstValueFrom(this.api.create(request));
      this.detail.set(response);
      this.view.set('detail');
      await this.loadPage(this.pageNumber);
      this.view.set('detail');
    } catch (error) {
      // The draft, including its clientId, intentionally remains unchanged for a retry.
      this.error.set(exerciseErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  async delete(exercise: ExerciseResponse): Promise<void> {
    if (!canDeleteExercise(exercise) || !window.confirm(`¿Eliminar "${this.nameFor(exercise)}"?`)) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.delete(exercise.id));
      this.detail.set(null);
      await this.loadPage(this.pageNumber);
    } catch (error) {
      this.error.set(exerciseErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  backToCatalog(): void {
    this.detail.set(null);
    this.error.set(null);
    this.view.set('catalog');
  }

  cancelForm(): void {
    this.error.set(null);
    if (this.editingExercise) {
      this.detail.set(this.editingExercise);
      this.view.set('detail');
    } else {
      this.view.set('catalog');
    }
  }

  async previousPage(): Promise<void> {
    if (this.pageNumber > 0) {
      await this.loadPage(this.pageNumber - 1);
    }
  }

  async nextPage(): Promise<void> {
    const page = this.page();
    if (page && this.pageNumber + 1 < page.totalPages) {
      await this.loadPage(this.pageNumber + 1);
    }
  }

  private async activateCatalog(accountId: string, authVersion: number): Promise<void> {
    this.changeVisibleAccount(accountId);
    await this.restoreCachedPage(accountId, 0, authVersion);
    if (!this.isCurrentAuthState(accountId, authVersion, 'authenticated')) return;
    void this.loadPage(0);
    void this.loadFilterOptions();
  }

  private async showCachedCatalogWhileReconnecting(accountId: string | null, authVersion: number): Promise<void> {
    this.changeVisibleAccount(accountId);
    if (!accountId) {
      this.view.set('reconnecting');
      return;
    }

    const restored = await this.restoreCachedPage(accountId, 0, authVersion);
    if (!restored && this.isCurrentAuthState(accountId, authVersion)) this.view.set('reconnecting');
  }

  private async restoreCachedPage(accountId: string, page: number, authVersion: number): Promise<boolean> {
    try {
      const cached = await AccountReadCacheRepository.getExercises(accountId, this.catalogQuery(page));
      if (!cached || !this.isCurrentAuthState(accountId, authVersion)) return false;
      this.pageNumber = cached.page.page;
      this.page.set(cached.page);
      this.view.set('catalog');
      return true;
    } catch {
      return false;
    }
  }

  private changeVisibleAccount(accountId: string | null): void {
    if (this.visibleAccountId === accountId) return;
    this.visibleAccountId = accountId;
    this.pageRequestVersion++;
    this.filterRequestVersion++;
    this.page.set(null);
    this.filterOptions.set(null);
    this.detail.set(null);
    this.error.set(null);
    this.filtersError.set(null);
    this.loading.set(false);
    this.filtersLoading.set(false);
  }

  private catalogQuery(page: number): ExerciseListParams {
    return {
      page,
      size: this.pageSize,
      search: this.search.trim() || undefined,
      category: this.category.trim() || undefined,
      equipment: this.equipment.trim() || undefined,
      muscleGroup: this.muscleGroup.trim() || undefined,
      targetMuscle: this.targetMuscle.trim() || undefined,
    };
  }

  private isCurrentAuthState(accountId: string, version: number, status?: 'authenticated'): boolean {
    return version === this.authStateVersion
      && this.auth.currentUser()?.id === accountId
      && (!status || this.auth.initializationStatus() === status);
  }

  private isCurrentRequest(accountId: string, requestVersion: number): boolean {
    return requestVersion === this.pageRequestVersion
      && this.auth.isAuthenticated()
      && this.auth.currentUser()?.id === accountId;
  }

}

function exerciseErrorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500) {
    return 'No se pudo contactar con el catálogo. No es un resultado vacío; inténtalo de nuevo.';
  }
  if (error.status === 401) {
    return 'La sesión ha caducado. Inicia sesión de nuevo para usar el catálogo.';
  }
  if (error.status === 400) {
    return 'No se pudieron guardar los datos del ejercicio. Revisa el formulario.';
  }
  return 'No se pudo completar la operación del catálogo.';
}
