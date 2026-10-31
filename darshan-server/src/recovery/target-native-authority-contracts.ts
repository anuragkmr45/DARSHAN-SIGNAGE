import { z } from 'zod';
import { RecoveryError } from './errors';

export const TARGET_NATIVE_AUTHORITY_MAX_FRAME_BYTES = 4096;
export const TARGET_NATIVE_AUTHORITY_MAX_RESULT_BYTES = 1024;
export const TARGET_NATIVE_AUTHORITY_MAX_DEADLINE_SKEW_MS = 240_000;
export const TARGET_NATIVE_AUTHORITY_OPERATIONS = ['INSPECT', 'PREPARE', 'STOP_RETAIN'] as const;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const u64 = z.bigint().min(0n).max(0xffff_ffff_ffff_ffffn);
const siteId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const authorityHandle = z.string().regex(/^rtea:v1:[A-Za-z0-9_:-]{20,112}$/);
const challenge = z.string().regex(/^[a-f0-9]{32}$/);

const requestSchema = z.object({
  format: z.literal('darshan-recovery-target-native-authority-v2'),
  kind: z.literal('ACQUIRE'),
  operation: z.enum(TARGET_NATIVE_AUTHORITY_OPERATIONS),
  installationId: uuid,
  siteId,
  hostInstallationId: uuid,
  operationId: uuid,
  generation: u64.refine((value) => value > 0n),
  targetSetId: digest,
  targetHandle: authorityHandle,
  profileSha256: digest,
  enrollmentSha256: digest,
  admissionSha256: digest,
  outerEnvelopeSha256: digest,
  requestSha256: digest,
  authorizationSha256: digest,
  deadlineUnixMs: u64.refine((value) => value > 0n),
  supervisorInstanceSha256: digest,
  supervisorGeneration: u64.refine((value) => value > 0n),
  reconciledGeneration: u64,
  challengeNonce: challenge,
}).strict();

const resultSchema = z.object({
  format: z.literal('darshan-recovery-target-native-authority-result-v2'),
  kind: z.literal('ACQUIRED'),
  outcome: z.enum(['READONLY', 'LEASED']),
  sessionHandle: authorityHandle,
  leaseProofSha256: digest,
  authorityInstanceSha256: digest,
  supervisorGeneration: u64.refine((value) => value > 0n),
  reconciliationRequired: z.boolean(),
  sanitizedCode: z.literal('OK'),
  challengeNonce: challenge,
}).strict();

export type TargetNativeAuthorityRequest = z.infer<typeof requestSchema>;
export type TargetNativeAuthorityRequestInput = Omit<TargetNativeAuthorityRequest, 'challengeNonce'>;
export type TargetNativeAuthorityResult = z.infer<typeof resultSchema>;

const requestFields = [
  ['format', 'format'], ['kind', 'kind'], ['operation', 'operation'], ['installation_id', 'installationId'],
  ['site_id', 'siteId'], ['host_installation_id', 'hostInstallationId'], ['operation_id', 'operationId'],
  ['generation', 'generation'], ['target_set_id', 'targetSetId'], ['target_handle', 'targetHandle'],
  ['profile_sha256', 'profileSha256'], ['enrollment_sha256', 'enrollmentSha256'],
  ['admission_sha256', 'admissionSha256'], ['outer_envelope_sha256', 'outerEnvelopeSha256'],
  ['request_sha256', 'requestSha256'], ['authorization_sha256', 'authorizationSha256'],
  ['deadline_unix_ms', 'deadlineUnixMs'], ['supervisor_instance_sha256', 'supervisorInstanceSha256'],
  ['supervisor_generation', 'supervisorGeneration'], ['reconciled_generation', 'reconciledGeneration'],
  ['challenge_nonce', 'challengeNonce'],
] as const;

const resultFields = [
  ['format', 'format'], ['kind', 'kind'], ['outcome', 'outcome'], ['session_handle', 'sessionHandle'],
  ['lease_proof_sha256', 'leaseProofSha256'], ['authority_instance_sha256', 'authorityInstanceSha256'],
  ['supervisor_generation', 'supervisorGeneration'], ['reconciliation_required', 'reconciliationRequired'],
  ['sanitized_code', 'sanitizedCode'],
  ['challenge_nonce', 'challengeNonce'],
] as const;

function scalar(value: unknown): string {
  if (typeof value === 'bigint') return value.toString(10);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string' && !value.includes('\n') && !value.includes('\r') && !value.includes('\0')) return value;
  throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native authority scalar is not canonical.');
}

function encode<T extends Record<string, unknown>>(value: T, fields: readonly (readonly [string, keyof T])[], maximum: number): Buffer {
  const bytes = Buffer.from(fields.map(([wire, property]) => `${wire}=${scalar(value[property])}\n`).join(''), 'utf8');
  if (bytes.byteLength > maximum) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native authority frame exceeds its reviewed bound.');
  }
  return bytes;
}

function decode(bytes: Uint8Array, fields: readonly (readonly [string, string])[], maximum: number): Record<string, string> {
  const source = Buffer.from(bytes);
  if (source.byteLength === 0 || source.byteLength > maximum || source[source.byteLength - 1] !== 0x0a ||
      source.includes(0x00) || source.includes(0x0d)) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native authority frame is not one bounded canonical record.');
  }
  const lines = source.toString('utf8').slice(0, -1).split('\n');
  if (lines.length !== fields.length) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native authority field set is incomplete or trailing.');
  }
  const result: Record<string, string> = {};
  fields.forEach(([wire, property], index) => {
    const prefix = `${wire}=`; const line = lines[index]!;
    if (!line.startsWith(prefix) || line.length === prefix.length) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native authority field order or value is invalid.');
    }
    result[property] = line.slice(prefix.length);
  });
  return result;
}

function decimal(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]{0,19})$/.test(value)) throw new Error('noncanonical u64');
  return BigInt(value);
}

export function encodeTargetNativeAuthorityRequest(value: TargetNativeAuthorityRequest): Buffer {
  const parsed = requestSchema.parse(value);
  if (parsed.operation !== 'INSPECT' && parsed.reconciledGeneration !== parsed.supervisorGeneration) {
    throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
      'A native mutation requires reconciliation through the current supervisor generation.');
  }
  return encode(parsed, requestFields, TARGET_NATIVE_AUTHORITY_MAX_FRAME_BYTES);
}

export function parseTargetNativeAuthorityRequest(bytes: Uint8Array): TargetNativeAuthorityRequest {
  try {
    const raw = decode(bytes, requestFields, TARGET_NATIVE_AUTHORITY_MAX_FRAME_BYTES);
    const parsed = requestSchema.parse({ ...raw,
      generation: decimal(raw.generation!), deadlineUnixMs: decimal(raw.deadlineUnixMs!),
      supervisorGeneration: decimal(raw.supervisorGeneration!), reconciledGeneration: decimal(raw.reconciledGeneration!),
    });
    if (!encodeTargetNativeAuthorityRequest(parsed).equals(Buffer.from(bytes))) throw new Error('noncanonical request');
    return parsed;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID',
      'Native authority request is not strict canonical bounded protocol.', { cause });
  }
}

export function parseTargetNativeAuthorityResult(bytes: Uint8Array): TargetNativeAuthorityResult {
  try {
    const raw = decode(bytes, resultFields, TARGET_NATIVE_AUTHORITY_MAX_RESULT_BYTES);
    const parsed = resultSchema.parse({ ...raw,
      supervisorGeneration: decimal(raw.supervisorGeneration!),
      reconciliationRequired: raw.reconciliationRequired === 'true' ? true :
        raw.reconciliationRequired === 'false' ? false : raw.reconciliationRequired,
    });
    if (!encode(parsed, resultFields, TARGET_NATIVE_AUTHORITY_MAX_RESULT_BYTES).equals(Buffer.from(bytes))) {
      throw new Error('noncanonical result');
    }
    return parsed;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID',
      'Native authority result is not strict canonical bounded protocol.', { cause });
  }
}

export function assertTargetNativeAuthorityDeadline(value: TargetNativeAuthorityRequest, nowUnixMs: bigint): void {
  const parsed = requestSchema.parse(value);
  if (parsed.deadlineUnixMs <= nowUnixMs || parsed.deadlineUnixMs - nowUnixMs > BigInt(TARGET_NATIVE_AUTHORITY_MAX_DEADLINE_SKEW_MS)) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native authority deadline is expired or outside the reviewed bound.');
  }
}
