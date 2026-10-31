import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { encodeProtectedDockerInventoryV1, parseProtectedDockerInventoryV1,
  targetAuthorityHandleSchema, type ProtectedDockerInventoryV1,
  type TargetAuthorityHandle } from './target-engine-contracts';
import { encodeTargetDockerExecutionProfileV1, parseTargetDockerExecutionProfileV1,
  targetDockerExecutionProfileV1Sha256, type TargetDockerExecutionProfileV1 } from './target-docker-profile';

export const TARGET_DOCKER_EFFECTIVE_INSPECT_MAX_BYTES = 256 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const u64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/);
const boundedString = z.string().min(1).max(256);

const mountSchema = z.object({
  Type: z.enum(['BIND', 'CREDENTIAL_FILE_REF']),
  SourceAuthorityHandle: targetAuthorityHandleSchema,
  SourceIdentitySha256: digest,
  Destination: z.enum(['/var/lib/postgresql/data', '/data', '/run/credentials/postgres-password',
    '/run/credentials/minio-root-user', '/run/credentials/minio-root-password']),
  RW: z.boolean(),
  Propagation: z.literal('rprivate'),
  OwnerUid: u64,
  OwnerGid: u64,
  Mode: z.enum(['0400', '0700']),
}).strict();
const resourcesSchema = z.object({
  Memory: u64, MemorySwap: u64, CpuQuota: u64, CpuPeriod: u64, CpuShares: u64,
  PidsLimit: u64, ShmSize: u64, OomKillDisable: z.literal(false), OomScoreAdj: z.number().int().min(-1000).max(1000),
}).strict();
const endpointSchema = z.object({
  NetworkAuthorityHandle: targetAuthorityHandleSchema,
  NetworkID: digest,
  EndpointID: digest,
  IPAddress: z.string().ip({ version: 'v4' }),
  IPPrefixLen: z.literal(24),
  Gateway: z.string().ip({ version: 'v4' }),
  GlobalIPv6Address: z.literal(''),
  MacAddressSha256: digest,
  Aliases: z.array(boundedString).min(1).max(4),
}).strict();
const containerSchema = z.object({
  Role: z.enum(['POSTGRES', 'MINIO']),
  Id: digest,
  Name: boundedString,
  Image: imageId,
  Platform: z.literal('linux'),
  Architecture: z.literal('amd64'),
  ImageConfigSha256: digest,
  Path: boundedString,
  Args: z.array(boundedString).max(16),
  Config: z.object({
    Entrypoint: z.array(boundedString).max(8),
    Cmd: z.array(boundedString).max(16),
    User: z.string().regex(/^(?:0|[1-9][0-9]{0,19}):(?:0|[1-9][0-9]{0,19})$/),
    Env: z.array(boundedString).max(32),
    Labels: z.object({ owner: z.literal('darshan-recovery'),
      contract: z.literal('target-engine-execution-profile-v1'), managed: z.literal('true') }).strict(),
    WorkingDir: z.enum(['/var/lib/postgresql/data', '/data']),
    DeclaredVolumes: z.tuple([]),
    Healthcheck: z.object({
      Test: z.array(boundedString).min(2).max(4), Interval: u64, Timeout: u64, StartPeriod: u64, Retries: z.number().int(),
    }).strict(),
  }).strict(),
  Mounts: z.array(mountSchema).min(2).max(3),
  HostConfig: z.object({
    ReadonlyRootfs: z.literal(true),
    Tmpfs: z.array(z.object({ Destination: z.enum(['/tmp', '/run/postgresql']), Options: boundedString }).strict()).min(1).max(2),
    Privileged: z.literal(false),
    CapAdd: z.tuple([]), CapDrop: z.tuple([z.literal('ALL')]),
    SecurityOpt: z.tuple([z.literal('no-new-privileges'), boundedString, boundedString]),
    PidMode: z.literal('private'), IpcMode: z.literal('private'), UtsMode: z.literal('private'),
    UsernsMode: z.literal('private'), CgroupnsMode: z.literal('private'),
    Devices: z.tuple([]), DeviceRequests: z.tuple([]), GroupAdd: z.tuple([]),
    Resources: resourcesSchema,
    RestartPolicy: z.object({ Name: z.literal('no'), MaximumRetryCount: z.literal(0) }).strict(),
    AutoRemove: z.literal(false),
    LogConfig: z.object({ Type: z.literal('local'), Config: z.object({
      'max-size': z.literal('10m'), 'max-file': z.literal('3'), compress: z.literal('true'),
    }).strict() }).strict(),
    PortBindings: z.tuple([]),
    PublishAllPorts: z.literal(false),
    NetworkModeAuthorityHandle: targetAuthorityHandleSchema,
  }).strict(),
  NetworkSettings: z.object({
    Ports: z.tuple([]),
    Endpoint: endpointSchema,
  }).strict(),
  State: z.object({
    Status: z.literal('running'), Running: z.literal(true), Paused: z.literal(false),
    Restarting: z.literal(false), OOMKilled: z.literal(false), Dead: z.literal(false),
    ExitCode: z.literal(0), ErrorSha256: digest,
    Health: z.object({ Status: z.literal('healthy'), FailingStreak: z.literal(0),
      Policy: z.enum(['POSTGRES_READY_V1', 'MINIO_READY_V1']), LastOutputSha256: digest }).strict(),
  }).strict(),
}).strict();

const inspectSchema = z.object({
  format: z.literal('darshan-recovery-docker-effective-inspect-v1'),
  targetHandle: targetAuthorityHandleSchema,
  executionProfileSha256: digest,
  observationComplete: z.literal(true),
  enumerationComplete: z.object({ containers: z.literal(true), networkEndpoints: z.literal(true),
    mounts: z.literal(true), volumes: z.literal(true), ports: z.literal(true) }).strict(),
  containers: z.tuple([containerSchema, containerSchema]),
  network: z.object({
    NetworkAuthorityHandle: targetAuthorityHandleSchema,
    NetworkID: digest,
    Name: boundedString,
    Driver: z.literal('bridge'), Internal: z.literal(true), Attachable: z.literal(false),
    Ingress: z.literal(false), EnableIPv6: z.literal(false),
    SubnetCidr: z.literal('172.31.255.0/24'), Gateway: z.literal('172.31.255.1'),
    EndpointContainerIds: z.array(digest).length(2),
    ForeignConsumerContainerIds: z.tuple([]),
  }).strict(),
}).strict();

export type TargetDockerEffectiveInspectV1 = z.infer<typeof inspectSchema>;
export interface TargetDockerExpectedIdentityV1 {
  targetHandle: TargetAuthorityHandle;
  postgresContainerId: string;
  minioContainerId: string;
  networkId: string;
  postgresEndpointId: string;
  minioEndpointId: string;
  postgresMacAddressSha256: string;
  minioMacAddressSha256: string;
  postgresHealthOutputSha256: string;
  minioHealthOutputSha256: string;
}
export interface VerifiedTargetDockerInspectSummaryV1 {
  readonly format: 'darshan-recovery-docker-inspect-summary-v1';
  readonly targetHandle: TargetAuthorityHandle;
  readonly inspectionSha256: string;
  readonly executionProfileSha256: string;
  readonly containerIdentitySha256: readonly [string, string];
  readonly networkIdentitySha256: string;
  readonly health: 'HEALTHY';
}

export function encodeTargetDockerEffectiveInspectV1(value: TargetDockerEffectiveInspectV1): Buffer {
  const bytes = canonicalJson(inspectSchema.parse(value));
  if (bytes.byteLength > TARGET_DOCKER_EFFECTIVE_INSPECT_MAX_BYTES) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Effective Docker inspection exceeds 256 KiB.');
  }
  return bytes;
}
export function parseTargetDockerEffectiveInspectV1(bytes: Uint8Array): TargetDockerEffectiveInspectV1 {
  try {
    const source = Buffer.from(bytes);
    const value = inspectSchema.parse(parseStrictJson(source, TARGET_DOCKER_EFFECTIVE_INSPECT_MAX_BYTES));
    if (!encodeTargetDockerEffectiveInspectV1(value).equals(source)) throw new Error('non-canonical inspection');
    return value;
  } catch (cause) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID',
      'Effective Docker inspection is not strict canonical bounded JSON.', { cause });
  }
}

function same(actual: unknown, expected: unknown, label: string): void {
  if (!canonicalJson(actual).equals(canonicalJson(expected))) {
    throw new RecoveryError('RECOVERY_TARGET_CHANGED', `Effective Docker ${label} differs from the enrolled profile.`);
  }
}

function protectedOverlap(profile: TargetDockerExecutionProfileV1, inventory: ProtectedDockerInventoryV1): void {
  const targetHandles = new Set([profile.network.networkAuthorityHandle,
    ...profile.containers.flatMap((container) => [container.containerAuthorityHandle,
      ...container.binds.map((entry) => entry.sourceAuthorityHandle),
      ...container.credentials.map((entry) => entry.credentialAuthorityHandle)])]);
  const protectedHandles = new Set([
    ...inventory.containers.map((entry) => entry.authorityHandle), ...inventory.networks.map((entry) => entry.authorityHandle),
    ...inventory.volumes.map((entry) => entry.authorityHandle), ...inventory.bindRoots.map((entry) => entry.authorityHandle),
    ...inventory.identities.map((entry) => entry.authorityHandle),
  ]);
  const candidatePhysicalIdentities = new Set(profile.containers.flatMap((container) => [
    ...container.binds.map((entry) => entry.sourceIdentitySha256),
    ...container.credentials.map((entry) => entry.credentialIdentitySha256),
  ]));
  const protectedPhysicalIdentities = new Set([
    ...inventory.identities.map((entry) => entry.identitySha256),
    ...inventory.bindRoots.map((entry) => entry.identitySha256),
    ...inventory.volumes.map((entry) => entry.volumeIdentitySha256),
  ]);
  if ([...candidatePhysicalIdentities].some((identity) => protectedPhysicalIdentities.has(identity))) {
    throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE',
      'Target bind or credential physical identity equals a protected physical identity.');
  }
  const candidateRoles = new Map([
    ['TARGET_NETWORK', profile.network.networkAuthorityHandle],
    ['POSTGRES_CONTAINER', profile.containers[0].containerAuthorityHandle],
    ['MINIO_CONTAINER', profile.containers[1].containerAuthorityHandle],
    ['POSTGRES_BIND', profile.containers[0].binds[0].sourceAuthorityHandle],
    ['MINIO_BIND', profile.containers[1].binds[0].sourceAuthorityHandle],
    ['POSTGRES_PASSWORD_CREDENTIAL', profile.containers[0].credentials[0].credentialAuthorityHandle],
    ['MINIO_ROOT_PASSWORD_CREDENTIAL', profile.containers[1].credentials[0].credentialAuthorityHandle],
    ['MINIO_ROOT_USER_CREDENTIAL', profile.containers[1].credentials[1].credentialAuthorityHandle],
  ]);
  const overlap = [...targetHandles].some((handle) => protectedHandles.has(handle));
  if (overlap) throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE',
    'Target Docker resources overlap a protected identity, ancestor, or alias.');
  for (const relationship of inventory.relationships) {
    const candidate = relationship.source.domain === 'CANDIDATE' ? relationship.source
      : relationship.target.domain === 'CANDIDATE' ? relationship.target : undefined;
    if (!candidate) continue;
    if (candidateRoles.get(candidate.role) !== candidate.authorityHandle) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Protected relationship names an unknown or role-confused candidate target handle.');
    }
    throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE',
      `Target Docker candidate has a protected ${relationship.relation.toLowerCase()} relationship.`);
  }
}

function expectedMounts(container: TargetDockerExecutionProfileV1['containers'][number]) {
  return [...container.binds.map((entry) => ({ Type: 'BIND' as const,
    SourceAuthorityHandle: entry.sourceAuthorityHandle, SourceIdentitySha256: entry.sourceIdentitySha256,
    Destination: entry.destination, RW: !entry.readOnly, Propagation: entry.propagation,
    OwnerUid: container.numericUid, OwnerGid: container.numericGid, Mode: '0700' as const })),
  ...container.credentials.map((entry) => ({ Type: 'CREDENTIAL_FILE_REF' as const,
    SourceAuthorityHandle: entry.credentialAuthorityHandle, SourceIdentitySha256: entry.credentialIdentitySha256,
    Destination: entry.destination, RW: false as const, Propagation: 'rprivate' as const,
    OwnerUid: entry.ownerUid, OwnerGid: entry.ownerGid, Mode: entry.mode }))];
}

export function validateTargetDockerEffectiveInspectV1(input: {
  raw: Uint8Array;
  profile: TargetDockerExecutionProfileV1;
  protectedInventory: ProtectedDockerInventoryV1;
  expected: TargetDockerExpectedIdentityV1;
}): VerifiedTargetDockerInspectSummaryV1 {
  const profile = parseTargetDockerExecutionProfileV1(encodeTargetDockerExecutionProfileV1(input.profile));
  const protectedInventory = parseProtectedDockerInventoryV1(encodeProtectedDockerInventoryV1(input.protectedInventory));
  const inspection = parseTargetDockerEffectiveInspectV1(input.raw); protectedOverlap(profile, protectedInventory);
  const profileSha256 = targetDockerExecutionProfileV1Sha256(profile);
  const protectedContainerIds = new Set(protectedInventory.containers.map((entry) => entry.containerId));
  const protectedNetworkIds = new Set(protectedInventory.networks.map((entry) => entry.networkId));
  const protectedConsumerIds = [...protectedInventory.containers, ...protectedInventory.networks, ...protectedInventory.volumes,
    ...protectedInventory.bindRoots].flatMap((entry) => entry.consumerContainerIds);
  const enrolledProtectedContainerIds = new Set(protectedInventory.containers.map((entry) => entry.containerId));
  if (inspection.containers.some((entry) => protectedContainerIds.has(entry.Id)) ||
      protectedNetworkIds.has(inspection.network.NetworkID) ||
      protectedConsumerIds.some((id) => id === input.expected.postgresContainerId || id === input.expected.minioContainerId)) {
    throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE',
      'Effective target Docker IDs overlap protected production resources.');
  }
  if (protectedConsumerIds.some((id) => !enrolledProtectedContainerIds.has(id))) {
    throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE',
      'Protected resource consumer enumeration contains an unknown container.');
  }
  if (inspection.targetHandle !== input.expected.targetHandle || inspection.executionProfileSha256 !== profileSha256 ||
      inspection.network.NetworkID !== input.expected.networkId ||
      inspection.network.NetworkAuthorityHandle !== profile.network.networkAuthorityHandle) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Effective Docker inspection identity differs.');
  }
  const ids = [input.expected.postgresContainerId, input.expected.minioContainerId] as const;
  const endpointIds = [input.expected.postgresEndpointId, input.expected.minioEndpointId] as const;
  const macDigests = [input.expected.postgresMacAddressSha256, input.expected.minioMacAddressSha256] as const;
  const healthDigests = [input.expected.postgresHealthOutputSha256, input.expected.minioHealthOutputSha256] as const;
  for (let index = 0; index < 2; index += 1) {
    const actual = inspection.containers[index]!; const containerProfile = profile.containers[index]!;
    const expectedAddress = index === 0 ? profile.network.postgresAddress : profile.network.minioAddress;
    if (actual.Role !== containerProfile.role || actual.Id !== ids[index] || actual.Image !== containerProfile.image.imageId ||
        actual.ImageConfigSha256 !== containerProfile.image.configSha256 || actual.Name !== containerProfile.name ||
        actual.Path !== containerProfile.entrypoint[0] || actual.NetworkSettings.Endpoint.NetworkID !== input.expected.networkId ||
        actual.NetworkSettings.Endpoint.EndpointID !== endpointIds[index]) {
      throw new RecoveryError('RECOVERY_TARGET_CHANGED', 'Effective Docker container identity differs from enrollment.');
    }
    same(actual.Args, [...containerProfile.entrypoint.slice(1), ...containerProfile.argv], 'argv');
    same(actual.Config, { Entrypoint: [...containerProfile.entrypoint], Cmd: [...containerProfile.argv],
      User: `${containerProfile.numericUid}:${containerProfile.numericGid}`,
      Env: containerProfile.environment.map((entry) => `${entry.name}=${entry.value}`), Labels: containerProfile.labels,
      WorkingDir: containerProfile.workingDirectory, DeclaredVolumes: [], Healthcheck: {
        Test: containerProfile.healthcheck.policy === 'POSTGRES_READY_V1'
          ? ['CMD', '/usr/bin/pg_isready', '-U', 'darshan'] : ['CMD', '/usr/bin/mc', 'ready', 'local'],
        Interval: containerProfile.healthcheck.intervalNanoseconds, Timeout: containerProfile.healthcheck.timeoutNanoseconds,
        StartPeriod: containerProfile.healthcheck.startPeriodNanoseconds, Retries: containerProfile.healthcheck.retries,
      } }, 'configuration');
    same(actual.Mounts, expectedMounts(containerProfile), 'mounts');
    same(actual.HostConfig, { ReadonlyRootfs: true,
      Tmpfs: containerProfile.tmpfs.map((entry) => ({ Destination: entry.destination, Options: entry.options })),
      Privileged: false, CapAdd: [], CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges',
        `seccomp-sha256:${containerProfile.security.seccompSha256}`, `lsm-sha256:${containerProfile.security.lsmProfileSha256}`],
      PidMode: 'private', IpcMode: 'private', UtsMode: 'private', UsernsMode: 'private', CgroupnsMode: 'private',
      Devices: [], DeviceRequests: [], GroupAdd: [], Resources: { Memory: containerProfile.resources.memoryBytes,
        MemorySwap: containerProfile.resources.memorySwapBytes, CpuQuota: containerProfile.resources.cpuQuotaMicros,
        CpuPeriod: containerProfile.resources.cpuPeriodMicros, CpuShares: containerProfile.resources.cpuShares,
        PidsLimit: containerProfile.resources.pidsLimit, ShmSize: containerProfile.resources.shmBytes,
        OomKillDisable: false, OomScoreAdj: containerProfile.resources.oomScoreAdj },
      RestartPolicy: { Name: 'no', MaximumRetryCount: 0 }, AutoRemove: false,
      LogConfig: { Type: 'local', Config: { 'max-size': '10m', 'max-file': '3', compress: 'true' } },
      PortBindings: [], PublishAllPorts: false, NetworkModeAuthorityHandle: profile.network.networkAuthorityHandle,
    }, 'host configuration');
    same(actual.NetworkSettings.Endpoint, { NetworkAuthorityHandle: profile.network.networkAuthorityHandle,
      NetworkID: input.expected.networkId, EndpointID: endpointIds[index], IPAddress: expectedAddress, IPPrefixLen: 24,
      Gateway: profile.network.gatewayAddress, GlobalIPv6Address: '', MacAddressSha256: macDigests[index],
      Aliases: [containerProfile.name] }, 'endpoint');
    if (actual.State.Health.Policy !== containerProfile.healthcheck.policy ||
        actual.State.Health.LastOutputSha256 !== healthDigests[index]) {
      throw new RecoveryError('RECOVERY_TARGET_CHANGED', 'Effective Docker health policy differs.');
    }
  }
  same(inspection.network, { NetworkAuthorityHandle: profile.network.networkAuthorityHandle,
    NetworkID: input.expected.networkId, Name: profile.network.name, Driver: profile.network.driver,
    Internal: true, Attachable: false, Ingress: false, EnableIPv6: false,
    SubnetCidr: profile.network.subnetCidr, Gateway: profile.network.gatewayAddress,
    EndpointContainerIds: [...ids].sort(), ForeignConsumerContainerIds: [] }, 'network');
  const inspectionSha256 = createHash('sha256').update(input.raw).digest('hex');
  return Object.freeze({ format: 'darshan-recovery-docker-inspect-summary-v1', targetHandle: input.expected.targetHandle,
    inspectionSha256, executionProfileSha256: profileSha256,
    containerIdentitySha256: [createHash('sha256').update(ids[0]).digest('hex'),
      createHash('sha256').update(ids[1]).digest('hex')] as const,
    networkIdentitySha256: createHash('sha256').update(input.expected.networkId).digest('hex'), health: 'HEALTHY' });
}
