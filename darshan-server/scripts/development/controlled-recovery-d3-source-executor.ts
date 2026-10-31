import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rmdir, statfs, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import type { DevelopmentD2Activation } from './controlled-recovery-d2';
import { FixedD3Docker, fixedD3SourceDockerPlan, sourceObservation, type D3DockerExecution } from './controlled-recovery-d3-docker';
import { loadDevelopmentReadinessActivation } from './controlled-recovery-readiness';
import { openD3ProtectedFile, protectD3Directory, publishD3ProtectedBytes, syncD3Directory } from './controlled-recovery-d3-protected-files';
import { assertD3SourceProcessSuccess, BoundedD3SourceProcess, d3ProcessDiagnostic, d3SourceFailure, type D3SourceDiagnostic } from './controlled-recovery-d3-source-process';
import type { D3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import { d3SourceConfigurations, type D3SourceLayoutBoundary } from './controlled-recovery-d3-source-services';
import { D3_SOURCE_RESOURCE_NAMES, DurableD3SourceState, type D3SourceResourceRole } from './controlled-recovery-d3-source-state';
import { D3_SOURCE_HELPER_CAPABILITY, fixedD3VolumePlan, type D3VolumeExecution, type D3VolumeOperation } from './controlled-recovery-d3-source-volumes';
import { D3_MINIO_FILE_CREDENTIALS } from './controlled-recovery-d3-source-enrollment';

const prefix = ['--config', '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config', '--context', 'default'];
const environment = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' };
const minimal = '{"Id":{{json .Id}},"Name":{{json .Name}},"State":{"Running":{{json .State.Running}}},"Mounts":{{json .Mounts}}}';
const failure = (code = 'CONTROLLED_RECOVERY_D3_SOURCE_EXECUTION_REJECTED') => new ControlledRecoveryError(code, 'The fixed source execution, enrolled daemon/image, protected authority, or exact-ID settlement is unverified.');
type Request = Parameters<D3DockerExecution['executeFixed']>[0];
export function assertD3SourceHeadroom(resource: Extract<D3SourceDiagnostic, { kind: 'headroom' }>['resource'], observed: bigint, threshold: bigint, comparison: 'MINIMUM' | 'MAXIMUM') {
  if (observed < 0n || threshold < 0n) throw d3SourceFailure('CONTROLLED_RECOVERY_D3_SOURCE_HOST_AUTHORITY_INVALID', { kind: 'authority', phase: 'HEADROOM', category: 'MALFORMED' });
  if (comparison === 'MINIMUM' ? observed < threshold : observed > threshold) throw d3SourceFailure('CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE', { kind: 'headroom', resource, observed: String(observed), threshold: String(threshold), comparison });
}

/** Fixed provider only; installed source composition and activation remain unavailable. */
export class EnrolledD3SourceExecutor implements D3DockerExecution, D3VolumeExecution {
  private listed = new Map<string, Set<string>>();
  private sourceAdmission: ((phase: string) => Promise<void>) | null = null;
  bindSourceAdmission(admission: (phase: string) => Promise<void>) { if (this.sourceAdmission || typeof admission !== 'function') throw failure(); this.sourceAdmission = admission; }
  private async admitEffect(phase: string) { if (!this.sourceAdmission && !this.hostGuard) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_PROVIDERS_NOT_COMPOSED'); await this.sourceAdmission?.(phase); }
  constructor(private readonly authority: D3OperationAuthority, private readonly activation: DevelopmentD2Activation, private readonly profile: D3SourceBackupProfile,
    private readonly state: DurableD3SourceState, private readonly layout: D3SourceLayoutBoundary, private readonly process: BoundedD3SourceProcess = new BoundedD3SourceProcess(),
    private readonly hostGuard?: () => Promise<void>) {}
  private async run(args: readonly string[], timeoutMs: number, maximumOutputBytes = 2 * 1024 * 1024, signal?: AbortSignal) {
    try { return await this.process.run({ executable: '/usr/bin/docker', argv: [...prefix, ...args], cwd: this.authority.root, timeoutMs, maximumOutputBytes, ...(signal ? { signal } : {}) }); }
    catch (cause) { if (cause instanceof ControlledRecoveryError) throw cause; throw d3SourceFailure('CONTROLLED_RECOVERY_D3_SOURCE_EXECUTION_REJECTED', d3ProcessDiagnostic({ executable: '/usr/bin/docker', argv: args, timeoutMs }, 'UNKNOWN')); }
  }
  private async checkedRun(args: readonly string[], timeoutMs: number, maximumOutputBytes = 2 * 1024 * 1024, signal?: AbortSignal) { const result = await this.run(args, timeoutMs, maximumOutputBytes, signal); assertD3SourceProcessSuccess({ executable: '/usr/bin/docker', argv: args, timeoutMs, maximumOutputBytes }, result); return result; }
  private async json(args: readonly string[], timeoutMs = 10000): Promise<unknown> { const value = await this.checkedRun(args, timeoutMs); return parseStrictJson(value.stdout, 2 * 1024 * 1024); }
  private async minimalContainers(selectors: readonly string[]) {
    const value = await this.checkedRun(['container', 'inspect', '--format', minimal, ...selectors], 10000);
    const rows = value.stdout.toString('utf8').trim().split('\n').filter(Boolean).map((line) => parseStrictJson(Buffer.from(line), 64 * 1024) as { Id: string; Name: string; State: { Running: boolean }; Mounts: unknown[] });
    if (rows.length !== selectors.length || new Set(rows.map(({ Id }) => Id)).size !== rows.length || rows.some((row) => !/^[a-f0-9]{64}$/.test(row.Id) || !selectors.some((selector) => selector === row.Id || `/${selector}` === row.Name))) throw failure(); return rows;
  }
  async observeReadinessDocker(operation: 'context' | 'daemon' | 'images' | 'running'): Promise<Buffer> {
    if (operation !== 'running') { const args = operation === 'context' ? ['context', 'inspect', 'default'] : operation === 'daemon' ? ['info', '--format', '{{json .}}'] : operation === 'images' ? ['image', 'inspect', ...this.activation.images.map(({ image_id }) => image_id)] : null;
      if (!args) throw failure(); const result = await this.checkedRun(args, 15000); return result.stdout; }
    const listed = await this.checkedRun(['container', 'ls', '--all', '--no-trunc', '--format', '{{json .}}'], 10000);
    const ids = listed.stdout.toString('utf8').split('\n').filter(Boolean).map((line) => (parseStrictJson(Buffer.from(line), 64 * 1024) as { ID: string }).ID);
    if (ids.length > 256 || new Set(ids).size !== ids.length || ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) throw failure();
    const rows = ids.length ? await this.minimalContainers(ids) : []; return Buffer.from(rows.filter((row) => row.State.Running).map((row) => JSON.stringify({ ID: row.Id, Names: row.Name.replace(/^\//, '') })).join('\n'));
  }
  async assertHostAdmission(): Promise<void> {
    if (this.hostGuard) return this.hostGuard();
    let phase: Extract<D3SourceDiagnostic, { kind: 'authority' }>['phase'] = 'ENROLLMENT';
    const authorityFailure = (category = 'MISMATCH') => d3SourceFailure('CONTROLLED_RECOVERY_D3_SOURCE_HOST_AUTHORITY_INVALID', { kind: 'authority', phase, category });
    try {
      const d1 = await loadDevelopmentReadinessActivation(); phase = 'SOCKET'; const socket = await lstat(d1.docker.socket_path); phase = 'CAPABILITY';
      const evidence = await open(D3_MINIO_FILE_CREDENTIALS.evidencePath, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await evidence.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== this.authority.ownerUid || stat.size > 64 * 1024 || sha256(await evidence.readFile()) !== D3_MINIO_FILE_CREDENTIALS.evidenceSha256 || this.activation.images.find(({ role }) => role === 'minio')?.image_id !== D3_MINIO_FILE_CREDENTIALS.imageId) throw authorityFailure(); } finally { await evidence.close(); }
      phase = 'SOCKET'; if (!socket.isSocket() || digest({ kind: 'socket', uid: socket.uid, gid: socket.gid, mode: socket.mode & 0o777, dev: String(socket.dev), ino: String(socket.ino), size: String(socket.size) }) !== d1.docker.expected_socket_sha256) throw authorityFailure();
      phase = 'CONFIGURATION'; const config = await open(`${prefix[1]}/config.json`, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await config.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== this.authority.ownerUid || (stat.mode & 0o002) || (await config.readFile('utf8')) !== '{"auths":{}}\n') throw authorityFailure(); } finally { await config.close(); }
      phase = 'CONTEXT'; const contexts = await this.json(['context', 'inspect', 'default']) as Array<{ Name: string; Endpoints: { docker: { Host: string; SkipTLSVerify?: boolean } } }>;
      if (contexts.length !== 1 || contexts[0]!.Name !== 'default' || contexts[0]!.Endpoints.docker.Host !== d1.docker.endpoint || contexts[0]!.Endpoints.docker.SkipTLSVerify === true) throw authorityFailure();
      phase = 'DAEMON'; const daemon = await this.json(['info', '--format', '{{json .}}']) as { ID: string; Name: string; Driver: string; ServerVersion: string; DockerRootDir: string; SecurityOptions: string[] };
      if (digest({ id: daemon.ID, name: daemon.Name, driver: daemon.Driver, serverVersion: daemon.ServerVersion, rootDir: daemon.DockerRootDir, securityOptions: [...daemon.SecurityOptions].sort() }) !== d1.docker.expected_daemon_sha256) throw authorityFailure();
      phase = 'IMAGES'; const images = await this.json(['image', 'inspect', ...this.activation.images.map(({ image_id }) => image_id)]) as Array<{ Id: string; RepoDigests: string[] }>;
      if (images.length !== 3 || this.activation.images.some((image) => !images.some((observed) => observed.Id === image.image_id && observed.RepoDigests.includes(image.repo_digest)))) throw authorityFailure();
      phase = 'HEADROOM'; const mem = await readFile('/proc/meminfo', 'utf8'); const field = (name: string) => { const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm').exec(mem); if (!match) throw authorityFailure('MALFORMED'); return BigInt(match[1]!) * 1024n; };
      assertD3SourceHeadroom('MEMORY_BYTES', field('MemAvailable'), 2717908992n, 'MINIMUM'); assertD3SourceHeadroom('SWAP_BYTES', field('SwapTotal') - field('SwapFree'), BigInt(d1.resources.maximum_swap_used_bytes), 'MAXIMUM');
      const pressure = await readFile('/proc/pressure/memory', 'utf8'); const avg = /some avg10=([0-9.]+)/.exec(pressure); const value = avg ? Number(avg[1]) : NaN; const limit = Number(d1.resources.maximum_memory_pressure_avg10);
      if (!Number.isFinite(value) || value < 0 || value > 100 || !Number.isFinite(limit)) throw d3SourceFailure('CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE', { kind: 'authority', phase, category: 'MALFORMED' });
      if (value > limit) throw d3SourceFailure('CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE', { kind: 'headroom', resource: 'PRESSURE_MICROS', observed: String(Math.ceil(value * 1000000)), threshold: String(Math.floor(limit * 1000000)), comparison: 'MAXIMUM' });
      phase = 'FILESYSTEM'; for (const key of ['workspace', 'target'] as const) { const fs = await statfs(d1.paths[key], { bigint: true }); assertD3SourceHeadroom(key === 'workspace' ? 'WORKSPACE_BYTES' : 'TARGET_BYTES', fs.bavail * fs.bsize, BigInt(d1.resources[`required_${key}_bytes`]), 'MINIMUM'); assertD3SourceHeadroom(key === 'workspace' ? 'WORKSPACE_INODES' : 'TARGET_INODES', fs.ffree, BigInt(d1.resources[`required_${key}_inodes`]), 'MINIMUM'); }
    } catch (cause) { if (cause instanceof ControlledRecoveryError) throw cause; throw authorityFailure('UNKNOWN'); }
  }
  private async configurations() { return d3SourceConfigurations(this.activation, this.profile, await this.layout.verify(), this.state.profileSha256); }
  async verifyProbeTarget(role: 'postgres' | 'minio' | 'valkey', containerId: string): Promise<void> {
    const record = (await this.state.resources()).resources.find((resource) => resource.role === role && !resource.retired && resource.id === containerId); if (!record) throw failure();
    const observed = await new FixedD3Docker(this.activation, this).inspectSourceResource(this.profile, role, (await this.configurations())[role]);
    if (!observed.running || digest(observed.resource) !== digest(record)) throw failure();
  }
  readOnlyView(): D3DockerExecution { return { executeFixed: (input) => this.execute(input, true) }; }
  async verifyProbeTargetReadOnly(role: 'postgres' | 'minio' | 'valkey', containerId: string, layout: Pick<D3SourceLayoutBoundary, 'verify'>): Promise<void> {
    const state = this.state.readOnlyView(); const record = (await state.resources()).resources.find((resource) => resource.role === role && !resource.retired && resource.id === containerId); if (!record) throw failure();
    const configurations = d3SourceConfigurations(this.activation, this.profile, await layout.verify(), state.profileSha256);
    const observed = await new FixedD3Docker(this.activation, this.readOnlyView()).inspectSourceResource(this.profile, role, configurations[role]); if (!observed.running || digest(observed.resource) !== digest(record)) throw failure();
  }
  private async cid(path: string): Promise<string | null> { let handle; try { handle = await openD3ProtectedFile(this.authority, path, 128); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw failure(); }
    try { const value = (await handle.readFile('utf8')).trim(); if (!/^[a-f0-9]{64}$/.test(value)) throw failure(); await handle.sync(); return value; } finally { await handle.close(); } }
  async executeFixed(input: Request) { return this.execute(input, false); }
  private async execute(input: Request, readOnly: boolean) {
    if (input.executable !== '/usr/bin/docker' || digest(input.env) !== digest(environment) || digest(input.argv.slice(0, 4)) !== digest(prefix) || !Number.isSafeInteger(input.maximumOutputBytes) || input.maximumOutputBytes < 1 || input.maximumOutputBytes > 2 * 1024 * 1024 || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 120000) throw failure();
    const args = input.argv.slice(4); const [kind, action] = args; if (!['container', 'network', 'volume'].includes(kind ?? '') || !['ls', 'inspect', 'create', 'start', 'stop', 'wait', 'rm'].includes(action ?? '') || readOnly && !['ls', 'inspect'].includes(action ?? '')) throw failure(); await this.assertHostAdmission();
    if (action === 'ls') {
      const expected = kind === 'container' ? ['container', 'ls', '--all', '--no-trunc', '--format', '{{json .}}'] : kind === 'network' ? ['network', 'ls', '--no-trunc', '--format', '{{json .}}'] : ['volume', 'ls', '--format', '{{json .}}'];
      if (digest(args) !== digest(expected)) throw failure(); const result = await this.checkedRun(args, input.timeoutMs, input.maximumOutputBytes, input.signal);
      const ids = result.stdout.toString('utf8').trim().split('\n').filter(Boolean).map((line) => { const row = parseStrictJson(Buffer.from(line), 64 * 1024) as { ID?: string; Name?: string }; return kind === 'volume' ? row.Name! : row.ID!; });
      if (ids.length > 256 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || (kind !== 'volume' && !/^[a-f0-9]{64}$/.test(id)))) throw failure(); this.listed.set(kind!, new Set(ids)); return result;
    }
    if (action === 'inspect') {
      const selectors = args.slice(2); if (!selectors.length || selectors.length > 256) throw failure();
      const roleNames = Object.entries(D3_SOURCE_RESOURCE_NAMES).filter(([role]) => kind === (role === 'network' ? 'network' : role.endsWith('-volume') ? 'volume' : 'container'));
      if (selectors.some((selector) => !roleNames.some(([, name]) => selector === name) && !this.listed.get(kind!)?.has(selector))) throw failure();
      if (kind === 'container' && selectors.every((selector) => /^[a-f0-9]{64}$/.test(selector))) return { exitCode: 0, stdout: Buffer.from(JSON.stringify(await this.minimalContainers(selectors))), stderr: Buffer.alloc(0) };
      if (kind === 'container') {
        if (selectors.length !== 1) throw failure(); const role = roleNames.find(([, name]) => name === selectors[0])?.[0] as D3SourceResourceRole; const record = (await (readOnly ? this.state.readOnlyView() : this.state).resources()).resources.find((resource) => resource.role === role && !resource.retired);
        const expectedId = record?.id ?? (readOnly ? null : await this.cid(`${this.profile.state_root}/cids/${role}.cid`)); const minimalRows = await this.minimalContainers(selectors); if (!expectedId || minimalRows.length !== 1 || minimalRows[0]!.Id !== expectedId) throw failure();
      }
      return this.checkedRun(args, input.timeoutMs, input.maximumOutputBytes, input.signal);
    }
    await this.state.assertCurrentCommand();
    if (action === 'create') {
      if (!D3_SOURCE_HELPER_CAPABILITY.minioBinaryFileCredentialsVerified) throw failure('CONTROLLED_RECOVERY_D3_MINIO_FILE_CREDENTIALS_UNVERIFIED');
      const role = args.find((value) => value.startsWith('com.darshan.d3.role='))?.split('=')[1] as D3SourceResourceRole; const configurations = await this.configurations();
      if (!(role in D3_SOURCE_RESOURCE_NAMES) || digest(args) !== digest(fixedD3SourceDockerPlan(this.activation, this.profile, role, configurations[role]).argv) || !(await this.state.resources()).pendingRoles.includes(role)) throw failure();
      await this.admitEffect(`DOCKER_CREATE_${role}`);
      if (kind === 'container') { const cid = `${this.profile.state_root}/cids/${role}.cid`; await protectD3Directory(this.authority, dirname(cid), true); if (await this.cid(cid)) throw failure(); }
      try { const result = await this.run(args, input.timeoutMs, input.maximumOutputBytes, input.signal); if (result.exitCode !== 0) throw failure(); return result; }
      catch (cause) { if (cause instanceof ControlledRecoveryError && cause.code === 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN') await this.state.retainUncertainCommand(digest({ role, reason: 'CLI_UNJOINED' }));
        await publishD3ProtectedBytes(this.authority, `${this.authority.root}/source/state/executor-${role}-interrupted.json`, canonicalJson({ operationId: this.authority.operationId, role,
        cid: kind === 'container' ? await this.cid(`${this.profile.state_root}/cids/${role}.cid`) : null, state: 'CREATE_UNCERTAIN', requiresOwnedReobservation: true })); throw failure(input.signal?.aborted ? 'CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED' : 'CONTROLLED_RECOVERY_D3_SOURCE_CREATE_UNCERTAIN'); }
    }
    await this.admitEffect(`DOCKER_${kind}_${action}`); const id = args.at(-1)!; const retained = (await this.state.resources()).resources.find((resource) => resource.id === id && resource.kind === 'container' && !resource.retired); if (!retained || kind !== 'container') throw failure();
    const expected = action === 'start' ? ['container', 'start', id] : action === 'stop' ? ['container', 'stop', '--time', '30', id] : action === 'wait' ? ['container', 'wait', id] : action === 'rm' && retained.role === 'postgres-init' ? ['container', 'rm', id] : [];
    if (!expected.length || digest(args) !== digest(expected)) throw failure(); const configs = await this.configurations(); const raw = await this.json(['container', 'inspect', id]) as unknown[];
    if (raw.length !== 1 || digest(sourceObservation(raw[0], fixedD3SourceDockerPlan(this.activation, this.profile, retained.role, configs[retained.role]), this.profile).resource) !== digest(retained)) throw failure();
    try { const result = await this.run(args, input.timeoutMs, input.maximumOutputBytes, input.signal); if (result.exitCode !== 0) throw failure(); return result; }
    catch (cause) { if (cause instanceof ControlledRecoveryError && cause.code === 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN') await this.state.retainUncertainCommand(digest({ id, action, reason: 'CLI_UNJOINED' }));
      if (action === 'start') { const stop = await this.run(['container', 'stop', '--time', '5', id], 10000); if (stop.exitCode !== 0 || (await this.run(['container', 'wait', id], 10000)).exitCode !== 0) { await this.state.retainUncertainCommand(digest({ id, reason: 'CONTAINER_UNSETTLED' })); throw failure('CONTROLLED_RECOVERY_D3_SOURCE_SETTLEMENT_UNCERTAIN'); } }
      throw failure(input.signal?.aborted ? 'CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED' : 'CONTROLLED_RECOVERY_D3_SOURCE_EXECUTION_FAILED'); }
  }
  async executeVolume(operation: D3VolumeOperation, signal?: AbortSignal): Promise<{ stdout: Buffer }> {
    if (signal?.aborted) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED');
    await this.admitEffect('VOLUME_HELPER');
    await this.assertHostAdmission(); await this.state.assertCurrentCommand(); const retained = await this.state.resources(); if (retained.pendingRoles.length || retained.resources.some((resource) => resource.kind === 'container' && !resource.retired)) throw failure();
    const resource = retained.resources.find((value) => value.role === `${operation.role}-volume`); if (!resource) throw failure(); const layout = await this.layout.verify(); const plan = fixedD3VolumePlan(this.authority, this.profile, operation, layout.evidenceSha256, resource);
    if (plan.source) { const handle = await openD3ProtectedFile(this.authority, plan.source, 64 * 1024); await handle.close(); }
    const inventory = await new FixedD3Docker(this.activation, this).inspectSourceInventory(this.profile, await this.configurations());
    if (inventory.subnetCollision || inventory.volumeConsumers.length || inventory.observed.some((entry) => entry.consumers.length || !retained.resources.some((record) => !record.retired && digest(record) === digest(entry.resource))) ||
        retained.resources.some((record) => !record.retired && !inventory.observed.some((entry) => digest(entry.resource) === digest(record)))) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_FOREIGN_VOLUME_CONSUMER');
    if (signal?.aborted) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED');
    await protectD3Directory(this.authority, dirname(plan.cidfile), true); const lock = `${dirname(plan.cidfile)}/active.lock`; await mkdir(lock, { mode: 0o700 }); let settled = false;
    try {
      if (await this.cid(plan.cidfile)) throw failure(); let result: Awaited<ReturnType<BoundedD3SourceProcess['run']>> | undefined; let error: unknown;
      try { result = await this.process.run({ executable: '/usr/bin/docker', argv: plan.argv, cwd: this.authority.root, timeoutMs: 30000, maximumOutputBytes: 64 * 1024, ...(signal ? { signal } : {}) }); } catch (cause) { error = cause; }
      const id = await this.cid(plan.cidfile); if (!id) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_SETTLEMENT_UNCERTAIN'); const observed = await this.json(['container', 'inspect', id]) as Array<{ Id: string; Name: string; Image: string; Config: { Labels: Record<string, string> }; HostConfig: { NetworkMode: string } }>;
      const entry = observed[0]; if (observed.length !== 1 || !entry || entry.Id !== id || entry.Name !== `/${plan.name}` || entry.Image !== D3_SOURCE_HELPER_CAPABILITY.imageId || entry.HostConfig.NetworkMode !== 'none' || Object.entries(plan.labels).some(([key, value]) => entry.Config.Labels[key] !== value)) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_SETTLEMENT_UNCERTAIN');
      const removed = await this.run(['container', 'rm', '--force', '--volumes', id], 10000); if (removed.exitCode !== 0) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_SETTLEMENT_UNCERTAIN');
      const remaining = await this.run(['container', 'ls', '--all', '--no-trunc', '--format', '{{json .}}'], 10000); if (remaining.exitCode !== 0) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_SETTLEMENT_UNCERTAIN');
      const rows = remaining.stdout.toString('utf8').split('\n').filter(Boolean).map((line) => parseStrictJson(Buffer.from(line), 64 * 1024) as { ID: string; Names: string });
      if (rows.length > 256 || new Set(rows.map((row) => row.ID)).size !== rows.length || rows.some((row) => !row || !/^[a-f0-9]{64}$/.test(row.ID) || typeof row.Names !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(row.Names) || row.ID === id || row.Names === plan.name)) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_SETTLEMENT_UNCERTAIN');
      if (error instanceof ControlledRecoveryError && error.code === 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN') { await this.state.retainUncertainCommand(digest({ operation, id, reason: 'CLI_UNJOINED' })); throw failure('CONTROLLED_RECOVERY_D3_SOURCE_SETTLEMENT_UNCERTAIN'); }
      settled = true; if (signal?.aborted) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED'); if (error || !result || result.exitCode !== 0 || (['directory', 'install', 'sync'].includes(operation.action) && result.stdout.length)) throw failure('CONTROLLED_RECOVERY_D3_SOURCE_VOLUME_OPERATION_FAILED'); return { stdout: result.stdout };
    } catch (cause) { if (!settled) await this.state.retainUncertainCommand(digest({ operation, reason: 'HELPER_SETTLEMENT_UNCERTAIN' })); throw cause; }
    finally { if (settled) { await unlink(plan.cidfile); await rmdir(lock); await syncD3Directory(dirname(plan.cidfile)); } }
  }
}
