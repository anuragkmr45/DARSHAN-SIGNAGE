import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';

export const TARGET_HELPER_PROTOCOL_FORMAT = 'darshan-recovery-target-helper-v1' as const;
export const TARGET_HELPER_MAX_REQUEST_BYTES = 64 * 1024;
export const TARGET_HELPER_MAX_RESPONSE_BYTES = 128 * 1024;
export const TARGET_HELPER_MAX_CONNECTIONS = 4;
export const TARGET_HELPER_REQUEST_TIMEOUT_MS = 5_000;

export const TARGET_HELPER_OPERATIONS = ['PREPARE', 'INSPECT', 'STOP_RETAIN', 'RETIRE'] as const;
export type TargetHelperOperation = typeof TARGET_HELPER_OPERATIONS[number];
export const TARGET_LIFECYCLE_STATES = [
  'ABSENT', 'RESERVED', 'ALLOCATING', 'CREATED', 'STARTING', 'READY', 'STOPPING',
  'STOPPED_RETAINED', 'RETIRED', 'PURGED', 'FAILED_RETAINED', 'RECONCILIATION_REQUIRED',
] as const;
export type TargetLifecycleState = typeof TARGET_LIFECYCLE_STATES[number];
export const TARGET_HELPER_ERROR_CODES = [
  'TARGET_REQUEST_INVALID', 'TARGET_REQUEST_CONFLICT', 'TARGET_SEQUENCE_CONFLICT',
  'TARGET_ACTION_NOT_ALLOWED', 'TARGET_ENGINE_FAILED', 'TARGET_EFFECT_AMBIGUOUS',
  'TARGET_STATE_CONFLICT', 'TARGET_NOT_INSTALLED', 'TARGET_INTERNAL_ERROR',
] as const;
export type TargetHelperErrorCode = typeof TARGET_HELPER_ERROR_CODES[number];

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const common = {
  format: z.literal(TARGET_HELPER_PROTOCOL_FORMAT),
  requestId: uuid,
  operation: z.enum(TARGET_HELPER_OPERATIONS),
  operationId: uuid,
  siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  hostInstallationId: uuid,
  planSha256: digest,
  targetSetId: digest,
  generation: z.number().int().positive().safe(),
  targetSpecificationSha256: digest,
  authorizationSha256: digest,
};
const requestSchema = z.object({ ...common,
  expectedHelperSequence: z.number().int().nonnegative().safe().nullable(),
}).strict();
const successSchema = z.object({ ...common,
  ok: z.literal(true),
  helperSequence: z.number().int().nonnegative().safe(),
  state: z.enum(TARGET_LIFECYCLE_STATES),
  pendingAction: z.enum(TARGET_HELPER_OPERATIONS).nullable(),
  reconciliationEvidenceSha256: digest.nullable(),
  effectDisposition: z.enum(['NONE', 'DEFINITE', 'AMBIGUOUS']),
  observedAt: z.string().datetime({ offset: false }),
}).strict();
const errorSchema = z.object({ ...common,
  ok: z.literal(false),
  helperSequence: z.number().int().nonnegative().safe(),
  state: z.enum(TARGET_LIFECYCLE_STATES),
  pendingAction: z.enum(TARGET_HELPER_OPERATIONS).nullable(),
  error: z.object({ code: z.enum(TARGET_HELPER_ERROR_CODES), message: z.string().min(1).max(512) }).strict(),
  observedAt: z.string().datetime({ offset: false }),
}).strict();
const responseSchema = z.discriminatedUnion('ok', [successSchema, errorSchema]);

export type TargetHelperRequest = z.infer<typeof requestSchema>;
export type TargetHelperSuccessResponse = z.infer<typeof successSchema>;
export type TargetHelperErrorResponse = z.infer<typeof errorSchema>;
export type TargetHelperResponse = z.infer<typeof responseSchema>;

function parseCanonical<T>(bytes: Uint8Array, maximumBytes: number, schema: z.ZodType<T>, label: string): T {
  try {
    const buffer = Buffer.from(bytes);
    const value = schema.parse(parseStrictJson(buffer, maximumBytes));
    if (!canonicalJson(value).equals(buffer)) throw new Error('non-canonical JSON');
    return value;
  } catch (cause) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', `${label} is not strict canonical bounded target-helper JSON.`, { cause });
  }
}

export function parseTargetHelperRequest(bytes: Uint8Array): TargetHelperRequest {
  return parseCanonical(bytes, TARGET_HELPER_MAX_REQUEST_BYTES, requestSchema, 'Target-helper request');
}

export function parseTargetHelperResponse(bytes: Uint8Array): TargetHelperResponse {
  return parseCanonical(bytes, TARGET_HELPER_MAX_RESPONSE_BYTES, responseSchema, 'Target-helper response');
}

export function encodeTargetHelperRequest(value: TargetHelperRequest): Buffer {
  const bytes = canonicalJson(requestSchema.parse(value));
  if (bytes.byteLength > TARGET_HELPER_MAX_REQUEST_BYTES) throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target-helper request exceeds its reviewed bound.');
  return bytes;
}

export function encodeTargetHelperResponse(value: TargetHelperResponse): Buffer {
  const bytes = canonicalJson(responseSchema.parse(value));
  if (bytes.byteLength > TARGET_HELPER_MAX_RESPONSE_BYTES) throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target-helper response exceeds its reviewed bound.');
  return bytes;
}

export function targetHelperResponseMatchesRequest(response: TargetHelperResponse, request: TargetHelperRequest): boolean {
  return response.requestId === request.requestId && response.operation === request.operation &&
    response.operationId === request.operationId && response.siteId === request.siteId &&
    response.hostInstallationId === request.hostInstallationId && response.planSha256 === request.planSha256 &&
    response.targetSetId === request.targetSetId && response.generation === request.generation &&
    response.targetSpecificationSha256 === request.targetSpecificationSha256 &&
    response.authorizationSha256 === request.authorizationSha256;
}
