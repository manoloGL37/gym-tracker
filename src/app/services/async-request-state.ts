import { signal } from '@angular/core';

/** Local, indeterminate request feedback for a single screen or action. */
export class AsyncRequestState {
  readonly pending = signal(false);
  readonly waitingForServer = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  begin(): void {
    this.end();
    this.pending.set(true);
    this.timer = setTimeout(() => this.waitingForServer.set(true), 6_000);
  }

  end(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.set(false);
    this.waitingForServer.set(false);
  }
}
