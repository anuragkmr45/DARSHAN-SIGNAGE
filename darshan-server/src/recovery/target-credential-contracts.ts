import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { targetAuthorityHandleSchema } from './target-engine-contracts';

export const TARGET_CREDENTIAL_CONTRACT_MAX_BYTES = 64 * 1024;
export const TARGET_CREDENTIAL_ROLES = [
  'POSTGRES_PASSWORD', 'MINIO_ROOT_PASSWORD', 'MINIO_ROOT_USER',
] as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const u64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).superRefine((value, context) => {
  if (BigInt(value) > 0xffff_ffff_ffff_ffffn) context.addIssue({ code: z.ZodIssueCode.custom, message: 'u64 overflow' });
});
const positiveU64 = u64.refine((value) => value !== '0', 'must be positive');
const role = z.enum(TARGET_CREDENTIAL_ROLES);

const scopeSchema = z.object({
  format: z.literal('darshan-recovery-credential-provision-scope-v1'),
  operation: z.literal('PREPARE'), operationId: uuid, generation: positiveU64,
  targetHandle: targetAuthorityHandleSchema,
  authorityTargetHandle: z.string().regex(/^rtea:v1:[a-z][a-z0-9-]{0,31}:[A-Za-z0-9_-]{16,96}$/),
  authorityHandle: targetAuthorityHandleSchema,
  profileV2Sha256: digest, precredentialTemplateSha256: digest,
  allocationIdentitySha256: digest, allocationLedgerHeadSha256: digest,
  authorizationSha256: digest, outerEnvelopeSha256: digest,
  credentialPolicySha256: digest, authorityInstanceSha256: digest,
  supervisorGeneration: positiveU64, challengeNonce: z.string().regex(/^[a-f0-9]{32}$/),
  deadlineUnixMs: positiveU64, previousJournalHeadSha256: digest,
  roles: z.tuple([
    z.object({ role: z.literal('POSTGRES_PASSWORD'), authorityHandle: targetAuthorityHandleSchema }).strict(),
    z.object({ role: z.literal('MINIO_ROOT_PASSWORD'), authorityHandle: targetAuthorityHandleSchema }).strict(),
    z.object({ role: z.literal('MINIO_ROOT_USER'), authorityHandle: targetAuthorityHandleSchema }).strict(),
  ]),
}).strict().superRefine((value, context) => {
  if (new Set(value.roles.map((entry) => entry.authorityHandle)).size !== TARGET_CREDENTIAL_ROLES.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'credential role handles must be physically distinct authorities' });
  }
});

const descriptorSchema = z.object({
  role, authorityHandle: targetAuthorityHandleSchema, descriptorIdentitySha256: digest,
  deviceMajor: u64, deviceMinor: u64, inode: positiveU64, mountId: positiveU64,
  ownerUid: u64, ownerGid: u64, mode: z.literal('0400'),
}).strict();

const journalCommon = {
  operationId: uuid, generation: positiveU64, targetHandle: targetAuthorityHandleSchema,
  scopeSemanticSha256: digest, scopeWireSha256: digest, authorizationSha256: digest,
  allocationIdentitySha256: digest, allocationLedgerHeadSha256: digest,
  credentialPolicySha256: digest, authorityInstanceSha256: digest,
  previousHeadSha256: digest,
};
const intentSchema = z.object({
  format: z.literal('darshan-recovery-credential-provision-journal-v1'),
  state: z.literal('INTENT'), sequence: positiveU64, ...journalCommon,
  recordSha256: digest,
}).strict();
const filesDurableSchema = z.object({
  format: z.literal('darshan-recovery-credential-provision-journal-v1'),
  state: z.literal('FILES_DURABLE'), sequence: positiveU64, ...journalCommon,
  intentRecordSha256: digest, descriptors: z.tuple([descriptorSchema, descriptorSchema, descriptorSchema]),
  recordSha256: digest,
}).strict();
const admittedSchema = z.object({
  format: z.literal('darshan-recovery-credential-provision-journal-v1'),
  state: z.literal('ADMITTED'), sequence: positiveU64, ...journalCommon,
  intentRecordSha256: digest, filesDurableRecordSha256: digest,
  admissionReceiptSha256: digest, recordSha256: digest,
}).strict();
const journalSchema = z.discriminatedUnion('state', [intentSchema, filesDurableSchema, admittedSchema]);

const admissionSchema = z.object({
  format: z.literal('darshan-recovery-credential-admission-v1'),
  status: z.literal('FULLY_ENROLLED'), operationId: uuid, generation: positiveU64,
  targetHandle: targetAuthorityHandleSchema, authorityHandle: targetAuthorityHandleSchema,
  scopeSemanticSha256: digest, scopeWireSha256: digest, intentRecordSha256: digest,
  filesDurableRecordSha256: digest, allocationIdentitySha256: digest,
  allocationLedgerHeadSha256: digest, credentialPolicySha256: digest,
  requestSha256: digest, authorizationSha256: digest, authorityInstanceSha256: digest,
  descriptors: z.tuple([descriptorSchema, descriptorSchema, descriptorSchema]),
  receiptSha256: digest,
}).strict();

const profileV3Schema = z.object({
  format: z.literal('darshan-recovery-target-native-engine-profile-v3'),
  baseProfileV2Sha256: digest,
  enrollment: z.discriminatedUnion('status', [
    z.object({ status: z.literal('UNAVAILABLE'), credentialAdmissionReceiptSha256: z.null(),
      credentials: z.tuple([]), dispatchEnabled: z.literal(false) }).strict(),
    z.object({ status: z.literal('FULLY_ENROLLED'), credentialAdmissionReceiptSha256: digest,
      credentials: z.tuple([descriptorSchema, descriptorSchema, descriptorSchema]),
      dispatchEnabled: z.literal(false) }).strict(),
  ]),
}).strict();

const resourceAdmissionV2Schema = z.object({
  format: z.literal('darshan-recovery-target-resource-admission-v2'),
  targetHandle: targetAuthorityHandleSchema, generation: positiveU64,
  profileV3Sha256: digest, credentialStatus: z.enum(['UNAVAILABLE', 'FULLY_ENROLLED']),
  credentialAdmissionReceiptSha256: digest.nullable(),
  credentialDescriptors: z.array(descriptorSchema).max(3),
  materializationEnabled: z.literal(false), lifecycleEnabled: z.literal(false),
}).strict();

export type CredentialProvisionScopeV1 = z.infer<typeof scopeSchema>;
export type CredentialDescriptorIdentityV1 = z.infer<typeof descriptorSchema>;
export type CredentialProvisionJournalV1 = z.infer<typeof journalSchema>;
export type CredentialAdmissionV1 = z.infer<typeof admissionSchema>;
export type TargetNativeEngineProfileV3 = z.infer<typeof profileV3Schema>;
export type TargetResourceAdmissionV2 = z.infer<typeof resourceAdmissionV2Schema>;

function validateDescriptors(values: readonly CredentialDescriptorIdentityV1[]): void {
  if (values.map((entry) => entry.role).join(',') !== TARGET_CREDENTIAL_ROLES.join(',') ||
      new Set(values.map((entry) => entry.authorityHandle)).size !== values.length ||
      new Set(values.map((entry) => `${entry.deviceMajor}:${entry.deviceMinor}:${entry.inode}:${entry.mountId}`)).size !== values.length) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Credential descriptors are incomplete, reordered, aliased, or duplicated.');
  }
  values.forEach((entry) => {
    const expectedOwner = entry.role === 'POSTGRES_PASSWORD' ? '999' : '1000';
    if (entry.ownerUid !== expectedOwner || entry.ownerGid !== expectedOwner ||
        entry.descriptorIdentitySha256 !== credentialDescriptorIdentityV1Sha256(entry)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Credential descriptor owner or derived physical identity is impossible.');
    }
  });
}
export function credentialDescriptorIdentityV1Sha256(value: Omit<CredentialDescriptorIdentityV1, 'descriptorIdentitySha256'> | CredentialDescriptorIdentityV1): string {
  const fields = [
    ['domain', 'darshan-recovery-credential-descriptor-v1'], ['role', value.role],
    ['authority_handle', value.authorityHandle], ['device_major', value.deviceMajor], ['device_minor', value.deviceMinor],
    ['inode', value.inode], ['mount_id', value.mountId], ['owner_uid', value.ownerUid], ['owner_gid', value.ownerGid], ['mode', value.mode],
  ] as const;
  return createHash('sha256').update(Buffer.from(`${fields.map(([key, item]) => `${key}=${item}`).join('\n')}\n`, 'utf8')).digest('hex');
}
function recordBody(record: CredentialProvisionJournalV1): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'recordSha256'));
}
function admissionBody(record: CredentialAdmissionV1): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'receiptSha256'));
}
function encode<T>(value: T, schema: z.ZodType<T>, label: string, validate?: (parsed: T) => void): Buffer {
  const parsed = schema.parse(value); validate?.(parsed); const bytes = canonicalJson(parsed);
  if (bytes.byteLength > TARGET_CREDENTIAL_CONTRACT_MAX_BYTES) throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', `${label} exceeds 64 KiB.`);
  return bytes;
}
function parse<T>(bytes: Uint8Array, schema: z.ZodType<T>, label: string, validate?: (parsed: T) => void): T {
  try {
    const source = Buffer.from(bytes); const parsed = schema.parse(parseStrictJson(source, TARGET_CREDENTIAL_CONTRACT_MAX_BYTES));
    validate?.(parsed); if (!encode(parsed, schema, label, validate).equals(source)) throw new Error('noncanonical'); return parsed;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', `${label} is not strict canonical bounded JSON.`, { cause });
  }
}

export function encodeCredentialProvisionScopeV1(value: CredentialProvisionScopeV1): Buffer {
  return encode(value, scopeSchema, 'Credential provision scope v1');
}
export function parseCredentialProvisionScopeV1(bytes: Uint8Array): CredentialProvisionScopeV1 {
  return parse(bytes, scopeSchema, 'Credential provision scope v1');
}
function semanticFields(scope: CredentialProvisionScopeV1): readonly [string, string][] {
  return [
    ['domain', 'darshan-recovery-credential-provision-scope-semantic-v1'], ['operation', scope.operation],
    ['operation_id', scope.operationId], ['generation', scope.generation.padStart(20, '0')],
    ['target_handle', scope.targetHandle], ['authority_target_handle', scope.authorityTargetHandle],
    ['authority_handle', scope.authorityHandle], ['profile_v2_sha256', scope.profileV2Sha256],
    ['precredential_template_sha256', scope.precredentialTemplateSha256],
    ['allocation_identity_sha256', scope.allocationIdentitySha256],
    ['allocation_ledger_head_sha256', scope.allocationLedgerHeadSha256],
    ['authorization_sha256', scope.authorizationSha256], ['outer_envelope_sha256', scope.outerEnvelopeSha256],
    ['credential_policy_sha256', scope.credentialPolicySha256], ['authority_instance_sha256', scope.authorityInstanceSha256],
    ['supervisor_generation', scope.supervisorGeneration.padStart(20, '0')], ['challenge_nonce', scope.challengeNonce],
    ['deadline_unix_ms', scope.deadlineUnixMs.padStart(20, '0')], ['previous_journal_head_sha256', scope.previousJournalHeadSha256],
    ['postgres_password_handle', scope.roles[0].authorityHandle],
    ['minio_root_password_handle', scope.roles[1].authorityHandle], ['minio_root_user_handle', scope.roles[2].authorityHandle],
  ];
}
export function encodeCredentialProvisionScopeSemanticV1(value: CredentialProvisionScopeV1): Buffer {
  const scope = parseCredentialProvisionScopeV1(encodeCredentialProvisionScopeV1(value));
  return Buffer.from(`${semanticFields(scope).map(([key, item]) => `${key}=${item}`).join('\n')}\n`, 'utf8');
}
export function credentialProvisionScopeV1Sha256(value: CredentialProvisionScopeV1 | Uint8Array): string {
  const scope = value instanceof Uint8Array ? parseCredentialProvisionScopeV1(value) : value;
  return createHash('sha256').update(encodeCredentialProvisionScopeSemanticV1(scope)).digest('hex');
}

const WIRE_DOMAIN = 'darshan-recovery-credential-provision-scope-wire-v1';
export function encodeCredentialProvisionScopeWireV1(value: CredentialProvisionScopeV1): Buffer {
  const scope = parseCredentialProvisionScopeV1(encodeCredentialProvisionScopeV1(value));
  const fields: readonly [string, string][] = [
    ['domain', WIRE_DOMAIN], ['operation', scope.operation], ['operation_id', scope.operationId],
    ['scope_semantic_sha256', credentialProvisionScopeV1Sha256(scope)],
    ['generation', scope.generation.padStart(20, '0')], ['target_handle', scope.targetHandle],
    ['authority_target_handle', scope.authorityTargetHandle],
    ['authority_handle', scope.authorityHandle], ['profile_v2_sha256', scope.profileV2Sha256],
    ['precredential_template_sha256', scope.precredentialTemplateSha256],
    ['allocation_identity_sha256', scope.allocationIdentitySha256],
    ['allocation_ledger_head_sha256', scope.allocationLedgerHeadSha256],
    ['authorization_sha256', scope.authorizationSha256], ['outer_envelope_sha256', scope.outerEnvelopeSha256],
    ['credential_policy_sha256', scope.credentialPolicySha256], ['authority_instance_sha256', scope.authorityInstanceSha256],
    ['supervisor_generation', scope.supervisorGeneration.padStart(20, '0')], ['challenge_nonce', scope.challengeNonce],
    ['deadline_unix_ms', scope.deadlineUnixMs.padStart(20, '0')],
    ['previous_journal_head_sha256', scope.previousJournalHeadSha256],
    ['postgres_password_handle', scope.roles[0].authorityHandle],
    ['minio_root_password_handle', scope.roles[1].authorityHandle],
    ['minio_root_user_handle', scope.roles[2].authorityHandle],
  ];
  const wire = Buffer.from(`${fields.map(([key, item]) => `${key}=${item}`).join('\n')}\n`, 'utf8');
  if (wire.byteLength > 4096) throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Credential scope wire exceeds 4 KiB.');
  return wire;
}
export function credentialProvisionScopeWireV1Sha256(value: CredentialProvisionScopeV1 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? Buffer.from(value) : encodeCredentialProvisionScopeWireV1(value);
  return createHash('sha256').update(Buffer.from(`${WIRE_DOMAIN}\0`, 'utf8')).update(bytes).digest('hex');
}

function validateJournal(record: CredentialProvisionJournalV1): void {
  if (createHash('sha256').update(canonicalJson(recordBody(record))).digest('hex') !== record.recordSha256) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Credential journal self-hash differs.');
  }
  if (record.state === 'FILES_DURABLE') validateDescriptors(record.descriptors);
}
export function encodeCredentialProvisionJournalV1(value: CredentialProvisionJournalV1): Buffer {
  return encode(value, journalSchema, 'Credential provision journal v1', validateJournal);
}
export function parseCredentialProvisionJournalV1(bytes: Uint8Array): CredentialProvisionJournalV1 {
  return parse(bytes, journalSchema, 'Credential provision journal v1', validateJournal);
}
export function credentialProvisionJournalRecordSha256(value: Omit<CredentialProvisionJournalV1, 'recordSha256'>): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
function validateAdmission(record: CredentialAdmissionV1): void {
  validateDescriptors(record.descriptors);
  if (createHash('sha256').update(canonicalJson(admissionBody(record))).digest('hex') !== record.receiptSha256) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Credential admission receipt self-hash differs.');
  }
}
export function encodeCredentialAdmissionV1(value: CredentialAdmissionV1): Buffer {
  return encode(value, admissionSchema, 'Credential admission v1', validateAdmission);
}
export function parseCredentialAdmissionV1(bytes: Uint8Array): CredentialAdmissionV1 {
  return parse(bytes, admissionSchema, 'Credential admission v1', validateAdmission);
}
export function credentialAdmissionV1Sha256(value: CredentialAdmissionV1 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeCredentialAdmissionV1(parseCredentialAdmissionV1(value)) : encodeCredentialAdmissionV1(value);
  return createHash('sha256').update(bytes).digest('hex');
}
export function encodeTargetNativeEngineProfileV3(value: TargetNativeEngineProfileV3): Buffer {
  return encode(value, profileV3Schema, 'Native engine profile v3', (profile) => {
    if (profile.enrollment.status === 'FULLY_ENROLLED') validateDescriptors(profile.enrollment.credentials);
  });
}
export function parseTargetNativeEngineProfileV3(bytes: Uint8Array): TargetNativeEngineProfileV3 {
  return parse(bytes, profileV3Schema, 'Native engine profile v3', (profile) => {
    if (profile.enrollment.status === 'FULLY_ENROLLED') validateDescriptors(profile.enrollment.credentials);
  });
}
export function targetNativeEngineProfileV3Sha256(value: TargetNativeEngineProfileV3): string {
  return createHash('sha256').update(encodeTargetNativeEngineProfileV3(value)).digest('hex');
}
export function encodeTargetResourceAdmissionV2(value: TargetResourceAdmissionV2): Buffer {
  return encode(value, resourceAdmissionV2Schema, 'Resource admission v2', (admission) => {
    const enrolled = admission.credentialStatus === 'FULLY_ENROLLED';
    if (enrolled !== (admission.credentialAdmissionReceiptSha256 !== null) ||
        (enrolled ? admission.credentialDescriptors.length !== 3 : admission.credentialDescriptors.length !== 0)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Resource admission credential availability is contradictory.');
    }
    if (enrolled) validateDescriptors(admission.credentialDescriptors);
  });
}
export function parseTargetResourceAdmissionV2(bytes: Uint8Array): TargetResourceAdmissionV2 {
  return parse(bytes, resourceAdmissionV2Schema, 'Resource admission v2', (admission) => {
    const enrolled = admission.credentialStatus === 'FULLY_ENROLLED';
    if (enrolled !== (admission.credentialAdmissionReceiptSha256 !== null) ||
        (enrolled ? admission.credentialDescriptors.length !== 3 : admission.credentialDescriptors.length !== 0)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Resource admission credential availability is contradictory.');
    }
    if (enrolled) validateDescriptors(admission.credentialDescriptors);
  });
}
