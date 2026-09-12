import { computed, signal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthInitializationStatus } from './auth/auth.models';
import { AuthSessionService } from './auth/auth-session.service';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  const authStatus = signal<AuthInitializationStatus>('checking');
  const restoreAttemptFailed = signal(false);

  beforeEach(async () => {
    authStatus.set('checking');
    restoreAttemptFailed.set(false);
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: {
          initializationStatus: authStatus,
          isInitializing: computed(() => authStatus() === 'checking'),
          isAuthenticated: computed(() => authStatus() === 'authenticated'),
          restoreAttemptFailed,
          retryInitialization: jasmine.createSpy('retryInitialization'),
        } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have the 'gym-tracker' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('gym-tracker');
  });

  it('shows session restoration instead of routed login content while checking', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Comprobando tu sesión...');
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeNull();

    authStatus.set('unauthenticated');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
  });

  it('explains a long backend startup without changing auth state', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    tick(8000);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('El servidor se está iniciando. Esto puede tardar unos segundos.');
    expect(authStatus()).toBe('checking');
    fixture.destroy();
  }));

});
