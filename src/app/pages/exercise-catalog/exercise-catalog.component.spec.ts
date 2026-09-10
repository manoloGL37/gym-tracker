import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthSessionService } from '../../auth/auth-session.service';
import { ExerciseApiService } from '../../exercises/exercise-api.service';
import { TranslationService } from '../../services/translation.service';
import { provideRouter } from '@angular/router';
import { ExerciseCatalogComponent } from './exercise-catalog.component';

describe('ExerciseCatalogComponent', () => {
  let fixture: ComponentFixture<ExerciseCatalogComponent>;
  let api: jasmine.SpyObj<ExerciseApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ExerciseApiService>('ExerciseApiService', ['list', 'get', 'create', 'update', 'delete']);
    await TestBed.configureTestingModule({
      imports: [ExerciseCatalogComponent],
      providers: [
        { provide: ExerciseApiService, useValue: api },
        provideRouter([]),
        { provide: AuthSessionService, useValue: { isAuthenticated: signal(false) } },
        { provide: TranslationService, useValue: { lang: signal<'en' | 'es'>('en') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ExerciseCatalogComponent);
    fixture.detectChanges();
  });

  it('does not request the protected catalog for a guest', () => {
    expect(api.list).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('requiere una cuenta');
  });
});
