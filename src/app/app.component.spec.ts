import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthInitializationStatus } from './auth/auth.models';
import { AuthSessionService } from './auth/auth-session.service';
import { AppComponent } from './app.component';
import { routes } from './app.routes';

describe('AppComponent', () => {
  const authStatus = signal<AuthInitializationStatus>('restoring');
  const restoreAttemptFailed = signal(false);

  beforeEach(async () => {
    authStatus.set('restoring');
    restoreAttemptFailed.set(false);
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: {
          initializationStatus: authStatus,
          isReconnecting: computed(() => authStatus() === 'restoring' || authStatus() === 'unreachable'),
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

  it('keeps the application router rendered while session restoration is pending', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Comprobando tu sesión...');
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();

    authStatus.set('guest');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
  });

  it('does not guard local-capable routes behind authentication restoration', () => {
    const shell = routes.find(route => route.path === '');
    const localPaths = ['home', 'routines', 'select-routine', 'calendar', 'training', 'settings'];

    expect(shell?.canActivate).toBeUndefined();
    for (const path of localPaths) {
      const route = shell?.children?.find(child => child.path === path);
      expect(route).withContext(path).toBeDefined();
      expect(route?.canActivate).withContext(path).toBeUndefined();
    }
  });

});
