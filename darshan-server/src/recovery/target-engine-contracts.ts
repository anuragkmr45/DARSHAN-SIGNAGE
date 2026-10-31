import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';

export const TARGET_ENGINE_CONTRACT_MAX_BYTES = 128 * 1024;
export const TARGET_RESOURCE_COMMAND_OPERATIONS = [
  'INSPECT_TARGET', 'ENSURE_INTERNAL_NETWORK', 'CREATE_CONTAINER', 'START_CONTAINER',
  'STOP_CONTAINER', 'REMOVE_CONTAINER', 'REMOVE_INTERNAL_NETWORK',
] as const;
export const TARGET_RESOURCE_ROLES = ['NETWORK', 'POSTGRES', 'MINIO'] as const;
export const TARGET_LIFECYCLE_ACTIONS = ['PREPARE', 'STOP_RETAIN'] as const;
export const TARGET_LIFECYCLE_STEPS = [
  'ADMIT_EXISTING_RESOURCES', 'ENSURE_INTERNAL_NETWORK', 'CREATE_POSTGRES', 'CREATE_MINIO',
  'START_POSTGRES', 'START_MINIO', 'VERIFY_READY', 'STOP_MINIO', 'STOP_POSTGRES',
  'VERIFY_STOPPED_RETAINED',
] as const;

export const targetAuthorityHandleSchema = z.string()
  .regex(/^tra:v1:[a-z][a-z0-9-]{0,31}:[A-Za-z0-9_-]{16,96}$/);
export type TargetAuthorityHandle = z.infer<typeof targetAuthorityHandleSchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const u64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).superRefine((value, context) => {
  if (BigInt(value) > 0xffff_ffff_ffff_ffffn) context.addIssue({ code: z.ZodIssueCode.custom, message: 'u64 overflow' });
});

const identitySchema = z.object({
  authorityHandle: targetAuthorityHandleSchema,
  identitySha256: digest,
  deviceMajor: u64,
  deviceMinor: u64,
  inode: u64,
  mountId: u64,
}).strict();

const protectedContainerSchema = z.object({
  authorityHandle: targetAuthorityHandleSchema,
  containerId: digest,
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  state: z.enum(['CREATED', 'RUNNING', 'PAUSED', 'RESTARTING', 'EXITED', 'DEAD']),
  consumerContainerIds: z.array(digest).max(64),
}).strict();
const protectedNetworkSchema = z.object({
  authorityHandle: targetAuthorityHandleSchema,
  networkId: digest,
  internal: z.boolean(),
  consumerContainerIds: z.array(digest).max(64),
}).strict();
const protectedVolumeSchema = z.object({
  authorityHandle: targetAuthorityHandleSchema,
  volumeIdentitySha256: digest,
  consumerContainerIds: z.array(digest).max(64),
}).strict();
const protectedBindSchema = identitySchema.extend({
  consumerContainerIds: z.array(digest).max(64),
}).strict();
const protectedRelationshipRoleSchema = z.enum([
  'PROTECTED_CONTAINER', 'PROTECTED_NETWORK', 'PROTECTED_VOLUME', 'PROTECTED_BIND_ROOT',
  'REPOSITORY_ROOT', 'RELEASE_ROOT', 'CONFIG_ROOT', 'CONTROL_ROOT', 'DAEMON_SOCKET',
]);
const candidateRelationshipRoleSchema = z.enum([
  'TARGET_NETWORK', 'POSTGRES_CONTAINER', 'MINIO_CONTAINER', 'POSTGRES_BIND', 'MINIO_BIND',
  'POSTGRES_PASSWORD_CREDENTIAL', 'MINIO_ROOT_PASSWORD_CREDENTIAL', 'MINIO_ROOT_USER_CREDENTIAL',
]);
const relationshipEndpointSchema = z.discriminatedUnion('domain', [
  z.object({ domain: z.literal('PROTECTED'), role: protectedRelationshipRoleSchema,
    authorityHandle: targetAuthorityHandleSchema }).strict(),
  z.object({ domain: z.literal('CANDIDATE'), role: candidateRelationshipRoleSchema,
    authorityHandle: targetAuthorityHandleSchema }).strict(),
]);

const protectedInventorySchema = z.object({
  format: z.literal('darshan-recovery-protected-docker-inventory-v1'),
  inventoryId: uuid,
  authorityHandle: targetAuthorityHandleSchema,
  protectionInventoryEnvelopeSha256: digest,
  observedAt: z.string().datetime({ offset: false }),
  completeness: z.object({ containers: z.literal(true), networks: z.literal(true), volumes: z.literal(true),
    bindRoots: z.literal(true), identities: z.literal(true), relationships: z.literal(true) }).strict(),
  containers: z.array(protectedContainerSchema).max(128),
  networks: z.array(protectedNetworkSchema).max(128),
  volumes: z.array(protectedVolumeSchema).max(128),
  bindRoots: z.array(protectedBindSchema).max(128),
  identities: z.array(z.object({
    role: z.enum(['REPOSITORY_ROOT', 'RELEASE_ROOT', 'CONFIG_ROOT', 'CONTROL_ROOT', 'DAEMON_SOCKET']),
    ...identitySchema.shape,
  }).strict()).length(5),
  relationships: z.array(z.object({
    relation: z.enum(['ANCESTOR', 'ALIAS']),
    source: relationshipEndpointSchema,
    target: relationshipEndpointSchema,
  }).strict()).max(256),
}).strict();

const enrollmentSchema = z.object({
  format: z.literal('darshan-recovery-target-engine-enrollment-v1'),
  enrollmentId: uuid,
  authorityHandle: targetAuthorityHandleSchema,
  engineProfileEnvelopeSha256: digest,
  executionProfileSha256: digest,
  protectionInventoryEnvelopeSha256: digest,
  protectedDockerInventorySha256: digest,
}).strict();

const commandPlanSchema = z.object({
  format: z.literal('darshan-recovery-target-resource-command-plan-v1'),
  operation: z.enum(TARGET_RESOURCE_COMMAND_OPERATIONS),
  authorityHandle: targetAuthorityHandleSchema,
  targetHandle: targetAuthorityHandleSchema,
  resourceRole: z.enum(TARGET_RESOURCE_ROLES).nullable(),
}).strict();

const lifecycleBindingSchema = z.object({
  operationId: uuid,
  siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  hostInstallationId: uuid,
  planSha256: digest,
  targetSetId: digest,
  generation: z.number().int().positive().safe(),
  targetSpecificationSha256: digest,
  outerEnvelopeSha256: digest,
  authorizationSha256: digest,
  enrollmentSha256: digest,
  executionProfileSha256: digest,
  protectedInventorySha256: digest,
}).strict();

const resourceAdmissionSchema = z.object({
  format: z.literal('darshan-recovery-target-resource-admission-v1'),
  targetHandle: targetAuthorityHandleSchema,
  binding: lifecycleBindingSchema,
  complete: z.literal(true),
  allocation: z.object({
    allocationAuthorityHandle: targetAuthorityHandleSchema,
    allocationIdentitySha256: digest,
    allocationLedgerHeadSha256: digest,
    retained: z.literal(true),
  }).strict(),
  data: z.tuple([
    z.object({ role: z.literal('POSTGRES'), authorityHandle: targetAuthorityHandleSchema,
      identitySha256: digest, admitted: z.literal(true) }).strict(),
    z.object({ role: z.literal('MINIO'), authorityHandle: targetAuthorityHandleSchema,
      identitySha256: digest, admitted: z.literal(true) }).strict(),
  ]),
  credentials: z.tuple([
    z.object({ role: z.literal('POSTGRES_PASSWORD'), authorityHandle: targetAuthorityHandleSchema,
      identitySha256: digest, admitted: z.literal(true) }).strict(),
    z.object({ role: z.literal('MINIO_ROOT_PASSWORD'), authorityHandle: targetAuthorityHandleSchema,
      identitySha256: digest, admitted: z.literal(true) }).strict(),
    z.object({ role: z.literal('MINIO_ROOT_USER'), authorityHandle: targetAuthorityHandleSchema,
      identitySha256: digest, admitted: z.literal(true) }).strict(),
  ]),
}).strict();

const lifecycleCommandSchema = z.object({
  format: z.literal('darshan-recovery-target-lifecycle-command-v1'),
  commandId: uuid,
  action: z.enum(TARGET_LIFECYCLE_ACTIONS),
  step: z.enum(TARGET_LIFECYCLE_STEPS),
  authorityHandle: targetAuthorityHandleSchema,
  targetHandle: targetAuthorityHandleSchema,
  binding: lifecycleBindingSchema,
  expectedObservationSha256: digest,
  resourceAdmissionSha256: digest,
}).strict().superRefine((value, context) => {
  const prepare = TARGET_LIFECYCLE_STEPS.indexOf(value.step) <= TARGET_LIFECYCLE_STEPS.indexOf('VERIFY_READY');
  if ((value.action === 'PREPARE') !== prepare) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'action and fixed lifecycle step differ' });
  }
});

const lifecycleResultSchema = z.object({
  format: z.literal('darshan-recovery-target-lifecycle-result-v1'),
  commandSha256: digest,
  outcome: z.enum(['APPLIED', 'ALREADY_APPLIED', 'NOT_APPLIED', 'UNKNOWN']),
  effectPossible: z.boolean(),
  sanitizedCode: z.enum(['OK', 'RELIABLE_ABSENCE', 'INCOMPLETE', 'FOREIGN', 'CONFIG_MISMATCH', 'FAILED']),
}).strict().superRefine((value, context) => {
  if (value.outcome === 'NOT_APPLIED' && value.effectPossible) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'definite absence cannot claim a possible effect' });
  }
  if (value.outcome === 'UNKNOWN' && !value.effectPossible) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'unknown result must retain effect possibility' });
  }
});

const lifecycleResourceSchema = z.object({
  authorityHandle: targetAuthorityHandleSchema,
  identitySha256: digest,
  state: z.enum(['ABSENT', 'CREATED', 'RUNNING_HEALTHY', 'STOPPED', 'FOREIGN', 'INCOMPLETE']),
  configurationSha256: digest.nullable(),
}).strict();

const lifecycleObservationSchema = z.object({
  format: z.literal('darshan-recovery-target-lifecycle-observation-v1'),
  targetHandle: targetAuthorityHandleSchema,
  binding: lifecycleBindingSchema,
  observedAt: z.string().datetime({ offset: false }),
  complete: z.boolean(),
  absenceReliable: z.boolean(),
  resourceAdmissionSha256: digest,
  network: lifecycleResourceSchema,
  postgres: lifecycleResourceSchema,
  minio: lifecycleResourceSchema,
}).strict().superRefine((value, context) => {
  if (value.absenceReliable && (!value.complete || [value.network, value.postgres, value.minio]
    .some((resource) => resource.state !== 'ABSENT'))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'reliable absence must be complete and wholly absent' });
  }
});

export type ProtectedDockerInventoryV1 = z.infer<typeof protectedInventorySchema>;
export type TargetEngineEnrollmentV1 = z.infer<typeof enrollmentSchema>;
export type TargetResourceCommandPlanV1 = z.infer<typeof commandPlanSchema>;
export type TargetResourceCommandOperation = typeof TARGET_RESOURCE_COMMAND_OPERATIONS[number];
export type TargetResourceRole = typeof TARGET_RESOURCE_ROLES[number];
export type TargetLifecycleActionV1 = typeof TARGET_LIFECYCLE_ACTIONS[number];
export type TargetLifecycleStepV1 = typeof TARGET_LIFECYCLE_STEPS[number];
export type TargetLifecycleBindingV1 = z.infer<typeof lifecycleBindingSchema>;
export type TargetResourceAdmissionV1 = z.infer<typeof resourceAdmissionSchema>;
export type TargetLifecycleCommandV1 = z.infer<typeof lifecycleCommandSchema>;
export type TargetLifecycleResultV1 = z.infer<typeof lifecycleResultSchema>;
export type TargetLifecycleObservationV1 = z.infer<typeof lifecycleObservationSchema>;

function assertUniqueSorted(values: readonly string[], label: string): void {
  if (values.some((value, index) => index > 0 && values[index - 1]! >= value)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', `${label} is not unique canonical order.`);
  }
}

function validateInventory(value: ProtectedDockerInventoryV1): void {
  if (value.identities.map((entry) => entry.role).join(',') !==
      'REPOSITORY_ROOT,RELEASE_ROOT,CONFIG_ROOT,CONTROL_ROOT,DAEMON_SOCKET') {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Protected identities are not complete canonical role order.');
  }
  const keys = (entries: readonly { authorityHandle: string }[]) => entries.map((entry) => entry.authorityHandle);
  assertUniqueSorted(keys(value.containers), 'Protected containers');
  assertUniqueSorted(keys(value.networks), 'Protected networks');
  assertUniqueSorted(keys(value.volumes), 'Protected volumes');
  assertUniqueSorted(keys(value.bindRoots), 'Protected bind roots');
  for (const [label, values] of [['Protected container IDs', value.containers.map((entry) => entry.containerId)],
    ['Protected network IDs', value.networks.map((entry) => entry.networkId)],
    ['Protected volume identities', value.volumes.map((entry) => entry.volumeIdentitySha256)]] as const) {
    if (new Set(values).size !== values.length) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', `${label} must be unique.`);
    }
  }
  for (const entry of [...value.containers, ...value.networks, ...value.volumes, ...value.bindRoots]) {
    assertUniqueSorted(entry.consumerContainerIds, 'Protected resource consumers');
  }
  const identityHandles = keys(value.identities);
  if (new Set(identityHandles).size !== identityHandles.length) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Protected identity handles must be unique.');
  }
  const relationshipKeys = value.relationships.map((entry) =>
    `${entry.relation}:${entry.source.domain}:${entry.source.role}:${entry.source.authorityHandle}:` +
    `${entry.target.domain}:${entry.target.role}:${entry.target.authorityHandle}`);
  assertUniqueSorted(relationshipKeys, 'Protected relationships');
  const protectedRoleHandles = new Map<string, Set<string>>([
    ['PROTECTED_CONTAINER', new Set(keys(value.containers))], ['PROTECTED_NETWORK', new Set(keys(value.networks))],
    ['PROTECTED_VOLUME', new Set(keys(value.volumes))], ['PROTECTED_BIND_ROOT', new Set(keys(value.bindRoots))],
    ...value.identities.map((entry) => [entry.role, new Set([entry.authorityHandle])] as const),
  ]);
  for (const relationship of value.relationships) {
    if (relationship.source.domain === 'CANDIDATE' && relationship.target.domain === 'CANDIDATE' ||
        relationship.source.authorityHandle === relationship.target.authorityHandle) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID',
        'Protected relationship cannot join two candidates or one handle to itself.');
    }
    for (const endpoint of [relationship.source, relationship.target]) {
      if (endpoint.domain === 'PROTECTED' && !protectedRoleHandles.get(endpoint.role)?.has(endpoint.authorityHandle)) {
        throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID',
          'Protected relationship endpoint is not enrolled for its exact role.');
      }
    }
  }
}

function encode<T>(value: T, schema: z.ZodType<T>, label: string, validate?: (parsed: T) => void): Buffer {
  const parsed = schema.parse(value); validate?.(parsed); const bytes = canonicalJson(parsed);
  if (bytes.byteLength > TARGET_ENGINE_CONTRACT_MAX_BYTES) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', `${label} exceeds its reviewed bound.`);
  }
  return bytes;
}

function parse<T>(bytes: Uint8Array, schema: z.ZodType<T>, label: string, validate?: (parsed: T) => void): T {
  try {
    const source = Buffer.from(bytes);
    const value = schema.parse(parseStrictJson(source, TARGET_ENGINE_CONTRACT_MAX_BYTES)); validate?.(value);
    if (!encode(value, schema, label, validate).equals(source)) throw new Error('non-canonical JSON');
    return value;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', `${label} is not strict canonical bounded JSON.`, { cause });
  }
}

export function encodeProtectedDockerInventoryV1(value: ProtectedDockerInventoryV1): Buffer {
  return encode(value, protectedInventorySchema, 'Protected Docker inventory v1', validateInventory);
}
export function parseProtectedDockerInventoryV1(bytes: Uint8Array): ProtectedDockerInventoryV1 {
  return parse(bytes, protectedInventorySchema, 'Protected Docker inventory v1', validateInventory);
}
export function protectedDockerInventoryV1Sha256(value: ProtectedDockerInventoryV1 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeProtectedDockerInventoryV1(parseProtectedDockerInventoryV1(value))
    : encodeProtectedDockerInventoryV1(value);
  return createHash('sha256').update(bytes).digest('hex');
}
export function encodeTargetEngineEnrollmentV1(value: TargetEngineEnrollmentV1): Buffer {
  return encode(value, enrollmentSchema, 'Target engine enrollment v1');
}
export function parseTargetEngineEnrollmentV1(bytes: Uint8Array): TargetEngineEnrollmentV1 {
  return parse(bytes, enrollmentSchema, 'Target engine enrollment v1');
}
export function planTargetResourceCommand(input: {
  operation: TargetResourceCommandOperation;
  authorityHandle: TargetAuthorityHandle;
  targetHandle: TargetAuthorityHandle;
  resourceRole?: TargetResourceRole | null;
}): TargetResourceCommandPlanV1 {
  const role = input.resourceRole ?? null;
  const needsRole = input.operation !== 'INSPECT_TARGET';
  if (needsRole !== (role !== null) ||
      (input.operation === 'ENSURE_INTERNAL_NETWORK' || input.operation === 'REMOVE_INTERNAL_NETWORK') && role !== 'NETWORK' ||
      !['ENSURE_INTERNAL_NETWORK', 'REMOVE_INTERNAL_NETWORK', 'INSPECT_TARGET'].includes(input.operation) && role === 'NETWORK') {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target resource command role does not match its fixed operation.');
  }
  return commandPlanSchema.parse({ format: 'darshan-recovery-target-resource-command-plan-v1', ...input,
    resourceRole: role });
}

function encodeLifecycle<T>(value: T, schema: z.ZodType<T>, label: string): Buffer {
  return encode(value, schema, label);
}

function parseLifecycle<T>(bytes: Uint8Array, schema: z.ZodType<T>, label: string): T {
  return parse(bytes, schema, label);
}

export function encodeTargetResourceAdmissionV1(value: TargetResourceAdmissionV1): Buffer {
  return encodeLifecycle(value, resourceAdmissionSchema, 'Target resource admission v1');
}
export function parseTargetResourceAdmissionV1(bytes: Uint8Array): TargetResourceAdmissionV1 {
  return parseLifecycle(bytes, resourceAdmissionSchema, 'Target resource admission v1');
}
export function targetResourceAdmissionV1Sha256(value: TargetResourceAdmissionV1 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeTargetResourceAdmissionV1(parseTargetResourceAdmissionV1(value))
    : encodeTargetResourceAdmissionV1(value);
  return createHash('sha256').update(bytes).digest('hex');
}
export function encodeTargetLifecycleCommandV1(value: TargetLifecycleCommandV1): Buffer {
  return encodeLifecycle(value, lifecycleCommandSchema, 'Target lifecycle command v1');
}
export function parseTargetLifecycleCommandV1(bytes: Uint8Array): TargetLifecycleCommandV1 {
  return parseLifecycle(bytes, lifecycleCommandSchema, 'Target lifecycle command v1');
}
export function targetLifecycleCommandV1Sha256(value: TargetLifecycleCommandV1 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeTargetLifecycleCommandV1(parseTargetLifecycleCommandV1(value))
    : encodeTargetLifecycleCommandV1(value);
  return createHash('sha256').update(bytes).digest('hex');
}
export function encodeTargetLifecycleResultV1(value: TargetLifecycleResultV1): Buffer {
  return encodeLifecycle(value, lifecycleResultSchema, 'Target lifecycle result v1');
}
export function parseTargetLifecycleResultV1(bytes: Uint8Array): TargetLifecycleResultV1 {
  return parseLifecycle(bytes, lifecycleResultSchema, 'Target lifecycle result v1');
}
export function targetLifecycleResultV1Sha256(value: TargetLifecycleResultV1 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeTargetLifecycleResultV1(parseTargetLifecycleResultV1(value))
    : encodeTargetLifecycleResultV1(value);
  return createHash('sha256').update(bytes).digest('hex');
}
export function encodeTargetLifecycleObservationV1(value: TargetLifecycleObservationV1): Buffer {
  return encodeLifecycle(value, lifecycleObservationSchema, 'Target lifecycle observation v1');
}
export function parseTargetLifecycleObservationV1(bytes: Uint8Array): TargetLifecycleObservationV1 {
  return parseLifecycle(bytes, lifecycleObservationSchema, 'Target lifecycle observation v1');
}
export function targetLifecycleObservationV1Sha256(value: TargetLifecycleObservationV1 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeTargetLifecycleObservationV1(parseTargetLifecycleObservationV1(value))
    : encodeTargetLifecycleObservationV1(value);
  return createHash('sha256').update(bytes).digest('hex');
}
