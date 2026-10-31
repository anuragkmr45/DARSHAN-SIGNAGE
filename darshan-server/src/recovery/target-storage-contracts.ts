import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';

export const TARGET_STORAGE_EVIDENCE_MAX_BYTES = 64 * 1024;
export const TARGET_STORAGE_EVIDENCE_KINDS = [
  'HOST_POLICY', 'ENGINE_PROFILE', 'STORAGE_INVENTORY', 'PROTECTION_INVENTORY', 'CAPACITY_EVIDENCE',
] as const;
export type TargetStorageEvidenceKind = typeof TARGET_STORAGE_EVIDENCE_KINDS[number];

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const site = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const timestamp = z.string().datetime({ offset: false });
const u64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).superRefine((value, context) => {
  if (BigInt(value) > 0xffff_ffff_ffff_ffffn) context.addIssue({ code: z.ZodIssueCode.custom, message: 'u64 overflow' });
});
const mode = z.string().regex(/^0[0-7]{3}$/);
const basename = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const dependency = z.object({ kind: z.enum(TARGET_STORAGE_EVIDENCE_KINDS), envelopeSha256: digest }).strict();
const common = {
  evidenceId: uuid,
  siteId: site,
  hostInstallationId: uuid,
  operationId: uuid,
  generation: u64,
  targetSetId: digest,
  targetSpecificationSha256: digest,
  targetReleaseIdentitySha256: digest,
  issuedAt: timestamp,
  validFrom: timestamp,
  expiresAt: timestamp,
  dependencies: z.array(dependency).max(8),
  revokedEnvelopeSha256: z.array(digest).max(128),
};

const hostPolicySchema = z.object({
  format: z.literal('darshan-recovery-host-policy-evidence-v1'), kind: z.literal('HOST_POLICY'), ...common,
  hostMode: z.enum(['SINGLE_HOST', 'SPLIT_HOST']),
  storageAuthorityIdentitySha256: digest,
  evidenceRootSha256: digest,
  allocationControlRootSha256: digest,
  allowedFilesystems: z.array(z.enum(['ext4', 'xfs'])).min(1).max(2),
}).strict();

const engineProfileSchema = z.object({
  format: z.literal('darshan-recovery-engine-profile-evidence-v1'), kind: z.literal('ENGINE_PROFILE'), ...common,
  postgresUid: u64, postgresGid: u64, minioUid: u64, minioGid: u64,
  allocationDirectoryMode: mode, postgresDirectoryMode: mode, minioDirectoryMode: mode,
  requiredBytes: u64, requiredInodes: u64,
}).strict();

const enrolledRootSchema = z.object({
  role: z.enum(['ACTIVE', 'QUARANTINE', 'POOL', 'CONTROL']),
  pathIdentitySha256: digest,
  mountId: u64,
  mountParentId: u64,
  filesystemType: z.enum(['ext4', 'xfs']),
  filesystemUuid: z.string().regex(/^[a-f0-9-]{16,64}$/),
  deviceMajor: u64,
  deviceMinor: u64,
  readOnly: z.literal(false),
  quotaStatus: z.enum(['PROJECT_QUOTA_ENFORCED', 'DEDICATED_FILESYSTEM']),
}).strict();

const storageInventorySchema = z.object({
  format: z.literal('darshan-recovery-storage-inventory-evidence-v1'), kind: z.literal('STORAGE_INVENTORY'), ...common,
  storageAuthorityIdentitySha256: digest,
  roots: z.array(enrolledRootSchema).length(4),
}).strict();

const protectionInventorySchema = z.object({
  format: z.literal('darshan-recovery-protection-inventory-evidence-v1'), kind: z.literal('PROTECTION_INVENTORY'), ...common,
  protectedPathIdentitySha256: z.array(digest).min(1).max(128),
  observedMountinfoSha256: digest,
}).strict();

const capacitySchema = z.object({
  format: z.literal('darshan-recovery-capacity-evidence-v1'), kind: z.literal('CAPACITY_EVIDENCE'), ...common,
  hostPolicyEnvelopeSha256: digest,
  engineProfileEnvelopeSha256: digest,
  storageInventoryEnvelopeSha256: digest,
  protectionInventoryEnvelopeSha256: digest,
  allocationLedgerHeadSha256: digest,
  availableBytes: u64, availableInodes: u64,
  fullOutstandingReservationBytes: u64, fullOutstandingReservationInodes: u64,
  requiredBytes: u64, requiredInodes: u64,
  remainingBytes: u64, remainingInodes: u64,
  controlAvailableBytes: u64, controlAvailableInodes: u64,
}).strict();

const evidenceSchema = z.discriminatedUnion('kind', [hostPolicySchema, engineProfileSchema,
  storageInventorySchema, protectionInventorySchema, capacitySchema]);
const signatureSchema = z.object({ algorithm: z.literal('Ed25519'), keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  valueBase64: z.string().length(88) }).strict();
const envelopeSchema = z.object({ format: z.literal('darshan-recovery-storage-evidence-envelope-v1'),
  evidence: evidenceSchema, signature: signatureSchema }).strict();

export type TargetStorageEvidence = z.infer<typeof evidenceSchema>;
export type SignedTargetStorageEvidence = z.infer<typeof envelopeSchema>;
export type HostPolicyEvidence = z.infer<typeof hostPolicySchema>;
export type EngineProfileEvidence = z.infer<typeof engineProfileSchema>;
export type StorageInventoryEvidence = z.infer<typeof storageInventorySchema>;
export type ProtectionInventoryEvidence = z.infer<typeof protectionInventorySchema>;
export type CapacityEvidence = z.infer<typeof capacitySchema>;
export { u64 as targetStorageU64Schema };

const SIGNATURE_DOMAIN = Buffer.from('darshan-recovery-storage-evidence-signature-v1\0', 'utf8');

function canonicalOrdering(value: TargetStorageEvidence): void {
  const dependencies = value.dependencies.map((item) => `${item.kind}:${item.envelopeSha256}`);
  const revoked = value.revokedEnvelopeSha256;
  if (dependencies.some((item, index) => index > 0 && dependencies[index - 1]! >= item) ||
      revoked.some((item, index) => index > 0 && revoked[index - 1]! >= item)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence arrays are not unique canonical order.');
  }
  if (Date.parse(value.issuedAt) > Date.parse(value.validFrom) || Date.parse(value.validFrom) >= Date.parse(value.expiresAt)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence validity order is invalid.');
  }
  if (value.kind === 'STORAGE_INVENTORY') {
    const roles = value.roots.map((root) => root.role);
    if (roles.join(',') !== 'ACTIVE,QUARANTINE,POOL,CONTROL') {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage roots are not complete canonical role order.');
    }
  }
  if (value.kind === 'PROTECTION_INVENTORY' && value.protectedPathIdentitySha256.some((item, index) =>
    index > 0 && value.protectedPathIdentitySha256[index - 1]! >= item)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Protected path identities are not unique canonical order.');
  }
}

function signatureBytes(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength !== 64 || bytes.toString('base64') !== value) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence signature is not canonical Ed25519 bytes.');
  }
  return bytes;
}

export function parseSignedTargetStorageEvidence(bytes: Uint8Array): SignedTargetStorageEvidence {
  try {
    const source = Buffer.from(bytes);
    const value = envelopeSchema.parse(parseStrictJson(source, TARGET_STORAGE_EVIDENCE_MAX_BYTES));
    if (!canonicalJson(value).equals(source)) throw new Error('non-canonical evidence envelope');
    canonicalOrdering(value.evidence);
    return value;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence is not strict canonical bounded JSON.', { cause });
  }
}

export function encodeSignedTargetStorageEvidence(value: SignedTargetStorageEvidence): Buffer {
  const bytes = canonicalJson(envelopeSchema.parse(value));
  if (bytes.byteLength > TARGET_STORAGE_EVIDENCE_MAX_BYTES) throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence exceeds 64 KiB.');
  return bytes;
}

export function targetStorageEvidenceEnvelopeSha256(value: SignedTargetStorageEvidence | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeSignedTargetStorageEvidence(parseSignedTargetStorageEvidence(value))
    : encodeSignedTargetStorageEvidence(value);
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyTargetStorageEvidence(input: {
  bytes: Uint8Array;
  keys: ReadonlyMap<string, string>;
  revokedKeyIds?: ReadonlySet<string>;
  revokedEnvelopeSha256?: ReadonlySet<string>;
  now?: Date;
}): SignedTargetStorageEvidence {
  const envelope = parseSignedTargetStorageEvidence(input.bytes);
  const digestValue = targetStorageEvidenceEnvelopeSha256(envelope);
  if (input.revokedKeyIds?.has(envelope.signature.keyId) || input.revokedEnvelopeSha256?.has(digestValue)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_REVOKED', 'Storage evidence or its public signing key is revoked.');
  }
  const pem = input.keys.get(envelope.signature.keyId);
  if (!pem || !verify(null, Buffer.concat([SIGNATURE_DOMAIN, canonicalJson(envelope.evidence)]), createPublicKey(pem),
    signatureBytes(envelope.signature.valueBase64))) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence signature is not trusted.');
  }
  const now = (input.now ?? new Date()).getTime();
  if (now < Date.parse(envelope.evidence.validFrom) || now >= Date.parse(envelope.evidence.expiresAt)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Storage evidence is not active at verification time.');
  }
  return envelope;
}

/** Offline authoring/test helper only. Production exposes no signing or private-key-loading API. */
export function targetStorageEvidenceSigningPayload(evidence: TargetStorageEvidence): Buffer {
  const parsed = evidenceSchema.parse(evidence); canonicalOrdering(parsed);
  return Buffer.concat([SIGNATURE_DOMAIN, canonicalJson(parsed)]);
}

export const TARGET_STORAGE_FIXED_BASENAMES = {
  allocationMarker: '.darshan-target-allocation-v1', postgres: 'postgres', minio: 'minio', ledger: 'allocation-ledger-v1',
} as const satisfies Record<string, z.input<typeof basename>>;

