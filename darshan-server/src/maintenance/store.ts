import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool, PoolClient, QueryResult } from 'pg';
import * as schema from '../db/schema';
import type { DbExecutor } from '@/db';
import { MaintenanceCoordinatorError } from './errors';

export const CAPTURE_DEADLINE_SECONDS = 300;
export const DEFAULT_OPERATION_LEASE_SECONDS = 120;
const PREEMPTED_RETRY_DELAY_SECONDS = 5 * 60;

export type CaptureStatus = 'DRAINING' | 'COPYING' | 'SEALED' | 'ABORTED' | 'EXPIRED' | 'PREEMPTED';
export type OperationStatus = 'ACTIVE' | 'COMPLETED' | 'UNCERTAIN';

export interface MaintenanceSiteState {
  site_key: string;
  admission_open: boolean;
  generation: string;
  current_capture_id: string | null;
  updated_at: Date;
  capture_id: string | null;
  capture_status: CaptureStatus | null;
  backup_run_id: string | null;
  backup_attempt_id: string | null;
  capture_owner: string | null;
  capture_started_at: Date | null;
  capture_deadline_at: Date | null;
  staging_inventory_digest: string | null;
  sealed_at: Date | null;
  reopened_at: Date | null;
}

export interface BackupCapture {
  id: string;
  site_key: string;
  generation: string;
  backup_run_id: string;
  backup_attempt_id: string;
  capture_owner: string;
  status: CaptureStatus;
  started_at: Date;
  deadline_at: Date;
  staging_inventory_digest: string | null;
  sealed_at: Date | null;
  reopened_at: Date | null;
  updated_at: Date;
}

export interface MaintenanceOperation {
  id: string;
  site_key: string;
  generation: string;
  owner_token: string;
  operation_kind: string;
  status: OperationStatus;
  admitted_at: Date;
  lease_expires_at: Date;
  completed_at: Date | null;
  uncertain_at: Date | null;
  resolved_at: Date | null;
  resolution: 'CONFIRMED_COMPLETED' | 'CONFIRMED_ABORTED' | null;
  resolution_note: string | null;
  updated_at: Date;
}

export interface CaptureIdentity {
  siteKey: string;
  captureId: string;
  generation: number;
  backupRunId: string;
  backupAttemptId: string;
  owner: string;
}

export interface BeginCaptureInput {
  siteKey: string;
  backupRunId: string;
  backupAttemptId: string;
  owner: string;
}

export interface AdmissionInput {
  siteKey: string;
  operationKind: string;
  leaseSeconds?: number;
}

export interface EmergencyPreemptionResult {
  preempted: boolean;
  captureId: string | null;
  backupRunId: string | null;
  backupAttemptId: string | null;
}

type RowResult<T> = QueryResult<T & Record<string, unknown>>;

function first<T>(result: RowResult<T>): T | null {
  return (result.rows[0] as T | undefined) ?? null;
}

function requirePositiveLease(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new RangeError('Operation lease must be a whole number of seconds from 1 through 3600.');
  }
  return seconds;
}

function captureMatches(row: MaintenanceSiteState, identity: CaptureIdentity): boolean {
  return row.capture_id === identity.captureId
    && Number(row.generation) === identity.generation
    && row.backup_run_id === identity.backupRunId
    && row.backup_attempt_id === identity.backupAttemptId
    && row.capture_owner === identity.owner;
}

const SITE_SNAPSHOT_SQL = `
  SELECT site.site_key, site.admission_open, site.generation, site.current_capture_id,
         site.updated_at, capture.id AS capture_id, capture.status AS capture_status,
         capture.backup_run_id, capture.backup_attempt_id, capture.capture_owner,
         capture.started_at AS capture_started_at, capture.deadline_at AS capture_deadline_at,
         capture.staging_inventory_digest, capture.sealed_at, capture.reopened_at
  FROM maintenance_site_state AS site
  LEFT JOIN backup_captures AS capture ON capture.id = site.current_capture_id
  WHERE site.site_key = $1`;

export class MaintenanceStore {
  constructor(private readonly pool: Pool) {}

  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockSite(client: PoolClient, siteKey: string): Promise<MaintenanceSiteState> {
    await client.query(
      `INSERT INTO maintenance_site_state (site_key) VALUES ($1)
       ON CONFLICT (site_key) DO NOTHING`,
      [siteKey]
    );
    const locked = await client.query<{ current_capture_id: string | null }>(
      'SELECT current_capture_id FROM maintenance_site_state WHERE site_key = $1 FOR UPDATE',
      [siteKey]
    );
    if (!locked.rows[0]) throw new Error(`Maintenance site row ${siteKey} could not be initialized.`);
    if (locked.rows[0].current_capture_id) {
      await client.query('SELECT id FROM backup_captures WHERE id = $1 FOR UPDATE', [locked.rows[0].current_capture_id]);
    }
    return first<MaintenanceSiteState>(await client.query(SITE_SNAPSHOT_SQL, [siteKey]))!;
  }

  private async markExpiredOperationsUncertain(client: PoolClient, siteKey: string): Promise<number> {
    const result = await client.query(
      `UPDATE maintenance_operations
       SET status = 'UNCERTAIN', uncertain_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE site_key = $1 AND status = 'ACTIVE' AND lease_expires_at <= clock_timestamp()`,
      [siteKey]
    );
    return result.rowCount ?? 0;
  }

  private async fenceAttemptForRetryRaw(
    client: PoolClient,
    capture: Pick<MaintenanceSiteState, 'backup_run_id' | 'backup_attempt_id'>,
    code: 'MAINTENANCE_CAPTURE_DEADLINE_EXPIRED' | 'MAINTENANCE_CAPTURE_PREEMPTED'
  ): Promise<boolean> {
    if (!capture.backup_run_id || !capture.backup_attempt_id) return false;
    await client.query('SAVEPOINT maintenance_fence_attempt');
    try {
      await client.query(
        'SELECT id FROM backup_runs WHERE id = $1 FOR UPDATE NOWAIT',
        [capture.backup_run_id]
      );
      const result = await client.query(
        `UPDATE backup_runs
       SET status = 'RETRY_WAIT', stage = 'RETRY_WAIT',
           retry_at = clock_timestamp() + make_interval(secs => $3),
           attempt_id = NULL, heartbeat_at = NULL, lease_expires_at = NULL,
           deadline_at = NULL, queue_job_id = NULL, error_code = $4,
           error_message = 'Capture attempt was fenced and requires retry reconciliation',
           updated_at = clock_timestamp()
       WHERE id = $1 AND attempt_id = $2 AND status = 'RUNNING'`,
        [capture.backup_run_id, capture.backup_attempt_id, PREEMPTED_RETRY_DELAY_SECONDS, code]
      );
      await client.query('RELEASE SAVEPOINT maintenance_fence_attempt');
      return Boolean(result.rowCount);
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT maintenance_fence_attempt');
      await client.query('RELEASE SAVEPOINT maintenance_fence_attempt');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03') {
        return false;
      }
      throw error;
    }
  }

  private async reopenExpiredCaptureLocked(client: PoolClient, row: MaintenanceSiteState): Promise<MaintenanceSiteState> {
    if (row.admission_open || !row.capture_deadline_at || !['DRAINING', 'COPYING'].includes(row.capture_status ?? '')) {
      return row;
    }
    const expired = first<{ expired: boolean }>(await client.query(
      'SELECT clock_timestamp() >= $1::timestamptz AS expired',
      [row.capture_deadline_at]
    ));
    if (!expired?.expired) return row;
    await this.fenceAttemptForRetryRaw(client, row, 'MAINTENANCE_CAPTURE_DEADLINE_EXPIRED');
    await client.query(
      `UPDATE backup_captures SET status = 'EXPIRED', reopened_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE id = $1 AND status IN ('DRAINING', 'COPYING')`,
      [row.capture_id]
    );
    await client.query(
      `UPDATE maintenance_site_state SET admission_open = true, updated_at = clock_timestamp()
       WHERE site_key = $1`,
      [row.site_key]
    );
    return first<MaintenanceSiteState>(await client.query(SITE_SNAPSHOT_SQL, [row.site_key]))!;
  }

  async admitOperation(input: AdmissionInput): Promise<MaintenanceOperation> {
    const leaseSeconds = requirePositiveLease(input.leaseSeconds ?? DEFAULT_OPERATION_LEASE_SECONDS);
    return this.withTransaction(async (client) => {
      let site = await this.lockSite(client, input.siteKey);
      site = await this.reopenExpiredCaptureLocked(client, site);
      await this.markExpiredOperationsUncertain(client, input.siteKey);
      if (!site.admission_open) {
        throw new MaintenanceCoordinatorError(
          'MAINTENANCE_ADMISSION_CLOSED',
          'Ordinary mutations are temporarily paused for a consistent capture.',
          { siteKey: input.siteKey, captureId: site.capture_id, retryAt: site.capture_deadline_at }
        );
      }
      return first<MaintenanceOperation>(await client.query(
        `INSERT INTO maintenance_operations
          (id, site_key, generation, owner_token, operation_kind, lease_expires_at)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp() + make_interval(secs => $6)) RETURNING *`,
        [randomUUID(), input.siteKey, site.generation, randomUUID(), input.operationKind, leaseSeconds]
      ))!;
    });
  }

  async heartbeatOperation(operationId: string, ownerToken: string, leaseSeconds = DEFAULT_OPERATION_LEASE_SECONDS): Promise<boolean> {
    const seconds = requirePositiveLease(leaseSeconds);
    const result = await this.pool.query(
      `UPDATE maintenance_operations
       SET lease_expires_at = clock_timestamp() + make_interval(secs => $3), updated_at = clock_timestamp()
       WHERE id = $1 AND owner_token = $2 AND status = 'ACTIVE' AND lease_expires_at > clock_timestamp()
       RETURNING id`,
      [operationId, ownerToken, seconds]
    );
    if (result.rowCount) return true;
    await this.pool.query(
      `UPDATE maintenance_operations SET status = 'UNCERTAIN', uncertain_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE id = $1 AND owner_token = $2 AND status = 'ACTIVE' AND lease_expires_at <= clock_timestamp()`,
      [operationId, ownerToken]
    );
    return false;
  }

  async completeOperation(operationId: string, ownerToken: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE maintenance_operations SET status = 'COMPLETED', completed_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE id = $1 AND owner_token = $2 AND status = 'ACTIVE' AND lease_expires_at > clock_timestamp()
       RETURNING id`,
      [operationId, ownerToken]
    );
    if (result.rowCount) return;
    const current = first<Pick<MaintenanceOperation, 'owner_token' | 'status'>>(await this.pool.query(
      'SELECT owner_token, status FROM maintenance_operations WHERE id = $1', [operationId]
    ));
    if (!current) throw new MaintenanceCoordinatorError('MAINTENANCE_OPERATION_NOT_FOUND', 'Maintenance operation does not exist.');
    if (current.owner_token !== ownerToken) {
      throw new MaintenanceCoordinatorError('MAINTENANCE_OPERATION_NOT_OWNER', 'A stale owner cannot release this operation.');
    }
    if (current.status === 'ACTIVE') await this.markOperationUncertain(operationId, ownerToken);
    throw new MaintenanceCoordinatorError('MAINTENANCE_OPERATION_NOT_OWNER', 'The operation lease no longer grants completion authority.');
  }

  async markOperationUncertain(operationId: string, ownerToken: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE maintenance_operations SET status = 'UNCERTAIN', uncertain_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE id = $1 AND owner_token = $2 AND status = 'ACTIVE' RETURNING id`,
      [operationId, ownerToken]
    );
    if (result.rowCount) return;
    const current = first<Pick<MaintenanceOperation, 'owner_token'>>(await this.pool.query(
      'SELECT owner_token FROM maintenance_operations WHERE id = $1', [operationId]
    ));
    if (!current) throw new MaintenanceCoordinatorError('MAINTENANCE_OPERATION_NOT_FOUND', 'Maintenance operation does not exist.');
    if (current.owner_token !== ownerToken) {
      throw new MaintenanceCoordinatorError('MAINTENANCE_OPERATION_NOT_OWNER', 'A stale owner cannot change this operation.');
    }
  }

  async resolveUncertainOperation(input: {
    operationId: string;
    resolution: 'CONFIRMED_COMPLETED' | 'CONFIRMED_ABORTED';
    note: string;
  }): Promise<MaintenanceOperation> {
    if (!input.note.trim()) throw new TypeError('An explicit reconciliation note is required.');
    const operation = first<MaintenanceOperation>(await this.pool.query(
      `UPDATE maintenance_operations SET status = 'COMPLETED', resolution = $2, resolution_note = $3,
         resolved_at = clock_timestamp(), completed_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE id = $1 AND status = 'UNCERTAIN' RETURNING *`,
      [input.operationId, input.resolution, input.note.trim()]
    ));
    if (!operation) {
      throw new MaintenanceCoordinatorError('MAINTENANCE_OPERATION_NOT_UNCERTAIN', 'Only an explicitly reviewed uncertain operation can be resolved.');
    }
    return operation;
  }

  async beginCapture(input: BeginCaptureInput): Promise<MaintenanceSiteState> {
    return this.withTransaction(async (client) => {
      // Acquire attempt authority before the shared site row. A slow/blocked
      // backup row must never hold admission closed or prevent the watchdog or
      // an emergency from taking the site lock.
      await client.query('SELECT id FROM backup_runs WHERE id = $1 FOR UPDATE', [input.backupRunId]);
      let site = await this.lockSite(client, input.siteKey);
      site = await this.reopenExpiredCaptureLocked(client, site);
      if (!site.admission_open && ['DRAINING', 'COPYING'].includes(site.capture_status ?? '')) {
        throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_ACTIVE', 'A capture is already active.', {
          captureId: site.capture_id, deadlineAt: site.capture_deadline_at,
        });
      }
      // Do not lock the emergency row here: emergency transitions lock their
      // domain row before this site row. A read after taking the site lock is
      // sufficient because every committing transition must subsequently
      // acquire this same row and preempt a capture that won the race.
      const activeEmergency = first<{ id: string; expires_at: Date | null }>(await client.query(
        `SELECT id, expires_at FROM emergencies
         WHERE is_active = true AND cleared_at IS NULL
           AND (expires_at IS NULL OR expires_at > clock_timestamp())
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      ));
      if (activeEmergency) {
        throw new MaintenanceCoordinatorError(
          'MAINTENANCE_CAPTURE_EMERGENCY_ACTIVE',
          'A backup capture cannot begin while an emergency is active.',
          { emergencyId: activeEmergency.id, expiresAt: activeEmergency.expires_at }
        );
      }
      // Evaluate every clock predicate after both locks. PostgreSQL may
      // otherwise accept authority that expired while either lock waited.
      const attempt = first<{ valid: boolean }>(await client.query(
        `SELECT true AS valid FROM backup_runs
         WHERE id = $1 AND attempt_id = $2 AND status = 'RUNNING' AND cancellation_requested_at IS NULL
           AND lease_expires_at > clock_timestamp() AND deadline_at > clock_timestamp()`,
        [input.backupRunId, input.backupAttemptId]
      ));
      if (!attempt?.valid) {
        throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_ATTEMPT_MISMATCH', 'The backup attempt is not current and live.');
      }
      const captureId = randomUUID();
      const generation = Number(site.generation) + 1;
      await client.query(
        `INSERT INTO backup_captures
          (id, site_key, generation, backup_run_id, backup_attempt_id, capture_owner,
           status, started_at, deadline_at, updated_at)
         SELECT $1, $2, $3, $4, $5, $6, 'DRAINING', capture_clock.now,
                capture_clock.now + interval '${CAPTURE_DEADLINE_SECONDS} seconds', capture_clock.now
         FROM (SELECT clock_timestamp() AS now) AS capture_clock`,
        [captureId, input.siteKey, generation, input.backupRunId, input.backupAttemptId, input.owner]
      );
      await client.query(
        `UPDATE maintenance_site_state SET admission_open = false, generation = $2,
           current_capture_id = $3, updated_at = clock_timestamp() WHERE site_key = $1`,
        [input.siteKey, generation, captureId]
      );
      return first<MaintenanceSiteState>(await client.query(SITE_SNAPSHOT_SQL, [input.siteKey]))!;
    });
  }

  private assertCapture(site: MaintenanceSiteState, identity: CaptureIdentity): void {
    if (!site.capture_id) throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_NOT_FOUND', 'No capture exists for this site.');
    if (!captureMatches(site, identity)) {
      throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_FENCED', 'Capture ownership or generation has been fenced.');
    }
  }

  async enterCopying(identity: CaptureIdentity): Promise<MaintenanceSiteState> {
    const result = await this.withTransaction(async (client): Promise<{
      state: MaintenanceSiteState | null;
      unresolved: number;
      expired: boolean;
    }> => {
      let site = await this.lockSite(client, identity.siteKey);
      site = await this.reopenExpiredCaptureLocked(client, site);
      this.assertCapture(site, identity);
      if (site.capture_status === 'EXPIRED') {
        // Commit expiry/retry fencing before returning the stale-worker error.
        return { state: null, unresolved: 0, expired: true };
      }
      if (site.capture_status !== 'DRAINING') {
        throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_FENCED', 'Capture is not in the draining stage.');
      }
      await this.markExpiredOperationsUncertain(client, identity.siteKey);
      const unresolved = first<{ count: string }>(await client.query(
        `SELECT count(*)::text AS count FROM maintenance_operations
         WHERE site_key = $1 AND status IN ('ACTIVE', 'UNCERTAIN')`, [identity.siteKey]
      ));
      const count = Number(unresolved?.count ?? 0);
      if (count !== 0) return { state: null, unresolved: count, expired: false };
      await client.query(
        `UPDATE backup_captures SET status = 'COPYING', updated_at = clock_timestamp()
         WHERE id = $1 AND status = 'DRAINING'`, [identity.captureId]
      );
      return {
        state: first<MaintenanceSiteState>(await client.query(SITE_SNAPSHOT_SQL, [identity.siteKey]))!,
        unresolved: 0,
        expired: false,
      };
    });
    if (result.expired) {
      throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_DEADLINE_EXPIRED', 'The capture deadline expired.');
    }
    if (!result.state) {
      throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_NOT_DRAINED',
        'Capture cannot copy until every admitted operation is explicitly resolved.',
        { unresolvedOperations: result.unresolved });
    }
    return result.state;
  }

  async sealCapture(identity: CaptureIdentity, digest: string): Promise<MaintenanceSiteState> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError('The staging inventory digest must be a lowercase SHA-256 hex value.');
    return this.withTransaction(async (client) => {
      // Never wait for the attempt row while holding the site/capture lock.
      // Watchdog expiry and emergency preemption must remain able to reopen the
      // barrier at the immutable deadline.
      await client.query('SELECT id FROM backup_runs WHERE id = $1 FOR UPDATE', [identity.backupRunId]);
      const site = await this.lockSite(client, identity.siteKey);
      this.assertCapture(site, identity);
      if (site.capture_status !== 'COPYING') {
        throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_FENCED', 'Only the current copying capture can seal.');
      }
      // Evaluate clock authority only after both locks are held.
      const authority = first<{ valid: boolean }>(await client.query(
        `SELECT true AS valid FROM backup_runs
         WHERE id = $1 AND attempt_id = $2 AND status = 'RUNNING' AND cancellation_requested_at IS NULL
           AND lease_expires_at > clock_timestamp() AND deadline_at > clock_timestamp()
           AND $3::timestamptz > clock_timestamp()`,
        [identity.backupRunId, identity.backupAttemptId, site.capture_deadline_at]
      ));
      if (!authority?.valid) {
        const deadline = first<{ expired: boolean }>(await client.query(
          'SELECT $1::timestamptz <= clock_timestamp() AS expired', [site.capture_deadline_at]
        ));
        throw new MaintenanceCoordinatorError(
          deadline?.expired ? 'MAINTENANCE_CAPTURE_DEADLINE_EXPIRED' : 'MAINTENANCE_CAPTURE_ATTEMPT_MISMATCH',
          deadline?.expired ? 'The capture deadline expired before sealing.' : 'The backup attempt lost publication authority.'
        );
      }
      const sealed = await client.query(
        `UPDATE backup_captures SET status = 'SEALED', staging_inventory_digest = $2,
           sealed_at = clock_timestamp(), reopened_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE id = $1 AND site_key = $3 AND generation = $4
           AND backup_run_id = $5 AND backup_attempt_id = $6 AND capture_owner = $7
           AND status = 'COPYING' AND deadline_at > clock_timestamp()
         RETURNING id`,
        [identity.captureId, digest, identity.siteKey, identity.generation,
          identity.backupRunId, identity.backupAttemptId, identity.owner]
      );
      if (!sealed.rowCount) {
        const deadline = first<{ expired: boolean }>(await client.query(
          'SELECT deadline_at <= clock_timestamp() AS expired FROM backup_captures WHERE id = $1',
          [identity.captureId]
        ));
        throw new MaintenanceCoordinatorError(
          deadline?.expired ? 'MAINTENANCE_CAPTURE_DEADLINE_EXPIRED' : 'MAINTENANCE_CAPTURE_FENCED',
          deadline?.expired ? 'The capture deadline expired before the final seal write.' : 'Capture authority changed before sealing.'
        );
      }
      await client.query(
        `UPDATE maintenance_site_state SET admission_open = true, updated_at = clock_timestamp()
         WHERE site_key = $1`, [identity.siteKey]
      );
      return first<MaintenanceSiteState>(await client.query(SITE_SNAPSHOT_SQL, [identity.siteKey]))!;
    });
  }

  async abortCapture(identity: CaptureIdentity): Promise<MaintenanceSiteState> {
    return this.withTransaction(async (client) => {
      const site = await this.lockSite(client, identity.siteKey);
      this.assertCapture(site, identity);
      if (!['DRAINING', 'COPYING'].includes(site.capture_status ?? '')) {
        throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_FENCED', 'The capture is no longer active.');
      }
      // Ordinary capture failures reopen admission but leave the Packet 1
      // attempt current so its worker can truthfully classify prerequisite,
      // transient, or cancellation outcomes. ABORTED capture status itself
      // permanently fences stale sealing/publication.
      await client.query(
        `UPDATE backup_captures SET status = 'ABORTED', reopened_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE id = $1`, [identity.captureId]
      );
      await client.query(
        `UPDATE maintenance_site_state SET admission_open = true, updated_at = clock_timestamp()
         WHERE site_key = $1`, [identity.siteKey]
      );
      return first<MaintenanceSiteState>(await client.query(SITE_SNAPSHOT_SQL, [identity.siteKey]))!;
    });
  }

  /** Caller-owned Drizzle transaction: authorization, emergency write and preemption commit together. */
  async preemptForEmergencyInExecutor(executor: DbExecutor, siteKey: string): Promise<EmergencyPreemptionResult> {
    await executor.insert(schema.maintenanceSiteState).values({ site_key: siteKey }).onConflictDoNothing();
    const [site] = await executor.select().from(schema.maintenanceSiteState)
      .where(eq(schema.maintenanceSiteState.site_key, siteKey)).for('update');
    if (!site?.current_capture_id) return { preempted: false, captureId: null, backupRunId: null, backupAttemptId: null };
    const [capture] = await executor.select().from(schema.backupCaptures)
      .where(eq(schema.backupCaptures.id, site.current_capture_id)).for('update');
    if (!capture || !['DRAINING', 'COPYING'].includes(capture.status)) {
      return {
        preempted: false,
        captureId: capture?.id ?? null,
        backupRunId: capture?.backup_run_id ?? null,
        backupAttemptId: capture?.backup_attempt_id ?? null,
      };
    }
    const [clock] = (await executor.execute(sql`SELECT clock_timestamp() >= ${capture.deadline_at} AS expired`)).rows as Array<{ expired: boolean }>;
    const status: CaptureStatus = clock?.expired ? 'EXPIRED' : 'PREEMPTED';
    const code = clock?.expired ? 'MAINTENANCE_CAPTURE_DEADLINE_EXPIRED' : 'MAINTENANCE_CAPTURE_PREEMPTED';
    // Capture authority is the emergency safety fence. Backup-run bookkeeping
    // is attempted NOWAIT so unrelated work holding that row can never delay
    // the emergency transaction while it owns the shared site lock. If the row
    // is busy, the fenced worker (or lease reconciliation) settles it later.
    await executor.execute(sql.raw('SAVEPOINT maintenance_preempt_attempt'));
    try {
      await executor.execute(sql`
        SELECT id FROM ${schema.backupRuns}
        WHERE ${schema.backupRuns.id} = ${capture.backup_run_id}
        FOR UPDATE NOWAIT
      `);
      await executor.update(schema.backupRuns).set({
        status: 'RETRY_WAIT',
        stage: 'RETRY_WAIT',
        retry_at: sql`clock_timestamp() + interval '5 minutes'`,
        attempt_id: null,
        heartbeat_at: null,
        lease_expires_at: null,
        deadline_at: null,
        queue_job_id: null,
        error_code: code,
        error_message: 'Capture attempt was fenced and requires retry reconciliation',
        updated_at: sql`clock_timestamp()`,
      }).where(and(
        eq(schema.backupRuns.id, capture.backup_run_id),
        eq(schema.backupRuns.attempt_id, capture.backup_attempt_id),
        eq(schema.backupRuns.status, 'RUNNING')
      ));
      await executor.execute(sql.raw('RELEASE SAVEPOINT maintenance_preempt_attempt'));
    } catch (error) {
      await executor.execute(sql.raw('ROLLBACK TO SAVEPOINT maintenance_preempt_attempt'));
      await executor.execute(sql.raw('RELEASE SAVEPOINT maintenance_preempt_attempt'));
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03')) {
        throw error;
      }
    }
    await executor.update(schema.backupCaptures).set({
      status,
      reopened_at: sql`clock_timestamp()`,
      updated_at: sql`clock_timestamp()`,
    }).where(eq(schema.backupCaptures.id, capture.id));
    await executor.update(schema.maintenanceSiteState).set({
      admission_open: true,
      updated_at: sql`clock_timestamp()`,
    }).where(eq(schema.maintenanceSiteState.site_key, siteKey));
    return {
      preempted: status === 'PREEMPTED',
      captureId: capture.id,
      backupRunId: capture.backup_run_id,
      backupAttemptId: capture.backup_attempt_id,
    };
  }

  async expireSite(siteKey: string): Promise<{ captureExpired: boolean; operationsMadeUncertain: number }> {
    return this.withTransaction(async (client) => {
      const before = await this.lockSite(client, siteKey);
      const after = await this.reopenExpiredCaptureLocked(client, before);
      const operationsMadeUncertain = await this.markExpiredOperationsUncertain(client, siteKey);
      return { captureExpired: before.capture_status !== 'EXPIRED' && after.capture_status === 'EXPIRED', operationsMadeUncertain };
    });
  }

  async reconcileStartup(): Promise<{ capturesExpired: number; operationsMadeUncertain: number }> {
    const sites = await this.pool.query<{ site_key: string }>('SELECT site_key FROM maintenance_site_state ORDER BY site_key');
    let capturesExpired = 0;
    let operationsMadeUncertain = 0;
    for (const site of sites.rows) {
      const result = await this.expireSite(site.site_key);
      if (result.captureExpired) capturesExpired += 1;
      operationsMadeUncertain += result.operationsMadeUncertain;
    }
    return { capturesExpired, operationsMadeUncertain };
  }

  async getSite(siteKey: string): Promise<MaintenanceSiteState | null> {
    return first<MaintenanceSiteState>(await this.pool.query(SITE_SNAPSHOT_SQL, [siteKey]));
  }

  async getCapture(captureId: string): Promise<BackupCapture | null> {
    return first<BackupCapture>(await this.pool.query('SELECT * FROM backup_captures WHERE id = $1', [captureId]));
  }

  async getOperation(operationId: string): Promise<MaintenanceOperation | null> {
    return first<MaintenanceOperation>(await this.pool.query('SELECT * FROM maintenance_operations WHERE id = $1', [operationId]));
  }
}
