import { Injectable, computed, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { AccountSyncState } from './account-sync.service';

const categories = { exercise: 'Ejercicio', routine: 'Rutina', workout: 'Entrenamiento', reference: 'Referencia', migration: 'Sincronización' };
const operations = { create: 'subir', reconcile: 'conciliar', verify: 'verificar', retry: 'reintentar', resolve: 'resolver', complete: 'terminar', pause: 'pausar' };
const results = { success: 'OK', pending: 'PENDIENTE', retrying: 'REINTENTO', attention: 'REQUIERE ATENCIÓN', failed: 'FALLO' };
const reasons = {
  'http-client': 'rechazo HTTP del cliente', 'http-server': 'error del servidor', network: 'sin respuesta de red', timeout: 'tiempo de espera agotado',
  'unresolved-reference': 'referencia de ejercicio sin resolver', 'snapshot-different': 'snapshot diferente', ambiguous: 'identidad o datos ambiguos',
  'local-or-validation': 'excepción local o no clasificada', backoff: 'esperando el plazo de reintento', 'retry-budget': 'límite de reintentos alcanzado',
};
type Category = keyof typeof categories;
type Operation = keyof typeof operations;
type Result = keyof typeof results;
type Reason = keyof typeof reasons;
export interface SyncDiagnosticEvent {
  time: number; category: Category; operation: Operation; result: Result;
  httpStatus?: number; reason?: Reason; attempt?: number; elapsedMs?: number;
  source?: 'manual' | 'automatic';
}
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
const member = <T extends object>(values: T, key: unknown): key is keyof T => typeof key === 'string' && Object.hasOwn(values, key);

/** Temporary observability only: no storage, IDs, payloads, headers or free-form error text. */
@Injectable({ providedIn: 'root' })
export class SyncDiagnosticsService {
  readonly limit = 200;
  private readonly buffer = signal<readonly SyncDiagnosticEvent[]>([]);
  readonly events = this.buffer.asReadonly();
  readonly recentEvents = computed(() => [...this.events()].reverse());
  readonly lastSuccess = signal<number | null>(null);
  readonly lastIssue = signal<number | null>(null);
  readonly current = signal<string | null>(null);
  readonly retryState = signal('Sin reintento observado');

  begin(category: Category, operation: Operation, attempt?: number): number {
    this.record({ category, operation, result: 'pending', attempt });
    return performance.now();
  }

  record(input: Omit<SyncDiagnosticEvent, 'time'>): void {
    // ponytail: copying at most 200 entries is simpler than a mutable ring; use a circular array if the cap grows.
    const event: SyncDiagnosticEvent = {
      time: Date.now(), category: member(categories, input.category) ? input.category : 'migration',
      operation: member(operations, input.operation) ? input.operation : 'verify', result: member(results, input.result) ? input.result : 'failed',
      reason: member(reasons, input.reason) ? input.reason : undefined,
      httpStatus: Number.isInteger(input.httpStatus) && input.httpStatus! >= 100 && input.httpStatus! <= 599 ? input.httpStatus : undefined,
      attempt: count(input.attempt), elapsedMs: count(input.elapsedMs),
      source: input.source === 'manual' || input.source === 'automatic' ? input.source : undefined,
    };
    this.buffer.update(values => [...values, event].slice(-this.limit));
    if (event.result === 'success') this.lastSuccess.set(event.time);
    if (event.reason || event.result === 'failed' || event.result === 'retrying' || event.result === 'attention') this.lastIssue.set(event.time);
    this.current.set(event.result === 'pending' && !event.reason && ['create', 'verify', 'reconcile', 'resolve'].includes(event.operation) ? `${categories[event.category]} · ${operations[event.operation]}` : null);
  }

  failure(category: Category, operation: Operation, error: unknown, result: Result = 'failed', attempt?: number, started?: number): void {
    const status = error instanceof HttpErrorResponse ? error.status : undefined;
    const reason: Reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout'
      : status === 0 ? 'network' : status && status >= 500 ? 'http-server' : status && status >= 400 ? 'http-client' : 'local-or-validation';
    this.record({ category, operation, result, reason, httpStatus: status, attempt, elapsedMs: started === undefined ? undefined : performance.now() - started });
  }

  time(value: number | null): string {
    return value === null ? 'Sin eventos' : new Date(value).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  line(event: SyncDiagnosticEvent): string {
    return `[${this.time(event.time)}] ${categories[event.category]} · ${operations[event.operation]} · ${results[event.result]}` +
      (event.httpStatus === undefined ? '' : ` · HTTP ${event.httpStatus}`) + (event.reason ? ` · ${reasons[event.reason]}` : '') +
      (event.source ? ` · ${event.source === 'manual' ? 'acción manual' : 'automático'}` : '') +
      (event.attempt === undefined ? '' : ` · intento ${event.attempt}`) + (event.elapsedMs === undefined ? '' : ` · ${event.elapsedMs} ms`);
  }

  text(state: AccountSyncState): string {
    return [
      'Diagnóstico temporal de sincronización (solo esta sesión)',
      `Confirmados/total: ${count(state.completed) ?? 0}/${count(state.total) ?? 0} · pendientes: ${count(state.pending) ?? 0} · atención: ${count(state.attention) ?? 0}`,
      `Último éxito: ${this.time(this.lastSuccess())} · último error/reintento: ${this.time(this.lastIssue())}`,
      `Operación actual: ${this.current() ?? 'Sin operación observada'} · ${this.retryState()}`,
      ...this.events().map(event => this.line(event)),
    ].join('\n');
  }

  clear(): void { this.buffer.set([]); }
}
