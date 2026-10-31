import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';

export const TARGET_STORAGE_EVIDENCE_V2_MAX_BYTES = 64 * 1024;
export const TARGET_STORAGE_STABLE_EVIDENCE_KINDS = [
  'HOST_POLICY', 'ENGINE_PROFILE', 'STORAGE_INVENTORY', 'PROTECTION_INVENTORY',
] as const;
export type TargetStorageStableEvidenceKind = typeof TARGET_STORAGE_STABLE_EVIDENCE_KINDS[number];

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const site = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const timestamp = z.string().datetime({ offset: false });
const u64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).superRefine((value, context) => {
  if (BigInt(value) > 0xffff_ffff_ffff_ffffn) context.addIssue({ code: z.ZodIssueCode.custom, message: 'u64 overflow' });
});
const mode = z.string().regex(/^0[0-7]{3}$/);
const signatureSchema = z.object({
  algorithm: z.literal('Ed25519'),
  keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  valueBase64: z.string().length(88),
}).strict();

const stableCommon = {
  evidenceId: uuid,
  siteId: site,
  hostInstallationId: uuid,
  targetReleaseIdentitySha256: digest,
  targetLogicalIdentitySha256: digest,
  issuedAt: timestamp,
  validFrom: timestamp,
  expiresAt: timestamp,
  revokedEnvelopeSha256: z.array(digest).max(128),
};

const hostPolicyV2Schema = z.object({
  format: z.literal('darshan-recovery-host-policy-evidence-v2'), kind: z.literal('HOST_POLICY'), ...stableCommon,
  hostMode: z.enum(['SINGLE_HOST', 'SPLIT_HOST']), storageAuthorityIdentitySha256: digest,
  evidenceRootSha256: digest, allocationControlRootSha256: digest,
  allowedFilesystems: z.array(z.enum(['ext4', 'xfs'])).min(1).max(2),
}).strict();

const engineProfileV2Schema = z.object({
  format: z.literal('darshan-recovery-engine-profile-evidence-v2'), kind: z.literal('ENGINE_PROFILE'), ...stableCommon,
  postgresUid: u64, postgresGid: u64, minioUid: u64, minioGid: u64,
  allocationDirectoryMode: mode, postgresDirectoryMode: mode, minioDirectoryMode: mode,
  requiredBytes: u64, requiredInodes: u64,
}).strict();

const enrolledRootSchema = z.object({
  role: z.enum(['ACTIVE', 'QUARANTINE', 'POOL', 'CONTROL']), pathIdentitySha256: digest,
  mountId: u64, mountParentId: u64, filesystemType: z.enum(['ext4', 'xfs']),
  filesystemUuid: z.string().regex(/^[a-f0-9-]{16,64}$/), deviceMajor: u64, deviceMinor: u64,
  readOnly: z.literal(false), quotaStatus: z.enum(['PROJECT_QUOTA_ENFORCED', 'DEDICATED_FILESYSTEM']),
}).strict();

const storageInventoryV2Schema = z.object({
  format: z.literal('darshan-recovery-storage-inventory-evidence-v2'), kind: z.literal('STORAGE_INVENTORY'), ...stableCommon,
  storageAuthorityIdentitySha256: digest, roots: z.array(enrolledRootSchema).length(4),
}).strict();

const protectionInventoryV2Schema = z.object({
  format: z.literal('darshan-recovery-protection-inventory-evidence-v2'), kind: z.literal('PROTECTION_INVENTORY'), ...stableCommon,
  protectedPathIdentitySha256: z.array(digest).min(1).max(128), observedMountinfoSha256: digest,
}).strict();

const stableEvidenceV2Schema = z.discriminatedUnion('kind', [hostPolicyV2Schema, engineProfileV2Schema,
  storageInventoryV2Schema, protectionInventoryV2Schema]);

const capacityEvidenceV2Schema = z.object({
  format: z.literal('darshan-recovery-capacity-evidence-v2'), kind: z.literal('CAPACITY_EVIDENCE'),
  evidenceId: uuid, siteId: site, hostInstallationId: uuid, operationId: uuid, generation: u64,
  targetReleaseIdentitySha256: digest, targetLogicalIdentitySha256: digest,
  issuedAt: timestamp, validFrom: timestamp, expiresAt: timestamp,
  revokedEnvelopeSha256: z.array(digest).max(128),
  hostPolicyEnvelopeSha256: digest, engineProfileEnvelopeSha256: digest,
  storageInventoryEnvelopeSha256: digest, protectionInventoryEnvelopeSha256: digest,
  allocationLedgerHeadSha256: digest,
  availableBytes: u64, availableInodes: u64, fullOutstandingReservationBytes: u64,
  fullOutstandingReservationInodes: u64, requiredBytes: u64, requiredInodes: u64,
  remainingBytes: u64, remainingInodes: u64, controlAvailableBytes: u64, controlAvailableInodes: u64,
}).strict();

const evidenceV2Schema = z.discriminatedUnion('kind', [hostPolicyV2Schema, engineProfileV2Schema,
  storageInventoryV2Schema, protectionInventoryV2Schema, capacityEvidenceV2Schema]);
const envelopeV2Schema = z.object({
  format: z.literal('darshan-recovery-storage-evidence-envelope-v2'), evidence: evidenceV2Schema, signature: signatureSchema,
}).strict();

export type TargetStorageStableEvidenceV2 = z.infer<typeof stableEvidenceV2Schema>;
export type TargetStorageEvidenceV2 = z.infer<typeof evidenceV2Schema>;
export type SignedTargetStorageEvidenceV2 = z.infer<typeof envelopeV2Schema>;
export type HostPolicyEvidenceV2 = z.infer<typeof hostPolicyV2Schema>;
export type EngineProfileEvidenceV2 = z.infer<typeof engineProfileV2Schema>;
export type StorageInventoryEvidenceV2 = z.infer<typeof storageInventoryV2Schema>;
export type ProtectionInventoryEvidenceV2 = z.infer<typeof protectionInventoryV2Schema>;
export type CapacityEvidenceV2 = z.infer<typeof capacityEvidenceV2Schema>;

const SIGNATURE_DOMAIN_V2 = Buffer.from('darshan-recovery-storage-evidence-signature-v2\0', 'utf8');

function canonicalOrdering(value: TargetStorageEvidenceV2): void {
  if (value.revokedEnvelopeSha256.some((item, index) => index > 0 && value.revokedEnvelopeSha256[index - 1]! >= item)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence revocations are not unique canonical order.');
  }
  if (Date.parse(value.issuedAt) > Date.parse(value.validFrom) || Date.parse(value.validFrom) >= Date.parse(value.expiresAt)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence validity order is invalid.');
  }
  if (value.kind === 'STORAGE_INVENTORY' && value.roots.map((root) => root.role).join(',') !==
      'ACTIVE,QUARANTINE,POOL,CONTROL') {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage roots are not complete canonical role order.');
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

export function parseSignedTargetStorageEvidenceV2(bytes: Uint8Array): SignedTargetStorageEvidenceV2 {
  try {
    const source = Buffer.from(bytes);
    const value = envelopeV2Schema.parse(parseStrictJson(source, TARGET_STORAGE_EVIDENCE_V2_MAX_BYTES));
    if (!canonicalJson(value).equals(source)) throw new Error('non-canonical evidence envelope v2');
    canonicalOrdering(value.evidence);
    return value;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence v2 is not strict canonical bounded JSON.', { cause });
  }
}

export function encodeSignedTargetStorageEvidenceV2(value: SignedTargetStorageEvidenceV2): Buffer {
  const parsed = envelopeV2Schema.parse(value); canonicalOrdering(parsed.evidence);
  const bytes = canonicalJson(parsed);
  if (bytes.byteLength > TARGET_STORAGE_EVIDENCE_V2_MAX_BYTES) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence v2 exceeds 64 KiB.');
  }
  return bytes;
}

export function targetStorageEvidenceV2EnvelopeSha256(value: SignedTargetStorageEvidenceV2 | Uint8Array): string {
  const bytes = value instanceof Uint8Array
    ? encodeSignedTargetStorageEvidenceV2(parseSignedTargetStorageEvidenceV2(value))
    : encodeSignedTargetStorageEvidenceV2(value);
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyTargetStorageEvidenceV2(input: {
  bytes: Uint8Array; keys: ReadonlyMap<string, string>; revokedKeyIds?: ReadonlySet<string>;
  revokedEnvelopeSha256?: ReadonlySet<string>; now?: Date;
}): SignedTargetStorageEvidenceV2 {
  const envelope = parseSignedTargetStorageEvidenceV2(input.bytes);
  const envelopeSha256 = targetStorageEvidenceV2EnvelopeSha256(envelope);
  if (input.revokedKeyIds?.has(envelope.signature.keyId) || input.revokedEnvelopeSha256?.has(envelopeSha256)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_REVOKED', 'Storage evidence v2 or its public signing key is revoked.');
  }
  const pem = input.keys.get(envelope.signature.keyId);
  if (!pem || !verify(null, Buffer.concat([SIGNATURE_DOMAIN_V2, canonicalJson(envelope.evidence)]), createPublicKey(pem),
    signatureBytes(envelope.signature.valueBase64))) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Storage evidence v2 signature is not trusted.');
  }
  const now = (input.now ?? new Date()).getTime();
  if (now < Date.parse(envelope.evidence.validFrom) || now >= Date.parse(envelope.evidence.expiresAt)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Storage evidence v2 is not active at verification time.');
  }
  return envelope;
}

/** Offline authoring/test helper only. Production has public verification only. */
export function targetStorageEvidenceV2SigningPayload(evidence: TargetStorageEvidenceV2): Buffer {
  const parsed = evidenceV2Schema.parse(evidence); canonicalOrdering(parsed);
  return Buffer.concat([SIGNATURE_DOMAIN_V2, canonicalJson(parsed)]);
}
