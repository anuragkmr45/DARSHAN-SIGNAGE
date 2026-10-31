import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/backups/backup-broker-protocol';
import { loadRecoveryTargetRelayConfig, RecoveryTargetRelayError, recoveryTargetSshArgv,
  relayConfigSchema, runRecoveryTargetRelayOneShot, type RecoveryTargetRelayConfig, type RelaySpawn } from './recovery-target-relay-worker';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

function config(overrides: Partial<RecoveryTargetRelayConfig> = {}): RecoveryTargetRelayConfig {
  return relayConfigSchema.parse({ format: 'darshan-recovery-target-relay-v1', siteId: 'site-a',
    backendInstallationId: randomUUID(), dataHostInstallationId: randomUUID(), destination: '192.0.2.40', port: 22,
    user: 'darshan_recovery', hostKeyAlias: 'darshan-data-site-a', expectedHostKeyFingerprint: `SHA256:${'A'.repeat(43)}`,
    identityPublicKeyFingerprint: `SHA256:${'B'.repeat(43)}`, knownHostsPath: '/etc/darshan-relay/known_hosts',
    identityFilePath: '/etc/darshan-relay/id_ed25519', remoteForcedCommandContract: 'darshan-recovery-target-stdio-v1',
    checkHostIp: false, connectDeadlineMs: 1_000, actionDeadlineMs: 2_000, responseDeadlineMs: 1_000, ...overrides });
}

function fake(mode: 'success' | 'stderr' | 'nonzero' | 'hang' | 'oversized' | 'truncated' | 'multiframe' | 'noncanonical',
  capture?: { file?: string; args?: readonly string[]; env?: NodeJS.ProcessEnv }): RelaySpawn {
  const source = `let b=[];for await(const c of process.stdin)b.push(c);const q=Buffer.concat(b);if(${JSON.stringify(mode)}==='hang')setInterval(()=>{},1000);else{if(${JSON.stringify(mode)}==='stderr')process.stderr.write('private diagnostics');if(${JSON.stringify(mode)}==='oversized')process.stdout.write('x'.repeat(131072)+'\\n');else if(${JSON.stringify(mode)}==='truncated')process.stdout.write('{}');else if(${JSON.stringify(mode)}==='multiframe')process.stdout.write('{}\\n{}\\n');else if(${JSON.stringify(mode)}==='noncanonical')process.stdout.write('{"z":1,"a":2}\\n');else process.stdout.write('{"ok":true}\\n');if(${JSON.stringify(mode)}==='nonzero')process.exitCode=9;}`;
  return (file, args, options) => {
    if (capture) { capture.file = file; capture.args = args; capture.env = options.env as NodeJS.ProcessEnv; }
    return spawn(process.execPath, ['-e', source], { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  };
}

async function invoke(input: { mode?: Parameters<typeof fake>[0]; configuration?: RecoveryTargetRelayConfig;
  signal?: AbortSignal; writable?: NodeJS.WritableStream; capture?: { file?: string; args?: readonly string[]; env?: NodeJS.ProcessEnv } } = {}) {
  const request = canonicalJson({ request: true }); const output: Buffer[] = [];
  const writable = input.writable ?? new Writable({ write(chunk, _encoding, callback) { output.push(Buffer.from(chunk)); callback(); } });
  await runRecoveryTargetRelayOneShot({ config: input.configuration ?? config(), readable: Readable.from([request]), writable,
    signal: input.signal, spawn: fake(input.mode ?? 'success', input.capture) });
  return Buffer.concat(output);
}

function faultingStdin(variant: 'full-write' | 'partial-write' | 'end' | 'error', pids: number[]): RelaySpawn {
  return (_file, _args, options) => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
    pids.push(child.pid!); const originalWrite = child.stdin.write.bind(child.stdin);
    if (variant === 'full-write' || variant === 'partial-write') {
      Object.defineProperty(child.stdin, 'write', { configurable: true, value: (bytes: Buffer, callback: (error?: Error) => void) => {
        originalWrite(variant === 'full-write' ? bytes : bytes.subarray(0, Math.max(1, Math.floor(bytes.byteLength / 2))));
        setImmediate(() => callback(new Error(`${variant} failure`))); return true;
      } });
    } else if (variant === 'end') {
      Object.defineProperty(child.stdin, 'end', { configurable: true, value: (callback: (error?: Error) => void) => {
        setImmediate(() => callback(new Error('end failure'))); return child.stdin;
      } });
    } else {
      Object.defineProperty(child.stdin, 'write', { configurable: true, value: () => {
        setImmediate(() => child.stdin.emit('error', new Error('async stdin failure'))); return true;
      } });
    }
    return child;
  };
}

function termResistant(pids: number[]): RelaySpawn {
  return (_file, _args, options) => { const child = spawn(process.execPath,
    ['-e', "process.on('SIGTERM',()=>{});(async()=>{for await(const _ of process.stdin){};setInterval(()=>{},1000)})()"],
    { ...options, stdio: ['pipe', 'pipe', 'pipe'] }); pids.push(child.pid!); return child; };
}

describe('recovery target restricted SSH relay', () => {
  it('uses fixed SSH, fixed hardening options, a scrubbed environment, and exact buffered stdin', async () => {
    process.env.SSH_AUTH_SOCK = '/ambient/agent'; process.env.SSH_ASKPASS = '/ambient/askpass';
    const capture: { file?: string; args?: readonly string[]; env?: NodeJS.ProcessEnv } = {};
    expect(await invoke({ capture })).toEqual(canonicalJson({ ok: true }));
    expect(capture.file).toBe('/usr/bin/ssh'); expect(capture.env).toEqual({ PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' });
    const argv = capture.args ?? []; expect(argv.slice(0, 2)).toEqual(['-F', '/dev/null']);
    for (const required of ['BatchMode=yes', 'IdentitiesOnly=yes', 'StrictHostKeyChecking=yes', 'PasswordAuthentication=no',
      'KbdInteractiveAuthentication=no', 'GSSAPIAuthentication=no', 'ForwardAgent=no', 'ForwardX11=no',
      'ClearAllForwardings=yes', 'Tunnel=no', 'PermitLocalCommand=no', 'RequestTTY=no', 'ControlMaster=no',
      'ControlPath=none', 'UpdateHostKeys=no', 'ProxyCommand=none', 'ProxyJump=none']) expect(argv).toContain(required);
    expect(argv.at(-1)).toBe('192.0.2.40'); expect(argv).not.toContain('command');
    delete process.env.SSH_AUTH_SOCK; delete process.env.SSH_ASKPASS;
  });

  it('accepts bounded stderr on success and rejects nonzero, timeout, oversize, truncated, multiframe, and noncanonical output', async () => {
    expect(await invoke({ mode: 'stderr' })).toEqual(canonicalJson({ ok: true }));
    await expect(invoke({ mode: 'nonzero' })).rejects.toMatchObject({ classification: 'UNCERTAIN_AFTER_SSH_DISPATCH' });
    for (const mode of ['nonzero', 'hang', 'oversized', 'truncated', 'multiframe', 'noncanonical'] as const) {
      const configuration = mode === 'hang' ? config({ actionDeadlineMs: 1_001 }) : config();
      await expect(invoke({ mode, configuration })).rejects.toBeInstanceOf(RecoveryTargetRelayError);
    }
  }, 6_000);

  it('never spawns for malformed, noncanonical, multiframe, oversized, or pre-cancelled request input', async () => {
    let spawned = 0; const spawnFactory: RelaySpawn = (...args) => { spawned += 1; return fake('success')(...args); };
    for (const request of [Buffer.from('{"z":1,"a":2}\n'), Buffer.from('{}\n{}\n'), Buffer.from('{}'),
      Buffer.concat([Buffer.alloc(64 * 1024, 0x61), Buffer.from('\n')])]) {
      await expect(runRecoveryTargetRelayOneShot({ config: config(), readable: Readable.from([request]),
        writable: new Writable({ write(_c, _e, cb) { cb(); } }), spawn: spawnFactory })).rejects.toBeDefined();
    }
    const cancelled = new AbortController(); cancelled.abort();
    await expect(runRecoveryTargetRelayOneShot({ config: config(), readable: Readable.from([canonicalJson({ request: true })]),
      writable: new Writable({ write(_c, _e, cb) { cb(); } }), signal: cancelled.signal, spawn: spawnFactory })).rejects.toBeDefined();
    expect(spawned).toBe(0);
  });

  it('classifies a factory failure before any SSH process or stdin dispatch as definite', async () => {
    const throwing: RelaySpawn = () => { throw new Error('fixture spawn failure'); };
    await expect(runRecoveryTargetRelayOneShot({ config: config(), readable: Readable.from([canonicalJson({ request: true })]),
      writable: new Writable({ write(_c, _e, cb) { cb(); } }), spawn: throwing }))
      .rejects.toMatchObject({ classification: 'DEFINITE_BEFORE_SSH_DISPATCH' });
  });

  it.each(['full-write', 'partial-write', 'end', 'error'] as const)(
    'settles %s stdin failure as uncertain and leaves no TERM-resistant SSH process', async (variant) => {
      const pids: number[] = [];
      await expect(runRecoveryTargetRelayOneShot({ config: config(), readable: Readable.from([canonicalJson({ request: true })]),
        writable: new Writable({ write(_c, _e, cb) { cb(); } }), spawn: faultingStdin(variant, pids) }))
        .rejects.toMatchObject({ classification: 'UNCERTAIN_AFTER_SSH_DISPATCH' });
      expect(pids).toHaveLength(1); expect(() => process.kill(pids[0], 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    });

  it.each(['TERM', 'INT'] as const)('aborts and reaps a TERM-resistant SSH child on worker %s shutdown', async (_signal) => {
    const pids: number[] = []; const shutdown = new AbortController();
    const pending = runRecoveryTargetRelayOneShot({ config: config(), readable: Readable.from([canonicalJson({ request: true })]),
      writable: new Writable({ write(_c, _e, cb) { cb(); } }), shutdownSignal: shutdown.signal,
      spawn: termResistant(pids) });
    setTimeout(() => shutdown.abort(new Error('fixture signal')), 25);
    await expect(pending).rejects.toMatchObject({ classification: 'UNCERTAIN_AFTER_SSH_DISPATCH' });
    expect(() => process.kill(pids[0], 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
  });

  it('finishes the bounded SSH exchange after post-dispatch cancellation and discards an unavailable client output', async () => {
    const cancellation = new AbortController(); const sink = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('gone')); } });
    const pending = invoke({ writable: sink, signal: cancellation.signal }); setTimeout(() => cancellation.abort(), 10);
    await expect(pending).resolves.toEqual(Buffer.alloc(0));
  });

  it('rejects metacharacters and option-like config values', () => {
    for (const overrides of [{ destination: 'host;touch/tmp/pwn' }, { destination: '-oProxyCommand=x' },
      { user: 'root command' }, { hostKeyAlias: 'alias value' }, { knownHostsPath: '../known_hosts' }]) {
      expect(() => relayConfigSchema.parse({ ...config(), ...overrides })).toThrow();
    }
  });

  it('loads only canonical protected config/key/known-hosts metadata without reading private-key bytes', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-relay-config-')); roots.push(root); await fs.chmod(root, 0o710);
    const key = join(root, 'id_ed25519'); const hosts = join(root, 'known_hosts'); const path = join(root, 'relay.json');
    await fs.writeFile(key, 'not-read-by-worker', { mode: 0o600 }); await fs.writeFile(hosts, 'host key', { mode: 0o440 });
    const value = config({ identityFilePath: key, knownHostsPath: hosts }); await fs.writeFile(path, canonicalJson(value), { mode: 0o640 });
    expect(await loadRecoveryTargetRelayConfig(path, { configUid: process.getuid(), configGid: process.getgid(),
      relayUid: process.getuid(), relayGid: process.getgid() })).toEqual(value);
    await fs.chmod(key, 0o640);
    await expect(loadRecoveryTargetRelayConfig(path, { configUid: process.getuid(), configGid: process.getgid(),
      relayUid: process.getuid(), relayGid: process.getgid() })).rejects.toThrow();
  });

  it('does not expose a command or option tail after the fixed destination', () => {
    const argv = recoveryTargetSshArgv(config()); const separator = argv.lastIndexOf('--');
    expect(separator).toBe(argv.length - 2); expect(argv[separator + 1]).toBe('192.0.2.40');
  });
});
