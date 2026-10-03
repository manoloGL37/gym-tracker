import { Component, OnInit, OnDestroy, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthSessionService } from '../../auth/auth-session.service';
import { AccountSyncService } from '../../migration/account-sync.service';
import { LocalToCloudMigrationService, RecoveryInspection } from '../../migration/local-to-cloud-migration.service';
import { validateCalendarZone } from '../../migration/workout-snapshot';

type RecoveryBackup = Awaited<ReturnType<LocalToCloudMigrationService['exportRecoveryBackup']>>;
type ReviewRow = RecoveryInspection & { name: string; startedAt: string; confirmOnly: boolean };

@Component({
  standalone: true, selector: 'app-sync-recovery', imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './sync-recovery.component.html', styleUrl: './sync-recovery.component.css',
})
export class SyncRecoveryComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthSessionService);
  private readonly sync = inject(AccountSyncService);
  private readonly migration = inject(LocalToCloudMigrationService);
  private readonly accountId = this.auth.currentUser()?.id;
  readonly busy = signal(false);
  readonly ready = signal(false);
  readonly backupDownloaded = signal(false);
  readonly backupVerified = signal(false);
  readonly rows = signal<ReviewRow[]>([]);
  readonly selected = signal<string[]>([]);
  readonly error = signal<string | null>(null);
  readonly message = signal('');
  readonly processed = signal(0);
  readonly target = signal(0);
  readonly confirm = signal(false);
  readonly stopped = signal(false);
  readonly recovering = signal(false);
  readonly groups = [
    { kind: 'A' as const, title: 'Ya sincronizados', explanation: 'Su contenido coincide con el guardado en tu cuenta.' },
    { kind: 'B' as const, title: 'Ausentes en tu cuenta', explanation: 'Se pueden recuperar conservando el historial original.' },
    { kind: 'C' as const, title: 'Guardados con diferencias', explanation: 'Necesitan revisión individual antes de cambiar nada.' },
    { kind: 'D' as const, title: 'Necesitan revisión', explanation: 'Falta información para recuperarlos con seguridad.' },
  ];
  readonly locksSupported = Boolean(navigator.locks);
  zone = '';
  zoneConfirmed = false;
  fromDate = '';
  toDate = '';
  private backup: RecoveryBackup | null = null;
  private backupHash = '';
  private backupSize = 0;
  private paused = false;
  private destroyed = false;
  private readonly abort = new AbortController();

  constructor() {
    effect(() => {
      if (this.auth.currentUser()?.id !== this.accountId || !this.auth.isAuthenticated()) {
        this.stopped.set(true); this.rows.set([]); this.selected.set([]); this.backupVerified.set(false);
        this.error.set('La cuenta cambió o está desconectada. Vuelve a Ajustes y entra de nuevo.');
      }
    });
  }

  async ngOnInit(): Promise<void> {
    if (!this.accountId || !this.auth.isAuthenticated()) return;
    this.paused = true;
    await this.sync.pauseForRecovery();
    if (this.destroyed) this.close(); else this.ready.set(true);
  }

  ngOnDestroy(): void {
    this.destroyed = true; this.stopped.set(true); this.abort.abort();
    if (!this.busy()) this.close();
  }

  private close(): void {
    if (this.paused) { this.paused = false; this.sync.resumeAfterRecovery(); }
  }

  private assertAccount(): string {
    if (this.destroyed || !this.ready() || !this.accountId || !this.auth.isAuthenticated() || this.auth.currentUser()?.id !== this.accountId) throw new Error('La cuenta no está disponible. Vuelve a Ajustes.');
    return this.accountId;
  }

  private async action(task: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(null);
    try {
      this.assertAccount();
      if (navigator.locks) await navigator.locks.request('gym-tracker-ledger', { signal: this.abort.signal }, task);
      else await task(); // Readonly backup/review work without locks; sending is disabled below.
    } catch (error) {
      if (!this.destroyed) this.error.set(error instanceof HttpErrorResponse || (error instanceof Error && /timeout/i.test(error.name + error.message))
        ? 'No se recibió confirmación del servidor. Tus datos siguen guardados; vuelve a revisar antes de continuar.'
        : error instanceof Error ? error.message : 'No se pudo completar. Tus datos siguen guardados; vuelve a revisar.');
    }
    finally { this.busy.set(false); if (this.destroyed) this.close(); }
  }

  private async hash(bytes: Uint8Array): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async downloadBackup(): Promise<void> {
    await this.action(async () => {
      const backup = await this.migration.exportRecoveryBackup();
      const bytes = new TextEncoder().encode(JSON.stringify(backup));
      const hash = await this.hash(bytes);
      this.assertAccount();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `gym-tracker-recuperacion-${Date.now()}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      this.backup = backup; this.backupHash = hash; this.backupSize = bytes.byteLength;
      this.backupDownloaded.set(true); this.backupVerified.set(false); this.clearReview();
      this.message.set('Copia descargada. Ábrela con «Comprobar copia» para verificar que se guardó completa.');
    });
  }

  async verifyBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    await this.action(async () => {
      this.backupVerified.set(false);
      this.clearReview();
      if (!this.backupDownloaded() || !this.backup || file.size !== this.backupSize || await this.hash(new Uint8Array(await file.arrayBuffer())) !== this.backupHash) throw new Error('La copia seleccionada no coincide con la descargada. Selecciona el archivo de recuperación más reciente.');
      this.assertAccount(); this.backupVerified.set(true);
      this.message.set(`Copia completa verificada: ${this.backup.stores.workoutHistory.length} entrenamientos y ${this.backup.stores.migrationLedgers.length} registros de sincronización de cuentas.`);
    });
  }

  clearReview(): void { this.rows.set([]); this.selected.set([]); this.confirm.set(false); }

  canReview(): boolean { return this.ready() && this.backupVerified() && this.zoneConfirmed && Boolean(this.zone) && !this.busy(); }

  async review(): Promise<void> {
    if (!this.canReview()) return;
    await this.action(async () => {
      this.clearReview();
      try { validateCalendarZone(this.zone); } catch { throw new Error('Escribe una zona horaria válida, por ejemplo Europe/Madrid, y confírmala para estas sesiones.'); }
      const accountId = this.assertAccount();
      const local = await this.migration.exportRecoveryBackup();
      const ids = local.stores.workoutHistory.filter(workout => {
        const day = this.day(workout.startedAt);
        return (!this.fromDate || day >= this.fromDate) && (!this.toDate || day <= this.toDate);
      }).map(workout => workout.id);
      if (this.fromDate && this.toDate && this.fromDate > this.toDate) throw new Error('La fecha inicial debe ser anterior a la final.');
      this.message.set('Consultando todos tus registros remotos. Puede tardar unos minutos.');
      const inspection = await this.migration.inspectRecovery(accountId, this.zone, ids);
      this.assertAccount();
      const ledger = local.stores.migrationLedgers.find(value => value.accountId === accountId);
      this.rows.set(inspection.map(row => {
        const workout = local.stores.workoutHistory.find(value => value.id === row.localId)!;
        return { ...row, name: workout.routineName, startedAt: workout.startedAt,
          confirmOnly: row.classification === 'A' && ledger?.workouts[row.localId]?.snapshotMode === 'recovery' && ledger.workouts[row.localId].status !== 'migrated' };
      }));
      this.selected.set(this.rows().filter(row => row.classification === 'B' || row.confirmOnly).map(row => row.localId));
      this.message.set('Revisión terminada. Selecciona las sesiones que quieres recuperar.');
    });
  }

  count(kind: RecoveryInspection['classification']): number { return this.rows().filter(row => row.classification === kind).length; }
  groupRows(kind: RecoveryInspection['classification']): ReviewRow[] { return this.rows().filter(row => row.classification === kind); }
  toggle(id: string, checked: boolean): void { this.confirm.set(false); this.selected.update(ids => checked ? [...ids, id] : ids.filter(value => value !== id)); }
  day(instant: string): string {
    const parts = new Intl.DateTimeFormat('en', { timeZone: this.zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
  }
  date(instant: string): string {
    try { return new Date(instant).toLocaleString('es', { timeZone: this.zone, dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return instant; }
  }

  async recover(): Promise<void> {
    if (!this.confirm() || !this.canReview() || !this.locksSupported || !this.selected().length) return;
    const chosen = this.rows().filter(row => this.selected().includes(row.localId) && (row.classification === 'B' || row.confirmOnly));
    this.recovering.set(true);
    setTimeout(() => document.getElementById('recovery-feedback')?.scrollIntoView({ block: 'nearest' }), 0);
    await this.action(async () => {
      this.stopped.set(false); this.confirm.set(false); this.processed.set(0); this.target.set(chosen.length);
      const accountId = this.assertAccount();
      for (const row of chosen) {
        if (this.stopped() || this.destroyed) break;
        this.assertAccount();
        const latest = await this.migration.exportRecoveryBackup();
        const original = this.backup!.stores.workoutHistory.find(workout => workout.id === row.localId);
        const current = latest.stores.workoutHistory.find(workout => workout.id === row.localId);
        const originalId = this.backup!.stores.migrationLedgers.find(value => value.accountId === accountId)?.workouts[row.localId]?.clientId;
        const mapping = latest.stores.migrationLedgers.find(value => value.accountId === accountId)?.workouts[row.localId];
        if (!mapping || !original || JSON.stringify(original) !== JSON.stringify(current) || !originalId || originalId !== mapping.clientId) throw new Error('Esta sesión cambió desde la copia. Descarga y verifica una nueva copia antes de continuar.');
        this.message.set(`Recuperando ${this.processed() + 1} de ${chosen.length}: ${row.name}`);
        if (!mapping.snapshotPayload || mapping.snapshotMode !== 'recovery') await this.migration.prepareRecovery(accountId, row.localId, this.zone, { backupsVerified: true, historicalZoneConfirmed: true });
        if (this.stopped() || this.destroyed) break;
        await this.migration.recoverPreparedWorkout(accountId, row.localId, { backupsVerified: true, historicalZoneConfirmed: true, replayApproved: true });
        this.processed.update(value => value + 1);
        this.selected.update(ids => ids.filter(id => id !== row.localId));
        this.rows.update(rows => rows.map(value => value.localId === row.localId ? { ...value, classification: 'A', confirmOnly: false } : value));
      }
      this.message.set(this.stopped() ? 'Recuperación detenida. Vuelve a revisar antes de continuar.' : 'Recuperación terminada. Abre Gym Tracker Android y actualiza Historial.');
    });
    this.recovering.set(false);
    if (this.error()) { this.clearReview(); this.message.set('Proceso interrumpido. Revisa de nuevo: una sesión puede haberse guardado aunque no llegara la respuesta.'); }
  }
}
