import { z } from 'zod';

export const BACKUP_BROKER_PROTOCOL_VERSION = 2 as const;
// PREPARE carries the backward-readable manifest format; brokered publication
// requires its policy-bound v2 form (bounded by the parser to one MiB).
export const BACKUP_BROKER_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const BACKUP_BROKER_MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
export const RECOVERY_BROKER_MAX_REQUEST_BYTES = 8 * 1024;
export const RECOVERY_BROKER_MAX_CONNECTIONS = 4;
export const RECOVERY_BROKER_INCOMPLETE_FRAME_TIMEOUT_MS = 5_000;
export const RECOVERY_BROKER_OPERATIONS = new Set<BackupBrokerRequest['operation']>([
  'INSPECT_RESTORE_HOLD',
  'ACQUIRE_RESTORE_HOLD',
  'RELEASE_RESTORE_HOLD',
  'MARK_RESTORE_HOLD_UNCERTAIN',
]);

export const BACKUP_BROKER_CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const id = z.string().regex(BACKUP_BROKER_CANONICAL_UUID_PATTERN, 'UUID must be canonical lowercase RFC 4122 form');
const errorRequestId = z.union([id, z.literal('00000000-0000-0000-0000-000000000000')]);
const site = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const deadline = z.string().datetime({ offset: true });
const common = {
  protocol_version: z.literal(BACKUP_BROKER_PROTOCOL_VERSION),
  request_id: id,
  helper_version: z.string().min(1).max(100),
  policy_sha256: sha256,
  site_id: site,
  repository_id: id,
  deadline,
};
const attempt = {
  run_id: id, attempt_id: id, capture_id: id,
  capture_generation: z.number().int().positive().safe(),
};
const lifecycle = {
  ...attempt,
  manifest_sha256: sha256,
  operation_id: id,
  owner_token: id,
  fence_token: id,
};

export const backupBrokerRequestSchema = z.discriminatedUnion('operation', [
  z.object({ ...common, operation: z.literal('DESCRIBE') }).strict(),
  z.object({
    ...common, ...attempt, operation: z.literal('SELECT_CAPSULE'),
    expected_capsule_generation: z.string().min(1).max(160),
    expected_capsule_sha256: sha256,
  }).strict(),
  z.object({
    ...common, ...attempt, operation: z.literal('PREPARE_PUBLICATION'),
    expected_capsule_generation: z.string().min(1).max(160),
    unsigned_manifest_sha256: sha256,
    manifest_base64: z.string().min(1).max(1_500_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }).strict(),
  z.object({ ...common, ...attempt, operation: z.literal('COMMIT_PUBLICATION'), unsigned_manifest_sha256: sha256, signed_manifest_sha256: sha256 }).strict(),
  z.object({ ...common, ...attempt, operation: z.literal('INSPECT_PUBLICATION'), signed_manifest_sha256: sha256.optional() }).strict(),
  z.object({ ...common, ...attempt, operation: z.literal('QUARANTINE_PUBLICATION'), unsigned_manifest_sha256: sha256, signed_manifest_sha256: sha256 }).strict(),
  z.object({ ...common, ...lifecycle, operation: z.literal('INSPECT_RETENTION_TRUTH') }).strict(),
  z.object({ ...common, ...lifecycle, operation: z.literal('INSPECT_RESTORE_HOLD') }).strict(),
  z.object({ ...common, ...lifecycle, operation: z.literal('ACQUIRE_RESTORE_HOLD') }).strict(),
  z.object({ ...common, ...lifecycle, operation: z.literal('RELEASE_RESTORE_HOLD') }).strict(),
  z.object({ ...common, ...lifecycle, operation: z.literal('MARK_RESTORE_HOLD_UNCERTAIN') }).strict(),
  z.object({ ...common, ...lifecycle, operation: z.literal('CLAIM_RUN_DELETION') }).strict(),
  z.object({ ...common, ...lifecycle, operation: z.literal('EXECUTE_RUN_DELETION') }).strict(),
  z.object({ ...common, ...lifecycle, operation: z.literal('RECONCILE_RUN_DELETION') }).strict(),
  z.object({ ...common, ...lifecycle, operation: z.literal('CLEANUP_STAGING') }).strict(),
]);
export type BackupBrokerRequest = z.infer<typeof backupBrokerRequestSchema>;

const responseCommon = {
  protocol_version: z.literal(BACKUP_BROKER_PROTOCOL_VERSION), request_id: id,
  helper_version: z.string().min(1).max(100), policy_sha256: sha256,
};
const evidenceArtifact = z.object({ path: z.string().min(1).max(512), size: z.string().regex(/^(?:0|[1-9][0-9]*)$/), sha256 }).strict();
const evidenceIdentity = { repository_id: id, site_id: site, run_id: id, attempt_id: id, capture_id: id, capture_generation: z.number().int().positive().safe(), manifest_sha256: sha256 };
const publicationEvidenceSchema = z.object({
  verified: z.literal(true), run_relative_path: z.string().regex(/^runs\/[0-9a-f-]{36}$/), manifest_relative_path: z.string().regex(/^runs\/[0-9a-f-]{36}\/manifest\.json$/),
  configuration_policy_relative_path: z.string().regex(/^runs\/[0-9a-f-]{36}\/configuration-policy\.json$/),
  canonical_signed_manifest_base64: z.string().min(1).max(1_500_000),
  canonical_signed_configuration_policy_base64: z.string().min(1).max(1_500_000),
  configuration_policy_sha256: sha256,
  capsule_generation: z.string().min(1).max(160),
  encrypted_inventory_sha256: sha256,
  intent: z.object({ format: z.literal('darshan-backup-publication-intent-v1'), ...evidenceIdentity, created_at: z.string().datetime({ offset: true }), artifacts: z.array(evidenceArtifact).length(3) }).strict(),
  receipt: z.object({ format: z.literal('darshan-backup-publication-receipt-v1'), ...evidenceIdentity, published_at: z.string().datetime({ offset: true }), verified_at: z.string().datetime({ offset: true }) }).strict(),
}).strict();
const deletionArtifactSchema = z.object({
  artifact_key: z.string().min(1).max(1024).refine((value) => !value.startsWith('/') && !value.includes('\\') &&
    !value.split('/').some((part) => part === '' || part === '.' || part === '..')),
  artifact_kind: z.enum(['DATABASE', 'OBJECTS', 'CONFIGURATION', 'MANIFEST', 'SIGNATURE', 'OTHER']),
  expected_sha256: sha256.optional(),
  expected_size_bytes: z.string().regex(/^(?:0|[1-9][0-9]*)$/).optional(),
  status: z.enum(['PENDING', 'DELETED', 'UNCERTAIN']),
}).strict();
export type BrokerPublicationEvidence = z.infer<typeof publicationEvidenceSchema>;
export const backupBrokerResponseSchema = z.discriminatedUnion('operation', [
  z.object({
    ...responseCommon, operation: z.literal('DESCRIBE'), site_id: site, repository_id: id,
    capsule_generation: z.string().min(1).max(160), capsule_sha256: sha256,
    capsule_size_bytes: z.string().regex(/^[1-9][0-9]*$/), release_generation: z.string(), deployment_generation: z.string(),
    compatibility_generation: z.number().int().positive().safe(), age_recipient_key_id: z.string(),
    contract_id: z.string().min(1).max(160), encrypted_inventory_sha256: sha256,
    required_roles: z.array(z.enum(['backend', 'data', 'cms', 'valkey', 'observability'])).min(1).max(5),
    capabilities: z.object({ durable_publication: z.boolean(), repository_retention_authority: z.boolean(), durable_restore_holds: z.boolean(), whole_run_deletion: z.boolean() }).strict(),
    manifest_verification_keys: z.array(z.object({
      key_id: z.string().min(1).max(128), algorithm: z.literal('Ed25519'), public_key_pem: z.string().min(1).max(4096), active: z.boolean(),
    }).strict()).min(1).max(16),
    configuration_contract: z.array(z.object({ logical_name: z.string().min(1).max(160), required: z.boolean(), max_bytes: z.string().regex(/^(?:0|[1-9][0-9]*)$/) }).strict()).min(1).max(512),
  }).strict(),
  z.object({
    ...responseCommon, operation: z.literal('SELECT_CAPSULE'), capsule_generation: z.string(), capsule_sha256: sha256,
    capsule_base64: z.string().min(1), active_marker: z.string().min(1).max(16_384), active_marker_signature_base64: z.string().min(1).max(1024), key_id: z.string(),
  }).strict(),
  z.object({
    ...responseCommon, operation: z.literal('PREPARE_PUBLICATION'), unsigned_manifest_sha256: sha256, signed_manifest_sha256: sha256,
    algorithm: z.literal('Ed25519'), key_id: z.string(), signature_base64: z.string().min(1).max(1024),
    incomplete_relative_path: z.string().regex(/^incomplete\/[0-9a-f-]{36}\.[0-9a-f-]{36}\.[0-9a-f]{32}$/),
    published_relative_path: z.string().regex(/^runs\/[0-9a-f-]{36}$/),
  }).strict(),
  z.object({ ...responseCommon, operation: z.literal('COMMIT_PUBLICATION'), unsigned_manifest_sha256: sha256, signed_manifest_sha256: sha256, status: z.literal('COMMITTED'), evidence: publicationEvidenceSchema }).strict(),
  z.object({ ...responseCommon, operation: z.literal('INSPECT_PUBLICATION'), status: z.enum(['ABSENT', 'PREPARED', 'COMMITTED', 'QUARANTINED', 'DELETION_CLAIMED', 'DELETED']), unsigned_manifest_sha256: sha256.optional(), signed_manifest_sha256: sha256.optional(), evidence: publicationEvidenceSchema.optional() }).strict(),
  z.object({ ...responseCommon, operation: z.literal('QUARANTINE_PUBLICATION'), unsigned_manifest_sha256: sha256, signed_manifest_sha256: sha256, status: z.literal('QUARANTINED') }).strict(),
  z.object({
    ...responseCommon, operation: z.literal('INSPECT_RETENTION_TRUTH'),
    status: z.enum(['AVAILABLE', 'DELETION_CLAIMED', 'DELETING', 'PARTIAL', 'DELETED', 'UNCERTAIN']),
    active_holds: z.number().int().nonnegative().safe(), uncertain_holds: z.number().int().nonnegative().safe(),
    deletion_operation_id: id.optional(), manifest_sha256: sha256,
  }).strict(),
  z.object({ ...responseCommon, operation: z.literal('INSPECT_RESTORE_HOLD'), operation_id: id,
    manifest_sha256: sha256, status: z.enum(['ABSENT', 'ACTIVE', 'UNCERTAIN', 'RELEASED']) }).strict(),
  z.object({ ...responseCommon, operation: z.enum(['ACQUIRE_RESTORE_HOLD', 'RELEASE_RESTORE_HOLD', 'MARK_RESTORE_HOLD_UNCERTAIN']), operation_id: id, status: z.enum(['ACTIVE', 'RELEASED', 'UNCERTAIN']) }).strict(),
  z.object({
    ...responseCommon, operation: z.enum(['CLAIM_RUN_DELETION', 'EXECUTE_RUN_DELETION', 'RECONCILE_RUN_DELETION']),
    operation_id: id, status: z.enum(['CLAIMED', 'RENAMED', 'DELETING', 'PARTIAL', 'DELETED', 'UNCERTAIN']),
    deleted_entries: z.number().int().nonnegative().safe(), total_entries: z.number().int().nonnegative().safe(),
    artifacts: z.array(deletionArtifactSchema).max(512),
  }).strict(),
  z.object({ ...responseCommon, operation: z.literal('CLEANUP_STAGING'), operation_id: id, status: z.enum(['CLEANED', 'ABSENT']) }).strict(),
  z.object({ ...responseCommon, request_id: errorRequestId, operation: z.literal('ERROR'), code: z.string().min(1).max(100), message: z.string().min(1).max(500), retryable: z.boolean() }).strict(),
]);
export type BackupBrokerResponse = z.infer<typeof backupBrokerResponseSchema>;

class StrictJsonParser {
  private offset = 0;
  constructor(private readonly source: string) {}
  parse(): unknown { const value = this.value(); this.ws(); if (this.offset !== this.source.length) this.fail('trailing content'); return value; }
  private fail(reason: string): never { throw new SyntaxError(`Invalid strict JSON at byte ${this.offset}: ${reason}.`); }
  private ws() { while (/\s/.test(this.source[this.offset] ?? '')) this.offset += 1; }
  private value(): unknown {
    this.ws(); const c = this.source[this.offset];
    if (c === '{') return this.object(); if (c === '[') return this.array(); if (c === '"') return this.string();
    for (const [token, value] of [['true', true], ['false', false], ['null', null]] as const) {
      if (this.source.startsWith(token, this.offset)) { this.offset += token.length; return value; }
    }
    const match = this.source.slice(this.offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (match) { this.offset += match[0].length; const number = Number(match[0]); if (!Number.isFinite(number)) this.fail('non-finite number'); return number; }
    return this.fail('expected value');
  }
  private string(): string {
    const start = this.offset; this.offset += 1; let escaped = false;
    while (this.offset < this.source.length) {
      const code = this.source.charCodeAt(this.offset); const c = this.source[this.offset++];
      if (!escaped && c === '"') { try { return JSON.parse(this.source.slice(start, this.offset)) as string; } catch { return this.fail('invalid string'); } }
      if (!escaped && code < 0x20) this.fail('control character in string');
      if (!escaped && c === '\\') escaped = true; else escaped = false;
    }
    return this.fail('unterminated string');
  }
  private object(): Record<string, unknown> {
    this.offset += 1; const result: Record<string, unknown> = {}; const keys = new Set<string>(); this.ws();
    if (this.source[this.offset] === '}') { this.offset += 1; return result; }
    for (;;) {
      this.ws(); if (this.source[this.offset] !== '"') this.fail('expected object key'); const key = this.string();
      if (keys.has(key)) this.fail(`duplicate object key ${JSON.stringify(key)}`); keys.add(key); this.ws();
      if (this.source[this.offset++] !== ':') this.fail('expected colon'); result[key] = this.value(); this.ws();
      const separator = this.source[this.offset++]; if (separator === '}') return result; if (separator !== ',') this.fail('expected comma or closing brace');
    }
  }
  private array(): unknown[] {
    this.offset += 1; const result: unknown[] = []; this.ws(); if (this.source[this.offset] === ']') { this.offset += 1; return result; }
    for (;;) { result.push(this.value()); this.ws(); const separator = this.source[this.offset++]; if (separator === ']') return result; if (separator !== ',') this.fail('expected comma or closing bracket'); }
  }
}

export function parseStrictJson(bytes: Uint8Array, maximumBytes: number): unknown {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) throw new SyntaxError('JSON frame has an invalid size.');
  const text = Buffer.from(bytes).toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(Buffer.from(bytes))) throw new SyntaxError('JSON frame is not valid UTF-8.');
  return new StrictJsonParser(text).parse();
}

export function parseBackupBrokerRequest(bytes: Uint8Array): BackupBrokerRequest {
  return backupBrokerRequestSchema.parse(parseStrictJson(bytes, BACKUP_BROKER_MAX_REQUEST_BYTES));
}

export function canonicalJson(value: unknown): Buffer {
  const visit = (item: unknown): unknown => Array.isArray(item) ? item.map(visit) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([a], [b]) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')))
      .map(([key, child]) => [key, visit(child)])) : item;
  return Buffer.from(`${JSON.stringify(visit(value))}\n`, 'utf8');
}
