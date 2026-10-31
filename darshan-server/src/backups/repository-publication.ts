import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import {
  type AttemptOwnershipReceipt,
  type LocalRepository,
  RepositorySafetyError,
  assertRepositoryStillMatches,
  assertRepositoryIdentityReadonly,
  openExistingRepositoryDirectory,
  ensureRepositoryDirectory,
  fsyncDirectory,
  isSha256,
  readAttemptOwnership,
  writeExclusiveRepositoryFile,
} from './local-repository';
import { canonicalJson, parseStrictJson } from './backup-broker-protocol';
import { policySha256, type SignedConfigurationCapsulePolicy } from './configuration-capsule-policy';
import { parseBackupManifest, type BackupManifestV1 } from './manifest';

export const PUBLICATION_INTENT_FORMAT = 'darshan-backup-publication-intent-v1' as const;
export const PUBLICATION_RECEIPT_FORMAT = 'darshan-backup-publication-receipt-v1' as const;
export const PUBLICATION_INTENT_FILE = 'publication-intent.json';
export const PUBLICATION_RECEIPT_FILE = 'publication-receipt.json';
export const REPOSITORY_MANIFEST_FILE = 'manifest.json';
export const CONFIGURATION_POLICY_FILE = 'configuration-policy.json';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_BYTES_PATTERN = /^(?:0|[1-9][0-9]{0,39})$/;

export interface RepositoryManifestArtifactView {
  path: string;
  size: string;
  sha256: string;
}

/** A deliberately small interface; the manifest module owns full schema validation. */
export interface RepositoryManifestView {
  repository_id: string;
  site_id: string;
  run_id: string;
  attempt_id: string;
  capture_id: string;
  capture_generation: number;
  artifacts: readonly RepositoryManifestArtifactView[];
}

/** Adapts the full manifest without reimplementing its parser or validator. */
export function repositoryManifestViewFromBackupManifest(
  manifest: BackupManifestV1,
): RepositoryManifestView {
  const captureGeneration = Number(manifest.capture.generation);
  if (!Number.isSafeInteger(captureGeneration) || captureGeneration < 1) {
    throw new RepositorySafetyError('BACKUP_MANIFEST_INVALID', 'Manifest capture generation is outside the supported range.');
  }
  return validateManifestView({
    repository_id: manifest.repository.id,
    site_id: manifest.site.id,
    run_id: manifest.run.id,
    attempt_id: manifest.run.attemptId,
    capture_id: manifest.capture.id,
    capture_generation: captureGeneration,
    artifacts: manifest.artifacts.map((artifact) => ({
      path: artifact.ciphertextPath,
      size: artifact.ciphertextSizeBytes,
      sha256: artifact.ciphertextSha256,
    })),
  });
}

export interface PublicationIntent extends RepositoryManifestView {
  format: typeof PUBLICATION_INTENT_FORMAT;
  manifest_sha256: string;
  created_at: string;
  artifacts: RepositoryManifestArtifactView[];
}

export interface PublicationReceipt {
  format: typeof PUBLICATION_RECEIPT_FORMAT;
  repository_id: string;
  site_id: string;
  run_id: string;
  attempt_id: string;
  capture_id: string;
  capture_generation: number;
  manifest_sha256: string;
  published_at: string;
  verified_at: string;
}

export type PublicationFaultPoint =
  | 'before-manifest-fsync'
  | 'after-manifest-fsync'
  | 'before-intent-fsync'
  | 'after-intent-fsync'
  | 'before-source-fsync'
  | 'after-source-fsync'
  | 'before-rename'
  | 'after-rename'
  | 'before-receipt-fsync'
  | 'after-receipt-fsync'
  | 'before-readback'
  | 'after-readback';

export interface PublicationOperations {
  fsyncFile(path: string): Promise<void>;
  fsyncDirectory(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  fault(point: PublicationFaultPoint): Promise<void>;
}

export interface PublishedRunVerification {
  runPath: string;
  manifestBytes: Buffer;
  intent: PublicationIntent;
  receipt: PublicationReceipt | null;
  artifactBytes: bigint;
  configurationPolicy?: {
    bytes: Buffer;
    sha256: string;
    capsuleGeneration: string;
    encryptedInventorySha256: string;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', `${label} contains missing or unknown fields.`);
  }
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', `${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', `${label} must be an RFC 4122 UUID.`);
  }
  return value.toLowerCase();
}

export function validateArtifactPath(value: string): string {
  if (!value || value.length > 1024 || isAbsolute(value) || value.includes('\\') || value.includes('\0')) {
    throw new RepositorySafetyError('BACKUP_MANIFEST_PATH_UNSAFE', `Unsafe artifact path: ${JSON.stringify(value)}.`);
  }
  if (posix.normalize(value) !== value || value === '.' || value.startsWith('../') || value.includes('/../') || value.endsWith('/')) {
    throw new RepositorySafetyError('BACKUP_MANIFEST_PATH_UNSAFE', `Unsafe artifact path: ${JSON.stringify(value)}.`);
  }
  return value;
}

export function validateManifestView(view: RepositoryManifestView): RepositoryManifestView {
  uuid(view.repository_id, 'manifest repository_id');
  if (typeof view.site_id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(view.site_id)) {
    throw new RepositorySafetyError('BACKUP_MANIFEST_INVALID', 'Manifest site_id is invalid.');
  }
  uuid(view.run_id, 'manifest run_id');
  uuid(view.attempt_id, 'manifest attempt_id');
  uuid(view.capture_id, 'manifest capture_id');
  if (!Number.isSafeInteger(view.capture_generation) || view.capture_generation < 1 || !Array.isArray(view.artifacts)) {
    throw new RepositorySafetyError('BACKUP_MANIFEST_INVALID', 'Manifest capture generation or artifacts are invalid.');
  }
  const names = new Set<string>();
  for (const artifact of view.artifacts) {
    validateArtifactPath(artifact.path);
    if (names.has(artifact.path)) throw new RepositorySafetyError('BACKUP_MANIFEST_INVALID', `Duplicate artifact path: ${artifact.path}.`);
    names.add(artifact.path);
    if (!DECIMAL_BYTES_PATTERN.test(artifact.size) || !isSha256(artifact.sha256)) {
      throw new RepositorySafetyError('BACKUP_MANIFEST_INVALID', `Invalid size or SHA-256 for artifact ${artifact.path}.`);
    }
  }
  return view;
}

function parseArtifact(value: unknown): RepositoryManifestArtifactView {
  if (!isPlainObject(value)) throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', 'Publication artifact must be an object.');
  exactKeys(value, ['path', 'size', 'sha256'], 'Publication artifact');
  if (typeof value.path !== 'string' || typeof value.size !== 'string' || typeof value.sha256 !== 'string') {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', 'Publication artifact fields must be strings.');
  }
  const artifact = { path: validateArtifactPath(value.path), size: value.size, sha256: value.sha256 };
  validateManifestView({
    repository_id: '00000000-0000-4000-8000-000000000000',
    site_id: 'validation',
    run_id: '00000000-0000-4000-8000-000000000000',
    attempt_id: '00000000-0000-4000-8000-000000000000',
    capture_id: '00000000-0000-4000-8000-000000000000',
    capture_generation: 1,
    artifacts: [artifact],
  });
  return artifact;
}

export function parsePublicationIntent(value: unknown): PublicationIntent {
  if (!isPlainObject(value)) throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', 'Publication intent must be an object.');
  exactKeys(value, [
    'format', 'repository_id', 'site_id', 'run_id', 'attempt_id', 'capture_id', 'capture_generation',
    'manifest_sha256', 'created_at', 'artifacts',
  ], 'Publication intent');
  if (value.format !== PUBLICATION_INTENT_FORMAT || !isSha256(value.manifest_sha256) || !Array.isArray(value.artifacts)) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', 'Publication intent format, hash, or artifacts are invalid.');
  }
  const intent: PublicationIntent = {
    format: PUBLICATION_INTENT_FORMAT,
    repository_id: uuid(value.repository_id, 'intent repository_id'),
    site_id: typeof value.site_id === 'string' ? value.site_id : '',
    run_id: uuid(value.run_id, 'intent run_id'),
    attempt_id: uuid(value.attempt_id, 'intent attempt_id'),
    capture_id: uuid(value.capture_id, 'intent capture_id'),
    capture_generation: Number(value.capture_generation),
    manifest_sha256: value.manifest_sha256,
    created_at: canonicalTimestamp(value.created_at, 'intent created_at'),
    artifacts: value.artifacts.map(parseArtifact),
  };
  validateManifestView(intent);
  return intent;
}

export function parsePublicationReceipt(value: unknown): PublicationReceipt {
  if (!isPlainObject(value)) throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', 'Publication receipt must be an object.');
  exactKeys(value, [
    'format', 'repository_id', 'site_id', 'run_id', 'attempt_id', 'capture_id', 'capture_generation',
    'manifest_sha256', 'published_at', 'verified_at',
  ], 'Publication receipt');
  if (value.format !== PUBLICATION_RECEIPT_FORMAT || !isSha256(value.manifest_sha256)) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', 'Publication receipt format or hash is invalid.');
  }
  const receipt: PublicationReceipt = {
    format: PUBLICATION_RECEIPT_FORMAT,
    repository_id: uuid(value.repository_id, 'receipt repository_id'),
    site_id: typeof value.site_id === 'string' ? value.site_id : '',
    run_id: uuid(value.run_id, 'receipt run_id'),
    attempt_id: uuid(value.attempt_id, 'receipt attempt_id'),
    capture_id: uuid(value.capture_id, 'receipt capture_id'),
    capture_generation: Number(value.capture_generation),
    manifest_sha256: value.manifest_sha256,
    published_at: canonicalTimestamp(value.published_at, 'receipt published_at'),
    verified_at: canonicalTimestamp(value.verified_at, 'receipt verified_at'),
  };
  validateManifestView({ ...receipt, artifacts: [] });
  return receipt;
}

async function fsyncFile(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try { handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_FILE_UNSAFE', 'Published artifact is a symbolic link.', { cause: error });
    }
    throw error;
  }
  try { await handle.sync(); } finally { await handle.close(); }
}

const defaultOperations: PublicationOperations = {
  fsyncFile,
  fsyncDirectory,
  async rename(source, destination) { await fs.rename(source, destination); },
  async fault() { /* intentional test seam */ },
};

function operations(overrides?: Partial<PublicationOperations>): PublicationOperations {
  return { ...defaultOperations, ...overrides };
}

async function hashRegularFile(path: string, repository: LocalRepository, signal?: AbortSignal): Promise<{ sha256: string; size: bigint }> {
  signal?.throwIfAborted();
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try { handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_FILE_UNSAFE', 'Published artifact is a symbolic link.', { cause: error });
    }
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev.toString() !== repository.deviceId ||
        Number(before.uid) !== repository.ownerUid || Number(before.gid) !== repository.ownerGid ||
        Number(before.mode & 0o777n) !== 0o600 || before.nlink !== 1n) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_FILE_UNSAFE', 'Published artifact is not a protected single-link regular file.');
    }
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_FILE_UNSAFE', 'Published artifact exceeds the bounded read-back range.');
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    for (;;) {
      signal?.throwIfAborted();
      const remainingWithSentinel = Number(before.size) + 1 - offset;
      if (remainingWithSentinel <= 0) throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', 'Published artifact exceeded its opened size.');
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, remainingWithSentinel), offset);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
      if (offset > Number(before.size)) throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', 'Published artifact grew during read-back.');
    }
    const after = await handle.stat({ bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mode !== before.mode || after.uid !== before.uid || after.gid !== before.gid || after.nlink !== before.nlink ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || BigInt(offset) !== before.size) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', 'Published artifact identity changed during read-back.');
    }
    return { sha256: hash.digest('hex'), size: before.size };
  } finally { await handle.close(); }
}

export async function readProtectedRepositoryFile(path: string, repository: LocalRepository, maximumBytes: number, signal?: AbortSignal): Promise<{ bytes: Buffer; sha256: string; size: bigint }> {
  signal?.throwIfAborted();
  const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev.toString() !== repository.deviceId || Number(before.uid) !== repository.ownerUid ||
        Number(before.gid) !== repository.ownerGid || Number(before.mode & 0o777n) !== 0o600 || before.nlink !== 1n ||
        before.size < 1n || before.size > BigInt(maximumBytes)) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_FILE_UNSAFE', `${path} is not a protected bounded repository file.`);
    }
    const expectedSize = Number(before.size); const chunks: Buffer[] = []; let offset = 0;
    while (offset <= expectedSize) {
      signal?.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, expectedSize + 1 - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead)); offset += bytesRead;
      if (offset > expectedSize) break;
    }
    const bytes = Buffer.concat(chunks, Math.min(offset, expectedSize)); signal?.throwIfAborted();
    const [after, pathAfter] = await Promise.all([handle.stat({ bigint: true }), fs.lstat(path, { bigint: true })]);
    if (offset !== expectedSize || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mode !== before.mode || after.uid !== before.uid || after.gid !== before.gid || after.nlink !== before.nlink ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || BigInt(bytes.byteLength) !== before.size ||
        pathAfter.isSymbolicLink() || pathAfter.dev !== before.dev || pathAfter.ino !== before.ino || pathAfter.nlink !== 1n) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', `${path} changed during protected read-back.`);
    }
    return { bytes, size: before.size, sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally { await handle.close(); }
}

async function verifyArtifacts(repository: LocalRepository, root: string, artifacts: readonly RepositoryManifestArtifactView[], signal?: AbortSignal): Promise<bigint> {
  let total = 0n;
  for (const artifact of artifacts) {
    const path = resolve(root, ...artifact.path.split('/'));
    const suffix = relative(root, path);
    if (suffix.startsWith(`..${sep}`) || suffix === '..' || isAbsolute(suffix)) {
      throw new RepositorySafetyError('BACKUP_MANIFEST_PATH_UNSAFE', `Artifact path escaped publication: ${artifact.path}.`);
    }
    signal?.throwIfAborted();
    const actual = await hashRegularFile(path, repository, signal);
    if (actual.size.toString() !== artifact.size || actual.sha256 !== artifact.sha256) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', `Artifact read-back failed for ${artifact.path}.`);
    }
    total += actual.size;
  }
  return total;
}

async function fsyncTree(root: string, repository: LocalRepository, ops: PublicationOperations, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const stat = await fs.lstat(root, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== repository.deviceId) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_DIRECTORY_UNSAFE', `${root} is not a safe same-filesystem directory.`);
  }
  if (Number(stat.uid) !== repository.ownerUid || Number(stat.gid) !== repository.ownerGid || Number(stat.mode & 0o777n) !== 0o700) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_DIRECTORY_UNSAFE', `${root} must be owned by the repository owner with mode 0700.`);
  }
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new RepositorySafetyError('BACKUP_PUBLICATION_FILE_UNSAFE', `${path} is a symbolic link.`);
    if (entry.isDirectory()) await fsyncTree(path, repository, ops, signal);
    else if (entry.isFile()) {
      await hashRegularFile(path, repository, signal);
      await ops.fsyncFile(path);
    } else throw new RepositorySafetyError('BACKUP_PUBLICATION_FILE_UNSAFE', `${path} is a special file.`);
  }
  await ops.fsyncDirectory(root);
}

function assertIdentityMatches(ownership: AttemptOwnershipReceipt, view: RepositoryManifestView): void {
  const fields = [
    ['repository_id', ownership.repository_id, view.repository_id.toLowerCase()],
    ['site_id', ownership.site_id, view.site_id],
    ['run_id', ownership.run_id, view.run_id.toLowerCase()],
    ['attempt_id', ownership.attempt_id, view.attempt_id.toLowerCase()],
    ['capture_id', ownership.capture_id, view.capture_id.toLowerCase()],
    ['capture_generation', ownership.capture_generation, view.capture_generation],
  ] as const;
  const mismatch = fields.find(([, left, right]) => left !== right);
  if (mismatch) throw new RepositorySafetyError('BACKUP_PUBLICATION_IDENTITY_MISMATCH', `Manifest ${mismatch[0]} does not match attempt ownership.`);
}

function sameProtocolIdentity(left: PublicationIntent, right: PublicationReceipt): boolean {
  return left.repository_id === right.repository_id && left.site_id === right.site_id && left.run_id === right.run_id
    && left.attempt_id === right.attempt_id && left.capture_id === right.capture_id
    && left.capture_generation === right.capture_generation && left.manifest_sha256 === right.manifest_sha256;
}

async function readProtectedProtocolJson(path: string, repository: LocalRepository, signal?: AbortSignal): Promise<unknown> {
  const file = await readProtectedRepositoryFile(path, repository, 1024 * 1024, signal);
  try {
    const value = parseStrictJson(file.bytes, 1024 * 1024);
    if (!canonicalJson(value).equals(file.bytes)) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', `${path} is not canonical protocol JSON.`);
    }
    return value;
  } catch (cause) {
    if (cause instanceof RepositorySafetyError) throw cause;
    throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', `${path} is not strict canonical JSON.`, { cause });
  }
}

async function writeOrVerifyExactFile(path: string, bytes: Uint8Array): Promise<void> {
  try { await writeExclusiveRepositoryFile(path, bytes); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!(await fs.readFile(path)).equals(Buffer.from(bytes))) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_INTENT_CONFLICT', `${path} already has different bytes.`, { cause: error });
    }
  }
}

function sameIntent(left: PublicationIntent, right: PublicationIntent): boolean {
  return left.repository_id === right.repository_id && left.site_id === right.site_id && left.run_id === right.run_id
    && left.attempt_id === right.attempt_id && left.capture_id === right.capture_id
    && left.capture_generation === right.capture_generation && left.manifest_sha256 === right.manifest_sha256
    && JSON.stringify(left.artifacts) === JSON.stringify(right.artifacts);
}

type PublishedRunDirectoryIdentity = { dev: bigint; ino: bigint; uid: bigint; gid: bigint; mode: bigint };

export async function assertPublishedRunDirectory(
  path: string,
  repository: LocalRepository,
): Promise<PublishedRunDirectoryIdentity> {
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== repository.deviceId ||
      Number(stat.uid) !== repository.ownerUid || Number(stat.gid) !== repository.ownerGid ||
      Number(stat.mode & 0o777n) !== 0o700 || await fs.realpath(path) !== path) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_DIRECTORY_UNSAFE', 'Published run must be canonical, repository-owned, mode 0700, and on the repository filesystem.');
  }
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid, mode: stat.mode };
}

async function assertPublishedRunDirectoryStable(
  path: string,
  repository: LocalRepository,
  expected: PublishedRunDirectoryIdentity,
): Promise<void> {
  const actual = await assertPublishedRunDirectory(path, repository);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino || actual.uid !== expected.uid ||
      actual.gid !== expected.gid || actual.mode !== expected.mode) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_DIRECTORY_UNSAFE', 'Published run directory identity changed during verification.');
  }
}

export async function readAndVerifyPublishedRun(input: {
  repository: LocalRepository;
  runId: string;
  requireReceipt?: boolean;
  signal?: AbortSignal;
  trustedConfigurationPolicy?: SignedConfigurationCapsulePolicy;
}): Promise<PublishedRunVerification> {
  input.signal?.throwIfAborted();
  await assertRepositoryIdentityReadonly(input.repository);
  const runs = await openExistingRepositoryDirectory(input.repository, 'runs');
  const runPath = join(runs, uuid(input.runId, 'runId'));
  const openedRun = await assertPublishedRunDirectory(runPath, input.repository);
  const intent = parsePublicationIntent(await readProtectedProtocolJson(join(runPath, PUBLICATION_INTENT_FILE), input.repository, input.signal));
  if (intent.repository_id !== input.repository.identity.repository_id || intent.site_id !== input.repository.identity.site_id || intent.run_id !== input.runId.toLowerCase()) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_IDENTITY_MISMATCH', 'Published run does not belong to this repository/site/path.');
  }
  const manifestPath = join(runPath, REPOSITORY_MANIFEST_FILE);
  const manifest = await readProtectedRepositoryFile(manifestPath, input.repository, 1024 * 1024, input.signal);
  if (manifest.sha256 !== intent.manifest_sha256) throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', 'Published manifest hash does not match the intent.');
  const parsedManifest = parseBackupManifest(manifest.bytes);
  if (parsedManifest.signature === null || parsedManifest.repository.id !== intent.repository_id || parsedManifest.site.id !== intent.site_id ||
      parsedManifest.run.id !== intent.run_id || parsedManifest.run.attemptId !== intent.attempt_id ||
      parsedManifest.capture.id !== intent.capture_id || Number(parsedManifest.capture.generation) !== intent.capture_generation) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_IDENTITY_MISMATCH', 'Signed manifest identity does not match publication intent.');
  }
  const signedArtifacts = parsedManifest.artifacts.map((artifact) => ({
    path: artifact.ciphertextPath, size: artifact.ciphertextSizeBytes, sha256: artifact.ciphertextSha256,
  }));
  if (JSON.stringify(signedArtifacts) !== JSON.stringify(intent.artifacts)) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', 'Publication intent artifacts do not exactly match the signed manifest descriptors.');
  }
  let configurationPolicy: PublishedRunVerification['configurationPolicy'];
  if (input.trustedConfigurationPolicy) {
    const expectedPolicyBytes = canonicalJson(input.trustedConfigurationPolicy);
    const expectedPolicySha256 = policySha256(input.trustedConfigurationPolicy);
    const policyPath = join(runPath, CONFIGURATION_POLICY_FILE);
    const policyFile = await readProtectedRepositoryFile(policyPath, input.repository, 1024 * 1024, input.signal);
    if (policyFile.size !== BigInt(expectedPolicyBytes.byteLength) || policyFile.sha256 !== expectedPolicySha256) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', 'Published configuration policy size or digest does not match the externally trusted policy.');
    }
    const policyBytes = policyFile.bytes;
    if (!policyBytes.equals(expectedPolicyBytes)) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', 'Published configuration policy bytes do not match the externally trusted signed policy.');
    }
    const binding = parsedManifest.configurationPolicy;
    const trustedPolicy = input.trustedConfigurationPolicy.policy;
    if (parsedManifest.version !== 2 || parsedManifest.signature === null || !binding ||
        binding.policySha256 !== expectedPolicySha256 || binding.capsuleGeneration !== trustedPolicy.generation ||
        binding.encryptedInventorySha256 !== trustedPolicy.encrypted_inventory_sha256) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', 'Published manifest does not bind the externally trusted configuration policy.');
    }
    const configurationArtifacts = parsedManifest.artifacts.filter((artifact) => artifact.kind === 'CONFIGURATION');
    if (configurationArtifacts.length !== 1 || configurationArtifacts[0].ciphertextPath !== 'configuration.tar.age' ||
        configurationArtifacts[0].ciphertextSizeBytes !== trustedPolicy.capsule_size_bytes ||
        configurationArtifacts[0].ciphertextSha256 !== trustedPolicy.capsule_sha256) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_READBACK_MISMATCH', 'Published configuration capsule does not match the trusted configuration policy.');
    }
    configurationPolicy = { bytes: policyBytes, sha256: expectedPolicySha256, capsuleGeneration: trustedPolicy.generation,
      encryptedInventorySha256: trustedPolicy.encrypted_inventory_sha256 };
  }
  const artifactBytes = await verifyArtifacts(input.repository, runPath, signedArtifacts, input.signal);
  let receipt: PublicationReceipt | null = null;
  try { receipt = parsePublicationReceipt(await readProtectedProtocolJson(join(runPath, PUBLICATION_RECEIPT_FILE), input.repository, input.signal)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (input.requireReceipt !== false) throw new RepositorySafetyError('BACKUP_PUBLICATION_RECEIPT_MISSING', 'Published run has no durable verification receipt.', { cause: error });
  }
  if (receipt && !sameProtocolIdentity(intent, receipt)) throw new RepositorySafetyError('BACKUP_PUBLICATION_IDENTITY_MISMATCH', 'Publication receipt does not match its intent.');
  await assertPublishedRunDirectoryStable(runPath, input.repository, openedRun);
  return { runPath, manifestBytes: manifest.bytes, intent, receipt, artifactBytes, ...(configurationPolicy ? { configurationPolicy } : {}) };
}

export async function publishRunDirectory(input: {
  repository: LocalRepository;
  attemptPath: string;
  preparedPath: string;
  manifestBytes: Uint8Array;
  manifest: RepositoryManifestView;
  now?: () => Date;
  signal?: AbortSignal;
  operations?: Partial<PublicationOperations>;
  recordIntent?(intent: PublicationIntent): Promise<void>;
  recordReceipt?(receipt: PublicationReceipt): Promise<void>;
  trustedConfigurationPolicy?: SignedConfigurationCapsulePolicy;
}): Promise<PublishedRunVerification> {
  const ops = operations(input.operations);
  input.signal?.throwIfAborted();
  await assertRepositoryStillMatches(input.repository);
  const ownership = await readAttemptOwnership(input.repository, input.attemptPath);
  validateManifestView(input.manifest);
  assertIdentityMatches(ownership, input.manifest);
  const expectedManifestSha256 = createHash('sha256').update(input.manifestBytes).digest('hex');
  const runs = await ensureRepositoryDirectory(input.repository, 'runs');
  const destination = join(runs, ownership.run_id);
  try {
    await fs.lstat(destination);
    const existing = await readAndVerifyPublishedRun({ repository: input.repository, runId: ownership.run_id, requireReceipt: false,
      trustedConfigurationPolicy: input.trustedConfigurationPolicy });
    if (existing.intent.attempt_id !== ownership.attempt_id || existing.intent.capture_id !== ownership.capture_id
        || existing.intent.capture_generation !== ownership.capture_generation || existing.intent.manifest_sha256 !== expectedManifestSha256) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_DESTINATION_EXISTS', `Run ${ownership.run_id} was published by a different immutable attempt.`);
    }
    await input.recordIntent?.(existing.intent);
    if (existing.receipt) {
      await input.recordReceipt?.(existing.receipt);
      return existing;
    }
    return completePublishedRunReceipt({ repository: input.repository, runId: ownership.run_id, now: (input.now ?? (() => new Date()))(), recordReceipt: input.recordReceipt,
      trustedConfigurationPolicy: input.trustedConfigurationPolicy });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (input.preparedPath !== join(input.attemptPath, 'prepared')) {
    throw new RepositorySafetyError('BACKUP_PUBLICATION_PATH_UNSAFE', 'Prepared directory must be the owned attempt prepared child.');
  }
  const preparedStat = await fs.lstat(input.preparedPath, { bigint: true });
  if (!preparedStat.isDirectory() || preparedStat.isSymbolicLink() || preparedStat.dev.toString() !== input.repository.deviceId) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_CROSS_DEVICE', 'Prepared directory is unsafe or cross-device.');
  }
  await verifyArtifacts(input.repository, input.preparedPath, input.manifest.artifacts, input.signal);

  const manifestPath = join(input.preparedPath, REPOSITORY_MANIFEST_FILE);
  await writeOrVerifyExactFile(manifestPath, input.manifestBytes);
  await ops.fault('before-manifest-fsync');
  await ops.fsyncFile(manifestPath);
  await ops.fault('after-manifest-fsync');
  const manifestHash = await hashRegularFile(manifestPath, input.repository);
  const candidateIntent: PublicationIntent = {
    format: PUBLICATION_INTENT_FORMAT,
    repository_id: ownership.repository_id,
    site_id: ownership.site_id,
    run_id: ownership.run_id,
    attempt_id: ownership.attempt_id,
    capture_id: ownership.capture_id,
    capture_generation: ownership.capture_generation,
    manifest_sha256: manifestHash.sha256,
    created_at: (input.now ?? (() => new Date()))().toISOString(),
    artifacts: input.manifest.artifacts.map((artifact) => ({ ...artifact })),
  };
  const intentPath = join(input.preparedPath, PUBLICATION_INTENT_FILE);
  let intent = candidateIntent;
  try { await writeExclusiveRepositoryFile(intentPath, canonicalJson(candidateIntent)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    intent = parsePublicationIntent(await readProtectedProtocolJson(intentPath, input.repository, input.signal));
    if (!sameIntent(intent, candidateIntent)) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_INTENT_CONFLICT', 'Prepared publication intent differs from the immutable retry.', { cause: error });
    }
  }
  await ops.fault('before-intent-fsync');
  await ops.fsyncFile(intentPath);
  await ops.fault('after-intent-fsync');
  await input.recordIntent?.(intent);
  input.signal?.throwIfAborted();

  await ops.fault('before-source-fsync');
  await fsyncTree(input.preparedPath, input.repository, ops, input.signal);
  await ops.fault('after-source-fsync');
  await assertRepositoryStillMatches(input.repository);
  try {
    await fs.lstat(destination);
    throw new RepositorySafetyError('BACKUP_PUBLICATION_DESTINATION_EXISTS', `Run ${ownership.run_id} is already published.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await ops.fault('before-rename');
  input.signal?.throwIfAborted();
  try { await ops.rename(input.preparedPath, destination); }
  catch (error) {
    if (['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw new RepositorySafetyError('BACKUP_PUBLICATION_DESTINATION_EXISTS', `Run ${ownership.run_id} is already published.`, { cause: error });
    }
    if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
      throw new RepositorySafetyError('BACKUP_REPOSITORY_CROSS_DEVICE', 'Atomic publication cannot cross filesystems.', { cause: error });
    }
    throw error;
  }
  await ops.fault('after-rename');
  await ops.fsyncDirectory(runs);
  input.signal?.throwIfAborted();

  const publishedAt = (input.now ?? (() => new Date()))().toISOString();
  await ops.fault('before-readback');
  const verified = await readAndVerifyPublishedRun({ repository: input.repository, runId: ownership.run_id, requireReceipt: false, signal: input.signal,
    trustedConfigurationPolicy: input.trustedConfigurationPolicy });
  await ops.fault('after-readback');
  const verifiedAt = (input.now ?? (() => new Date()))().toISOString();
  const receipt: PublicationReceipt = {
    format: PUBLICATION_RECEIPT_FORMAT,
    repository_id: ownership.repository_id,
    site_id: ownership.site_id,
    run_id: ownership.run_id,
    attempt_id: ownership.attempt_id,
    capture_id: ownership.capture_id,
    capture_generation: ownership.capture_generation,
    manifest_sha256: intent.manifest_sha256,
    published_at: publishedAt,
    verified_at: verifiedAt,
  };
  const receiptPath = join(destination, PUBLICATION_RECEIPT_FILE);
  await writeExclusiveRepositoryFile(receiptPath, canonicalJson(receipt));
  await ops.fault('before-receipt-fsync');
  input.signal?.throwIfAborted();
  await ops.fsyncFile(receiptPath);
  await ops.fsyncDirectory(destination);
  await ops.fsyncDirectory(runs);
  await ops.fault('after-receipt-fsync');
  await input.recordReceipt?.(receipt);
  return { ...verified, receipt };
}

export async function completePublishedRunReceipt(input: {
  repository: LocalRepository;
  runId: string;
  now?: Date;
  signal?: AbortSignal;
  fault?(point: 'before-receipt-repair-write'): Promise<void>;
  recordReceipt?(receipt: PublicationReceipt): Promise<void>;
  trustedConfigurationPolicy?: SignedConfigurationCapsulePolicy;
}): Promise<PublishedRunVerification> {
  input.signal?.throwIfAborted();
  const verified = await readAndVerifyPublishedRun({ repository: input.repository, runId: input.runId, requireReceipt: false, signal: input.signal,
    trustedConfigurationPolicy: input.trustedConfigurationPolicy });
  if (verified.receipt) return verified;
  input.signal?.throwIfAborted();
  const timestamp = (input.now ?? new Date()).toISOString();
  const receipt: PublicationReceipt = {
    format: PUBLICATION_RECEIPT_FORMAT,
    repository_id: verified.intent.repository_id,
    site_id: verified.intent.site_id,
    run_id: verified.intent.run_id,
    attempt_id: verified.intent.attempt_id,
    capture_id: verified.intent.capture_id,
    capture_generation: verified.intent.capture_generation,
    manifest_sha256: verified.intent.manifest_sha256,
    published_at: timestamp,
    verified_at: timestamp,
  };
  const receiptPath = join(verified.runPath, PUBLICATION_RECEIPT_FILE);
  const temporary = join(verified.runPath, `.publication-receipt.${randomUUID()}.tmp`);
  try {
    await input.fault?.('before-receipt-repair-write');
    input.signal?.throwIfAborted();
    await writeExclusiveRepositoryFile(temporary, canonicalJson(receipt));
    input.signal?.throwIfAborted();
    await fs.link(temporary, receiptPath);
    await fs.unlink(temporary);
  } catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error; }
  await fsyncFile(receiptPath);
  await fsyncDirectory(verified.runPath);
  await fsyncDirectory(dirname(verified.runPath));
  await input.recordReceipt?.(receipt);
  return { ...verified, receipt };
}
