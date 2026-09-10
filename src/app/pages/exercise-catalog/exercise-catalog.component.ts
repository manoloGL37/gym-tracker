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
  toCreateExerciseRequest,
} from '../../exercises/exercise-domain';

type CatalogView = 'guest' | 'catalog' | 'detail' | 'form';

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

  readonly view = signal<CatalogView>('guest');
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
  draft: CustomExerciseDraft = createCustomExerciseDraft(this.t.lang());

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated()) {
        void this.loadPage(0);
        void this.loadFilterOptions();
      } else {
        this.view.set('guest');
        this.page.set(null);
      }
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
    if (!this.auth.isAuthenticated()) {
      this.view.set('guest');
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.api.list({
        page,
        size: this.pageSize,
        search: this.search.trim() || undefined,
        category: this.category.trim() || undefined,
        equipment: this.equipment.trim() || undefined,
        muscleGroup: this.muscleGroup.trim() || undefined,
        targetMuscle: this.targetMuscle.trim() || undefined,
      }));
      this.pageNumber = response.page;
      this.page.set(response);
      this.view.set('catalog');
    } catch (error) {
      this.error.set(exerciseErrorMessage(error));
      this.view.set('catalog');
    } finally {
      this.loading.set(false);
    }
  }

  async loadFilterOptions(): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      return;
    }

    this.filtersLoading.set(true);
    this.filtersError.set(null);
    try {
      this.filterOptions.set(await firstValueFrom(this.api.getFilterOptions()));
    } catch {
      // The catalog remains usable with text filters if filter metadata is temporarily unavailable.
      this.filtersError.set('No se pudieron cargar las opciones de filtro.');
    } finally {
      this.filtersLoading.set(false);
    }
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
    if (!this.isDraftValid()) {
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

  private isDraftValid(): boolean {
    return Boolean(this.draft.name.trim())
      && Boolean(this.draft.language.trim())
      && this.draft.name.trim().length <= 255
      && this.draft.language.trim().length <= 10
      && [this.draft.category, this.draft.equipment, this.draft.targetMuscle, this.draft.muscleGroup]
        .every(value => value.trim().length <= 100);
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
    return 'El servidor rechazó los datos del ejercicio. Revisa el formulario.';
  }
  return 'No se pudo completar la operación del catálogo.';
}
