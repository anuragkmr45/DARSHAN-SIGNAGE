import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { digest } from '../../src/recovery/controlled-docker/contracts';
import { runPacketCE2E } from '../../src/recovery/controlled-docker/controlled-recovery-e2e-harness';
import { developmentD3ActivationSchema, loadDevelopmentD3Activation, verifyDevelopmentD3PacketAssets, verifyDevelopmentD3Tools } from './controlled-recovery-d3-activation';
import { FixedD3Backup, requestFromD3Publication, type D3PublicationReceipt } from './controlled-recovery-d3-backup';
import { createDevelopmentD3FixedEffects } from './controlled-recovery-d3-composition';
import { DEVELOPMENT_D3_MISSING_INSTALLED_BOUNDARIES, loadCheckedInD3Boundary, runCheckedInD3Controller } from './controlled-recovery-d3-controller';
import { D3_CMS_API_ROUTES, D3_CMS_SELECTORS, runD3CmsLive } from './controlled-recovery-d3-cms';
import { FixedD3Docker } from './controlled-recovery-d3-docker';
import type { D3DockerExecution } from './controlled-recovery-d3-docker';
import { D3_REQUIRED_AVAILABLE_BYTES, DevelopmentD3HarnessBoundary, StageAwareD3Readiness,
  type D3Journal, type D3LiveObservation, type D3OwnedResource, type D3ReadinessObservation, type D3Stage, type D3StageDriver, type D3StageReceipt } from './controlled-recovery-d3-effects';
import { buildD3FixtureInventory, generatedD3FixtureBodies } from './controlled-recovery-d3-fixtures';
import { RealDevelopmentD3Effects, exactOwnedResourceIds, type D3FixedStageActions } from './controlled-recovery-d3-installed-effects';
import { runD3Player } from './controlled-recovery-d3-player';
import { D3_REQUIRED_TOOLS, FixedD3ProcessSupervisor, assertD3Tools, fixedD3BackendConfig, fixedD3BackendProductionEnv } from './controlled-recovery-d3-process';
import type { D3ProcessExecution } from './controlled-recovery-d3-process';
import { D3ContainerToolRunner } from './controlled-recovery-d4-tools';
import { FixedD3Recovery } from './controlled-recovery-d3-recovery';
import { ComposedD3ReadinessObserver } from './controlled-recovery-d3-readiness';
import { seedD3CurrentSchema } from './controlled-recovery-d3-seed';
import { developmentD2ActivationSchema } from './controlled-recovery-d2';
import { developmentReadinessActivationSchema, type DevelopmentReadinessSystem } from './controlled-recovery-readiness';
import d2Json from '../../../deploy/development/controlled-recovery/tiny-e2e-d2.activation.json';
import d1Json from '../../../deploy/development/controlled-recovery/tiny-readiness.activation.json';
import { testD3Identity, testD3Operation, testD3BackupEvidence, testWrapperAuthority, testWrapperLabels } from './controlled-recovery-d3.test-support';

const h = (value: string) => digest(value); const physical = h('physical-source-target');
const containerToolsAuthority = { ...testWrapperAuthority, enrolled: true, imageReference: 'darshan-d3-tools:packet-d4' as const, imageId: `sha256:${'d'.repeat(64)}`, repoDigest: `darshan-d3-tools@sha256:${'e'.repeat(64)}`,
  configSha256: h('tools-config'), dockerfileSha256: h('dockerfile'), lockSha256: h('lock'), agePackageVersion: '1.0-r0', ffmpegPackageVersion: '1.0-r0' };
const containerToolsObservation = { imageId: containerToolsAuthority.imageId, repoDigests: [containerToolsAuthority.repoDigest!], configSha256: containerToolsAuthority.configSha256!,
  labels: { ...testWrapperLabels, 'com.darshan.development-only': 'true', 'com.darshan.d3.role': 'container-tools', 'com.darshan.d3.age-apk-version': '1.0-r0', 'com.darshan.d3.ffmpeg-apk-version': '1.0-r0' } };
async function enrolledControllerFixture() { const activation = await loadDevelopmentD3Activation(); return developmentD3ActivationSchema.parse({ ...activation, container_tools: { ...activation.container_tools,
  enrolled: true, image_id: containerToolsAuthority.imageId, repo_digest: containerToolsAuthority.repoDigest, config_sha256: containerToolsAuthority.configSha256, age_package_version: '1.0-r0', ffmpeg_package_version: '1.0-r0',
  wrapper_sha256: testWrapperAuthority.wrapperSourceSha256, wrapper_binary_sha256: testWrapperAuthority.wrapperBinarySha256 } }); }
const resource = (role = 'postgres'): D3OwnedResource => ({ role, name: `darshan-d2-20261030-${role}`, id: 'a'.repeat(64), labelsSha256: h(`labels-${role}`), memoryBytes: '268435456', nanoCpus: '500000000', pidsLimit: 128, running: true });
const observation = (content: string, retainedResources: readonly D3OwnedResource[] = []): D3LiveObservation => ({ physicalSourceTargetSha256: physical, mutableContentSha256: h(content), liveInvariantSha256: h(`invariant-${content}`), retainedResources });
const receipt = (stage: D3Stage, live: D3LiveObservation, seal = false): D3StageReceipt => ({ stage, evidenceSha256: h(`evidence-${stage}`), physicalSourceTargetSha256: live.physicalSourceTargetSha256,
  mutableContentSha256: live.mutableContentSha256, ...(seal ? { sourceContentSealSha256: live.mutableContentSha256 } : {}), liveInvariantSha256: live.liveInvariantSha256,
  measurementEvidenceSha256: h(`measurement-${stage}`), durationMs: '7', peakMemoryBytes: '123', hostSwapUsedBytes: '9', retainedResources: [...live.retainedResources],
  ...(stage === 'CLEANUP_EXACT_OWNED_RESOURCES' ? { ownedResourceIdsSha256: h('cleanup') } : {}) });
class Journal implements D3Journal { values: D3StageReceipt[] = []; async completed() { return this.values; } async append(value: D3StageReceipt) { this.values.push(value); } }
const ready = (ownedResources: readonly D3OwnedResource[] = [], foreignResources: readonly D3OwnedResource[] = [], availableRamBytes = D3_REQUIRED_AVAILABLE_BYTES): D3ReadinessObservation =>
  ({ prerequisite: { availableRamBytes, requiredRamBytes: D3_REQUIRED_AVAILABLE_BYTES, workspaceFreeBytes: '9999999999', requiredWorkspaceBytes: '1', targetFreeBytes: '9999999999', requiredTargetBytes: '1',
    swapInUseBytes: '0', maximumSwapInUseBytes: '3221225472', firefoxUntouched: true, enrolledAssetsSha256: h('d1') }, pressureUnsafe: false, ownedResources, foreignResources,
    toolsEvidenceSha256: h('tools'), cgroupEvidenceSha256: h('cgroup') });

describe('Activation Packet D3 static effects foundation', () => {
  it('loads enabled D3 activation and verifies real Packet A/B/C file evidence instead of fabricated hashes', async () => {
    const activation = await loadDevelopmentD3Activation(); const verified = await verifyDevelopmentD3PacketAssets(activation);
    expect(activation).toMatchObject({ enabled: true, non_production: true, firefox_untouched: true });
    expect(activation.tools.filter(({ enrolled }) => enrolled).map(({ role }) => role)).toEqual(['node20', 'playwright-package', 'playwright-api', 'playwright-cli', 'playwright-browser-catalog', 'playwright-chromium', 'electron-package', 'electron-player']);
    expect(activation.tools.some(({ enrolled }) => !enrolled)).toBe(false); expect(activation.container_tools).toMatchObject({
      age_package_version: '1.3.2-r1',
      ffmpeg_package_version: '8.1.3-r0',
      build_base_apk_version: '0.5-r4', wrapper_binary_path: '/usr/local/bin/darshan-d3-tool',
    });
    if (!activation.container_tools.enrolled) expect(activation.container_tools).toMatchObject({ image_id: null, repo_digest: null, config_sha256: null, wrapper_binary_sha256: null });
    expect(activation.tools.every(({ path, resolved_path }) => path === resolved_path)).toBe(true); await expect(verifyDevelopmentD3Tools(activation)).resolves.toMatch(/^[a-f0-9]{64}$/);
    const symlinkOnly = structuredClone(activation); const electron = symlinkOnly.tools.find(({ role }) => role === 'electron-player')!; electron.path = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-player/node_modules/.bin/electron'; electron.resolved_path = electron.path;
    await expect(verifyDevelopmentD3Tools(symlinkOnly)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_TOOL_UNAVAILABLE' });
    expect(verified.profileSha256).toMatch(/^[a-f0-9]{64}$/); expect(verified.profileSha256).not.toMatch(/^0+$/);
  });

  it('is D1-strict before stage one and thereafter admits only exact retained owned resources with the 2,592 MiB gate', async () => {
    let observed = ready(); const gate = new StageAwareD3Readiness({ observe: async () => observed });
    await expect(gate.assert('SEED_REPRESENTATIVE_DATA', [])).resolves.toMatchObject({ requiredRamBytes: '2717908992' });
    observed = ready([resource()]); await expect(gate.assert('SEED_REPRESENTATIVE_DATA', [])).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_OWNED_RESOURCE_CHANGED' });
    const seed = receipt('SEED_REPRESENTATIVE_DATA', observation('seed', [resource()])); await expect(gate.assert('CREATE_ENCRYPTED_BACKUP', [seed])).resolves.toBeDefined();
    observed = ready([]); await expect(gate.assert('CREATE_ENCRYPTED_BACKUP', [seed])).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_OWNED_RESOURCE_CHANGED' });
    observed = ready([resource()], [resource('foreign')]); await expect(gate.assert('CREATE_ENCRYPTED_BACKUP', [seed])).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_FOREIGN_RESOURCE' });
    observed = ready([resource()], [], '2717908991'); await expect(gate.assert('CREATE_ENCRYPTED_BACKUP', [seed])).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_PRESSURE_UNSAFE' });
  });

  it('composes measured D1 disk/artifact/daemon/image truth with tools, cgroups and exact D3 resources', async () => {
    const d1 = developmentReadinessActivationSchema.parse(structuredClone(d1Json)); const socket = { kind: 'socket' as const, uid: 1000, gid: 1000, mode: 0o660, dev: '1', ino: '2', size: '0' };
    const daemon = { ID: 'd3-daemon', Name: 'dev', Driver: 'overlay2', ServerVersion: d1.docker.expected_server_version, DockerRootDir: d1.docker.expected_root_dir, SecurityOptions: ['name=seccomp'] };
    d1.docker.expected_socket_sha256 = digest(socket); d1.docker.expected_daemon_sha256 = digest({ id: daemon.ID, name: daemon.Name, driver: daemon.Driver, serverVersion: daemon.ServerVersion, rootDir: daemon.DockerRootDir, securityOptions: daemon.SecurityOptions });
    const system: DevelopmentReadinessSystem = { readText: async (path) => path === '/proc/meminfo' ? 'MemAvailable: 4194304 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n' : 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
      fileStat: async (path) => path === d1.docker.socket_path ? socket : { kind: 'file', uid: 1000, gid: 1000, mode: 0o755, dev: '1', ino: '3', size: '1' },
      fileSystemStat: async (path) => path === d1.paths.workspace ? { availableBytes: '8000000000', availableInodes: '70000' } : { availableBytes: '9000000000', availableInodes: '80000' },
      inspectDockerContext: async () => Buffer.from(JSON.stringify([{ Name: d1.docker.context, Endpoints: { docker: { Host: d1.docker.endpoint, SkipTLSVerify: false } } }])),
      inspectDockerDaemon: async () => Buffer.from(JSON.stringify(daemon)), inspectDockerImages: async () => Buffer.from(JSON.stringify(d1.docker.images.map((image) => ({ Id: image.image_id, RepoDigests: [image.repo_digest] })))),
      listRunningDockerContainers: async () => Buffer.from('{"ID":"owned"}\n') };
    const enrolled = Object.fromEntries(D3_REQUIRED_TOOLS.map(({ role }) => [role, { sha256: h(role), version: 'reviewed' }])); enrolled.node20 = { sha256: h('node20'), version: 'v20.20.2' };
    const observer = new ComposedD3ReadinessObserver(d1, system, { observe: async () => ({ owned: [resource()], foreign: [] }) },
      { observe: async (path) => { const tool = D3_REQUIRED_TOOLS.find((value) => value.path === path)!; return { regular: true, executable: true, ...enrolled[tool.role]! }; } }, enrolled,
      containerToolsAuthority, { observe: async () => containerToolsObservation }, { prove: async () => ({ available: true, delegationSha256: h('delegation') }) });
    const value = await observer.observe(); expect(value.prerequisite).toMatchObject({ workspaceFreeBytes: '8000000000', targetFreeBytes: '9000000000', firefoxUntouched: true });
    expect(value.ownedResources).toHaveLength(1); expect(value.toolsEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('seals mutable source content only after stop and retains measured resume evidence', async () => {
    const journal = new Journal(); let current = observation('seed'); let calls = 0; const readiness = { assert: vi.fn(async () => ({}) as never) };
    const driver: D3StageDriver = { execute: async (stage) => { calls += 1; return receipt(stage, current, stage === 'STOP_SOURCE_APPLICATION'); }, observe: async () => current };
    const boundary = new DevelopmentD3HarnessBoundary(readiness, driver, journal);
    await boundary.execute('SEED_REPRESENTATIVE_DATA'); current = observation('backup'); await boundary.execute('CREATE_ENCRYPTED_BACKUP'); current = observation('sealed'); await boundary.execute('STOP_SOURCE_APPLICATION');
    const stop = journal.values[2]!; current = { ...current, liveInvariantSha256: stop.liveInvariantSha256 }; const resumed = await boundary.execute('STOP_SOURCE_APPLICATION') as D3StageReceipt;
    expect(resumed.durationMs).toBe('7'); expect(resumed.peakMemoryBytes).toBe('123'); expect(resumed.hostSwapUsedBytes).toBe('9'); expect(calls).toBe(3);
    current = observation('mutated-after-stop'); await expect(boundary.execute('PREPARE_WITH_ONE_INTERRUPTION')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_CONTENT_CHANGED' });
    current = { ...observation('sealed'), physicalSourceTargetSha256: h('different-physical') }; await expect(boundary.execute('PREPARE_WITH_ONE_INTERRUPTION')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_TARGET_CHANGED' });
    const crashedJournal = new Journal(); const crashed = new DevelopmentD3HarnessBoundary(readiness, { observe: async () => null, execute: async () => { throw new Error('injected-stage-crash'); } }, crashedJournal);
    await expect(crashed.execute('SEED_REPRESENTATIVE_DATA')).rejects.toThrow('injected-stage-crash'); expect(crashedJournal.values).toEqual([]);
  });

  it('restarts from a durable prefix with retained containers and validates only the latest authoritative checkpoint', async () => {
    const retained = [resource()]; const journal = new Journal(); const sealed = observation('sealed', retained);
    journal.values.push(receipt('SEED_REPRESENTATIVE_DATA', observation('obsolete-seed', retained)), receipt('CREATE_ENCRYPTED_BACKUP', observation('obsolete-backup', retained)), receipt('STOP_SOURCE_APPLICATION', sealed, true));
    let owned: readonly D3OwnedResource[] = retained; const gate = new StageAwareD3Readiness({ observe: async () => ready(owned) }); const observed: D3Stage[] = [];
    const driver: D3StageDriver = { observe: async (stage) => { observed.push(stage); return stage === 'STOP_SOURCE_APPLICATION' ? sealed : observation('sealed', owned); },
      execute: async (stage) => { if (stage === 'CLEANUP_EXACT_OWNED_RESOURCES') owned = []; return receipt(stage, observation('sealed', owned), false); } };
    const restarted = new DevelopmentD3HarnessBoundary(gate, driver, journal);
    const result = await runPacketCE2E({ activation: { mode: 'TINY_DISPOSABLE_PACKET_C', nonProduction: true, siteId: 'tiny-d1-development', profileSha256: h('profile'), packetAEnrolled: true, packetBEnrolled: true, packetCEnrolled: true },
      confirmation: 'RUN_TINY_DISPOSABLE_PACKET_C', boundary: restarted });
    expect(result.completed).toBe(true); expect(journal.values).toHaveLength(12); expect(observed).not.toContain('SEED_REPRESENTATIVE_DATA'); expect(observed).not.toContain('CREATE_ENCRYPTED_BACKUP');
    expect(journal.values[0]!.durationMs).toBe('7'); expect(journal.values[1]!.measurementEvidenceSha256).toBe(h('measurement-CREATE_ENCRYPTED_BACKUP'));
  });

  it('uses fixed Docker argv/resources, fixed Node cgroups, and rejects absent tool enrollment', async () => {
    const activation = developmentD2ActivationSchema.parse(d2Json); let dockerCall: Parameters<D3DockerExecution['executeFixed']>[0] | undefined;
    const executeFixed: D3DockerExecution['executeFixed'] = vi.fn(async (input) => { dockerCall = input; return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }; });
    const docker = new FixedD3Docker(activation, { executeFixed }); await docker.createBase('minio'); expect(dockerCall).toBeDefined(); if (!dockerCall) throw new Error('missing Docker call');
    expect(dockerCall.executable).toBe('/usr/bin/docker'); expect(dockerCall.argv).toContain('type=volume,src=darshan-d2-20261030-minio,dst=/data');
    expect(dockerCall.argv).toContain(activation.images.find(({ role }) => role === 'minio')!.image_id);
    expect(dockerCall.argv).not.toEqual(expect.arrayContaining(['pull', 'build', '-p', '--publish']));
    const pgMetadata = { id: activation.images.find(({ role }) => role === 'postgres')!.image_id, entrypoint: ['/usr/local/bin/docker-entrypoint.sh'], volumes: ['/var/lib/postgresql/data'], defaultUser: '', postgresUid: '70' as const, postgresGid: '70' as const };
    await docker.createPostgresInit(pgMetadata); const init = dockerCall!.argv; expect(init).toEqual(expect.arrayContaining(['POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password', '--cap-add', 'CHOWN', '--tmpfs', '/run/postgresql:rw,noexec,nosuid,size=16m']));
    expect(init.join(' ')).not.toMatch(/POSTGRES_PASSWORD=(?!_FILE)/); await docker.createPostgresRuntime(pgMetadata); const runtime = dockerCall!.argv;
    expect(runtime).toEqual(expect.arrayContaining(['--user', '70:70', '--entrypoint', 'postgres', '--cap-drop', 'ALL', '--health-cmd', 'pg_isready -U darshan -d darshan']));
    let launched: Parameters<D3ProcessExecution['spawnFixed']>[0] | undefined;
    const spawnFixed: D3ProcessExecution['spawnFixed'] = vi.fn(async (input) => { launched = input; return { processId: 'fixed', cgroupEvidenceSha256: h('cgroup') }; });
    const prepare = vi.fn(async (input) => ({ ambientDotenvAbsent: input.cwd.endsWith('/runtime-empty'), modeEvidenceSha256: h('modes'), targetEvidenceSha256: digest(input.secretTargets) }));
    const process = new FixedD3ProcessSupervisor({ spawnFixed }, { prepare }, { ageIdentity: await testD3Identity(), containerToolsConfigSha256: h('container-tools'), brokerPolicySha256: h('policy'), capsuleGeneration: 'd3-v1', capsuleSha256: h('capsule'), repositoryDeviceId: '1', spoolDeviceId: '1', ownerUid: '1000', ownerGid: '1000' });
    await process.launch('api', { postgresIp: '172.20.0.2', minioIp: '172.20.0.3', valkeyIp: '172.20.0.4' }); expect(launched).toBeDefined(); if (!launched) throw new Error('missing process call');
    expect(launched).toMatchObject({ executable: '/home/hexmon/.nvm/versions/node/v20.20.2/bin/node', cwd: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/runtime-empty', cgroup: { memoryMax: '402653184', pidsMax: 128 },
      env: { NODE_ENV: 'production', DISPLAY: '', DARSHAN_CONFIG_FILE: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/config/backend.json', DATABASE_URL_FILE: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/secrets/database-url' } });
    expect(JSON.stringify(launched.env)).not.toMatch(/DATABASE_HOST|MINIO_HOST|VALKEY_HOST|DOCKER_HOST|http_proxy/i); expect(prepare).toHaveBeenCalledOnce();
    await process.launch('player', { postgresIp: '172.20.0.2', minioIp: '172.20.0.3', valkeyIp: '172.20.0.4' }); expect(launched!.env.DISPLAY).toBe(':0'); expect(launched!.env).not.toHaveProperty('DATABASE_URL_FILE');
    expect(fixedD3BackendConfig({ postgresIp: '172.20.0.2', minioIp: '172.20.0.3', valkeyIp: '172.20.0.4' })).toMatchObject({ media: { endpoint: 'https://172.20.0.3:9000' }, valkey: { namespace: 'darshan:d3', tlsEnabled: true } });
    await expect(assertD3Tools({ observe: async () => null }, {})).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_TOOL_UNAVAILABLE' });
    expect(D3_REQUIRED_TOOLS.map(({ path }) => path)).toEqual(['/home/hexmon/.nvm/versions/node/v20.20.2/bin/node']);
  });

  it('validates the generated API config through the actual production schema and policy without ambient dotenv and does not claim a host age binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-d3-config-')); const original = process.env;
    try { await Promise.all(['config', 'runtime-empty', 'secrets', 'tls', 'repository', 'spool', 'run', 'trust'].map((value) => mkdir(join(root, value), { recursive: true })));
      const config = fixedD3BackendConfig({ postgresIp: '172.20.0.2', minioIp: '172.20.0.3', valkeyIp: '172.20.0.4' }, root); await writeFile(join(root, 'config/backend.json'), JSON.stringify(config), { mode: 0o600 });
      await writeFile(join(root, 'runtime-empty/empty.env'), '', { mode: 0o600 }); await writeFile(join(root, 'tls/ca.crt'), 'fixture-ca', { mode: 0o600 }); await writeFile(join(root, 'tls/server.crt'), 'fixture-cert', { mode: 0o600 }); await writeFile(join(root, 'tls/server.key'), 'fixture-key', { mode: 0o600 });
      const secrets: Record<string, string> = { 'database-url': 'postgresql://darshan:fixture@172.20.0.2:5432/darshan', 'jwt-secret': 'x'.repeat(40), 'minio-access-key': 'd3-access', 'minio-secret-key': 'd3-secret-value', 'valkey-url': 'rediss://:fixture@172.20.0.4:6379/0' };
      await Promise.all(Object.entries(secrets).map(([name, value]) => writeFile(join(root, 'secrets', name), value, { mode: 0o600 })));
      const authority = { ageIdentity: await testD3Identity(), containerToolsConfigSha256: h('container-tools'), brokerPolicySha256: h('policy'), capsuleGeneration: 'd3-v1', capsuleSha256: h('capsule'), repositoryDeviceId: '1', spoolDeviceId: '1', ownerUid: process.getuid!().toString(), ownerGid: process.getgid!().toString() };
      const generated = fixedD3BackendProductionEnv('api', '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3', authority);
      const env = Object.fromEntries(Object.entries(generated).map(([key, value]) => [key, value.replace('/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3', root)])); process.env = { ...original, ...env };
      vi.resetModules(); const actual = await import('../../src/config/index'); const validated = actual.validateBackendProductionEnvironment(process.env, { backgroundWorker: false });
      expect(validated.env).toMatchObject({ NODE_ENV: 'production', DEVICE_AUTH_MODE: 'signature', BACKUP_LOCAL_PROTOCOL: 'V2_BROKER', BACKUP_SITE_ID: 'tiny-d1-development', DARSHAN_RELEASE_ID: 'release-03', MINIO_ENDPOINT: '172.20.0.3' });
      expect(validated.diagnostics.configFile).toMatchObject({ loaded: true, source: 'DARSHAN_CONFIG_FILE' }); expect(process.env.DATABASE_URL).toBeUndefined(); expect(process.env.DOTENV_CONFIG_PATH).toBe(join(root, 'runtime-empty/empty.env'));
      expect(generated).not.toHaveProperty('AGE_PATH'); expect(generated).not.toHaveProperty('AGE_VERSION'); expect(generated).not.toHaveProperty('AGE_SHA256');
    } finally { process.env = original; await rm(root, { recursive: true, force: true }); }
  });

  it('enrolls deterministic sub-32MiB fixtures and requires 0057 transactional representative rows', async () => {
    const inventory = await buildD3FixtureInventory(); const bodies = generatedD3FixtureBodies(); expect(BigInt(inventory.totalBytes)).toBeLessThan(33554432n);
    expect(inventory.selectedPdfPage).toBe(2); expect(bodies.pdf.toString()).toContain('/Count 3'); expect(bodies.pdf.toString()).toContain('/D3SelectedPage true');
    expect(inventory.files.find(({ kind }) => kind === 'MP4')?.sha256).toBe('d097080d06c34f999cf3efae77b1ab485f264e3646feb30ea9b044346951a45e');
    const seeded = await seedD3CurrentSchema({ currentMigration: async () => '0057_controlled_recovery_report_projection', seedCurrentSchema0057: async (input) =>
      ({ transactionCommitted: input.cases.includes('OLD_SESSION_PAIRING_COMMAND_OUTBOX_JOBS'), rowCountsSha256: h('counts'), contentSha256: h('content') }) }, inventory);
    expect(seeded.transactionCommitted).toBe(true);
    await expect(seedD3CurrentSchema({ currentMigration: async () => '0056_recovery_runtime_authority', seedCurrentSchema0057: vi.fn() }, inventory)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH' });
  });

  it('keeps age secrets private, requires one recovery interruption, actual CMS/player identities, and exact cleanup IDs', async () => {
    const identity = await testD3Identity(); const evidence = testD3BackupEvidence(identity);
    const backup = new FixedD3Backup({ reserveOperationBackup: async () => ({ runId: evidence.runId }), runBrokeredV2Backup: async () => evidence },
      { load: async () => null, persist: async () => undefined }, testD3Operation, identity, { revalidate: async () => evidence });
    expect(JSON.stringify(await backup.execute({ operationId: testD3Operation.operationId, siteId: 'tiny-d1-development', releaseId: 'release-03', sourceSealSha256: h('content') }))).not.toMatch(/private|AGE-SECRET/);
    const interruptOnce = vi.fn(); const recovery = new FixedD3Recovery({ prepare: async () => ({ phase: 'TARGETS_CREATED', evidenceSha256: h('prepare') }), interruptOnce,
      resume: async () => ({ phase: 'AWAITING_PROMOTION', evidenceSha256: h('resume') }), validateOriginalTargets: async () => ({ beforeSha256: h('original'), afterSha256: h('original') }) });
    await recovery.prepareInterruptResume(); await recovery.prepareInterruptResume(); expect(interruptOnce).toHaveBeenCalledTimes(1);
    await expect(runD3CmsLive({ collisionFreeLoopbackPort: async () => true, playwrightIdentity: async () => null, runSerial: vi.fn() }, h('playwright'))).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_BROWSER_UNAVAILABLE' });
    await expect(runD3Player({ displayAvailable: async () => false, executableIdentity: vi.fn(), runIsolated: vi.fn() }, h('electron'))).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_PLAYER_DISPLAY_UNAVAILABLE' });
    expect(exactOwnedResourceIds([resource()])).toMatch(/^[a-f0-9]{64}$/); expect(() => exactOwnedResourceIds([])).toThrow();
  });

  it('instantiates the non-test fixed composition and routes stages through real fixture/seed/backup/CMS modules', async () => {
    const seed = vi.fn(async () => ({ transactionCommitted: true, rowCountsSha256: h('rows'), contentSha256: h('content') }));
    const identity = await testD3Identity(); const evidence = testD3BackupEvidence(identity); const verifier = { revalidate: vi.fn(async () => evidence) };
    const backup = vi.fn(async () => evidence); let publication: D3PublicationReceipt | null = null;
    const publications = { load: async () => publication, persist: async (value: D3PublicationReceipt) => { if (publication && digest(publication) !== digest(value)) throw new Error('conflict'); publication = value; } };
    const containerTools = new D3ContainerToolRunner(containerToolsAuthority, { runFixed: async () => ({ exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }), terminateAndJoin: async () => undefined }, testD3Operation);
    const effects = createDevelopmentD3FixedEffects({ operation: testD3Operation, ageIdentity: identity, operationId: testD3Operation.operationId, siteId: 'tiny-d1-development', recoveryKeyFile: testD3Operation.keyPath,
      profile: {} as never, packet1: {} as never, packet2: {} as never, promotion: {} as never, rollback: {} as never, playwrightSha256: h('playwright'), electronSha256: h('electron') }, {
      seedSql: { currentMigration: async () => '0057_controlled_recovery_report_projection', seedCurrentSchema0057: seed },
      backup: { reserveOperationBackup: async () => ({ runId: evidence.runId }), runBrokeredV2Backup: backup }, containerTools, publications, publicationVerifier: verifier,
      source: { currentContentSha256: async () => h('content'), stopAndSeal: async () => ({ contentSha256: h('content'), evidenceSha256: h('stopped') }) },
      recoveredApi: { validateFixedCatalog: async () => ({ evidenceSha256: h('api') }) }, cms: { collisionFreeLoopbackPort: async () => true, playwrightIdentity: async () => null, runSerial: vi.fn() },
      player: { displayAvailable: async () => false, executableIdentity: vi.fn(), runIsolated: vi.fn() }, worker: { drainAndProveIdle: async () => ({ evidenceSha256: h('worker') }) },
      evidence: { retain: async () => ({ evidenceSha256: h('retained') }) }, cleanup: { removeExactOwned: async () => ({ evidenceSha256: h('cleanup'), ownedResourceIdsSha256: h('ids') }) } });
    await expect(effects.seedCurrentSchema0057AndFixtures()).resolves.toMatchObject({ evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }); expect(seed).toHaveBeenCalledOnce();
    await expect(effects.createBrokeredEncryptedV2Backup()).resolves.toBeDefined(); expect(backup).toHaveBeenCalledOnce(); await expect(effects.stopAndSealSourceApplication()).resolves.toEqual({ evidenceSha256: h('stopped') });
    await expect(requestFromD3Publication({ store: publications, authority: testD3Operation, identity, verifier, operationId: testD3Operation.operationId, siteId: 'tiny-d1-development', releaseId: 'release-03', recoveryKeyFile: testD3Operation.keyPath })).resolves.toMatchObject({ backupRunId: 'b3000000-0000-4000-8000-000000000001', manifestSha256: h('manifest') });
    await expect(requestFromD3Publication({ store: publications, authority: testD3Operation, identity, verifier, operationId: testD3Operation.operationId, siteId: 'different-fixture', releaseId: 'release-03', recoveryKeyFile: testD3Operation.keyPath })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_OPERATION_AUTHORITY_MISMATCH' });
    await expect(effects.validateCmsPlaywrightSerial()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_BROWSER_UNAVAILABLE' });
    await expect(effects.restoreWithControlledInterruptionAndResume()).rejects.toBeDefined();
  });

  it('binds promotion and rollback to distinct fixed stage actions and records live measured evidence', async () => {
    const invoked: string[] = []; const actions = Object.fromEntries([
      ['seedCurrentSchema0057AndFixtures', 'seed'], ['createBrokeredEncryptedV2Backup', 'backup'], ['stopAndSealSourceApplication', 'stop'], ['restoreWithControlledInterruptionAndResume', 'restore'],
      ['validateRecoveredApi', 'api'], ['validateCmsPlaywrightSerial', 'cms'], ['validateActualElectronPlayer', 'player'], ['drainRecoveredWorker', 'worker'],
      ['promoteWithSeparateApprovalAndFreeze', 'promote'], ['rollbackUnderWriteFreeze', 'rollback'], ['retainSecretFreeEvidence', 'evidence'], ['cleanupExactRetainedOwnership', 'cleanup'],
    ].map(([method, label]) => [method, async () => { invoked.push(label); return { evidenceSha256: h(label), ...(label === 'cleanup' ? { ownedResourceIdsSha256: h('ids') } : {}) }; }])) as unknown as D3FixedStageActions;
    const live = observation('sealed', [resource()]); const effects = new RealDevelopmentD3Effects(actions, { observe: async () => live }, { begin: async () => ({ monotonicMs: '1' }),
      end: async () => ({ durationMs: '2', peakMemoryBytes: '3', hostSwapUsedBytes: '4', evidenceSha256: h('measured') }) });
    await effects.execute('PROMOTE_SEPARATELY'); await effects.execute('ROLLBACK_UNDER_FREEZE'); expect(invoked).toEqual(['promote', 'rollback']);
  });

  it('binds the live CMS launcher only to supported routes and existing login/backup selectors', async () => {
    const endpoints = await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/src/api/endpoints.ts', 'utf8'); const auth = await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/src/pages/Auth.tsx', 'utf8');
    const backups = await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/src/components/settings/BackupsSection.tsx', 'utf8'); const launcher = await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/d3-cms-live.mjs', 'utf8');
    for (const route of D3_CMS_API_ROUTES) expect(endpoints).toContain(route.replace('/api/v1', '')); expect(auth).toContain('id="login-email"'); expect(auth).toContain('id="login-password"'); expect(auth).toContain('type="submit"');
    expect(D3_CMS_SELECTORS).toContain('role=tab[name="Backups"]'); expect(backups).toContain('Installation backups'); expect(backups).toContain('Backup history');
    expect(launcher).toContain("page.goto('https://127.0.0.1:18443/login'"); expect(launcher).toContain("page.goto('https://127.0.0.1:18443/settings'");
    expect(launcher).toContain("getByRole('tab', { name: 'Backups', exact: true })"); expect(launcher).not.toContain('?tab=backups'); expect(launcher).not.toContain('/recovery/d3-validation');
    const runtimeCheck = launcher.indexOf("context.request.get('https://127.0.0.1:18443/config/app-config.json'"); const credentialRead = launcher.indexOf("readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/secrets/cms-login.json'"); const credentialFill = launcher.indexOf("locator('#login-email').fill");
    expect(runtimeCheck).toBeGreaterThan(-1); expect(credentialRead).toBeGreaterThan(runtimeCheck); expect(credentialFill).toBeGreaterThan(credentialRead);
    expect(launcher).toContain("'https://127.0.0.1:18441/api/v1'"); expect(launcher).toContain("'https://127.0.0.1:18441/chat'"); expect(launcher).toContain("'https://127.0.0.1:18441/screens'"); expect(launcher).not.toContain('192.168.29.64');
    expect(launcher).toContain("from '../../../darshan-cms/node_modules/playwright/index.mjs'"); expect(launcher).toContain("executablePath: chromiumExecutable");
    expect(launcher).toContain('/home/hexmon/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell'); expect(launcher).not.toContain('darshan-server/node_modules/.bin/playwright');
  });

  it('serves approved SPA GET/HEAD routes while preserving safe asset and 404 behavior', async () => {
    // @ts-expect-error The fixed launcher is intentionally checked in as an executable ESM module.
    const { createD3StaticCmsHandler } = await import('./d3-static-cms.mjs') as { createD3StaticCmsHandler(readAsset: (relative: string) => Promise<Buffer>): (request: { method?: string; url?: string }, response: unknown) => Promise<void> };
    const reads: string[] = []; const readAsset = async (relative: string) => { reads.push(relative); if (relative === 'index.html') return Buffer.from('<main>D3</main>'); if (relative === 'assets/app.js') return Buffer.from('export{}'); throw new Error('missing'); };
    const invoke = async (url: string, method = 'GET') => { let status = 0; let headers: Record<string, string> = {}; let body: Buffer | undefined;
      const response = { writeHead(code: number, values: Record<string, string> = {}) { status = code; headers = values; return this; }, end(value?: Buffer) { body = value; return this; } };
      await createD3StaticCmsHandler(readAsset)({ method, url }, response); return { status, headers, body }; };
    await expect(invoke('/login')).resolves.toMatchObject({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('<main>D3</main>') });
    await expect(invoke('/settings', 'HEAD')).resolves.toMatchObject({ status: 200, headers: { 'content-length': '15' }, body: undefined });
    await expect(invoke('/assets/app.js')).resolves.toMatchObject({ status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' }, body: Buffer.from('export{}') });
    const runtime = await invoke('/config/app-config.json'); expect(runtime).toMatchObject({ status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const runtimeText = runtime.body!.toString('utf8'); const runtimeValue = JSON.parse(runtimeText); expect(runtimeText).toBe(`${JSON.stringify(runtimeValue)}\n`);
    expect(runtimeValue).toEqual({ cms: { api: { baseUrl: 'https://127.0.0.1:18441' }, diagnostics: { showEnvironmentIdentity: true }, environment: { cmsId: 'cms-d3', deploymentId: 'tiny-d1-development', name: 'development-d3' }, realtime: { socketBaseUrl: 'https://127.0.0.1:18441', socketTransports: ['websocket'] } } });
    expect(runtimeText).not.toMatch(/password|secret|credential|token|192\.168\./i); await expect(invoke('/config/app-config.json', 'HEAD')).resolves.toMatchObject({ status: 200, body: undefined });
    const distRuntime = await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/dist/config/app-config.json', 'utf8'); expect(distRuntime).toContain('192.168.29.64'); expect(runtimeText).not.toBe(distRuntime);
    await expect(invoke('/assets/missing.js')).resolves.toMatchObject({ status: 404 }); await expect(invoke('/unknown-route')).resolves.toMatchObject({ status: 404 });
    await expect(invoke('/%2e%2e/secrets')).resolves.toMatchObject({ status: 404 }); await expect(invoke('/login', 'POST')).resolves.toMatchObject({ status: 405, headers: { allow: 'GET, HEAD' } });
    expect(reads).toEqual(['index.html', 'index.html', 'assets/app.js', 'assets/missing.js']);
  });

  it('keeps disabled and changed image identities fail-closed before constructing effects', async () => {
    const activation = await loadDevelopmentD3Activation(); const constructBoundary = vi.fn(); const observeContainerTools = vi.fn(async () => containerToolsObservation);
    await expect(runCheckedInD3Controller({ loadActivation: async () => ({ ...activation, enabled: false }), verifyAssets: async () => ({ profileSha256: h('profile') }), observeContainerTools, constructBoundary }))
      .rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_NOT_ACTIVATED' });
    expect(observeContainerTools).not.toHaveBeenCalled(); expect(constructBoundary).not.toHaveBeenCalled();
    const changed = { ...containerToolsObservation, imageId: `sha256:${'0'.repeat(64)}` };
    await expect(loadCheckedInD3Boundary({ loadActivation: enrolledControllerFixture, verifyAssets: async () => ({ profileSha256: h('profile') }), observeContainerTools: async () => changed, constructBoundary }))
      .rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D4_TOOLS_IMAGE_UNAVAILABLE' });
    expect(constructBoundary).not.toHaveBeenCalled(); const launcher = await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/d3-controller.mjs', 'utf8');
    expect(launcher).toContain('controlled-recovery-d3-controller.ts'); expect(launcher).not.toMatch(/process\.argv|--path|--endpoint|compose/i);
  });

  it('verifies the enrolled container image before the explicit missing installed-boundary gate', async () => {
    const activation = await enrolledControllerFixture(); const observation = containerToolsObservation;
    const constructBoundary = vi.fn(async () => { throw Object.assign(new Error('missing installed authorities'), { code: 'CONTROLLED_RECOVERY_D3_DEPENDENCIES_NOT_ENROLLED' }); });
    await expect(loadCheckedInD3Boundary({ loadActivation: async () => activation, verifyAssets: async () => ({ profileSha256: h('profile') }), observeContainerTools: async () => observation, constructBoundary }))
      .rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_DEPENDENCIES_NOT_ENROLLED' });
    expect(constructBoundary).toHaveBeenCalledOnce(); expect(DEVELOPMENT_D3_MISSING_INSTALLED_BOUNDARIES.system).toEqual(['seedSql', 'backup', 'containerTools', 'publications', 'source', 'recoveredApi', 'cms', 'player', 'worker', 'evidence', 'cleanup']);
    expect(DEVELOPMENT_D3_MISSING_INSTALLED_BOUNDARIES.reusableImplementations).toContain('createDevelopmentD3FixedEffects');
  });

  it('binds the player launcher to the resolved Electron binary and real ConfigManager bootstrap', async () => {
    const launcher = await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/d3-player-bootstrap.mjs', 'utf8');
    expect(launcher).toContain("const electron = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-player/node_modules/electron/dist/electron'");
    expect(launcher).toContain("import('../../../darshan-player/dist/main/common/config.js')"); expect(launcher).toContain('new ConfigManager(supported.DARSHAN_CONFIG_PATH)');
    expect(launcher).not.toContain('node_modules/.bin/electron');
  });
});
