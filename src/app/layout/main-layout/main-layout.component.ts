import { Component, inject } from '@angular/core';
import { TranslationService } from '../../services/translation.service';

import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { OfflineIndicatorComponent } from '../../components/offline-indicator.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, OfflineIndicatorComponent],
  templateUrl: './main-layout.component.html',
  styleUrls: ['./main-layout.component.css']
})
export class MainLayoutComponent {
  t = inject(TranslationService);
}
