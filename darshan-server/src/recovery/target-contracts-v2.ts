import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { RECOVERY_TARGET_ACTIONS, type RecoveryTargetAction } from './target-contracts';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const timestamp = z.string().datetime({ offset: false });
const signature = z.object({ algorithm: z.literal('Ed25519'),
  keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/), valueBase64: z.string().length(88) }).strict();
const common = {
  operationId: uuid, siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/), hostInstallationId: uuid,
  planSha256: digest, targetSetId: digest, generation: z.number().int().positive().safe(),
  targetSpecificationSha256: digest, operationAttestationSha256: digest,
};
const admissionV2Schema = z.object({
  format: z.literal('darshan-recovery-target-admission-v2'), admissionId: uuid, ...common,
  allowedActions: z.array(z.enum(RECOVERY_TARGET_ACTIONS)).min(1).max(RECOVERY_TARGET_ACTIONS.length),
  issuedAt: timestamp, expiresAt: timestamp,
}).strict().superRefine((value, context) => {
  const order = new Map(RECOVERY_TARGET_ACTIONS.map((action, index) => [action, index]));
  if (new Set(value.allowedActions).size !== value.allowedActions.length || value.allowedActions.some((action, index) =>
    index > 0 && order.get(action)! <= order.get(value.allowedActions[index - 1]!)!)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'allowedActions is not unique canonical order' });
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'admission expiry must follow issuance' });
  }
});
const dispositionV2Schema = z.object({
  format: z.literal('darshan-recovery-target-disposition-v2'), decisionId: uuid, ...common,
  action: z.enum(['STOP_RETAIN', 'RETIRE']), expectedHelperSequence: z.number().int().nonnegative().safe(),
  expectedTargetState: z.literal('READY'), preparedReceiptSha256: digest, issuedAt: timestamp, expiresAt: timestamp,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'disposition expiry must follow issuance' });
  }
});
const admissionEnvelopeSchema = z.object({ admission: admissionV2Schema, signature }).strict();
const dispositionEnvelopeSchema = z.object({ decision: dispositionV2Schema, signature }).strict();
export type RecoveryTargetAdmissionV2 = z.infer<typeof admissionV2Schema>;
export type RecoveryTargetDispositionDecisionV2 = z.infer<typeof dispositionV2Schema>;
export type SignedRecoveryTargetAdmissionV2 = z.infer<typeof admissionEnvelopeSchema>;
export type SignedRecoveryTargetDispositionV2 = z.infer<typeof dispositionEnvelopeSchema>;
export type SignedRecoveryTargetAuthorizationV2 = SignedRecoveryTargetAdmissionV2 | SignedRecoveryTargetDispositionV2;

const ADMISSION_DOMAIN = Buffer.from('darshan-recovery-target-admission-signature-v2\0', 'utf8');
const DISPOSITION_DOMAIN = Buffer.from('darshan-recovery-target-disposition-signature-v2\0', 'utf8');

export interface TargetContractVerificationContextV2 {
  keys: ReadonlyMap<string, string>; revokedKeyIds?: ReadonlySet<string>; now?: Date;
  expected: { operationId: string; siteId: string; hostInstallationId: string; planSha256: string;
    targetSetId: string; generation: number; targetSpecificationSha256: string; operationAttestationSha256: string };
}

function parseCanonical<T>(bytes: Uint8Array, schema: z.ZodType<T>): T {
  try {
    const source = Buffer.from(bytes); const value = schema.parse(parseStrictJson(source, 64 * 1024));
    if (!canonicalJson(value).equals(source)) throw new Error('non-canonical authorization v2');
    return value;
  } catch (cause) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Target authorization v2 is not strict canonical bounded JSON.', { cause });
  }
}

function signatureBytes(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength !== 64 || bytes.toString('base64') !== value) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Target authorization v2 signature is not canonical Ed25519 bytes.');
  }
  return bytes;
}

function verifyBody(input: { body: RecoveryTargetAdmissionV2 | RecoveryTargetDispositionDecisionV2;
  signature: SignedRecoveryTargetAdmissionV2['signature']; domain: Buffer; context: TargetContractVerificationContextV2 }): void {
  const expected = input.context.expected; const body = input.body;
  if (Object.entries(expected).some(([key, value]) => body[key as keyof typeof body] !== value)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Target authorization v2 does not bind the exact plan, attestation, and target generation.');
  }
  const now = (input.context.now ?? new Date()).getTime();
  if (now < Date.parse(body.issuedAt) || now >= Date.parse(body.expiresAt)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Target authorization v2 is not active.');
  }
  if (input.context.revokedKeyIds?.has(input.signature.keyId)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_REVOKED', 'Target authorization v2 signing key is revoked.');
  }
  const pem = input.context.keys.get(input.signature.keyId);
  if (!pem || !verify(null, Buffer.concat([input.domain, canonicalJson(body)]), createPublicKey(pem),
    signatureBytes(input.signature.valueBase64))) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Target authorization v2 signature is not trusted.');
  }
}

export function parseSignedTargetAuthorizationV2(bytes: Uint8Array): SignedRecoveryTargetAuthorizationV2 {
  const raw = parseStrictJson(Buffer.from(bytes), 64 * 1024) as Record<string, unknown>;
  return raw && typeof raw === 'object' && 'admission' in raw
    ? parseCanonical(bytes, admissionEnvelopeSchema) : parseCanonical(bytes, dispositionEnvelopeSchema);
}

export function verifyTargetAdmissionV2(bytes: Uint8Array, context: TargetContractVerificationContextV2,
  action: RecoveryTargetAction): SignedRecoveryTargetAdmissionV2 {
  const value = parseCanonical(bytes, admissionEnvelopeSchema);
  if (!value.admission.allowedActions.includes(action)) {
    throw new RecoveryError('RECOVERY_TARGET_ACTION_NOT_ALLOWED', 'Target admission v2 does not permit the requested action.');
  }
  verifyBody({ body: value.admission, signature: value.signature, domain: ADMISSION_DOMAIN, context }); return value;
}

export function verifyTargetDispositionV2(bytes: Uint8Array, context: TargetContractVerificationContextV2,
  action?: 'STOP_RETAIN' | 'RETIRE'): SignedRecoveryTargetDispositionV2 {
  const value = parseCanonical(bytes, dispositionEnvelopeSchema);
  if (action !== undefined && value.decision.action !== action) {
    throw new RecoveryError('RECOVERY_TARGET_ACTION_NOT_ALLOWED', 'Target disposition v2 does not permit the requested action.');
  }
  verifyBody({ body: value.decision, signature: value.signature, domain: DISPOSITION_DOMAIN, context }); return value;
}

export function targetAuthorizationV2BodySha256(value: SignedRecoveryTargetAuthorizationV2): string {
  return createHash('sha256').update(canonicalJson('admission' in value ? value.admission : value.decision)).digest('hex');
}

/** Offline authoring/test helpers only. */
export function targetAdmissionV2SigningPayload(value: RecoveryTargetAdmissionV2): Buffer {
  return Buffer.concat([ADMISSION_DOMAIN, canonicalJson(admissionV2Schema.parse(value))]);
}
export function targetDispositionV2SigningPayload(value: RecoveryTargetDispositionDecisionV2): Buffer {
  return Buffer.concat([DISPOSITION_DOMAIN, canonicalJson(dispositionV2Schema.parse(value))]);
}
