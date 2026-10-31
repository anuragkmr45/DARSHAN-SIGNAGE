import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { recoverySourceDescriptorV2Digest, recoveryTargetSetIdV2, sha256RecoveryBytes,
  type RecoverySourceDescriptorV2 } from './contracts';
import { buildRecoveryPlanV4 } from './plan';
import { RELEASE_RECOVERY_TARGET } from './release-target';
import { ConstrainedRecoveryTargetEngine } from './target-constrained-engine';
import { targetAdmissionV2SigningPayload, targetAuthorizationV2BodySha256,
  targetDispositionV2SigningPayload, type RecoveryTargetAdmissionV2,
  type RecoveryTargetDispositionDecisionV2, type SignedRecoveryTargetAdmissionV2,
  type SignedRecoveryTargetDispositionV2 } from './target-contracts-v2';
import { RecoveryTargetAuthorizationGateway } from './target-authorization-envelope';
import { createTargetAuthorizationEnvelopeV2, encodeTargetAuthorizationEnvelopeV2,
  verifyTargetAuthorizationEnvelopeV2Locked } from './target-authorization-envelope-v2';
import { encodeProtectedDockerInventoryV1, encodeTargetLifecycleObservationV1,
  encodeTargetLifecycleResultV1, encodeTargetResourceAdmissionV1,
  protectedDockerInventoryV1Sha256, targetLifecycleCommandV1Sha256,
  targetResourceAdmissionV1Sha256, type ProtectedDockerInventoryV1,
  type TargetAuthorityHandle, type TargetEngineEnrollmentV1, type TargetLifecycleBindingV1,
  type TargetLifecycleCommandV1, type TargetLifecycleObservationV1,
  type TargetLifecycleResultV1, type TargetResourceAdmissionV1 } from './target-engine-contracts';
import { encodeTargetDockerEffectiveInspectV1, parseTargetDockerEffectiveInspectV1,
  type TargetDockerEffectiveInspectV1, type TargetDockerExpectedIdentityV1 } from './target-docker-inspect';
import { encodeTargetDockerExecutionProfileV1, parseTargetDockerExecutionProfileV1,
  targetDockerExecutionProfileV1Sha256, type TargetDockerExecutionProfileV1 } from './target-docker-profile';
import { TargetEngineJournal } from './target-engine-journal';
import type { TargetEngineJournalFaultStage } from './target-engine-journal';
import { TargetHelperJournal, type TargetHelperIdentity } from './target-helper-journal';
import { RecoveryTargetHelperService, TargetEngineEffectError } from './target-helper-service';
import { parseTargetHelperResponse, type TargetHelperRequest, type TargetHelperResponse } from './target-helper-protocol';
import { type TargetLifecycleResourceAuthority } from './target-resource-authority';
import { recoveryTargetLogicalIdentitySha256, recoveryTargetReleaseIdentitySha256,
  buildRecoveryTargetSpecificationV2, encodeRecoveryTargetSpecificationV2 } from './target-specification';
import { parseRecoveryTargetInstalledIdentity, requireEffectEligibleInstalledIdentity,
  type RecoveryTargetEngineCallContext, type RecoveryTargetInstalledIdentityV2,
  type VerifiedTargetStorageContextV2 } from './target-storage-authority';
import { encodeSignedTargetStorageEvidenceV2, targetStorageEvidenceV2EnvelopeSha256,
  targetStorageEvidenceV2SigningPayload, type SignedTargetStorageEvidenceV2,
  type TargetStorageEvidenceV2 } from './target-storage-contracts-v2';
import { ProtectedTargetStorageEvidenceLoaderV2 } from './target-storage-evidence-v2';
import { targetOperationAttestationEnvelopeSha256, targetOperationAttestationSigningPayload,
  type RecoveryTargetOperationAttestation, type SignedRecoveryTargetOperationAttestation } from './target-operation-attestation';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const digest = (label: string) => sha256RecoveryBytes(Buffer.from(`packet-05b1b3b1b:${label}`));
const h = (kind: string, suffix: string): TargetAuthorityHandle =>
  `tra:v1:${kind}:${suffix.padEnd(16, '0')}` as TargetAuthorityHandle;
const targetHandle = h('target', 'fixture');
const authorityHandle = h('authority', 'engine');
const profileHandle = h('profile', 'fixture');
const inventoryHandle = h('inventory', 'fixture');
const ids = { postgres: digest('postgres-id'), minio: digest('minio-id'), network: digest('network-id'),
  pgEndpoint: digest('postgres-endpoint'), minioEndpoint: digest('minio-endpoint') };

function signedEvidence(evidence: TargetStorageEvidenceV2,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): SignedTargetStorageEvidenceV2 {
  return { format: 'darshan-recovery-storage-evidence-envelope-v2', evidence,
    signature: { algorithm: 'Ed25519', keyId: 'evidence-authority',
      valueBase64: sign(null, targetStorageEvidenceV2SigningPayload(evidence), privateKey).toString('base64') } };
}

function profileFixture(engineProfileEnvelopeSha256: string): TargetDockerExecutionProfileV1 {
  const common = (role: 'POSTGRES' | 'MINIO') => ({
    containerAuthorityHandle: h('container', role === 'POSTGRES' ? 'postgres' : 'minio'),
    name: `darshan-recovery-${role.toLowerCase()}-0123456789abcdef`,
    image: { imageId: `sha256:${digest(`${role}-image`)}`, platform: 'linux', architecture: 'amd64',
      configSha256: digest(`${role}-config`), declaredVolumes: [] },
    numericUid: role === 'POSTGRES' ? '1101' : '1102', numericGid: role === 'POSTGRES' ? '1101' : '1102',
    binds: [{ type: 'BIND', sourceAuthorityHandle: h('allocation', role === 'POSTGRES' ? 'postgres' : 'minio'),
      sourceIdentitySha256: digest(`${role}-data`),
      destination: role === 'POSTGRES' ? '/var/lib/postgresql/data' : '/data', readOnly: false, propagation: 'rprivate' }],
    tmpfs: role === 'POSTGRES'
      ? [{ destination: '/run/postgresql', options: 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' },
        { destination: '/tmp', options: 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' }]
      : [{ destination: '/tmp', options: 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' }],
    security: { readonlyRootfs: true, capAdd: [], capDrop: ['ALL'], noNewPrivileges: true, privileged: false,
      seccompAuthorityHandle: h('policy', 'seccomp'), seccompSha256: digest('seccomp'),
      lsmAuthorityHandle: h('policy', 'lsm'), lsmProfileSha256: digest('lsm'), pidMode: 'PRIVATE', ipcMode: 'PRIVATE',
      utsMode: 'PRIVATE', usernsMode: 'PRIVATE', cgroupnsMode: 'PRIVATE', devices: [], deviceRequests: [], supplementaryGroups: [] },
    resources: { memoryBytes: '536870912', memorySwapBytes: '536870912', cpuQuotaMicros: '100000',
      cpuPeriodMicros: '100000', cpuShares: '1024', pidsLimit: '256', shmBytes: '67108864',
      oomKillDisable: false, oomScoreAdj: 0 },
    logging: { driver: 'local', maxSize: '10m', maxFiles: '3', compress: true }, restartPolicy: 'no', autoRemove: false,
    healthcheck: { policy: role === 'POSTGRES' ? 'POSTGRES_READY_V1' : 'MINIO_READY_V1',
      intervalNanoseconds: '10000000000', timeoutNanoseconds: '3000000000',
      startPeriodNanoseconds: '30000000000', retries: 12 },
    labels: { owner: 'darshan-recovery', contract: 'target-engine-execution-profile-v1', managed: 'true' },
  });
  return parseTargetDockerExecutionProfileV1(canonicalJson({
    format: 'darshan-recovery-target-engine-execution-profile-v1', profileId: randomUUID(), authorityHandle,
    engineProfileEnvelopeSha256,
    docker: { executablePath: '/usr/bin/docker', executableSha256: digest('docker'),
      protectedConfigDirectory: '/var/lib/darshan-recovery/docker-client', transport: 'UNIX',
      daemonSocketIdentitySha256: digest('socket'), daemonIdentitySha256: digest('daemon'), apiVersion: '1.44' },
    network: { networkAuthorityHandle: h('network', 'target'), name: 'darshan-recovery-internal-0123456789abcdef',
      driver: 'bridge', internal: true, attachable: false, ingress: false, enableIpv6: false,
      subnetCidr: '172.31.255.0/24', gatewayAddress: '172.31.255.1', postgresAddress: '172.31.255.10',
      minioAddress: '172.31.255.11' },
    containers: [
      { role: 'POSTGRES', ...common('POSTGRES'), entrypoint: ['/usr/local/bin/docker-entrypoint.sh'],
        argv: ['postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'], workingDirectory: '/var/lib/postgresql/data',
        environment: [{ name: 'LANG', value: 'C.UTF-8' }, { name: 'POSTGRES_DB', value: 'darshan' },
          { name: 'POSTGRES_PASSWORD_FILE', value: '/run/credentials/postgres-password' },
          { name: 'POSTGRES_USER', value: 'darshan' }],
        credentials: [{ credentialAuthorityHandle: h('credential', 'pg-password'),
          credentialIdentitySha256: digest('pg-password'), destination: '/run/credentials/postgres-password', mode: '0400',
          ownerUid: '1101', ownerGid: '1101' }] },
      { role: 'MINIO', ...common('MINIO'), entrypoint: ['/usr/bin/minio'],
        argv: ['server', '/data', '--console-address', ':9001'], workingDirectory: '/data',
        environment: [{ name: 'MINIO_ROOT_PASSWORD_FILE', value: '/run/credentials/minio-root-password' },
          { name: 'MINIO_ROOT_USER_FILE', value: '/run/credentials/minio-root-user' }],
        credentials: [{ credentialAuthorityHandle: h('credential', 'minio-password'),
          credentialIdentitySha256: digest('minio-password'), destination: '/run/credentials/minio-root-password', mode: '0400',
          ownerUid: '1102', ownerGid: '1102' },
        { credentialAuthorityHandle: h('credential', 'minio-user'), credentialIdentitySha256: digest('minio-user'),
          destination: '/run/credentials/minio-root-user', mode: '0400', ownerUid: '1102', ownerGid: '1102' }] },
    ],
  }));
}

function inventoryFixture(protectionInventoryEnvelopeSha256: string): ProtectedDockerInventoryV1 {
  return {
    format: 'darshan-recovery-protected-docker-inventory-v1', inventoryId: randomUUID(), authorityHandle,
    protectionInventoryEnvelopeSha256, observedAt: '2026-10-29T00:00:00.000Z',
    completeness: { containers: true, networks: true, volumes: true, bindRoots: true, identities: true, relationships: true },
    containers: [], networks: [], volumes: [], bindRoots: [],
    identities: [
      { role: 'REPOSITORY_ROOT', authorityHandle: h('protected', 'repository'), identitySha256: digest('repository'), deviceMajor: '8', deviceMinor: '1', inode: '10', mountId: '20' },
      { role: 'RELEASE_ROOT', authorityHandle: h('protected', 'release'), identitySha256: digest('release'), deviceMajor: '8', deviceMinor: '2', inode: '11', mountId: '21' },
      { role: 'CONFIG_ROOT', authorityHandle: h('protected', 'config'), identitySha256: digest('config'), deviceMajor: '8', deviceMinor: '3', inode: '12', mountId: '22' },
      { role: 'CONTROL_ROOT', authorityHandle: h('protected', 'control'), identitySha256: digest('control'), deviceMajor: '8', deviceMinor: '4', inode: '13', mountId: '23' },
      { role: 'DAEMON_SOCKET', authorityHandle: h('protected', 'socket'), identitySha256: digest('socket'), deviceMajor: '8', deviceMinor: '5', inode: '14', mountId: '24' },
    ], relationships: [],
  };
}

function effectiveContainer(profile: TargetDockerExecutionProfileV1['containers'][number], index: number) {
  const containerId = index === 0 ? ids.postgres : ids.minio; const endpointId = index === 0 ? ids.pgEndpoint : ids.minioEndpoint;
  const address = index === 0 ? '172.31.255.10' : '172.31.255.11';
  return { Role: profile.role, Id: containerId, Name: profile.name, Image: profile.image.imageId, Platform: 'linux',
    Architecture: 'amd64', ImageConfigSha256: profile.image.configSha256, Path: profile.entrypoint[0],
    Args: [...profile.entrypoint.slice(1), ...profile.argv], Config: { Entrypoint: [...profile.entrypoint], Cmd: [...profile.argv],
      User: `${profile.numericUid}:${profile.numericGid}`, Env: profile.environment.map((entry) => `${entry.name}=${entry.value}`),
      Labels: profile.labels, WorkingDir: profile.workingDirectory, DeclaredVolumes: [], Healthcheck: {
        Test: index === 0 ? ['CMD', '/usr/bin/pg_isready', '-U', 'darshan'] : ['CMD', '/usr/bin/mc', 'ready', 'local'],
        Interval: profile.healthcheck.intervalNanoseconds, Timeout: profile.healthcheck.timeoutNanoseconds,
        StartPeriod: profile.healthcheck.startPeriodNanoseconds, Retries: profile.healthcheck.retries } },
    Mounts: [...profile.binds.map((entry) => ({ Type: 'BIND', SourceAuthorityHandle: entry.sourceAuthorityHandle,
      SourceIdentitySha256: entry.sourceIdentitySha256, Destination: entry.destination, RW: true, Propagation: 'rprivate',
      OwnerUid: profile.numericUid, OwnerGid: profile.numericGid, Mode: '0700' })),
    ...profile.credentials.map((entry) => ({ Type: 'CREDENTIAL_FILE_REF', SourceAuthorityHandle: entry.credentialAuthorityHandle,
      SourceIdentitySha256: entry.credentialIdentitySha256, Destination: entry.destination, RW: false,
      Propagation: 'rprivate', OwnerUid: entry.ownerUid, OwnerGid: entry.ownerGid, Mode: entry.mode }))],
    HostConfig: { ReadonlyRootfs: true, Tmpfs: profile.tmpfs.map((entry) => ({ Destination: entry.destination,
      Options: entry.options })), Privileged: false, CapAdd: [], CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges',
      `seccomp-sha256:${profile.security.seccompSha256}`, `lsm-sha256:${profile.security.lsmProfileSha256}`],
      PidMode: 'private', IpcMode: 'private', UtsMode: 'private', UsernsMode: 'private', CgroupnsMode: 'private', Devices: [],
      DeviceRequests: [], GroupAdd: [], Resources: { Memory: profile.resources.memoryBytes, MemorySwap: profile.resources.memorySwapBytes,
        CpuQuota: profile.resources.cpuQuotaMicros, CpuPeriod: profile.resources.cpuPeriodMicros, CpuShares: profile.resources.cpuShares,
        PidsLimit: profile.resources.pidsLimit, ShmSize: profile.resources.shmBytes, OomKillDisable: false,
        OomScoreAdj: profile.resources.oomScoreAdj }, RestartPolicy: { Name: 'no', MaximumRetryCount: 0 }, AutoRemove: false,
      LogConfig: { Type: 'local', Config: { 'max-size': '10m', 'max-file': '3', compress: 'true' } }, PortBindings: [],
      PublishAllPorts: false, NetworkModeAuthorityHandle: h('network', 'target') },
    NetworkSettings: { Ports: [], Endpoint: { NetworkAuthorityHandle: h('network', 'target'), NetworkID: ids.network,
      EndpointID: endpointId, IPAddress: address, IPPrefixLen: 24, Gateway: '172.31.255.1', GlobalIPv6Address: '',
      MacAddressSha256: index === 0 ? digest('pg-mac') : digest('minio-mac'), Aliases: [profile.name] } },
    State: { Status: 'running', Running: true, Paused: false, Restarting: false, OOMKilled: false, Dead: false,
      ExitCode: 0, ErrorSha256: '0'.repeat(64), Health: { Status: 'healthy', FailingStreak: 0,
        Policy: profile.healthcheck.policy, LastOutputSha256: '0'.repeat(64) } } };
}

function inspectFixture(profile: TargetDockerExecutionProfileV1): TargetDockerEffectiveInspectV1 {
  return parseTargetDockerEffectiveInspectV1(canonicalJson({
    format: 'darshan-recovery-docker-effective-inspect-v1', targetHandle,
    executionProfileSha256: targetDockerExecutionProfileV1Sha256(profile), observationComplete: true,
    enumerationComplete: { containers: true, networkEndpoints: true, mounts: true, volumes: true, ports: true },
    containers: [effectiveContainer(profile.containers[0], 0), effectiveContainer(profile.containers[1], 1)],
    network: { NetworkAuthorityHandle: h('network', 'target'), NetworkID: ids.network,
      Name: 'darshan-recovery-internal-0123456789abcdef', Driver: 'bridge', Internal: true, Attachable: false,
      Ingress: false, EnableIPv6: false, SubnetCidr: '172.31.255.0/24', Gateway: '172.31.255.1',
      EndpointContainerIds: [ids.postgres, ids.minio], ForeignConsumerContainerIds: [] },
  }));
}

type ResourceState = TargetLifecycleObservationV1['network']['state'];

class TestOnlyStatefulLifecycleAuthority implements TargetLifecycleResourceAuthority {
  readonly testOnlyMarker = 'TEST_ONLY_DO_NOT_USE_IN_PRODUCTION' as const;
  binding!: TargetLifecycleBindingV1;
  network: ResourceState = 'ABSENT';
  postgres: ResourceState = 'ABSENT';
  minio: ResourceState = 'ABSENT';
  complete = true;
  absenceReliable = true;
  readonly calls: string[] = [];
  readonly commands: TargetLifecycleCommandV1[] = [];
  before?: (operation: string) => Promise<void> | void;
  result?: (command: TargetLifecycleCommandV1) => TargetLifecycleResultV1 | undefined;
  observation?: (value: TargetLifecycleObservationV1) => TargetLifecycleObservationV1;

  constructor(readonly profile: TargetDockerExecutionProfileV1, readonly inventory: ProtectedDockerInventoryV1,
    readonly allocationLedgerHeadSha256: string) {}

  private async enter(operation: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted(); this.calls.push(operation); await this.before?.(operation); signal?.throwIfAborted();
  }

  admission(): TargetResourceAdmissionV1 {
    return { format: 'darshan-recovery-target-resource-admission-v1', targetHandle, binding: this.binding, complete: true,
      allocation: { allocationAuthorityHandle: h('allocation', 'target'), allocationIdentitySha256: digest('allocation'),
        allocationLedgerHeadSha256: this.allocationLedgerHeadSha256, retained: true },
      data: [
        { role: 'POSTGRES', authorityHandle: this.profile.containers[0].binds[0].sourceAuthorityHandle,
          identitySha256: this.profile.containers[0].binds[0].sourceIdentitySha256, admitted: true },
        { role: 'MINIO', authorityHandle: this.profile.containers[1].binds[0].sourceAuthorityHandle,
          identitySha256: this.profile.containers[1].binds[0].sourceIdentitySha256, admitted: true },
      ],
      credentials: [
        { role: 'POSTGRES_PASSWORD', authorityHandle: this.profile.containers[0].credentials[0].credentialAuthorityHandle,
          identitySha256: this.profile.containers[0].credentials[0].credentialIdentitySha256, admitted: true },
        { role: 'MINIO_ROOT_PASSWORD', authorityHandle: this.profile.containers[1].credentials[0].credentialAuthorityHandle,
          identitySha256: this.profile.containers[1].credentials[0].credentialIdentitySha256, admitted: true },
        { role: 'MINIO_ROOT_USER', authorityHandle: this.profile.containers[1].credentials[1].credentialAuthorityHandle,
          identitySha256: this.profile.containers[1].credentials[1].credentialIdentitySha256, admitted: true },
      ] };
  }

  currentObservation(): TargetLifecycleObservationV1 {
    const configuration = (value: unknown) => sha256RecoveryBytes(canonicalJson(value));
    const resource = (authority: TargetAuthorityHandle, identity: string, state: ResourceState, expected: unknown) => ({
      authorityHandle: authority, identitySha256: identity, state,
      configurationSha256: state === 'ABSENT' ? null : configuration(expected),
    });
    const value: TargetLifecycleObservationV1 = {
      format: 'darshan-recovery-target-lifecycle-observation-v1', targetHandle, binding: this.binding,
      observedAt: '2026-10-29T01:00:00.000Z', complete: this.complete,
      absenceReliable: this.absenceReliable && [this.network, this.postgres, this.minio].every((state) => state === 'ABSENT'),
      resourceAdmissionSha256: targetResourceAdmissionV1Sha256(this.admission()),
      network: resource(this.profile.network.networkAuthorityHandle, digest('network-identity'), this.network, this.profile.network),
      postgres: resource(this.profile.containers[0].containerAuthorityHandle, digest('postgres-identity'), this.postgres,
        this.profile.containers[0]),
      minio: resource(this.profile.containers[1].containerAuthorityHandle, digest('minio-identity'), this.minio,
        this.profile.containers[1]),
    };
    return this.observation?.(value) ?? value;
  }

  applyForTest(command: TargetLifecycleCommandV1): void {
    if (command.step === 'ENSURE_INTERNAL_NETWORK') this.network = 'CREATED';
    else if (command.step === 'CREATE_POSTGRES') this.postgres = 'CREATED';
    else if (command.step === 'CREATE_MINIO') this.minio = 'CREATED';
    else if (command.step === 'START_POSTGRES') this.postgres = 'RUNNING_HEALTHY';
    else if (command.step === 'START_MINIO') this.minio = 'RUNNING_HEALTHY';
    else if (command.step === 'STOP_MINIO') this.minio = 'STOPPED';
    else if (command.step === 'STOP_POSTGRES') this.postgres = 'STOPPED';
  }

  async withLifecycleAuthority<T>(_target: TargetAuthorityHandle, signal: AbortSignal,
    callback: () => Promise<T>): Promise<T> {
    await this.enter('LOCK', signal); return callback();
  }
  async readExecutionProfile(_handle: TargetAuthorityHandle, signal?: AbortSignal): Promise<Uint8Array> {
    await this.enter('READ_EXECUTION_PROFILE', signal); return encodeTargetDockerExecutionProfileV1(this.profile);
  }
  async readProtectedInventory(_handle: TargetAuthorityHandle, signal?: AbortSignal): Promise<Uint8Array> {
    await this.enter('READ_PROTECTED_INVENTORY', signal); return encodeProtectedDockerInventoryV1(this.inventory);
  }
  async inspectTarget(_target: TargetAuthorityHandle, signal?: AbortSignal): Promise<Uint8Array> {
    await this.enter('INSPECT_TARGET', signal); return encodeTargetDockerEffectiveInspectV1(inspectFixture(this.profile));
  }
  async admitExistingResources(_target: TargetAuthorityHandle, signal: AbortSignal): Promise<Uint8Array> {
    await this.enter('ADMIT_EXISTING_RESOURCES', signal); return encodeTargetResourceAdmissionV1(this.admission());
  }
  async executeLifecycleCommand(command: TargetLifecycleCommandV1, signal: AbortSignal): Promise<Uint8Array> {
    await this.enter(`EXECUTE_${command.step}`, signal); this.commands.push(command);
    const injected = this.result?.(command);
    if (injected) return encodeTargetLifecycleResultV1(injected);
    this.applyForTest(command);
    return encodeTargetLifecycleResultV1({ format: 'darshan-recovery-target-lifecycle-result-v1',
      commandSha256: targetLifecycleCommandV1Sha256(command), outcome: 'APPLIED', effectPossible: true, sanitizedCode: 'OK' });
  }
  async observeLifecycle(_target: TargetAuthorityHandle, signal: AbortSignal): Promise<Uint8Array> {
    await this.enter('OBSERVE_LIFECYCLE', signal); return encodeTargetLifecycleObservationV1(this.currentObservation());
  }
}

interface Fixture {
  root: string;
  engineRoot: string;
  helperRoot: string;
  profile: TargetDockerExecutionProfileV1;
  inventory: ProtectedDockerInventoryV1;
  enrollment: TargetEngineEnrollmentV1;
  engineProfile: SignedTargetStorageEvidenceV2;
  protectionInventory: SignedTargetStorageEvidenceV2;
  authority: TestOnlyStatefulLifecycleAuthority;
  engine: ConstrainedRecoveryTargetEngine;
  identity: TargetHelperIdentity;
  request: TargetHelperRequest;
  requestBody: Buffer;
  context: RecoveryTargetEngineCallContext;
  storage: VerifiedTargetStorageContextV2;
  gateway: RecoveryTargetAuthorizationGateway;
  authorizationKeys: ReturnType<typeof generateKeyPairSync>;
  admission: SignedRecoveryTargetAdmissionV2;
  makeAdmissionRequest(operation: 'PREPARE' | 'INSPECT', expectedHelperSequence?: number | null): {
    request: TargetHelperRequest; body: Buffer; context: RecoveryTargetEngineCallContext; binding: TargetLifecycleBindingV1 };
  makeDispositionRequest(response: TargetHelperResponse, action: 'STOP_RETAIN' | 'RETIRE'): {
    request: TargetHelperRequest; body: Buffer; binding: TargetLifecycleBindingV1 };
  recreate(authority?: TestOnlyStatefulLifecycleAuthority): ConstrainedRecoveryTargetEngine;
  create(fault?: (stage: TargetEngineJournalFaultStage) => Promise<void>): ConstrainedRecoveryTargetEngine;
}

async function fixture(clock: () => Date = () => new Date('2026-10-29T01:00:00.000Z')): Promise<Fixture> {
  const root = await fs.mkdtemp(join(tmpdir(), 'recovery-constrained-engine-')); roots.push(root); await fs.chmod(root, 0o700);
  const evidenceRoot = join(root, 'evidence'); const helperRoot = join(root, 'helper'); const engineRoot = join(root, 'engine');
  await Promise.all([evidenceRoot, helperRoot, engineRoot].map(async (path) => { await fs.mkdir(path, { mode: 0o700 }); }));
  const evidenceKeys = generateKeyPairSync('ed25519'); const attestationKeys = generateKeyPairSync('ed25519');
  const authorizationKeys = generateKeyPairSync('ed25519');
  const publicPem = (keys: ReturnType<typeof generateKeyPairSync>) =>
    keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const siteId = 'site-a'; const hostInstallationId = randomUUID(); const operationId = randomUUID(); const generation = 7;
  const now = clock; const target = { ...RELEASE_RECOVERY_TARGET };
  const targetLogicalIdentitySha256 = recoveryTargetLogicalIdentitySha256(target);
  const targetReleaseIdentitySha256 = recoveryTargetReleaseIdentitySha256(target);
  const stable = { evidenceId: randomUUID(), siteId, hostInstallationId, targetReleaseIdentitySha256,
    targetLogicalIdentitySha256, issuedAt: '2026-10-29T00:00:00.000Z', validFrom: '2026-10-29T00:00:01.000Z',
    expiresAt: '2027-10-29T00:00:00.000Z', revokedEnvelopeSha256: [] };
  const storageAuthorityIdentitySha256 = digest('storage-authority');
  const inventoryRoots = (['ACTIVE', 'QUARANTINE', 'POOL', 'CONTROL'] as const).map((role, index) => ({ role,
    pathIdentitySha256: digest(`path-${role}`), mountId: String(100 + index), mountParentId: '1', filesystemType: 'ext4' as const,
    filesystemUuid: digest(`fs-${role}`).slice(0, 32), deviceMajor: '8', deviceMinor: String(index + 1),
    readOnly: false as const, quotaStatus: 'DEDICATED_FILESYSTEM' as const }));
  const rootIdentity = (role: typeof inventoryRoots[number]['role']) =>
    inventoryRoots.find((entry) => entry.role === role)!.pathIdentitySha256;
  const hostPolicy = signedEvidence({ format: 'darshan-recovery-host-policy-evidence-v2', kind: 'HOST_POLICY', ...stable,
    hostMode: 'SINGLE_HOST', storageAuthorityIdentitySha256, evidenceRootSha256: digest('evidence-root'),
    allocationControlRootSha256: rootIdentity('CONTROL'), allowedFilesystems: ['ext4'] }, evidenceKeys.privateKey);
  const engineProfile = signedEvidence({ format: 'darshan-recovery-engine-profile-evidence-v2', kind: 'ENGINE_PROFILE',
    ...stable, evidenceId: randomUUID(), postgresUid: '1101', postgresGid: '1101', minioUid: '1102', minioGid: '1102',
    allocationDirectoryMode: '0700', postgresDirectoryMode: '0700', minioDirectoryMode: '0700',
    requiredBytes: '1000', requiredInodes: '10' }, evidenceKeys.privateKey);
  const storageInventory = signedEvidence({ format: 'darshan-recovery-storage-inventory-evidence-v2', kind: 'STORAGE_INVENTORY',
    ...stable, evidenceId: randomUUID(), storageAuthorityIdentitySha256, roots: inventoryRoots }, evidenceKeys.privateKey);
  const protectionInventory = signedEvidence({ format: 'darshan-recovery-protection-inventory-evidence-v2',
    kind: 'PROTECTION_INVENTORY', ...stable, evidenceId: randomUUID(), protectedPathIdentitySha256: [digest('protected-path')],
    observedMountinfoSha256: digest('mountinfo') }, evidenceKeys.privateKey);
  const stableEnvelopes = { hostPolicyEnvelopeSha256: targetStorageEvidenceV2EnvelopeSha256(hostPolicy),
    engineProfileEnvelopeSha256: targetStorageEvidenceV2EnvelopeSha256(engineProfile),
    storageInventoryEnvelopeSha256: targetStorageEvidenceV2EnvelopeSha256(storageInventory),
    protectionInventoryEnvelopeSha256: targetStorageEvidenceV2EnvelopeSha256(protectionInventory) };
  const allocationLedgerHeadSha256 = digest('ledger-head');
  const capacity = signedEvidence({ format: 'darshan-recovery-capacity-evidence-v2', kind: 'CAPACITY_EVIDENCE',
    evidenceId: randomUUID(), siteId, hostInstallationId, operationId, generation: String(generation),
    targetReleaseIdentitySha256, targetLogicalIdentitySha256, issuedAt: '2026-10-29T00:00:02.000Z',
    validFrom: '2026-10-29T00:00:03.000Z', expiresAt: '2027-10-28T00:00:00.000Z', revokedEnvelopeSha256: [],
    ...stableEnvelopes, allocationLedgerHeadSha256, availableBytes: '5000', availableInodes: '100',
    fullOutstandingReservationBytes: '500', fullOutstandingReservationInodes: '5', requiredBytes: '1000', requiredInodes: '10',
    remainingBytes: '4500', remainingInodes: '95', controlAvailableBytes: '4096', controlAvailableInodes: '64' },
  evidenceKeys.privateKey);
  const capacityEvidenceEnvelopeSha256 = targetStorageEvidenceV2EnvelopeSha256(capacity);
  for (const [sha256, envelope] of new Map([
    [stableEnvelopes.hostPolicyEnvelopeSha256, hostPolicy], [stableEnvelopes.engineProfileEnvelopeSha256, engineProfile],
    [stableEnvelopes.storageInventoryEnvelopeSha256, storageInventory],
    [stableEnvelopes.protectionInventoryEnvelopeSha256, protectionInventory], [capacityEvidenceEnvelopeSha256, capacity],
  ])) await fs.writeFile(join(evidenceRoot, `${sha256}.json`), encodeSignedTargetStorageEvidenceV2(envelope), { mode: 0o600 });
  const specification = buildRecoveryTargetSpecificationV2({ operationId, generation, hostInstallationId,
    topologyMode: 'SINGLE_HOST', target, ...stableEnvelopes, capacityEvidenceEnvelopeSha256 });
  const targetSpecificationSha256 = sha256RecoveryBytes(encodeRecoveryTargetSpecificationV2(specification));
  const targetSetId = recoveryTargetSetIdV2({ operationId, generation, hostInstallationId, targetSpecificationSha256 });
  const attestation: RecoveryTargetOperationAttestation = { format: 'darshan-recovery-target-operation-attestation-v1',
    attestationId: randomUUID(), operationId, siteId, generation, hostInstallationId, targetSetId,
    targetSpecificationSha256, targetLogicalIdentitySha256, targetReleaseIdentitySha256, ...stableEnvelopes,
    capacityEvidenceEnvelopeSha256, issuedAt: '2026-10-29T00:00:04.000Z', expiresAt: '2027-10-28T00:00:00.000Z' };
  const signedAttestation: SignedRecoveryTargetOperationAttestation = {
    format: 'darshan-recovery-target-operation-attestation-envelope-v1', attestation,
    signature: { algorithm: 'Ed25519', keyId: 'attestation-authority',
      valueBase64: sign(null, targetOperationAttestationSigningPayload(attestation), attestationKeys.privateKey).toString('base64') } };
  const sourceIdentity = { kind: 'LOCAL_FILESYSTEM_V2' as const, siteId, repositoryId: randomUUID(), runId: randomUUID(),
    attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 1, manifestSha256: digest('manifest'),
    releaseId: 'release-01', schemaMigrationId: target.terminalMigrationId,
    schemaFingerprintSha256: target.migrationManifestSha256, repositoryDescriptorSha256: digest('repository-descriptor') };
  const source: RecoverySourceDescriptorV2 = { ...sourceIdentity,
    descriptorSha256: recoverySourceDescriptorV2Digest(sourceIdentity), fullyEligible: true };
  const helperRoleSha256 = digest('helper-role');
  const built = buildRecoveryPlanV4({ source, compatibility: { classification: 'COMPATIBLE_CURRENT', fullyEligible: true,
    targetReleaseId: target.releaseId, targetSchemaMigrationId: target.terminalMigrationId,
    sourceLedgerLength: 55, pendingMigrationIds: [] },
    target, operationId, planId: randomUUID(), createdAt: new Date('2026-10-29T00:00:05.000Z'),
  targetPreparation: { generation, hostInstallationId, topologyMode: 'SINGLE_HOST', helperRoleSha256,
    ...stableEnvelopes, capacityEvidenceEnvelopeSha256 }, targetSpecification: specification,
  operationAttestation: signedAttestation });
  const admissionBody: RecoveryTargetAdmissionV2 = { format: 'darshan-recovery-target-admission-v2', admissionId: randomUUID(),
    operationId, siteId, hostInstallationId, planSha256: built.sha256, targetSetId, generation, targetSpecificationSha256,
    operationAttestationSha256: targetOperationAttestationEnvelopeSha256(signedAttestation), allowedActions: ['PREPARE', 'INSPECT'],
    issuedAt: '2026-10-29T00:00:06.000Z', expiresAt: '2027-10-28T00:00:00.000Z' };
  const admission: SignedRecoveryTargetAdmissionV2 = { admission: admissionBody,
    signature: { algorithm: 'Ed25519', keyId: 'authorization-authority',
      valueBase64: sign(null, targetAdmissionV2SigningPayload(admissionBody), authorizationKeys.privateKey).toString('base64') } };
  const installedValue = parseRecoveryTargetInstalledIdentity(canonicalJson({
    format: 'darshan-recovery-target-helper-installation-v2', siteId, hostInstallationId,
    hostPolicySha256: stableEnvelopes.hostPolicyEnvelopeSha256, helperRoleSha256,
    engineProfileSha256: stableEnvelopes.engineProfileEnvelopeSha256, specificationRootSha256: digest('specification-root'),
    evidenceRootSha256: digest('evidence-root'), allocationLedgerRootSha256: digest('ledger-root'),
    allocationControlRootSha256: rootIdentity('CONTROL'), activeRootSha256: rootIdentity('ACTIVE'),
    quarantineRootSha256: rootIdentity('QUARANTINE'), poolRootSha256: rootIdentity('POOL'), storageAuthorityIdentitySha256,
    hostMode: 'SINGLE_HOST' }));
  const installed: RecoveryTargetInstalledIdentityV2 = requireEffectEligibleInstalledIdentity(installedValue);
  const loader = new ProtectedTargetStorageEvidenceLoaderV2({ root: evidenceRoot, expectedUid: process.getuid!(),
    expectedGid: process.getgid!(), keys: new Map([['evidence-authority', publicPem(evidenceKeys)]]), now });
  const makeOuter = (request: TargetHelperRequest, authorization: SignedRecoveryTargetAdmissionV2 | SignedRecoveryTargetDispositionV2) =>
    createTargetAuthorizationEnvelopeV2({ request, authorization, targetSpecification: specification,
      operationAttestation: signedAttestation, plan: built.plan, planSha256: built.sha256,
      specificationRootSha256: installed.specificationRootSha256 });
  const requestFor = (operation: TargetHelperRequest['operation'], expectedHelperSequence: number | null = null): TargetHelperRequest => ({
    format: 'darshan-recovery-target-helper-v1', requestId: randomUUID(), operation, operationId, siteId, hostInstallationId,
    planSha256: built.sha256, targetSetId, generation, targetSpecificationSha256,
    authorizationSha256: targetAuthorizationV2BodySha256(admission), expectedHelperSequence,
  });
  const initialRequest = requestFor('PREPARE'); const initialOuter = makeOuter(initialRequest, admission);
  const initialBody = encodeTargetAuthorizationEnvelopeV2(initialOuter);
  const storage = await verifyTargetAuthorizationEnvelopeV2Locked(initialOuter, {
    keys: new Map([['authorization-authority', publicPem(authorizationKeys)]]),
    attestationKeys: new Map([['attestation-authority', publicPem(attestationKeys)]]), now: now(), recheckNow: now,
    deadline: new Date('2027-01-01T00:00:00.000Z'), installedIdentity: installed, evidenceLoader: loader,
  });
  const profile = profileFixture(stableEnvelopes.engineProfileEnvelopeSha256);
  const inventory = inventoryFixture(stableEnvelopes.protectionInventoryEnvelopeSha256);
  const enrollment: TargetEngineEnrollmentV1 = { format: 'darshan-recovery-target-engine-enrollment-v1',
    enrollmentId: randomUUID(), authorityHandle, engineProfileEnvelopeSha256: stableEnvelopes.engineProfileEnvelopeSha256,
    executionProfileSha256: targetDockerExecutionProfileV1Sha256(profile),
    protectionInventoryEnvelopeSha256: stableEnvelopes.protectionInventoryEnvelopeSha256,
    protectedDockerInventorySha256: protectedDockerInventoryV1Sha256(inventory) };
  const authority = new TestOnlyStatefulLifecycleAuthority(profile, inventory, allocationLedgerHeadSha256);
  const expectedDockerIdentity: TargetDockerExpectedIdentityV1 = { targetHandle, postgresContainerId: ids.postgres,
    minioContainerId: ids.minio, networkId: ids.network, postgresEndpointId: ids.pgEndpoint,
    minioEndpointId: ids.minioEndpoint, postgresMacAddressSha256: digest('pg-mac'),
    minioMacAddressSha256: digest('minio-mac'), postgresHealthOutputSha256: '0'.repeat(64),
    minioHealthOutputSha256: '0'.repeat(64) };
  const options = (currentAuthority: TestOnlyStatefulLifecycleAuthority,
    fault?: (stage: TargetEngineJournalFaultStage) => Promise<void>) => ({ journal: new TargetEngineJournal({ root: engineRoot, fault }),
    authority: currentAuthority, authorityHandle, profileHandle, inventoryHandle, targetHandle, enrollment,
    engineProfileEnvelope: engineProfile, protectionInventoryEnvelope: protectionInventory, expectedDockerIdentity, now });
  const engine = new ConstrainedRecoveryTargetEngine(options(authority));
  const identity: TargetHelperIdentity = { operationId, siteId, hostInstallationId, planSha256: built.sha256,
    targetSetId, generation, targetSpecificationSha256 };
  const makeBinding = (request: TargetHelperRequest, body: Buffer): TargetLifecycleBindingV1 => ({ ...identity,
    outerEnvelopeSha256: sha256RecoveryBytes(body), authorizationSha256: request.authorizationSha256,
    enrollmentSha256: sha256RecoveryBytes(canonicalJson(enrollment)),
    executionProfileSha256: enrollment.executionProfileSha256,
    protectedInventorySha256: enrollment.protectedDockerInventorySha256 });
  const makeAdmissionRequest = (operation: 'PREPARE' | 'INSPECT', expectedHelperSequence: number | null = null) => {
    const request = requestFor(operation, expectedHelperSequence); const body = encodeTargetAuthorizationEnvelopeV2(makeOuter(request, admission));
    return { request, body, context: { request, requestBody: body, authorizationSha256: request.authorizationSha256,
      deadline: new Date('2027-01-01T00:00:00.000Z'), signal: new AbortController().signal, storage },
      binding: makeBinding(request, body) };
  };
  const makeDispositionRequest = (response: TargetHelperResponse, action: 'STOP_RETAIN' | 'RETIRE') => {
    if (!response.ok || response.operation !== 'PREPARE' || response.reconciliationEvidenceSha256 === null) {
      throw new Error('fixture requires a successful PREPARE receipt');
    }
    const decision: RecoveryTargetDispositionDecisionV2 = { format: 'darshan-recovery-target-disposition-v2', decisionId: randomUUID(),
      operationId, siteId, hostInstallationId, planSha256: built.sha256, targetSetId, generation, targetSpecificationSha256,
      operationAttestationSha256: targetOperationAttestationEnvelopeSha256(signedAttestation), action,
      expectedHelperSequence: response.helperSequence, expectedTargetState: 'READY',
      preparedReceiptSha256: sha256RecoveryBytes(canonicalJson(response)),
      issuedAt: '2026-10-29T00:00:06.000Z', expiresAt: '2027-10-28T00:00:00.000Z' };
    const signed: SignedRecoveryTargetDispositionV2 = { decision, signature: { algorithm: 'Ed25519',
      keyId: 'authorization-authority',
      valueBase64: sign(null, targetDispositionV2SigningPayload(decision), authorizationKeys.privateKey).toString('base64') } };
    const request: TargetHelperRequest = { ...requestFor(action, response.helperSequence), operation: action,
      authorizationSha256: targetAuthorizationV2BodySha256(signed) };
    const body = encodeTargetAuthorizationEnvelopeV2(makeOuter(request, signed));
    return { request, body, binding: makeBinding(request, body) };
  };
  const initialContext: RecoveryTargetEngineCallContext = { request: initialRequest, requestBody: initialBody,
    authorizationSha256: initialRequest.authorizationSha256, deadline: new Date('2027-01-01T00:00:00.000Z'),
    signal: new AbortController().signal, storage };
  authority.binding = makeBinding(initialRequest, initialBody);
  const helperJournal = new TargetHelperJournal({ root: helperRoot });
  const service = new RecoveryTargetHelperService({ journal: helperJournal, engine, authorize: () => undefined, now });
  const gateway = new RecoveryTargetAuthorizationGateway({ service,
    keys: new Map([['authorization-authority', publicPem(authorizationKeys)]]),
    attestationKeys: new Map([['attestation-authority', publicPem(attestationKeys)]]),
    evidenceLoaderV2: loader, installedIdentity: installed, now });
  return { root, engineRoot, helperRoot, profile, inventory, enrollment, engineProfile, protectionInventory,
    authority, engine, identity, request: initialRequest, requestBody: initialBody, context: initialContext, storage, gateway,
    authorizationKeys, admission, makeAdmissionRequest, makeDispositionRequest,
    recreate: (currentAuthority = authority) => new ConstrainedRecoveryTargetEngine(options(currentAuthority)),
    create: (fault) => new ConstrainedRecoveryTargetEngine(options(authority, fault)) };
}

async function treeBytes(root: string): Promise<readonly { name: string; bytes: string; mode: number }[]> {
  const values: { name: string; bytes: string; mode: number }[] = [];
  const visit = async (path: string, prefix: string): Promise<void> => {
    for (const name of (await fs.readdir(path)).sort()) {
      const child = join(path, name); const stat = await fs.lstat(child); const relative = prefix ? `${prefix}/${name}` : name;
      if (stat.isDirectory()) await visit(child, relative);
      else values.push({ name: relative, bytes: (await fs.readFile(child)).toString('hex'), mode: stat.mode & 0o777 });
    }
  };
  await visit(root, ''); return values;
}

function directPreparedResponse(value: Fixture, evidenceSha256: string): TargetHelperResponse {
  return { format: 'darshan-recovery-target-helper-v1', requestId: value.request.requestId, operation: 'PREPARE',
    operationId: value.identity.operationId, siteId: value.identity.siteId,
    hostInstallationId: value.identity.hostInstallationId, planSha256: value.identity.planSha256,
    targetSetId: value.identity.targetSetId, generation: value.identity.generation,
    targetSpecificationSha256: value.identity.targetSpecificationSha256,
    authorizationSha256: value.request.authorizationSha256, ok: true, helperSequence: 2, state: 'READY',
    pendingAction: null, reconciliationEvidenceSha256: evidenceSha256, effectDisposition: 'DEFINITE',
    observedAt: '2026-10-29T01:00:00.000Z' };
}

function dispositionContext(value: Fixture, response: TargetHelperResponse, action: 'STOP_RETAIN' | 'RETIRE') {
  const disposition = value.makeDispositionRequest(response, action); value.authority.binding = disposition.binding;
  return { disposition, context: { ...value.context, request: disposition.request, requestBody: disposition.body,
    authorizationSha256: disposition.request.authorizationSha256 } satisfies RecoveryTargetEngineCallContext };
}

describe('Packet 05B1b3b1b constrained target engine', () => {
  it('runs direct PREPARE, byte-for-byte read-only INSPECT, exact replay/recreation, and STOP_RETAIN', async () => {
    const value = await fixture();
    const prepared = await value.engine.prepare(value.identity, value.context);
    expect(prepared.state).toBe('READY'); expect(value.authority.commands.map((command) => command.step)).toEqual([
      'ENSURE_INTERNAL_NETWORK', 'CREATE_POSTGRES', 'CREATE_MINIO', 'START_POSTGRES', 'START_MINIO',
    ]);
    const afterPrepareCount = value.authority.commands.length;
    await expect(value.engine.prepare(value.identity, value.context)).resolves.toEqual(prepared);
    await expect(value.recreate().prepare(value.identity, value.context)).resolves.toEqual(prepared);
    expect(value.authority.commands).toHaveLength(afterPrepareCount);

    const inspect = value.makeAdmissionRequest('INSPECT'); value.authority.binding = inspect.binding;
    const beforeJournal = await treeBytes(value.engineRoot); const fixtureState = structuredClone({
      network: value.authority.network, postgres: value.authority.postgres, minio: value.authority.minio,
      commands: value.authority.commands,
    });
    await expect(value.engine.inspect(value.identity, inspect.context)).resolves.toMatchObject({ state: 'READY' });
    expect(await treeBytes(value.engineRoot)).toEqual(beforeJournal);
    expect({ network: value.authority.network, postgres: value.authority.postgres, minio: value.authority.minio,
      commands: value.authority.commands }).toEqual(fixtureState);

    const fakePrepareResponse = directPreparedResponse(value, prepared.evidenceSha256);
    const { disposition: stop, context: stopContext } = dispositionContext(value, fakePrepareResponse, 'STOP_RETAIN');
    await expect(value.engine.stopRetain(value.identity, stopContext)).resolves.toMatchObject({ state: 'STOPPED_RETAINED' });
    expect(value.authority.commands.slice(-2).map((command) => command.step)).toEqual(['STOP_MINIO', 'STOP_POSTGRES']);
    const records = await new TargetEngineJournal({ root: value.engineRoot }).read({ targetHandle,
      binding: { ...value.identity, enrollmentSha256: sha256RecoveryBytes(canonicalJson(value.enrollment)),
        executionProfileSha256: value.enrollment.executionProfileSha256,
        protectedInventorySha256: value.enrollment.protectedDockerInventorySha256 } });
    expect(records).toHaveLength(20);
    expect(records.every((record) => record.body.binding.operationId === value.identity.operationId &&
      record.body.binding.targetSetId === value.identity.targetSetId &&
      record.body.binding.authorizationSha256 === (record.body.action === 'PREPARE'
        ? value.request.authorizationSha256 : stop.request.authorizationSha256))).toBe(true);
    expect(JSON.stringify({ prepared, records, calls: value.authority.calls })).not.toContain('SECRET_SENTINEL_05B1B3B1B');
  });

  it('recovers every lifecycle step after durable INTENT and RECEIPT crash windows without duplicate effects', async () => {
    const cases = [
      { action: 'PREPARE' as const, steps: ['ADMIT_EXISTING_RESOURCES', 'ENSURE_INTERNAL_NETWORK', 'CREATE_POSTGRES',
        'CREATE_MINIO', 'START_POSTGRES', 'START_MINIO', 'VERIFY_READY'] as const },
      { action: 'STOP_RETAIN' as const, steps: ['STOP_MINIO', 'STOP_POSTGRES', 'VERIFY_STOPPED_RETAINED'] as const },
    ];
    for (const item of cases) {
      for (let stepIndex = 0; stepIndex < item.steps.length; stepIndex += 1) {
        for (const phase of ['INTENT', 'RECEIPT'] as const) {
          const value = await fixture(); let context = value.context; let prepared: { evidenceSha256: string } | undefined;
          if (item.action === 'STOP_RETAIN') {
            prepared = await value.engine.prepare(value.identity, value.context);
            context = dispositionContext(value, directPreparedResponse(value, prepared.evidenceSha256), 'STOP_RETAIN').context;
          }
          const commandCountBefore = value.authority.commands.length; let publications = 0; let injected = false;
          const targetPublication = stepIndex * 2 + (phase === 'INTENT' ? 1 : 2);
          const crashing = value.create(async (stage) => {
            if (stage === 'after-link-before-directory-fsync' && ++publications === targetPublication) {
              injected = true; throw new Error(`fixture ${item.action} ${item.steps[stepIndex]} ${phase} crash`);
            }
          });
          const invoke = (engine: ConstrainedRecoveryTargetEngine) => item.action === 'PREPARE'
            ? engine.prepare(value.identity, context) : engine.stopRetain(value.identity, context);
          await expect(invoke(crashing)).rejects.toThrow(/fixture .* crash/); expect(injected).toBe(true);
          await expect(invoke(value.recreate())).resolves.toMatchObject({
            state: item.action === 'PREPARE' ? 'READY' : 'STOPPED_RETAINED',
          });
          const operationCommands = value.authority.commands.slice(commandCountBefore).map((command) => command.step);
          expect(new Set(operationCommands).size).toBe(operationCommands.length);
        }
      }
    }
  }, 30_000);

  it('recovers every effectful step after effect/lost-response and post-effect observation crashes', async () => {
    const cases = [
      { action: 'PREPARE' as const, steps: ['ENSURE_INTERNAL_NETWORK', 'CREATE_POSTGRES', 'CREATE_MINIO',
        'START_POSTGRES', 'START_MINIO'] as const },
      { action: 'STOP_RETAIN' as const, steps: ['STOP_MINIO', 'STOP_POSTGRES'] as const },
    ];
    for (const item of cases) {
      for (const step of item.steps) {
        for (const window of ['LOST_RESPONSE', 'POST_EFFECT_OBSERVATION'] as const) {
          const value = await fixture(); let context = value.context;
          if (item.action === 'STOP_RETAIN') {
            const prepared = await value.engine.prepare(value.identity, value.context);
            context = dispositionContext(value, directPreparedResponse(value, prepared.evidenceSha256), 'STOP_RETAIN').context;
          }
          const before = value.authority.commands.length; let injected = false;
          if (window === 'LOST_RESPONSE') {
            value.authority.result = (command) => {
              if (!injected && command.step === step) {
                injected = true; value.authority.applyForTest(command); throw new Error(`lost ${step} response`);
              }
              return undefined;
            };
          } else {
            value.authority.before = (operation) => {
              if (!injected && operation === 'OBSERVE_LIFECYCLE' && value.authority.commands.at(-1)?.step === step) {
                injected = true; throw new Error(`lost ${step} observation`);
              }
            };
          }
          const invoke = (engine: ConstrainedRecoveryTargetEngine) => item.action === 'PREPARE'
            ? engine.prepare(value.identity, context) : engine.stopRetain(value.identity, context);
          await expect(invoke(value.engine)).rejects.toThrow(new RegExp(`lost ${step}`)); expect(injected).toBe(true);
          value.authority.result = undefined; value.authority.before = undefined;
          await expect(invoke(value.recreate())).resolves.toMatchObject({
            state: item.action === 'PREPARE' ? 'READY' : 'STOPPED_RETAINED',
          });
          expect(value.authority.commands.slice(before).filter((command) => command.step === step)).toHaveLength(1);
        }
      }
    }
  }, 30_000);

  it('uses authoritative adoption after a lost response and retries only from reliable absence', async () => {
    const adopted = await fixture(); let lost = false;
    adopted.authority.result = (command) => {
      if (!lost && command.step === 'CREATE_POSTGRES') {
        lost = true; adopted.authority.postgres = 'CREATED';
        throw new TargetEngineEffectError('lost response SECRET_SENTINEL_05B1B3B1B', 'AMBIGUOUS');
      }
      return undefined;
    };
    await expect(adopted.engine.prepare(adopted.identity, adopted.context)).rejects.toMatchObject({ disposition: 'AMBIGUOUS' });
    const before = adopted.authority.commands.filter((command) => command.step === 'CREATE_POSTGRES').length;
    adopted.authority.result = undefined;
    await expect(adopted.recreate().prepare(adopted.identity, adopted.context)).resolves.toMatchObject({ state: 'READY' });
    expect(adopted.authority.commands.filter((command) => command.step === 'CREATE_POSTGRES')).toHaveLength(before);

    const retried = await fixture(); let rejected = false;
    retried.authority.result = (command) => {
      if (!rejected && command.step === 'ENSURE_INTERNAL_NETWORK') {
        rejected = true;
        return { format: 'darshan-recovery-target-lifecycle-result-v1', commandSha256: targetLifecycleCommandV1Sha256(command),
          outcome: 'NOT_APPLIED', effectPossible: false, sanitizedCode: 'RELIABLE_ABSENCE' };
      }
      return undefined;
    };
    await expect(retried.engine.prepare(retried.identity, retried.context)).rejects.toMatchObject({ disposition: 'DEFINITE' });
    retried.authority.result = undefined;
    await expect(retried.recreate().prepare(retried.identity, retried.context)).resolves.toMatchObject({ state: 'READY' });
    expect(retried.authority.commands.filter((command) => command.step === 'ENSURE_INTERNAL_NETWORK')).toHaveLength(2);
  });

  it.each([
    ['foreign', (observation: TargetLifecycleObservationV1) => ({ ...observation,
      absenceReliable: false, network: { ...observation.network, state: 'FOREIGN' as const } })],
    ['configuration mismatch', (observation: TargetLifecycleObservationV1) => ({ ...observation,
      network: { ...observation.network, configurationSha256: digest('wrong-configuration') } })],
    ['incomplete observation', (observation: TargetLifecycleObservationV1) => ({ ...observation,
      complete: false, absenceReliable: false })],
  ])('retains a pending intent for %s instead of retrying', async (_label, mutate) => {
    const value = await fixture(); value.authority.observation = mutate;
    await expect(value.engine.prepare(value.identity, value.context)).rejects.toMatchObject({ disposition: 'AMBIGUOUS' });
    expect(value.authority.commands).toHaveLength(0);
    value.authority.observation = undefined;
    const changed = value.makeAdmissionRequest('PREPARE'); value.authority.binding = changed.binding;
    await expect(value.recreate().prepare(value.identity, changed.context)).rejects.toMatchObject({ disposition: 'AMBIGUOUS' });
    expect(value.authority.commands).toHaveLength(0);
  });

  it('rejects changed request, stale binding, missing terminal receipt, and contradictory terminal truth', async () => {
    const changed = await fixture(); let failed = false;
    changed.authority.result = (command) => {
      if (!failed && command.step === 'ENSURE_INTERNAL_NETWORK') { failed = true; throw new Error('lost response'); }
      return undefined;
    };
    await expect(changed.engine.prepare(changed.identity, changed.context)).rejects.toBeTruthy();
    changed.authority.result = undefined;
    const other = changed.makeAdmissionRequest('PREPARE'); changed.authority.binding = other.binding;
    await expect(changed.recreate().prepare(changed.identity, other.context)).rejects.toMatchObject({ disposition: 'AMBIGUOUS' });

    const missing = await fixture(); missing.authority.network = 'CREATED'; missing.authority.postgres = 'RUNNING_HEALTHY';
    missing.authority.minio = 'RUNNING_HEALTHY'; missing.authority.absenceReliable = false;
    const inspect = missing.makeAdmissionRequest('INSPECT'); missing.authority.binding = inspect.binding;
    await expect(missing.engine.inspect(missing.identity, inspect.context)).resolves.toMatchObject({ state: 'RECONCILIATION_REQUIRED' });

    const contradicted = await fixture(); await contradicted.engine.prepare(contradicted.identity, contradicted.context);
    contradicted.authority.network = 'CREATED'; contradicted.authority.postgres = 'STOPPED'; contradicted.authority.minio = 'STOPPED';
    contradicted.authority.absenceReliable = false;
    const freshInspect = contradicted.makeAdmissionRequest('INSPECT'); contradicted.authority.binding = freshInspect.binding;
    await expect(contradicted.engine.inspect(contradicted.identity, freshInspect.context)).resolves
      .toMatchObject({ state: 'RECONCILIATION_REQUIRED' });
    contradicted.authority.binding = contradicted.context.requestBody.length > 0
      ? { ...freshInspect.binding, outerEnvelopeSha256: digest('stale-head') } : freshInspect.binding;
    await expect(contradicted.engine.inspect(contradicted.identity, freshInspect.context)).rejects.toMatchObject({ disposition: 'AMBIGUOUS' });
  });

  it('rechecks cancellation and deadline after every authority await without leaking the sentinel', async () => {
    for (const boundary of ['LOCK', 'READ_EXECUTION_PROFILE', 'READ_PROTECTED_INVENTORY', 'ADMIT_EXISTING_RESOURCES',
      'OBSERVE_LIFECYCLE', 'EXECUTE_ENSURE_INTERNAL_NETWORK'] as const) {
      const value = await fixture(); const controller = new AbortController();
      const context: RecoveryTargetEngineCallContext = { ...value.context, signal: controller.signal };
      value.authority.before = (operation) => { if (operation === boundary) controller.abort(new Error('SECRET_SENTINEL_05B1B3B1B')); };
      await expect(value.engine.prepare(value.identity, context)).rejects.toBeTruthy();
      expect(JSON.stringify(await treeBytes(value.engineRoot))).not.toContain('SECRET_SENTINEL_05B1B3B1B');
    }
    const expired = await fixture();
    await expect(expired.engine.prepare(expired.identity, { ...expired.context,
      deadline: new Date('2026-10-29T01:00:00.000Z') })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_EXPIRED' });
    expect(expired.authority.commands).toHaveLength(0);
  });

  it('classifies a failure after an earlier mutation as ambiguous and rejects RETIRE definitely before effect', async () => {
    const partial = await fixture();
    partial.authority.result = (command) => command.step === 'CREATE_POSTGRES'
      ? { format: 'darshan-recovery-target-lifecycle-result-v1', commandSha256: targetLifecycleCommandV1Sha256(command),
        outcome: 'NOT_APPLIED', effectPossible: false, sanitizedCode: 'FAILED' }
      : undefined;
    await expect(partial.engine.prepare(partial.identity, partial.context)).rejects.toMatchObject({ disposition: 'AMBIGUOUS' });
    expect(partial.authority.network).toBe('CREATED');

  });

  it('runs the genuine Ed25519 evidence-v2/spec-v2/attestation/plan-v4/admission/outer chain through gateway and helper', async () => {
    const value = await fixture(); value.authority.binding = {
      ...value.identity, outerEnvelopeSha256: sha256RecoveryBytes(value.requestBody),
      authorizationSha256: value.request.authorizationSha256,
      enrollmentSha256: sha256RecoveryBytes(canonicalJson(value.enrollment)),
      executionProfileSha256: value.enrollment.executionProfileSha256,
      protectedInventorySha256: value.enrollment.protectedDockerInventorySha256,
    };
    const prepared = parseTargetHelperResponse(await value.gateway.handle(value.requestBody,
      { deadline: new Date('2027-01-01T00:00:00.000Z') }));
    expect(prepared).toMatchObject({ ok: true, operation: 'PREPARE', state: 'READY' });
    const inspect = value.makeAdmissionRequest('INSPECT'); value.authority.binding = inspect.binding;
    const inspected = parseTargetHelperResponse(await value.gateway.handle(inspect.body,
      { deadline: new Date('2027-01-01T00:00:00.000Z') }));
    expect(inspected).toMatchObject({ ok: true, operation: 'INSPECT', state: 'READY' });
    const stop = value.makeDispositionRequest(prepared, 'STOP_RETAIN'); value.authority.binding = stop.binding;
    const stopped = parseTargetHelperResponse(await value.gateway.handle(stop.body,
      { deadline: new Date('2027-01-01T00:00:00.000Z') }));
    expect(stopped).toMatchObject({ ok: true, operation: 'STOP_RETAIN', state: 'STOPPED_RETAINED' });

    const separate = await fixture(); separate.authority.binding = {
      ...separate.identity, outerEnvelopeSha256: sha256RecoveryBytes(separate.requestBody),
      authorizationSha256: separate.request.authorizationSha256,
      enrollmentSha256: sha256RecoveryBytes(canonicalJson(separate.enrollment)),
      executionProfileSha256: separate.enrollment.executionProfileSha256,
      protectedInventorySha256: separate.enrollment.protectedDockerInventorySha256,
    };
    const secondPrepared = parseTargetHelperResponse(await separate.gateway.handle(separate.requestBody,
      { deadline: new Date('2027-01-01T00:00:00.000Z') }));
    const retire = separate.makeDispositionRequest(secondPrepared, 'RETIRE'); separate.authority.binding = retire.binding;
    const beforeResources = structuredClone({ network: separate.authority.network, postgres: separate.authority.postgres,
      minio: separate.authority.minio, commands: separate.authority.commands });
    const beforeEngineJournal = await treeBytes(separate.engineRoot);
    const rejected = parseTargetHelperResponse(await separate.gateway.handle(retire.body,
      { deadline: new Date('2027-01-01T00:00:00.000Z') }));
    expect(rejected).toMatchObject({ ok: false, operation: 'RETIRE', error: { code: 'TARGET_ENGINE_FAILED' } });
    expect({ network: separate.authority.network, postgres: separate.authority.postgres,
      minio: separate.authority.minio, commands: separate.authority.commands }).toEqual(beforeResources);
    expect(await treeBytes(separate.engineRoot)).toEqual(beforeEngineJournal);
    expect(JSON.stringify({ prepared, inspected, stopped, rejected })).not.toContain('SECRET_SENTINEL_05B1B3B1B');
  });

  it('reconciles genuine gateway lost-response PREPARE and STOP_RETAIN with the original signed operation', async () => {
    const value = await fixture(); let lostPrepare = false;
    value.authority.result = (command) => {
      if (!lostPrepare && command.step === 'CREATE_POSTGRES') {
        lostPrepare = true; value.authority.applyForTest(command); throw new Error('lost PREPARE response');
      }
      return undefined;
    };
    await expect(value.gateway.handle(value.requestBody,
      { deadline: new Date('2027-01-01T00:00:00.000Z') })).rejects
      .toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    value.authority.result = undefined;
    const prepared = parseTargetHelperResponse(await value.gateway.handle(value.requestBody,
      { deadline: new Date('2027-01-01T00:00:00.000Z') }));
    expect(prepared).toMatchObject({ ok: true, operation: 'PREPARE', state: 'READY' });

    const stop = value.makeDispositionRequest(prepared, 'STOP_RETAIN'); value.authority.binding = stop.binding;
    let lostStop = false;
    value.authority.result = (command) => {
      if (!lostStop && command.step === 'STOP_MINIO') {
        lostStop = true; value.authority.applyForTest(command); throw new Error('lost STOP_RETAIN response');
      }
      return undefined;
    };
    await expect(value.gateway.handle(stop.body,
      { deadline: new Date('2027-01-01T00:00:00.000Z') })).rejects
      .toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    value.authority.result = undefined;
    const stopped = parseTargetHelperResponse(await value.gateway.handle(stop.body,
      { deadline: new Date('2027-01-01T00:00:00.000Z') }));
    expect(stopped).toMatchObject({ ok: true, state: 'STOPPED_RETAINED' });
  });

  it.each(['START_MINIO', 'STOP_POSTGRES'] as const)(
    'durably receipts late lost-response %s and terminal verification before helper success', async (step) => {
      const value = await fixture(); let body = value.requestBody;
      if (step === 'STOP_POSTGRES') {
        const prepared = parseTargetHelperResponse(await value.gateway.handle(body,
          { deadline: new Date('2027-01-01T00:00:00.000Z') }));
        const stop = value.makeDispositionRequest(prepared, 'STOP_RETAIN');
        body = stop.body; value.authority.binding = stop.binding;
      }
      let lost = false;
      value.authority.result = (command) => {
        if (!lost && command.step === step) {
          lost = true; value.authority.applyForTest(command); throw new Error(`lost late ${step} response`);
        }
        return undefined;
      };
      await expect(value.gateway.handle(body, { deadline: new Date('2027-01-01T00:00:00.000Z') }))
        .rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
      value.authority.result = undefined;
      const mutationBinding = value.authority.binding; const beforeReplayInspect = value.makeAdmissionRequest('INSPECT');
      value.authority.binding = beforeReplayInspect.binding;
      await expect(value.engine.inspect(value.identity, beforeReplayInspect.context)).resolves
        .toMatchObject({ state: 'RECONCILIATION_REQUIRED' });
      value.authority.binding = mutationBinding;
      const replayed = parseTargetHelperResponse(await value.gateway.handle(body,
        { deadline: new Date('2027-01-01T00:00:00.000Z') }));
      const expected = step === 'START_MINIO' ? 'READY' : 'STOPPED_RETAINED';
      expect(replayed).toMatchObject({ ok: true, state: expected });
      const inspect = value.makeAdmissionRequest('INSPECT'); value.authority.binding = inspect.binding;
      const observed = parseTargetHelperResponse(await value.gateway.handle(inspect.body,
        { deadline: new Date('2027-01-01T00:00:00.000Z') }));
      expect(observed).toMatchObject({ ok: true, state: expected });
    });

  it('pins resource admission across an action group after the first durable receipt', async () => {
    const value = await fixture(); let publications = 0;
    const crashing = value.create(async (stage) => {
      if (stage === 'after-link-before-directory-fsync' && ++publications === 2) throw new Error('crash after admission receipt');
    });
    await expect(crashing.prepare(value.identity, value.context)).rejects.toThrow('crash after admission receipt');
    const original = value.authority.admission.bind(value.authority);
    value.authority.admission = () => { const admission = original(); return { ...admission,
      allocation: { ...admission.allocation, allocationIdentitySha256: digest('changed-allocation') } }; };
    await expect(value.recreate().prepare(value.identity, value.context)).rejects.toBeTruthy();
    expect(value.authority.commands).toHaveLength(0);
  });

  it('rejects a caller identity that differs from the exact signed request identity', async () => {
    const value = await fixture(); const wrong = { ...value.identity, operationId: randomUUID(), siteId: 'other-site' };
    await expect(value.engine.prepare(wrong, value.context)).rejects
      .toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
    expect(value.authority.commands).toHaveLength(0);
  });

  it('rejects resource replacement under retained handles before STOP_RETAIN effects', async () => {
    const value = await fixture(); const prepared = await value.engine.prepare(value.identity, value.context);
    const stop = dispositionContext(value, directPreparedResponse(value, prepared.evidenceSha256), 'STOP_RETAIN');
    value.authority.observation = (observation) => ({ ...observation,
      network: { ...observation.network, identitySha256: digest('replacement-network') },
      postgres: { ...observation.postgres, identitySha256: digest('replacement-postgres') },
      minio: { ...observation.minio, identitySha256: digest('replacement-minio') } });
    const before = value.authority.commands.length;
    await expect(value.engine.stopRetain(value.identity, stop.context)).rejects.toMatchObject({ disposition: 'AMBIGUOUS' });
    expect(value.authority.commands).toHaveLength(before);
  });

  it('rechecks gateway-signed freshness after an awaited authority boundary and performs no later effects', async () => {
    let current = new Date('2026-10-29T01:00:00.000Z'); const value = await fixture(() => current);
    value.authority.before = (operation) => { if (operation === 'READ_EXECUTION_PROFILE') {
      current = new Date('2027-11-01T00:00:00.000Z');
    } };
    await expect(value.gateway.handle(value.requestBody,
      { deadline: new Date('2028-01-01T00:00:00.000Z') })).rejects
      .toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    expect(value.authority.commands).toHaveLength(0);
  });

  it('keeps direct and gateway inspection byte-for-byte read-only, including retained linked publication evidence', async () => {
    const value = await fixture();
    const prepared = parseTargetHelperResponse(await value.gateway.handle(value.requestBody,
      { deadline: new Date('2027-01-01T00:00:00.000Z') }));
    expect(prepared.ok).toBe(true);
    const target = join(value.engineRoot, 'targets', value.identity.targetSetId);
    const final = (await fs.readdir(target)).find((name) => name.endsWith('.json'))!;
    await fs.link(join(target, final), join(target, '.pending', `${randomUUID()}.tmp`));
    const inspect = value.makeAdmissionRequest('INSPECT'); value.authority.binding = inspect.binding;
    const engineBefore = await treeBytes(value.engineRoot); const helperBefore = await treeBytes(value.helperRoot);
    await expect(value.engine.inspect(value.identity, inspect.context)).resolves.toMatchObject({ state: 'READY' });
    await expect(value.gateway.handle(inspect.body, { deadline: new Date('2027-01-01T00:00:00.000Z') })).resolves.toBeTruthy();
    expect(await treeBytes(value.engineRoot)).toEqual(engineBefore);
    expect(await treeBytes(value.helperRoot)).toEqual(helperBefore);
  });
});
