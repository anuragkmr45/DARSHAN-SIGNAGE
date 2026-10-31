import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { config as appConfig } from '@/config';
import type { DbExecutor } from '@/db';
import { AppError } from '@/utils/app-error';
import {
  createBackupRetentionPolicy,
  planBackupRetention,
  type RetentionBackup,
  type RetentionDecision,
} from './retention-policy';
import { observeBackupRepositoryCapacity, type BackupRepositoryCapacityHealth } from './status-health';
import { getLatestControlledRecoveryProjection } from '@/deployment/controlled-recovery-report';

const CURSOR_VERSION = 1;
const ACTIVE_OPERATION_STATES = ['PREPARED', 'RUNNING', 'RETRY_WAIT', 'PARTIAL', 'UNCERTAIN'] as const;

function resultRows<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Row[] }).rows;
  }
  return [];
}

function stableConflict(code: string, message: string, details?: Record<string, unknown>): AppError {
  return new AppError({ statusCode: 409, code, message, details });
}

/** Raw Drizzle `execute` rows are driver values, so timestamptz may be a string. */
export function normalizeBackupDatabaseInstant(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function instantIso(value: unknown): string | null {
  return normalizeBackupDatabaseInstant(value)?.toISOString() ?? null;
}

export function backupRetentionRuntimeSupport(): { supported: boolean; reason_code: string | null } {
  if (appConfig.BACKUP_REPOSITORY_KIND !== 'LOCAL_FILESYSTEM') {
    return { supported: false, reason_code: 'BACKUP_DELETE_REPOSITORY_UNSUPPORTED' };
  }
  if (appConfig.BACKUP_LOCAL_PROTOCOL !== 'V2_BROKER') {
    return { supported: false, reason_code: 'BACKUP_DELETE_BROKER_REQUIRED' };
  }
  if (!appConfig.BACKUP_SITE_ID || !appConfig.BACKUP_REPOSITORY_ID) {
    return { supported: false, reason_code: 'BACKUP_DELETE_RUNTIME_UNCONFIGURED' };
  }
  return { supported: true, reason_code: null };
}

type HistoryCursor = { v: 1; created_at: string; id: string };

export function encodeBackupHistoryCursor(createdAt: string, id: string): string {
  if (!normalizeBackupDatabaseInstant(createdAt)) {
    throw AppError.internal('Backup history contains an invalid creation timestamp.');
  }
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, created_at: createdAt, id } satisfies HistoryCursor))
    .toString('base64url');
}

export function decodeBackupHistoryCursor(value: string | undefined): HistoryCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<HistoryCursor>;
    const instant = normalizeBackupDatabaseInstant(parsed.created_at);
    if (parsed.v !== CURSOR_VERSION || !instant || typeof parsed.created_at !== 'string' ||
        typeof parsed.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) {
      throw new Error('invalid');
    }
    return { v: 1, created_at: parsed.created_at, id: parsed.id.toLowerCase() };
  } catch {
    throw AppError.badRequest('Backup history cursor is invalid.', { code: 'BACKUP_HISTORY_CURSOR_INVALID' });
  }
}

type InventoryRow = {
  backup_run_id: string;
  site_key: string;
  repository_id: string | null;
  outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  captured_at: unknown;
  lifecycle_state: RetentionBackup['lifecycleState'];
  verification_provenance: 'PUBLICATION_READ_BACK' | 'LEGACY_UNVERIFIED' | 'NONE';
  publication_id: string | null;
  manifest_sha256: string | null;
  verified_good_at: unknown;
  has_active_retention_operation: boolean;
  restore_hold: RetentionBackup['restoreHold'];
};

function mapInventory(row: InventoryRow): RetentionBackup {
  const capturedAt = normalizeBackupDatabaseInstant(row.captured_at);
  const verifiedGoodAt = normalizeBackupDatabaseInstant(row.verified_good_at);
  return {
    id: row.backup_run_id,
    siteKey: row.site_key,
    repositoryId: row.repository_id ?? '00000000-0000-0000-0000-000000000000',
    capturedAt,
    executionOutcome: row.outcome,
    lifecycleState: row.lifecycle_state,
    verification: row.verification_provenance === 'PUBLICATION_READ_BACK' && row.publication_id &&
        row.manifest_sha256 && verifiedGoodAt
      ? { kind: 'PUBLICATION_READ_BACK', publicationId: row.publication_id,
          manifestSha256: row.manifest_sha256, verifiedAt: verifiedGoodAt }
      : row.verification_provenance === 'LEGACY_UNVERIFIED'
        ? { kind: 'LEGACY_UNVERIFIED' }
        : null,
    hasActiveRetentionOperation: row.has_active_retention_operation,
    restoreHold: row.restore_hold,
  };
}

/** Complete durable inventory used for policy; intentionally independent from page size. */
async function loadPolicyDecisions(executor: DbExecutor): Promise<Map<string, RetentionDecision>> {
  const support = backupRetentionRuntimeSupport();
  if (!support.supported || !appConfig.BACKUP_SITE_ID || !appConfig.BACKUP_REPOSITORY_ID) return new Map();
  const result = await executor.execute(sql<InventoryRow>`
    SELECT outcome.backup_run_id, outcome.site_key, outcome.repository_id, outcome.outcome,
           outcome.captured_at, lifecycle.state AS lifecycle_state,
           outcome.verification_provenance, outcome.publication_id, outcome.manifest_sha256,
           outcome.verified_good_at,
           EXISTS (SELECT 1 FROM backup_retention_operations operation
                    WHERE operation.backup_run_id = outcome.backup_run_id
                      AND operation.status IN ('PREPARED','RUNNING','RETRY_WAIT','PARTIAL','UNCERTAIN')) AS has_active_retention_operation,
           CASE
             WHEN EXISTS (SELECT 1 FROM backup_restore_hold_projections hold
                           WHERE hold.backup_run_id = outcome.backup_run_id AND hold.status = 'UNCERTAIN') THEN 'UNCERTAIN'
             WHEN EXISTS (SELECT 1 FROM backup_restore_hold_projections hold
                           WHERE hold.backup_run_id = outcome.backup_run_id AND hold.status = 'ACTIVE') THEN 'ACTIVE'
             ELSE 'NONE'
           END AS restore_hold
      FROM backup_execution_outcomes outcome
      JOIN backup_artifact_lifecycles lifecycle ON lifecycle.backup_run_id = outcome.backup_run_id
     WHERE outcome.site_key = ${appConfig.BACKUP_SITE_ID}
       AND outcome.repository_id = ${appConfig.BACKUP_REPOSITORY_ID}
     ORDER BY outcome.captured_at DESC NULLS LAST, outcome.backup_run_id`);
  const clock = await executor.execute(sql<{ now: Date }>`SELECT clock_timestamp() AS now`);
  const now = normalizeBackupDatabaseInstant(resultRows<{ now: unknown }>(clock)[0]?.now);
  if (!now) return new Map();
  return new Map(planBackupRetention({
    now,
    backups: resultRows<InventoryRow>(result).map(mapInventory),
    policy: createBackupRetentionPolicy({ retentionDays: appConfig.BACKUP_RETENTION_DAYS }),
  }).map((decision) => [decision.backupId, decision]));
}

type BackupApiRow = {
  id: string;
  trigger_type: string;
  status: string;
  repository_kind: string;
  stage: string;
  attempt_id: string | null;
  attempt_number: number;
  heartbeat_at: unknown;
  lease_expires_at: unknown;
  deadline_at: unknown;
  retry_at: unknown;
  error_code: string | null;
  started_at: unknown;
  completed_at: unknown;
  captured_at: unknown;
  created_at: unknown;
  created_at_cursor: string;
  updated_at: unknown;
  repository_id: string | null;
  manifest_sha256: string | null;
  files: unknown;
  repository_manifest: unknown;
  capture_id: string | null;
  capture_generation: string | null;
  capture_status: string | null;
  capture_started_at: unknown;
  capture_sealed_at: unknown;
  publication_id: string | null;
  publication_status: string | null;
  publication_verified_at: unknown;
  outcome: string | null;
  verification_provenance: string | null;
  verified_good_at: unknown;
  lifecycle_state: string | null;
  lifecycle_version: number | null;
  lifecycle_error_code: string | null;
  operation_id: string | null;
  operation_kind: string | null;
  operation_status: string | null;
  operation_requested_at: unknown;
  operation_started_at: unknown;
  operation_completed_at: unknown;
  operation_retry_at: unknown;
  operation_error_code: string | null;
  operation_progress: unknown;
  tombstone_disposition: string | null;
  tombstone_recorded_at: unknown;
  tombstone_reason_code: string | null;
  restore_hold: 'NONE' | 'ACTIVE' | 'UNCERTAIN' | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function decimalString(value: unknown): string | null {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function safeErrorCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(value)
    ? value
    : value == null ? null : 'BACKUP_ERROR_UNAVAILABLE';
}

function safeArtifacts(row: BackupApiRow) {
  const manifest = isRecord(row.repository_manifest) ? row.repository_manifest : null;
  const manifestArtifacts = manifest && Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (manifestArtifacts.length > 0) {
    return manifestArtifacts.slice(0, 64).flatMap((value) => {
      if (!isRecord(value) || typeof value.name !== 'string' || typeof value.kind !== 'string') return [];
      const size = decimalString(value.ciphertextSizeBytes);
      return [{
        kind: value.kind,
        name: value.name.slice(0, 256),
        size_bytes: size,
        sha256: typeof value.ciphertextSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.ciphertextSha256)
          ? value.ciphertextSha256 : null,
      }];
    });
  }
  if (!Array.isArray(row.files)) return [];
  return row.files.slice(0, 64).flatMap((value) => {
    if (!isRecord(value) || typeof value.name !== 'string') return [];
    return [{ kind: 'OTHER', name: value.name.slice(0, 256), size_bytes: decimalString(value.size), sha256: null }];
  });
}

function serializeOperation(row: BackupApiRow) {
  if (!row.operation_id) return null;
  return {
    id: row.operation_id,
    kind: row.operation_kind,
    status: row.operation_status,
    requested_at: instantIso(row.operation_requested_at),
    started_at: instantIso(row.operation_started_at),
    completed_at: instantIso(row.operation_completed_at),
    retry_at: instantIso(row.operation_retry_at),
    error_code: safeErrorCode(row.operation_error_code),
    progress: Array.isArray(row.operation_progress) ? row.operation_progress.slice(0, 100).flatMap((item) => {
      if (!isRecord(item) || typeof item.kind !== 'string' || typeof item.status !== 'string') return [];
      return [{
        kind: item.kind,
        size_bytes: decimalString(item.size_bytes),
        status: item.status,
        attempt_count: typeof item.attempt_count === 'number' && Number.isSafeInteger(item.attempt_count)
          ? item.attempt_count : 0,
        deleted_at: instantIso(item.deleted_at),
        error_code: safeErrorCode(item.error_code),
      }];
    }) : [],
  };
}

function serializeBackup(row: BackupApiRow, decision: RetentionDecision | undefined, input: {
  canDelete: boolean;
  canDownload: boolean;
}) {
  const support = backupRetentionRuntimeSupport();
  const protectionCodes = decision?.protectionCodes ?? [
    row.repository_kind === 'LOCAL_FILESYSTEM' ? 'BACKUP_RETENTION_UNVERIFIED' : 'BACKUP_DELETE_REPOSITORY_UNSUPPORTED',
  ];
  const downloadable = row.repository_kind === 'LOCAL_FILESYSTEM' &&
    row.verification_provenance === 'PUBLICATION_READ_BACK' && row.lifecycle_state === 'AVAILABLE' &&
    Boolean(row.manifest_sha256) && safeArtifacts(row).length > 0;
  return {
    id: row.id,
    trigger_type: row.trigger_type,
    repository: { kind: row.repository_kind, id: row.repository_id },
    stage: row.stage,
    attempt: { id: row.attempt_id, number: row.attempt_number, heartbeat_at: instantIso(row.heartbeat_at),
      lease_expires_at: instantIso(row.lease_expires_at), retry_at: instantIso(row.retry_at),
      deadline_at: instantIso(row.deadline_at) },
    capture: row.capture_id ? {
      id: row.capture_id,
      generation: row.capture_generation,
      status: row.capture_status,
      started_at: instantIso(row.capture_started_at),
      sealed_at: instantIso(row.capture_sealed_at),
    } : null,
    verification: {
      provenance: row.verification_provenance ?? 'NONE',
      publication_id: row.publication_id,
      publication_status: row.publication_status,
      verified_at: instantIso(row.verified_good_at) ?? instantIso(row.publication_verified_at),
      manifest_sha256: row.manifest_sha256,
    },
    execution: {
      status: row.status,
      outcome: row.outcome ?? (['PENDING', 'RUNNING', 'RETRY_WAIT'].includes(row.status) ? 'INCOMPLETE' : null),
      error_code: safeErrorCode(row.error_code),
      started_at: instantIso(row.started_at),
      completed_at: instantIso(row.completed_at),
      captured_at: instantIso(row.captured_at),
    },
    lifecycle: {
      state: row.lifecycle_state ?? 'UNCERTAIN',
      version: row.lifecycle_version,
      error_code: safeErrorCode(row.lifecycle_error_code),
    },
    artifacts: safeArtifacts(row),
    retention: {
      eligible: decision?.eligible ?? false,
      expires_at: decision?.expiresAt?.toISOString() ?? null,
      protection_codes: protectionCodes,
      restore_hold: row.restore_hold ?? 'NONE',
      runtime_supported: support.supported,
      runtime_reason_code: support.reason_code,
    },
    permissions: {
      can_delete: input.canDelete && support.supported && decision?.eligible === true,
      can_download: input.canDownload && downloadable,
      download_unavailable_code: downloadable ? null : row.repository_kind !== 'LOCAL_FILESYSTEM'
        ? 'BACKUP_DOWNLOAD_LEGACY_SOURCE_UNSUPPORTED' : 'BACKUP_DOWNLOAD_SOURCE_NOT_VERIFIED',
      download_unavailable_reason: downloadable ? null : row.repository_kind !== 'LOCAL_FILESYSTEM'
        ? 'LEGACY_SOURCE_HAS_NO_TRUSTED_LOCAL_ENCRYPTED_STREAM' : 'SOURCE_IS_NOT_VERIFIED_AND_AVAILABLE',
    },
    operation: serializeOperation(row),
    tombstone: row.tombstone_disposition ? {
      disposition: row.tombstone_disposition,
      recorded_at: instantIso(row.tombstone_recorded_at),
      reason_code: row.tombstone_reason_code,
    } : null,
    created_at: instantIso(row.created_at),
    updated_at: instantIso(row.updated_at),
  };
}

const backupSelect = sql.raw(`
  SELECT run.id, run.trigger_type, run.status, run.repository_kind, run.stage,
         run.attempt_id, run.attempt_number, run.heartbeat_at, run.lease_expires_at,
         run.deadline_at, run.retry_at, run.error_code,
         run.started_at, run.completed_at, run.captured_at, run.created_at,
         run.created_at::text AS created_at_cursor, run.updated_at,
         run.repository_id, run.manifest_sha256, run.files, run.repository_manifest,
         capture.id AS capture_id, capture.generation::text AS capture_generation,
         capture.status AS capture_status, capture.started_at AS capture_started_at,
         capture.sealed_at AS capture_sealed_at,
         publication.id AS publication_id, publication.status AS publication_status,
         publication.verified_at AS publication_verified_at,
         outcome.outcome, outcome.verification_provenance, outcome.verified_good_at,
         lifecycle.state AS lifecycle_state, lifecycle.state_version AS lifecycle_version,
         lifecycle.last_error_code AS lifecycle_error_code,
         operation.id AS operation_id, operation.operation_kind, operation.status AS operation_status,
         operation.requested_at AS operation_requested_at, operation.started_at AS operation_started_at,
         operation.completed_at AS operation_completed_at, operation.retry_at AS operation_retry_at,
         operation.error_code AS operation_error_code,
         operation_progress.progress AS operation_progress,
         tombstone.disposition AS tombstone_disposition, tombstone.recorded_at AS tombstone_recorded_at,
         tombstone.reason_code AS tombstone_reason_code,
         CASE
           WHEN EXISTS (SELECT 1 FROM backup_restore_hold_projections hold
                         WHERE hold.backup_run_id = run.id AND hold.status = 'UNCERTAIN') THEN 'UNCERTAIN'
           WHEN EXISTS (SELECT 1 FROM backup_restore_hold_projections hold
                         WHERE hold.backup_run_id = run.id AND hold.status = 'ACTIVE') THEN 'ACTIVE'
           ELSE 'NONE'
         END AS restore_hold
    FROM backup_runs run
    LEFT JOIN backup_captures capture
      ON capture.backup_run_id = run.id AND capture.backup_attempt_id = run.attempt_id
    LEFT JOIN backup_execution_outcomes outcome ON outcome.backup_run_id = run.id
    LEFT JOIN backup_artifact_lifecycles lifecycle ON lifecycle.backup_run_id = run.id
    LEFT JOIN backup_publications publication ON publication.id = outcome.publication_id
    LEFT JOIN LATERAL (
      SELECT candidate.* FROM backup_retention_operations candidate
       WHERE candidate.backup_run_id = run.id
       ORDER BY (candidate.status IN ('PREPARED','RUNNING','RETRY_WAIT','PARTIAL','UNCERTAIN')) DESC,
                candidate.requested_at DESC, candidate.id DESC LIMIT 1
    ) operation ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'kind', progress.artifact_kind,
        'size_bytes', progress.expected_size_bytes,
        'status', progress.status,
        'attempt_count', progress.attempt_count,
        'deleted_at', progress.deleted_at,
        'error_code', progress.error_code
      ) ORDER BY progress.artifact_kind, progress.id), '[]'::jsonb) AS progress
      FROM (SELECT id, artifact_kind, expected_size_bytes, status, attempt_count, deleted_at, error_code
              FROM backup_retention_artifact_progress
             WHERE operation_id = operation.id ORDER BY artifact_kind, id LIMIT 100) progress
    ) operation_progress ON operation.id IS NOT NULL
    LEFT JOIN backup_retention_tombstones tombstone ON tombstone.backup_run_id = run.id
`);

export async function listBackupHistory(input: {
  executor: DbExecutor;
  limit: number;
  cursor?: string;
  canDelete: boolean;
  canDownload: boolean;
  capacityProvider?: () => Promise<BackupRepositoryCapacityHealth>;
}) {
  const cursor = decodeBackupHistoryCursor(input.cursor);
  const limit = Math.max(1, Math.min(input.limit, 100));
  const page = cursor
    ? await input.executor.execute(sql<BackupApiRow>`${backupSelect}
        WHERE (run.created_at, run.id) < (${cursor.created_at}::timestamptz, ${cursor.id}::uuid)
        ORDER BY run.created_at DESC, run.id DESC LIMIT ${limit + 1}`)
    : await input.executor.execute(sql<BackupApiRow>`${backupSelect}
        ORDER BY run.created_at DESC, run.id DESC LIMIT ${limit + 1}`);
  const policy = await loadPolicyDecisions(input.executor);
  const allRows = resultRows<BackupApiRow>(page);
  const rows = allRows.slice(0, limit);
  const next = allRows.length > limit && rows.length > 0
    ? encodeBackupHistoryCursor(rows[rows.length - 1].created_at_cursor, rows[rows.length - 1].id)
    : null;
  const healthResult = await input.executor.execute(sql<{
    now_at: unknown;
    latest_run_id: string | null; latest_status: string | null; latest_stage: string | null;
    latest_updated_at: unknown; active_operation_count: string;
    active_run_id: string | null; active_stage: string | null; active_attempt_id: string | null;
    active_attempt_number: number | null; active_heartbeat_at: unknown; active_lease_expires_at: unknown;
    active_retry_at: unknown; active_deadline_at: unknown; active_updated_at: unknown;
    latest_verified_run_id: string | null; latest_verified_at: unknown;
    latest_failure_run_id: string | null; latest_failure_at: unknown; latest_failure_code: string | null;
    latest_failure_attempt_number: number | null; retention_failure_count: string;
  }>`SELECT clock_timestamp() AS now_at,
            latest.id AS latest_run_id, latest.status AS latest_status, latest.stage AS latest_stage,
            latest.updated_at AS latest_updated_at,
            (SELECT count(*)::text FROM backup_retention_operations
              WHERE status IN ('PREPARED','RUNNING','RETRY_WAIT','PARTIAL','UNCERTAIN')) AS active_operation_count,
            active.id AS active_run_id, active.stage AS active_stage, active.attempt_id AS active_attempt_id,
            active.attempt_number AS active_attempt_number, active.heartbeat_at AS active_heartbeat_at,
            active.lease_expires_at AS active_lease_expires_at, active.retry_at AS active_retry_at,
            active.deadline_at AS active_deadline_at, active.updated_at AS active_updated_at,
            verified.backup_run_id AS latest_verified_run_id, verified.verified_good_at AS latest_verified_at,
            failed.id AS latest_failure_run_id, failed.completed_at AS latest_failure_at,
            failed.error_code AS latest_failure_code, failed.attempt_number AS latest_failure_attempt_number,
            (SELECT count(*)::text FROM backup_retention_operations
              WHERE status IN ('FAILED','PARTIAL','UNCERTAIN')) AS retention_failure_count
       FROM (SELECT id, status, stage, updated_at FROM backup_runs
              ORDER BY created_at DESC, id DESC LIMIT 1) latest
       LEFT JOIN LATERAL (SELECT id, stage, attempt_id, attempt_number, heartbeat_at, lease_expires_at,
                                  retry_at, deadline_at, updated_at FROM backup_runs
                            WHERE status IN ('PENDING','RUNNING','RETRY_WAIT')
                            ORDER BY created_at DESC, id DESC LIMIT 1) active ON TRUE
       LEFT JOIN LATERAL (SELECT backup_run_id, verified_good_at FROM backup_execution_outcomes
                            WHERE outcome = 'SUCCEEDED' AND verification_provenance = 'PUBLICATION_READ_BACK'
                              AND verified_good_at IS NOT NULL
                            ORDER BY verified_good_at DESC, backup_run_id DESC LIMIT 1) verified ON TRUE
       LEFT JOIN LATERAL (SELECT id, completed_at, error_code, attempt_number FROM backup_runs
                            WHERE status = 'FAILED'
                            ORDER BY completed_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1) failed ON TRUE
       RIGHT JOIN (SELECT 1) singleton ON TRUE`);
  const health = resultRows<{
    now_at: unknown;
    latest_run_id: string | null; latest_status: string | null; latest_stage: string | null;
    latest_updated_at: unknown; active_operation_count: string;
    active_run_id: string | null; active_stage: string | null; active_attempt_id: string | null;
    active_attempt_number: number | null; active_heartbeat_at: unknown; active_lease_expires_at: unknown;
    active_retry_at: unknown; active_deadline_at: unknown; active_updated_at: unknown;
    latest_verified_run_id: string | null; latest_verified_at: unknown;
    latest_failure_run_id: string | null; latest_failure_at: unknown; latest_failure_code: string | null;
    latest_failure_attempt_number: number | null; retention_failure_count: string;
  }>(healthResult)[0];
  const support = backupRetentionRuntimeSupport();
  const [capacity, recoveryReport] = await Promise.all([
    (input.capacityProvider ?? observeBackupRepositoryCapacity)(),
    appConfig.BACKUP_SITE_ID ? getLatestControlledRecoveryProjection(input.executor, appConfig.BACKUP_SITE_ID) : Promise.resolve(null),
  ]);
  const now = normalizeBackupDatabaseInstant(health?.now_at);
  const verifiedAt = normalizeBackupDatabaseInstant(health?.latest_verified_at);
  const heartbeatAt = normalizeBackupDatabaseInstant(health?.active_heartbeat_at);
  const activeObservedAt = heartbeatAt ?? normalizeBackupDatabaseInstant(health?.active_updated_at);
  const leaseExpiresAt = normalizeBackupDatabaseInstant(health?.active_lease_expires_at);
  const overdueMs = (appConfig.BACKUP_INTERVAL_HOURS ?? 24) * 60 * 60 * 1_000;
  const alertCodes: string[] = [];
  if (!verifiedAt || (now && now.getTime() - verifiedAt.getTime() > overdueMs)) alertCodes.push('BACKUP_VERIFIED_SUCCESS_OVERDUE');
  if (health?.active_run_id && now && ((!activeObservedAt || now.getTime() - activeObservedAt.getTime() > 5 * 60_000) ||
      (leaseExpiresAt && leaseExpiresAt.getTime() < now.getTime()))) alertCodes.push('BACKUP_ACTIVE_ATTEMPT_STUCK');
  if (capacity.status === 'LOW' || capacity.status === 'UNAVAILABLE') alertCodes.push(capacity.reason_code!);
  if (Number(health?.retention_failure_count ?? '0') > 0) alertCodes.push('BACKUP_RETENTION_FAILURE');
  if ((health?.latest_failure_attempt_number ?? 0) >= 4) alertCodes.push('BACKUP_RETRY_EXHAUSTED');
  return {
    items: rows.map((row) => serializeBackup(row, policy.get(row.id), input)),
    next_cursor: next,
    health: {
      latest_run_id: health?.latest_run_id ?? null,
      latest_status: health?.latest_status ?? null,
      latest_stage: health?.latest_stage ?? null,
      latest_updated_at: instantIso(health?.latest_updated_at),
      active_operation_count: health?.active_operation_count ?? '0',
      retention_runtime_supported: support.supported,
      retention_runtime_reason_code: support.reason_code,
      latest_verified_success: health?.latest_verified_run_id ? {
        run_id: health.latest_verified_run_id, verified_at: instantIso(health.latest_verified_at),
      } : null,
      latest_failure: health?.latest_failure_run_id ? {
        run_id: health.latest_failure_run_id, failed_at: instantIso(health.latest_failure_at),
        error_code: safeErrorCode(health.latest_failure_code), attempt_number: health.latest_failure_attempt_number ?? 0,
      } : null,
      active: health?.active_run_id ? {
        run_id: health.active_run_id, stage: health.active_stage, attempt_id: health.active_attempt_id,
        attempt_number: health.active_attempt_number ?? 0, heartbeat_at: instantIso(health.active_heartbeat_at),
        lease_expires_at: instantIso(health.active_lease_expires_at), retry_at: instantIso(health.active_retry_at),
        deadline_at: instantIso(health.active_deadline_at),
      } : null,
      repository_capacity: capacity,
      alert_codes: [...new Set(alertCodes)],
      recovery_report: recoveryReport,
    },
  };
}

export async function getBackupDetail(input: {
  executor: DbExecutor;
  backupRunId: string;
  canDelete: boolean;
  canDownload: boolean;
}) {
  const result = await input.executor.execute(sql<BackupApiRow>`${backupSelect} WHERE run.id = ${input.backupRunId}::uuid`);
  const row = resultRows<BackupApiRow>(result)[0];
  if (!row) throw AppError.notFound('Backup run not found.');
  const policy = await loadPolicyDecisions(input.executor);
  return serializeBackup(row, policy.get(row.id), input);
}

export async function getBackupOperation(executor: DbExecutor, operationId: string) {
  const result = await executor.execute(sql<{
    id: string; backup_run_id: string; operation_kind: string; status: string; requested_at: unknown;
    started_at: unknown; completed_at: unknown; retry_at: unknown; error_code: string | null;
    lifecycle_state: string; tombstone_disposition: string | null;
  }>`SELECT operation.id, operation.backup_run_id, operation.operation_kind, operation.status,
            operation.requested_at, operation.started_at, operation.completed_at, operation.retry_at,
            operation.error_code, lifecycle.state AS lifecycle_state,
            tombstone.disposition AS tombstone_disposition
       FROM backup_retention_operations operation
       JOIN backup_artifact_lifecycles lifecycle ON lifecycle.backup_run_id = operation.backup_run_id
       LEFT JOIN backup_retention_tombstones tombstone ON tombstone.operation_id = operation.id
      WHERE operation.id = ${operationId}::uuid`);
  const operation = resultRows<{
    id: string; backup_run_id: string; operation_kind: string; status: string; requested_at: unknown;
    started_at: unknown; completed_at: unknown; retry_at: unknown; error_code: string | null;
    lifecycle_state: string; tombstone_disposition: string | null;
  }>(result)[0];
  if (!operation) throw AppError.notFound('Backup retention operation not found.');
  const progress = await executor.execute(sql<{
    artifact_kind: string; expected_size_bytes: string | null; status: string; attempt_count: number;
    deleted_at: unknown; error_code: string | null;
  }>`SELECT artifact_kind, expected_size_bytes, status, attempt_count, deleted_at, error_code
       FROM backup_retention_artifact_progress WHERE operation_id = ${operationId}::uuid
       ORDER BY artifact_kind, id LIMIT 100`);
  return {
    id: operation.id,
    backup_run_id: operation.backup_run_id,
    kind: operation.operation_kind,
    status: operation.status,
    lifecycle_state: operation.lifecycle_state,
    requested_at: instantIso(operation.requested_at),
    started_at: instantIso(operation.started_at),
    completed_at: instantIso(operation.completed_at),
    retry_at: instantIso(operation.retry_at),
    error_code: safeErrorCode(operation.error_code),
    progress: resultRows<{
      artifact_kind: string; expected_size_bytes: string | null; status: string; attempt_count: number;
      deleted_at: unknown; error_code: string | null;
    }>(progress).map((item) => ({
      kind: item.artifact_kind,
      size_bytes: item.expected_size_bytes,
      status: item.status,
      attempt_count: item.attempt_count,
      deleted_at: instantIso(item.deleted_at),
      error_code: safeErrorCode(item.error_code),
    })),
    tombstone: operation.tombstone_disposition ? { disposition: operation.tombstone_disposition } : null,
  };
}

export type ManualDeletionAdmission =
  | { disposition: 'ACCEPTED'; operation_id: string; backup_run_id: string; status: string; duplicate: boolean }
  | { disposition: 'DELETED'; operation_id: string; backup_run_id: string; tombstone: Record<string, unknown> };

async function bindManualDeletionIdempotency(input: {
  executor: DbExecutor;
  requesterId: string;
  backupRunId: string;
  operationId: string;
  idempotencyKey?: string;
}): Promise<void> {
  if (!input.idempotencyKey) return;
  const inserted = await input.executor.execute(sql<{ id: string }>`
    INSERT INTO backup_retention_request_idempotency
      (requested_by, request_action, backup_run_id, operation_id, idempotency_key)
    VALUES (${input.requesterId}::uuid, 'delete', ${input.backupRunId}::uuid,
            ${input.operationId}::uuid, ${input.idempotencyKey})
    ON CONFLICT (requested_by, request_action, idempotency_key) DO NOTHING
    RETURNING id`);
  if (resultRows<{ id: string }>(inserted)[0]) return;
  const existingResult = await input.executor.execute(sql<{ backup_run_id: string; operation_id: string }>`
    SELECT backup_run_id, operation_id FROM backup_retention_request_idempotency
     WHERE requested_by = ${input.requesterId}::uuid AND request_action = 'delete'
       AND idempotency_key = ${input.idempotencyKey} LIMIT 1`);
  const existing = resultRows<{ backup_run_id: string; operation_id: string }>(existingResult)[0];
  if (!existing || existing.backup_run_id !== input.backupRunId || existing.operation_id !== input.operationId) {
    throw stableConflict('BACKUP_IDEMPOTENCY_KEY_REUSED', 'The idempotency key is already bound to another backup deletion.');
  }
}

/** Authorization and this admission run in one role/session/user transaction. */
export async function admitManualBackupDeletion(input: {
  executor: DbExecutor;
  backupRunId: string;
  requesterId: string;
  idempotencyKey?: string;
}): Promise<ManualDeletionAdmission> {
  const support = backupRetentionRuntimeSupport();
  let idempotentOperation: { id: string; backup_run_id: string; status: string } | undefined;
  if (input.idempotencyKey) {
    const reused = await input.executor.execute(sql<{ id: string; backup_run_id: string; status: string }>`
      SELECT operation.id, binding.backup_run_id, operation.status
        FROM backup_retention_request_idempotency binding
        JOIN backup_retention_operations operation ON operation.id = binding.operation_id
       WHERE binding.requested_by = ${input.requesterId}::uuid AND binding.request_action = 'delete'
         AND binding.idempotency_key = ${input.idempotencyKey} LIMIT 1`);
    const existing = resultRows<{ id: string; backup_run_id: string; status: string }>(reused)[0];
    if (existing && existing.backup_run_id !== input.backupRunId) {
      throw stableConflict('BACKUP_IDEMPOTENCY_KEY_REUSED', 'The idempotency key is already bound to another backup run.');
    }
    idempotentOperation = existing;
  }

  const locked = await input.executor.execute(sql<{
    id: string; repository_kind: string; status: string;
  }>`SELECT run.id, run.repository_kind, run.status FROM backup_runs run
      WHERE run.id = ${input.backupRunId}::uuid FOR UPDATE OF run`);
  const run = resultRows<{
    id: string; repository_kind: string; status: string;
  }>(locked)[0];
  if (!run) throw AppError.notFound('Backup run not found.');
  const tombstoneResult = await input.executor.execute(sql<{
    operation_id: string; disposition: string; recorded_at: unknown; reason_code: string;
  }>`SELECT operation_id, disposition, recorded_at, reason_code FROM backup_retention_tombstones
       WHERE backup_run_id = ${input.backupRunId}::uuid`);
  const tombstone = resultRows<{
    operation_id: string; disposition: string; recorded_at: unknown; reason_code: string;
  }>(tombstoneResult)[0];
  if (tombstone) return { disposition: 'DELETED', operation_id: tombstone.operation_id,
    backup_run_id: input.backupRunId, tombstone: { disposition: tombstone.disposition,
      recorded_at: instantIso(tombstone.recorded_at), reason_code: tombstone.reason_code } };

  if (idempotentOperation) return { disposition: 'ACCEPTED', operation_id: idempotentOperation.id,
    backup_run_id: idempotentOperation.backup_run_id, status: idempotentOperation.status, duplicate: true };

  const unresolved = await input.executor.execute(sql<{ id: string; status: string }>`
    SELECT id, status FROM backup_retention_operations
     WHERE backup_run_id = ${input.backupRunId}::uuid
       AND status IN ('PREPARED','RUNNING','RETRY_WAIT','PARTIAL','UNCERTAIN')
     ORDER BY requested_at, id LIMIT 1`);
  const active = resultRows<{ id: string; status: string }>(unresolved)[0];
  if (active) {
    await bindManualDeletionIdempotency({ executor: input.executor, requesterId: input.requesterId,
      backupRunId: input.backupRunId, operationId: active.id, idempotencyKey: input.idempotencyKey });
    return { disposition: 'ACCEPTED', operation_id: active.id,
      backup_run_id: input.backupRunId, status: active.status, duplicate: true };
  }

  if (run.repository_kind !== 'LOCAL_FILESYSTEM') {
    throw stableConflict('BACKUP_DELETE_NOT_SUPPORTED', 'This backup repository does not support durable deletion.', {
      reason_code: 'BACKUP_DELETE_REPOSITORY_UNSUPPORTED',
    });
  }
  if (!support.supported || !appConfig.BACKUP_SITE_ID || !appConfig.BACKUP_REPOSITORY_ID) {
    throw stableConflict('BACKUP_DELETE_NOT_SUPPORTED', 'Backup deletion is not supported by this runtime.', {
      reason_code: support.reason_code,
    });
  }

  const lifecycleResult = await input.executor.execute(sql<{
    state: RetentionBackup['lifecycleState']; state_version: number;
  }>`SELECT state, state_version FROM backup_artifact_lifecycles
      WHERE backup_run_id = ${input.backupRunId}::uuid FOR UPDATE`);
  const lifecycle = resultRows<{ state: RetentionBackup['lifecycleState']; state_version: number }>(lifecycleResult)[0];
  if (!lifecycle) {
    throw stableConflict('BACKUP_DELETE_STALE', 'Backup retention evidence is not available yet.');
  }
  const inventoryResult = await input.executor.execute(sql<InventoryRow>`
    SELECT outcome.backup_run_id, outcome.site_key, outcome.repository_id, outcome.outcome,
           outcome.captured_at, lifecycle.state AS lifecycle_state,
           outcome.verification_provenance, outcome.publication_id, outcome.manifest_sha256,
           outcome.verified_good_at,
           EXISTS (SELECT 1 FROM backup_retention_operations operation
                    WHERE operation.backup_run_id = outcome.backup_run_id
                      AND operation.status IN ('PREPARED','RUNNING','RETRY_WAIT','PARTIAL','UNCERTAIN')) AS has_active_retention_operation,
           CASE
             WHEN EXISTS (SELECT 1 FROM backup_restore_hold_projections hold
                           WHERE hold.backup_run_id = outcome.backup_run_id AND hold.status = 'UNCERTAIN') THEN 'UNCERTAIN'
             WHEN EXISTS (SELECT 1 FROM backup_restore_hold_projections hold
                           WHERE hold.backup_run_id = outcome.backup_run_id AND hold.status = 'ACTIVE') THEN 'ACTIVE'
             ELSE 'NONE'
           END AS restore_hold
      FROM backup_execution_outcomes outcome
      JOIN backup_artifact_lifecycles lifecycle ON lifecycle.backup_run_id = outcome.backup_run_id
     WHERE outcome.site_key = ${appConfig.BACKUP_SITE_ID}
       AND outcome.repository_id = ${appConfig.BACKUP_REPOSITORY_ID}
     ORDER BY outcome.captured_at DESC NULLS LAST, outcome.backup_run_id`);
  const clockResult = await input.executor.execute(sql<{ now: Date }>`SELECT clock_timestamp() AS now`);
  const now = normalizeBackupDatabaseInstant(resultRows<{ now: unknown }>(clockResult)[0]?.now);
  const decisions = now ? planBackupRetention({ now, backups: resultRows<InventoryRow>(inventoryResult).map(mapInventory),
    policy: createBackupRetentionPolicy({ retentionDays: appConfig.BACKUP_RETENTION_DAYS }) }) : [];
  const decision = decisions.find((candidate) => candidate.backupId === input.backupRunId);
  if (!decision) throw stableConflict('BACKUP_DELETE_STALE', 'Backup retention identity is stale or belongs to another repository.');
  if (!decision.eligible) {
    throw stableConflict('BACKUP_DELETE_PROTECTED', 'Backup artifacts are protected by retention policy.', {
      protection_codes: decision.protectionCodes,
      expires_at: decision.expiresAt?.toISOString() ?? null,
    });
  }

  const operationId = randomUUID();
  const ownerToken = randomUUID();
  const fenceToken = randomUUID();
  const inserted = await input.executor.execute(sql<{ id: string; status: string }>`
    INSERT INTO backup_retention_operations
      (id, backup_run_id, operation_kind, status, requested_by, request_action, idempotency_key,
       owner_token, fence_token, expected_lifecycle_version)
    SELECT ${operationId}::uuid, lifecycle.backup_run_id, 'MANUAL_DELETE', 'PREPARED',
           ${input.requesterId}::uuid, 'delete', NULL,
           ${ownerToken}::uuid, ${fenceToken}::uuid, lifecycle.state_version
      FROM backup_artifact_lifecycles lifecycle
     WHERE lifecycle.backup_run_id = ${input.backupRunId}::uuid AND lifecycle.state = 'AVAILABLE'
    RETURNING id, status`);
  const operation = resultRows<{ id: string; status: string }>(inserted)[0];
  if (!operation) throw stableConflict('BACKUP_DELETE_STALE', 'Backup lifecycle changed before deletion admission.');
  await bindManualDeletionIdempotency({ executor: input.executor, requesterId: input.requesterId,
    backupRunId: input.backupRunId, operationId: operation.id, idempotencyKey: input.idempotencyKey });
  const transitioned = await input.executor.execute(sql<{ state: string }>`
    UPDATE backup_artifact_lifecycles SET state = 'DELETE_REQUESTED', state_version = state_version + 1,
           last_error_code = NULL, last_error_message = NULL, updated_at = clock_timestamp()
     WHERE backup_run_id = ${input.backupRunId}::uuid AND state = 'AVAILABLE'
    RETURNING state`);
  if (!resultRows<{ state: string }>(transitioned)[0]) throw stableConflict('BACKUP_DELETE_STALE', 'Backup lifecycle changed before deletion admission.');
  return { disposition: 'ACCEPTED', operation_id: operation.id, backup_run_id: input.backupRunId,
    status: operation.status, duplicate: false };
}

export const backupActiveOperationStates = ACTIVE_OPERATION_STATES;
