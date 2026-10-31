import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { encodeProtectedDockerInventoryV1, parseProtectedDockerInventoryV1,
  protectedDockerInventoryV1Sha256, targetAuthorityHandleSchema,
  encodeTargetEngineEnrollmentV1, parseTargetEngineEnrollmentV1,
  type ProtectedDockerInventoryV1, type TargetEngineEnrollmentV1 } from './target-engine-contracts';
import { targetStorageEvidenceV2EnvelopeSha256,
  type SignedTargetStorageEvidenceV2 } from './target-storage-contracts-v2';

export const TARGET_DOCKER_EXECUTION_PROFILE_MAX_BYTES = 64 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const u64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).superRefine((value, context) => {
  if (BigInt(value) > 0xffff_ffff_ffff_ffffn) context.addIssue({ code: z.ZodIssueCode.custom, message: 'u64 overflow' });
});
const positiveU64 = u64.superRefine((value, context) => {
  if (BigInt(value) === 0n) context.addIssue({ code: z.ZodIssueCode.custom, message: 'must be positive' });
});
const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const fixedName = z.string().regex(/^darshan-recovery-(?:postgres|minio|internal)-[a-f0-9]{16}$/);

const resourcesSchema = z.object({
  memoryBytes: positiveU64,
  memorySwapBytes: positiveU64,
  cpuQuotaMicros: positiveU64,
  cpuPeriodMicros: z.literal('100000'),
  cpuShares: positiveU64,
  pidsLimit: positiveU64,
  shmBytes: positiveU64,
  oomKillDisable: z.literal(false),
  oomScoreAdj: z.number().int().min(-1000).max(1000),
}).strict();
const loggingSchema = z.object({
  driver: z.literal('local'),
  maxSize: z.literal('10m'),
  maxFiles: z.literal('3'),
  compress: z.literal(true),
}).strict();
const credentialSchema = z.object({
  credentialAuthorityHandle: targetAuthorityHandleSchema,
  credentialIdentitySha256: digest,
  destination: z.enum(['/run/credentials/postgres-password', '/run/credentials/minio-root-user',
    '/run/credentials/minio-root-password']),
  mode: z.literal('0400'),
  ownerUid: u64,
  ownerGid: u64,
}).strict();
const bindSchema = z.object({
  type: z.literal('BIND'),
  sourceAuthorityHandle: targetAuthorityHandleSchema,
  sourceIdentitySha256: digest,
  destination: z.enum(['/var/lib/postgresql/data', '/data']),
  readOnly: z.literal(false),
  propagation: z.literal('rprivate'),
}).strict();
const tmpfsSchema = z.object({
  destination: z.enum(['/tmp', '/run/postgresql']),
  options: z.literal('rw,nosuid,nodev,noexec,size=67108864,mode=1777'),
}).strict();
const healthSchema = z.object({
  policy: z.enum(['POSTGRES_READY_V1', 'MINIO_READY_V1']),
  intervalNanoseconds: z.literal('10000000000'),
  timeoutNanoseconds: z.literal('3000000000'),
  startPeriodNanoseconds: z.literal('30000000000'),
  retries: z.literal(12),
}).strict();
const imageSchema = z.object({
  imageId,
  platform: z.literal('linux'),
  architecture: z.literal('amd64'),
  configSha256: digest,
  declaredVolumes: z.tuple([]),
}).strict();
const securitySchema = z.object({
  readonlyRootfs: z.literal(true),
  capAdd: z.tuple([]),
  capDrop: z.tuple([z.literal('ALL')]),
  noNewPrivileges: z.literal(true),
  privileged: z.literal(false),
  seccompAuthorityHandle: targetAuthorityHandleSchema,
  seccompSha256: digest,
  lsmAuthorityHandle: targetAuthorityHandleSchema,
  lsmProfileSha256: digest,
  pidMode: z.literal('PRIVATE'),
  ipcMode: z.literal('PRIVATE'),
  utsMode: z.literal('PRIVATE'),
  usernsMode: z.literal('PRIVATE'),
  cgroupnsMode: z.literal('PRIVATE'),
  devices: z.tuple([]),
  deviceRequests: z.tuple([]),
  supplementaryGroups: z.tuple([]),
}).strict();

const commonContainer = {
  containerAuthorityHandle: targetAuthorityHandleSchema,
  name: fixedName,
  image: imageSchema,
  numericUid: u64,
  numericGid: u64,
  binds: z.array(bindSchema).length(1),
  tmpfs: z.array(tmpfsSchema).min(1).max(2),
  security: securitySchema,
  resources: resourcesSchema,
  logging: loggingSchema,
  restartPolicy: z.literal('no'),
  autoRemove: z.literal(false),
  healthcheck: healthSchema,
  labels: z.object({
    owner: z.literal('darshan-recovery'),
    contract: z.literal('target-engine-execution-profile-v1'),
    managed: z.literal('true'),
  }).strict(),
};
const postgresSchema = z.object({
  role: z.literal('POSTGRES'), ...commonContainer,
  entrypoint: z.tuple([z.literal('/usr/local/bin/docker-entrypoint.sh')]),
  argv: z.tuple([z.literal('postgres'), z.literal('-c'),
    z.literal('config_file=/etc/postgresql/postgresql.conf')]),
  workingDirectory: z.literal('/var/lib/postgresql/data'),
  environment: z.tuple([
    z.object({ name: z.literal('LANG'), value: z.literal('C.UTF-8') }).strict(),
    z.object({ name: z.literal('POSTGRES_DB'), value: z.literal('darshan') }).strict(),
    z.object({ name: z.literal('POSTGRES_PASSWORD_FILE'), value: z.literal('/run/credentials/postgres-password') }).strict(),
    z.object({ name: z.literal('POSTGRES_USER'), value: z.literal('darshan') }).strict(),
  ]),
  credentials: z.tuple([credentialSchema.refine((value) => value.destination === '/run/credentials/postgres-password')]),
}).strict();
const minioSchema = z.object({
  role: z.literal('MINIO'), ...commonContainer,
  entrypoint: z.tuple([z.literal('/usr/bin/minio')]),
  argv: z.tuple([z.literal('server'), z.literal('/data'), z.literal('--console-address'), z.literal(':9001')]),
  workingDirectory: z.literal('/data'),
  environment: z.tuple([
    z.object({ name: z.literal('MINIO_ROOT_PASSWORD_FILE'), value: z.literal('/run/credentials/minio-root-password') }).strict(),
    z.object({ name: z.literal('MINIO_ROOT_USER_FILE'), value: z.literal('/run/credentials/minio-root-user') }).strict(),
  ]),
  credentials: z.tuple([
    credentialSchema.refine((value) => value.destination === '/run/credentials/minio-root-password'),
    credentialSchema.refine((value) => value.destination === '/run/credentials/minio-root-user'),
  ]),
}).strict();

const profileSchema = z.object({
  format: z.literal('darshan-recovery-target-engine-execution-profile-v1'),
  profileId: uuid,
  authorityHandle: targetAuthorityHandleSchema,
  engineProfileEnvelopeSha256: digest,
  docker: z.object({
    executablePath: z.literal('/usr/bin/docker'),
    executableSha256: digest,
    protectedConfigDirectory: z.literal('/var/lib/darshan-recovery/docker-client'),
    transport: z.literal('UNIX'),
    daemonSocketIdentitySha256: digest,
    daemonIdentitySha256: digest,
    apiVersion: z.literal('1.44'),
  }).strict(),
  network: z.object({
    networkAuthorityHandle: targetAuthorityHandleSchema,
    name: fixedName,
    driver: z.literal('bridge'),
    internal: z.literal(true),
    attachable: z.literal(false),
    ingress: z.literal(false),
    enableIpv6: z.literal(false),
    subnetCidr: z.literal('172.31.255.0/24'),
    gatewayAddress: z.literal('172.31.255.1'),
    postgresAddress: z.literal('172.31.255.10'),
    minioAddress: z.literal('172.31.255.11'),
  }).strict(),
  containers: z.tuple([postgresSchema, minioSchema]),
}).strict();

export type TargetDockerExecutionProfileV1 = z.infer<typeof profileSchema>;

function validateProfile(value: TargetDockerExecutionProfileV1): void {
  const [postgres, minio] = value.containers;
  if (!postgres.name.startsWith('darshan-recovery-postgres-') || !minio.name.startsWith('darshan-recovery-minio-') ||
      !value.network.name.startsWith('darshan-recovery-internal-') ||
      postgres.binds[0].destination !== '/var/lib/postgresql/data' || minio.binds[0].destination !== '/data' ||
      postgres.healthcheck.policy !== 'POSTGRES_READY_V1' || minio.healthcheck.policy !== 'MINIO_READY_V1' ||
      postgres.tmpfs.map((item) => item.destination).join(',') !== '/run/postgresql,/tmp' ||
      minio.tmpfs.map((item) => item.destination).join(',') !== '/tmp' ||
      new Set([value.authorityHandle, value.network.networkAuthorityHandle,
        postgres.containerAuthorityHandle, minio.containerAuthorityHandle,
        postgres.binds[0].sourceAuthorityHandle, minio.binds[0].sourceAuthorityHandle,
        ...postgres.credentials.map((entry) => entry.credentialAuthorityHandle),
        ...minio.credentials.map((entry) => entry.credentialAuthorityHandle)]).size !== 9) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Docker execution profile is not the exact reviewed shape.');
  }
  for (const container of value.containers) {
    if (BigInt(container.resources.memorySwapBytes) < BigInt(container.resources.memoryBytes) ||
        BigInt(container.resources.cpuQuotaMicros) > BigInt(container.resources.cpuPeriodMicros) * 64n ||
        container.credentials.some((credential) => credential.ownerUid !== container.numericUid ||
          credential.ownerGid !== container.numericGid)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID',
        'Docker resource or credential ownership bounds are incoherent.');
    }
  }
}

export function encodeTargetDockerExecutionProfileV1(value: TargetDockerExecutionProfileV1): Buffer {
  const parsed = profileSchema.parse(value); validateProfile(parsed); const bytes = canonicalJson(parsed);
  if (bytes.byteLength > TARGET_DOCKER_EXECUTION_PROFILE_MAX_BYTES) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Docker execution profile exceeds 64 KiB.');
  }
  return bytes;
}
export function parseTargetDockerExecutionProfileV1(bytes: Uint8Array): TargetDockerExecutionProfileV1 {
  try {
    const source = Buffer.from(bytes);
    const value = profileSchema.parse(parseStrictJson(source, TARGET_DOCKER_EXECUTION_PROFILE_MAX_BYTES));
    validateProfile(value);
    if (!encodeTargetDockerExecutionProfileV1(value).equals(source)) throw new Error('non-canonical profile');
    return value;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID',
      'Docker execution profile is not strict canonical bounded JSON.', { cause });
  }
}
export function targetDockerExecutionProfileV1Sha256(value: TargetDockerExecutionProfileV1 | Uint8Array): string {
  const bytes = value instanceof Uint8Array
    ? encodeTargetDockerExecutionProfileV1(parseTargetDockerExecutionProfileV1(value))
    : encodeTargetDockerExecutionProfileV1(value);
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyTargetEngineEnrollmentV1(input: {
  enrollment: TargetEngineEnrollmentV1;
  profile: TargetDockerExecutionProfileV1;
  engineProfileEnvelope: SignedTargetStorageEvidenceV2;
  protectedInventory: ProtectedDockerInventoryV1;
  protectionInventoryEnvelope: SignedTargetStorageEvidenceV2;
}): void {
  const enrollment = parseTargetEngineEnrollmentV1(encodeTargetEngineEnrollmentV1(input.enrollment));
  const profile = parseTargetDockerExecutionProfileV1(encodeTargetDockerExecutionProfileV1(input.profile));
  const protectedInventory = parseProtectedDockerInventoryV1(encodeProtectedDockerInventoryV1(input.protectedInventory));
  const engineProfileEnvelopeSha256 = targetStorageEvidenceV2EnvelopeSha256(input.engineProfileEnvelope);
  const protectionInventoryEnvelopeSha256 = targetStorageEvidenceV2EnvelopeSha256(input.protectionInventoryEnvelope);
  if (input.engineProfileEnvelope.evidence.kind !== 'ENGINE_PROFILE' ||
      input.protectionInventoryEnvelope.evidence.kind !== 'PROTECTION_INVENTORY') {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Engine enrollment evidence kinds differ.');
  }
  const engineProfile = input.engineProfileEnvelope.evidence;
  const daemonSocket = protectedInventory.identities.find((entry) => entry.role === 'DAEMON_SOCKET');
  if (enrollment.authorityHandle !== profile.authorityHandle ||
      enrollment.authorityHandle !== protectedInventory.authorityHandle ||
      enrollment.engineProfileEnvelopeSha256 !== engineProfileEnvelopeSha256 ||
      profile.engineProfileEnvelopeSha256 !== engineProfileEnvelopeSha256 ||
      enrollment.executionProfileSha256 !== targetDockerExecutionProfileV1Sha256(profile) ||
      enrollment.protectionInventoryEnvelopeSha256 !== protectionInventoryEnvelopeSha256 ||
      protectedInventory.protectionInventoryEnvelopeSha256 !== protectionInventoryEnvelopeSha256 ||
      enrollment.protectedDockerInventorySha256 !== protectedDockerInventoryV1Sha256(protectedInventory) ||
      daemonSocket?.identitySha256 !== profile.docker.daemonSocketIdentitySha256 ||
      profile.containers[0].numericUid !== engineProfile.postgresUid ||
      profile.containers[0].numericGid !== engineProfile.postgresGid ||
      profile.containers[1].numericUid !== engineProfile.minioUid ||
      profile.containers[1].numericGid !== engineProfile.minioGid) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Engine enrollment differs from the exact full evidence envelopes or authority-enrolled records.');
  }
}
