import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { targetAuthorityHandleSchema } from './target-engine-contracts';

export const TARGET_NATIVE_ENGINE_CONTRACT_MAX_BYTES = 256 * 1024;
export const TARGET_NATIVE_ENGINE_OPERATIONS = [
  'INSPECT_TARGET', 'ENSURE_INTERNAL_NETWORK', 'CREATE_POSTGRES', 'CREATE_MINIO',
] as const;
export const TARGET_NATIVE_ENGINE_ROLES = ['NETWORK', 'POSTGRES', 'MINIO'] as const;
export const TARGET_NATIVE_ENGINE_REJECTED_B1_OPERATIONS = [
  'START_POSTGRES', 'START_MINIO', 'BOOTSTRAP_POSTGRES', 'BOOTSTRAP_MINIO',
  'VERIFY_READY', 'STOP_POSTGRES', 'STOP_MINIO', 'REMOVE_POSTGRES', 'REMOVE_MINIO',
  'REMOVE_INTERNAL_NETWORK', 'PURGE',
] as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const nullableDigest = digest.nullable();
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const u64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).superRefine((value, context) => {
  if (BigInt(value) > 0xffff_ffff_ffff_ffffn) context.addIssue({ code: z.ZodIssueCode.custom, message: 'u64 overflow' });
});
const positiveU64 = u64.refine((value) => value !== '0', 'must be positive');
const safeName = z.string().regex(/^darshan-recovery-(?:postgres|minio|internal)-[a-f0-9]{16}$/);
const fixedAssetName = z.enum(['POSTGRES_CONFIG', 'MINIO_CONFIG', 'POSTGRES_BOOTSTRAP', 'MINIO_BOOTSTRAP']);

const descriptorIdentitySchema = z.object({
  authorityHandle: targetAuthorityHandleSchema,
  identitySha256: digest,
  deviceMajor: u64,
  deviceMinor: u64,
  inode: positiveU64,
  mountId: positiveU64,
  ownerUid: u64,
  ownerGid: u64,
  mode: z.string().regex(/^0[0-7]{3}$/),
  allocationLedgerHeadSha256: digest,
}).strict();

const assetSchema = z.object({
  role: fixedAssetName,
  authorityHandle: targetAuthorityHandleSchema,
  contentSha256: nullableDigest,
  descriptorIdentitySha256: nullableDigest,
  destination: z.enum([
    '/etc/darshan-recovery/postgresql.conf', '/etc/darshan-recovery/minio.env',
    '/opt/darshan-recovery/bootstrap/postgres', '/opt/darshan-recovery/bootstrap/minio',
  ]),
  ownerUid: u64,
  ownerGid: u64,
  mode: z.enum(['0400', '0440', '0500']),
  sourceState: z.enum(['FRESH', 'COMPLETE', 'PARTIAL']),
  dispatchEnabled: z.literal(false),
}).strict();

const imageSchema = z.object({
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  imageConfigSha256: nullableDigest,
  repositoryDigest: z.string().regex(/^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/).nullable(),
  platform: z.literal('linux'),
  architecture: z.literal('amd64'),
  operatingSystem: z.literal('linux'),
  declaredVolumes: z.tuple([]),
}).strict();

const resourcesSchema = z.object({
  memoryBytes: positiveU64, memorySwapBytes: positiveU64,
  cpuQuotaMicros: positiveU64, cpuPeriodMicros: z.literal('100000'),
  cpuShares: positiveU64, pidsLimit: positiveU64, shmBytes: positiveU64,
  oomKillDisable: z.literal(false), oomScoreAdj: z.number().int().min(-1000).max(1000),
}).strict();
const securitySchema = z.object({
  readonlyRootfs: z.literal(true), privileged: z.literal(false),
  capAdd: z.tuple([]), capDrop: z.tuple([z.literal('ALL')]), noNewPrivileges: z.literal(true),
  seccompSha256: nullableDigest, lsmProfileSha256: nullableDigest,
  pidMode: z.literal('private'), ipcMode: z.literal('private'), utsMode: z.literal('private'),
  usernsMode: z.literal('private'), cgroupnsMode: z.literal('private'),
  devices: z.tuple([]), deviceRequests: z.tuple([]), supplementaryGroups: z.tuple([]),
}).strict();
const tmpfsSchema = z.object({
  destination: z.enum(['/tmp', '/run/postgresql']),
  options: z.literal('rw,nosuid,nodev,noexec,size=67108864,mode=1777'),
}).strict();
const loggingSchema = z.object({
  driver: z.literal('local'), maxSize: z.literal('10m'), maxFiles: z.literal('3'), compress: z.literal(true),
}).strict();
const bindSchema = descriptorIdentitySchema.extend({
  destination: z.enum(['/var/lib/postgresql/data', '/data']),
  readOnly: z.literal(false), propagation: z.literal('rprivate'), retained: z.literal(true),
}).strict();
const credentialSchema = descriptorIdentitySchema.extend({
  destination: z.enum(['/run/credentials/postgres-password', '/run/credentials/minio-root-user',
    '/run/credentials/minio-root-password']),
  admittedReference: z.literal(true), valuePresent: z.literal(false), readOnly: z.literal(true),
}).strict();

const commonContainer = {
  containerAuthorityHandle: targetAuthorityHandleSchema,
  name: safeName,
  image: imageSchema,
  numericUid: u64, numericGid: u64,
  workdir: z.enum(['/var/lib/postgresql/data', '/data']),
  bind: bindSchema,
  security: securitySchema,
  resources: resourcesSchema,
  logging: loggingSchema,
  restartPolicy: z.literal('no'), autoRemove: z.literal(false),
  tmpfs: z.array(tmpfsSchema).min(1).max(2),
  labels: z.object({ owner: z.literal('darshan-recovery'),
    contract: z.literal('target-native-engine-profile-v2'), managed: z.literal('true') }).strict(),
};
const postgresSchema = z.object({
  role: z.literal('POSTGRES'), ...commonContainer,
  entrypoint: z.tuple([z.literal('/usr/local/bin/docker-entrypoint.sh')]),
  argv: z.tuple([z.literal('postgres'), z.literal('-c'),
    z.literal('config_file=/etc/darshan-recovery/postgresql.conf')]),
  environment: z.tuple([
    z.object({ name: z.literal('LANG'), value: z.literal('C.UTF-8') }).strict(),
    z.object({ name: z.literal('POSTGRES_DB'), value: z.literal('darshan') }).strict(),
    z.object({ name: z.literal('POSTGRES_PASSWORD_FILE'), value: z.literal('/run/credentials/postgres-password') }).strict(),
    z.object({ name: z.literal('POSTGRES_USER'), value: z.literal('darshan') }).strict(),
  ]),
  credentials: z.tuple([credentialSchema]),
}).strict();
const minioSchema = z.object({
  role: z.literal('MINIO'), ...commonContainer,
  entrypoint: z.tuple([z.literal('/usr/bin/minio')]),
  argv: z.tuple([z.literal('server'), z.literal('/data'), z.literal('--console-address'), z.literal(':9001')]),
  environment: z.tuple([
    z.object({ name: z.literal('MINIO_ROOT_PASSWORD_FILE'), value: z.literal('/run/credentials/minio-root-password') }).strict(),
    z.object({ name: z.literal('MINIO_ROOT_USER_FILE'), value: z.literal('/run/credentials/minio-root-user') }).strict(),
  ]),
  credentials: z.tuple([credentialSchema, credentialSchema]),
}).strict();

const profileSchema = z.object({
  format: z.literal('darshan-recovery-target-native-engine-profile-v2'),
  profileId: uuid,
  authorityHandle: targetAuthorityHandleSchema,
  enrollmentAvailability: z.literal('UNAVAILABLE'),
  executable: z.object({
    authorityHandle: targetAuthorityHandleSchema,
    fixedPath: z.literal('/usr/bin/docker'),
    contentSha256: nullableDigest,
    syntheticFixtureSha256: nullableDigest,
    elfMachine: z.literal('X86_64'),
    fixtureCompileGate: z.literal('RECOVERY_TARGET_ENGINE_EXECUTOR_TESTING'),
  }).strict(),
  clientConfig: z.object({
    authorityHandle: targetAuthorityHandleSchema,
    fixedPath: z.literal('/var/lib/darshan-recovery/docker-client'),
    identitySha256: nullableDigest,
    ownerUid: u64, ownerGid: u64, mode: z.literal('0700'),
  }).strict(),
  daemon: z.object({
    transport: z.literal('UNIX'), socketAuthorityHandle: targetAuthorityHandleSchema,
    socketIdentitySha256: nullableDigest, daemonIdentitySha256: nullableDigest,
    apiVersion: z.literal('1.44'), serverVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/).nullable(),
  }).strict(),
  network: z.object({
    networkAuthorityHandle: targetAuthorityHandleSchema, name: safeName,
    driver: z.literal('bridge'), internal: z.literal(true), attachable: z.literal(false),
    ingress: z.literal(false), enableIpv6: z.literal(false), subnetCidr: z.literal('172.31.255.0/24'),
    gatewayAddress: z.literal('172.31.255.1'), postgresAddress: z.literal('172.31.255.10'),
    minioAddress: z.literal('172.31.255.11'),
  }).strict(),
  containers: z.tuple([postgresSchema, minioSchema]),
  assets: z.tuple([assetSchema, assetSchema, assetSchema, assetSchema]),
}).strict();

const lifecycleBindingSchema = z.object({
  installationId: uuid, siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  hostInstallationId: uuid, operationId: uuid, generation: positiveU64,
  targetSetId: digest, targetHandle: targetAuthorityHandleSchema,
  outerEnvelopeSha256: digest, requestSha256: digest, authorizationSha256: digest,
  profileSha256: digest, enrollmentSha256: digest, admissionSha256: digest,
  authorityInstanceSha256: digest, authorityDeadlineUnixMs: positiveU64, supervisorGeneration: positiveU64,
}).strict();

const handleMapEntrySchema = z.object({
  role: z.enum(['PROFILE', 'EXECUTABLE', 'CLIENT_CONFIG', 'DAEMON_SOCKET', 'NETWORK', 'POSTGRES', 'MINIO',
    'POSTGRES_BIND', 'MINIO_BIND', 'POSTGRES_PASSWORD', 'MINIO_ROOT_PASSWORD', 'MINIO_ROOT_USER',
    'POSTGRES_CONFIG', 'MINIO_CONFIG', 'POSTGRES_BOOTSTRAP', 'MINIO_BOOTSTRAP']),
  authorityHandle: targetAuthorityHandleSchema,
  identitySha256: digest,
  admitted: z.literal(true),
}).strict();

const commandSchema = z.object({
  format: z.literal('darshan-recovery-target-native-engine-command-v3'),
  commandId: uuid, operation: z.enum(TARGET_NATIVE_ENGINE_OPERATIONS),
  role: z.enum(TARGET_NATIVE_ENGINE_ROLES).nullable(),
  authorityHandle: targetAuthorityHandleSchema, targetHandle: targetAuthorityHandleSchema,
  binding: lifecycleBindingSchema,
  resourceAuthorityHandle: targetAuthorityHandleSchema,
  commandNonce: z.string().regex(/^[a-f0-9]{32}$/),
  materializationHeadSha256: digest,
  deadlineUnixMs: positiveU64,
}).strict();

const inspectionResourceSchema = z.object({
  role: z.enum(TARGET_NATIVE_ENGINE_ROLES),
  authorityHandle: targetAuthorityHandleSchema,
  state: z.enum(['ABSENT', 'CREATED', 'STOPPED', 'RUNNING', 'ERROR']),
  configuration: z.enum(['MATCH', 'MISMATCH', 'INCOMPLETE']),
  readiness: z.literal('NOT_EVALUATED'),
  resourceId: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/).nullable(),
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  imageConfigSha256: nullableDigest,
  effectiveConfigurationSha256: nullableDigest,
  ownerLabelsSha256: nullableDigest,
  consumerIds: z.array(digest).max(8),
  daemonIdentitySha256: nullableDigest,
  errorSha256: nullableDigest,
}).strict();
const inspectionSchema = z.object({
  format: z.literal('darshan-recovery-target-native-engine-inspect-v2'),
  targetHandle: targetAuthorityHandleSchema,
  binding: lifecycleBindingSchema,
  observedAt: z.string().datetime({ offset: false }),
  observationComplete: z.boolean(), absenceReliable: z.boolean(),
  enumerationComplete: z.object({ containers: z.boolean(), networks: z.boolean(),
    mounts: z.boolean(), consumers: z.boolean(), daemon: z.boolean() }).strict(),
  network: inspectionResourceSchema,
  postgres: inspectionResourceSchema,
  minio: inspectionResourceSchema,
}).strict();
const inspectionV3Schema = z.object({
  ...inspectionSchema.shape,
  format: z.literal('darshan-recovery-target-native-engine-inspect-v3'),
  command: z.object({
    commandSha256: digest,
    operation: z.enum(TARGET_NATIVE_ENGINE_OPERATIONS),
    role: z.enum(TARGET_NATIVE_ENGINE_ROLES).nullable(),
    resourceAuthorityHandle: targetAuthorityHandleSchema,
    commandNonce: z.string().regex(/^[a-f0-9]{32}$/),
    materializationHeadSha256: digest,
  }).strict(),
}).strict();

export type TargetNativeEngineProfileV2 = z.infer<typeof profileSchema>;
export type TargetNativeEngineLifecycleBindingV2 = z.infer<typeof lifecycleBindingSchema>;
export type TargetNativeEngineHandleMapEntryV2 = z.infer<typeof handleMapEntrySchema>;
export type TargetNativeEngineCommandV3 = z.infer<typeof commandSchema>;
export type TargetNativeEngineInspectionV2 = z.infer<typeof inspectionSchema>;
export type TargetNativeEngineInspectionV3 = z.infer<typeof inspectionV3Schema>;
export type TargetNativeEngineOperationV2 = typeof TARGET_NATIVE_ENGINE_OPERATIONS[number];

function validateProfile(profile: TargetNativeEngineProfileV2): void {
  const [postgres, minio] = profile.containers;
  const assetOrder = profile.assets.map((asset) => asset.role).join(',');
  const handles = [profile.authorityHandle, profile.executable.authorityHandle, profile.clientConfig.authorityHandle,
    profile.daemon.socketAuthorityHandle, profile.network.networkAuthorityHandle,
    ...profile.containers.flatMap((container) => [container.containerAuthorityHandle, container.bind.authorityHandle,
      ...container.credentials.map((credential) => credential.authorityHandle)]),
    ...profile.assets.map((asset) => asset.authorityHandle)];
  if (new Set(handles).size !== handles.length || assetOrder !==
      'POSTGRES_CONFIG,MINIO_CONFIG,POSTGRES_BOOTSTRAP,MINIO_BOOTSTRAP' ||
      !postgres.name.startsWith('darshan-recovery-postgres-') || !minio.name.startsWith('darshan-recovery-minio-') ||
      !profile.network.name.startsWith('darshan-recovery-internal-') ||
      postgres.credentials[0].destination !== '/run/credentials/postgres-password' ||
      minio.credentials[0].destination !== '/run/credentials/minio-root-password' ||
      minio.credentials[1].destination !== '/run/credentials/minio-root-user') {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Native engine profile is not the complete fixed v2 shape.');
  }
  const mappedDescriptors = profile.containers.flatMap((container) => [container.bind, ...container.credentials]);
  const physicalKeys = mappedDescriptors.map((descriptor) =>
    `${descriptor.deviceMajor}:${descriptor.deviceMinor}:${descriptor.inode}:${descriptor.mountId}`);
  if (new Set(mappedDescriptors.map((descriptor) => descriptor.identitySha256)).size !== mappedDescriptors.length ||
      new Set(physicalKeys).size !== physicalKeys.length) {
    throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE',
      'Native engine bind and credential descriptors must be physically disjoint.');
  }
  if (profile.executable.syntheticFixtureSha256 && profile.executable.contentSha256) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Synthetic fixture identity cannot be a production executable default.');
  }
  for (const container of profile.containers) {
    if (BigInt(container.resources.memorySwapBytes) < BigInt(container.resources.memoryBytes) ||
        container.bind.ownerUid !== container.numericUid || container.bind.ownerGid !== container.numericGid ||
        container.credentials.some((credential) => credential.ownerUid !== container.numericUid ||
          credential.ownerGid !== container.numericGid)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Native engine resource ownership is incoherent.');
    }
  }
}

function validateCommand(command: TargetNativeEngineCommandV3): void {
  const expectedRole = command.operation === 'INSPECT_TARGET' ? null : command.operation === 'ENSURE_INTERNAL_NETWORK'
    ? 'NETWORK' : command.operation === 'CREATE_POSTGRES' ? 'POSTGRES' : 'MINIO';
  if (command.role !== expectedRole || command.targetHandle !== command.binding.targetHandle ||
      BigInt(command.deadlineUnixMs) > BigInt(command.binding.authorityDeadlineUnixMs)) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native engine operation/role/target binding differs.');
  }
}

function validateInspectionV3(value: TargetNativeEngineInspectionV3): void {
  validateInspection({ ...value, format: 'darshan-recovery-target-native-engine-inspect-v2' });
  const expectedRole = value.command.operation === 'INSPECT_TARGET' ? null :
    value.command.operation === 'ENSURE_INTERNAL_NETWORK' ? 'NETWORK' :
    value.command.operation === 'CREATE_POSTGRES' ? 'POSTGRES' : 'MINIO';
  const selected = expectedRole === 'NETWORK' ? value.network : expectedRole === 'POSTGRES' ? value.postgres :
    expectedRole === 'MINIO' ? value.minio : undefined;
  if (value.command.role !== expectedRole || selected && selected.authorityHandle !== value.command.resourceAuthorityHandle) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Native engine inspection command role or resource handle differs.');
  }
}

function validateInspection(value: TargetNativeEngineInspectionV2): void {
  const resources = [value.network, value.postgres, value.minio];
  if (resources.map((entry) => entry.role).join(',') !== 'NETWORK,POSTGRES,MINIO' ||
      value.absenceReliable && (!value.observationComplete ||
        Object.values(value.enumerationComplete).some((complete) => !complete) ||
        resources.some((resource) => resource.state !== 'ABSENT'))) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native engine reliable absence is not complete.');
  }
  for (const resource of resources) {
    const absent = resource.state === 'ABSENT';
    if (absent !== (resource.resourceId === null) || absent &&
        [resource.imageId, resource.imageConfigSha256, resource.effectiveConfigurationSha256,
          resource.ownerLabelsSha256, resource.daemonIdentitySha256, resource.errorSha256]
          .some((entry) => entry !== null) || resource.state !== 'ERROR' && resource.errorSha256 !== null) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native engine resource state invents or omits identity.');
    }
  }
}

function encode<T>(value: T, schema: z.ZodType<T>, label: string, validate?: (parsed: T) => void): Buffer {
  const parsed = schema.parse(value); validate?.(parsed); const bytes = canonicalJson(parsed);
  if (bytes.byteLength > TARGET_NATIVE_ENGINE_CONTRACT_MAX_BYTES) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', `${label} exceeds its reviewed bound.`);
  }
  return bytes;
}
function parse<T>(bytes: Uint8Array, schema: z.ZodType<T>, label: string, validate?: (parsed: T) => void): T {
  try {
    const source = Buffer.from(bytes); const parsed = schema.parse(parseStrictJson(source, TARGET_NATIVE_ENGINE_CONTRACT_MAX_BYTES));
    validate?.(parsed); if (!encode(parsed, schema, label, validate).equals(source)) throw new Error('noncanonical'); return parsed;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', `${label} is not strict canonical bounded JSON.`, { cause });
  }
}

export function encodeTargetNativeEngineProfileV2(value: TargetNativeEngineProfileV2): Buffer {
  return encode(value, profileSchema, 'Native engine profile v2', validateProfile);
}
export function parseTargetNativeEngineProfileV2(bytes: Uint8Array): TargetNativeEngineProfileV2 {
  return parse(bytes, profileSchema, 'Native engine profile v2', validateProfile);
}
export function targetNativeEngineProfileV2Sha256(value: TargetNativeEngineProfileV2 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeTargetNativeEngineProfileV2(parseTargetNativeEngineProfileV2(value))
    : encodeTargetNativeEngineProfileV2(value);
  return createHash('sha256').update(bytes).digest('hex');
}
export function parseTargetNativeEngineHandleMapV2(value: unknown): readonly TargetNativeEngineHandleMapEntryV2[] {
  const parsed = z.array(handleMapEntrySchema).length(16).parse(value);
  const roles = parsed.map((entry) => entry.role);
  if (new Set(roles).size !== roles.length || new Set(parsed.map((entry) => entry.authorityHandle)).size !== parsed.length) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Native engine handle map is incomplete, duplicate, or role-confused.');
  }
  return Object.freeze(parsed.map((entry) => Object.freeze(entry)));
}
export function encodeTargetNativeEngineCommandV3(value: TargetNativeEngineCommandV3): Buffer {
  return encode(value, commandSchema, 'Native engine command v3', validateCommand);
}
export function parseTargetNativeEngineCommandV3(bytes: Uint8Array): TargetNativeEngineCommandV3 {
  return parse(bytes, commandSchema, 'Native engine command v3', validateCommand);
}
export function targetNativeEngineCommandV3Sha256(value: TargetNativeEngineCommandV3 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeTargetNativeEngineCommandV3(parseTargetNativeEngineCommandV3(value))
    : encodeTargetNativeEngineCommandV3(value);
  return createHash('sha256').update(bytes).digest('hex');
}
export function encodeTargetNativeEngineInspectionV2(value: TargetNativeEngineInspectionV2): Buffer {
  return encode(value, inspectionSchema, 'Native engine inspection v2', validateInspection);
}
export function parseTargetNativeEngineInspectionV2(bytes: Uint8Array): TargetNativeEngineInspectionV2 {
  return parse(bytes, inspectionSchema, 'Native engine inspection v2', validateInspection);
}
export function targetNativeEngineInspectionV2Sha256(value: TargetNativeEngineInspectionV2 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeTargetNativeEngineInspectionV2(parseTargetNativeEngineInspectionV2(value))
    : encodeTargetNativeEngineInspectionV2(value);
  return createHash('sha256').update(bytes).digest('hex');
}
export function encodeTargetNativeEngineInspectionV3(value: TargetNativeEngineInspectionV3): Buffer {
  return encode(value, inspectionV3Schema, 'Native engine inspection v3', validateInspectionV3);
}
export function parseTargetNativeEngineInspectionV3(bytes: Uint8Array): TargetNativeEngineInspectionV3 {
  return parse(bytes, inspectionV3Schema, 'Native engine inspection v3', validateInspectionV3);
}
export function targetNativeEngineInspectionV3Sha256(value: TargetNativeEngineInspectionV3 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeTargetNativeEngineInspectionV3(parseTargetNativeEngineInspectionV3(value))
    : encodeTargetNativeEngineInspectionV3(value);
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertTargetNativeEngineB1Operation(value: string): asserts value is TargetNativeEngineOperationV2 {
  if ((TARGET_NATIVE_ENGINE_REJECTED_B1_OPERATIONS as readonly string[]).includes(value)) {
    throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE', `${value} is disabled until the b2 credential/readiness gate.`);
  }
  if (!(TARGET_NATIVE_ENGINE_OPERATIONS as readonly string[]).includes(value)) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native engine operation is outside the fixed allowlist.');
  }
}

