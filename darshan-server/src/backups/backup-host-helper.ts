import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { attachAbortTermination } from './abortable-process';
import { type ConfigurationCapsuleContractEntry } from './configuration-capsule';
import { BackupError } from './errors';
import {
  parseBackupManifest, serializeBackupManifest, serializeUnsignedBackupManifest,
  type BackupManifestSigner, type BackupManifestVerifier,
} from './manifest';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const HELPER_TIMEOUT_MS = 60_000;
const SHA256 = /^[a-f0-9]{64}$/;
const SITE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const policySchema = z.object({
  version: z.literal(1), helper_version: z.string().min(1).max(100), site_id: z.string().regex(SITE),
  manifest_signing: z.object({
    algorithm: z.literal('Ed25519'), key_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  }).strict(),
  configuration_contract: z.array(z.object({
    logical_name: z.string().min(1).max(160), required: z.boolean(),
    max_bytes: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
  }).strict()).min(1).max(512),
}).strict();

const signResponseSchema = z.object({
  version: z.literal(1), helper_version: z.string(), operation: z.literal('SIGN_MANIFEST'),
  site_id: z.string().regex(SITE), run_id: z.string().regex(UUID), attempt_id: z.string().regex(UUID),
  algorithm: z.literal('Ed25519'), key_id: z.string(), manifest_sha256: z.string().regex(SHA256),
  signature_base64: z.string().min(1).max(16_384).regex(BASE64),
}).strict();

const verifyResponseSchema = z.object({
  version: z.literal(1), helper_version: z.string(), operation: z.literal('VERIFY_MANIFEST'),
  site_id: z.string().regex(SITE), run_id: z.string().regex(UUID), attempt_id: z.string().regex(UUID),
  manifest_sha256: z.string().regex(SHA256), accepted: z.boolean(),
}).strict();

type HelperIdentity = { dev: string; ino: string; size: string; mtime: string };
const identity = (stat: Awaited<ReturnType<typeof fs.lstat>>): HelperIdentity =>
  ({
    dev: stat.dev.toString(), ino: stat.ino.toString(), size: stat.size.toString(),
    mtime: ('mtimeNs' in stat ? stat.mtimeNs : stat.mtimeMs).toString(),
  });
const sameIdentity = (a: HelperIdentity, b: HelperIdentity) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtime === b.mtime;

async function inspectPinnedHelper(path: string, expectedSha256: string): Promise<HelperIdentity> {
  if (!isAbsolute(path) || resolve(path) !== path || !SHA256.test(expectedSha256)) {
    throw new BackupError('BACKUP_HOST_HELPER_INVALID', 'Backup host helper path or SHA-256 pin is invalid.');
  }
  const realPath = await fs.realpath(path).catch((cause) => {
    throw new BackupError('BACKUP_HOST_HELPER_INVALID', 'Backup host helper is unavailable.', undefined, { cause });
  });
  if (realPath !== path) throw new BackupError('BACKUP_HOST_HELPER_INVALID', 'Backup host helper path must be canonical and must not traverse symlinks.');
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.mode & 0o022n) !== 0) {
    throw new BackupError('BACKUP_HOST_HELPER_INVALID', 'Backup host helper must be a non-symlink regular file not writable by group or other.');
  }
  const actual = createHash('sha256').update(await fs.readFile(path)).digest('hex');
  if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expectedSha256))) {
    throw new BackupError('BACKUP_HOST_HELPER_INVALID', 'Backup host helper does not match its pinned SHA-256.');
  }
  return identity(stat);
}

async function invokeHelper(input: {
  helperPath: string; expectedSha256: string; args: readonly string[]; stdin?: Uint8Array; signal?: AbortSignal;
}): Promise<unknown> {
  const before = await inspectPinnedHelper(input.helperPath, input.expectedSha256);
  input.signal?.throwIfAborted();
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HELPER_TIMEOUT_MS)]) : AbortSignal.timeout(HELPER_TIMEOUT_MS);
  const child = spawn(input.helperPath, [...input.args], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    detached: process.platform !== 'win32',
  });
  const termination = attachAbortTermination(child, signal);
  const stdout: Buffer[] = [];
  let bytes = 0;
  let overflow = false;
  child.stdout?.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes <= MAX_OUTPUT_BYTES) stdout.push(chunk); else overflow = true;
  });
  // Diagnostics are deliberately drained, never copied into errors/logs.
  child.stderr?.resume();
  child.stdin?.end(input.stdin);
  try {
    const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once('error', rejectExit); child.once('close', resolveExit);
    });
    signal.throwIfAborted();
    if (!sameIdentity(before, identity(await fs.lstat(input.helperPath, { bigint: true })))) {
      throw new BackupError('BACKUP_HOST_HELPER_INVALID', 'Backup host helper changed during invocation.');
    }
    if (overflow) throw new BackupError('BACKUP_HOST_HELPER_PROTOCOL_INVALID', 'Backup host helper response exceeded one MiB.');
    if (exitCode !== 0) throw new BackupError('BACKUP_HOST_HELPER_FAILED', `Backup host helper exited with code ${exitCode}.`);
    try { return JSON.parse(Buffer.concat(stdout).toString('utf8')) as unknown; }
    catch (cause) { throw new BackupError('BACKUP_HOST_HELPER_PROTOCOL_INVALID', 'Backup host helper returned invalid JSON.', undefined, { cause }); }
  } finally {
    await termination.wait(); termination.dispose();
  }
}

export interface BackupHostHelperRuntime {
  readonly configurationContract: readonly ConfigurationCapsuleContractEntry[];
  signer(signal: AbortSignal): BackupManifestSigner;
  verifier(signal?: AbortSignal): BackupManifestVerifier;
}

export async function createBackupHostHelperRuntime(input: {
  helperPath: string; expectedHelperVersion: string; expectedHelperSha256: string; siteId: string; signal?: AbortSignal;
}): Promise<BackupHostHelperRuntime> {
  const parsed = policySchema.safeParse(await invokeHelper({
    helperPath: input.helperPath, expectedSha256: input.expectedHelperSha256,
    args: ['describe', '--protocol-version=1', `--site-id=${input.siteId}`], signal: input.signal,
  }));
  if (!parsed.success || parsed.data.helper_version !== input.expectedHelperVersion || parsed.data.site_id !== input.siteId) {
    throw new BackupError('BACKUP_HOST_HELPER_PROTOCOL_INVALID', 'Backup host helper policy identity or schema is invalid.');
  }
  const policy = parsed.data;
  const names = new Set<string>();
  const configurationContract = policy.configuration_contract.map((entry) => {
    if (names.has(entry.logical_name)) throw new BackupError('BACKUP_HOST_HELPER_PROTOCOL_INVALID', 'Backup host helper policy contains duplicate configuration entries.');
    names.add(entry.logical_name);
    return { logicalName: entry.logical_name, required: entry.required, maxBytes: BigInt(entry.max_bytes) };
  });
  const validateUnsigned = (payload: Uint8Array) => {
    const manifest = parseBackupManifest(payload);
    if (manifest.signature !== null || manifest.site.id !== input.siteId || !Buffer.from(payload).equals(serializeUnsignedBackupManifest(manifest))) {
      throw new BackupError('BACKUP_MANIFEST_INVALID', 'Manifest helper accepts only a canonical unsigned manifest for its configured site.');
    }
    return manifest;
  };
  return {
    configurationContract,
    signer: (signal) => ({
      algorithm: policy.manifest_signing.algorithm, keyId: policy.manifest_signing.key_id,
      sign: async (payload) => {
        const manifest = validateUnsigned(payload);
        const digest = createHash('sha256').update(payload).digest('hex');
        const response = signResponseSchema.safeParse(await invokeHelper({
          helperPath: input.helperPath, expectedSha256: input.expectedHelperSha256, signal, stdin: payload,
          args: ['sign-manifest', '--protocol-version=1', `--site-id=${input.siteId}`, `--run-id=${manifest.run.id}`, `--attempt-id=${manifest.run.attemptId}`],
        }));
        if (!response.success || response.data.helper_version !== input.expectedHelperVersion || response.data.site_id !== input.siteId ||
            response.data.run_id !== manifest.run.id || response.data.attempt_id !== manifest.run.attemptId ||
            response.data.algorithm !== policy.manifest_signing.algorithm || response.data.key_id !== policy.manifest_signing.key_id ||
            response.data.manifest_sha256 !== digest) {
          throw new BackupError('BACKUP_HOST_HELPER_PROTOCOL_INVALID', 'Backup host helper signing response does not match the manifest request.');
        }
        return Buffer.from(response.data.signature_base64, 'base64');
      },
    }),
    verifier: (signal) => ({
      verify: async ({ algorithm, keyId, payload, signature }) => {
        if (algorithm !== policy.manifest_signing.algorithm || keyId !== policy.manifest_signing.key_id) return false;
        const unsigned = validateUnsigned(payload);
        const signed = serializeBackupManifest({ ...unsigned, signature: { algorithm, keyId, valueBase64: Buffer.from(signature).toString('base64') } });
        const digest = createHash('sha256').update(payload).digest('hex');
        const response = verifyResponseSchema.safeParse(await invokeHelper({
          helperPath: input.helperPath, expectedSha256: input.expectedHelperSha256, signal, stdin: signed,
          args: ['verify-manifest', '--protocol-version=1', `--site-id=${input.siteId}`, `--run-id=${unsigned.run.id}`, `--attempt-id=${unsigned.run.attemptId}`],
        }));
        if (!response.success || response.data.helper_version !== input.expectedHelperVersion || response.data.site_id !== input.siteId ||
            response.data.run_id !== unsigned.run.id || response.data.attempt_id !== unsigned.run.attemptId || response.data.manifest_sha256 !== digest) {
          throw new BackupError('BACKUP_HOST_HELPER_PROTOCOL_INVALID', 'Backup host helper verification response does not match the manifest request.');
        }
        return response.data.accepted;
      },
    }),
  };
}
