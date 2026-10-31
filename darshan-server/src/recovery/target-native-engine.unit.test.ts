import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { TargetEngineMaterializationJournal, TestOnlyInMemoryTargetEngineMaterializationStore,
  adoptUniqueExactOwnedResource, fixedTargetOwnershipLabels, targetOwnershipLabelsSha256 } from './target-engine-materialization';
import { assertTargetNativeEngineB1Operation, encodeTargetNativeEngineCommandV3,
  encodeTargetNativeEngineInspectionV3, encodeTargetNativeEngineProfileV2,
  parseTargetNativeEngineCommandV3, parseTargetNativeEngineInspectionV3, parseTargetNativeEngineProfileV2,
  targetNativeEngineCommandV3Sha256, targetNativeEngineProfileV2Sha256,
  type TargetNativeEngineCommandV3, type TargetNativeEngineInspectionV3,
  type TargetNativeEngineProfileV2 } from './target-native-engine-contracts';
import { TestOnlyTargetNativeEngineClient, createTargetNativeEngineContextV2,
  targetNativeEngineExpectedConfigurationSha256 } from './target-native-engine-client';
import { encodeTargetNativeAuthorityRequest,
  type TargetNativeAuthorityRequest, type TargetNativeAuthorityResult } from './target-native-authority-contracts';

const d = (value: string) => createHash('sha256').update(value).digest('hex');
const h = (role: string) => `tra:v1:${role}:abcdefghijklmnop`;
const uuid = (value: string) => `${value}0000000-0000-4000-8000-00000000000${value}`;
const descriptor = (role: string, inode: string) => ({ authorityHandle: h(role), identitySha256: d(`${role}-identity`),
  deviceMajor: '8', deviceMinor: '1', inode, mountId: '7', ownerUid: '1000', ownerGid: '1000', mode: '0700',
  allocationLedgerHeadSha256: d('ledger') });
const security = { readonlyRootfs: true as const, privileged: false as const, capAdd: [] as [], capDrop: ['ALL'] as ['ALL'],
  noNewPrivileges: true as const, seccompSha256: null, lsmProfileSha256: null,
  pidMode: 'private' as const, ipcMode: 'private' as const, utsMode: 'private' as const,
  usernsMode: 'private' as const, cgroupnsMode: 'private' as const,
  devices: [] as [], deviceRequests: [] as [], supplementaryGroups: [] as [] };
const resources = { memoryBytes: '268435456', memorySwapBytes: '268435456', cpuQuotaMicros: '100000',
  cpuPeriodMicros: '100000' as const, cpuShares: '1024', pidsLimit: '128', shmBytes: '67108864',
  oomKillDisable: false as const, oomScoreAdj: 0 };
const logging = { driver: 'local' as const, maxSize: '10m' as const, maxFiles: '3' as const, compress: true as const };
const labels = { owner: 'darshan-recovery' as const, contract: 'target-native-engine-profile-v2' as const,
  managed: 'true' as const };

function profile(): TargetNativeEngineProfileV2 {
  const postgresCredential = { ...descriptor('postgres-password', '21'), destination: '/run/credentials/postgres-password' as const,
    admittedReference: true as const, valuePresent: false as const, readOnly: true as const, mode: '0400' as const };
  const minioPassword = { ...descriptor('minio-root-password', '22'), destination: '/run/credentials/minio-root-password' as const,
    admittedReference: true as const, valuePresent: false as const, readOnly: true as const, mode: '0400' as const };
  const minioUser = { ...descriptor('minio-root-user', '23'), destination: '/run/credentials/minio-root-user' as const,
    admittedReference: true as const, valuePresent: false as const, readOnly: true as const, mode: '0400' as const };
  const image = { imageId: null, imageConfigSha256: null, repositoryDigest: null, platform: 'linux' as const,
    architecture: 'amd64' as const, operatingSystem: 'linux' as const, declaredVolumes: [] as [] };
  return {
    format: 'darshan-recovery-target-native-engine-profile-v2', profileId: uuid('1'), authorityHandle: h('profile'),
    enrollmentAvailability: 'UNAVAILABLE',
    executable: { authorityHandle: h('executable'), fixedPath: '/usr/bin/docker', contentSha256: null,
      syntheticFixtureSha256: d('fixture-only'), elfMachine: 'X86_64', fixtureCompileGate: 'RECOVERY_TARGET_ENGINE_EXECUTOR_TESTING' },
    clientConfig: { authorityHandle: h('client-config'), fixedPath: '/var/lib/darshan-recovery/docker-client',
      identitySha256: null, ownerUid: '0', ownerGid: '0', mode: '0700' },
    daemon: { transport: 'UNIX', socketAuthorityHandle: h('daemon-socket'), socketIdentitySha256: null,
      daemonIdentitySha256: null, apiVersion: '1.44', serverVersion: null },
    network: { networkAuthorityHandle: h('network'), name: 'darshan-recovery-internal-0123456789abcdef',
      driver: 'bridge', internal: true, attachable: false, ingress: false, enableIpv6: false,
      subnetCidr: '172.31.255.0/24', gatewayAddress: '172.31.255.1', postgresAddress: '172.31.255.10',
      minioAddress: '172.31.255.11' },
    containers: [{ role: 'POSTGRES', containerAuthorityHandle: h('postgres'), name: 'darshan-recovery-postgres-0123456789abcdef',
      image, numericUid: '1000', numericGid: '1000', workdir: '/var/lib/postgresql/data',
      bind: { ...descriptor('postgres-bind', '31'), destination: '/var/lib/postgresql/data', readOnly: false,
        propagation: 'rprivate', retained: true }, security, resources, logging, restartPolicy: 'no', autoRemove: false,
      tmpfs: [{ destination: '/run/postgresql', options: 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' },
        { destination: '/tmp', options: 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' }], labels,
      entrypoint: ['/usr/local/bin/docker-entrypoint.sh'], argv: ['postgres', '-c',
        'config_file=/etc/darshan-recovery/postgresql.conf'], environment: [
        { name: 'LANG', value: 'C.UTF-8' }, { name: 'POSTGRES_DB', value: 'darshan' },
        { name: 'POSTGRES_PASSWORD_FILE', value: '/run/credentials/postgres-password' },
        { name: 'POSTGRES_USER', value: 'darshan' }], credentials: [postgresCredential] },
    { role: 'MINIO', containerAuthorityHandle: h('minio'), name: 'darshan-recovery-minio-0123456789abcdef', image,
      numericUid: '1000', numericGid: '1000', workdir: '/data',
      bind: { ...descriptor('minio-bind', '32'), destination: '/data', readOnly: false, propagation: 'rprivate', retained: true },
      security, resources, logging, restartPolicy: 'no', autoRemove: false,
      tmpfs: [{ destination: '/tmp', options: 'rw,nosuid,nodev,noexec,size=67108864,mode=1777' }], labels,
      entrypoint: ['/usr/bin/minio'], argv: ['server', '/data', '--console-address', ':9001'], environment: [
        { name: 'MINIO_ROOT_PASSWORD_FILE', value: '/run/credentials/minio-root-password' },
        { name: 'MINIO_ROOT_USER_FILE', value: '/run/credentials/minio-root-user' }],
      credentials: [minioPassword, minioUser] }],
    assets: [
      { role: 'POSTGRES_CONFIG', authorityHandle: h('postgres-config'), contentSha256: null, descriptorIdentitySha256: null,
        destination: '/etc/darshan-recovery/postgresql.conf', ownerUid: '1000', ownerGid: '1000', mode: '0440', sourceState: 'COMPLETE', dispatchEnabled: false },
      { role: 'MINIO_CONFIG', authorityHandle: h('minio-config'), contentSha256: null, descriptorIdentitySha256: null,
        destination: '/etc/darshan-recovery/minio.env', ownerUid: '1000', ownerGid: '1000', mode: '0400', sourceState: 'COMPLETE', dispatchEnabled: false },
      { role: 'POSTGRES_BOOTSTRAP', authorityHandle: h('postgres-bootstrap'), contentSha256: null, descriptorIdentitySha256: null,
        destination: '/opt/darshan-recovery/bootstrap/postgres', ownerUid: '1000', ownerGid: '1000', mode: '0500', sourceState: 'FRESH', dispatchEnabled: false },
      { role: 'MINIO_BOOTSTRAP', authorityHandle: h('minio-bootstrap'), contentSha256: null, descriptorIdentitySha256: null,
        destination: '/opt/darshan-recovery/bootstrap/minio', ownerUid: '1000', ownerGid: '1000', mode: '0500', sourceState: 'PARTIAL', dispatchEnabled: false },
    ],
  };
}

function createCapableProfile(): TargetNativeEngineProfileV2 {
  const value = profile();
  return { ...value, daemon: { ...value.daemon, daemonIdentitySha256: d('daemon') } };
}

const binding = (profileSha256: string) => ({ installationId: uuid('1'), siteId: 'fixture_site',
  hostInstallationId: uuid('2'), operationId: uuid('3'), generation: '9', targetSetId: d('target-set'),
  targetHandle: h('profile'), outerEnvelopeSha256: d('outer'), requestSha256: d('request'),
  authorizationSha256: d('authorization'), profileSha256, enrollmentSha256: d('enrollment'),
  admissionSha256: d('admission'), authorityInstanceSha256: d('authority'), authorityDeadlineUnixMs: '5000', supervisorGeneration: '7' });
function command(profileSha256: string): TargetNativeEngineCommandV3 {
  return { format: 'darshan-recovery-target-native-engine-command-v3', commandId: uuid('4'),
    operation: 'ENSURE_INTERNAL_NETWORK', role: 'NETWORK', authorityHandle: h('profile'), targetHandle: h('profile'),
    binding: binding(profileSha256), resourceAuthorityHandle: h('network'), commandNonce: '1'.repeat(32),
    materializationHeadSha256: '0'.repeat(64), deadlineUnixMs: '4000' };
}
function resource(role: 'NETWORK' | 'POSTGRES' | 'MINIO', present: boolean, owner: string | null) {
  return { role, authorityHandle: h(role.toLowerCase()), state: present ? 'CREATED' as const : 'ABSENT' as const,
    configuration: present ? 'MATCH' as const : 'INCOMPLETE' as const, readiness: 'NOT_EVALUATED' as const,
    resourceId: present ? d(`${role}-id`) : null, imageId: null, imageConfigSha256: null,
    effectiveConfigurationSha256: present ? d(`${role}-config`) : null, ownerLabelsSha256: owner,
    consumerIds: [], daemonIdentitySha256: present ? d('daemon') : null, errorSha256: null };
}
function inspection(profileSha256: string, owner: string, issued = command(profileSha256)): TargetNativeEngineInspectionV3 {
  return { format: 'darshan-recovery-target-native-engine-inspect-v3', targetHandle: h('profile'),
    binding: binding(profileSha256), observedAt: '2026-10-29T00:00:00.000Z', observationComplete: true,
    absenceReliable: false, enumerationComplete: { containers: true, networks: true, mounts: true, consumers: true, daemon: true },
    network: resource('NETWORK', true, owner), postgres: resource('POSTGRES', false, null), minio: resource('MINIO', false, null),
    command: { commandSha256: targetNativeEngineCommandV3Sha256(issued), operation: issued.operation, role: issued.role,
      resourceAuthorityHandle: issued.resourceAuthorityHandle, commandNonce: issued.commandNonce,
      materializationHeadSha256: issued.materializationHeadSha256 } };
}
const handleRoles = ['PROFILE', 'EXECUTABLE', 'CLIENT_CONFIG', 'DAEMON_SOCKET', 'NETWORK', 'POSTGRES', 'MINIO',
  'POSTGRES_BIND', 'MINIO_BIND', 'POSTGRES_PASSWORD', 'MINIO_ROOT_PASSWORD', 'MINIO_ROOT_USER',
  'POSTGRES_CONFIG', 'MINIO_CONFIG', 'POSTGRES_BOOTSTRAP', 'MINIO_BOOTSTRAP'] as const;
function handleMap() {
  return handleRoles.map((role) => ({ role, authorityHandle: h(role.toLowerCase().replaceAll('_', '-')),
    identitySha256: d(role), admitted: true as const }));
}
function acquired(profileSha256: string, operation: 'INSPECT' | 'PREPARE' = 'INSPECT') {
  const immutableRequest: TargetNativeAuthorityRequest = { format: 'darshan-recovery-target-native-authority-v2',
    kind: 'ACQUIRE', operation, installationId: uuid('1'), siteId: 'fixture_site',
    hostInstallationId: uuid('2'), operationId: uuid('3'), generation: 9n, targetSetId: d('target-set'),
    targetHandle: 'rtea:v1:target:abcdefghijklmnop', profileSha256, enrollmentSha256: d('enrollment'),
    admissionSha256: d('admission'), outerEnvelopeSha256: d('outer'), requestSha256: d('request'),
    authorizationSha256: d('authorization'), deadlineUnixMs: 5_000n,
    supervisorInstanceSha256: d('authority'), supervisorGeneration: 7n, reconciledGeneration: 7n,
    challengeNonce: 'a'.repeat(32) };
  const token = 'abcdefghijklmnop';
  const immutableResult: TargetNativeAuthorityResult = { format: 'darshan-recovery-target-native-authority-result-v2',
    kind: 'ACQUIRED', outcome: operation === 'INSPECT' ? 'READONLY' : 'LEASED', sessionHandle: 'rtea:v1:session:abcdefghijklmnop',
    leaseProofSha256: createHash('sha256').update(encodeTargetNativeAuthorityRequest(immutableRequest)).update(token).digest('hex'), authorityInstanceSha256: d('authority'), supervisorGeneration: 7n,
    reconciliationRequired: false, sanitizedCode: 'OK', challengeNonce: 'a'.repeat(32) };
  return { immutableRequest, immutableResult };
}

function rawMaterializationRecord(body: Record<string, unknown>): Buffer {
  const recordSha256 = createHash('sha256').update(canonicalJson(body)).digest('hex');
  return canonicalJson({ ...body, recordSha256 });
}

function rawMaterializationStore(initial: readonly Buffer[] = []) {
  const entries: Uint8Array[] = initial.map((entry) => Buffer.from(entry));
  return { entries, store: { inodeBound: 256,
    scan: async (signal: AbortSignal) => { signal.throwIfAborted(); return entries.map((entry) => Buffer.from(entry)); },
    publishNoClobber: async (_hash: string, bytes: Uint8Array, signal: AbortSignal) => {
      signal.throwIfAborted(); entries.push(Buffer.from(bytes)); return 'PUBLISHED' as const;
    } } };
}

describe('Packet 05B1b3b2b1 native engine foundation', () => {
  it('round-trips a profile-v2 while keeping synthetic fixture and unresolved real identities unavailable', () => {
    const value = profile(); const bytes = encodeTargetNativeEngineProfileV2(value);
    expect(parseTargetNativeEngineProfileV2(bytes)).toEqual(value);
    expect(targetNativeEngineProfileV2Sha256(bytes)).toMatch(/^[a-f0-9]{64}$/);
    expect(value.enrollmentAvailability).toBe('UNAVAILABLE'); expect(value.executable.contentSha256).toBeNull();
  });

  it.each(['START_POSTGRES', 'BOOTSTRAP_MINIO', 'VERIFY_READY', 'STOP_MINIO', 'REMOVE_POSTGRES', 'PURGE'])(
    'rejects b2-only operation %s', (operation) => {
    expect(() => assertTargetNativeEngineB1Operation(operation)).toThrowError(RecoveryError);
    });

  it('strictly rejects role substitution, trailing bytes, and unknown command operations', () => {
    const p = profile(); const value = command(targetNativeEngineProfileV2Sha256(p));
    const bytes = encodeTargetNativeEngineCommandV3(value); expect(parseTargetNativeEngineCommandV3(bytes)).toEqual(value);
    expect(() => parseTargetNativeEngineCommandV3(Buffer.concat([bytes, Buffer.from('x')]))).toThrowError(RecoveryError);
    expect(() => encodeTargetNativeEngineCommandV3({ ...value, role: 'MINIO' })).toThrowError(RecoveryError);
    expect(targetNativeEngineCommandV3Sha256(bytes)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('separates explicit created state/configuration from unavailable readiness', () => {
    const p = profile(); const sha = targetNativeEngineProfileV2Sha256(p);
    const labelsSha = targetOwnershipLabelsSha256(fixedTargetOwnershipLabels({ operationId: uuid('3'),
      targetHandle: h('profile'), generation: '9', role: 'NETWORK', resourceAuthorityHandle: h('network'),
      profileSha256: sha, commandNonce: '1'.repeat(32) }));
    const value = inspection(sha, labelsSha); const parsed = parseTargetNativeEngineInspectionV3(encodeTargetNativeEngineInspectionV3(value));
    expect(parsed.network).toMatchObject({ state: 'CREATED', configuration: 'MATCH', readiness: 'NOT_EVALUATED' });
  });

  it('publishes exact durable intent/receipt replays and rejects stale/conflicting publication', async () => {
    const p = profile(); const sha = targetNativeEngineProfileV2Sha256(p); const value = command(sha);
    const journal = new TargetEngineMaterializationJournal(
      new TestOnlyInMemoryTargetEngineMaterializationStore('TEST_ONLY_DO_NOT_USE_IN_PRODUCTION'));
    const signal = new AbortController().signal; const intent = await journal.publishIntent(value, signal);
    expect(await journal.publishIntent(value, signal)).toEqual(intent);
    const labelsSha = targetOwnershipLabelsSha256(fixedTargetOwnershipLabels({ operationId: intent.operationId,
      targetHandle: intent.targetHandle, generation: intent.generation, role: intent.role,
      resourceAuthorityHandle: intent.resourceAuthorityHandle, profileSha256: intent.profileSha256,
      commandNonce: intent.commandNonce }));
    const observed = inspection(sha, labelsSha); const actual = { resourceId: observed.network.resourceId,
      imageId: null, imageConfigSha256: null, effectiveConfigurationSha256: observed.network.effectiveConfigurationSha256,
      ownerLabelsSha256: labelsSha, consumerSetSha256: d(canonicalJson([]).toString('utf8')),
      daemonIdentitySha256: observed.network.daemonIdentitySha256 };
    const receipt = await journal.publishReceipt({ intent, inspection: observed, actual, outcome: 'COMPLETE', signal });
    expect((await journal.publishReceipt({ intent, inspection: observed, actual, outcome: 'COMPLETE', signal })).recordSha256)
      .toBe(receipt.recordSha256);
    await expect(journal.publishIntent({ ...value, commandId: uuid('5'), commandNonce: '2'.repeat(32) }, signal))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_REQUEST_CONFLICT' });
  });

  it('adopts only one exact fully owned resource and rejects foreign/multiple/nonce-collision candidates', async () => {
    const p = profile(); const sha = targetNativeEngineProfileV2Sha256(p); const journal = new TargetEngineMaterializationJournal(
      new TestOnlyInMemoryTargetEngineMaterializationStore('TEST_ONLY_DO_NOT_USE_IN_PRODUCTION'));
    const intent = await journal.publishIntent(command(sha), new AbortController().signal);
    const candidate = { role: intent.role, resourceAuthorityHandle: intent.resourceAuthorityHandle, resourceId: d('resource'),
      profileSha256: intent.profileSha256, admissionSha256: intent.admissionSha256, commandNonce: intent.commandNonce,
      ownerLabelsSha256: d('labels'), effectiveConfigurationSha256: d('config'), consumerSetSha256: d('consumers'),
      daemonIdentitySha256: d('daemon'), complete: true };
    expect(adoptUniqueExactOwnedResource({ intent, candidates: [candidate], expectedOwnerLabelsSha256: d('labels'),
      expectedConfigurationSha256: d('config'), expectedConsumerSetSha256: d('consumers'),
      expectedDaemonIdentitySha256: d('daemon') })).toEqual(candidate);
    expect(() => adoptUniqueExactOwnedResource({ intent, candidates: [candidate, { ...candidate }],
      expectedOwnerLabelsSha256: d('labels'), expectedConfigurationSha256: d('config'),
      expectedConsumerSetSha256: d('consumers'), expectedDaemonIdentitySha256: d('daemon') })).toThrowError(RecoveryError);
    expect(() => adoptUniqueExactOwnedResource({ intent, candidates: [{ ...candidate, complete: false }],
      expectedOwnerLabelsSha256: d('labels'), expectedConfigurationSha256: d('config'),
      expectedConsumerSetSha256: d('consumers'), expectedDaemonIdentitySha256: d('daemon') })).toThrowError(RecoveryError);
  });

  it('builds immutable context only from the acquired request/map and fences session, generation, and deadline', async () => {
    const p = profile(); const sha = targetNativeEngineProfileV2Sha256(p); const authority = acquired(sha);
    const context = createTargetNativeEngineContextV2({ acquired: authority, profile: p, handles: handleMap() });
    expect(Object.isFrozen(context.profile.containers[0].environment)).toBe(true);
    expect(() => createTargetNativeEngineContextV2({ acquired: { ...authority,
      immutableResult: { ...authority.immutableResult, supervisorGeneration: 8n } }, profile: p, handles: handleMap() }))
      .toThrowError(RecoveryError);
    const channel = { descriptor: 9,
      sessionAlive: async (handle: string) => handle === authority.immutableResult.sessionHandle,
      dispatchFixed: async () => { throw new Error('readonly dispatch forbidden'); },
      inspectFixed: async (frame: Uint8Array) => {
        const issued = parseTargetNativeEngineCommandV3(frame);
        return encodeTargetNativeEngineInspectionV3(inspection(sha, d('unused'), issued));
      },
      joinFixed: async () => undefined, cancelAndJoinFixed: async () => undefined };
    const journal = new TargetEngineMaterializationJournal(
      new TestOnlyInMemoryTargetEngineMaterializationStore('TEST_ONLY_DO_NOT_USE_IN_PRODUCTION'));
    const client = TestOnlyTargetNativeEngineClient.createTestOnly(channel, journal, () => 1_000n);
    await expect(client.inspect(context, { commandId: uuid('4'), commandNonce: '2'.repeat(32),
      materializationHeadSha256: '0'.repeat(64), deadlineUnixMs: 4_000n,
      signal: new AbortController().signal })).resolves.toMatchObject({
        command: { operation: 'INSPECT_TARGET', role: null, commandNonce: '2'.repeat(32) },
      });
    await expect(client.inspect(context, { commandId: uuid('4'), commandNonce: '2'.repeat(32),
      materializationHeadSha256: '0'.repeat(64), deadlineUnixMs: 6_000n,
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_PROTOCOL_INVALID' });
    const dead = TestOnlyTargetNativeEngineClient.createTestOnly({ ...channel, sessionAlive: async () => false }, journal, () => 1_000n);
    await expect(dead.inspect(context, { commandId: uuid('4'), commandNonce: '2'.repeat(32),
      materializationHeadSha256: '0'.repeat(64), deadlineUnixMs: 4_000n,
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
  });

  it('creates only after exact inspection evidence and always cancels/joins a possibly launched dispatch', async () => {
    const p = createCapableProfile(); const sha = targetNativeEngineProfileV2Sha256(p);
    const context = createTargetNativeEngineContextV2({ acquired: acquired(sha, 'PREPARE'), profile: p, handles: handleMap() });
    const store = new TestOnlyInMemoryTargetEngineMaterializationStore('TEST_ONLY_DO_NOT_USE_IN_PRODUCTION');
    const journal = new TargetEngineMaterializationJournal(store); let cancelled = 0; let joined = 0;
    const channel = { descriptor: 9, sessionAlive: async () => true, dispatchFixed: async () => undefined,
      inspectFixed: async (frame: Uint8Array) => {
        const issued = parseTargetNativeEngineCommandV3(frame);
        const owner = targetOwnershipLabelsSha256(fixedTargetOwnershipLabels({ operationId: issued.binding.operationId,
          targetHandle: issued.targetHandle, generation: issued.binding.generation, role: 'NETWORK',
          resourceAuthorityHandle: issued.resourceAuthorityHandle, profileSha256: issued.binding.profileSha256,
          commandNonce: issued.commandNonce }));
        const observed = inspection(sha, owner, issued);
        return encodeTargetNativeEngineInspectionV3({ ...observed, network: { ...observed.network,
          effectiveConfigurationSha256: targetNativeEngineExpectedConfigurationSha256(p, 'NETWORK') } });
      }, joinFixed: async () => { joined++; }, cancelAndJoinFixed: async () => { cancelled++; } };
    const client = TestOnlyTargetNativeEngineClient.createTestOnly(channel, journal, () => 1_000n);
    await expect(client.create(context, { commandId: uuid('4'), operation: 'ENSURE_INTERNAL_NETWORK',
      commandNonce: '1'.repeat(32), materializationHeadSha256: '0'.repeat(64), deadlineUnixMs: 4_000n,
      signal: new AbortController().signal })).resolves.toMatchObject({ inspection: { command: { operation: 'ENSURE_INTERNAL_NETWORK' } } });
    expect({ cancelled, joined, records: (await store.scan(new AbortController().signal)).length })
      .toEqual({ cancelled: 1, joined: 1, records: 2 });
  });

  it.each([
    ['foreign daemon', { daemonIdentitySha256: d('foreign-daemon') }],
    ['foreign image', { imageId: `sha256:${d('foreign-image')}` }],
    ['foreign image config', { imageConfigSha256: d('foreign-image-config') }],
    ['foreign effective config', { effectiveConfigurationSha256: d('foreign-config') }],
    ['foreign consumers', { consumerIds: [d('foreign-consumer')] }],
    ['running state', { state: 'RUNNING' as const }],
  ] satisfies Array<[string, Partial<TargetNativeEngineInspectionV3['network']>]>)('rejects %s create observation only after cleanup',
    async (_label, substitution) => {
    const p = createCapableProfile(); const sha = targetNativeEngineProfileV2Sha256(p);
    const context = createTargetNativeEngineContextV2({ acquired: acquired(sha, 'PREPARE'), profile: p, handles: handleMap() });
    const store = new TestOnlyInMemoryTargetEngineMaterializationStore('TEST_ONLY_DO_NOT_USE_IN_PRODUCTION');
    const journal = new TargetEngineMaterializationJournal(store); let cancelled = 0; let joined = 0;
    const channel = { descriptor: 9, sessionAlive: async () => true, dispatchFixed: async () => undefined,
      inspectFixed: async (frame: Uint8Array) => {
        const issued = parseTargetNativeEngineCommandV3(frame);
        const owner = targetOwnershipLabelsSha256(fixedTargetOwnershipLabels({ operationId: issued.binding.operationId,
          targetHandle: issued.targetHandle, generation: issued.binding.generation, role: 'NETWORK',
          resourceAuthorityHandle: issued.resourceAuthorityHandle, profileSha256: issued.binding.profileSha256,
          commandNonce: issued.commandNonce }));
        const observed = inspection(sha, owner, issued);
        return encodeTargetNativeEngineInspectionV3({ ...observed, network: { ...observed.network,
          effectiveConfigurationSha256: targetNativeEngineExpectedConfigurationSha256(p, 'NETWORK'), ...substitution } });
      }, joinFixed: async () => { joined++; }, cancelAndJoinFixed: async () => { cancelled++; } };
    const client = TestOnlyTargetNativeEngineClient.createTestOnly(channel, journal, () => 1_000n);
    await expect(client.create(context, { commandId: uuid('7'), operation: 'ENSURE_INTERNAL_NETWORK',
      commandNonce: '7'.repeat(32), materializationHeadSha256: '0'.repeat(64), deadlineUnixMs: 4_000n,
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    expect({ cancelled, joined, records: (await store.scan(new AbortController().signal)).length })
      .toEqual({ cancelled: 1, joined: 1, records: 1 });
    });

  it('treats a thrown or expired possibly launched dispatch as ambiguous after mandatory cleanup', async () => {
    const p = profile(); const sha = targetNativeEngineProfileV2Sha256(p);
    const context = createTargetNativeEngineContextV2({ acquired: acquired(sha, 'PREPARE'), profile: p, handles: handleMap() });
    for (const mode of ['throw', 'expire'] as const) {
      const store = new TestOnlyInMemoryTargetEngineMaterializationStore('TEST_ONLY_DO_NOT_USE_IN_PRODUCTION');
      const journal = new TargetEngineMaterializationJournal(store); let cancelled = 0; let now = 1_000n;
      const channel = { descriptor: 9, sessionAlive: async () => true,
        dispatchFixed: async () => { if (mode === 'throw') throw new Error('lost response'); now = 4_001n; },
        inspectFixed: async () => { throw new Error('must not inspect'); }, joinFixed: async () => undefined,
        cancelAndJoinFixed: async () => { cancelled++; } };
      const client = TestOnlyTargetNativeEngineClient.createTestOnly(channel, journal, () => now);
      await expect(client.create(context, { commandId: uuid(mode === 'throw' ? '4' : '5'), operation: 'ENSURE_INTERNAL_NETWORK',
        commandNonce: (mode === 'throw' ? '2' : '3').repeat(32), materializationHeadSha256: '0'.repeat(64),
        deadlineUnixMs: 4_000n, signal: new AbortController().signal }))
        .rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
      expect(cancelled).toBe(1);
      expect((await store.scan(new AbortController().signal)).length).toBe(1);
    }
  });

  it('fail-stops an uncertain cancel/join without publishing a terminal receipt', async () => {
    const p = profile(); const sha = targetNativeEngineProfileV2Sha256(p);
    const context = createTargetNativeEngineContextV2({ acquired: acquired(sha, 'PREPARE'), profile: p, handles: handleMap() });
    const store = new TestOnlyInMemoryTargetEngineMaterializationStore('TEST_ONLY_DO_NOT_USE_IN_PRODUCTION');
    const journal = new TargetEngineMaterializationJournal(store);
    const client = TestOnlyTargetNativeEngineClient.createTestOnly({ descriptor: 9, sessionAlive: async () => true,
      dispatchFixed: async () => undefined, inspectFixed: async () => { throw new Error('must not inspect'); },
      joinFixed: async () => undefined, cancelAndJoinFixed: async () => { throw new Error('liveness unknown'); } },
    journal, () => 1_000n);
    await expect(client.create(context, { commandId: uuid('6'), operation: 'ENSURE_INTERNAL_NETWORK',
      commandNonce: '6'.repeat(32), materializationHeadSha256: '0'.repeat(64), deadlineUnixMs: 4_000n,
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    expect((await store.scan(new AbortController().signal)).length).toBe(1);
  });

  it('rejects canonical self-hashed intent with an invalid operation/role pair during scan', async () => {
    const p = profile(); const sha = targetNativeEngineProfileV2Sha256(p);
    const bytes = rawMaterializationRecord({ format: 'darshan-recovery-target-materialization-intent-v2', kind: 'INTENT',
      sequence: '1', operationId: uuid('3'), operation: 'CREATE_MINIO', targetHandle: h('profile'), generation: '9',
      role: 'NETWORK', resourceAuthorityHandle: h('network'), profileSha256: sha, admissionSha256: d('admission'),
      commandSha256: d('invalid-action-role'), commandNonce: '8'.repeat(32), previousHeadSha256: '0'.repeat(64) });
    const raw = rawMaterializationStore([bytes]); const journal = new TargetEngineMaterializationJournal(raw.store);
    await expect(journal.scan(new AbortController().signal))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_PROTOCOL_INVALID' });
  });

  it('rejects canonical self-hashed COMPLETE receipt with null actual identities during scan', async () => {
    const p = profile(); const sha = targetNativeEngineProfileV2Sha256(p); const issued = command(sha);
    const raw = rawMaterializationStore(); const journal = new TargetEngineMaterializationJournal(raw.store);
    const signal = new AbortController().signal; const intent = await journal.publishIntent(issued, signal);
    raw.entries.push(rawMaterializationRecord({ format: 'darshan-recovery-target-materialization-receipt-v2', kind: 'RECEIPT',
      sequence: '2', operationId: intent.operationId, operation: intent.operation, targetHandle: intent.targetHandle,
      generation: intent.generation, role: intent.role, resourceAuthorityHandle: intent.resourceAuthorityHandle,
      profileSha256: intent.profileSha256, admissionSha256: intent.admissionSha256,
      commandSha256: intent.commandSha256, commandNonce: intent.commandNonce, previousHeadSha256: intent.recordSha256,
      intentRecordSha256: intent.recordSha256, observationSha256: d('invalid-complete'), outcome: 'COMPLETE',
      actual: { resourceId: null, imageId: null, imageConfigSha256: null, effectiveConfigurationSha256: null,
        ownerLabelsSha256: null, consumerSetSha256: null, daemonIdentitySha256: null } }));
    await expect(journal.scan(signal)).rejects.toMatchObject({ code: 'RECOVERY_TARGET_PROTOCOL_INVALID' });
  });
});

