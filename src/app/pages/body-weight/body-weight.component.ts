import { Component, inject } from '@angular/core';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-body-weight',
  standalone: true,
  templateUrl: './body-weight.component.html',
  styleUrls: ['./body-weight.component.css']
})
export class BodyWeightComponent {
  t = inject(TranslationService);
}
