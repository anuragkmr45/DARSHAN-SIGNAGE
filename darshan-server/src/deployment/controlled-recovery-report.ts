import { createHash, createPublicKey, verify } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '@/db';
import { canonicalJson, parseStrictJson } from '@/backups/backup-broker-protocol';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const resultCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const state = z.enum(['DATA_VALIDATED', 'APPLICATION_RECONCILED', 'APP_VALIDATED', 'AWAITING_PROMOTION',
  'PROMOTED_PENDING_ACCEPTANCE', 'ACCEPTED', 'ROLLED_BACK', 'OPERATOR_REVIEW', 'FAILED_RETRYABLE']);

export const controlledRecoveryProjectionSchema = z.object({
  format: z.literal('darshan-controlled-recovery-projection-v1'),
  sequence: z.number().int().positive().safe(),
  operation_id: uuid,
  site_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  report_sha256: digest,
  source: z.object({ run_id: uuid, manifest_sha256: digest }).strict(),
  deployment: z.object({ profile_sha256: digest, configuration_sha256: digest,
    release_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    schema_migration_id: z.string().regex(/^\d{4}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/),
    target_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/) }).strict(),
  recovery_generation: uuid.nullable(),
  state,
  results: z.object({ data: resultCode, application: resultCode, promotion: resultCode, rollback: resultCode }).strict(),
  unexecuted_gates: z.array(resultCode).max(64),
  report_created_at: z.string().datetime({ offset: true }),
  issued_at: z.string().datetime({ offset: true }),
}).strict();
export type ControlledRecoveryProjection = z.infer<typeof controlledRecoveryProjectionSchema>;

export const controlledRecoveryProjectionEnvelopeSchema = z.object({
  projection: controlledRecoveryProjectionSchema,
  signature: z.object({ algorithm: z.literal('Ed25519'), key_id: z.string().min(1).max(128),
    value_base64: z.string().min(1).max(1024) }).strict(),
}).strict();

export class ControlledRecoveryProjectionError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'ControlledRecoveryProjectionError';
  }
}

export function verifyControlledRecoveryProjection(input: {
  bytes: Uint8Array;
  trustedKeys: ReadonlyMap<string, string>;
  expectedSiteId: string;
  now?: number;
}): { projection: ControlledRecoveryProjection; envelopeSha256: string } {
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > 256 * 1024) {
    throw new ControlledRecoveryProjectionError('RECOVERY_REPORT_IMPORT_INVALID', 'Recovery projection envelope exceeds its byte bound.');
  }
  let envelope: z.infer<typeof controlledRecoveryProjectionEnvelopeSchema>;
  try {
    envelope = controlledRecoveryProjectionEnvelopeSchema.parse(parseStrictJson(input.bytes, 256 * 1024));
    if (!canonicalJson(envelope).equals(Buffer.from(input.bytes))) throw new Error('non-canonical envelope');
  } catch (cause) {
    throw new ControlledRecoveryProjectionError('RECOVERY_REPORT_IMPORT_INVALID', 'Recovery projection envelope is not strict canonical JSON.', { cause });
  }
  const key = input.trustedKeys.get(envelope.signature.key_id);
  if (!key || !verify(null, canonicalJson(envelope.projection), createPublicKey(key),
    Buffer.from(envelope.signature.value_base64, 'base64'))) {
    throw new ControlledRecoveryProjectionError('RECOVERY_REPORT_SIGNATURE_INVALID', 'Recovery projection signature is not trusted.');
  }
  if (envelope.projection.site_id !== input.expectedSiteId) {
    throw new ControlledRecoveryProjectionError('RECOVERY_REPORT_SITE_MISMATCH', 'Recovery projection belongs to another site.');
  }
  const now = input.now ?? Date.now();
  const issued = Date.parse(envelope.projection.issued_at);
  const created = Date.parse(envelope.projection.report_created_at);
  if (issued > now + 5 * 60_000 || now - issued > 24 * 60 * 60_000 || created > issued || issued - created > 30 * 24 * 60 * 60_000) {
    throw new ControlledRecoveryProjectionError('RECOVERY_REPORT_STALE', 'Recovery projection issuance or report time is outside the import window.');
  }
  return { projection: envelope.projection,
    envelopeSha256: createHash('sha256').update(canonicalJson(envelope)).digest('hex') };
}

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value && typeof value === 'object' && 'rows' in value && Array.isArray((value as { rows?: unknown }).rows)
    ? (value as { rows: T[] }).rows : [];
}

/** Caller supplies a transaction executor; the single insert is anti-rollback and idempotent. */
export async function importControlledRecoveryProjection(input: {
  executor: DbExecutor;
  verified: { projection: ControlledRecoveryProjection; envelopeSha256: string };
}) {
  const value = input.verified.projection;
  await input.executor.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended('darshan-controlled-recovery-report:' || ${value.site_id}, 0))`);
  const inserted = await input.executor.execute(sql<{ operation_id: string }>`
    INSERT INTO controlled_recovery_report_projections
      (operation_id, site_id, sequence, report_sha256, envelope_sha256, source_run_id,
       source_manifest_sha256, profile_sha256, configuration_sha256, release_id,
       schema_migration_id, target_id, recovery_generation, state, data_result,
       application_result, promotion_result, rollback_result, report_created_at, unexecuted_gates)
    SELECT ${value.operation_id}::uuid, ${value.site_id}, ${value.sequence}, ${value.report_sha256},
           ${input.verified.envelopeSha256}, ${value.source.run_id}::uuid, ${value.source.manifest_sha256},
           ${value.deployment.profile_sha256}, ${value.deployment.configuration_sha256}, ${value.deployment.release_id},
           ${value.deployment.schema_migration_id}, ${value.deployment.target_id},
           ${value.recovery_generation}::uuid, ${value.state}, ${value.results.data}, ${value.results.application},
           ${value.results.promotion}, ${value.results.rollback}, ${value.report_created_at}::timestamptz,
           ${JSON.stringify(value.unexecuted_gates)}::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM controlled_recovery_report_projections
                        WHERE site_id = ${value.site_id} AND sequence >= ${value.sequence})
    ON CONFLICT DO NOTHING RETURNING operation_id`);
  if (rows<{ operation_id: string }>(inserted).length === 1) return { status: 'IMPORTED' as const, operation_id: value.operation_id };
  const existing = await input.executor.execute(sql<{ operation_id: string; sequence: string; envelope_sha256: string }>`
    SELECT operation_id, sequence::text, envelope_sha256 FROM controlled_recovery_report_projections
     WHERE operation_id = ${value.operation_id}::uuid LIMIT 1`);
  const observed = rows<{ operation_id: string; sequence: string; envelope_sha256: string }>(existing)[0];
  if (observed?.envelope_sha256 === input.verified.envelopeSha256) {
    return { status: 'ALREADY_IMPORTED' as const, operation_id: value.operation_id };
  }
  if (observed) {
    throw new ControlledRecoveryProjectionError('RECOVERY_REPORT_TAMPER_CONFLICT',
      'The operation already has different projected evidence.');
  }
  const newer = await input.executor.execute(sql<{ operation_id: string }>`
    SELECT operation_id FROM controlled_recovery_report_projections
     WHERE site_id = ${value.site_id} AND sequence >= ${value.sequence}
     ORDER BY sequence DESC LIMIT 1`);
  if (rows<{ operation_id: string }>(newer)[0]) {
    throw new ControlledRecoveryProjectionError('RECOVERY_REPORT_STALE_REPLACEMENT',
      'A newer or equal site recovery projection already exists.');
  }
  throw new ControlledRecoveryProjectionError('RECOVERY_REPORT_IMPORT_CONFLICT',
    'Recovery projection import conflicted with durable evidence.');
}

export async function getLatestControlledRecoveryProjection(executor: DbExecutor, siteId: string) {
  const result = await executor.execute(sql<Record<string, unknown>>`
    SELECT operation_id, sequence::text, report_sha256, source_run_id, source_manifest_sha256,
           profile_sha256, configuration_sha256, release_id, schema_migration_id, target_id,
           recovery_generation, state, data_result, application_result, promotion_result,
           rollback_result, report_created_at, imported_at, unexecuted_gates
      FROM controlled_recovery_report_projections WHERE site_id = ${siteId}
     ORDER BY sequence DESC, imported_at DESC LIMIT 1`);
  const value = rows<Record<string, unknown>>(result)[0];
  if (!value) return null;
  const iso = (instant: unknown) => {
    const date = instant instanceof Date ? instant : typeof instant === 'string' ? new Date(instant) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };
  return { operation_id: value.operation_id, sequence: value.sequence, report_sha256: value.report_sha256,
    source_run_id: value.source_run_id, source_manifest_sha256: value.source_manifest_sha256,
    profile_sha256: value.profile_sha256, configuration_sha256: value.configuration_sha256,
    release_id: value.release_id, schema_migration_id: value.schema_migration_id, target_id: value.target_id,
    recovery_generation: value.recovery_generation, state: value.state,
    results: { data: value.data_result, application: value.application_result,
      promotion: value.promotion_result, rollback: value.rollback_result },
    report_created_at: iso(value.report_created_at), imported_at: iso(value.imported_at),
    unexecuted_gates: Array.isArray(value.unexecuted_gates) ? value.unexecuted_gates.slice(0, 64) : [] };
}
