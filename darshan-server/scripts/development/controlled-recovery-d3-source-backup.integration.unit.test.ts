import { afterEach, describe, expect, it } from 'vitest';
import { digest } from '../../src/recovery/controlled-docker/contracts';
import { D3SourceBackupController } from './controlled-recovery-d3-source-backup';
import { FixedD3Docker, d3Ipv4SubnetsOverlap, fixedD3SourceDockerPlan } from './controlled-recovery-d3-docker';
import { DurableD3SourceState } from './controlled-recovery-d3-source-state';
import { FixedD3SourceServices } from './controlled-recovery-d3-source-services';
import { sourceD2, sourceFixture, sourceLayout, sourceProfile, sourceRaw } from './controlled-recovery-d3-source.test-support';

const fixtures: Awaited<ReturnType<typeof sourceFixture>>[] = []; afterEach(async () => { await Promise.all(fixtures.splice(0).map((value) => value.cleanup())); });
async function fixture() { const f = await sourceFixture(); fixtures.push(f); const controller = new D3SourceBackupController({ state: f.state, layout: { prepare: async () => sourceLayout, verify: async () => sourceLayout }, services: f.services }); return { ...f, controller }; }

describe('D3 source command integration (protected temporary files and fake Docker only)', () => {
  it('prepares exact services, records IDs before start, joins root PG init before numeric runtime, and reobserves on status', async () => {
    const f = await fixture(); f.api.beforeStart = async (id) => { expect((await f.state.resources()).resources.some((resource) => resource.id === id && !resource.retired)).toBe(true); };
    expect(await f.controller.execute('status')).toMatchObject({ status: 'EMPTY', backupCreated: false });
    await expect(f.controller.execute('prepare')).resolves.toMatchObject({ stage: 'SERVICES_READY', nextStage: 'SCHEMA_READY', backupCreated: false, wholeRunEnabled: false });
    const created = f.api.calls.filter((args) => args[1] === 'create'); expect(created).toHaveLength(8);
    expect(created.some((args) => args.includes('70:70') && args.includes('ssl=on') && args.includes('password_encryption=scram-sha-256'))).toBe(true);
    const initId = digest('source-postgres-init'); const joined = f.api.calls.findIndex((args) => args[1] === 'wait' && args.at(-1) === initId); const pgCreated = f.api.calls.findIndex((args) => args.includes('com.darshan.d3.role=postgres'));
    expect(joined).toBeGreaterThan(0); expect(joined).toBeLessThan(pgCreated); expect((await f.state.resources()).resources.find(({ role }) => role === 'postgres-init')?.retired).toBe(true);
    const prior = f.api.calls.length; await expect(f.controller.execute('status')).resolves.toMatchObject({ status: 'SOURCE_SERVICES_VERIFIED', verifiedThrough: 'SERVICES_READY' }); expect(f.api.calls.length).toBeGreaterThan(prior);
    await expect(f.controller.execute('prepare')).resolves.toMatchObject({ stage: 'SERVICES_READY' }); expect(f.api.calls.filter((args) => args[1] === 'create')).toHaveLength(8);
    expect(f.checks).toEqual(expect.arrayContaining(['postgres', 'minio', 'valkey'])); expect(f.admissions).toContain('AUTHENTICATED_HEALTH');
  });
  it('keeps capture/resume closed after verified services without fake schema, capsule, binding or publication success', async () => {
    const f = await fixture(); await f.controller.execute('prepare');
    await expect(f.controller.execute('capture')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_BACKUP_DEPENDENCIES_NOT_ENROLLED' });
    await expect(f.controller.execute('resume')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_BACKUP_DEPENDENCIES_NOT_ENROLLED' });
    expect((await f.state.stages()).map(({ stage }) => stage)).toEqual(['LAYOUT_READY', 'SERVICES_READY']);
  });
  it('stops only retained exact IDs and records an interruption rather than manufacturing later successful phases', async () => {
    const f = await fixture(); await f.controller.execute('prepare'); const before = f.api.calls.length;
    await expect(f.controller.execute('stop')).resolves.toMatchObject({ status: 'SOURCE_STOPPED', completedBackup: false });
    expect(f.api.calls.slice(before).filter((args) => args[1] === 'stop').map((args) => args.at(-1))).toEqual(['valkey', 'minio', 'postgres'].map((role) => digest(`source-${role}`)));
    expect((await f.state.stages()).at(-1)?.stage).toBe('SERVICES_READY'); await expect(f.controller.execute('status')).resolves.toMatchObject({ status: 'INTERRUPTED_SOURCE_STOPPED', backupCreated: false });
    await expect(f.controller.execute('prepare')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_STOPPED' });
  });
  it('does not adopt a same-name resource after ambiguous create or retry an unresolved intent', async () => {
    const f = await fixture(); f.api.afterCreateFailure = 'network'; await expect(f.controller.execute('prepare')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_NONZERO' });
    expect((await f.state.resources()).pendingRoles).toEqual(['network']); const prior = f.api.calls.filter((args) => args[1] === 'create').length;
    await expect(f.controller.execute('resume')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_CREATION_AMBIGUOUS' }); expect(f.api.calls.filter((args) => args[1] === 'create')).toHaveLength(prior);
  });
  it('refuses resources with no retained IDs even when their name and labels match', async () => {
    const f = await fixture(); await f.controller.execute('prepare'); const other = await fixture();
    const services = new FixedD3SourceServices(sourceD2, sourceProfile, sourceLayout, f.docker, other.state, { assert: async () => undefined }, { prepare: async () => { throw new Error('must not materialize'); }, verifyRetained: async () => { throw new Error('must not verify foreign materialization'); } }, f.probes);
    await expect(services.observe()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_OWNERSHIP_CHANGED' });
  });
  it('rejects missing/changed resources and foreign network consumers without stopping anything', async () => {
    const f = await fixture(); await f.controller.execute('prepare'); f.api.foreignConsumers.push(digest('foreign-container')); const prior = f.api.calls.filter((args) => args[1] === 'stop').length;
    await expect(f.controller.execute('stop')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_FOREIGN_CONSUMER' }); expect(f.api.calls.filter((args) => args[1] === 'stop')).toHaveLength(prior);
    f.api.foreignConsumers.length = 0; f.api.resources.delete('minio'); await expect(f.controller.execute('status')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_OWNERSHIP_CHANGED' });
  });
  it.each([sourceProfile.postgres.volume, sourceProfile.minio.volume, sourceProfile.valkey.volume].flatMap((volume) => [true, false].map((running) => ({ volume, running }))))('rejects a foreign source-volume consumer on another network: $volume running=$running', async ({ volume, running }) => {
    const f = await fixture(); await f.controller.execute('prepare'); const id = f.api.addForeignVolumeConsumer(volume, running); const before = f.api.calls.filter((args) => args[1] === 'stop').length;
    await expect(f.controller.execute('stop')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_FOREIGN_VOLUME_CONSUMER' });
    expect(f.api.calls.filter((args) => args[1] === 'stop')).toHaveLength(before); expect(f.api.calls.some((args) => args[0] === 'container' && args[1] === 'ls' && args.includes('--all'))).toBe(true);
    expect(f.api.calls.some((args) => args[0] === 'container' && args[1] === 'inspect' && args.includes(id))).toBe(true); expect(await f.state.stopReceipt()).toBeNull();
  });
  it('also rejects a stopped foreign read-only bind consumer of a source-volume data directory', async () => {
    const f = await fixture(); await f.controller.execute('prepare'); f.api.addForeignVolumeConsumer(sourceProfile.postgres.volume, false, true);
    await expect(f.controller.execute('status')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_FOREIGN_VOLUME_CONSUMER' });
  });
  it.each(['network', 'postgres-volume', 'minio-volume', 'valkey-volume', 'postgres-init', 'postgres', 'minio', 'valkey'] as const)('retains the exact created ID and dispatches no next effect after cancellation during %s create', async (role) => {
    const f = await fixture(); const abort = new AbortController(); f.api.afterCreate = async (createdRole, input) => { if (createdRole === role) { expect(input.signal).toBe(abort.signal); abort.abort(); } };
    await expect(f.controller.execute('prepare', abort.signal)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED' });
    const retained = await f.state.resources(); const record = retained.resources.find((value) => value.role === role); expect(record).toBeDefined(); expect(record!.id).toMatch(/^[a-f0-9]{64}$/); expect(retained.pendingRoles).toEqual([]);
    const createIndex = f.api.calls.findIndex((args) => args[1] === 'create' && args.includes(`com.darshan.d3.role=${role}`)); expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(f.api.calls.slice(createIndex + 1).some((args) => ['create', 'start', 'stop', 'rm'].includes(args[1]!))).toBe(false);
    if (record!.kind === 'container') { expect(record!.id).toBe(f.api.resources.get(role)!.Id); expect(f.api.resources.get(role)!.State.Running).toBe(false); }
    expect((await f.state.stages()).map(({ stage }) => stage)).toEqual(['LAYOUT_READY']); expect(await f.state.commandInProgress()).toBe(false);
  });
  it('threads the same AbortSignal through every fixed create and start dispatch', async () => {
    const f = await fixture(); const abort = new AbortController(); await f.controller.execute('prepare', abort.signal);
    for (const [index, args] of f.api.calls.entries()) if (args[1] === 'create' || args[1] === 'start') expect(f.api.signals[index]).toBe(abort.signal);
  });
  it('retries a failed middle stop across a complete mixed-running topology and records stop only after convergence', async () => {
    const f = await fixture(); await f.controller.execute('prepare'); f.api.failNext = (args) => args[1] === 'stop' && args.at(-1) === digest('source-minio');
    await expect(f.controller.execute('stop')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_NONZERO' }); expect(await f.state.stopReceipt()).toBeNull();
    await expect(f.services.observe()).resolves.toMatchObject({ topologyComplete: true, status: 'MIXED' });
    await expect(f.controller.execute('status')).resolves.toMatchObject({ status: 'SOURCE_STOP_INCOMPLETE', nextCommand: 'stop', verifiedThrough: null });
    const before = f.api.calls.length; await expect(f.controller.execute('stop')).resolves.toMatchObject({ status: 'SOURCE_STOPPED', completedBackup: false });
    expect(f.api.calls.slice(before).filter((args) => args[1] === 'stop').map((args) => args.at(-1))).toEqual(['minio', 'postgres'].map((role) => digest(`source-${role}`)));
    expect(f.api.calls.slice(before).filter((args) => args[1] === 'wait').map((args) => args.at(-1))).toEqual(['valkey', 'minio', 'postgres'].map((role) => digest(`source-${role}`)));
    await expect(f.services.observe()).resolves.toMatchObject({ topologyComplete: true, status: 'STOPPED' }); expect(await f.state.stopReceipt()).not.toBeNull(); expect((await f.state.stages()).at(-1)?.stage).toBe('SERVICES_READY');
  });
  it('checks all network ranges before creation and rejects overlapping subnets', async () => {
    const f = await fixture(); f.api.foreignSubnet = '172.30.250.8/29'; await expect(f.controller.execute('prepare')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_SUBNET_COLLISION' }); expect(f.api.calls.some((args) => args[1] === 'create')).toBe(false);
    expect(d3Ipv4SubnetsOverlap('172.30.250.0/28', '172.30.250.16/28')).toBe(false); expect(d3Ipv4SubnetsOverlap('172.30.250.0/28', '172.30.0.0/16')).toBe(true); expect(() => d3Ipv4SubnetsOverlap('999.0.0.0/8', '10.0.0.0/8')).toThrow();
  });
  it.each(['auth', 'tls', 'peer', 'plaintext', 'unauthenticated'])('requires authenticated, certificate-bound TLS and negative probes: %s', async (fault) => {
    const f = await fixture(); f.rejectProbe(fault); await expect(f.controller.execute('prepare')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_AUTHENTICATED_HEALTH_FAILED' });
    expect(f.checks).toHaveLength(sourceProfile.health.attempts * 3); expect((await f.state.stages()).map(({ stage }) => stage)).toEqual(['LAYOUT_READY']);
    f.rejectProbe('none'); await expect(f.controller.execute('resume')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_BACKUP_DEPENDENCIES_NOT_ENROLLED' }); expect((await f.state.stages()).at(-1)?.stage).toBe('SERVICES_READY');
  });
  it('treats a stage journal as an index and refuses changed live layout or malformed command input', async () => {
    const f = await fixture(); await f.controller.execute('prepare'); const changed = new D3SourceBackupController({ state: f.state, layout: { prepare: async () => sourceLayout, verify: async () => ({ ...sourceLayout, caSha256: digest('other-ca') }) }, services: f.services });
    await expect(changed.execute('status')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_CHANGED' }); await expect(f.controller.execute('shell' as never)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_INVALID' });
    expect(new DurableD3SourceState(f.authority, f.state.profileSha256)).toBeDefined();
  });
  it('reports an in-progress command without claiming verification or dispatching a second effect', async () => {
    const f = await fixture(); await f.state.withCommandLock('prepare', async () => {
      await expect(f.controller.execute('status')).resolves.toMatchObject({ status: 'SOURCE_COMMAND_IN_PROGRESS', verifiedThrough: null, backupCreated: false });
      await expect(f.controller.execute('stop')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_BUSY' }); expect(f.api.calls).toHaveLength(0);
    });
  });
});

describe('D3 exact source Docker dispatch and inspection', () => {
  it('checks nonzero results for all fixed operation families and never exposes stderr', async () => {
    const docker = new FixedD3Docker(sourceD2, { executeFixed: async () => ({ exitCode: 1, stdout: Buffer.from('0\n'), stderr: Buffer.from('PRIVATE PASSWORD') }) }); const id = digest('id');
    const calls = [() => docker.listAllContainers(), () => docker.inspectExactResources(), () => docker.startExact(id), () => docker.stopExact(id), () => docker.removeExact(id), () => docker.joinExactSourceContainer(id),
      () => docker.createSourceResource(sourceProfile, 'network', digest('config')), () => docker.inspectSourceResource(sourceProfile, 'postgres', digest('config'))];
    for (const call of calls) { const error = await call().catch((cause: unknown) => cause); expect(error).toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_NONZERO' }); expect(JSON.stringify(error)).not.toContain('PRIVATE PASSWORD'); }
    expect(() => new FixedD3Docker(sourceD2, { executeFixed: async () => { throw new Error('unused'); } }, '/bin/sh')).toThrow();
  });
  it('pins only the internal named network/volumes, numeric users, TLS/file credentials and resource limits', () => {
    const plans = ['network', 'postgres-volume', 'minio-volume', 'valkey-volume', 'postgres-init', 'postgres', 'minio', 'valkey'].map((role) => fixedD3SourceDockerPlan(sourceD2, sourceProfile, role as never, digest(role)));
    for (const plan of plans) { expect(plan.argv.join(' ')).not.toMatch(/--publish|--network host|--privileged|docker\.sock|compose|prune|POSTGRES_PASSWORD=|MINIO_ROOT_PASSWORD=/i); expect(plan.argv).not.toEqual(expect.arrayContaining(['pull', 'build', '/bin/sh'])); }
    expect(plans[0]!.argv).toEqual(expect.arrayContaining(['--internal', '--subnet', '172.30.250.0/28']));
    for (const role of ['postgres-init', 'postgres']) expect(plans.find((plan) => plan.role === role)!.environment).toContain('PGDATA=/var/lib/postgresql/data/pgdata');
    expect(plans.find(({ role }) => role === 'minio')!.argv).toEqual(expect.arrayContaining(['MINIO_BROWSER=off', 'MINIO_ROOT_PASSWORD_FILE=/data/.d3-config/secrets/minio-secret-key']));
    expect(plans.find(({ role }) => role === 'valkey')!.command).toEqual(expect.arrayContaining(['--port', '0', '--tls-port', '6379', '--aclfile', '/data/.d3-config/users.acl', '--maxmemory', '33554432']));
  });
  it.each(['ports', 'image', 'labels', 'bind', 'privileged', 'network', 'restart', 'caps', 'memory', 'user'])('rejects changed real container metadata: %s', async (fault) => {
    const plan = fixedD3SourceDockerPlan(sourceD2, sourceProfile, 'postgres', digest('config')); const raw = sourceRaw(plan);
    if (fault === 'ports') raw.HostConfig.PortBindings = { '5432/tcp': [{ HostPort: '5432' }] };
    if (fault === 'image') raw.Image = `sha256:${digest('foreign')}`;
    if (fault === 'labels') raw.Config.Labels['com.darshan.d3.operation'] = 'foreign';
    if (fault === 'bind') raw.Mounts = [{ Type: 'bind', Source: '/etc', Destination: '/var/lib/postgresql/data', RW: true }];
    if (fault === 'privileged') raw.HostConfig.Privileged = true;
    if (fault === 'network') raw.HostConfig.NetworkMode = 'host';
    if (fault === 'restart') raw.HostConfig.RestartPolicy.Name = 'always';
    if (fault === 'caps') raw.HostConfig.CapAdd = ['SYS_ADMIN'];
    if (fault === 'memory') raw.HostConfig.Memory *= 2;
    if (fault === 'user') raw.Config.User = '0:0';
    const docker = new FixedD3Docker(sourceD2, { executeFixed: async () => ({ exitCode: 0, stdout: Buffer.from(JSON.stringify([raw])), stderr: Buffer.alloc(0) }) });
    await expect(docker.inspectSourceResource(sourceProfile, 'postgres', digest('config'))).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_DOCKER_IDENTITY_INVALID' });
  });
});
