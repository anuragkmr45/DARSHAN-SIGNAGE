import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { DirectD3ToolExecution, ProtectedD3ExecutionStorage, type D3ExecutionStorage } from './controlled-recovery-d3-execution';
import { publishD3ProtectedBytes } from './controlled-recovery-d3-protected-files';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { D3_TOOL_ENV, fixedD3ToolInvocation, type D3ContainerToolsAuthority, type D3ContainerToolExecution, type D3ToolComponent } from './controlled-recovery-d4-tools';
import { testD3Operation, testWrapperAuthority, testWrapperLabels } from './controlled-recovery-d3.test-support';
import d1Json from '../../../deploy/development/controlled-recovery/tiny-readiness.activation.json';
import { developmentReadinessActivationSchema } from './controlled-recovery-readiness';

type Input = Parameters<D3ContainerToolExecution['runFixed']>[0];
const labels = { ...testWrapperLabels, 'com.darshan.development-only': 'true', 'com.darshan.d3.role': 'container-tools', 'com.darshan.d3.age-apk-version': '1.3.2-r1', 'com.darshan.d3.ffmpeg-apk-version': '8.1.3-r0' };
const config = { Labels: labels };
const tools: D3ContainerToolsAuthority = { ...testWrapperAuthority, enrolled: true, imageReference: 'darshan-d3-tools:packet-d4', imageId: `sha256:${digest('image')}`, repoDigest: `darshan-d3-tools@sha256:${digest('image')}`,
  configSha256: digest(config), dockerfileSha256: digest('dockerfile'), lockSha256: digest('lock'), agePackageVersion: '1.3.2-r1', ffmpegPackageVersion: '8.1.3-r0' };
function invocation(component: D3ToolComponent = 'age-version', signal?: AbortSignal): Input {
  const plan = fixedD3ToolInvocation(tools, testD3Operation, component);
  return { executable: '/usr/bin/docker', argv: plan.argv, owned: plan.owned, env: D3_TOOL_ENV, timeoutMs: 100, maximumOutputBytes: 1024, ...(signal ? { signal } : {}) };
}
type Fault = 'none' | 'nonzero' | 'spawn' | 'overflow' | 'timeout' | 'unjoined' | 'foreign' | 'cleanup' | 'wrong-labels' | 'no-cid' | 'wrong-image' | 'slow' | 'absent-container' | 'gated';
function fixture(fault: Fault = 'none', foreignComponent: D3ToolComponent = 'age-version') {
  const id = digest('container'); let owned: Input['owned'] | null = fault === 'foreign' ? invocation(foreignComponent).owned : null; let cid: string | null = null;
  let started!: () => void; const ready = new Promise<void>((resolve) => { started = resolve; }); let completeRun: (() => void) | undefined; let active = 0; let peak = 0;
  const release = vi.fn(async () => { cid = null; }); const releaseCid = vi.fn(async () => { cid = null; }); const storage: D3ExecutionStorage = { acquire: vi.fn(async () => undefined), prepareMounts: vi.fn(async () => undefined), cid: async () => cid, release, releaseCid, releaseSlot: release, assertAgeComponentsClear: vi.fn(async () => undefined) };
  const socket = { kind: 'socket' as const, uid: 0, gid: 0, mode: 0o660, dev: '1', ino: '2', size: '0' };
  const daemon = { ID: 'daemon', Name: 'development', Driver: 'overlay2', ServerVersion: '29.9.0', DockerRootDir: '/var/lib/docker', SecurityOptions: ['name=seccomp'] };
  const d1 = developmentReadinessActivationSchema.parse(d1Json); d1.docker.expected_socket_sha256 = digest(socket); d1.docker.expected_daemon_sha256 = digest({ id: daemon.ID, name: daemon.Name,
    driver: daemon.Driver, serverVersion: daemon.ServerVersion, rootDir: daemon.DockerRootDir, securityOptions: daemon.SecurityOptions });
  const calls: Array<{ executable: string; argv: readonly string[]; options: SpawnOptions }> = [];
  const kills: string[] = [];
  const spawn = (executable: string, argv: readonly string[], options: SpawnOptions): ChildProcess => {
    calls.push({ executable, argv, options }); const command = argv.slice(4); const run = command[0] === 'container' && command[1] === 'run';
    if (run && fault === 'spawn') throw new Error('private credentials must not leak');
    const child = new EventEmitter() as ChildProcess; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false; const close = (code: number) => { if (closed) return; closed = true; if (run) active--; child.emit('close', code, null); };
    child.kill = ((signal: string) => { kills.push(signal); if (fault !== 'unjoined') queueMicrotask(() => close(-1)); return true; }) as ChildProcess['kill'];
    queueMicrotask(() => {
      let output: unknown;
      if (command[0] === 'context') output = [{ Name: 'default', Endpoints: { docker: { Host: d1.docker.endpoint, SkipTLSVerify: false } } }];
      else if (command[0] === 'info') output = daemon;
      else if (command[0] === 'image') output = [{ Id: fault === 'wrong-image' ? `sha256:${digest('foreign')}` : tools.imageId, RepoDigests: [tools.repoDigest], Config: config }];
      else if (command[1] === 'ls') { if (owned) child.stdout!.emit('data', Buffer.from(JSON.stringify({ ID: id, Names: owned.containerName }) + '\n')); close(0); return; }
      else if (command[1] === 'inspect') output = [{ Id: id, Name: `/${owned!.containerName}`, Config: { Image: tools.imageId, Labels: { 'com.darshan.d3.operation': owned!.operationId,
        'com.darshan.d3.component': fault === 'wrong-labels' ? 'foreign' : owned!.component, 'com.darshan.development-only': 'true' } } }];
      else if (command[1] === 'rm') { if (fault !== 'cleanup') owned = null; close(fault === 'cleanup' ? 1 : 0); return; }
      else if (run) {
        const component = command[command.indexOf('--label') + 1]; const actualComponent = command.find((part) => part.startsWith('com.darshan.d3.component='))!.split('=')[1] as D3ToolComponent;
        expect(component).toBe(`com.darshan.d3.operation=${testD3Operation.operationId}`); owned = invocation(actualComponent).owned;
        if (fault !== 'no-cid') cid = id; active++; peak = Math.max(peak, active); started();
        if (fault === 'overflow') child.stdout!.emit('data', Buffer.alloc(2048));
        else if (fault === 'timeout' || fault === 'unjoined') return;
        else if (fault === 'gated') { completeRun = () => close(0); return; }
        else if (fault === 'slow') { setTimeout(() => close(0), 5); return; }
        else { child.stderr!.emit('data', Buffer.from('PRIVATE TOOL STDERR')); if (fault === 'no-cid' || fault === 'absent-container') owned = null; close(fault === 'nonzero' ? 23 : 0); }
        return;
      }
      child.stdout!.emit('data', Buffer.from(JSON.stringify(output))); close(0);
    });
    return child;
  };
  const execution = new DirectD3ToolExecution(testD3Operation, tools, spawn, storage, async () => ({ docker: d1.docker, socket }));
  return { execution, calls, release, releaseCid, storage, ready, kills, peak: () => peak, complete: () => completeRun?.() };
}

async function protectedFixture(fault: Fault = 'none') { const root = await mkdtemp(join(tmpdir(), 'd3-shared-cid-')); const scope = { ...testD3Operation, root } as D3OperationAuthority; const protectedStorage = new ProtectedD3ExecutionStorage(scope, tools), f = fixture(fault, 'age-recipient'); const mapped = (input: Input): Input => ({ ...input, owned: { ...input.owned, cidfile: input.owned.cidfile.replace(testD3Operation.root, root) } });
  Object.assign(f.storage, { acquire: (input: Input) => protectedStorage.acquire(mapped(input)), cid: (input: Input) => protectedStorage.cid(mapped(input)), release: (input: Input) => protectedStorage.release(mapped(input)), releaseCid: (input: Input, expectedId?: string) => protectedStorage.releaseCid(mapped(input), expectedId), releaseSlot: (input: Input) => protectedStorage.releaseSlot(mapped(input)), assertAgeComponentsClear: (input: Input) => protectedStorage.assertAgeComponentsClear(mapped(input)) });
  return { ...f, root, scope, cleanup: () => rm(root, { recursive: true, force: true }) }; }

describe('Retained real CID evidence under the shared outer age lock', () => {
  it('refuses to release a CID whose bytes no longer match the exact settled invocation ID', async () => { const f = await protectedFixture(); try { const path = `${f.root}/run/tool-slots/age-recipient.cid`, bytes = Buffer.from(`${digest('different-container')}\n`); await publishD3ProtectedBytes(f.scope, path, bytes); const before = await lstat(path); await expect(f.storage.releaseCid!(invocation('age-recipient'), digest('settled-container'))).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_TOOL_CID_UNSAFE' }); expect((await readFile(path)).equals(bytes)).toBe(true); expect((await lstat(path)).ino).toBe(before.ino); } finally { await f.cleanup(); } });
  it('retains CID/outer ownership when post-dispatch absence cannot prove this invocation owned the CID', async () => { const f = fixture('absent-container'); await expect(f.execution.withAgeSlot((execution) => execution.runFixed(invocation('age-recipient')))).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_CONTAINER_SETTLEMENT_UNCERTAIN' }); expect(f.releaseCid).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); });
  it.each(['age-version', 'age-fingerprint', 'age-keygen', 'age-recipient', 'age-encrypt', 'age-decrypt'] as const)('rejects retained %s before callback/plaintext effects without removing or replacing its evidence', async (component) => { const f = await protectedFixture(); try { const path = `${f.root}/run/tool-slots/${component}.cid`, bytes = Buffer.from(`${digest(component)}\n`); await publishD3ProtectedBytes(f.scope, path, bytes); const before = await lstat(path); const action = vi.fn(async () => { await writeFile(`${f.root}/plaintext-sentinel`, 'never', { mode: 0o600 }); }); await expect(f.execution.withAgeSlot(action)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_TOOL_CID_RETAINED' }); expect(action).not.toHaveBeenCalled(); expect(f.calls).toEqual([]); expect(await readFile(path)).toEqual(bytes); const after = await lstat(path); expect([after.dev, after.ino, after.nlink, after.mode]).toEqual([before.dev, before.ino, before.nlink, before.mode]); await expect(lstat(`${f.root}/plaintext-sentinel`)).rejects.toMatchObject({ code: 'ENOENT' }); } finally { await f.cleanup(); } });
  it.each(['output', 'name'] as const)('never releases a CID it did not create when borrowed invocation refuses %s before dispatch', async (kind) => { const f = await protectedFixture(kind === 'name' ? 'foreign' : 'none'); try { const path = `${f.root}/run/tool-slots/age-recipient.cid`, bytes = Buffer.from(`${digest('retained-after-precheck')}\n`); let inode: number | undefined; f.storage.prepareMounts = async () => { await publishD3ProtectedBytes(f.scope, path, bytes); inode = (await lstat(path)).ino; if (kind === 'output') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_TOOL_OUTPUT_EXISTS', 'Fixed output is retained.'); }; await expect(f.execution.withAgeSlot((execution) => execution.runFixed(invocation('age-recipient')))).rejects.toMatchObject({ code: kind === 'output' ? 'CONTROLLED_RECOVERY_D3_TOOL_OUTPUT_EXISTS' : 'CONTROLLED_RECOVERY_D3_CONTAINER_NAME_COLLISION' }); expect((await readFile(path)).equals(bytes)).toBe(true); expect((await lstat(path)).ino).toBe(inode); expect(f.calls.some(({ argv }) => argv.includes('run') || argv.includes('rm'))).toBe(false); } finally { await f.cleanup(); } });
});

describe('D3 concrete fixed direct Docker execution (fake processes only)', () => {
  it('latches a caught invalid request and rejects a later valid request without CID/plaintext effects', async () => { const f = await protectedFixture(); try { let first: unknown; const result = await f.execution.withAgeSlot(async (execution) => { first = await execution.runFixed(invocation('age-keygen')).catch((cause: unknown) => cause); const later = await execution.runFixed(invocation('age-recipient')).catch((cause: unknown) => cause); expect(later).toBe(first); }).catch((cause: unknown) => cause); expect(result).toBe(first); expect(result).toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_EXECUTION_INPUT_INVALID' }); expect(f.calls.some(({ argv }) => argv.includes('run') || argv.includes('rm'))).toBe(false); expect(await readdir(`${f.root}/run/tool-slots`)).toEqual([]); await expect(lstat(`${f.root}/staging`)).rejects.toMatchObject({ code: 'ENOENT' }); } finally { await f.cleanup(); } });
  it('observes an ignored invalid rejection immediately and retains it through a caught later valid request', async () => { const f = await protectedFixture(); const unhandled: unknown[] = []; const observe = (cause: unknown) => { unhandled.push(cause); }; process.on('unhandledRejection', observe); try { let later: unknown; const result = await f.execution.withAgeSlot(async (execution) => { void execution.runFixed(invocation('age-keygen')); await new Promise<void>((resolve) => setImmediate(resolve)); later = await execution.runFixed(invocation('age-recipient')).catch((cause: unknown) => cause); }).catch((cause: unknown) => cause); await new Promise<void>((resolve) => setImmediate(resolve)); expect(unhandled).toEqual([]); expect(result).toBe(later); expect(result).toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_EXECUTION_INPUT_INVALID' }); expect(f.calls.some(({ argv }) => argv.includes('run') || argv.includes('rm'))).toBe(false); expect(await readdir(`${f.root}/run/tool-slots`)).toEqual([]); await expect(lstat(`${f.root}/staging`)).rejects.toMatchObject({ code: 'ENOENT' }); } finally { process.off('unhandledRejection', observe); await f.cleanup(); } });
  it('joins the existing in-flight invocation before rejecting a synchronously latched invalid request', async () => { const f = fixture('gated'); let first: unknown, invalidDone!: () => void; const invalid = new Promise<void>((resolve) => { invalidDone = resolve; }); let finished = false; const result = f.execution.withAgeSlot(async (execution) => { void execution.runFixed(invocation('age-recipient')); await f.ready; first = await execution.runFixed(invocation('age-keygen')).catch((cause: unknown) => cause); expect(await execution.runFixed(invocation('age-decrypt')).catch((cause: unknown) => cause)).toBe(first); invalidDone(); }).catch((cause: unknown) => cause).finally(() => { finished = true; }); try { await invalid; expect(finished).toBe(false); expect(f.release).not.toHaveBeenCalled(); expect(f.releaseCid).not.toHaveBeenCalled(); expect(f.calls.filter(({ argv }) => argv.slice(4, 6).join(' ') === 'container run')).toHaveLength(1); f.complete(); expect(await result).toBe(first); expect(f.releaseCid).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce(); } finally { f.complete(); await result; } });
  it.each(['validation', 'pre-dispatch'] as const)('preserves exact first %s failure identity/cause when the callback catches it and throws another error', async (phase) => { const f = fixture(); const origin = new Error('synthetic first cause'), first = new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_EXECUTION_INPUT_INVALID', 'Synthetic first failure.', { cause: origin }), later = new Error('synthetic later callback failure'); const input = invocation('age-recipient'); if (phase === 'validation') Object.defineProperty(input, 'executable', { get: () => { throw first; } }); else f.storage.prepareMounts = async () => { throw first; }; const result = await f.execution.withAgeSlot(async (execution) => { expect(await execution.runFixed(input).catch((cause: unknown) => cause)).toBe(first); expect(await execution.runFixed(invocation('age-decrypt')).catch((cause: unknown) => cause)).toBe(first); throw later; }).catch((cause: unknown) => cause); expect(result).toBe(first); expect((result as Error).cause).toBe(origin); expect(f.calls.some(({ argv }) => argv.includes('run') || argv.includes('rm'))).toBe(false); expect(f.releaseCid).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledOnce(); });
  it('holds the shared age slot across publication, each joined invocation, readback and cleanup; escaped capabilities expire', async () => { const f = fixture(); const events: string[] = []; let escaped!: D3ContainerToolExecution;
    await f.execution.withAgeSlot(async (execution) => { escaped = execution; expect(f.storage.acquire).toHaveBeenCalledOnce(); events.push('PLAINTEXT'); await execution.runFixed(invocation('age-recipient')); events.push('READBACK'); await execution.runFixed(invocation('age-decrypt')); events.push('PUBLICATION', 'CLEANUP'); expect(f.release).not.toHaveBeenCalled(); expect(f.releaseCid).toHaveBeenCalledTimes(2); });
    expect(events).toEqual(['PLAINTEXT', 'READBACK', 'PUBLICATION', 'CLEANUP']); expect(f.release).toHaveBeenCalledOnce(); const count = f.calls.length; await expect(escaped.runFixed(invocation('age-recipient'))).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_EXECUTION_INPUT_INVALID' }); expect(f.calls).toHaveLength(count);
  });
  it('serializes ordinary age calls behind the whole staging transaction', async () => { const f = fixture(); let enter!: () => void; const entered = new Promise<void>((resolve) => { enter = resolve; }); let unblock!: () => void; const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const transaction = f.execution.withAgeSlot(async (execution) => { await execution.runFixed(invocation('age-recipient')); enter(); await blocked; }); await entered; const ordinary = f.execution.runFixed(invocation()); await Promise.resolve(); expect(f.storage.acquire).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); unblock(); await Promise.all([transaction, ordinary]); expect(f.storage.acquire).toHaveBeenCalledTimes(2); expect(f.release).toHaveBeenCalledTimes(2);
  });
  it('joins an unawaited inner invocation before releasing the outer age lease', async () => { const f = fixture('slow'); await f.execution.withAgeSlot(async (execution) => { void execution.runFixed(invocation('age-recipient')); }); expect(f.peak()).toBe(1); expect(f.releaseCid).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce(); });
  it('observes an ignored inner rejection immediately and still rejects only after its exact settlement', async () => { const f = fixture('timeout'); await expect(f.execution.withAgeSlot(async (execution) => { void execution.runFixed({ ...invocation('age-recipient'), timeoutMs: 5 }); await new Promise((resolve) => setTimeout(resolve, 40)); })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_TOOL_TIMEOUT' }); expect(f.releaseCid).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce(); expect(f.calls.some(({ argv }) => argv.includes('rm'))).toBe(true); });
  it('does not dispatch a queued age effect after an ignored prior rejection or turn it into success', async () => { const f = fixture('timeout'); await expect(f.execution.withAgeSlot(async (execution) => { void execution.runFixed({ ...invocation('age-recipient'), timeoutMs: 5 }); await execution.runFixed(invocation('age-decrypt')).catch(() => undefined); })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_TOOL_TIMEOUT' }); expect(f.calls.filter(({ argv }) => argv.slice(4, 6).join(' ') === 'container run')).toHaveLength(1); expect(f.releaseCid).toHaveBeenCalledOnce(); });
  it('retains the outer age lease after uncertain CLI/container settlement and refuses further inner work', async () => { const f = fixture('unjoined'); await expect(f.execution.withAgeSlot(async (execution) => { await expect(execution.runFixed({ ...invocation('age-recipient'), timeoutMs: 5 })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_CLI_SETTLEMENT_UNCERTAIN' }); await expect(execution.runFixed(invocation('age-decrypt'))).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_AGE_SLOT_SETTLEMENT_UNCERTAIN' }); })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_CLI_SETTLEMENT_UNCERTAIN' }); expect(f.release).not.toHaveBeenCalled(); expect(f.releaseCid).not.toHaveBeenCalled(); });
  it('refuses an unavailable lease storage, forbidden nested component and pre-aborted transaction', async () => { const f = fixture(); await expect(f.execution.withAgeSlot(async (execution) => execution.runFixed(invocation('age-keygen')))).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_EXECUTION_INPUT_INVALID' }); expect(f.release).toHaveBeenCalledOnce(); const abort = new AbortController(); abort.abort(); const count = f.calls.length; await expect(f.execution.withAgeSlot(async () => undefined, abort.signal)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED' }); expect(f.calls).toHaveLength(count); delete f.storage.releaseCid; await expect(f.execution.withAgeSlot(async () => undefined)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SHARED_AGE_SLOT_UNAVAILABLE' }); });
  it('uses no shell/stdin/ambient credentials, pins the enrolled image, settles exact container and joins CLI', async () => {
    const f = fixture(); await expect(f.execution.runFixed(invocation())).resolves.toMatchObject({ exitCode: 0 });
    expect(f.release).toHaveBeenCalledOnce(); const run = f.calls.find(({ argv }) => argv.includes('run'))!;
    expect(run).toMatchObject({ executable: '/usr/bin/docker', options: { shell: false, stdio: ['ignore', 'pipe', 'pipe'], cwd: testD3Operation.root, env: D3_TOOL_ENV } });
    expect(run.argv).toContain(`${process.getuid!()}:${process.getgid!()}`); expect(run.argv).toContain('--cidfile');
    expect(f.calls.some(({ argv }) => argv.includes('rm') && argv.includes('--volumes') && argv.includes(digest('container')))).toBe(true);
    expect(f.calls.some(({ argv }) => argv.includes('volume') && argv.includes('rm'))).toBe(false);
  });
  it('rejects arbitrary executable, argv, environment, output bounds and ownership before spawning', async () => {
    const f = fixture(); for (const delta of [{ executable: '/bin/sh' }, { argv: [...invocation().argv, '--privileged'] }, { env: { ...D3_TOOL_ENV, HOME: '/home/hexmon' } }, { maximumOutputBytes: 0 }, { owned: { ...invocation().owned, containerName: 'foreign' } }]) {
      await expect(f.execution.runFixed({ ...invocation(), ...delta } as Input)).rejects.toThrow();
    } expect(f.calls).toHaveLength(0);
  });
  it('refuses foreign same-name containers without deleting or launching anything', async () => {
    const f = fixture('foreign'); await expect(f.execution.runFixed(invocation())).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_CONTAINER_NAME_COLLISION' });
    expect(f.calls.some(({ argv }) => argv.includes('run') || argv.includes('rm'))).toBe(false);
  });
  it('revalidates image enrollment before launch', async () => { const f = fixture('wrong-image'); await expect(f.execution.runFixed(invocation())).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_EXECUTION_ENROLLMENT_CHANGED' }); expect(f.calls.some(({ argv }) => argv.includes('run'))).toBe(false); });
  it('settles a nonzero command before returning the nonzero result without exposing stderr in an error', async () => {
    const f = fixture('nonzero'); await expect(f.execution.runFixed(invocation())).resolves.toMatchObject({ exitCode: 23 }); expect(f.release).toHaveBeenCalledOnce();
  });
  it('handles spawn failure without pretending a container was created', async () => { const f = fixture('spawn'); const error = await f.execution.runFixed(invocation()).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_TOOL_SPAWN_FAILED' }); expect(JSON.stringify(error)).not.toContain('private credentials'); expect(f.release).toHaveBeenCalledOnce(); });
  it.each(['overflow', 'timeout'] as const)('kills and joins the CLI and exact container after %s', async (fault) => {
    const f = fixture(fault); await expect(f.execution.runFixed({ ...invocation(), timeoutMs: 5 })).rejects.toMatchObject({ code: fault === 'overflow' ? 'CONTROLLED_RECOVERY_D3_TOOL_OUTPUT_LIMIT' : 'CONTROLLED_RECOVERY_D3_TOOL_TIMEOUT' });
    expect(f.kills).toContain('SIGTERM'); expect(f.release).toHaveBeenCalledOnce(); expect(f.calls.some(({ argv }) => argv.includes('rm'))).toBe(true);
  });
  it('does no work for pre-abort and settles both processes for an in-flight abort', async () => {
    const before = fixture(); const controller = new AbortController(); controller.abort(); await expect(before.execution.runFixed(invocation('age-version', controller.signal))).rejects.toThrow(); expect(before.calls).toHaveLength(0);
    const f = fixture('timeout'); const active = new AbortController(); const pending = f.execution.runFixed(invocation('age-version', active.signal)); await f.ready; active.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED' }); expect(f.release).toHaveBeenCalledOnce(); expect(f.kills).toContain('SIGTERM');
  });
  it.each(['cleanup', 'wrong-labels', 'no-cid'] as const)('retains the staging lock and fails closed for cleanup uncertainty: %s', async (fault) => {
    const f = fixture(fault); await expect(f.execution.runFixed(invocation())).rejects.toMatchObject({ code: fault === 'wrong-labels' ? 'CONTROLLED_RECOVERY_D3_CONTAINER_OWNERSHIP_UNPROVEN' : 'CONTROLLED_RECOVERY_D3_CONTAINER_SETTLEMENT_UNCERTAIN' });
    expect(f.release).not.toHaveBeenCalled(); if (fault === 'wrong-labels') expect(f.calls.some(({ argv }) => argv.includes('rm'))).toBe(false);
  });
  it('serializes shared staging slots across components', async () => {
    const f = fixture('slow'); await Promise.all([f.execution.runFixed(invocation()), f.execution.runFixed(invocation('age-recipient'))]); expect(f.peak()).toBe(1); expect(f.release).toHaveBeenCalledTimes(2);
  });
  it('retains the lock if the CLI never joins even after exact container cleanup', async () => {
    const f = fixture('unjoined'); await expect(f.execution.runFixed({ ...invocation(), timeoutMs: 5 })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_CLI_SETTLEMENT_UNCERTAIN' });
    expect(f.kills).toContain('SIGKILL'); expect(f.release).not.toHaveBeenCalled();
  });
});
