import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { planTargetResourceCommand, protectedDockerInventoryV1Sha256,
  encodeProtectedDockerInventoryV1, parseProtectedDockerInventoryV1,
  type ProtectedDockerInventoryV1, type TargetAuthorityHandle, type TargetEngineEnrollmentV1 } from './target-engine-contracts';
import { encodeTargetDockerEffectiveInspectV1, parseTargetDockerEffectiveInspectV1,
  validateTargetDockerEffectiveInspectV1, type TargetDockerEffectiveInspectV1 } from './target-docker-inspect';
import { encodeTargetDockerExecutionProfileV1, parseTargetDockerExecutionProfileV1,
  targetDockerExecutionProfileV1Sha256, verifyTargetEngineEnrollmentV1,
  type TargetDockerExecutionProfileV1 } from './target-docker-profile';
import { TestOnlyScriptedTargetResourceAuthority } from './target-resource-authority';
import { TargetEngineNotInstalledError, UnavailableRecoveryTargetEngine } from './target-helper-service';
import { targetStorageEvidenceV2EnvelopeSha256, targetStorageEvidenceV2SigningPayload,
  type SignedTargetStorageEvidenceV2, type TargetStorageEvidenceV2 } from './target-storage-contracts-v2';

const d = (letter: string) => letter.repeat(64);
const h = (kind: string, suffix: string): TargetAuthorityHandle =>
  `tra:v1:${kind}:${suffix.padEnd(16, '0')}` as TargetAuthorityHandle;
const ids = { postgres: d('a'), minio: d('b'), network: d('c'), pgEndpoint: d('d'), minioEndpoint: d('e') };
const expectedIdentity = () => ({ targetHandle: h('target', 'fixture'), postgresContainerId: ids.postgres,
  minioContainerId: ids.minio, networkId: ids.network, postgresEndpointId: ids.pgEndpoint,
  minioEndpointId: ids.minioEndpoint, postgresMacAddressSha256: d('f'), minioMacAddressSha256: d('0'),
  postgresHealthOutputSha256: d('0'), minioHealthOutputSha256: d('0') });

function profileFixture(engineProfileEnvelopeSha256 = d('7')): TargetDockerExecutionProfileV1 {
  const common = (role: 'POSTGRES' | 'MINIO') => ({
    containerAuthorityHandle: h('container', role === 'POSTGRES' ? 'postgres' : 'minio'),
    name: `darshan-recovery-${role.toLowerCase()}-0123456789abcdef`,
    image: { imageId: `sha256:${role === 'POSTGRES' ? d('1') : d('2')}`,
      platform: 'linux', architecture: 'amd64', configSha256: role === 'POSTGRES' ? d('3') : d('4'), declaredVolumes: [] },
    numericUid: role === 'POSTGRES' ? '1101' : '1102', numericGid: role === 'POSTGRES' ? '1101' : '1102',
    binds: [{ type: 'BIND', sourceAuthorityHandle: h('allocation', role === 'POSTGRES' ? 'postgres' : 'minio'),
      sourceIdentitySha256: role === 'POSTGRES' ? d('c') : d('d'),
      destination: role === 'POSTGRES' ? '/var/lib/postgresql/data' : '/data', readOnly: false, propagation: 'rprivate' }],
    tmpfs: role === 'POSTGRES'
      ? [{ destination: '/run/postgresql', options: 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' },
        { destination: '/tmp', options: 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' }]
      : [{ destination: '/tmp', options: 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' }],
    security: { readonlyRootfs: true, capAdd: [], capDrop: ['ALL'], noNewPrivileges: true, privileged: false,
      seccompAuthorityHandle: h('policy', 'seccomp'), seccompSha256: d('5'), lsmAuthorityHandle: h('policy', 'lsm'),
      lsmProfileSha256: d('6'), pidMode: 'PRIVATE', ipcMode: 'PRIVATE', utsMode: 'PRIVATE', usernsMode: 'PRIVATE',
      cgroupnsMode: 'PRIVATE', devices: [], deviceRequests: [], supplementaryGroups: [] },
    resources: { memoryBytes: '536870912', memorySwapBytes: '536870912', cpuQuotaMicros: '100000',
      cpuPeriodMicros: '100000', cpuShares: '1024', pidsLimit: '256', shmBytes: '67108864',
      oomKillDisable: false, oomScoreAdj: 0 },
    logging: { driver: 'local', maxSize: '10m', maxFiles: '3', compress: true },
    restartPolicy: 'no', autoRemove: false,
    healthcheck: { policy: role === 'POSTGRES' ? 'POSTGRES_READY_V1' : 'MINIO_READY_V1',
      intervalNanoseconds: '10000000000', timeoutNanoseconds: '3000000000',
      startPeriodNanoseconds: '30000000000', retries: 12 },
    labels: { owner: 'darshan-recovery', contract: 'target-engine-execution-profile-v1', managed: 'true' },
  });
  return parseTargetDockerExecutionProfileV1(canonicalJson({
    format: 'darshan-recovery-target-engine-execution-profile-v1',
    profileId: '00000000-0000-4000-8000-000000000001', authorityHandle: h('authority', 'engine'),
    engineProfileEnvelopeSha256,
    docker: { executablePath: '/usr/bin/docker', executableSha256: d('8'),
      protectedConfigDirectory: '/var/lib/darshan-recovery/docker-client', transport: 'UNIX',
      daemonSocketIdentitySha256: d('9'), daemonIdentitySha256: d('a'), apiVersion: '1.44' },
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
          credentialIdentitySha256: d('e'), destination: '/run/credentials/postgres-password', mode: '0400',
          ownerUid: '1101', ownerGid: '1101' }] },
      { role: 'MINIO', ...common('MINIO'), entrypoint: ['/usr/bin/minio'],
        argv: ['server', '/data', '--console-address', ':9001'], workingDirectory: '/data',
        environment: [{ name: 'MINIO_ROOT_PASSWORD_FILE', value: '/run/credentials/minio-root-password' },
          { name: 'MINIO_ROOT_USER_FILE', value: '/run/credentials/minio-root-user' }],
        credentials: [{ credentialAuthorityHandle: h('credential', 'minio-password'),
          credentialIdentitySha256: d('f'), destination: '/run/credentials/minio-root-password', mode: '0400',
          ownerUid: '1102', ownerGid: '1102' },
        { credentialAuthorityHandle: h('credential', 'minio-user'),
          credentialIdentitySha256: d('0'), destination: '/run/credentials/minio-root-user', mode: '0400',
          ownerUid: '1102', ownerGid: '1102' }] },
    ],
  }));
}

function inventoryFixture(protectionInventoryEnvelopeSha256 = d('b')): ProtectedDockerInventoryV1 {
  return parseProtectedDockerInventoryV1(canonicalJson({
    format: 'darshan-recovery-protected-docker-inventory-v1', inventoryId: '00000000-0000-4000-8000-000000000002',
    authorityHandle: h('authority', 'engine'), protectionInventoryEnvelopeSha256,
    observedAt: '2026-10-29T00:00:00.000Z', completeness: { containers: true, networks: true, volumes: true,
      bindRoots: true, identities: true, relationships: true }, containers: [], networks: [], volumes: [], bindRoots: [],
    identities: ['REPOSITORY_ROOT', 'RELEASE_ROOT', 'CONFIG_ROOT', 'CONTROL_ROOT', 'DAEMON_SOCKET'].map((role, index) => ({
      role, authorityHandle: h('protected', String(index)),
      identitySha256: role === 'DAEMON_SOCKET' ? d('9') : String(index + 1).repeat(64),
      deviceMajor: '8', deviceMinor: String(index + 1), inode: String(index + 10), mountId: String(index + 20),
    })), relationships: [],
  }));
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
      MacAddressSha256: index === 0 ? d('f') : d('0'), Aliases: [profile.name] } },
    State: { Status: 'running', Running: true, Paused: false, Restarting: false, OOMKilled: false, Dead: false,
      ExitCode: 0, ErrorSha256: d('0'), Health: { Status: 'healthy', FailingStreak: 0, Policy: profile.healthcheck.policy,
        LastOutputSha256: d('0') } } };
}

function inspectFixture(profile: TargetDockerExecutionProfileV1): TargetDockerEffectiveInspectV1 {
  return parseTargetDockerEffectiveInspectV1(canonicalJson({
    format: 'darshan-recovery-docker-effective-inspect-v1', targetHandle: h('target', 'fixture'),
    executionProfileSha256: targetDockerExecutionProfileV1Sha256(profile), observationComplete: true,
    enumerationComplete: { containers: true, networkEndpoints: true, mounts: true, volumes: true, ports: true },
    containers: [effectiveContainer(profile.containers[0], 0), effectiveContainer(profile.containers[1], 1)],
    network: { NetworkAuthorityHandle: h('network', 'target'), NetworkID: ids.network,
      Name: 'darshan-recovery-internal-0123456789abcdef', Driver: 'bridge', Internal: true, Attachable: false,
      Ingress: false, EnableIPv6: false, SubnetCidr: '172.31.255.0/24', Gateway: '172.31.255.1',
      EndpointContainerIds: [ids.postgres, ids.minio], ForeignConsumerContainerIds: [] },
  }));
}

function signedEvidence(evidence: TargetStorageEvidenceV2,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): SignedTargetStorageEvidenceV2 {
  return { format: 'darshan-recovery-storage-evidence-envelope-v2', evidence,
    signature: { algorithm: 'Ed25519', keyId: 'packet-05b1b3b1a-test-authority',
      valueBase64: sign(null, targetStorageEvidenceV2SigningPayload(evidence), privateKey).toString('base64') } };
}

function signedEnrollmentEvidence() {
  const keys = generateKeyPairSync('ed25519');
  const common = { evidenceId: '00000000-0000-4000-8000-000000000010', siteId: 'site-a',
    hostInstallationId: '00000000-0000-4000-8000-000000000011', targetReleaseIdentitySha256: d('1'),
    targetLogicalIdentitySha256: d('2'), issuedAt: '2026-10-29T00:00:00.000Z',
    validFrom: '2026-10-29T00:00:01.000Z', expiresAt: '2027-10-29T00:00:00.000Z',
    revokedEnvelopeSha256: [] as string[] };
  const engineProfile = signedEvidence({ format: 'darshan-recovery-engine-profile-evidence-v2', kind: 'ENGINE_PROFILE',
    ...common, postgresUid: '1101', postgresGid: '1101', minioUid: '1102', minioGid: '1102',
    allocationDirectoryMode: '0700', postgresDirectoryMode: '0700', minioDirectoryMode: '0700',
    requiredBytes: '1000', requiredInodes: '10' }, keys.privateKey);
  const protectionInventory = signedEvidence({ format: 'darshan-recovery-protection-inventory-evidence-v2',
    kind: 'PROTECTION_INVENTORY', ...common, evidenceId: '00000000-0000-4000-8000-000000000012',
    protectedPathIdentitySha256: [d('3')], observedMountinfoSha256: d('4') }, keys.privateKey);
  return { engineProfile, protectionInventory };
}

describe('Packet 05B1b3b1a fake-only target engine foundation', () => {
  it('binds exact full v2 evidence envelopes to enrolled profile and protected inventory digests', () => {
    const evidence = signedEnrollmentEvidence();
    const engineDigest = targetStorageEvidenceV2EnvelopeSha256(evidence.engineProfile);
    const protectionDigest = targetStorageEvidenceV2EnvelopeSha256(evidence.protectionInventory);
    const profile = profileFixture(engineDigest); const inventory = inventoryFixture(protectionDigest);
    const enrollment: TargetEngineEnrollmentV1 = { format: 'darshan-recovery-target-engine-enrollment-v1',
      enrollmentId: '00000000-0000-4000-8000-000000000003', authorityHandle: h('authority', 'engine'),
      engineProfileEnvelopeSha256: engineDigest, executionProfileSha256: targetDockerExecutionProfileV1Sha256(profile),
      protectionInventoryEnvelopeSha256: protectionDigest,
      protectedDockerInventorySha256: protectedDockerInventoryV1Sha256(inventory) };
    expect(() => verifyTargetEngineEnrollmentV1({ enrollment, profile, engineProfileEnvelope: evidence.engineProfile,
      protectedInventory: inventory, protectionInventoryEnvelope: evidence.protectionInventory })).not.toThrow();
    expect(() => verifyTargetEngineEnrollmentV1({ enrollment: { ...enrollment, engineProfileEnvelopeSha256: d('c') },
      profile, engineProfileEnvelope: evidence.engineProfile, protectedInventory: inventory,
      protectionInventoryEnvelope: evidence.protectionInventory })).toThrow(/exact full evidence/);
    expect(() => verifyTargetEngineEnrollmentV1({ enrollment: { ...enrollment, shell: '/bin/sh' } as never,
      profile, engineProfileEnvelope: evidence.engineProfile, protectedInventory: inventory,
      protectionInventoryEnvelope: evidence.protectionInventory })).toThrow();
    const wrongSocket = structuredClone(inventory);
    wrongSocket.identities[4].identitySha256 = d('5');
    expect(() => verifyTargetEngineEnrollmentV1({ enrollment: { ...enrollment,
      protectedDockerInventorySha256: protectedDockerInventoryV1Sha256(wrongSocket) }, profile,
      engineProfileEnvelope: evidence.engineProfile, protectedInventory: wrongSocket,
      protectionInventoryEnvelope: evidence.protectionInventory })).toThrow(/exact full evidence/);
  });

  it.each([
    ['unknown profile field', (value: Record<string, unknown>) => { value.shell = '/bin/sh'; }],
    ['mutable image tag', (value: Record<string, unknown>) => { ((value.containers as Record<string, unknown>[])[0]!.image as Record<string, unknown>).imageId = 'postgres:16'; }],
    ['secret environment sentinel', (value: Record<string, unknown>) => { ((value.containers as Record<string, unknown>[])[0]!.environment as unknown[])?.push({ name: 'POSTGRES_PASSWORD', value: 'SECRET_SENTINEL' }); }],
    ['writable rootfs', (value: Record<string, unknown>) => { (((value.containers as Record<string, unknown>[])[0]!.security as Record<string, unknown>)).readonlyRootfs = false; }],
    ['zero resource', (value: Record<string, unknown>) => { (((value.containers as Record<string, unknown>[])[0]!.resources as Record<string, unknown>)).memoryBytes = '0'; }],
    ['credential owner mismatch', (value: Record<string, unknown>) => {
      (((value.containers as Record<string, unknown>[])[0]!.credentials as Record<string, unknown>[])[0]!).ownerUid = '0';
    }],
  ])('rejects one-field profile mutation: %s', (_label, mutate) => {
    const value = JSON.parse(encodeTargetDockerExecutionProfileV1(profileFixture()).toString()) as Record<string, unknown>;
    mutate(value); expect(() => parseTargetDockerExecutionProfileV1(canonicalJson(value))).toThrow();
  });

  it('strictly reparses typed profile and inventory objects at the exported validation boundary', () => {
    const profile = structuredClone(profileFixture()); const inventory = structuredClone(inventoryFixture());
    (profile.containers[0].resources as { pidsLimit: string }).pidsLimit = '0';
    expect(() => validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspectFixture(profileFixture())),
      profile, protectedInventory: inventory, expected: expectedIdentity() })).toThrow();
    const completeProfile = profileFixture();
    (inventory.completeness as { networks: boolean }).networks = false;
    expect(() => validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspectFixture(completeProfile)),
      profile: completeProfile, protectedInventory: inventory, expected: expectedIdentity() })).toThrow();
  });

  it('rejects duplicate profile keys and incomplete/unknown protected inventory fields', () => {
    const profile = encodeTargetDockerExecutionProfileV1(profileFixture()).toString();
    expect(() => parseTargetDockerExecutionProfileV1(Buffer.from(profile.replace('{', '{"format":"duplicate",')))).toThrow();
    const inventory = JSON.parse(encodeProtectedDockerInventoryV1(inventoryFixture()).toString()) as Record<string, unknown>;
    (inventory.completeness as Record<string, unknown>).networks = false;
    expect(() => parseProtectedDockerInventoryV1(canonicalJson(inventory))).toThrow();
    (inventory.completeness as Record<string, unknown>).networks = true; inventory.dockerEndpoint = 'unix:///var/run/docker.sock';
    expect(() => parseProtectedDockerInventoryV1(canonicalJson(inventory))).toThrow();
  });

  it('emits only fixed command enums and opaque handles', () => {
    expect(planTargetResourceCommand({ operation: 'CREATE_CONTAINER', authorityHandle: h('authority', 'engine'),
      targetHandle: h('target', 'fixture'), resourceRole: 'POSTGRES' })).toMatchObject({ operation: 'CREATE_CONTAINER',
      resourceRole: 'POSTGRES' });
    expect(() => planTargetResourceCommand({ operation: 'INSPECT_TARGET', authorityHandle: h('authority', 'engine'),
      targetHandle: h('target', 'fixture'), resourceRole: 'MINIO' })).toThrow();
    expect(() => planTargetResourceCommand({ operation: 'CREATE_CONTAINER', authorityHandle: h('authority', 'engine'),
      targetHandle: h('target', 'fixture'), resourceRole: 'POSTGRES', path: '/tmp/escape' } as never)).toThrow();
  });

  it('uses an explicit test-only scripted authority and rejects handle/order substitution', async () => {
    const profileBytes = encodeTargetDockerExecutionProfileV1(profileFixture()); const inventoryBytes = encodeProtectedDockerInventoryV1(inventoryFixture());
    const inspectBytes = encodeTargetDockerEffectiveInspectV1(inspectFixture(profileFixture()));
    const authority = new TestOnlyScriptedTargetResourceAuthority([
      { operation: 'READ_EXECUTION_PROFILE', authorityHandle: h('profile', 'fixture'), response: profileBytes },
      { operation: 'READ_PROTECTED_INVENTORY', authorityHandle: h('inventory', 'fixture'), response: inventoryBytes },
      { operation: 'INSPECT_TARGET', authorityHandle: h('target', 'fixture'), response: inspectBytes },
    ], 'TEST_ONLY_DO_NOT_USE_IN_PRODUCTION');
    await expect(authority.readExecutionProfile(h('profile', 'fixture'))).resolves.toEqual(profileBytes);
    await expect(authority.readProtectedInventory(h('inventory', 'fixture'))).resolves.toEqual(inventoryBytes);
    await expect(authority.inspectTarget(h('target', 'fixture'))).resolves.toEqual(inspectBytes); authority.assertExhausted();
    const wrong = new TestOnlyScriptedTargetResourceAuthority([
      { operation: 'INSPECT_TARGET', authorityHandle: h('target', 'fixture'), response: inspectBytes },
    ], 'TEST_ONLY_DO_NOT_USE_IN_PRODUCTION');
    await expect(wrong.inspectTarget(h('target', 'foreign'))).rejects.toThrow(/exact script/);
  });

  it('validates the complete effective state and returns hashes without env or credentials', () => {
    const profile = profileFixture(); const inspection = inspectFixture(profile);
    const summary = validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspection), profile,
      protectedInventory: inventoryFixture(), expected: expectedIdentity() });
    expect(summary).toMatchObject({ health: 'HEALTHY', targetHandle: h('target', 'fixture') });
    expect(JSON.stringify(summary)).not.toContain('POSTGRES_PASSWORD_FILE');
    expect(JSON.stringify(summary)).not.toContain('/run/credentials');
  });

  it.each([
    ['CID', (value: TargetDockerEffectiveInspectV1) => { value.containers[0].Id = d('f'); }],
    ['privilege', (value: TargetDockerEffectiveInspectV1) => { (value.containers[0].HostConfig as { Privileged: boolean }).Privileged = true; }],
    ['health', (value: TargetDockerEffectiveInspectV1) => { (value.containers[0].State.Health as { Status: string }).Status = 'unhealthy'; }],
    ['ports', (value: TargetDockerEffectiveInspectV1) => { (value.containers[0].HostConfig.PortBindings as unknown[]) = [{ HostPort: '5432' }]; }],
    ['foreign network consumer', (value: TargetDockerEffectiveInspectV1) => { (value.network.ForeignConsumerContainerIds as unknown[]) = [d('f')]; }],
    ['credential ownership', (value: TargetDockerEffectiveInspectV1) => {
      (value.containers[0].Mounts[1] as { OwnerUid: string }).OwnerUid = '0';
    }],
  ])('rejects one-field effective-state mutation: %s', (_label, mutate) => {
    const profile = profileFixture(); const inspection = structuredClone(inspectFixture(profile)); mutate(inspection);
    expect(() => validateTargetDockerEffectiveInspectV1({ raw: canonicalJson(inspection), profile,
      protectedInventory: inventoryFixture(), expected: expectedIdentity() })).toThrow();
  });

  it('rejects protected exact/ancestor overlap before accepting effective state', () => {
    const profile = profileFixture(); const inventory = JSON.parse(encodeProtectedDockerInventoryV1(inventoryFixture()).toString());
    inventory.bindRoots = [{ authorityHandle: h('allocation', 'postgres'), identitySha256: d('1'), deviceMajor: '8',
      deviceMinor: '1', inode: '30', mountId: '40', consumerContainerIds: [] }];
    const protectedInventory = parseProtectedDockerInventoryV1(canonicalJson(inventory));
    expect(() => validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspectFixture(profile)),
      profile, protectedInventory, expected: expectedIdentity() })).toThrow(/overlap/);
    const idInventoryValue = JSON.parse(encodeProtectedDockerInventoryV1(inventoryFixture()).toString());
    idInventoryValue.containers = [{ authorityHandle: h('protected-container', 'postgres'), containerId: ids.postgres,
      imageId: `sha256:${d('f')}`, state: 'RUNNING', consumerContainerIds: [] }];
    const idInventory = parseProtectedDockerInventoryV1(canonicalJson(idInventoryValue));
    expect(() => validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspectFixture(profile)),
      profile, protectedInventory: idInventory, expected: expectedIdentity() })).toThrow(/Docker IDs overlap/);
    const relationshipValue = JSON.parse(encodeProtectedDockerInventoryV1(inventoryFixture()).toString());
    relationshipValue.relationships = [{ relation: 'ANCESTOR',
      source: { domain: 'PROTECTED', role: 'CONFIG_ROOT', authorityHandle: h('protected', '2') },
      target: { domain: 'CANDIDATE', role: 'POSTGRES_BIND', authorityHandle: h('allocation', 'postgres') } }];
    const relationshipInventory = parseProtectedDockerInventoryV1(canonicalJson(relationshipValue));
    expect(() => validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspectFixture(profile)),
      profile, protectedInventory: relationshipInventory, expected: expectedIdentity() })).toThrow(/protected ancestor/);
    relationshipValue.relationships = [{ relation: 'ALIAS',
      source: { domain: 'CANDIDATE', role: 'MINIO_BIND', authorityHandle: h('allocation', 'minio') },
      target: { domain: 'PROTECTED', role: 'CONTROL_ROOT', authorityHandle: h('protected', '3') } }];
    const reverseAlias = parseProtectedDockerInventoryV1(canonicalJson(relationshipValue));
    expect(() => validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspectFixture(profile)),
      profile, protectedInventory: reverseAlias, expected: expectedIdentity() })).toThrow(/protected alias/);
    relationshipValue.relationships = [{ relation: 'ANCESTOR',
      source: { domain: 'PROTECTED', role: 'CONFIG_ROOT', authorityHandle: h('protected', '2') },
      target: { domain: 'CANDIDATE', role: 'POSTGRES_BIND', authorityHandle: h('allocation', 'foreign') } }];
    const foreignRelationship = parseProtectedDockerInventoryV1(canonicalJson(relationshipValue));
    expect(() => validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspectFixture(profile)),
      profile, protectedInventory: foreignRelationship, expected: expectedIdentity() })).toThrow(/unknown or role-confused/);
  });

  it('rejects equal protected and candidate physical identities despite distinct opaque handles', () => {
    const profile = profileFixture(); const raw = encodeTargetDockerEffectiveInspectV1(inspectFixture(profile));
    const validate = (inventory: ProtectedDockerInventoryV1) => validateTargetDockerEffectiveInspectV1({ raw, profile,
      protectedInventory: inventory, expected: expectedIdentity() });
    expect(() => validate(inventoryFixture())).not.toThrow();

    const repositoryAlias = structuredClone(inventoryFixture());
    repositoryAlias.identities[0].identitySha256 = profile.containers[0].binds[0].sourceIdentitySha256;
    expect(() => validate(parseProtectedDockerInventoryV1(encodeProtectedDockerInventoryV1(repositoryAlias))))
      .toThrow(/physical identity equals/);

    const protectedBindAlias = structuredClone(inventoryFixture());
    protectedBindAlias.bindRoots = [{ authorityHandle: h('protected-bind', 'distinct-minio'),
      identitySha256: profile.containers[1].binds[0].sourceIdentitySha256, deviceMajor: '8', deviceMinor: '1',
      inode: '50', mountId: '60', consumerContainerIds: [] }];
    expect(() => validate(parseProtectedDockerInventoryV1(encodeProtectedDockerInventoryV1(protectedBindAlias))))
      .toThrow(/physical identity equals/);

    const protectedVolumeAlias = structuredClone(inventoryFixture());
    protectedVolumeAlias.volumes = [{ authorityHandle: h('protected-volume', 'distinct-postgres'),
      volumeIdentitySha256: profile.containers[0].binds[0].sourceIdentitySha256, consumerContainerIds: [] }];
    expect(() => validate(parseProtectedDockerInventoryV1(encodeProtectedDockerInventoryV1(protectedVolumeAlias))))
      .toThrow(/physical identity equals/);

    const configCredentialAlias = structuredClone(inventoryFixture());
    configCredentialAlias.identities[2].identitySha256 = profile.containers[0].credentials[0].credentialIdentitySha256;
    expect(() => validate(parseProtectedDockerInventoryV1(encodeProtectedDockerInventoryV1(configCredentialAlias))))
      .toThrow(/physical identity equals/);

    const bindCredentialAlias = structuredClone(inventoryFixture());
    bindCredentialAlias.bindRoots = [{ authorityHandle: h('protected-bind', 'distinct-credential'),
      identitySha256: profile.containers[1].credentials[0].credentialIdentitySha256, deviceMajor: '8', deviceMinor: '2',
      inode: '51', mountId: '61', consumerContainerIds: [] }];
    expect(() => validate(parseProtectedDockerInventoryV1(encodeProtectedDockerInventoryV1(bindCredentialAlias))))
      .toThrow(/physical identity equals/);
  });

  it('rejects protected credential-handle overlap and exact credential relationships without role confusion', () => {
    const baseProfile = profileFixture(); const baseInventory = inventoryFixture();
    const validate = (profile: TargetDockerExecutionProfileV1, inventory: ProtectedDockerInventoryV1,
      raw = encodeTargetDockerEffectiveInspectV1(inspectFixture(profile))) =>
      validateTargetDockerEffectiveInspectV1({ raw, profile, protectedInventory: inventory, expected: expectedIdentity() });
    expect(() => validate(baseProfile, baseInventory)).not.toThrow();

    const configHandleProfile = structuredClone(baseProfile);
    configHandleProfile.containers[0].credentials[0].credentialAuthorityHandle = baseInventory.identities[2].authorityHandle;
    expect(() => validate(configHandleProfile, baseInventory,
      encodeTargetDockerEffectiveInspectV1(inspectFixture(baseProfile)))).toThrow(/overlap a protected identity/);

    const protectedBindHandle = structuredClone(baseInventory);
    protectedBindHandle.bindRoots = [{
      authorityHandle: baseProfile.containers[1].credentials[0].credentialAuthorityHandle,
      identitySha256: d('5'), deviceMajor: '8', deviceMinor: '3', inode: '70', mountId: '80', consumerContainerIds: [],
    }];
    expect(() => validate(baseProfile, parseProtectedDockerInventoryV1(encodeProtectedDockerInventoryV1(protectedBindHandle))))
      .toThrow(/overlap a protected identity/);

    const protectedVolumeHandle = structuredClone(baseInventory);
    protectedVolumeHandle.volumes = [{
      authorityHandle: baseProfile.containers[1].credentials[1].credentialAuthorityHandle,
      volumeIdentitySha256: d('6'), consumerContainerIds: [],
    }];
    expect(() => validate(baseProfile, parseProtectedDockerInventoryV1(encodeProtectedDockerInventoryV1(protectedVolumeHandle))))
      .toThrow(/overlap a protected identity/);

    const relationshipValue = JSON.parse(encodeProtectedDockerInventoryV1(baseInventory).toString());
    relationshipValue.relationships = [{ relation: 'ANCESTOR',
      source: { domain: 'PROTECTED', role: 'CONFIG_ROOT', authorityHandle: h('protected', '2') },
      target: { domain: 'CANDIDATE', role: 'POSTGRES_PASSWORD_CREDENTIAL',
        authorityHandle: baseProfile.containers[0].credentials[0].credentialAuthorityHandle } }];
    expect(() => validate(baseProfile, parseProtectedDockerInventoryV1(canonicalJson(relationshipValue))))
      .toThrow(/protected ancestor/);

    relationshipValue.bindRoots = [{ authorityHandle: h('protected-bind', 'credential-relation'),
      identitySha256: d('5'), deviceMajor: '8', deviceMinor: '4', inode: '71', mountId: '81', consumerContainerIds: [] }];
    relationshipValue.relationships = [{ relation: 'ALIAS',
      source: { domain: 'CANDIDATE', role: 'MINIO_ROOT_PASSWORD_CREDENTIAL',
        authorityHandle: baseProfile.containers[1].credentials[0].credentialAuthorityHandle },
      target: { domain: 'PROTECTED', role: 'PROTECTED_BIND_ROOT',
        authorityHandle: h('protected-bind', 'credential-relation') } }];
    expect(() => validate(baseProfile, parseProtectedDockerInventoryV1(canonicalJson(relationshipValue))))
      .toThrow(/protected alias/);

    relationshipValue.relationships[0].source.role = 'POSTGRES_PASSWORD_CREDENTIAL';
    expect(() => validate(baseProfile, parseProtectedDockerInventoryV1(canonicalJson(relationshipValue))))
      .toThrow(/unknown or role-confused/);
  });

  it('rejects target and unknown consumers of every protected resource class', () => {
    const profile = profileFixture(); const normal = JSON.parse(encodeProtectedDockerInventoryV1(inventoryFixture()).toString());
    normal.containers = [{ authorityHandle: h('protected-container', 'production'), containerId: d('f'),
      imageId: `sha256:${d('f')}`, state: 'RUNNING', consumerContainerIds: [] }];
    normal.networks = [{ authorityHandle: h('protected-network', 'production'), networkId: d('8'), internal: true,
      consumerContainerIds: [d('f')] }];
    normal.volumes = [{ authorityHandle: h('protected-volume', 'production'), volumeIdentitySha256: d('7'),
      consumerContainerIds: [d('f')] }];
    normal.bindRoots = [{ authorityHandle: h('protected-bind', 'production'), identitySha256: d('6'),
      deviceMajor: '8', deviceMinor: '1', inode: '31', mountId: '41', consumerContainerIds: [d('f')] }];
    const knownConsumers = parseProtectedDockerInventoryV1(canonicalJson(normal));
    expect(() => validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspectFixture(profile)),
      profile, protectedInventory: knownConsumers, expected: expectedIdentity() })).not.toThrow();
    for (const collection of ['containers', 'networks', 'volumes', 'bindRoots'] as const) {
      const targetValue = structuredClone(normal);
      targetValue[collection][0].consumerContainerIds = [ids.postgres];
      const targetConsumer = parseProtectedDockerInventoryV1(canonicalJson(targetValue));
      expect(() => validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspectFixture(profile)),
        profile, protectedInventory: targetConsumer, expected: expectedIdentity() })).toThrow(/overlap protected/);
    }
    normal.networks[0].consumerContainerIds = [d('5')];
    const unknownConsumer = parseProtectedDockerInventoryV1(canonicalJson(normal));
    expect(() => validateTargetDockerEffectiveInspectV1({ raw: encodeTargetDockerEffectiveInspectV1(inspectFixture(profile)),
      profile, protectedInventory: unknownConsumer, expected: expectedIdentity() })).toThrow(/unknown container/);
  });

  it('keeps the production worker hard-wired to unavailable and free of an engine selector', async () => {
    const worker = await readFile(new URL('../../scripts/recovery-target-helper-worker.ts', import.meta.url), 'utf8');
    expect(worker).toContain('engine: new UnavailableRecoveryTargetEngine()');
    expect(worker).not.toMatch(/TARGET_ENGINE_SELECTOR|TARGET_DOCKER_ENABLED|TargetDockerExecution/);
    const unavailable = new UnavailableRecoveryTargetEngine();
    await expect(unavailable.inspect()).rejects.toBeInstanceOf(TargetEngineNotInstalledError);
  });
});
