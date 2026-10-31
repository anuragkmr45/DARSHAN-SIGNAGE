import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { chmod, cp, link, lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { testD3Operation } from './controlled-recovery-d3.test-support';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { ProtectedD3SourceLayout } from './controlled-recovery-d3-source-layout';
import { EnrolledD3SourceCrypto, fixedD3CryptoArgv } from './controlled-recovery-d3-source-crypto';
import { BoundedD3SourceProcess, D3_SOURCE_PROCESS_ENV } from './controlled-recovery-d3-source-process';
import { EnrolledD3SourceExecutor } from './controlled-recovery-d3-source-executor';
import { DurableD3SourceState, D3_SOURCE_RESOURCE_NAMES, type D3SourceResource } from './controlled-recovery-d3-source-state';
import { D3_VOLUME_FILES, fixedD3VolumePlan, ProtectedD3SourceVolumes, type D3VolumeExecution, type D3VolumeOperation } from './controlled-recovery-d3-source-volumes';
import { D3ValkeyProbeParser, ProtectedD3SourceHealth, type D3HealthRequest, type D3HealthResult, type D3HealthTransport } from './controlled-recovery-d3-source-health';
import { sourceD2, sourceProfile } from './controlled-recovery-d3-source.test-support';
import { sourceRaw } from './controlled-recovery-d3-source.test-support';
import { d3SourceConfigurations } from './controlled-recovery-d3-source-services';
import { fixedD3SourceDockerPlan, sourceObservation } from './controlled-recovery-d3-docker';
import { D3_MINIO_FILE_CREDENTIALS, D3_OPENSSL } from './controlled-recovery-d3-source-enrollment';

let template: string; const directories: string[] = [];
beforeAll(async () => { template = await mkdtemp(join(tmpdir(), 'd3-runtime-template-')); await new ProtectedD3SourceLayout({ ...testD3Operation, root: template } as D3OperationAuthority, async () => false).prepare(); });
afterAll(async () => { await rm(template, { recursive: true, force: true }); });
afterEach(async () => { vi.useRealTimers(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'd3-runtime-test-')); directories.push(directory); await cp(`${template}/source`, `${directory}/source`, { recursive: true });
  const authority = { ...testD3Operation, root: directory } as D3OperationAuthority; const layout = new ProtectedD3SourceLayout(authority, async () => false); const receipt = await layout.verify(); const state = new DurableD3SourceState(authority, digest(sourceProfile));
  return { directory, authority, layout, receipt, state };
}

describe('D3 retained crypto and layout rejection boundaries', () => {
  it.each(['symlink', 'hardlink', 'group-readable mode', 'wrong service key', 'wrong SAN certificate', 'foreign file', 'wrong config', 'expired'])('refuses %s without regenerating retained secrets', async (kind) => {
    const f = await fixture(); const ca = await readFile(`${f.directory}/source/tls/ca/ca.key`); const path = `${f.directory}/source/tls/postgres/server.key`;
    if (kind === 'symlink') { await unlink(path); await symlink('../valkey/server.key', path); }
    else if (kind === 'hardlink') await link(path, `${f.directory}/source/tls/postgres/key-link`);
    else if (kind === 'group-readable mode') await chmod(path, 0o640);
    else if (kind === 'wrong service key') await writeFile(path, await readFile(`${f.directory}/source/tls/valkey/server.key`));
    else if (kind === 'wrong SAN certificate') await writeFile(`${f.directory}/source/tls/postgres/server.crt`, await readFile(`${f.directory}/source/tls/valkey/server.crt`));
    else if (kind === 'foreign file') await writeFile(`${f.directory}/source/secrets/unexpected`, 'unexpected', { mode: 0o600 });
    else if (kind === 'wrong config') await writeFile(`${f.directory}/source/config/pg_hba.conf`, 'trust\n');
    const layout = kind === 'expired' ? new ProtectedD3SourceLayout(f.authority, async () => false, undefined, () => Date.now() + 8 * 86400000) : f.layout;
    await expect(layout.prepare()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_INVALID' }); expect(await readFile(`${f.directory}/source/tls/ca/ca.key`)).toEqual(ca);
  });
  it('admits only fixed algorithms, files and public output and never propagates crypto stderr', async () => {
    expect(fixedD3CryptoArgv(testD3Operation, 'ec-key', 'postgres')).toEqual(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', `${testD3Operation.root}/source/tls/postgres/pending.key`]);
    expect(() => fixedD3CryptoArgv(testD3Operation, 'ca-cert', 'minio')).toThrow();
    const process = { run: vi.fn(async () => ({ exitCode: 19, stdout: Buffer.alloc(0), stderr: Buffer.from('PRIVATE KEY password secret-marker') })) };
    await expect(new EnrolledD3SourceCrypto(testD3Operation, process as unknown as BoundedD3SourceProcess).run('version', 'ca')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_CRYPTO_FAILED', message: expect.not.stringContaining('secret-marker') });
  });
  it('honors cancellation before layout effects and recovers a validated pending key without regeneration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'd3-layout-cancel-')); directories.push(directory); const authority = { ...testD3Operation, root: directory } as D3OperationAuthority; const abort = new AbortController(); abort.abort();
    await expect(new ProtectedD3SourceLayout(authority, async () => false).prepare(abort.signal)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_INVALID' }); await expect(readFile(`${directory}/source/layout-receipt.json`)).rejects.toMatchObject({ code: 'ENOENT' });
    const during = new AbortController(); const crypto = new EnrolledD3SourceCrypto(authority); const interrupted = new ProtectedD3SourceLayout(authority, async () => false, { run: async (...args) => { const result = await crypto.run(...args); if (args[0] === 'ec-key') during.abort(); return result; } });
    await expect(interrupted.prepare(during.signal)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_INVALID' }); const pending = await readFile(`${directory}/source/tls/ca/pending.key`); await expect(readFile(`${directory}/source/tls/ca/ca.key`)).rejects.toMatchObject({ code: 'ENOENT' });
    await new ProtectedD3SourceLayout(authority, async () => false).prepare(); expect(await readFile(`${directory}/source/tls/ca/ca.key`)).toEqual(pending);
  });
  it('preserves unjoined process uncertainty through crypto/layout and durably prevents retry mutation', async () => {
    vi.useFakeTimers(); const directory = await mkdtemp(join(tmpdir(), 'd3-unjoined-layout-')); directories.push(directory); const authority = { ...testD3Operation, root: directory } as D3OperationAuthority;
    let started!: () => void; const starting = new Promise<void>((resolve) => { started = resolve; }); const children: ReturnType<typeof child>[] = [];
    const process = new BoundedD3SourceProcess((_executable, argv) => { const value = child(); children.push(value); if (argv[0] === 'version') void Promise.resolve().then(() => { value.stdout.write(`${D3_OPENSSL.version}\n`); value.emit('close', 0); }); else started(); return value; });
    const layout = new ProtectedD3SourceLayout(authority, async () => false, new EnrolledD3SourceCrypto(authority, process)); const result = layout.prepare(); const assertion = expect(result).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN' });
    await starting; const path = `${directory}/source/tls/ca/pending.key`; await writeFile(path, 'private-marker-original-process', { mode: 0o600 }); await vi.advanceTimersByTimeAsync(17250); await assertion;
    expect(children.at(-1)!.kill).toHaveBeenCalledWith('SIGKILL'); const marker = await readFile(`${directory}/source/layout.lock/uncertainty.json`, 'utf8'); expect(marker).toContain('PROCESS_SETTLEMENT_UNCERTAIN'); expect(marker).not.toContain('private-marker'); expect((await lstat(`${directory}/source/layout.lock`)).mode & 0o777).toBe(0o700);
    await expect(layout.prepare()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN' }); await expect(layout.verify()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN' }); expect(children).toHaveLength(2); expect(await readFile(path, 'utf8')).toBe('private-marker-original-process');
  });
  it('recovers exclusive-link commit windows for every retained layout publication before reading or tree inspection', async () => {
    const f = await fixture(); const record = JSON.parse(await readFile(`${f.directory}/source/layout-receipt.json`, 'utf8')) as { inventory: Array<{ path: string }> }; const paths = [...record.inventory.map(({ path }) => path), 'layout-receipt.json'];
    for (const path of paths) await link(`${f.directory}/source/${path}`, `${f.directory}/source/${path}.11111111-1111-4111-8111-111111111111.tmp`);
    expect(await f.layout.prepare()).toEqual(f.receipt); for (const path of paths) { expect((await lstat(`${f.directory}/source/${path}`)).nlink).toBe(1); await expect(lstat(`${f.directory}/source/${path}.11111111-1111-4111-8111-111111111111.tmp`)).rejects.toMatchObject({ code: 'ENOENT' }); }
  });
  it('keeps read-only layout/state views non-mutating even across publication-link commit windows', async () => { const f = await fixture(); const key = `${f.directory}/source/tls/ca/ca.key`; const alias = `${key}.11111111-1111-4111-8111-111111111111.tmp`; await link(key, alias); await expect(f.layout.readOnlyView().verify()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_INVALID' }); expect((await lstat(key)).nlink).toBe(2); expect((await lstat(alias)).isFile()).toBe(true); await expect(lstat(`${f.directory}/source/layout.lock`)).rejects.toMatchObject({ code: 'ENOENT' }); await f.layout.verify();
    await f.state.appendStage('LAYOUT_READY', digest(f.receipt), []); const stage = `${f.directory}/source/state/stages/00-LAYOUT_READY.json`; await link(stage, `${stage}.11111111-1111-4111-8111-111111111111.tmp`); await expect(f.state.readOnlyView().stages()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_STATE_INVALID' }); expect((await lstat(stage)).nlink).toBe(2); await expect(f.state.readOnlyView().withCommandLock('prepare', async () => undefined)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_READ_ONLY' }); expect((await f.state.stages())[0]!.stage).toBe('LAYOUT_READY');
  });
  it.each((['key', 'cert'] as const).flatMap((type) => [true, false].map((receipt) => ({ type, receipt }))))('removes exact matching pending $type with receipt=$receipt without generation', async ({ type, receipt }) => {
    const f = await fixture(); const retained = `${f.directory}/source/tls/postgres/server.${type === 'key' ? 'key' : 'crt'}`; const pending = `${f.directory}/source/tls/postgres/pending.${type === 'key' ? 'key' : 'crt'}`; const bytes = await readFile(retained); await writeFile(pending, bytes, { mode: 0o600 });
    if (!receipt) await unlink(`${f.directory}/source/layout-receipt.json`); await link(retained, `${retained}.11111111-1111-4111-8111-111111111111.tmp`); const crypto = new EnrolledD3SourceCrypto(f.authority); const run = vi.spyOn(crypto, 'run'); expect(await new ProtectedD3SourceLayout(f.authority, async () => receipt, crypto).prepare()).toEqual(f.receipt); expect(await readFile(retained)).toEqual(bytes); await expect(readFile(pending)).rejects.toMatchObject({ code: 'ENOENT' }); expect(run.mock.calls.every(([operation]) => ['version', 'certificate-text'].includes(operation))).toBe(true);
  });
  it.each([false, true])('verifies pending CSR signature/public identity before removal, foreign=%s', async (foreign) => {
    const f = await fixture(); const crypto = new EnrolledD3SourceCrypto(f.authority); await crypto.run('csr', foreign ? 'valkey' : 'postgres'); const path = `${f.directory}/source/tls/postgres/pending.csr`; if (foreign) await writeFile(path, await readFile(`${f.directory}/source/tls/valkey/pending.csr`), { mode: 0o600 }); const bytes = await readFile(path);
    if (foreign) { await expect(f.layout.prepare()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_INVALID' }); expect(await readFile(path)).toEqual(bytes); }
    else { expect(await f.layout.prepare()).toEqual(f.receipt); await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' }); }
  });
  it.each(['key', 'cert'] as const)('retains conflicting pending %s without regeneration or deletion', async (type) => {
    const f = await fixture(); const extension = type === 'key' ? 'key' : 'crt'; const path = `${f.directory}/source/tls/postgres/pending.${extension}`; const foreign = await readFile(`${f.directory}/source/tls/valkey/server.${extension}`); await writeFile(path, foreign, { mode: 0o600 });
    await expect(f.layout.prepare()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_INVALID' }); expect(await readFile(path)).toEqual(foreign);
  });
});

function child() { const value = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) }); return value as typeof value & ChildProcess; }
const processInput = { executable: '/usr/bin/docker' as const, argv: ['container', 'ls'], cwd: '/tmp', timeoutMs: 1000, maximumOutputBytes: 64 };
describe('D3 direct bounded source process', () => {
  it('uses direct spawn, closed stdin and a clean fixed environment; nonzero is returned for caller rejection', async () => {
    const value = child(); const spawn = vi.fn(() => value); const result = new BoundedD3SourceProcess(spawn).run(processInput); value.stdout.write('public'); value.emit('close', 17);
    expect(await result).toMatchObject({ exitCode: 17, stdout: Buffer.from('public') }); expect(spawn).toHaveBeenCalledWith('/usr/bin/docker', ['container', 'ls'], expect.objectContaining({ shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: D3_SOURCE_PROCESS_ENV }));
    expect(D3_SOURCE_PROCESS_ENV).not.toHaveProperty('DOCKER_HOST'); expect(D3_SOURCE_PROCESS_ENV).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
  });
  it.each(['timeout', 'abort', 'overflow', 'spawn-error'])('settles CLI on %s without exposing stderr', async (reason) => {
    vi.useFakeTimers(); const value = child(); const abort = new AbortController(); const result = new BoundedD3SourceProcess(() => value).run({ ...processInput, signal: abort.signal }); const assertion = expect(result).rejects.toMatchObject({ code: `CONTROLLED_RECOVERY_D3_SOURCE_${{ timeout: 'PROCESS_TIMEOUT', abort: 'CANCELLED', overflow: 'PROCESS_OUTPUT_LIMIT', 'spawn-error': 'PROCESS_SPAWN_FAILED' }[reason]}`, message: expect.not.stringContaining('private-marker') });
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(1000); else if (reason === 'abort') abort.abort(); else if (reason === 'overflow') value.stderr.write('private-marker'.repeat(10)); else value.emit('error', new Error('private-marker'));
    expect(value.kill).toHaveBeenCalledWith('SIGTERM'); await vi.advanceTimersByTimeAsync(250); expect(value.kill).toHaveBeenCalledWith('SIGKILL'); value.emit('close', null); await assertion;
  });
  it('retains uncertainty when the CLI cannot be joined, and rejects invalid bounds before spawn', async () => {
    vi.useFakeTimers(); const value = child(); const spawn = vi.fn(() => value); const result = new BoundedD3SourceProcess(spawn).run(processInput); const assertion = expect(result).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN' }); await vi.advanceTimersByTimeAsync(3250); await assertion;
    await expect(new BoundedD3SourceProcess(spawn).run({ ...processInput, timeoutMs: NaN })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_INPUT_INVALID' }); expect(spawn).toHaveBeenCalledTimes(1);
  });
});

async function volumeFixture() {
  const f = await fixture(); for (const role of ['postgres-volume', 'minio-volume', 'valkey-volume'] as const) { const resource: D3SourceResource = { role, kind: 'volume', name: D3_SOURCE_RESOURCE_NAMES[role], id: digest(role), configurationSha256: digest(`config-${role}`), identitySha256: digest(`identity-${role}`), retired: false }; await f.state.reserveResource(role, resource.configurationSha256); await f.state.recordCreated(resource); }
  const resources = (await f.state.resources()).resources; const calls: D3VolumeOperation[] = []; let tamper: 'owner' | 'mode' | 'hash' | undefined; let after: (() => void) | undefined;
  const executor: D3VolumeExecution = { executeVolume: async (operation) => { calls.push(operation); const resource = resources.find(({ role }) => role === `${operation.role}-volume`)!; const plan = fixedD3VolumePlan(f.authority, sourceProfile, operation, f.receipt.evidenceSha256, resource); let text = '';
    if (operation.action === 'stat-directory') text = `directory|${plan.uid}|${plan.gid}|700|2|4096\n`;
    if (operation.action === 'stat-file' || operation.action === 'hash') { const bytes = await readFile(`${f.directory}/source/${D3_VOLUME_FILES[operation.role][operation.index]![0]}`); text = operation.action === 'hash' ? `${tamper === 'hash' ? digest('wrong') : sha256(bytes)}  ${plan.destination}\n` : `regular file|${tamper === 'owner' ? 0 : plan.uid}|${plan.gid}|${tamper === 'mode' ? '644' : '600'}|1|${bytes.length}\n`; } after?.(); return { stdout: Buffer.from(text) }; } };
  return { ...f, resources, calls, executor, tamper: (value: typeof tamper) => { tamper = value; }, after: (callback: () => void) => { after = callback; }, volumes: new ProtectedD3SourceVolumes(f.authority, sourceProfile, f.state, f.layout, executor) };
}
describe('D3 protected exact volume materialization (fake container operations)', () => {
  it('plans only fixed network-free direct helper argv with numeric protected modes and read-only inspection', async () => {
    const f = await volumeFixture(); for (const role of ['postgres', 'minio', 'valkey'] as const) for (const action of ['directory', 'install', 'stat-file', 'hash', 'sync'] as const) { const plan = fixedD3VolumePlan(f.authority, sourceProfile, { role, action, index: 0 }, f.receipt.evidenceSha256, f.resources.find((resource) => resource.role === `${role}-volume`)!);
      expect(plan.argv).toEqual(expect.arrayContaining(['--network', 'none', '--pull=never', '--read-only', '--cidfile', '--cap-drop', 'ALL', '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=1m,mode=0700'])); expect(plan.argv).not.toContain('/bin/sh'); expect(plan.argv.join(' ')).not.toMatch(/chmod|mode=0?7[57]7|docker\.sock|--publish|--privileged|compose|prune/);
      if (action === 'install') expect(plan.argv.slice(-8)).toEqual(['-m', '0600', '-o', String(plan.uid), '-g', String(plan.gid), '/input', plan.destination]);
      if (['stat-file', 'hash'].includes(action)) expect(plan.argv).toContain(`type=volume,src=${f.resources.find((resource) => resource.role === `${role}-volume`)!.name},dst=/volume,readonly`);
    }
    expect(fixedD3VolumePlan(f.authority, sourceProfile, { role: 'postgres', action: 'install', index: 0 }, f.receipt.evidenceSha256, f.resources[0]!).uid).toBe(70);
  });
  it('publishes only after all owners/modes/hashes verify, and a retry only re-inspects', async () => {
    const f = await volumeFixture(); const input = { profile: sourceProfile, resources: f.resources, layout: f.receipt }; expect(await f.volumes.prepare(input)).toMatchObject({ postgresOwner: '70:70', directoryMode: '0700', fileMode: '0600' }); f.calls.length = 0; await f.volumes.prepare(input); expect(f.calls.every(({ action }) => action.startsWith('stat-') || action === 'hash')).toBe(true);
    expect(await readFile(`${f.directory}/source/state/volume-materialization.json`, 'utf8')).not.toContain('PRIVATE KEY');
  });
  it('recovers the volume-receipt hardlink commit window and still re-verifies live volume hashes', async () => {
    const f = await volumeFixture(); const input = { profile: sourceProfile, resources: f.resources, layout: f.receipt }; await f.volumes.prepare(input); const path = `${f.directory}/source/state/volume-materialization.json`; const bytes = await readFile(path); const alias = `${path}.11111111-1111-4111-8111-111111111111.tmp`; await link(path, alias); f.calls.length = 0; await f.volumes.prepare(input);
    expect(await readFile(path)).toEqual(bytes); expect((await lstat(path)).nlink).toBe(1); await expect(lstat(alias)).rejects.toMatchObject({ code: 'ENOENT' }); expect(f.calls.every(({ action }) => action.startsWith('stat-') || action === 'hash')).toBe(true); f.tamper('hash'); await expect(f.volumes.prepare(input)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_VOLUME_INVALID' }); expect(await readFile(path)).toEqual(bytes);
  });
  it.each(['owner', 'mode', 'hash'] as const)('refuses incorrect %s and publishes no success receipt', async (kind) => { const f = await volumeFixture(); f.tamper(kind); await expect(f.volumes.prepare({ profile: sourceProfile, resources: f.resources, layout: f.receipt })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_VOLUME_INVALID' }); await expect(readFile(`${f.directory}/source/state/volume-materialization.json`)).rejects.toMatchObject({ code: 'ENOENT' }); });
  it('checks cancellation after an exact operation and rejects changed resource authority', async () => { const f = await volumeFixture(); const abort = new AbortController(); f.after(() => abort.abort()); await expect(f.volumes.prepare({ profile: sourceProfile, resources: f.resources, layout: f.receipt, signal: abort.signal })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_VOLUME_INVALID' }); expect(f.calls).toHaveLength(1); await expect(f.volumes.prepare({ profile: sourceProfile, resources: [], layout: f.receipt })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_VOLUME_INVALID' }); });
});

describe('D3 source executor admission', () => {
  it('rejects arbitrary argv/environment/unowned IDs and nonzero read-only calls', async () => {
    const f = await fixture(); const process = { run: vi.fn(async () => ({ exitCode: 13, stdout: Buffer.alloc(0), stderr: Buffer.from('private-marker') })) }; const executor = new EnrolledD3SourceExecutor(f.authority, sourceD2, sourceProfile, f.state, f.layout, process as unknown as BoundedD3SourceProcess, async () => undefined);
    const input = { executable: '/usr/bin/docker' as const, argv: ['--config', '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config', '--context', 'default', 'container', 'ls', '--all', '--no-trunc', '--format', '{{json .}}'], env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' }, timeoutMs: 1000, maximumOutputBytes: 1000 };
    for (const request of [{ ...input, argv: [...input.argv.slice(0, 4), 'container', 'exec', digest('foreign'), '/bin/sh'] }, { ...input, env: { ...input.env, AWS_SECRET_ACCESS_KEY: 'private-marker' } }, { ...input, timeoutMs: NaN }]) await expect(executor.executeFixed(request)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_EXECUTION_REJECTED' }); expect(process.run).not.toHaveBeenCalled();
    await expect(executor.executeFixed(input)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_NONZERO', message: expect.not.stringContaining('private-marker') });
    await f.state.withCommandLock('prepare', async () => { await expect(executor.executeFixed({ ...input, argv: [...input.argv.slice(0, 4), 'network', 'create', 'arbitrary'] })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_EXECUTION_REJECTED' }); }); expect(process.run).toHaveBeenCalledTimes(1);
  });
  it('binds MinIO capability only to the full enrolled image and immutable public evidence, without source activation', async () => { expect(sourceD2.images.find(({ role }) => role === 'minio')!.image_id).toBe(D3_MINIO_FILE_CREDENTIALS.imageId); expect(sha256(await readFile(D3_MINIO_FILE_CREDENTIALS.evidencePath))).toBe(D3_MINIO_FILE_CREDENTIALS.evidenceSha256); expect(sourceD2.enabled).toBe(false); expect(sourceProfile.enabled).toBe(false); });
  it('retains the durable command lock after uncertain settlement', async () => { const f = await fixture(); await expect(f.state.withCommandLock('prepare', async () => { await f.state.retainUncertainCommand(digest('unjoined')); await f.state.retainUncertainCommand(digest('second')); })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_LOCK_UNCERTAIN' }); expect(await f.state.commandInProgress()).toBe(true); await expect(f.state.assertCurrentCommand()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_REQUIRED' }); });
  it.each(['success', 'nonzero', 'abort', 'collision', 'cleanup-uncertain', 'cleanup-malformed'])('settles only the exact helper container for %s', async (mode) => {
    const f = await fixture(); const configs = d3SourceConfigurations(sourceD2, sourceProfile, f.receipt, f.state.profileSha256); const raw = new Map<string, ReturnType<typeof sourceRaw>>();
    for (const role of ['network', 'postgres-volume', 'minio-volume', 'valkey-volume'] as const) { const plan = fixedD3SourceDockerPlan(sourceD2, sourceProfile, role, configs[role]); const value = sourceRaw(plan); const resource = sourceObservation(value, plan, sourceProfile).resource; raw.set(plan.name, value); await f.state.reserveResource(role, resource.configurationSha256); await f.state.recordCreated(resource); }
    const resource = (await f.state.resources()).resources.find(({ role }) => role === 'postgres-volume')!; const operation = { role: 'postgres', action: 'directory', index: 0 } as const; const plan = fixedD3VolumePlan(f.authority, sourceProfile, operation, f.receipt.evidenceSha256, resource); const id = digest('helper'); const calls: string[][] = []; const abort = new AbortController();
    let removed = false; const process = { run: async (input: Parameters<BoundedD3SourceProcess['run']>[0]) => { const args = input.argv.slice(4); calls.push([...args]); const result = (value: unknown, exitCode = 0) => ({ exitCode, stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), stderr: Buffer.from('private-helper-marker') });
      if (args[1] === 'run') { if (mode === 'collision') return result('', 125); await writeFile(plan.cidfile, `${id}\n`, { mode: 0o600 }); if (mode === 'abort') abort.abort(); return result('', mode === 'nonzero' ? 19 : 0); }
      if (args[1] === 'rm') { removed = true; return result('', mode === 'cleanup-uncertain' ? 19 : 0); }
      if (args[0] === 'container' && args[1] === 'inspect') return result([{ Id: id, Name: `/${plan.name}`, Image: plan.argv.at(plan.argv.indexOf('--entrypoint') + 2), Config: { Labels: plan.labels }, HostConfig: { NetworkMode: 'none' } }]);
      if (args[1] === 'inspect') return result(args.slice(2).map((name) => raw.get(name) ?? [...raw.values()].find((value) => value.Id === name)));
      if (args[0] === 'container') return result(removed && mode === 'cleanup-malformed' ? '{"ID":"invalid"}' : '');
      return result([...raw.values()].filter((value) => (args[0] === 'network') === Boolean(value.IPAM)).map((value) => JSON.stringify({ ID: value.Id, Name: value.Name })).join('\n'));
    } };
    const executor = new EnrolledD3SourceExecutor(f.authority, sourceD2, sourceProfile, f.state, f.layout, process as unknown as BoundedD3SourceProcess, async () => undefined);
    const execution = f.state.withCommandLock('prepare', () => executor.executeVolume(operation, abort.signal));
    if (mode === 'success') await expect(execution).resolves.toEqual({ stdout: Buffer.alloc(0) });
    else await expect(execution).rejects.toMatchObject({ code: mode === 'collision' || mode.startsWith('cleanup-') ? 'CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_LOCK_UNCERTAIN' : mode === 'abort' ? 'CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED' : 'CONTROLLED_RECOVERY_D3_SOURCE_VOLUME_OPERATION_FAILED', message: expect.not.stringContaining('private-helper-marker') });
    const removals = calls.filter((args) => args[1] === 'rm'); expect(removals).toEqual(mode === 'collision' ? [] : [['container', 'rm', '--force', '--volumes', id]]); expect(calls.some((args) => args[0] === 'volume' && args[1] === 'rm')).toBe(false); expect(await f.state.commandInProgress()).toBe(mode === 'collision' || mode.startsWith('cleanup-'));
  });
});

describe('D3 authenticated fixed health contracts (fake wire provider, no services)', () => {
  it.each(['postgres', 'minio', 'valkey'] as const)('requires certificate-bound %s success and both explicit negatives', async (role) => {
    const f = await fixture(); const calls: D3HealthRequest[] = []; const call = async (input: D3HealthRequest): Promise<D3HealthResult> => { calls.push(input); if (input.mode === 'plaintext') return { ok: false, certificateSha256: null, rejected: 'TLS_REQUIRED' }; if (input.mode === 'unauthenticated') return { ok: false, certificateSha256: input.expectedCertificateSha256, rejected: 'AUTH' }; return { ok: true, certificateSha256: input.expectedCertificateSha256, one: 1, database: 'darshan', user: 'darshan', version: 160013, ssl: true, status: 200, reply: 'PONG', aclUser: 'd3-source' }; };
    const transport: D3HealthTransport = { pg: call, s3: call, valkey: call }; const verify = vi.fn(async () => undefined); const provider = new ProtectedD3SourceHealth(f.authority, sourceProfile, f.layout, verify, transport); const method = role === 'postgres' ? provider.postgresTlsSelect.bind(provider) : role === 'minio' ? provider.minioTlsS3.bind(provider) : provider.valkeyTlsPing.bind(provider);
    const result = await method({ profile: sourceProfile, containerId: digest(role), timeoutMs: sourceProfile.health.probe_timeout_ms }); expect(result).toMatchObject({ authenticated: true, tlsVerified: true, plaintextRejected: true, unauthenticatedRejected: true }); expect(verify).toHaveBeenCalledWith(role, digest(role)); expect(calls.map(({ mode }) => mode)).toEqual(['authenticated', 'unauthenticated', 'plaintext']); expect(calls[0]).toMatchObject({ host: sourceProfile[role].ip, servername: `darshan-d2-20261030-${role}` }); expect(calls[0]!.password).not.toBe(''); expect(calls.slice(1).every((input) => input.password === '' && !input.secretKey)).toBe(true); expect(JSON.stringify(result)).not.toContain(calls[0]!.password);
  });
  it.each(['auth', 'plaintext', 'certificate', 'private-error'])('refuses %s ambiguity without leaking credentials', async (kind) => { const f = await fixture(); const call = async (input: D3HealthRequest): Promise<D3HealthResult> => { if (kind === 'private-error') throw new Error(`private-marker ${input.password}`); if (input.mode === 'plaintext') return { ok: false, certificateSha256: null, ...(kind !== 'plaintext' ? { rejected: 'TLS_REQUIRED' as const } : {}) }; if (input.mode === 'unauthenticated') return { ok: false, certificateSha256: input.expectedCertificateSha256, ...(kind !== 'auth' ? { rejected: 'AUTH' as const } : {}) }; return { ok: true, certificateSha256: kind === 'certificate' ? digest('foreign') : input.expectedCertificateSha256, reply: 'PONG', aclUser: 'd3-source' }; }; const provider = new ProtectedD3SourceHealth(f.authority, sourceProfile, f.layout, async () => undefined, { pg: call, s3: call, valkey: call }); await expect(provider.valkeyTlsPing({ profile: sourceProfile, containerId: digest('valkey'), timeoutMs: sourceProfile.health.probe_timeout_ms })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_HEALTH_UNVERIFIED', message: expect.not.stringContaining('private-marker') }); });
});

const valkeyTranscripts = [
  { mode: 'authenticated' as const, bytes: Buffer.from('+OK\r\n$9\r\nd3-source\r\n+PONG\r\n'), result: 'AUTHENTICATED' },
  { mode: 'unauthenticated' as const, bytes: Buffer.from('-NOAUTH Authentication required.\r\n'), result: 'AUTH_REJECTED' },
  { mode: 'plaintext' as const, bytes: Buffer.from([0x15, 3, 3, 0, 2, 2, 10]), result: 'TLS_REQUIRED' },
];
describe('D3 incremental bounded fixed Valkey response parser', () => {
  it.each(valkeyTranscripts.flatMap((entry) => Array.from({ length: entry.bytes.length - 1 }, (_, index) => ({ ...entry, split: index + 1 }))))('waits for complete $mode response at split $split', ({ mode, bytes, result, split }) => {
    const parser = new D3ValkeyProbeParser(mode); expect(parser.push(bytes.subarray(0, split))).toBe('INCOMPLETE'); expect(parser.push(bytes.subarray(split))).toBe(result);
  });
  it.each(valkeyTranscripts)('accepts $mode one byte at a time and rejects any subsequent frame', ({ mode, bytes, result }) => {
    const parser = new D3ValkeyProbeParser(mode); for (let index = 0; index < bytes.length; index++) expect(parser.push(bytes.subarray(index, index + 1))).toBe(index === bytes.length - 1 ? result : 'INCOMPLETE'); expect(() => parser.push(Buffer.from('+PONG\r\n'))).toThrow();
  });
  it.each([
    { mode: 'authenticated' as const, bytes: Buffer.from('+OK\r\n$9\r\nd3-source\r\n+PONG\r\n+OK\r\n') },
    { mode: 'unauthenticated' as const, bytes: Buffer.from('-NOAUTH Authentication required.\r\n+PONG\r\n') },
    { mode: 'unauthenticated' as const, bytes: Buffer.from('-NOAUTH bad\n') },
    { mode: 'unauthenticated' as const, bytes: Buffer.from('-NOAUTH\r\n') },
    { mode: 'unauthenticated' as const, bytes: Buffer.from('-NOPERM Authentication required.\r\n') },
    { mode: 'authenticated' as const, bytes: Buffer.from('+OK\r\n$09\r\nd3-source\r\n+PONG\r\n') },
    { mode: 'authenticated' as const, bytes: Buffer.from('+OK\r\n$9\r\nd3-source\n\n+PONG\r\n') },
    { mode: 'authenticated' as const, bytes: Buffer.concat([Buffer.from('+OK\r\n$9\r\n'), Buffer.from([0xe4]), Buffer.from('3-source\r\n+PONG\r\n')]) },
    { mode: 'authenticated' as const, bytes: Buffer.from(`+${'A'.repeat(513)}`) },
    { mode: 'authenticated' as const, bytes: Buffer.from('*3\r\n') },
    { mode: 'plaintext' as const, bytes: Buffer.from([0x15, 3, 3, 0, 3, 2, 10, 0]) },
    { mode: 'plaintext' as const, bytes: Buffer.from([0x15, 3, 3, 0, 2, 2, 10, 0]) },
    { mode: 'plaintext' as const, bytes: Buffer.from([0x15, 3, 3, 0, 2, 1, 10]) },
    { mode: 'plaintext' as const, bytes: Buffer.from('-NOAUTH Authentication required.\r\n') },
  ])('rejects malformed or multi-frame ambiguity in $mode', ({ mode, bytes }) => { expect(() => new D3ValkeyProbeParser(mode).push(bytes)).toThrow(); });
  it('enforces the aggregate output bound before allocating the incoming response', () => { expect(() => new D3ValkeyProbeParser('authenticated').push(Buffer.alloc(4097))).toThrow(); });
});
