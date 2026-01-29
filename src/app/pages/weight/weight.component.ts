import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BodyWeightRepository } from '../../data/body-weight.repository';
import { BodyWeightEntry } from '../../data/body-weight.model';
import { TranslationService } from '../../services/translation.service';
import { WeightTrendComponent } from './weight-trend.component';

@Component({
  selector: 'app-weight',
  standalone: true,
  imports: [CommonModule, FormsModule, WeightTrendComponent],
  templateUrl: './weight.component.html',
  styleUrls: ['./weight.component.css']
})
export class WeightComponent implements OnInit {
  t = inject(TranslationService);
  entries = signal<BodyWeightEntry[]>([]);
  today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  weightValue = '';
  editingDate = signal<string | null>(null);
  editingWeightValue = '';
  loading = signal(true);

  async ngOnInit() {
    await this.loadEntries();
    this.prefillToday();
  }

  async loadEntries() {
    this.loading.set(true);
    this.entries.set(await BodyWeightRepository.getAll());
    this.loading.set(false);
  }

  async prefillToday() {
    // Pre-fill with last recorded weight if exists
    const all = this.entries();
    if (all.length > 0) {
      this.weightValue = all[0].weight.toFixed(1);
    }
    // If today exists, pre-fill with today's value
    const todayEntry = await BodyWeightRepository.getByDate(this.today);
    if (todayEntry) {
      this.weightValue = todayEntry.weight.toFixed(1);
    }
  }

  async saveToday() {
    const value = parseFloat(this.weightValue);
    if (isNaN(value) || value < 20 || value > 300) return;
    await BodyWeightRepository.upsert({ date: this.today, weight: parseFloat(value.toFixed(1)) });
    await this.loadEntries();
    await this.prefillToday();
  }

  startEdit(entry: BodyWeightEntry) {
    this.editingDate.set(entry.date);
    this.editingWeightValue = entry.weight.toFixed(1);
  }

  cancelEdit() {
    this.editingDate.set(null);
    this.editingWeightValue = '';
  }

  async saveEdit(date: string) {
    const value = parseFloat(this.editingWeightValue);
    if (isNaN(value) || value < 20 || value > 300) return;
    await BodyWeightRepository.upsert({ date, weight: parseFloat(value.toFixed(1)) });
    this.cancelEdit();
    await this.loadEntries();
    await this.prefillToday();
  }

  async delete(date: string) {
    await BodyWeightRepository.delete(date);
    await this.loadEntries();
    await this.prefillToday();
  }
}
