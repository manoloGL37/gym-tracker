import { Component, computed, inject, signal } from '@angular/core';
import { TranslationService, Lang } from '../../services/translation.service';
import { CommonModule } from '@angular/common';
import { BackupService } from '../../services/backup.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})

export class SettingsComponent {
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
  importData: string | null = null;

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

  async exportBackup() {
    const blob = await this.backupService.exportData();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gym-tracker-backup.json';
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
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed.routines) || !Array.isArray(parsed.workoutHistory)) {
          throw new Error('Invalid structure');
        }
        this.importData = text;
        this.importConfirm.set(true);
        this.importError.set(null);
      } catch (e) {
        this.importError.set('Invalid or corrupt backup file.');
        this.importData = null;
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
      window.location.reload();
    } catch (e) {
      this.importError.set('Import failed.');
    }
  }

  cancelImport() {
    this.importConfirm.set(false);
    this.importData = null;
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

