import { Component, effect, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SelectedRoutineRepository } from '../../data/active-training.repository';
import { CommonModule } from '@angular/common';
import { TranslationService } from '../../services/translation.service';
import { AuthSessionService } from '../../auth/auth-session.service';
import { RoutineListItem } from '../../routines/routine-domain';
import { AccountSyncService } from '../../migration/account-sync.service';
import { LocalFirstReadService, RemoteReadState } from '../../data/local-first-read.service';

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
  private readonly accountSync = inject(AccountSyncService);
  private readonly reads = inject(LocalFirstReadService);
  private loadId = 0;
  private snapshotAccountId: string | null | undefined;
  routines: RoutineListItem[] = [];
  loading = true;
  cloudLoading = false;
  remoteState: RemoteReadState = 'local';
  cloudPageNumber = 0;
  cloudTotalPages = 0;
  error: string | null = null;

  constructor(private router: Router) {
    effect(() => {
      this.auth.isAuthenticated();
      this.auth.currentUser?.();
      this.accountSync.status();
      void this.loadRoutines();
    });
  }

  async loadRoutines(page = this.cloudPageNumber) {
    const loadId = ++this.loadId;
    this.cloudLoading = false;
    const accountId = this.auth.isAuthenticated() ? this.auth.currentUser?.()?.id ?? null : null;
    if (this.snapshotAccountId !== undefined && this.snapshotAccountId !== accountId) {
      this.routines = [];
      this.error = null;
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
    try {
      const refreshed = await this.reads.refreshRoutines(accountId, page, 10);
      if (loadId !== this.loadId || this.auth.currentUser?.()?.id !== accountId) return;
      this.applyRead(refreshed);
      this.error = null;
    } catch {
      if (loadId !== this.loadId || this.auth.currentUser?.()?.id !== accountId) return;
      this.remoteState = 'unavailable';
      this.error = 'No se pudieron actualizar todas tus rutinas. Las que ya estaban disponibles siguen aquí.';
    } finally {
      if (loadId === this.loadId) this.cloudLoading = false;
    }
  }

  async selectRoutine(item: RoutineListItem) {
    if (item.source === 'local') await SelectedRoutineRepository.set(item.routine.id);
    else await SelectedRoutineRepository.setCloud(item.routine.id, item.routine.name, crypto.randomUUID());
    this.router.navigate(['/training']);
  }

  routineKey(item: RoutineListItem): string { return `${item.source}:${item.routine.id}`; }
  get canShowEmpty(): boolean { return this.remoteState === 'local' || this.remoteState === 'confirmed'; }
  async previousCloudPage() { if (this.cloudPageNumber > 0) await this.loadRoutines(this.cloudPageNumber - 1); }
  async nextCloudPage() { if (this.cloudPageNumber + 1 < this.cloudTotalPages) await this.loadRoutines(this.cloudPageNumber + 1); }

  private applyRead(read: Awaited<ReturnType<LocalFirstReadService['routineSnapshot']>>): void {
    this.routines = read.items;
    this.remoteState = read.remoteState;
    this.cloudPageNumber = read.pageNumber;
    this.cloudTotalPages = read.totalPages;
  }
}
