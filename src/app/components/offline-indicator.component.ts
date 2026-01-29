import { Component, signal, OnInit, inject } from '@angular/core';
import { TranslationService } from '../services/translation.service';

@Component({
  selector: 'app-offline-indicator',
  standalone: true,
  template: `
    @if (!online()) {
      <div class="fixed top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold shadow border border-orange-300 pointer-events-none select-none transition-all">
        {{ t.t('offline.message') }}
      </div>
    }
  `,
})
export class OfflineIndicatorComponent implements OnInit {
  t = inject(TranslationService);
  online = signal(navigator.onLine);

  ngOnInit() {
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }
}
