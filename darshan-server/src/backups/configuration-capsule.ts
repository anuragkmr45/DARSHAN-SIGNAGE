import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { attachAbortTermination } from './abortable-process.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DECIMAL_BYTES_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECEIPT_BYTES = 1024 * 1024;

const receiptEntrySchema = z.object({
  logical_name: z.string().min(1).max(160),
  relative_path: z.string().min(1).max(512),
  size_bytes: z.string().regex(DECIMAL_BYTES_PATTERN),
  sha256: z.string().regex(SHA256_PATTERN),
}).strict();

const receiptSchema = z.object({
  version: z.literal(1),
  helper_version: z.string().min(1).max(100),
  site_id: z.string().regex(SITE_ID_PATTERN),
  run_id: z.string().regex(UUID_PATTERN),
  attempt_id: z.string().regex(UUID_PATTERN),
  capsule_generation: z.string().min(1).max(160),
  created_at: z.string().datetime({ offset: true }),
  entries: z.array(receiptEntrySchema).max(512),
}).strict();

export type ConfigurationCapsuleReceipt = z.infer<typeof receiptSchema>;

export interface ConfigurationCapsuleContractEntry {
  logicalName: string;
  required: boolean;
  maxBytes: bigint;
}

export class ConfigurationCapsuleError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigurationCapsuleError';
  }
}

function assertSafeRelativePath(value: string): void {
  if (!value || value.startsWith('/') || value.includes('\\') ||
      value.split('/').some((part) => !part || part === '.' || part === '..') ||
      Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      })) {
    throw new ConfigurationCapsuleError(
      'BACKUP_CAPSULE_UNSAFE_PATH',
      `Configuration capsule contains an unsafe relative path: ${JSON.stringify(value)}`
    );
  }
}

async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  const abort = () => stream.destroy(signal?.reason instanceof Error ? signal.reason : new Error('Capsule verification aborted.'));
  signal?.throwIfAborted();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      hash.update(chunk);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  return hash.digest('hex');
}

async function assertPinnedHelper(path: string, expectedSha256: string): Promise<void> {
  if (!isAbsolute(path) || !SHA256_PATTERN.test(expectedSha256)) {
    throw new ConfigurationCapsuleError(
      'BACKUP_CAPSULE_HELPER_INVALID',
      'The configuration capsule helper requires an absolute path and pinned SHA-256.'
    );
  }
  const link = await fs.lstat(path).catch((error) => {
    throw new ConfigurationCapsuleError(
      'BACKUP_CAPSULE_HELPER_MISSING',
      'The configuration capsule helper is not available.',
      { cause: error }
    );
  });
  if (link.isSymbolicLink() || !link.isFile() || (link.mode & 0o022) !== 0) {
    throw new ConfigurationCapsuleError(
      'BACKUP_CAPSULE_HELPER_UNTRUSTED',
      'The configuration capsule helper must be a non-writable regular file and not a symbolic link.'
    );
  }
  const actual = await sha256File(path);
  if (actual !== expectedSha256) {
    throw new ConfigurationCapsuleError(
      'BACKUP_CAPSULE_HELPER_HASH_MISMATCH',
      'The configuration capsule helper does not match its pinned SHA-256.'
    );
  }
}

async function inventoryConfigurationCapsuleTree(input: {
  root: string;
  expectedFiles: ReadonlySet<string>;
  expectedDirectories: ReadonlySet<string>;
  signal?: AbortSignal;
}): Promise<Map<string, Awaited<ReturnType<typeof fs.lstat>>>> {
  const files = new Map<string, Awaited<ReturnType<typeof fs.lstat>>>();

  const visit = async (directory: string): Promise<void> => {
    input.signal?.throwIfAborted();
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      input.signal?.throwIfAborted();
      const path = resolve(directory, entry.name);
      const relativePath = relative(input.root, path).split(sep).join('/');
      assertSafeRelativePath(relativePath);
      if (path === input.root || !path.startsWith(`${input.root}${sep}`)) {
        throw new ConfigurationCapsuleError('BACKUP_CAPSULE_UNSAFE_PATH', 'Capsule tree escaped its owned destination.');
      }

      const details = await fs.lstat(path);
      if (details.isSymbolicLink()) {
        throw new ConfigurationCapsuleError(
          'BACKUP_CAPSULE_ENTRY_INVALID',
          `The configuration capsule contains a symbolic link: ${relativePath}`
        );
      }
      if (details.isDirectory()) {
        if (!input.expectedDirectories.has(relativePath) || (details.mode & 0o077) !== 0) {
          throw new ConfigurationCapsuleError(
            'BACKUP_CAPSULE_UNEXPECTED_ENTRY',
            `The configuration capsule contains an undeclared or unprotected directory: ${relativePath}`
          );
        }
        await visit(path);
        continue;
      }
      if (!details.isFile() || !input.expectedFiles.has(relativePath)) {
        throw new ConfigurationCapsuleError(
          'BACKUP_CAPSULE_UNEXPECTED_ENTRY',
          `The configuration capsule contains an undeclared or unsupported entry: ${relativePath}`
        );
      }
      files.set(relativePath, details);
    }
  };

  await visit(input.root);
  return files;
}

export async function validateConfigurationCapsule(input: {
  destinationRoot: string;
  receipt: unknown;
  expectedSiteId: string;
  expectedRunId: string;
  expectedAttemptId: string;
  expectedHelperVersion: string;
  contract: readonly ConfigurationCapsuleContractEntry[];
  signal?: AbortSignal;
}): Promise<{ receipt: ConfigurationCapsuleReceipt; totalBytes: bigint }> {
  const parsed = receiptSchema.safeParse(input.receipt);
  if (!parsed.success) {
    throw new ConfigurationCapsuleError(
      'BACKUP_CAPSULE_RECEIPT_INVALID',
      `The configuration capsule helper returned an invalid receipt: ${parsed.error.issues[0]?.message ?? 'unknown error'}`
    );
  }
  const receipt = parsed.data;
  if (receipt.site_id !== input.expectedSiteId || receipt.run_id !== input.expectedRunId ||
      receipt.attempt_id !== input.expectedAttemptId || receipt.helper_version !== input.expectedHelperVersion) {
    throw new ConfigurationCapsuleError(
      'BACKUP_CAPSULE_IDENTITY_MISMATCH',
      'The configuration capsule receipt does not match this site, run, attempt, or helper version.'
    );
  }

  const contract = new Map<string, ConfigurationCapsuleContractEntry>();
  for (const entry of input.contract) {
    if (contract.has(entry.logicalName) || entry.maxBytes < 0n) {
      throw new TypeError(`Invalid duplicate or negative configuration capsule contract entry: ${entry.logicalName}`);
    }
    contract.set(entry.logicalName, entry);
  }

  const root = resolve(input.destinationRoot);
  const rootLink = await fs.lstat(root);
  if (rootLink.isSymbolicLink() || !rootLink.isDirectory() || (rootLink.mode & 0o077) !== 0) {
    throw new ConfigurationCapsuleError(
      'BACKUP_CAPSULE_DESTINATION_INVALID',
      'The configuration capsule destination must be an owned non-symlink directory.'
    );
  }
  const declaredLogical = new Set(receipt.entries.map((entry) => entry.logical_name));
  for (const entry of contract.values()) {
    if (entry.required && !declaredLogical.has(entry.logicalName)) {
      throw new ConfigurationCapsuleError(
        'BACKUP_CAPSULE_REQUIRED_ENTRY_MISSING',
        `The configuration capsule is missing required entry ${entry.logicalName}.`
      );
    }
  }
  const seenLogical = new Set<string>();
  const seenPaths = new Set<string>();
  const expectedDirectories = new Set<string>();
  for (const entry of receipt.entries) {
    assertSafeRelativePath(entry.relative_path);
    const segments = entry.relative_path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join('/'));
    }
  }
  const onDiskFiles = await inventoryConfigurationCapsuleTree({
    root,
    expectedFiles: new Set(receipt.entries.map((entry) => entry.relative_path)),
    expectedDirectories,
    signal: input.signal,
  });
  let totalBytes = 0n;
  for (const entry of receipt.entries) {
    input.signal?.throwIfAborted();
    assertSafeRelativePath(entry.relative_path);
    if (seenLogical.has(entry.logical_name) || seenPaths.has(entry.relative_path)) {
      throw new ConfigurationCapsuleError(
        'BACKUP_CAPSULE_DUPLICATE_ENTRY',
        'The configuration capsule receipt contains a duplicate logical name or path.'
      );
    }
    seenLogical.add(entry.logical_name);
    seenPaths.add(entry.relative_path);
    const expected = contract.get(entry.logical_name);
    if (!expected) {
      throw new ConfigurationCapsuleError(
        'BACKUP_CAPSULE_UNEXPECTED_ENTRY',
        `The configuration capsule contains an unapproved logical entry: ${entry.logical_name}`
      );
    }
    const size = BigInt(entry.size_bytes);
    if (size > expected.maxBytes) {
      throw new ConfigurationCapsuleError(
        'BACKUP_CAPSULE_ENTRY_TOO_LARGE',
        `The configuration capsule entry exceeds its approved size: ${entry.logical_name}`
      );
    }
    const path = resolve(root, entry.relative_path);
    if (path === root || !path.startsWith(`${root}${sep}`) || relative(root, path).startsWith('..')) {
      throw new ConfigurationCapsuleError('BACKUP_CAPSULE_UNSAFE_PATH', 'Capsule entry escaped its owned destination.');
    }
    const details = onDiskFiles.get(entry.relative_path);
    if (!details) {
      throw new ConfigurationCapsuleError(
        'BACKUP_CAPSULE_ENTRY_MISSING',
        `The configuration capsule helper omitted ${entry.logical_name}.`
      );
    }
    if (details.size.toString() !== entry.size_bytes || (Number(details.mode) & 0o077) !== 0) {
      throw new ConfigurationCapsuleError(
        'BACKUP_CAPSULE_ENTRY_INVALID',
        `The configuration capsule entry is not a protected regular file with the declared size: ${entry.logical_name}`
      );
    }
    if (await sha256File(path, input.signal) !== entry.sha256) {
      throw new ConfigurationCapsuleError(
        'BACKUP_CAPSULE_HASH_MISMATCH',
        `The configuration capsule entry hash does not match its receipt: ${entry.logical_name}`
      );
    }
    totalBytes += size;
  }

  for (const entry of contract.values()) {
    if (entry.required && !seenLogical.has(entry.logicalName)) {
      throw new ConfigurationCapsuleError(
        'BACKUP_CAPSULE_REQUIRED_ENTRY_MISSING',
        `The configuration capsule is missing required entry ${entry.logicalName}.`
      );
    }
  }
  return { receipt, totalBytes };
}

export async function requestConfigurationCapsule(input: {
  helperPath: string;
  expectedHelperVersion: string;
  expectedHelperSha256: string;
  siteId: string;
  runId: string;
  attemptId: string;
  destinationRoot: string;
  /** Canonical repository root; the helper may write only below this tree. */
  allowedDestinationRoot: string;
  contract: readonly ConfigurationCapsuleContractEntry[];
  signal: AbortSignal;
}): Promise<{ receipt: ConfigurationCapsuleReceipt; totalBytes: bigint }> {
  if (!SITE_ID_PATTERN.test(input.siteId) || !UUID_PATTERN.test(input.runId) || !UUID_PATTERN.test(input.attemptId)) {
    throw new ConfigurationCapsuleError('BACKUP_CAPSULE_REQUEST_INVALID', 'Capsule request identity is invalid.');
  }
  input.signal.throwIfAborted();
  await assertPinnedHelper(input.helperPath, input.expectedHelperSha256);
  const allowedRoot = resolve(input.allowedDestinationRoot);
  const destinationRoot = resolve(input.destinationRoot);
  if (destinationRoot === allowedRoot || !destinationRoot.startsWith(`${allowedRoot}${sep}`)) {
    throw new ConfigurationCapsuleError('BACKUP_CAPSULE_UNSAFE_PATH', 'Capsule destination is outside the owned repository attempt.');
  }
  const [realAllowedRoot, realDestinationRoot, destinationStat] = await Promise.all([
    fs.realpath(allowedRoot), fs.realpath(destinationRoot), fs.lstat(destinationRoot),
  ]);
  if (destinationStat.isSymbolicLink() || !destinationStat.isDirectory() ||
      realDestinationRoot === realAllowedRoot || !realDestinationRoot.startsWith(`${realAllowedRoot}${sep}`)) {
    throw new ConfigurationCapsuleError('BACKUP_CAPSULE_UNSAFE_PATH', 'Capsule destination is not an owned non-symlink repository directory.');
  }
  await fs.chmod(destinationRoot, 0o700);

  const child = spawn(input.helperPath, [
    'export',
    '--protocol-version=1',
    `--site-id=${input.siteId}`,
    `--run-id=${input.runId}`,
    `--attempt-id=${input.attemptId}`,
    `--destination=${destinationRoot}`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    detached: process.platform !== 'win32',
  });
  const helperAbort = new AbortController();
  const abortFromCaller = () => helperAbort.abort(input.signal.reason);
  input.signal.addEventListener('abort', abortFromCaller, { once: true });
  if (input.signal.aborted) abortFromCaller();
  const helperTimeout = setTimeout(() => {
    helperAbort.abort(new Error('Configuration capsule helper exceeded its 60 second authority window.'));
  }, 60_000);
  helperTimeout.unref();
  const termination = attachAbortTermination(child, helperAbort.signal);
  const stdout: Buffer[] = [];
  let stdoutBytes = 0;
  let receiptOverflow = false;
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes <= MAX_RECEIPT_BYTES) stdout.push(chunk);
    else if (!receiptOverflow) {
      receiptOverflow = true;
      helperAbort.abort(new Error('Configuration capsule receipt exceeded its byte limit.'));
    }
  });
  // Drain diagnostics without copying possibly sensitive helper output into
  // application errors or structured logs.
  child.stderr?.resume();
  try {
    const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('close', resolveExit);
    });
    input.signal.throwIfAborted();
    if (receiptOverflow || stdoutBytes > MAX_RECEIPT_BYTES) {
      throw new ConfigurationCapsuleError('BACKUP_CAPSULE_RECEIPT_TOO_LARGE', 'Capsule helper receipt exceeded one MiB.');
    }
    if (exitCode !== 0) {
      throw new ConfigurationCapsuleError(
        'BACKUP_CAPSULE_HELPER_FAILED',
        `Configuration capsule helper exited with code ${exitCode}.`
      );
    }
    let receipt: unknown;
    try {
      receipt = JSON.parse(Buffer.concat(stdout).toString('utf8'));
    } catch (error) {
      throw new ConfigurationCapsuleError(
        'BACKUP_CAPSULE_RECEIPT_INVALID',
        'Configuration capsule helper did not return valid JSON.',
        { cause: error }
      );
    }
    return await validateConfigurationCapsule({
      destinationRoot: input.destinationRoot,
      receipt,
      expectedSiteId: input.siteId,
      expectedRunId: input.runId,
      expectedAttemptId: input.attemptId,
      expectedHelperVersion: input.expectedHelperVersion,
      contract: input.contract,
      signal: input.signal,
    });
  } finally {
    clearTimeout(helperTimeout);
    await termination.wait();
    termination.dispose();
    input.signal.removeEventListener('abort', abortFromCaller);
  }
}
