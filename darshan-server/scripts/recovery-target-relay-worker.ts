import { spawn as spawnChild, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stdin, stdout } from 'node:process';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../src/backups/backup-broker-protocol';
import { TARGET_HELPER_MAX_REQUEST_BYTES, TARGET_HELPER_MAX_RESPONSE_BYTES,
  TARGET_HELPER_REQUEST_TIMEOUT_MS } from '../src/recovery/target-helper-protocol';

const RELAY_CONFIG_MAX_BYTES = 64 * 1024;
const RELAY_STDERR_MAX_BYTES = 16 * 1024;
const SSH_PATH = '/usr/bin/ssh';
const digest = z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/);
const absolutePath = z.string().min(2).max(4096).refine((value) =>
  isAbsolute(value) && resolve(value) === value && !value.endsWith(sep), 'path must be canonical and absolute');
const safeAtom = z.string().min(1).max(255).regex(/^[A-Za-z0-9._:-]+$/);
const destination = z.string().min(1).max(253).regex(/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\]|[0-9A-Fa-f:.]+)$/);

export const relayConfigSchema = z.object({
  format: z.literal('darshan-recovery-target-relay-v1'),
  siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  backendInstallationId: z.string().uuid().transform((value) => value.toLowerCase()),
  dataHostInstallationId: z.string().uuid().transform((value) => value.toLowerCase()),
  destination: destination,
  port: z.number().int().min(1).max(65_535),
  user: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/),
  hostKeyAlias: safeAtom,
  expectedHostKeyFingerprint: digest,
  identityPublicKeyFingerprint: digest,
  knownHostsPath: absolutePath,
  identityFilePath: absolutePath,
  remoteForcedCommandContract: z.literal('darshan-recovery-target-stdio-v1'),
  checkHostIp: z.boolean(),
  connectDeadlineMs: z.number().int().min(1_000).max(60_000).safe(),
  actionDeadlineMs: z.number().int().min(1_000).max(240_000).safe(),
  responseDeadlineMs: z.number().int().min(1_000).max(60_000).safe(),
}).strict().superRefine((value, context) => {
  if (value.connectDeadlineMs >= value.actionDeadlineMs || value.responseDeadlineMs >= value.actionDeadlineMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'component deadlines must be below the action deadline' });
  }
  if (value.destination.startsWith('-') || value.hostKeyAlias.startsWith('-')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'SSH atoms must not be option-like' });
  }
});
export type RecoveryTargetRelayConfig = z.infer<typeof relayConfigSchema>;

export type RelayFailureClassification = 'DEFINITE_BEFORE_SSH_DISPATCH' | 'UNCERTAIN_AFTER_SSH_DISPATCH';
export class RecoveryTargetRelayError extends Error {
  constructor(public readonly classification: RelayFailureClassification, message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'RecoveryTargetRelayError';
  }
}

export interface RelayFileAuthority {
  configUid: number; configGid: number; relayUid: number; relayGid: number;
}

async function exactMetadata(path: string, expected: { uid: number; gid: number; modes: readonly number[]; readBytes: boolean },
  maximumBytes = RELAY_CONFIG_MAX_BYTES): Promise<Buffer> {
  if (!isAbsolute(path) || resolve(path) !== path || path.endsWith(sep)) throw new Error('unsafe installed path');
  const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || Number(before.uid) !== expected.uid || Number(before.gid) !== expected.gid ||
        !expected.modes.includes(Number(before.mode & 0o777n)) || before.size < 1n || before.size > BigInt(maximumBytes) ||
        await fs.realpath(path) !== path) throw new Error('unsafe installed file');
    if (!expected.readBytes) return Buffer.alloc(0);
    const expectedSize = Number(before.size); const bytes = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) break; offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true }); const named = await fs.lstat(path, { bigint: true });
    if (offset !== expectedSize || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mode !== before.mode || after.uid !== before.uid || after.gid !== before.gid || after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs || named.dev !== before.dev || named.ino !== before.ino || named.nlink !== 1n) {
      throw new Error('installed file changed');
    }
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}

async function validateParent(path: string, uid: number, gid: number, modes: readonly number[]): Promise<void> {
  const parent = dirname(path); const state = await fs.lstat(parent, { bigint: true });
  if (state.isSymbolicLink() || !state.isDirectory() || Number(state.uid) !== uid || Number(state.gid) !== gid ||
      !modes.includes(Number(state.mode & 0o777n)) || await fs.realpath(parent) !== parent) throw new Error('unsafe installed parent');
}

export async function loadRecoveryTargetRelayConfig(path: string, authority: RelayFileAuthority): Promise<RecoveryTargetRelayConfig> {
  await validateParent(path, authority.configUid, authority.configGid, [0o710]);
  const bytes = await exactMetadata(path, { uid: authority.configUid, gid: authority.configGid, modes: [0o640], readBytes: true });
  const config = relayConfigSchema.parse(parseStrictJson(bytes, RELAY_CONFIG_MAX_BYTES));
  if (!canonicalJson(config).equals(bytes)) throw new Error('relay config is not canonical');
  await Promise.all([
    validateParent(config.identityFilePath, authority.configUid, authority.relayGid, [0o710]),
    exactMetadata(config.identityFilePath, { uid: authority.relayUid, gid: authority.relayGid, modes: [0o600], readBytes: false }, 16 * 1024),
    validateParent(config.knownHostsPath, authority.configUid, authority.relayGid, [0o710]),
    exactMetadata(config.knownHostsPath, { uid: authority.configUid, gid: authority.relayGid, modes: [0o440, 0o444], readBytes: false }, 1024 * 1024),
  ]);
  return config;
}

function fixedEnvironment(name: string, pattern?: RegExp): string {
  const value = process.env[name]; if (!value || (pattern && !pattern.test(value))) throw new Error(`missing fixed ${name}`); return value;
}

export async function readOneRelayFrame(input: NodeJS.ReadableStream = stdin,
  frameTimeoutMs = TARGET_HELPER_REQUEST_TIMEOUT_MS, idleTimeoutMs = 60_000, signal?: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0; let frameTimer: NodeJS.Timeout | undefined;
  const stream = input as NodeJS.ReadableStream & { destroy(error?: Error): void };
  signal?.throwIfAborted(); const onAbort = () => stream.destroy(signal?.reason instanceof Error ? signal.reason : new Error('cancelled'));
  signal?.addEventListener('abort', onAbort, { once: true });
  let idleTimer: NodeJS.Timeout | undefined = setTimeout(() => stream.destroy(new Error('idle deadline')), idleTimeoutMs);
  const arm = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
    frameTimer ??= setTimeout(() => stream.destroy(new Error('incomplete frame')), frameTimeoutMs); };
  try {
    for await (const value of input) {
      const chunk = Buffer.from(value); if (!chunk.byteLength) continue; arm(); size += chunk.byteLength;
      if (size > TARGET_HELPER_MAX_REQUEST_BYTES) throw new Error('oversized frame'); chunks.push(chunk);
    }
  } finally { if (idleTimer) clearTimeout(idleTimer); if (frameTimer) clearTimeout(frameTimer); signal?.removeEventListener('abort', onAbort); }
  const bytes = Buffer.concat(chunks, size);
  if (bytes.byteLength < 3 || bytes[bytes.byteLength - 1] !== 0x0a || bytes.includes(0x0d) ||
      bytes.subarray(0, -1).includes(0x0a)) throw new Error('invalid frame');
  const parsed = parseStrictJson(bytes, TARGET_HELPER_MAX_REQUEST_BYTES);
  if (!canonicalJson(parsed).equals(bytes)) throw new Error('noncanonical frame');
  return bytes;
}

export function recoveryTargetSshArgv(config: RecoveryTargetRelayConfig): string[] {
  const option = (value: string) => ['-o', value];
  return ['-F', '/dev/null', ...option('BatchMode=yes'), ...option('IdentitiesOnly=yes'),
    ...option(`IdentityFile=${config.identityFilePath}`), ...option(`UserKnownHostsFile=${config.knownHostsPath}`),
    ...option('GlobalKnownHostsFile=/dev/null'), ...option('StrictHostKeyChecking=yes'), ...option(`HostKeyAlias=${config.hostKeyAlias}`),
    ...option(`CheckHostIP=${config.checkHostIp ? 'yes' : 'no'}`), ...option('PasswordAuthentication=no'),
    ...option('KbdInteractiveAuthentication=no'), ...option('GSSAPIAuthentication=no'), ...option('ForwardAgent=no'),
    ...option('ForwardX11=no'), ...option('ClearAllForwardings=yes'), ...option('Tunnel=no'), ...option('PermitLocalCommand=no'),
    ...option('RequestTTY=no'), ...option('ControlMaster=no'), ...option('ControlPath=none'), ...option('UpdateHostKeys=no'),
    ...option('ProxyCommand=none'), ...option('ProxyJump=none'), ...option(`ConnectTimeout=${Math.max(1, Math.ceil(config.connectDeadlineMs / 1000))}`),
    '-p', String(config.port), '-l', config.user, '--', config.destination];
}

export type RelaySpawn = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;

function wait(milliseconds: number): Promise<void> { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }

async function exchangeWithSsh(input: { config: RecoveryTargetRelayConfig; request: Buffer; signal?: AbortSignal;
  shutdownSignal?: AbortSignal; spawn?: RelaySpawn }): Promise<Buffer> {
  input.signal?.throwIfAborted();
  let dispatched = false; const fail = (message: string, cause?: unknown) => new RecoveryTargetRelayError(dispatched
    ? 'UNCERTAIN_AFTER_SSH_DISPATCH' : 'DEFINITE_BEFORE_SSH_DISPATCH', message, { cause });
  let child: ChildProcessWithoutNullStreams;
  try {
    child = (input.spawn ?? (spawnChild as RelaySpawn))(SSH_PATH, recoveryTargetSshArgv(input.config), {
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
  } catch (cause) { throw fail('SSH process failed before dispatch', cause); }
  const stdoutChunks: Buffer[] = []; let stdoutBytes = 0; let stderrBytes = 0; let closed = false;
  let responseTimer: NodeJS.Timeout | undefined; let spawnError: unknown;
  const spawned = new Promise<void>((resolvePromise, rejectPromise) => {
    child.once('spawn', resolvePromise); child.once('error', rejectPromise);
  });
  const completion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise) => {
    child.once('error', (cause) => { spawnError = cause; });
    child.once('close', (code, signal) => { closed = true; resolvePromise({ code, signal }); });
    child.stdout.on('data', (value: Buffer) => {
      if (!responseTimer) responseTimer = setTimeout(() => requestStop(fail('SSH response deadline exceeded')), input.config.responseDeadlineMs);
      stdoutBytes += value.byteLength; if (stdoutBytes > TARGET_HELPER_MAX_RESPONSE_BYTES) { requestStop(fail('SSH response exceeded bound')); return; }
      stdoutChunks.push(Buffer.from(value));
    });
    child.stderr.on('data', (value: Buffer) => { stderrBytes += value.byteLength;
      if (stderrBytes > RELAY_STDERR_MAX_BYTES) requestStop(fail('SSH stderr exceeded bound')); });
  });
  let terminatePromise: Promise<void> | undefined;
  const terminate = () => terminatePromise ??= (async () => {
    if (closed) return;
    child.kill('SIGTERM'); await Promise.race([completion.then(() => undefined), wait(250)]);
    if (!closed) child.kill('SIGKILL'); await Promise.race([completion.then(() => undefined), wait(1_000)]);
    if (!closed) throw new Error('SSH child did not close after SIGKILL');
  })();
  let stopCause: unknown; let stopReject: ((cause: unknown) => void) | undefined;
  const stopped = new Promise<never>((_resolve, rejectPromise) => { stopReject = rejectPromise; });
  const requestStop = (cause: unknown) => {
    if (stopCause) return; stopCause = cause;
    void terminate().then(() => stopReject?.(cause), (cleanupCause) => stopReject?.(fail('SSH cleanup deadline exceeded', cleanupCause)));
  };
  const onStdinError = (cause: Error) => requestStop(fail('SSH stdin failed', cause));
  child.stdin.on('error', onStdinError);
  const onShutdown = () => requestStop(fail('Relay worker shutdown requested', input.shutdownSignal?.reason));
  input.shutdownSignal?.addEventListener('abort', onShutdown, { once: true });
  if (input.shutdownSignal?.aborted) onShutdown();
  const actionTimer = setTimeout(() => requestStop(fail('SSH action deadline exceeded')), input.config.actionDeadlineMs);
  try {
    await Promise.race([spawned, stopped]).catch((cause) => { throw cause instanceof RecoveryTargetRelayError
      ? cause : fail('SSH process failed before dispatch', cause); });
    await Promise.race([new Promise<void>((resolvePromise, rejectPromise) => {
      dispatched = true;
      try { child.stdin.write(input.request, (error?: Error | null) => error ? rejectPromise(error) : resolvePromise()); }
      catch (cause) { rejectPromise(cause); }
    }), stopped]).catch((cause) => { throw cause instanceof RecoveryTargetRelayError ? cause : fail('SSH stdin write failed', cause); });
    await Promise.race([new Promise<void>((resolvePromise, rejectPromise) => {
      try { child.stdin.end((error?: Error | null) => error ? rejectPromise(error) : resolvePromise()); }
      catch (cause) { rejectPromise(cause); }
    }), stopped]).catch((cause) => { throw cause instanceof RecoveryTargetRelayError ? cause : fail('SSH stdin close failed', cause); });
    const result = await Promise.race([completion, stopped]);
    if (spawnError) throw fail('SSH process failed', spawnError);
    if (stdoutBytes > TARGET_HELPER_MAX_RESPONSE_BYTES || stderrBytes > RELAY_STDERR_MAX_BYTES) throw fail('SSH output exceeded bound');
    if (result.code !== 0 || result.signal) throw fail('SSH exited unsuccessfully');
    const response = Buffer.concat(stdoutChunks, stdoutBytes);
    if (response.byteLength < 3 || response[response.byteLength - 1] !== 0x0a || response.includes(0x0d) ||
        response.subarray(0, -1).includes(0x0a)) throw fail('SSH response framing invalid');
    const parsed = parseStrictJson(response, TARGET_HELPER_MAX_RESPONSE_BYTES);
    if (!canonicalJson(parsed).equals(response)) throw fail('SSH response is noncanonical');
    return response;
  } catch (cause) {
    await terminate(); throw cause;
  } finally {
    await completion; clearTimeout(actionTimer); if (responseTimer) clearTimeout(responseTimer);
    input.shutdownSignal?.removeEventListener('abort', onShutdown);
  }
}

export async function runRecoveryTargetRelayOneShot(input: {
  config: RecoveryTargetRelayConfig; readable?: NodeJS.ReadableStream; writable?: NodeJS.WritableStream;
  signal?: AbortSignal; shutdownSignal?: AbortSignal; spawn?: RelaySpawn;
}): Promise<void> {
  const preDispatchSignals = [input.signal, input.shutdownSignal].filter((value): value is AbortSignal => Boolean(value));
  const preDispatchSignal = preDispatchSignals.length > 1 ? AbortSignal.any(preDispatchSignals) : preDispatchSignals[0];
  const request = await readOneRelayFrame(input.readable, TARGET_HELPER_REQUEST_TIMEOUT_MS,
    input.config.actionDeadlineMs, preDispatchSignal);
  input.signal?.throwIfAborted();
  const response = await exchangeWithSsh({ config: input.config, request, signal: input.signal,
    shutdownSignal: input.shutdownSignal, spawn: input.spawn });
  const writable = input.writable ?? stdout;
  await new Promise<void>((resolvePromise) => {
    let complete = false;
    const timer = setTimeout(() => {
      (writable as NodeJS.WritableStream & { destroy?(error?: Error): void }).destroy?.(); finish();
    }, input.config.responseDeadlineMs);
    const finish = () => { if (complete) return; complete = true; clearTimeout(timer); resolvePromise(); };
    writable.on('error', finish); writable.write(response, finish);
  });
  if (!(writable as NodeJS.WritableStream & { destroyed?: boolean }).destroyed) writable.end();
}

export async function createProductionRecoveryTargetRelayConfig(): Promise<RecoveryTargetRelayConfig> {
  const relayUid = Number(fixedEnvironment('DARSHAN_TARGET_RELAY_UID', /^(?:0|[1-9][0-9]*)$/));
  const relayGid = Number(fixedEnvironment('DARSHAN_TARGET_RELAY_GID', /^(?:0|[1-9][0-9]*)$/));
  return loadRecoveryTargetRelayConfig(fixedEnvironment('DARSHAN_TARGET_RELAY_CONFIG_FILE'), {
    configUid: 0, configGid: relayGid, relayUid, relayGid,
  });
}

async function main(): Promise<void> {
  const shutdown = new AbortController(); const onShutdown = () => shutdown.abort(new Error('relay shutdown'));
  process.on('SIGTERM', onShutdown); process.on('SIGINT', onShutdown);
  try { await runRecoveryTargetRelayOneShot({ config: await createProductionRecoveryTargetRelayConfig(), shutdownSignal: shutdown.signal }); }
  catch { process.stderr.write('target-relay-worker: request failed\n'); process.exitCode = 78; }
  finally { process.off('SIGTERM', onShutdown); process.off('SIGINT', onShutdown); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
