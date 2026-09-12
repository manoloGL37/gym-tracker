import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, effect, Inject, OnDestroy, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthSessionService } from './auth/auth-session.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'gym-tracker';
  readonly restoreTakingLong = signal(false);

  private cleanupCallbacks: Array<() => void> = [];
  private restoredAt = 0;

  constructor(
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) private platformId: object,
    readonly auth: AuthSessionService,
    private readonly router: Router,
  ) {
    effect((onCleanup) => {
      if (!this.auth.isInitializing()) {
        this.restoreTakingLong.set(false);
        if (this.auth.isAuthenticated() && /^\/(login|register)(?:[/?#]|$)/.test(this.router.url)) {
          void this.router.navigate(['/home']);
        }
        return;
      }

      if (!isPlatformBrowser(this.platformId)) return;
      const timer = globalThis.setTimeout(() => this.restoreTakingLong.set(true), 8000);
      onCleanup(() => globalThis.clearTimeout(timer));
    });
  }

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.listen(this.document, 'visibilitychange', () => {
      if (this.document.visibilityState === 'hidden') {
        this.releaseEditableFocus();
        return;
      }

      this.markRecentlyRestored();
      this.releaseEditableFocus();
    });

    this.listen(window, 'pagehide', () => this.releaseEditableFocus());
    this.listen(window, 'pageshow', () => this.markRecentlyRestored());
    this.listen(window, 'focus', () => this.markRecentlyRestored());

    this.listen(
      this.document,
      'pointerdown',
      (event) => this.prepareEditableForTap(event),
      { capture: true },
    );

    this.listen(
      this.document,
      'touchstart',
      (event) => this.prepareEditableForTap(event),
      { capture: true },
    );
  }

  ngOnDestroy(): void {
    this.cleanupCallbacks.forEach((cleanup) => cleanup());
    this.cleanupCallbacks = [];
  }

  retrySessionRestore(): void {
    void this.auth.retryInitialization();
  }

  private listen(
    target: Window | Document,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    this.cleanupCallbacks.push(() => target.removeEventListener(type, listener, options));
  }

  private markRecentlyRestored(): void {
    this.restoredAt = Date.now();
  }

  private prepareEditableForTap(event: Event): void {
    if (Date.now() - this.restoredAt > 3000) {
      return;
    }

    const editable = this.getEditableElement(event.target);
    if (!editable || this.document.activeElement !== editable) {
      return;
    }

    editable.blur();
  }

  private releaseEditableFocus(): void {
    const activeElement = this.document.activeElement;
    if (this.isEditableElement(activeElement)) {
      activeElement.blur();
    }
  }

  private getEditableElement(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
    if (!(target instanceof Element)) {
      return null;
    }

    const element = target.closest('input, textarea');
    return this.isEditableElement(element) ? element : null;
  }

  private isEditableElement(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
    if (element instanceof HTMLTextAreaElement) {
      return !element.disabled && !element.readOnly;
    }

    if (!(element instanceof HTMLInputElement)) {
      return false;
    }

    return !element.disabled && !element.readOnly && element.type !== 'hidden' && element.type !== 'file';
  }
}
