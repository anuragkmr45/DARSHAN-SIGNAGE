import type { Pool, PoolClient } from 'pg';

export type BackupPublicationStatus =
  | 'PREPARED'
  | 'PUBLISHED'
  | 'VERIFIED'
  | 'UNCERTAIN'
  | 'QUARANTINED';

export interface BackupPublicationRecord {
  id: string;
  backup_run_id: string;
  backup_attempt_id: string;
  capture_id: string;
  repository_id: string;
  manifest_sha256: string;
  incomplete_relative_path: string;
  published_relative_path: string;
  status: BackupPublicationStatus;
  prepared_at: Date;
  published_at: Date | null;
  verified_at: Date | null;
}

export class BackupPublicationAuthorityError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BackupPublicationAuthorityError';
  }
}

async function requirePool(pool?: Pool): Promise<Pool> {
  const selected = pool ?? (await import('@/db')).getDatabasePool();
  if (!selected) throw new Error('Database pool is not initialized.');
  return selected;
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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

interface LockedPublicationAuthority {
  run_status: string;
  current_attempt_id: string | null;
  cancellation_requested_at: Date | null;
  lease_live: boolean;
  deadline_live: boolean;
  deadline_at: Date | null;
  capture_status: string;
  sealed_at: Date | null;
}

async function lockPublicationAuthority(
  client: PoolClient,
  input: { runId: string; attemptId: string; captureId: string }
): Promise<LockedPublicationAuthority> {
  const locked = await client.query(
    `SELECT run.id
       FROM backup_runs AS run
       JOIN backup_captures AS capture
         ON capture.backup_run_id = run.id
        AND capture.backup_attempt_id = $2
        AND capture.id = $3
      WHERE run.id = $1
      FOR UPDATE OF run, capture`,
    [input.runId, input.attemptId, input.captureId]
  );
  if (!locked.rows[0]) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_CAPTURE_NOT_FOUND',
      'The publication does not reference a matching backup capture.'
    );
  }

  // PostgreSQL may evaluate SELECT target expressions before waiting for a
  // row lock. Read clock-dependent authority only after both identity rows
  // are locked, otherwise a pre-wait lease/deadline value can be stale.
  const authority = await client.query<LockedPublicationAuthority>(
    `SELECT run.status AS run_status, run.attempt_id AS current_attempt_id,
            run.cancellation_requested_at,
            (run.lease_expires_at > clock_timestamp()) AS lease_live,
            (run.deadline_at > clock_timestamp()) AS deadline_live,
            run.deadline_at,
            capture.status AS capture_status, capture.sealed_at
       FROM backup_runs AS run
       JOIN backup_captures AS capture
         ON capture.backup_run_id = run.id
        AND capture.backup_attempt_id = $2
        AND capture.id = $3
      WHERE run.id = $1`,
    [input.runId, input.attemptId, input.captureId]
  );
  const row = authority.rows[0];
  if (!row) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_CAPTURE_NOT_FOUND',
      'The locked backup publication authority disappeared unexpectedly.'
    );
  }
  return row;
}

function assertCurrentSealedAuthority(
  row: LockedPublicationAuthority,
  attemptId: string,
  options: { requireLiveLease: boolean; requireLiveDeadline: boolean }
): void {
  if (row.run_status !== 'RUNNING' || row.current_attempt_id !== attemptId) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_STALE_ATTEMPT',
      'The backup attempt no longer owns publication authority.'
    );
  }
  if (row.cancellation_requested_at) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_CANCELLED',
      'The backup was cancelled before publication could be accepted.'
    );
  }
  if (row.capture_status !== 'SEALED' || !row.sealed_at) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_CAPTURE_NOT_SEALED',
      'Only an immutable sealed capture can be published.'
    );
  }
  if ((options.requireLiveDeadline && !row.deadline_live) || (options.requireLiveLease && !row.lease_live)) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_AUTHORITY_EXPIRED',
      'The backup publication authority expired.'
    );
  }
}

export async function prepareBackupPublication(input: {
  runId: string;
  attemptId: string;
  captureId: string;
  repositoryId: string;
  manifestSha256: string;
  incompleteRelativePath: string;
  publishedRelativePath: string;
  pool?: Pool;
}): Promise<BackupPublicationRecord> {
  return inTransaction(await requirePool(input.pool), async (client) => {
    const authority = await lockPublicationAuthority(client, input);
    assertCurrentSealedAuthority(authority, input.attemptId, {
      requireLiveLease: true,
      requireLiveDeadline: true,
    });

    const inserted = await client.query<BackupPublicationRecord>(
      `INSERT INTO backup_publications
         (backup_run_id, backup_attempt_id, capture_id, repository_id,
          manifest_sha256, incomplete_relative_path, published_relative_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (backup_run_id, backup_attempt_id) DO NOTHING
       RETURNING *`,
      [input.runId, input.attemptId, input.captureId, input.repositoryId,
        input.manifestSha256, input.incompleteRelativePath, input.publishedRelativePath]
    );
    if (inserted.rows[0]) return inserted.rows[0];

    const existing = await client.query<BackupPublicationRecord>(
      `SELECT * FROM backup_publications
       WHERE backup_run_id = $1 AND backup_attempt_id = $2
       FOR UPDATE`,
      [input.runId, input.attemptId]
    );
    const row = existing.rows[0];
    if (!row || row.capture_id !== input.captureId || row.repository_id !== input.repositoryId ||
        row.manifest_sha256 !== input.manifestSha256 ||
        row.incomplete_relative_path !== input.incompleteRelativePath ||
        row.published_relative_path !== input.publishedRelativePath) {
      throw new BackupPublicationAuthorityError(
        'BACKUP_PUBLICATION_INTENT_CONFLICT',
        'A different publication intent already exists for this attempt.'
      );
    }
    return row;
  });
}

/** Record what the filesystem operation observed without granting completion. */
export async function recordBackupPublicationOutcome(input: {
  publicationId: string;
  manifestSha256: string;
  outcome: 'PUBLISHED' | 'UNCERTAIN';
  errorCode?: string;
  errorMessage?: string;
  pool?: Pool;
}): Promise<BackupPublicationRecord> {
  const result = await (await requirePool(input.pool)).query<BackupPublicationRecord>(
    `UPDATE backup_publications
        SET status = $3::varchar,
            published_at = CASE WHEN $3::varchar = 'PUBLISHED' THEN clock_timestamp() ELSE published_at END,
            error_code = $4, error_message = $5, updated_at = clock_timestamp()
      WHERE id = $1 AND manifest_sha256 = $2 AND status = 'PREPARED'
      RETURNING *`,
    [input.publicationId, input.manifestSha256, input.outcome,
      input.errorCode ?? null, input.errorMessage?.slice(0, 1000) ?? null]
  );
  const row = result.rows[0];
  if (!row) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_OUTCOME_CONFLICT',
      'The publication outcome no longer matches its prepared intent.'
    );
  }
  return row;
}

/**
 * Reconciliation may prove that an operation recorded as PREPARED/UNCERTAIN
 * did cross the atomic rename. The caller must first validate the repository
 * intent, receipt, manifest hash and read-back bytes; this function records
 * that observed fact but still does not grant backup completion.
 */
export async function confirmBackupPublicationPublished(input: {
  publicationId: string;
  manifestSha256: string;
  publishedAt: Date;
  pool?: Pool;
}): Promise<BackupPublicationRecord> {
  if (Number.isNaN(input.publishedAt.getTime())) {
    throw new TypeError('Published timestamp must be a valid instant.');
  }
  const result = await (await requirePool(input.pool)).query<BackupPublicationRecord>(
    `UPDATE backup_publications
        SET status = 'PUBLISHED', published_at = $3,
            error_code = NULL, error_message = NULL, updated_at = clock_timestamp()
      WHERE id = $1 AND manifest_sha256 = $2
        AND status IN ('PREPARED', 'UNCERTAIN')
        AND $3 <= clock_timestamp() + interval '1 minute'
      RETURNING *`,
    [input.publicationId, input.manifestSha256, input.publishedAt]
  );
  const row = result.rows[0];
  if (!row) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_RECONCILIATION_CONFLICT',
      'The filesystem publication evidence no longer matches a reconcilable intent.'
    );
  }
  return row;
}

async function completePublication(
  client: PoolClient,
  input: {
    publicationId: string;
    runId: string;
    attemptId: string;
    captureId: string;
    manifestSha256: string;
    repositoryManifest: Record<string, unknown>;
  },
  options: { reconciliation: boolean }
): Promise<boolean> {
  const publication = await client.query<BackupPublicationRecord>(
    `SELECT * FROM backup_publications WHERE id = $1 FOR UPDATE`,
    [input.publicationId]
  );
  const publicationRow = publication.rows[0];
  if (!publicationRow || publicationRow.backup_run_id !== input.runId ||
      publicationRow.backup_attempt_id !== input.attemptId ||
      publicationRow.capture_id !== input.captureId ||
      publicationRow.manifest_sha256 !== input.manifestSha256 ||
      publicationRow.status !== 'PUBLISHED' || !publicationRow.published_at) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_NOT_PUBLISHED',
      'The exact prepared publication has not been durably published.'
    );
  }

  const authority = await lockPublicationAuthority(client, input);
  assertCurrentSealedAuthority(authority, input.attemptId, {
    requireLiveLease: !options.reconciliation,
    requireLiveDeadline: !options.reconciliation,
  });
  if (!authority.deadline_at || publicationRow.published_at > authority.deadline_at) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_AFTER_DEADLINE',
      'The repository publication occurred after the attempt deadline.'
    );
  }

  const verified = await client.query(
    `UPDATE backup_publications
        SET status = 'VERIFIED', verified_at = clock_timestamp(),
            error_code = NULL, error_message = NULL, updated_at = clock_timestamp()
      WHERE id = $1 AND status = 'PUBLISHED' AND manifest_sha256 = $2
      RETURNING id`,
    [input.publicationId, input.manifestSha256]
  );
  if (!verified.rowCount) return false;

  const completed = await client.query(
    `UPDATE backup_runs AS run
        SET status = 'COMPLETED', stage = 'COMPLETED',
            completed_at = clock_timestamp(),
            captured_at = capture.sealed_at,
            verified_at = clock_timestamp(), lease_expires_at = NULL,
            repository_id = $4, manifest_sha256 = $5,
            repository_manifest = $6::jsonb,
            files = NULL, off_host_manifest = NULL,
            error_code = NULL, error_message = NULL,
            updated_at = clock_timestamp()
       FROM backup_captures AS capture
      WHERE run.id = $1 AND run.attempt_id = $2 AND run.status = 'RUNNING'
        AND run.cancellation_requested_at IS NULL
        AND capture.id = $3 AND capture.backup_run_id = run.id
        AND capture.backup_attempt_id = run.attempt_id
        AND capture.status = 'SEALED'
      RETURNING run.id`,
    [input.runId, input.attemptId, input.captureId, publicationRow.repository_id,
      input.manifestSha256, JSON.stringify(input.repositoryManifest)]
  );
  if (!completed.rowCount) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_COMPLETION_CONFLICT',
      'Publication was verified but the backup attempt could not be completed.'
    );
  }

  const siteKey = input.repositoryManifest.site &&
      typeof input.repositoryManifest.site === 'object' &&
      typeof (input.repositoryManifest.site as Record<string, unknown>).id === 'string'
    ? (input.repositoryManifest.site as Record<string, unknown>).id as string
    : null;
  if (!siteKey) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_COMPLETION_CONFLICT',
      'Verified publication completion omitted immutable retention evidence.'
    );
  }
  await insertExactRetentionProjection(client, {
    backupRunId: input.runId,
    siteKey,
    repositoryId: publicationRow.repository_id,
    publicationId: input.publicationId,
    captureId: input.captureId,
    attemptId: input.attemptId,
    manifestSha256: input.manifestSha256,
  });
  return true;
}

async function insertExactRetentionProjection(client: PoolClient, input: {
  backupRunId: string;
  siteKey: string;
  repositoryId: string;
  publicationId: string;
  captureId: string;
  attemptId: string;
  manifestSha256: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO backup_execution_outcomes
       (backup_run_id, site_key, repository_id, outcome, completed_at, captured_at,
        verification_provenance, publication_id, verified_good_at, manifest_sha256)
     SELECT run.id, $2::text, publication.repository_id, 'SUCCEEDED', run.completed_at,
            capture.sealed_at, 'PUBLICATION_READ_BACK', publication.id,
            publication.verified_at, publication.manifest_sha256
       FROM backup_runs AS run
       JOIN backup_publications AS publication ON publication.id = $4
       JOIN backup_captures AS capture ON capture.id = $5
      WHERE run.id = $1 AND run.status = 'COMPLETED' AND run.attempt_id = $6
        AND run.repository_manifest->'site'->>'id' = $2::text
        AND run.repository_id = $3 AND run.manifest_sha256 = $7
        AND run.captured_at = capture.sealed_at
        AND publication.backup_run_id = run.id
        AND publication.backup_attempt_id = run.attempt_id
        AND publication.capture_id = capture.id
        AND publication.repository_id = run.repository_id
        AND publication.manifest_sha256 = run.manifest_sha256
        AND publication.status = 'VERIFIED' AND publication.verified_at IS NOT NULL
        AND capture.backup_run_id = run.id
        AND capture.backup_attempt_id = run.attempt_id
        AND capture.status = 'SEALED'
     ON CONFLICT (backup_run_id) DO NOTHING`,
    [input.backupRunId, input.siteKey, input.repositoryId, input.publicationId,
      input.captureId, input.attemptId, input.manifestSha256]
  );
  const exact = await client.query(
    `SELECT 1
       FROM backup_execution_outcomes AS outcome
       JOIN backup_runs AS run ON run.id = outcome.backup_run_id
       JOIN backup_publications AS publication ON publication.id = $4
       JOIN backup_captures AS capture ON capture.id = $5
      WHERE outcome.backup_run_id = $1 AND outcome.site_key = $2::text
        AND run.repository_manifest->'site'->>'id' = $2::text
        AND outcome.repository_id = $3
        AND outcome.outcome = 'SUCCEEDED'
        AND outcome.completed_at = run.completed_at
        AND outcome.captured_at = capture.sealed_at
        AND verification_provenance = 'PUBLICATION_READ_BACK'
        AND outcome.publication_id = publication.id
        AND outcome.verified_good_at = publication.verified_at
        AND outcome.manifest_sha256 = $7
        AND run.attempt_id = $6
        AND publication.backup_run_id = run.id
        AND publication.backup_attempt_id = run.attempt_id
        AND publication.capture_id = capture.id
        AND publication.repository_id = outcome.repository_id
        AND publication.manifest_sha256 = outcome.manifest_sha256
        AND publication.status = 'VERIFIED'
        AND capture.backup_run_id = run.id
        AND capture.backup_attempt_id = run.attempt_id
        AND capture.status = 'SEALED'`,
    [input.backupRunId, input.siteKey, input.repositoryId, input.publicationId,
      input.captureId, input.attemptId, input.manifestSha256]
  );
  if (!exact.rowCount) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_COMPLETION_CONFLICT',
      'Immutable retention outcome conflicts with exact publication evidence.'
    );
  }
  await client.query(
    `INSERT INTO backup_artifact_lifecycles (backup_run_id, state)
     VALUES ($1, 'AVAILABLE') ON CONFLICT (backup_run_id) DO NOTHING`,
    [input.backupRunId]
  );
  const lifecycle = await client.query(
    `SELECT 1 FROM backup_artifact_lifecycles WHERE backup_run_id = $1 AND state = 'AVAILABLE'`,
    [input.backupRunId]
  );
  if (!lifecycle.rowCount) {
    throw new BackupPublicationAuthorityError(
      'BACKUP_PUBLICATION_COMPLETION_CONFLICT',
      'Retention lifecycle conflicts with verified publication availability.'
    );
  }
}

export async function completeVerifiedBackupPublication(input: {
  publicationId: string;
  runId: string;
  attemptId: string;
  captureId: string;
  manifestSha256: string;
  repositoryManifest: Record<string, unknown>;
  pool?: Pool;
}): Promise<boolean> {
  return inTransaction(await requirePool(input.pool), (client) =>
    completePublication(client, input, { reconciliation: false }));
}

/**
 * Restart-only adoption for a publication that crossed the durable rename
 * before the database acknowledgement. It still rejects a replaced attempt,
 * cancellation, an unsealed capture, or a publication after the deadline.
 */
export async function reconcileVerifiedBackupPublication(input: {
  publicationId: string;
  runId: string;
  attemptId: string;
  captureId: string;
  manifestSha256: string;
  repositoryManifest: Record<string, unknown>;
  pool?: Pool;
}): Promise<boolean> {
  return inTransaction(await requirePool(input.pool), (client) =>
    completePublication(client, input, { reconciliation: true }));
}

export async function quarantineBackupPublication(input: {
  publicationId: string;
  errorCode: string;
  errorMessage: string;
  pool?: Pool;
}): Promise<boolean> {
  const result = await (await requirePool(input.pool)).query(
    `UPDATE backup_publications
        SET status = 'QUARANTINED', error_code = $2,
            error_message = $3, updated_at = clock_timestamp()
      WHERE id = $1 AND status IN ('PREPARED', 'PUBLISHED', 'UNCERTAIN')
      RETURNING id`,
    [input.publicationId, input.errorCode, input.errorMessage.slice(0, 1000)]
  );
  return Boolean(result.rowCount);
}
