import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { assertCanonicalTimestamp, recoveryDigest, recoverySiteId, recoveryUuid } from './contracts';
import { RecoveryError } from './errors';

export const RECOVERY_TARGET_ADMISSION_FORMAT = 'darshan-recovery-target-admission-v1' as const;
export const RECOVERY_TARGET_DISPOSITION_FORMAT = 'darshan-recovery-target-disposition-v1' as const;
export const RECOVERY_TARGET_ACTIONS = ['PREPARE', 'INSPECT', 'STOP_RETAIN', 'RETIRE'] as const;
export type RecoveryTargetAction = typeof RECOVERY_TARGET_ACTIONS[number];
export const MAX_TARGET_CONTRACT_BYTES = 64 * 1024;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: false });
const keyId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const signature = z.object({ algorithm: z.literal('Ed25519'), keyId, valueBase64: z.string().min(88).max(88) }).strict();

const admissionSchema = z.object({
  format: z.literal(RECOVERY_TARGET_ADMISSION_FORMAT),
  admissionId: uuid,
  operationId: uuid,
  siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  hostInstallationId: uuid,
  planSha256: digest,
  targetSetId: digest,
  generation: z.number().int().positive().safe(),
  targetSpecificationSha256: digest,
  allowedActions: z.array(z.enum(RECOVERY_TARGET_ACTIONS)).min(1).max(RECOVERY_TARGET_ACTIONS.length),
  issuedAt: timestamp,
  expiresAt: timestamp,
}).strict().superRefine((value, context) => {
  if (new Set(value.allowedActions).size !== value.allowedActions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'allowedActions contains a duplicate' });
  }
  const order = new Map(RECOVERY_TARGET_ACTIONS.map((action, index) => [action, index]));
  if (value.allowedActions.some((action, index) => index > 0 && order.get(action)! <= order.get(value.allowedActions[index - 1]!)!)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'allowedActions must be in canonical order' });
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'admission expiry must follow issuance' });
  }
});

const dispositionSchema = z.object({
  format: z.literal(RECOVERY_TARGET_DISPOSITION_FORMAT),
  decisionId: uuid,
  operationId: uuid,
  siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  hostInstallationId: uuid,
  planSha256: digest,
  targetSetId: digest,
  generation: z.number().int().positive().safe(),
  action: z.enum(['STOP_RETAIN', 'RETIRE']),
  expectedHelperSequence: z.number().int().nonnegative().safe(),
  expectedTargetState: z.literal('READY'),
  preparedReceiptSha256: digest,
  issuedAt: timestamp,
  expiresAt: timestamp,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'disposition expiry must follow issuance' });
  }
});

const admissionEnvelopeSchema = z.object({ admission: admissionSchema, signature }).strict();
const dispositionEnvelopeSchema = z.object({ decision: dispositionSchema, signature }).strict();
export type RecoveryTargetAdmission = z.infer<typeof admissionSchema>;
export type RecoveryTargetDispositionDecision = z.infer<typeof dispositionSchema>;
export type SignedRecoveryTargetAdmission = z.infer<typeof admissionEnvelopeSchema>;
export type SignedRecoveryTargetDisposition = z.infer<typeof dispositionEnvelopeSchema>;
export type SignedRecoveryTargetAuthorization = SignedRecoveryTargetAdmission | SignedRecoveryTargetDisposition;

const ADMISSION_DOMAIN = Buffer.from('darshan-recovery-target-admission-signature-v1\0', 'utf8');
const DISPOSITION_DOMAIN = Buffer.from('darshan-recovery-target-disposition-signature-v1\0', 'utf8');

export interface TargetContractVerificationContext {
  keys: ReadonlyMap<string, string>;
  revokedKeyIds?: ReadonlySet<string>;
  now?: Date;
  expected: {
    operationId: string;
    siteId: string;
    hostInstallationId: string;
    planSha256: string;
    targetSetId: string;
    generation: number;
    targetSpecificationSha256?: string;
  };
}

function strictSignatureBytes(valueBase64: string): Buffer {
  const bytes = Buffer.from(valueBase64, 'base64');
  if (bytes.byteLength !== 64 || bytes.toString('base64') !== valueBase64) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Target authorization signature is not canonical Ed25519 bytes.');
  }
  return bytes;
}

function verifySigned(input: {
  body: RecoveryTargetAdmission | RecoveryTargetDispositionDecision;
  signature: SignedRecoveryTargetAdmission['signature'];
  domain: Buffer;
  context: TargetContractVerificationContext;
}): void {
  if (input.context.revokedKeyIds?.has(input.signature.keyId)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_REVOKED', 'Target authorization signing key is revoked.');
  }
  const pem = input.context.keys.get(input.signature.keyId);
  if (!pem || !verify(null, Buffer.concat([input.domain, canonicalJson(input.body)]), createPublicKey(pem),
    strictSignatureBytes(input.signature.valueBase64))) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Target authorization signature is not trusted.');
  }
}

function assertBinding(body: RecoveryTargetAdmission | RecoveryTargetDispositionDecision,
  context: TargetContractVerificationContext): void {
  recoveryUuid(body.operationId, 'operationId'); recoverySiteId(body.siteId);
  recoveryUuid(body.hostInstallationId, 'hostInstallationId');
  recoveryDigest(body.planSha256, 'planSha256'); recoveryDigest(body.targetSetId, 'targetSetId');
  assertCanonicalTimestamp(body.issuedAt, 'issuedAt'); assertCanonicalTimestamp(body.expiresAt, 'expiresAt');
  const expected = context.expected;
  if (body.operationId !== expected.operationId || body.siteId !== expected.siteId ||
      body.hostInstallationId !== expected.hostInstallationId || body.planSha256 !== expected.planSha256 ||
      body.targetSetId !== expected.targetSetId || body.generation !== expected.generation ||
      ('targetSpecificationSha256' in body && expected.targetSpecificationSha256 !== undefined &&
       body.targetSpecificationSha256 !== expected.targetSpecificationSha256)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Target authorization does not bind this exact site, host, plan, and target generation.');
  }
  const now = (context.now ?? new Date()).getTime();
  if (now < Date.parse(body.issuedAt) || now >= Date.parse(body.expiresAt)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Target authorization is not active at the verification time.');
  }
}

function parseCanonical<T>(bytes: Uint8Array, schema: z.ZodType<T>): T {
  try {
    const buffer = Buffer.from(bytes);
    const parsed = schema.parse(parseStrictJson(buffer, MAX_TARGET_CONTRACT_BYTES));
    if (!canonicalJson(parsed).equals(buffer)) throw new Error('non-canonical contract');
    return parsed;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Target authorization is not strict canonical bounded JSON.', { cause });
  }
}

export function verifyTargetAdmission(bytes: Uint8Array, context: TargetContractVerificationContext,
  requiredAction: RecoveryTargetAction): SignedRecoveryTargetAdmission {
  const envelope = parseCanonical(bytes, admissionEnvelopeSchema);
  assertBinding(envelope.admission, context);
  if (!envelope.admission.allowedActions.includes(requiredAction)) {
    throw new RecoveryError('RECOVERY_TARGET_ACTION_NOT_ALLOWED', 'Target authorization does not permit the requested action.');
  }
  verifySigned({ body: envelope.admission, signature: envelope.signature, domain: ADMISSION_DOMAIN, context });
  return envelope;
}

export function verifyTargetDisposition(bytes: Uint8Array, context: TargetContractVerificationContext,
  requiredAction?: 'STOP_RETAIN' | 'RETIRE'): SignedRecoveryTargetDisposition {
  const envelope = parseCanonical(bytes, dispositionEnvelopeSchema);
  assertBinding(envelope.decision, context);
  if (requiredAction !== undefined && envelope.decision.action !== requiredAction) {
    throw new RecoveryError('RECOVERY_TARGET_ACTION_NOT_ALLOWED', 'Target disposition does not permit the requested action.');
  }
  verifySigned({ body: envelope.decision, signature: envelope.signature, domain: DISPOSITION_DOMAIN, context });
  return envelope;
}

export function parseSignedTargetAuthorization(bytes: Uint8Array): SignedRecoveryTargetAuthorization {
  try {
    const value = parseStrictJson(Buffer.from(bytes), MAX_TARGET_CONTRACT_BYTES) as Record<string, unknown>;
    if (value && typeof value === 'object' && !Array.isArray(value) && 'admission' in value) {
      return parseCanonical(bytes, admissionEnvelopeSchema);
    }
    return parseCanonical(bytes, dispositionEnvelopeSchema);
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Target authorization type is invalid.', { cause });
  }
}

export function targetAuthorizationBodySha256(value: SignedRecoveryTargetAuthorization): string {
  return recoveryDigest(createHash('sha256').update(canonicalJson('admission' in value ? value.admission : value.decision)).digest('hex'),
    'authorizationSha256');
}

/** Exported for test/offline authoring tools; production runtime only verifies. */
export function targetAdmissionSigningPayload(admission: RecoveryTargetAdmission): Buffer {
  return Buffer.concat([ADMISSION_DOMAIN, canonicalJson(admissionSchema.parse(admission))]);
}

/** Exported for test/offline authoring tools; production runtime only verifies. */
export function targetDispositionSigningPayload(decision: RecoveryTargetDispositionDecision): Buffer {
  return Buffer.concat([DISPOSITION_DOMAIN, canonicalJson(dispositionSchema.parse(decision))]);
}
