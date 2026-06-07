import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslationService, Lang } from '../../services/translation.service';
import { CommonModule } from '@angular/common';
import { BackupService } from '../../services/backup.service';
import { Router } from '@angular/router';

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
  imports: [CommonModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit {
  t = inject(TranslationService);
  lang = computed(() => this.t.lang());
  backupService = inject(BackupService);
  router = inject(Router);

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

  ngOnInit() {
    this.refreshStorageInfo();
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

