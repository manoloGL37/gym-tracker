import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { SyncDiagnosticsService } from './sync-diagnostics.service';

describe('Temporary sync diagnostics', () => {
  let diagnostics: SyncDiagnosticsService;
  const state = { status: 'syncing' as const, completed: 1404, total: 1431, pending: 25, remaining: 27, attention: 2 };
  beforeEach(() => { TestBed.configureTestingModule({}); diagnostics = TestBed.inject(SyncDiagnosticsService); });
  afterEach(() => TestBed.resetTestingModule());

  it('retains only the latest 200 events and clear changes only the visual buffer', () => {
    for (let attempt = 0; attempt < 205; attempt++) diagnostics.record({ category: 'workout', operation: 'create', result: 'success', attempt });
    expect(diagnostics.events().length).toBe(200);
    expect(diagnostics.events()[0].attempt).toBe(5);
    expect(diagnostics.events()[199].attempt).toBe(204);
    const lastSuccess = diagnostics.lastSuccess();
    diagnostics.clear();
    expect(diagnostics.events()).toEqual([]);
    expect(diagnostics.lastSuccess()).toBe(lastSuccess);
    expect(diagnostics.text(state)).toContain('1404/1431');
    expect(diagnostics.text(state)).not.toContain('Entrenamiento');
  });

  it('classifies HTTP 4xx, 5xx, network, timeout and unknown errors without storing their text or bodies', () => {
    const secret = 'private@example.test JWT-password-cookie-Authorization';
    for (const status of [401, 403, 422, 503, 0]) {
      diagnostics.failure('exercise', 'create', new HttpErrorResponse({ status, statusText: secret, error: { accessToken: secret }, url: secret }), 'pending', 2);
    }
    diagnostics.failure('routine', 'create', Object.assign(new Error(secret), { name: 'TimeoutError' }));
    diagnostics.failure('workout', 'verify', new Error(secret));
    expect(diagnostics.events().map(value => value.reason)).toEqual(['http-client', 'http-client', 'http-client', 'http-server', 'network', 'timeout', 'local-or-validation']);
    expect(diagnostics.events()[4].httpStatus).toBeUndefined();
    expect(diagnostics.text(state)).toContain('HTTP 503');
    expect(diagnostics.text(state)).toContain('tiempo de espera agotado');
    expect(diagnostics.text(state)).not.toContain(secret);
    expect(JSON.stringify(diagnostics.events())).not.toContain(secret);
  });

  it('whitelists fields and labels even when a caller supplies unexpected data', () => {
    diagnostics.record({ category: 'private@example.test', operation: '__proto__', result: 'cookie=secret', reason: 'Bearer token', httpStatus: 999, attempt: NaN, elapsedMs: -1, source: 'password', headers: { Authorization: 'secret' }, body: 'secret', email: 'private@example.test' } as any);
    const text = diagnostics.text(state);
    expect(text).not.toMatch(/private@example|Bearer|cookie|Authorization|password|secret|NaN|999/);
    expect(diagnostics.events()[0]).toEqual(jasmine.objectContaining({ category: 'migration', operation: 'verify', result: 'failed' }));
  });

  it('shows operation, timing, manual/automatic retry and last issue without guessing HTTP success status', () => {
    const started = diagnostics.begin('routine', 'create', 1);
    expect(diagnostics.current()).toBe('Rutina · subir');
    diagnostics.record({ category: 'routine', operation: 'create', result: 'success', elapsedMs: performance.now() - started });
    expect(diagnostics.events()[1].httpStatus).toBeUndefined();
    expect(diagnostics.current()).toBeNull();
    diagnostics.record({ category: 'migration', operation: 'retry', result: 'pending', source: 'manual' });
    diagnostics.record({ category: 'migration', operation: 'retry', result: 'retrying', source: 'automatic', attempt: 3 });
    expect(diagnostics.text(state)).toContain('acción manual');
    expect(diagnostics.text(state)).toContain('automático');
    expect(diagnostics.text(state)).toContain('intento 3');
    expect(diagnostics.lastSuccess()).not.toBeNull();
    expect(diagnostics.lastIssue()).not.toBeNull();
  });
});
