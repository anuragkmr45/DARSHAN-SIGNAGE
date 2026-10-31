import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process';
import { lstat, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { D3_TOOL_ENV, fixedD3ToolInvocation, type D3ContainerToolExecution, type D3ContainerToolsAuthority } from './controlled-recovery-d4-tools';
import { assertD3ContainerToolsImage } from './controlled-recovery-d4-tools';
import { loadDevelopmentReadinessActivation, type DevelopmentReadinessActivation, type DevelopmentFileStat } from './controlled-recovery-readiness';
import { parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { openD3ProtectedFile, protectD3Directory, syncD3Directory } from './controlled-recovery-d3-protected-files';

type Invocation = Parameters<D3ContainerToolExecution['runFixed']>[0];
type Spawn = (executable: string, argv: readonly string[], options: SpawnOptions) => ChildProcess;
type Result = { exitCode: number; stdout: Uint8Array; stderr: Uint8Array };
const prefix = ['--config', '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config', '--context', 'default'];
const failure = (code: string) => new ControlledRecoveryError(code, 'The fixed D3 tool execution failed or could not prove exact process/container settlement.');
type Enrollment = () => Promise<{ docker: DevelopmentReadinessActivation['docker']; socket: DevelopmentFileStat }>;
async function installedEnrollment(): ReturnType<Enrollment> {
  const { docker } = await loadDevelopmentReadinessActivation(); const stat = await lstat(docker.socket_path);
  const config = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config';
  const directory = await open(config, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { const identity = await directory.stat(); if (identity.uid !== process.getuid?.() || (identity.mode & 0o002) !== 0 || digest(await readdir(config)) !== digest(['config.json'])) throw failure('CONTROLLED_RECOVERY_D3_EXECUTION_ENROLLMENT_CHANGED'); }
  finally { await directory.close(); }
  const handle = await open(`${config}/config.json`, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const identity = await handle.stat(); if (!identity.isFile() || identity.nlink !== 1 || identity.uid !== process.getuid?.() || (identity.mode & 0o002) !== 0 || identity.size !== 13 || (await handle.readFile('utf8')) !== '{"auths":{}}\n') throw failure('CONTROLLED_RECOVERY_D3_EXECUTION_ENROLLMENT_CHANGED'); }
  finally { await handle.close(); }
  return { docker, socket: { kind: stat.isSocket() ? 'socket' : 'other', uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777, dev: stat.dev.toString(), ino: stat.ino.toString(), size: stat.size.toString() } };
}
export interface D3ExecutionStorage {
  acquire(input: Invocation): Promise<void>; prepareMounts(input: Invocation): Promise<void>; cid(input: Invocation): Promise<string | null>; release(input: Invocation): Promise<void>;
  validateOutputs?(input: Invocation): Promise<void>; releaseCid?(input: Invocation, expectedId?: string): Promise<void>;
  assertAgeComponentsClear?(input: Invocation): Promise<void>; releaseSlot?(input: Invocation): Promise<void>;
  assertSlotOwnership?(input: Invocation): Promise<{ device: string; inode: string }>;
}
const ageComponents = ['age-version', 'age-fingerprint', 'age-keygen', 'age-recipient', 'age-encrypt', 'age-decrypt'] as const;
export interface D3SharedAgeSlot { withAgeSlot<T>(action: (execution: D3ContainerToolExecution) => Promise<T>, signal?: AbortSignal): Promise<T>; }

export class ProtectedD3ExecutionStorage implements D3ExecutionStorage {
  private readonly ownedSlots = new Map<string, { device: string; inode: string }>();
  constructor(private readonly authority: D3OperationAuthority, private readonly tools: D3ContainerToolsAuthority) {}
  private lock(input: Invocation) { return `${this.authority.root}/run/tool-slots/${input.owned.slot}.lock`; }
  async acquire(input: Invocation) {
    await protectD3Directory(this.authority, dirname(input.owned.cidfile), true);
    try { await mkdir(this.lock(input), { mode: 0o700 }); }
    catch { throw failure('CONTROLLED_RECOVERY_D3_TOOL_SLOT_BUSY'); }
    try { if (await this.cid(input)) throw failure('CONTROLLED_RECOVERY_D3_TOOL_CID_RETAINED'); const s = await lstat(this.lock(input)); this.ownedSlots.set(this.lock(input), { device: String(s.dev), inode: String(s.ino) }); }
    catch (cause) { await rmdir(this.lock(input)); throw cause; }
  }
  async prepareMounts(input: Invocation) {
    const plan = fixedD3ToolInvocation(this.tools, this.authority, input.owned.component, input.owned.recipient);
    for (const mount of plan.mounts) {
      if (mount.source.endsWith('/recovery.age')) { const handle = await openD3ProtectedFile(this.authority, mount.source, 4096); await handle.close(); }
      else await protectD3Directory(this.authority, mount.source, !mount.readonly);
    }
    const root = this.authority.root;
    const inputs: Partial<Record<Invocation['owned']['component'], string>> = { 'age-encrypt': `${root}/staging/encrypt-input/plain.tar`, 'age-decrypt': `${root}/staging/decrypt-input/artifact.age`, ffprobe: `${root}/media/input/media`, ffmpeg: `${root}/media/input/media` };
    const outputs: Partial<Record<Invocation['owned']['component'], string>> = { 'age-keygen': `${root}/keys/pending/recovery.age`, 'age-encrypt': `${root}/staging/encrypt-output/artifact.age`, 'age-decrypt': `${root}/staging/decrypt-output/plain.tar`, ffmpeg: `${root}/media/output/media.mp4` };
    const source = inputs[input.owned.component]; if (source) { const handle = await openD3ProtectedFile(this.authority, source, 64 * 1024 * 1024); await handle.close(); }
    const output = outputs[input.owned.component]; if (output) { const existing = await lstat(output).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw cause; });
      if (existing) throw failure('CONTROLLED_RECOVERY_D3_TOOL_OUTPUT_EXISTS'); }
  }
  async cid(input: Invocation) {
    let handle; try { handle = await openD3ProtectedFile(this.authority, input.owned.cidfile, 128); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw failure('CONTROLLED_RECOVERY_D3_TOOL_CID_UNSAFE'); }
    try { const id = (await handle.readFile('utf8')).trim(); if (!/^[a-f0-9]{64}$/.test(id)) throw failure('CONTROLLED_RECOVERY_D3_TOOL_CID_UNSAFE'); return id; }
    finally { await handle.close(); }
  }
  async assertAgeComponentsClear(input: Invocation) {
    await protectD3Directory(this.authority, dirname(input.owned.cidfile));
    for (const component of ageComponents) if (await this.cid({ ...input, owned: { ...input.owned, component, cidfile: `${this.authority.root}/run/tool-slots/${component}.cid` } })) throw failure('CONTROLLED_RECOVERY_D3_TOOL_CID_RETAINED');
  }
  async releaseCid(input: Invocation, expectedId?: string) {
    const handle = await openD3ProtectedFile(this.authority, input.owned.cidfile, 128).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw cause; });
    if (expectedId && (!handle || !/^[a-f0-9]{64}$/.test(expectedId))) { await handle?.close(); throw failure('CONTROLLED_RECOVERY_D3_TOOL_CID_UNSAFE'); }
    if (handle) { const identity = await handle.stat(); try { if (expectedId && (await handle.readFile('utf8')).trim() !== expectedId) throw failure('CONTROLLED_RECOVERY_D3_TOOL_CID_UNSAFE'); } finally { await handle.close(); } const current = await lstat(input.owned.cidfile); if (current.ino !== identity.ino || current.dev !== identity.dev || current.nlink !== 1 || current.size !== identity.size || current.mtimeMs !== identity.mtimeMs || current.ctimeMs !== identity.ctimeMs) throw failure('CONTROLLED_RECOVERY_D3_TOOL_CID_UNSAFE'); }
    await unlink(input.owned.cidfile).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== 'ENOENT') throw cause; });
    await syncD3Directory(dirname(input.owned.cidfile));
  }
  async release(input: Invocation) {
    await this.releaseCid(input);
    await this.releaseSlot(input);
  }
  async releaseSlot(input: Invocation) {
    await this.assertSlotOwnership(input);
    await rmdir(this.lock(input)); await syncD3Directory(dirname(input.owned.cidfile));
    this.ownedSlots.delete(this.lock(input));
  }
  async assertSlotOwnership(input: Invocation) { const expected = this.ownedSlots.get(this.lock(input)); if (!expected) throw failure('CONTROLLED_RECOVERY_D3_AGE_SLOT_SETTLEMENT_UNCERTAIN'); await protectD3Directory(this.authority, this.lock(input)); const stat = await lstat(this.lock(input)); if (String(stat.dev) !== expected.device || String(stat.ino) !== expected.inode) throw failure('CONTROLLED_RECOVERY_D3_AGE_SLOT_SETTLEMENT_UNCERTAIN'); return expected; }
  async validateOutputs(input: Invocation) {
    const root = this.authority.root; const outputs: Partial<Record<Invocation['owned']['component'], string>> = {
      'age-keygen': `${root}/keys/pending/recovery.age`, 'age-encrypt': `${root}/staging/encrypt-output/artifact.age`, 'age-decrypt': `${root}/staging/decrypt-output/plain.tar`, ffmpeg: `${root}/media/output/media.mp4`,
    };
    const path = outputs[input.owned.component]; if (!path) return;
    const handle = await openD3ProtectedFile(this.authority, path, input.owned.component === 'age-keygen' ? 4096 : 64 * 1024 * 1024); await handle.close();
  }
}

/** The sole executable is Docker; the complete run argv is rebuilt and compared before dispatch. No shell, stdin or ambient credentials. */
export class DirectD3ToolExecution implements D3ContainerToolExecution, D3SharedAgeSlot {
  private readonly slots = new Map<string, Promise<unknown>>();
  private readonly active = new Map<string, Invocation>();
  constructor(private readonly authority: D3OperationAuthority, private readonly tools: D3ContainerToolsAuthority,
    private readonly spawnProcess: Spawn = spawn, private readonly storage: D3ExecutionStorage = new ProtectedD3ExecutionStorage(authority, tools), private readonly enrollment: Enrollment = installedEnrollment) {}
  private validate(input: Invocation) {
    const expected = fixedD3ToolInvocation(this.tools, this.authority, input.owned.component, input.owned.recipient);
    if (input.executable !== '/usr/bin/docker' || digest(input.argv) !== digest(expected.argv) || digest(input.owned) !== digest(expected.owned) || digest(input.env) !== digest(D3_TOOL_ENV) ||
        !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 120_000 || !Number.isSafeInteger(input.maximumOutputBytes) || input.maximumOutputBytes < 1 || input.maximumOutputBytes > 1024 * 1024)
      throw failure('CONTROLLED_RECOVERY_D3_EXECUTION_INPUT_INVALID');
  }
  runFixed(input: Invocation): Promise<Result> {
    try { this.validate(input); } catch (cause) { return Promise.reject(cause); }
    const prior = this.slots.get(input.owned.slot) ?? Promise.resolve();
    const pending = prior.catch(() => undefined).then(() => this.execute(input)); this.slots.set(input.owned.slot, pending);
    return pending.finally(() => { if (this.slots.get(input.owned.slot) === pending) this.slots.delete(input.owned.slot); });
  }
  /** The outer lease owns the same durable age.lock used by every ordinary D4 invocation. */
  withAgeSlot<T>(action: (execution: D3ContainerToolExecution) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const prior = this.slots.get('age') ?? Promise.resolve();
    const pending = prior.catch(() => undefined).then(async () => {
      if (signal?.aborted || !this.storage.releaseCid || !this.storage.releaseSlot || !this.storage.assertAgeComponentsClear) throw failure(signal?.aborted ? 'CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED' : 'CONTROLLED_RECOVERY_D3_SHARED_AGE_SLOT_UNAVAILABLE');
      const plan = fixedD3ToolInvocation(this.tools, this.authority, 'age-version'); const owner: Invocation = { executable: '/usr/bin/docker', argv: plan.argv, owned: plan.owned, env: D3_TOOL_ENV, timeoutMs: 120000, maximumOutputBytes: 1048576 };
      await this.storage.acquire(owner); let uncertain = false; let closed = false; let innerFailed = false; let innerFailure: unknown; let tail: Promise<unknown> = Promise.resolve();
      const latch = (cause: unknown) => { if (!innerFailed) { innerFailed = true; innerFailure = cause; } };
      const rejected = (cause: unknown): Promise<Result> => { const result = Promise.reject<Result>(cause); void result.catch(() => undefined); return result; };
      const execution: D3ContainerToolExecution = { runFixed: (input) => {
        try { if (closed) throw failure('CONTROLLED_RECOVERY_D3_EXECUTION_INPUT_INVALID'); if (uncertain) throw failure('CONTROLLED_RECOVERY_D3_AGE_SLOT_SETTLEMENT_UNCERTAIN'); if (innerFailed) return rejected(innerFailure); this.validate(input); if (input.owned.slot !== 'age' || !['age-recipient', 'age-encrypt', 'age-decrypt'].includes(input.owned.component)) throw failure('CONTROLLED_RECOVERY_D3_EXECUTION_INPUT_INVALID'); } catch (cause) { latch(cause); return rejected(cause); }
        const invocation = tail.catch(() => undefined).then(() => { if (innerFailed) throw innerFailure; if (uncertain) throw failure('CONTROLLED_RECOVERY_D3_AGE_SLOT_SETTLEMENT_UNCERTAIN'); return this.execute(input, () => { uncertain = true; }); });
        void invocation.catch(latch); tail = invocation; return invocation;
      }, terminateAndJoin: (name, timeout) => this.terminateAndJoin(name, timeout), assertSharedAgeOwnership: async () => { if (closed || uncertain || innerFailed || !this.storage.assertSlotOwnership) throw failure('CONTROLLED_RECOVERY_D3_AGE_SLOT_SETTLEMENT_UNCERTAIN'); await this.storage.assertAgeComponentsClear!(owner); return this.storage.assertSlotOwnership(owner); } };
      try { await this.storage.assertAgeComponentsClear(owner); await this.verifyEnrollment(); if (signal?.aborted) throw failure('CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED'); const result = await action(execution); await tail; if (innerFailed) throw innerFailure; return result; }
      catch (cause) { const outcome = innerFailed ? innerFailure : cause; try { await tail; } catch (pendingCause) { latch(pendingCause); if (pendingCause instanceof ControlledRecoveryError && pendingCause.code.includes('UNCERTAIN')) uncertain = true; } if (cause instanceof ControlledRecoveryError && cause.code.includes('UNCERTAIN')) uncertain = true; throw outcome; }
      finally { closed = true; if (!uncertain) await this.releaseSharedAge(owner); }
    });
    this.slots.set('age', pending); return pending.finally(() => { if (this.slots.get('age') === pending) this.slots.delete('age'); });
  }
  private async releaseSharedAge(owner: Invocation) { try { await this.storage.releaseSlot!(owner); } catch { throw failure('CONTROLLED_RECOVERY_D3_AGE_SLOT_SETTLEMENT_UNCERTAIN'); } }
  private async releaseInvocation(input: Invocation, retainOuter?: () => void, expectedId?: string) { if (!retainOuter) { await this.storage.release(input); return; } try { if (!expectedId) throw failure('CONTROLLED_RECOVERY_D3_AGE_SLOT_SETTLEMENT_UNCERTAIN'); await this.storage.releaseCid!(input, expectedId); } catch { retainOuter(); throw failure('CONTROLLED_RECOVERY_D3_AGE_SLOT_SETTLEMENT_UNCERTAIN'); } }
  private bounded(argv: readonly string[], timeoutMs: number, maximumOutputBytes: number, signal?: AbortSignal): Promise<Result> {
    if (signal?.aborted) return Promise.reject(failure('CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED'));
    return new Promise((resolve, reject) => {
      let child: ChildProcess; let reason: string | undefined; let spawned = false; let bytes = 0; const stdout: Buffer[] = []; const stderr: Buffer[] = [];
      let kill: ReturnType<typeof setTimeout> | undefined; let join: ReturnType<typeof setTimeout> | undefined; let settled = false;
      const finish = (exitCode: number | null) => { if (settled) return; settled = true; clearTimeout(deadline); clearTimeout(kill); clearTimeout(join); signal?.removeEventListener('abort', abort);
        if (reason) reject(failure(reason)); else resolve({ exitCode: exitCode ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }); };
      const stop = (code: string) => { if (reason) return; reason = code; child.kill('SIGTERM'); kill = setTimeout(() => child.kill('SIGKILL'), 250);
        join = setTimeout(() => { if (!settled) { reason = 'CONTROLLED_RECOVERY_D3_CLI_SETTLEMENT_UNCERTAIN'; finish(null); } }, 2250); };
      const abort = () => stop('CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED');
      const previousUmask = process.umask(0o077);
      try { child = this.spawnProcess('/usr/bin/docker', argv, { cwd: this.authority.root, env: D3_TOOL_ENV, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
      catch { reject(failure('CONTROLLED_RECOVERY_D3_TOOL_SPAWN_FAILED')); return; }
      finally { process.umask(previousUmask); }
      const deadline = setTimeout(() => stop('CONTROLLED_RECOVERY_D3_TOOL_TIMEOUT'), timeoutMs);
      const collect = (destination: Buffer[]) => (chunk: Buffer) => { bytes += chunk.length; if (bytes > maximumOutputBytes) stop('CONTROLLED_RECOVERY_D3_TOOL_OUTPUT_LIMIT'); else if (!reason) destination.push(Buffer.from(chunk)); };
      child.stdout!.on('data', collect(stdout)); child.stderr!.on('data', collect(stderr));
      child.once('spawn', () => { spawned = true; }); child.once('error', () => stop(spawned ? 'CONTROLLED_RECOVERY_D3_CLI_SETTLEMENT_UNCERTAIN' : 'CONTROLLED_RECOVERY_D3_TOOL_SPAWN_FAILED')); child.once('close', finish);
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
  }
  private async list(): Promise<Array<{ ID: string; Names: string }>> {
    const result = await this.bounded([...prefix, 'container', 'ls', '--all', '--no-trunc', '--format', '{{json .}}'], 10_000, 1024 * 1024);
    if (result.exitCode !== 0) throw failure('CONTROLLED_RECOVERY_D3_CONTAINER_OBSERVATION_UNCERTAIN');
    try { const rows = Buffer.from(result.stdout).toString('utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { ID: string; Names: string });
      if (rows.some((row) => !/^[a-f0-9]{64}$/.test(row.ID) || typeof row.Names !== 'string')) throw new Error('invalid'); return rows;
    } catch { throw failure('CONTROLLED_RECOVERY_D3_CONTAINER_OBSERVATION_UNCERTAIN'); }
  }
  private async verifyEnrollment(): Promise<void> {
    try {
      const { docker, socket } = await this.enrollment();
      if (socket.kind !== 'socket' || digest(socket) !== docker.expected_socket_sha256 || docker.context !== 'default' || docker.endpoint !== 'unix:///var/run/docker.sock') throw new Error('socket');
      const read = async (argv: string[]) => { const result = await this.bounded([...prefix, ...argv], 10_000, 1024 * 1024); if (result.exitCode !== 0) throw new Error('observe'); return parseStrictJson(Buffer.from(result.stdout), 1024 * 1024); };
      const contexts = await read(['context', 'inspect', 'default']) as Array<{ Name: string; Endpoints: { docker: { Host: string; SkipTLSVerify?: boolean } } }>;
      if (contexts.length !== 1 || contexts[0]!.Name !== 'default' || contexts[0]!.Endpoints.docker.Host !== docker.endpoint || contexts[0]!.Endpoints.docker.SkipTLSVerify === true) throw new Error('context');
      const daemon = await read(['info', '--format', '{{json .}}']) as { ID: string; Name: string; Driver: string; ServerVersion: string; DockerRootDir: string; SecurityOptions: string[] };
      if (digest({ id: daemon.ID, name: daemon.Name, driver: daemon.Driver, serverVersion: daemon.ServerVersion, rootDir: daemon.DockerRootDir, securityOptions: [...daemon.SecurityOptions].sort() }) !== docker.expected_daemon_sha256 ||
          daemon.ServerVersion !== docker.expected_server_version || daemon.DockerRootDir !== docker.expected_root_dir) throw new Error('daemon');
      const images = await read(['image', 'inspect', this.tools.imageId!]) as Array<{ Id: string; RepoDigests: string[]; Config: { Labels: Record<string, string> } }>;
      if (images.length !== 1 || !images[0]) throw new Error('image');
      assertD3ContainerToolsImage(this.tools, { imageId: images[0].Id, repoDigests: images[0].RepoDigests, configSha256: digest(images[0].Config), labels: images[0].Config.Labels });
    } catch { throw failure('CONTROLLED_RECOVERY_D3_EXECUTION_ENROLLMENT_CHANGED'); }
  }
  private async settleContainer(input: Invocation): Promise<string | null> {
    const cid = await this.storage.cid(input); const rows = await this.list(); const named = rows.filter(({ Names }) => Names === input.owned.containerName);
    if (!named.length) { if (cid && rows.every(({ ID }) => ID !== cid)) return null; throw failure('CONTROLLED_RECOVERY_D3_CONTAINER_SETTLEMENT_UNCERTAIN'); }
    if (!cid || named.length !== 1 || named[0]!.ID !== cid) throw failure('CONTROLLED_RECOVERY_D3_CONTAINER_SETTLEMENT_UNCERTAIN');
    const id = named[0]!.ID; const observed = await this.bounded([...prefix, 'container', 'inspect', id], 10_000, 1024 * 1024);
    if (observed.exitCode !== 0) throw failure('CONTROLLED_RECOVERY_D3_CONTAINER_SETTLEMENT_UNCERTAIN');
    try { const values = JSON.parse(Buffer.from(observed.stdout).toString('utf8')) as Array<{ Id: string; Name: string; Config: { Image: string; Labels: Record<string, string> } }>;
      const item = values[0]; if (values.length !== 1 || !item || item.Id !== id || item.Name !== `/${input.owned.containerName}` || item.Config.Image !== this.tools.imageId ||
          item.Config.Labels['com.darshan.d3.operation'] !== input.owned.operationId || item.Config.Labels['com.darshan.d3.component'] !== input.owned.component || item.Config.Labels['com.darshan.development-only'] !== 'true') throw new Error('foreign');
    } catch { throw failure('CONTROLLED_RECOVERY_D3_CONTAINER_OWNERSHIP_UNPROVEN'); }
    await this.bounded([...prefix, 'container', 'rm', '--force', '--volumes', id], 10_000, 1024 * 1024);
    const remaining = await this.list(); if (remaining.some((row) => row.ID === id || row.Names === input.owned.containerName)) throw failure('CONTROLLED_RECOVERY_D3_CONTAINER_SETTLEMENT_UNCERTAIN');
    return id;
  }
  private async execute(input: Invocation, retainOuter?: () => void): Promise<Result> {
    if (input.signal?.aborted) throw failure('CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED');
    if (!retainOuter) await this.storage.acquire(input); let release = true; let dispatched = false; let borrowedCidSettled: string | null = null;
    try {
      if (retainOuter && await this.storage.cid(input)) throw failure('CONTROLLED_RECOVERY_D3_TOOL_CID_RETAINED');
      await this.verifyEnrollment();
      await this.storage.prepareMounts(input);
      if ((await this.list()).some(({ Names }) => Names === input.owned.containerName)) throw failure('CONTROLLED_RECOVERY_D3_CONTAINER_NAME_COLLISION');
      if (input.signal?.aborted) throw failure('CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED');
      if (retainOuter && await this.storage.cid(input)) throw failure('CONTROLLED_RECOVERY_D3_TOOL_CID_RETAINED');
      this.active.set(input.owned.containerName, input); let result: Result | undefined; let cause: unknown;
      try { dispatched = true; result = await this.bounded(input.argv, input.timeoutMs, input.maximumOutputBytes, input.signal); } catch (error) { cause = error; }
      // A failed spawn cannot have reached Docker. All other outcomes must prove container settlement.
      if (!(cause instanceof ControlledRecoveryError && cause.code === 'CONTROLLED_RECOVERY_D3_TOOL_SPAWN_FAILED')) {
        try { borrowedCidSettled = await this.settleContainer(input); if (retainOuter && !borrowedCidSettled) throw failure('CONTROLLED_RECOVERY_D3_CONTAINER_SETTLEMENT_UNCERTAIN'); }
        catch (error) { release = false; throw error; }
      }
      if (cause instanceof ControlledRecoveryError && cause.code === 'CONTROLLED_RECOVERY_D3_CLI_SETTLEMENT_UNCERTAIN') { release = false; throw cause; }
      if (cause) throw cause;
      if (result?.exitCode === 0) await this.storage.validateOutputs?.(input);
      return result!;
    } catch (cause) {
      if (!dispatched && cause instanceof ControlledRecoveryError && cause.code === 'CONTROLLED_RECOVERY_D3_CONTAINER_OBSERVATION_UNCERTAIN') release = false;
      throw cause;
    } finally { this.active.delete(input.owned.containerName); if (!release) retainOuter?.(); if (release && (!retainOuter || borrowedCidSettled)) await this.releaseInvocation(input, retainOuter, borrowedCidSettled ?? undefined); }
  }
  async terminateAndJoin(containerName: string, timeoutMs: number): Promise<void> {
    const input = this.active.get(containerName);
    if (!input || timeoutMs !== 10_000) throw failure('CONTROLLED_RECOVERY_D3_CONTAINER_OWNERSHIP_UNPROVEN');
    // Cancellation belongs to runFixed's AbortSignal. A second cleanup path must not race its CLI settlement.
    throw failure('CONTROLLED_RECOVERY_D3_CANCELLATION_REQUIRES_SIGNAL');
  }
}
