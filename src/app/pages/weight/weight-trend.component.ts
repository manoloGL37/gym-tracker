import { Component, Input, inject } from '@angular/core';
import { TranslationService } from '../../services/translation.service';
import { BodyWeightEntry } from '../../data/body-weight.model';

@Component({
  selector: 'app-weight-trend',
  standalone: true,
  template: `
    @if (entries && entries.length > 1) {
      <svg viewBox="0 0 320 60" class="w-full h-16">
         <polyline
           [attr.points]="getPoints()"
           fill="none"
          stroke="#f97316"
           stroke-width="3"
           stroke-linecap="round"
           stroke-linejoin="round"
         />
      </svg>
    }
    @if (!entries || entries.length <= 1) {
      <div class="text-xs text-gray-400 text-center py-4">
        {{ t.t('weight.trendNotEnough') }}
      </div>
    }
  `
})
export class WeightTrendComponent {
  @Input() entries: BodyWeightEntry[] = [];
  t = inject(TranslationService);

  getPoints(): string {
    if (!this.entries || this.entries.length < 2) return '';
    // Normalize to SVG 320x60
    const sorted = [...this.entries].sort((a, b) => a.date.localeCompare(b.date));
    const min = Math.min(...sorted.map(e => e.weight));
    const max = Math.max(...sorted.map(e => e.weight));
    const range = max - min || 1;
    const step = 320 / (sorted.length - 1);
    return sorted.map((e, i) => {
      const x = i * step;
      const y = 60 - ((e.weight - min) / range) * 50 - 5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }
}
