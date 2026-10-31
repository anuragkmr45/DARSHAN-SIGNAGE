import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { attachAbortTermination } from './abortable-process';
import { BackupError, asBackupError } from './errors';

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const DEFAULT_MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const DEFAULT_PROCESS_TIMEOUT_MS = 60 * 60 * 1000;

function hasControlCharacters(value: string) {
  return [...value].some((character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f);
}

function sanitizeDiagnostic(value: string) {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    return (code <= 0x1f && character !== '\n' && character !== '\r' && character !== '\t') || code === 0x7f ? '?' : character;
  }).join('').trim();
}

export interface AgeToolPin {
  /** Absolute, canonical path to the deployment-pinned age executable. */
  executablePath: string;
  /** Lowercase SHA-256 of the exact executable deployed at executablePath. */
  expectedExecutableSha256: string;
  /** Exact reviewed semantic version. A single upstream `v` presentation prefix is normalized. */
  expectedVersion: string;
}

export interface AgeFileOperationOptions extends AgeToolPin {
  inputPath: string;
  outputPath: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxDiagnosticBytes?: number;
}

export interface AgeEncryptionOptions extends AgeFileOperationOptions {
  recipient: string;
}

export interface AgeRecoveryDecryptionOptions extends AgeFileOperationOptions {
  /** Absolute path to an operator-mounted or test identity file. Never needed by scheduled backup workers. */
  identityPath: string;
}

function bech32Polymod(values: readonly number[]) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index++) if ((top >>> index) & 1) checksum ^= generators[index];
  }
  return checksum >>> 0;
}

function bech32HrpExpand(hrp: string) {
  return [...hrp].map((character) => character.charCodeAt(0) >>> 5)
    .concat(0, [...hrp].map((character) => character.charCodeAt(0) & 31));
}

function convertBits(values: readonly number[], fromBits: number, toBits: number): number[] | null {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const maximumValue = (1 << toBits) - 1;
  for (const value of values) {
    if (value < 0 || value >>> fromBits !== 0) return null;
    accumulator = (accumulator << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >>> bits) & maximumValue);
    }
  }
  if (bits >= fromBits || ((accumulator << (toBits - bits)) & maximumValue) !== 0) return null;
  return result;
}

export function validateAgeX25519Recipient(recipient: string): string {
  if (recipient !== recipient.toLowerCase() || recipient.length < 10 || recipient.length > 90) {
    throw new BackupError('BACKUP_AGE_RECIPIENT_INVALID', 'age recipient must be canonical lowercase Bech32.');
  }
  const separator = recipient.lastIndexOf('1');
  const hrp = recipient.slice(0, separator);
  const encoded = recipient.slice(separator + 1);
  if (hrp !== 'age' || encoded.length < 7) {
    throw new BackupError('BACKUP_AGE_RECIPIENT_INVALID', 'age recipient must use the age X25519 recipient prefix.');
  }
  const values = [...encoded].map((character) => BECH32_CHARSET.indexOf(character));
  if (values.some((value) => value < 0) || bech32Polymod([...bech32HrpExpand(hrp), ...values]) !== 1) {
    throw new BackupError('BACKUP_AGE_RECIPIENT_INVALID', 'age recipient has an invalid Bech32 checksum.');
  }
  const key = convertBits(values.slice(0, -6), 5, 8);
  if (!key || key.length !== 32) {
    throw new BackupError('BACKUP_AGE_RECIPIENT_INVALID', 'age X25519 recipient must encode exactly 32 key bytes.');
  }
  return recipient;
}

function validateBounds(timeoutMs: number, diagnosticBytes: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(diagnosticBytes) || diagnosticBytes < 1 || diagnosticBytes > 1024 * 1024) {
    throw new BackupError('BACKUP_INVALID_INPUT', 'age process bounds are invalid.');
  }
}

async function assertCanonicalRegularFile(path: string, label: string, executable = false) {
  if (!isAbsolute(path) || resolve(path) !== path) throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', `${label} must be an absolute normalized path.`);
  let stat;
  try {
    stat = await fs.lstat(path);
  } catch (error) {
    throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', `${label} is unavailable.`, undefined, { cause: error as Error });
  }
  if (stat.isSymbolicLink() || !stat.isFile() || await fs.realpath(path) !== path) {
    throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', `${label} must be a canonical regular file without symlink traversal.`);
  }
  if (executable && (stat.mode & 0o111) === 0) throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', `${label} is not executable.`);
  return stat;
}

async function sha256PinnedFile(path: string) {
  const handle = await fs.open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', 'Pinned age executable is not a regular file.');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathStat = await fs.lstat(path, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || before.dev !== pathStat.dev || before.ino !== pathStat.ino || pathStat.isSymbolicLink()) {
      throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', 'Pinned age executable changed while it was being validated.');
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

function boundedCollector(stream: NodeJS.ReadableStream | null, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let retained = 0;
  let truncated = false;
  stream?.on('data', (value: Buffer | string) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const remaining = maximumBytes - retained;
    if (remaining > 0) {
      const portion = chunk.subarray(0, remaining);
      chunks.push(portion);
      retained += portion.length;
    }
    if (chunk.length > remaining) truncated = true;
  });
  return () => ({ text: sanitizeDiagnostic(Buffer.concat(chunks).toString('utf8')), truncated });
}

function waitForExit(child: ChildProcess) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

function operationAbort(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const forward = () => controller.abort(signal?.reason ?? new Error('Backup operation aborted.'));
  signal?.addEventListener('abort', forward, { once: true });
  if (signal?.aborted) forward();
  const timer = setTimeout(() => controller.abort(new BackupError('BACKUP_TIMEOUT', `age process exceeded ${timeoutMs}ms.`)), timeoutMs);
  timer.unref();
  return {
    signal: controller.signal,
    dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', forward); },
  };
}

function abortFailure(signal: AbortSignal): BackupError {
  return signal.reason instanceof BackupError
    ? signal.reason
    : new BackupError('BACKUP_ABORTED', 'age process was aborted.', undefined, signal.reason instanceof Error ? { cause: signal.reason } : undefined);
}

async function runCapturedAge(executablePath: string, args: string[], signal: AbortSignal, maximumBytes: number) {
  const child = spawn(executablePath, args, {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
  });
  const stdout = boundedCollector(child.stdout, maximumBytes);
  const stderr = boundedCollector(child.stderr, maximumBytes);
  const termination = attachAbortTermination(child, signal);
  try {
    const result = await waitForExit(child);
    await termination.wait();
    if (signal.aborted) throw abortFailure(signal);
    return { ...result, stdout: stdout(), stderr: stderr() };
  } finally {
    termination.dispose();
  }
}

export async function validatePinnedAgeExecutable(pin: AgeToolPin, options: { signal?: AbortSignal; timeoutMs?: number; maxDiagnosticBytes?: number } = {}) {
  if (!pin.expectedVersion || pin.expectedVersion.trim() !== pin.expectedVersion || hasControlCharacters(pin.expectedVersion)) {
    throw new BackupError('BACKUP_AGE_VERSION_MISMATCH', 'Pinned age version must be an exact non-empty single-line value.');
  }
  if (!/^[a-f0-9]{64}$/.test(pin.expectedExecutableSha256)) {
    throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', 'Pinned age executable SHA-256 must be a lowercase digest.');
  }
  await assertCanonicalRegularFile(pin.executablePath, 'Pinned age executable', true);
  const executableSha256 = await sha256PinnedFile(pin.executablePath);
  if (executableSha256 !== pin.expectedExecutableSha256) {
    throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', 'Pinned age executable SHA-256 does not match the configured digest.', {
      expectedSha256: pin.expectedExecutableSha256,
      actualSha256: executableSha256,
    });
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maximumBytes = options.maxDiagnosticBytes ?? DEFAULT_MAX_DIAGNOSTIC_BYTES;
  validateBounds(timeoutMs, maximumBytes);
  const abort = operationAbort(options.signal, timeoutMs);
  try {
    const result = await runCapturedAge(pin.executablePath, ['--version'], abort.signal, maximumBytes);
    const actualVersion = result.stdout.text.replace(/^v(?=\d)/, '');
    const expectedVersion = pin.expectedVersion.replace(/^v(?=\d)/, '');
    if (result.code !== 0 || result.stdout.truncated || result.stderr.truncated || actualVersion !== expectedVersion) {
      throw new BackupError('BACKUP_AGE_VERSION_MISMATCH', 'Pinned age executable did not return the exact configured version.', {
        exitCode: result.code,
        actualVersion,
        diagnosticsTruncated: result.stdout.truncated || result.stderr.truncated,
      });
    }
    const postExecutionSha256 = await sha256PinnedFile(pin.executablePath);
    if (postExecutionSha256 !== executableSha256) {
      throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', 'Pinned age executable changed during version validation.');
    }
    return { executablePath: pin.executablePath, executableSha256, version: actualVersion } as const;
  } catch (error) {
    throw asBackupError(error, 'BACKUP_AGE_EXECUTABLE_INVALID');
  } finally {
    abort.dispose();
  }
}

async function runAgeFileOperation(input: AgeFileOperationOptions, args: string[], failureCode: 'BACKUP_ENCRYPTION_FAILED' | 'BACKUP_DECRYPTION_FAILED') {
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  const maximumBytes = input.maxDiagnosticBytes ?? DEFAULT_MAX_DIAGNOSTIC_BYTES;
  validateBounds(timeoutMs, maximumBytes);
  if (!isAbsolute(input.inputPath) || !isAbsolute(input.outputPath) || resolve(input.inputPath) !== input.inputPath || resolve(input.outputPath) !== input.outputPath) {
    throw new BackupError('BACKUP_INVALID_INPUT', 'age input and output paths must be absolute normalized paths.');
  }
  if (input.inputPath === input.outputPath) throw new BackupError('BACKUP_INVALID_INPUT', 'age input and output paths must differ.');
  await validatePinnedAgeExecutable(input, { signal: input.signal, timeoutMs: Math.min(timeoutMs, 10_000), maxDiagnosticBytes: maximumBytes });
  const inputHandle = await fs.open(input.inputPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  let outputHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let operationSucceeded = false;
  let operationFailure: BackupError | undefined;
  try {
    if (!(await inputHandle.stat()).isFile()) throw new BackupError('BACKUP_INVALID_INPUT', 'age input must be a regular file.');
    try {
      outputHandle = await fs.open(input.outputPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new BackupError('BACKUP_OUTPUT_EXISTS', 'age output already exists.', { outputPath: input.outputPath }, { cause: error as Error });
      throw error;
    }
    await outputHandle.chmod(0o600);
    const abort = operationAbort(input.signal, timeoutMs);
    try {
      const child = spawn(input.executablePath, args, {
        detached: process.platform !== 'win32',
        stdio: [inputHandle.fd, outputHandle.fd, 'pipe'],
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
      });
      const diagnostics = boundedCollector(child.stderr, maximumBytes);
      const termination = attachAbortTermination(child, abort.signal);
      try {
        const result = await waitForExit(child);
        await termination.wait();
        if (abort.signal.aborted) throw abortFailure(abort.signal);
        const captured = diagnostics();
        if (result.code !== 0) {
          if (/\b(?:ENOSPC|EDQUOT)\b|no space left on device|disk quota exceeded/i.test(captured.text)) {
            throw new BackupError('BACKUP_CAPACITY_EXHAUSTED', 'Backup repository capacity was exhausted while age wrote ciphertext.', {
              exitCode: result.code,
              signal: result.signal,
              diagnosticsTruncated: captured.truncated,
            });
          }
          throw new BackupError(failureCode, `age exited unsuccessfully${captured.text ? `: ${captured.text}` : '.'}`, {
            exitCode: result.code,
            signal: result.signal,
            diagnosticsTruncated: captured.truncated,
          });
        }
        if (await sha256PinnedFile(input.executablePath) !== input.expectedExecutableSha256) {
          throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', 'Pinned age executable changed during the file operation.');
        }
        await outputHandle.sync();
        operationSucceeded = true;
      } finally {
        termination.dispose();
      }
    } finally {
      abort.dispose();
    }
  } catch (error) {
    operationFailure = asBackupError(error, failureCode);
  } finally {
    await inputHandle.close().catch(() => undefined);
    await outputHandle?.close().catch(() => undefined);
  }
  if (!operationSucceeded && outputHandle) {
    try { await fs.rm(input.outputPath, { force: true }); }
    catch (cleanupError) {
      throw new BackupError('BACKUP_PARTIAL_CLEANUP_FAILED', 'Failed to remove a partial age output.', { outputPath: input.outputPath }, { cause: cleanupError as Error });
    }
  }
  if (operationFailure) throw operationFailure;
  const stat = await fs.lstat(input.outputPath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || Number(stat.mode & 0o777n) !== 0o600) {
    throw new BackupError(failureCode, 'age output is not a private regular file.');
  }
  return { outputPath: input.outputPath, sizeBytes: stat.size.toString() } as const;
}

export async function encryptFileWithAge(input: AgeEncryptionOptions) {
  validateAgeX25519Recipient(input.recipient);
  return runAgeFileOperation(input, ['--encrypt', '--recipient', input.recipient], 'BACKUP_ENCRYPTION_FAILED');
}

/** Recovery/test-only operation. Scheduled backup workers must never receive an identity path. */
export async function decryptFileWithAgeForRecovery(input: AgeRecoveryDecryptionOptions) {
  const identity = await assertCanonicalRegularFile(input.identityPath, 'age recovery identity');
  if ((identity.mode & 0o077) !== 0) throw new BackupError('BACKUP_AGE_EXECUTABLE_INVALID', 'age recovery identity permissions must be 0600 or stricter.');
  return runAgeFileOperation(input, ['--decrypt', '--identity', input.identityPath], 'BACKUP_DECRYPTION_FAILED');
}
