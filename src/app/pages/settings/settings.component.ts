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

  importError = signal<string | null>(null);
  importConfirm = signal(false);
  importData: string | null = null;

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
}
