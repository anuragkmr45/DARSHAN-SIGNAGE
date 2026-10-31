import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';

export const RECOVERY_TARGET_OPERATION_ATTESTATION_FORMAT =
  'darshan-recovery-target-operation-attestation-v1' as const;
export const RECOVERY_TARGET_OPERATION_ATTESTATION_ENVELOPE_FORMAT =
  'darshan-recovery-target-operation-attestation-envelope-v1' as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const bodySchema = z.object({
  format: z.literal(RECOVERY_TARGET_OPERATION_ATTESTATION_FORMAT),
  attestationId: uuid,
  operationId: uuid,
  siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  generation: z.number().int().positive().safe(),
  hostInstallationId: uuid,
  targetSetId: digest,
  targetSpecificationSha256: digest,
  targetLogicalIdentitySha256: digest,
  targetReleaseIdentitySha256: digest,
  hostPolicyEnvelopeSha256: digest,
  engineProfileEnvelopeSha256: digest,
  storageInventoryEnvelopeSha256: digest,
  protectionInventoryEnvelopeSha256: digest,
  capacityEvidenceEnvelopeSha256: digest,
  issuedAt: z.string().datetime({ offset: false }),
  expiresAt: z.string().datetime({ offset: false }),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'attestation expiry must follow issuance' });
  }
});
const signatureSchema = z.object({ algorithm: z.literal('Ed25519'),
  keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/), valueBase64: z.string().length(88) }).strict();
const envelopeSchema = z.object({ format: z.literal(RECOVERY_TARGET_OPERATION_ATTESTATION_ENVELOPE_FORMAT),
  attestation: bodySchema, signature: signatureSchema }).strict();

export type RecoveryTargetOperationAttestation = z.infer<typeof bodySchema>;
export type SignedRecoveryTargetOperationAttestation = z.infer<typeof envelopeSchema>;
const SIGNATURE_DOMAIN = Buffer.from('darshan-recovery-target-operation-attestation-signature-v1\0', 'utf8');

export function parseSignedTargetOperationAttestation(bytes: Uint8Array): SignedRecoveryTargetOperationAttestation {
  try {
    const source = Buffer.from(bytes); const value = envelopeSchema.parse(parseStrictJson(source, 64 * 1024));
    if (!canonicalJson(value).equals(source)) throw new Error('non-canonical operation attestation');
    return value;
  } catch (cause) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID',
      'Target operation attestation is not strict canonical bounded JSON.', { cause });
  }
}

export function encodeSignedTargetOperationAttestation(value: SignedRecoveryTargetOperationAttestation): Buffer {
  const bytes = canonicalJson(envelopeSchema.parse(value));
  if (bytes.byteLength > 64 * 1024) throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Operation attestation exceeds 64 KiB.');
  return bytes;
}

export function targetOperationAttestationEnvelopeSha256(value: SignedRecoveryTargetOperationAttestation | Uint8Array): string {
  const bytes = value instanceof Uint8Array
    ? encodeSignedTargetOperationAttestation(parseSignedTargetOperationAttestation(value))
    : encodeSignedTargetOperationAttestation(value);
  return createHash('sha256').update(bytes).digest('hex');
}

function signatureBytes(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength !== 64 || bytes.toString('base64') !== value) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Operation attestation signature is not canonical Ed25519 bytes.');
  }
  return bytes;
}

export function verifyTargetOperationAttestation(input: {
  bytes: Uint8Array; keys: ReadonlyMap<string, string>; revokedKeyIds?: ReadonlySet<string>; now?: Date;
}): SignedRecoveryTargetOperationAttestation {
  const envelope = parseSignedTargetOperationAttestation(input.bytes);
  if (input.revokedKeyIds?.has(envelope.signature.keyId)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_REVOKED', 'Operation attestation signing key is revoked.');
  }
  const pem = input.keys.get(envelope.signature.keyId);
  if (!pem || !verify(null, Buffer.concat([SIGNATURE_DOMAIN, canonicalJson(envelope.attestation)]), createPublicKey(pem),
    signatureBytes(envelope.signature.valueBase64))) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Operation attestation signature is not trusted.');
  }
  const now = (input.now ?? new Date()).getTime();
  if (now < Date.parse(envelope.attestation.issuedAt) || now >= Date.parse(envelope.attestation.expiresAt)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Operation attestation is not active.');
  }
  return envelope;
}

/** Offline authoring/test helper only. */
export function targetOperationAttestationSigningPayload(value: RecoveryTargetOperationAttestation): Buffer {
  return Buffer.concat([SIGNATURE_DOMAIN, canonicalJson(bodySchema.parse(value))]);
}
