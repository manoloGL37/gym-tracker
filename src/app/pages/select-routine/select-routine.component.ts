import { Component, effect, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RoutinesRepository, Routine, SelectedRoutineRepository } from '../../data/active-training.repository';
import { CommonModule } from '@angular/common';
import { TranslationService } from '../../services/translation.service';
import { AuthSessionService } from '../../auth/auth-session.service';
import { RoutineApiService } from '../../routines/routine-api.service';
import { RoutineListItem } from '../../routines/routine-domain';
import { firstValueFrom } from 'rxjs';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';

@Component({
  selector: 'app-select-routine',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './select-routine.component.html',
  styleUrls: ['./select-routine.component.css']
})
export class SelectRoutineComponent {
  t = inject(TranslationService);
  readonly auth = inject(AuthSessionService);
  private readonly routineApi = inject(RoutineApiService);
  private readonly migration = inject(LocalToCloudMigrationService);
  routines: RoutineListItem[] = [];
  loading = true;
  cloudPageNumber = 0;
  cloudTotalPages = 0;
  error: string | null = null;

  constructor(private router: Router) {
    effect(() => void this.loadRoutines());
  }

  async loadRoutines(page = this.cloudPageNumber) {
    this.loading = true;
    const rawLocal = await RoutinesRepository.getAll();
    const accountId = this.auth.currentUser?.()?.id;
    const migrated = accountId ? await Promise.all(rawLocal.map(routine => this.migration.isRoutineMigrated(accountId, routine.id))) : rawLocal.map(() => false);
    const local: RoutineListItem[] = rawLocal.filter((_, index) => !migrated[index]).map(routine => ({ source: 'local', routine }));
    if (!this.auth.isAuthenticated()) {
      this.routines = local;
      this.loading = false;
      return;
    }
    try {
      const cloud = await firstValueFrom(this.routineApi.list({ page, size: 10 }));
      this.cloudPageNumber = cloud.number;
      this.cloudTotalPages = cloud.totalPages;
      this.routines = [...local, ...cloud.content.map(routine => ({ source: 'cloud' as const, routine }))];
      this.error = null;
    } catch {
      // A cloud failure never hides the guest/legacy choices.
      this.routines = local;
      this.error = 'No se pudieron cargar las rutinas cloud. Tus rutinas locales siguen disponibles.';
    } finally {
      this.loading = false;
    }
  }

  async selectRoutine(item: RoutineListItem) {
    if (item.source === 'local') await SelectedRoutineRepository.set(item.routine.id);
    else await SelectedRoutineRepository.setCloud(item.routine.id, item.routine.name, crypto.randomUUID());
    this.router.navigate(['/training']);
  }

  routineKey(item: RoutineListItem): string { return `${item.source}:${item.routine.id}`; }
  async previousCloudPage() { if (this.cloudPageNumber > 0) await this.loadRoutines(this.cloudPageNumber - 1); }
  async nextCloudPage() { if (this.cloudPageNumber + 1 < this.cloudTotalPages) await this.loadRoutines(this.cloudPageNumber + 1); }
}
