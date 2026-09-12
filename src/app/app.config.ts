import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { authInterceptor } from './auth/auth.interceptor';
import { AuthSessionService } from './auth/auth-session.service';
import { BackendWarmupService } from './services/backend-warmup.service';
import { resilientHttpInterceptor } from './services/resilient-http.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor, resilientHttpInterceptor])),
    provideAppInitializer(() => {
      // Do not await this: a cold/unavailable backend must never block local guest mode.
      void inject(AuthSessionService).initialize();
      inject(BackendWarmupService).warm();
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
