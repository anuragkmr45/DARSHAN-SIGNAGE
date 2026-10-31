import { randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const REPOSITORY_IDENTITY_FORMAT = 'darshan-backup-repository-v1' as const;
export const ATTEMPT_OWNERSHIP_FORMAT = 'darshan-backup-attempt-ownership-v1' as const;
export const REPOSITORY_IDENTITY_FILE = 'repository.json';
export const ATTEMPT_OWNERSHIP_FILE = 'ownership.json';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const MAX_METADATA_BYTES = 64 * 1024;

export type BackupPrerequisiteCode =
  | 'BACKUP_REPOSITORY_MISSING'
  | 'BACKUP_REPOSITORY_NOT_DIRECTORY'
  | 'BACKUP_REPOSITORY_SYMLINK'
  | 'BACKUP_REPOSITORY_NON_CANONICAL'
  | 'BACKUP_REPOSITORY_MOUNT_MISMATCH'
  | 'BACKUP_REPOSITORY_OWNERSHIP_MISMATCH'
  | 'BACKUP_REPOSITORY_INSECURE_MODE'
  | 'BACKUP_REPOSITORY_CAPACITY'
  | 'BACKUP_REPOSITORY_READ_ONLY'
  | 'BACKUP_REPOSITORY_IDENTITY_MISSING'
  | 'BACKUP_REPOSITORY_IDENTITY_INVALID'
  | 'BACKUP_REPOSITORY_IDENTITY_MISMATCH'
  | 'BACKUP_REPOSITORY_CHANGED';

export class BackupPrerequisiteError extends Error {
  constructor(public readonly code: BackupPrerequisiteCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BackupPrerequisiteError';
  }
}

export class RepositorySafetyError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RepositorySafetyError';
  }
}

export interface RepositoryIdentity {
  format: typeof REPOSITORY_IDENTITY_FORMAT;
  site_id: string;
  repository_id: string;
}

export interface AttemptOwnershipReceipt {
  format: typeof ATTEMPT_OWNERSHIP_FORMAT;
  repository_id: string;
  site_id: string;
  run_id: string;
  attempt_id: string;
  capture_id: string;
  capture_generation: number;
  owner_nonce: string;
  created_at: string;
}

export interface LocalRepository {
  readonly root: string;
  readonly identity: RepositoryIdentity;
  readonly deviceId: string;
  readonly inode: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly mode: number;
}

export interface OwnedAttemptDirectory {
  readonly path: string;
  readonly receipt: AttemptOwnershipReceipt;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_METADATA_INVALID', `${label} contains missing or unknown fields.`);
  }
}

function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_METADATA_INVALID', `${label} must be an RFC 4122 UUID.`);
  }
}

function assertSiteId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SITE_ID_PATTERN.test(value)) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_METADATA_INVALID', `${label} must be a canonical site identifier.`);
  }
}

function parseJsonBytes(bytes: Buffer, label: string): unknown {
  if (bytes.length === 0 || bytes.length > MAX_METADATA_BYTES) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_METADATA_INVALID', `${label} has an invalid byte length.`);
  }
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_METADATA_INVALID', `${label} is not valid JSON.`, { cause: error });
  }
}

export function parseRepositoryIdentity(value: unknown): RepositoryIdentity {
  if (!isPlainObject(value)) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_METADATA_INVALID', 'repository.json must contain one JSON object.');
  }
  assertExactKeys(value, ['format', 'site_id', 'repository_id'], 'repository.json');
  if (value.format !== REPOSITORY_IDENTITY_FORMAT) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_FORMAT_UNSUPPORTED', 'repository.json uses an unsupported format.');
  }
  assertSiteId(value.site_id, 'repository.json site_id');
  assertUuid(value.repository_id, 'repository.json repository_id');
  return {
    format: REPOSITORY_IDENTITY_FORMAT,
    site_id: value.site_id,
    repository_id: value.repository_id.toLowerCase(),
  };
}

export function parseAttemptOwnershipReceipt(value: unknown): AttemptOwnershipReceipt {
  if (!isPlainObject(value)) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_INVALID', 'ownership.json must contain one JSON object.');
  }
  assertExactKeys(value, [
    'format', 'repository_id', 'site_id', 'run_id', 'attempt_id', 'capture_id',
    'capture_generation', 'owner_nonce', 'created_at',
  ], 'ownership.json');
  if (value.format !== ATTEMPT_OWNERSHIP_FORMAT) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_UNSUPPORTED', 'ownership.json uses an unsupported format.');
  }
  assertUuid(value.repository_id, 'ownership.json repository_id');
  assertSiteId(value.site_id, 'ownership.json site_id');
  assertUuid(value.run_id, 'ownership.json run_id');
  assertUuid(value.attempt_id, 'ownership.json attempt_id');
  assertUuid(value.capture_id, 'ownership.json capture_id');
  if (!Number.isSafeInteger(value.capture_generation) || Number(value.capture_generation) < 1) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_INVALID', 'ownership.json capture_generation must be a positive safe integer.');
  }
  if (typeof value.owner_nonce !== 'string' || !NONCE_PATTERN.test(value.owner_nonce)) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_INVALID', 'ownership.json owner_nonce is invalid.');
  }
  if (typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) || new Date(value.created_at).toISOString() !== value.created_at) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_INVALID', 'ownership.json created_at must be a canonical ISO timestamp.');
  }
  return {
    format: ATTEMPT_OWNERSHIP_FORMAT,
    repository_id: value.repository_id.toLowerCase(),
    site_id: value.site_id,
    run_id: value.run_id.toLowerCase(),
    attempt_id: value.attempt_id.toLowerCase(),
    capture_id: value.capture_id.toLowerCase(),
    capture_generation: Number(value.capture_generation),
    owner_nonce: value.owner_nonce,
    created_at: value.created_at,
  };
}

export interface ProtectedMetadataReadHooks {
  afterOpen?(path: string): Promise<void>;
  afterRead?(path: string): Promise<void>;
}

export async function readRegularMetadataFile(
  path: string,
  expectedDeviceId: string,
  expectedUid: number,
  expectedGid: number,
  hooks?: ProtectedMetadataReadHooks,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted();
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try { handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new RepositorySafetyError('BACKUP_REPOSITORY_METADATA_UNSAFE', `${path} must not be a symbolic link.`, { cause });
    }
    throw cause;
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.dev.toString() !== expectedDeviceId ||
        Number(before.uid) !== expectedUid || Number(before.gid) !== expectedGid ||
        Number(before.mode & 0o777n) !== 0o600) {
      throw new RepositorySafetyError('BACKUP_REPOSITORY_METADATA_UNSAFE', `${path} must be a protected single-link repository metadata file.`);
    }
    if (before.size < 1n || before.size > BigInt(MAX_METADATA_BYTES)) {
      throw new RepositorySafetyError('BACKUP_REPOSITORY_METADATA_INVALID', `${path} has an invalid metadata length.`);
    }
    await hooks?.afterOpen?.(path);
    const expectedSize = Number(before.size); const chunks: Buffer[] = []; let offset = 0;
    while (offset <= expectedSize) {
      signal?.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(16 * 1024, expectedSize + 1 - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead)); offset += bytesRead;
      if (offset > expectedSize) break;
    }
    await hooks?.afterRead?.(path);
    signal?.throwIfAborted();
    const [after, pathAfter] = await Promise.all([handle.stat({ bigint: true }), fs.lstat(path, { bigint: true })]);
    if (offset !== expectedSize || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== before.nlink ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs ||
        after.uid !== before.uid || after.gid !== before.gid || after.mode !== before.mode ||
        pathAfter.isSymbolicLink() || pathAfter.dev !== before.dev || pathAfter.ino !== before.ino || pathAfter.nlink !== 1n) {
      throw new RepositorySafetyError('BACKUP_REPOSITORY_METADATA_UNSAFE', `${path} changed during protected descriptor read.`);
    }
    return Buffer.concat(chunks, expectedSize);
  } finally { await handle.close(); }
}

async function assertRepositoryRoot(input: {
  root: string;
  expectedDeviceId: string;
  ownerUid: number;
  ownerGid: number;
  minimumFreeBytes: number;
}) {
  if (!isAbsolute(input.root) || resolve(input.root) !== input.root || input.root.endsWith(sep)) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_NON_CANONICAL', 'BACKUP_REPOSITORY_ROOT must be an absolute canonical path without a trailing separator.');
  }
  let linkStat;
  try {
    linkStat = await fs.lstat(input.root, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new BackupPrerequisiteError('BACKUP_REPOSITORY_MISSING', 'BACKUP_REPOSITORY_ROOT does not exist.', { cause: error });
    }
    throw error;
  }
  if (linkStat.isSymbolicLink()) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_SYMLINK', 'BACKUP_REPOSITORY_ROOT must not be a symlink.');
  }
  if (!linkStat.isDirectory()) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_NOT_DIRECTORY', 'BACKUP_REPOSITORY_ROOT must be a directory.');
  }
  if (await fs.realpath(input.root) !== input.root) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_SYMLINK', 'BACKUP_REPOSITORY_ROOT must not traverse symlinked parent directories.');
  }
  const [stat, fileSystem] = await Promise.all([
    fs.stat(input.root, { bigint: true }),
    fs.statfs(input.root, { bigint: true }),
  ]);
  if (stat.dev.toString() !== input.expectedDeviceId) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_MOUNT_MISMATCH', 'BACKUP_REPOSITORY_ROOT mount identity does not match BACKUP_REPOSITORY_DEVICE_ID.');
  }
  if (Number(stat.uid) !== input.ownerUid || Number(stat.gid) !== input.ownerGid) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_OWNERSHIP_MISMATCH', 'BACKUP_REPOSITORY_ROOT ownership does not match the configured uid/gid.');
  }
  const mode = Number(stat.mode & 0o777n);
  if (mode !== 0o700) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_INSECURE_MODE', 'BACKUP_REPOSITORY_ROOT permissions must be exactly 0700.');
  }
  try {
    await fs.access(input.root, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  } catch (error) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_READ_ONLY', 'BACKUP_REPOSITORY_ROOT must be readable and writable by the configured owner.', { cause: error });
  }
  const available = fileSystem.bavail * fileSystem.bsize;
  if (available < BigInt(input.minimumFreeBytes)) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_CAPACITY', `Insufficient free space in BACKUP_REPOSITORY_ROOT: ${available} bytes available.`);
  }
  return { stat, available, mode };
}

/** Packet 1 compatibility preflight. Identity expectations enable Packet 3 marker validation. */
export async function assertLocalBackupRepository(input: {
  root: string;
  expectedDeviceId: string;
  ownerUid: number;
  ownerGid: number;
  minimumFreeBytes: number;
  expectedSiteId?: string;
  expectedRepositoryId?: string;
}) {
  const result = await assertRepositoryRoot(input);
  let identity: RepositoryIdentity | undefined;
  if (input.expectedSiteId !== undefined || input.expectedRepositoryId !== undefined) {
    try {
      const bytes = await readRegularMetadataFile(join(input.root, REPOSITORY_IDENTITY_FILE), result.stat.dev.toString(), input.ownerUid, input.ownerGid);
      identity = parseRepositoryIdentity(parseJsonBytes(bytes, REPOSITORY_IDENTITY_FILE));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BackupPrerequisiteError('BACKUP_REPOSITORY_IDENTITY_MISSING', 'repository.json is missing; the worker never initializes a repository.', { cause: error });
      }
      if (error instanceof BackupPrerequisiteError) throw error;
      throw new BackupPrerequisiteError('BACKUP_REPOSITORY_IDENTITY_INVALID', 'repository.json is invalid or unsafe.', { cause: error });
    }
    if (identity.site_id !== input.expectedSiteId || (input.expectedRepositoryId && identity.repository_id !== input.expectedRepositoryId.toLowerCase())) {
      throw new BackupPrerequisiteError('BACKUP_REPOSITORY_IDENTITY_MISMATCH', 'repository.json does not match the configured site/repository identity.');
    }
  }
  return { deviceId: result.stat.dev.toString(), inode: result.stat.ino.toString(), availableBytes: result.available, mode: result.mode, identity };
}

export async function openLocalRepository(input: {
  root: string;
  expectedDeviceId: string;
  ownerUid: number;
  ownerGid: number;
  minimumFreeBytes: number;
  expectedSiteId: string;
  expectedRepositoryId: string;
}): Promise<LocalRepository> {
  const result = await assertLocalBackupRepository(input);
  if (!result.identity) throw new Error('Repository identity validation unexpectedly produced no identity.');
  return Object.freeze({
    root: input.root,
    identity: result.identity,
    deviceId: result.deviceId,
    inode: result.inode,
    ownerUid: input.ownerUid,
    ownerGid: input.ownerGid,
    mode: result.mode,
  });
}

export async function assertRepositoryStillMatches(repository: LocalRepository, minimumFreeBytes = 0): Promise<void> {
  let reopened: LocalRepository;
  try {
    reopened = await openLocalRepository({
      root: repository.root,
      expectedDeviceId: repository.deviceId,
      ownerUid: repository.ownerUid,
      ownerGid: repository.ownerGid,
      minimumFreeBytes,
      expectedSiteId: repository.identity.site_id,
      expectedRepositoryId: repository.identity.repository_id,
    });
  } catch (error) {
    if (error instanceof BackupPrerequisiteError) throw error;
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_CHANGED', 'Repository validation changed after preflight.', { cause: error });
  }
  if (reopened.inode !== repository.inode) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_CHANGED', 'Repository inode changed after preflight.');
  }
}

/** Read-only identity recheck for recovery/discovery; never creates or repairs repository paths. */
export async function assertRepositoryIdentityReadonly(repository: LocalRepository): Promise<void> {
  const stat = await fs.lstat(repository.root, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== repository.deviceId ||
      stat.ino.toString() !== repository.inode || Number(stat.uid) !== repository.ownerUid ||
      Number(stat.gid) !== repository.ownerGid || Number(stat.mode & 0o777n) !== 0o700 ||
      await fs.realpath(repository.root) !== repository.root) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_CHANGED', 'Repository identity changed after read-only open.');
  }
  const bytes = await readRegularMetadataFile(
    join(repository.root, REPOSITORY_IDENTITY_FILE), repository.deviceId, repository.ownerUid, repository.ownerGid,
  );
  const identity = parseRepositoryIdentity(parseJsonBytes(bytes, REPOSITORY_IDENTITY_FILE));
  if (identity.site_id !== repository.identity.site_id || identity.repository_id !== repository.identity.repository_id) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_CHANGED', 'Repository marker changed after read-only open.');
  }
}

/** Open an already-provisioned repository without requesting write access or creating paths. */
export async function openLocalRepositoryReadonly(input: {
  root: string; expectedDeviceId: string; ownerUid: number; ownerGid: number;
  expectedSiteId: string; expectedRepositoryId: string;
  metadataReadHooks?: ProtectedMetadataReadHooks;
  signal?: AbortSignal;
}): Promise<LocalRepository> {
  input.signal?.throwIfAborted();
  if (!isAbsolute(input.root) || resolve(input.root) !== input.root || input.root.endsWith(sep)) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_NON_CANONICAL', 'Repository root must be a canonical absolute path.');
  }
  const stat = await fs.lstat(input.root, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || await fs.realpath(input.root) !== input.root) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_SYMLINK', 'Repository root must be an existing non-symlink directory.');
  }
  if (stat.dev.toString() !== input.expectedDeviceId) throw new BackupPrerequisiteError('BACKUP_REPOSITORY_MOUNT_MISMATCH', 'Repository mount identity differs.');
  if (Number(stat.uid) !== input.ownerUid || Number(stat.gid) !== input.ownerGid) throw new BackupPrerequisiteError('BACKUP_REPOSITORY_OWNERSHIP_MISMATCH', 'Repository ownership differs.');
  if (Number(stat.mode & 0o777n) !== 0o700) throw new BackupPrerequisiteError('BACKUP_REPOSITORY_INSECURE_MODE', 'Repository mode must be 0700.');
  await fs.access(input.root, fsConstants.R_OK | fsConstants.X_OK);
  const identity = parseRepositoryIdentity(parseJsonBytes(
    await readRegularMetadataFile(join(input.root, REPOSITORY_IDENTITY_FILE), input.expectedDeviceId, input.ownerUid, input.ownerGid,
      input.metadataReadHooks, input.signal),
    REPOSITORY_IDENTITY_FILE,
  ));
  if (identity.site_id !== input.expectedSiteId || identity.repository_id !== input.expectedRepositoryId.toLowerCase()) {
    throw new BackupPrerequisiteError('BACKUP_REPOSITORY_IDENTITY_MISMATCH', 'Repository marker does not match expected site/repository identity.');
  }
  return Object.freeze({ root: input.root, identity, deviceId: stat.dev.toString(), inode: stat.ino.toString(),
    ownerUid: input.ownerUid, ownerGid: input.ownerGid, mode: 0o700 });
}

/** Resolve and validate an existing private repository directory without mkdir. */
export async function openExistingRepositoryDirectory(repository: LocalRepository, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new RepositorySafetyError('BACKUP_REPOSITORY_PATH_UNSAFE', 'Repository directory name is unsafe.');
  await assertRepositoryIdentityReadonly(repository);
  const path = repositoryPath(repository, name);
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== repository.deviceId ||
      Number(stat.uid) !== repository.ownerUid || Number(stat.gid) !== repository.ownerGid ||
      Number(stat.mode & 0o777n) !== 0o700 || await fs.realpath(path) !== path) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_DIRECTORY_UNSAFE', `${name} is not a protected existing repository directory.`);
  }
  return path;
}

export function repositoryPath(repository: LocalRepository, ...segments: string[]): string {
  const path = resolve(repository.root, ...segments);
  const suffix = relative(repository.root, path);
  if (!suffix || suffix.startsWith(`..${sep}`) || suffix === '..' || isAbsolute(suffix)) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_PATH_UNSAFE', 'Repository path escaped or resolved to the repository root.');
  }
  return path;
}

export async function ensureRepositoryDirectory(repository: LocalRepository, name: 'incomplete' | 'runs' | 'quarantine' | 'broker-authority-recovery' | 'broker-deletions' | 'broker-staging-deletions'): Promise<string> {
  await assertRepositoryStillMatches(repository);
  const path = repositoryPath(repository, name);
  try {
    await fs.mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_DIRECTORY_UNSAFE', `${name} must be a non-symlink directory.`);
  }
  if (stat.dev.toString() !== repository.deviceId) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_CROSS_DEVICE', `${name} must be on the repository filesystem.`);
  }
  if (Number(stat.uid) !== repository.ownerUid || Number(stat.gid) !== repository.ownerGid || Number(stat.mode & 0o777n) !== 0o700) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_DIRECTORY_UNSAFE', `${name} must be owned by the repository owner with mode 0700.`);
  }
  if (await fs.realpath(path) !== path) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_DIRECTORY_UNSAFE', `${name} traverses a symbolic link.`);
  }
  return path;
}

export async function writeExclusiveRepositoryFile(path: string, bytes: Uint8Array, mode = 0o600): Promise<void> {
  const handle = await fs.open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function fsyncDirectory(path: string): Promise<void> {
  const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function createOwnedAttemptDirectory(input: {
  repository: LocalRepository;
  runId: string;
  attemptId: string;
  captureId: string;
  captureGeneration: number;
  createdAt?: Date;
  ownerNonce?: string;
}): Promise<OwnedAttemptDirectory> {
  assertUuid(input.runId, 'runId');
  assertUuid(input.attemptId, 'attemptId');
  assertUuid(input.captureId, 'captureId');
  if (!Number.isSafeInteger(input.captureGeneration) || input.captureGeneration < 1) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_INVALID', 'captureGeneration must be a positive safe integer.');
  }
  const nonce = input.ownerNonce ?? randomBytes(16).toString('hex');
  if (!NONCE_PATTERN.test(nonce)) throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_INVALID', 'ownerNonce is invalid.');
  const incomplete = await ensureRepositoryDirectory(input.repository, 'incomplete');
  const path = join(incomplete, `${input.runId.toLowerCase()}.${input.attemptId.toLowerCase()}.${nonce}`);
  await fs.mkdir(path, { mode: 0o700 });
  const receipt: AttemptOwnershipReceipt = {
    format: ATTEMPT_OWNERSHIP_FORMAT,
    repository_id: input.repository.identity.repository_id,
    site_id: input.repository.identity.site_id,
    run_id: input.runId.toLowerCase(),
    attempt_id: input.attemptId.toLowerCase(),
    capture_id: input.captureId.toLowerCase(),
    capture_generation: input.captureGeneration,
    owner_nonce: nonce,
    created_at: (input.createdAt ?? new Date()).toISOString(),
  };
  try {
    await writeExclusiveRepositoryFile(join(path, ATTEMPT_OWNERSHIP_FILE), Buffer.from(`${JSON.stringify(receipt)}\n`));
    await fsyncDirectory(path);
    await fsyncDirectory(incomplete);
    return { path, receipt };
  } catch (error) {
    await fs.rm(path, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readAttemptOwnership(repository: LocalRepository, attemptPath: string): Promise<AttemptOwnershipReceipt> {
  const parent = await ensureRepositoryDirectory(repository, 'incomplete');
  if (dirname(attemptPath) !== parent) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_INVALID', 'Attempt directory is not a direct incomplete child.');
  }
  const directory = await fs.lstat(attemptPath, { bigint: true });
  if (directory.isSymbolicLink() || !directory.isDirectory() || directory.dev.toString() !== repository.deviceId) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_INVALID', 'Attempt directory is unsafe or cross-device.');
  }
  if (Number(directory.uid) !== repository.ownerUid || Number(directory.gid) !== repository.ownerGid || Number(directory.mode & 0o777n) !== 0o700) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_INVALID', 'Attempt directory ownership or mode is invalid.');
  }
  const bytes = await readRegularMetadataFile(join(attemptPath, ATTEMPT_OWNERSHIP_FILE), repository.deviceId, repository.ownerUid, repository.ownerGid);
  const receipt = parseAttemptOwnershipReceipt(parseJsonBytes(bytes, ATTEMPT_OWNERSHIP_FILE));
  if (receipt.repository_id !== repository.identity.repository_id || receipt.site_id !== repository.identity.site_id) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_MISMATCH', 'Attempt ownership belongs to another repository or site.');
  }
  const expectedName = `${receipt.run_id}.${receipt.attempt_id}.${receipt.owner_nonce}`;
  if (attemptPath !== join(parent, expectedName)) {
    throw new RepositorySafetyError('BACKUP_ATTEMPT_OWNERSHIP_MISMATCH', 'Attempt directory name does not match ownership.json.');
  }
  return receipt;
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}
