import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { TranslationService, Lang } from '../../services/translation.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BackupService } from '../../services/backup.service';
import { Router, RouterLink } from '@angular/router';
import { AuthSessionService } from '../../auth/auth-session.service';
import { LocalToCloudMigrationService } from '../../migration/local-to-cloud-migration.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { ExerciseResponse } from '../../exercises/exercise-api.models';
import { getExerciseName } from '../../exercises/exercise-domain';

interface StorageInfo {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
  supported: boolean;
}

interface ImportPreview {
  routines: number;
  workoutHistory: number;
  bodyWeight: number;
  exportedAt: string | null;
  schemaVersion: number | null;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit {
  t = inject(TranslationService);
  lang = computed(() => this.t.lang());
  backupService = inject(BackupService);
  router = inject(Router);
  auth = inject(AuthSessionService);
  migration = inject(LocalToCloudMigrationService);
  accountSync = inject(AccountSyncService);

  // Read backup status directly from localStorage
  lastBackupTime = computed(() => {
    const stored = localStorage.getItem('backup:lastSuccessAt');
    return stored ? new Date(stored) : null;
  });
  lastServerStatus = computed(() => {
    const status = localStorage.getItem('backup:lastStatus');
    if (status === 'online' || status === 'offline') return status;
    return 'unknown';
  });

  importError = signal<string | null>(null);
  importConfirm = signal(false);
  importPreview = signal<ImportPreview | null>(null);
  importData: string | null = null;
  storageInfo = signal<StorageInfo>({
    usage: null,
    quota: null,
    persisted: null,
    supported: typeof navigator !== 'undefined' && !!navigator.storage,
  });
  storageMessage = signal<string | null>(null);
  migrationBusy = signal(false);
  migrationError = signal<string | null>(null);
  unresolvedExercises = signal<{ key: string; name: string }[]>([]);
  resolving = signal<{ key: string; name: string } | null>(null);
  migrationSearch = '';
  migrationCatalog = signal<ExerciseResponse[]>([]);
  private migrationLoadVersion = 0;

  constructor() {
    effect(() => {
      this.auth.currentUser();
      this.accountSync.state();
      void this.loadMigration();
    });
  }

  ngOnInit() {
    this.refreshStorageInfo();
    void this.loadMigration();
  }

  async loadMigration(): Promise<void> {
    const requestVersion = ++this.migrationLoadVersion;
    const accountId = this.auth.currentUser()?.id;
    if (!accountId) { this.unresolvedExercises.set([]); return; }
    const unresolved = await this.migration.unresolvedReferences(accountId);
    if (requestVersion === this.migrationLoadVersion) this.unresolvedExercises.set(unresolved);
  }

  async openExerciseResolution(reference: { key: string; name: string }): Promise<void> {
    this.resolving.set(reference); this.migrationSearch = reference.name; await this.searchMigrationCatalog();
  }

  async searchMigrationCatalog(): Promise<void> {
    this.migrationBusy.set(true); this.migrationError.set(null);
    try { this.migrationCatalog.set(await this.migration.searchExercises(this.migrationSearch)); }
    catch { this.migrationError.set('No se pudo cargar el catálogo. Puedes reintentar o crear un ejercicio personalizado.'); }
    finally { this.migrationBusy.set(false); }
  }

  async selectMigrationCatalogExercise(exercise: ExerciseResponse): Promise<void> {
    const accountId = this.auth.currentUser()?.id; const reference = this.resolving();
    if (!accountId || !reference) return;
    this.migrationBusy.set(true); this.migrationError.set(null);
    try {
      await this.migration.chooseCatalogExercise(accountId, reference.key, exercise);
      this.resolving.set(null); await this.loadMigration(); this.accountSync.retryNow();
    } catch { this.migrationError.set('No se pudo guardar la identificación. Inténtalo de nuevo.'); }
    finally { this.migrationBusy.set(false); }
  }

  async createMigrationCustomExercise(): Promise<void> {
    const accountId = this.auth.currentUser()?.id; const reference = this.resolving();
    if (!accountId || !reference) return;
    this.migrationBusy.set(true); this.migrationError.set(null);
    try {
      await this.migration.chooseCustomExercise(accountId, reference.key);
      this.resolving.set(null); await this.loadMigration(); this.accountSync.retryNow();
    } catch { this.migrationError.set('No se pudo preparar el ejercicio. Inténtalo de nuevo.'); }
    finally { this.migrationBusy.set(false); }
  }

  migrationExerciseName(exercise: ExerciseResponse): string { return getExerciseName(exercise, this.t.lang()); }

  syncStatusText(): string {
    const state = this.accountSync.state();
    switch (state.status) {
      case 'syncing': return state.total ? `Sincronizando · ${state.completed} de ${state.total}` : 'Sincronizando';
      case 'retrying': return 'Reintentando sincronización...';
      case 'waiting': return 'Esperando conexión';
      case 'attention': return state.attention === 1 ? '1 elemento necesita tu atención' : `${state.attention} elementos necesitan tu atención`;
      case 'synced': return 'Tus datos están sincronizados';
      default: return 'Preparando sincronización';
    }
  }

  syncProgressPercent(): number | null {
    const { status, total, completed, pending, attention } = this.accountSync.state();
    if ((status !== 'syncing' && status !== 'retrying') || !total || !pending || attention) return null;
    return Math.round((completed / total) * 100);
  }

  // Manual restore from server
  restoreError = signal<string | null>(null);
  showRestoreConfirm = signal(false);
    requestRestoreFromServer() {
      this.showRestoreConfirm.set(true);
      this.restoreError.set(null);
    }

    cancelRestoreFromServer() {
      this.showRestoreConfirm.set(false);
      this.restoreError.set(null);
    }

    async confirmRestoreFromServer() {
      this.restoreError.set(null);
      const error = await this.backupService.restoreFromServer();
      if (error) {
        this.restoreError.set(error);
        this.showRestoreConfirm.set(false);
        return;
      }
      window.location.reload();
    }
  /**
   * Format the last server status for display
   */
  formatLastServerStatus(): string {
    const status = this.lastServerStatus();
    if (status === 'online') return this.t.t('settings.backup.statusOnline');
    if (status === 'offline') return this.t.t('settings.backup.statusOffline');
    return this.t.t('settings.backup.statusUnknown');
  }

  goBack() {
    this.router.navigate(['/home']);
  }

  setLang(lang: Lang) {
    this.t.setLang(lang);
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } finally {
      await this.router.navigate(['/login']);
    }
  }

  async refreshStorageInfo() {
    if (!navigator.storage) {
      this.storageInfo.set({
        usage: null,
        quota: null,
        persisted: null,
        supported: false,
      });
      return;
    }

    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate?.() ?? Promise.resolve({ usage: undefined, quota: undefined }),
      navigator.storage.persisted?.() ?? Promise.resolve(null),
    ]);

    this.storageInfo.set({
      usage: estimate.usage ?? null,
      quota: estimate.quota ?? null,
      persisted,
      supported: true,
    });
  }

  async requestPersistentStorage() {
    this.storageMessage.set(null);
    if (!navigator.storage?.persist) {
      this.storageMessage.set(this.t.t('settings.localData.persistUnsupported'));
      await this.refreshStorageInfo();
      return;
    }

    const granted = await navigator.storage.persist();
    await this.refreshStorageInfo();
    this.storageMessage.set(
      granted
        ? this.t.t('settings.localData.persistGranted')
        : this.t.t('settings.localData.persistDenied'),
    );
  }

  formatStorageUsage(): string {
    const { usage, quota } = this.storageInfo();
    if (usage === null || quota === null) {
      return this.t.t('settings.localData.unknown');
    }

    return `${this.formatBytes(usage)} / ${this.formatBytes(quota)}`;
  }

  formatPersistedStatus(): string {
    const persisted = this.storageInfo().persisted;
    if (persisted === true) return this.t.t('settings.localData.protected');
    if (persisted === false) return this.t.t('settings.localData.notProtected');
    return this.t.t('settings.localData.unknown');
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  async exportBackup() {
    const blob = await this.backupService.exportData();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gym-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  onImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const preview = this.backupService.previewData(text);
        this.importData = text;
        this.importPreview.set(preview);
        this.importConfirm.set(true);
        this.importError.set(null);
      } catch (e) {
        this.importError.set(this.t.t('settings.backup.invalidFile'));
        this.importData = null;
        this.importPreview.set(null);
        this.importConfirm.set(false);
      }
    };
    reader.readAsText(file);
  }

  async confirmImport() {
    if (!this.importData) return;
    try {
      await this.backupService.importData(this.importData);
      this.importConfirm.set(false);
      this.importData = null;
      this.importPreview.set(null);
      window.location.reload();
    } catch (e) {
      this.importError.set(this.t.t('settings.backup.importFailed'));
    }
  }

  cancelImport() {
    this.importConfirm.set(false);
    this.importData = null;
    this.importPreview.set(null);
  }

  formatImportDate(): string {
    const exportedAt = this.importPreview()?.exportedAt;
    if (!exportedAt) {
      return this.t.t('settings.localData.unknown');
    }

    return new Date(exportedAt).toLocaleString();
  }

  /**
   * Format the last backup time for display
   */
  formatLastBackup(): string {
    const time = this.lastBackupTime();
    if (!time) return this.t.t('settings.backup.neverBackedUp');
    
    const now = new Date();
    const diff = now.getTime() - time.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return this.t.t('settings.backup.justNow');
    if (minutes < 60) return this.t.t('settings.backup.minutesAgo').replace('{n}', minutes.toString());
    if (hours < 24) return this.t.t('settings.backup.hoursAgo').replace('{n}', hours.toString());
    return this.t.t('settings.backup.daysAgo').replace('{n}', days.toString());
  }
}

