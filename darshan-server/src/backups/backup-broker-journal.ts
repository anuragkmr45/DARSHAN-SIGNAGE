import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from './backup-broker-protocol';
import { assertRepositoryIdentityReadonly, assertRepositoryStillMatches, fsyncDirectory, repositoryPath, type LocalRepository } from './local-repository';

const JOURNAL_FORMAT_V1 = 'darshan-backup-broker-journal-v1' as const;
const JOURNAL_FORMAT = 'darshan-backup-broker-journal-v2' as const;
const JOURNAL_DIRECTORY = 'broker-journal';
const JOURNAL_FILE = 'state.json';
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuid = z.string().regex(CANONICAL_UUID_PATTERN, 'UUID must be canonical lowercase RFC 4122 form');
const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const requestSchema = z.object({ request_sha256: sha256, response_sha256: sha256, response_base64: base64.max(2 * 1024 * 1024).nullable() }).strict();
const publicationSchema = z.object({
  site_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/), repository_id: uuid, run_id: uuid, attempt_id: uuid, capture_id: uuid,
  capture_generation: z.number().int().positive().safe(), policy_sha256: sha256, capsule_generation: z.string().min(1).max(160),
  unsigned_manifest_sha256: sha256, signed_manifest_sha256: sha256, key_id: z.string().min(1).max(128), signature_base64: base64.min(1).max(1024),
  unsigned_manifest_base64: base64.min(1).max(1_500_000),
  attempt_directory: z.string().regex(/^[0-9a-f-]{36}\.[0-9a-f-]{36}\.[0-9a-f]{32}$/).nullable(),
  status: z.enum(['PREPARED', 'COMMITTED', 'QUARANTINED']),
}).strict();
const legacyStateSchema = z.object({
  format: z.literal(JOURNAL_FORMAT_V1), revision: z.number().int().nonnegative().safe(),
  requests: z.record(uuid, requestSchema), publications: z.record(uuid, publicationSchema),
}).strict();

const lifecycleIdentity = {
  site_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/), repository_id: uuid, run_id: uuid, attempt_id: uuid, capture_id: uuid,
  capture_generation: z.number().int().positive().safe(), manifest_sha256: sha256,
};
const holdSchema = z.object({
  ...lifecycleIdentity, operation_id: uuid, owner_token: uuid, fence_token: uuid,
  status: z.enum(['ACTIVE', 'RELEASED', 'UNCERTAIN']), acquired_at: z.string().datetime({ offset: true }),
  released_at: z.string().datetime({ offset: true }).nullable(), uncertain_at: z.string().datetime({ offset: true }).nullable(),
}).strict();
const deletionEntrySchema = z.object({
  kind: z.enum(['FILE', 'DIRECTORY']), expected_size: z.string().regex(/^(?:0|[1-9][0-9]*)$/).nullable(),
  expected_sha256: sha256.nullable(), status: z.enum(['PENDING', 'DELETED']),
}).strict();
const deletionSchema = z.object({
  ...lifecycleIdentity, operation_id: uuid, owner_token: uuid, fence_token: uuid,
  status: z.enum(['CLAIMED', 'RENAMED', 'DELETING', 'PARTIAL', 'DELETED', 'UNCERTAIN']),
  claimed_at: z.string().datetime({ offset: true }), updated_at: z.string().datetime({ offset: true }),
  namespace_renamed: z.boolean(), entries: z.record(z.string().min(1).max(1024), deletionEntrySchema),
  last_error_code: z.string().min(1).max(100).nullable(),
}).strict();
const tombstoneSchema = z.object({
  ...lifecycleIdentity, operation_id: uuid, disposition: z.enum(['INTENT', 'PARTIAL', 'DELETED', 'UNCERTAIN']),
  recorded_at: z.string().datetime({ offset: true }), completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict();
const stagingCleanupSchema = z.object({
  ...lifecycleIdentity, operation_id: uuid, owner_token: uuid, fence_token: uuid,
  status: z.enum(['CLAIMED', 'RENAMED', 'CLEANED', 'UNCERTAIN']), claimed_at: z.string().datetime({ offset: true }),
}).strict();
const stateSchema = z.object({
  format: z.literal(JOURNAL_FORMAT), revision: z.number().int().nonnegative().safe(),
  requests: z.record(uuid, requestSchema), publications: z.record(uuid, publicationSchema),
  holds: z.record(uuid, holdSchema), deletions: z.record(uuid, deletionSchema), tombstones: z.record(uuid, tombstoneSchema),
  staging_cleanups: z.record(uuid, stagingCleanupSchema).default({}),
}).strict();

export type BrokerJournalState = z.infer<typeof stateSchema>;
export type BrokerPublicationRecord = z.infer<typeof publicationSchema>;
export type BrokerRestoreHoldRecord = z.infer<typeof holdSchema>;
export type BrokerDeletionRecord = z.infer<typeof deletionSchema>;
export type BrokerDeletionEntry = z.infer<typeof deletionEntrySchema>;
export type BrokerStagingCleanupRecord = z.infer<typeof stagingCleanupSchema>;

export class BrokerJournalError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) { super(message, options); this.name = 'BrokerJournalError'; }
}

const initialState = (): BrokerJournalState => ({ format: JOURNAL_FORMAT, revision: 0, requests: {}, publications: {}, holds: {}, deletions: {}, tombstones: {}, staging_cleanups: {} });

function assertIdentityMap<T extends Record<string, unknown>>(input: {
  label: string; records: Record<string, T>; identity(record: T): string;
}): void {
  const identities = new Set<string>();
  for (const [key, record] of Object.entries(input.records)) {
    const identity = input.identity(record); const semanticIdentity = identity.toLowerCase();
    if (!CANONICAL_UUID_PATTERN.test(key) || !CANONICAL_UUID_PATTERN.test(identity) ||
        key !== identity || identities.has(semanticIdentity)) {
      throw new BrokerJournalError('BROKER_JOURNAL_CORRUPT', `${input.label} contains an aliased or duplicate semantic identity.`);
    }
    identities.add(semanticIdentity);
  }
}

function assertUuidFields(record: Record<string, unknown>, fields: readonly string[], label: string): void {
  for (const field of fields) {
    if (typeof record[field] !== 'string' || !CANONICAL_UUID_PATTERN.test(record[field])) {
      throw new BrokerJournalError('BROKER_JOURNAL_CORRUPT', `${label}.${field} is not a canonical lowercase UUID.`);
    }
  }
}

export function assertBrokerJournalStateMapIdentities(state: BrokerJournalState): void {
  for (const key of Object.keys(state.requests)) {
    if (!CANONICAL_UUID_PATTERN.test(key)) throw new BrokerJournalError('BROKER_JOURNAL_CORRUPT', 'requests contains a non-canonical UUID key.');
  }
  for (const record of Object.values(state.publications)) {
    assertUuidFields(record, ['repository_id', 'run_id', 'attempt_id', 'capture_id'], 'publication');
  }
  for (const record of Object.values(state.holds)) {
    assertUuidFields(record, ['repository_id', 'run_id', 'attempt_id', 'capture_id', 'operation_id', 'owner_token', 'fence_token'], 'hold');
  }
  for (const record of Object.values(state.deletions)) {
    assertUuidFields(record, ['repository_id', 'run_id', 'attempt_id', 'capture_id', 'operation_id', 'owner_token', 'fence_token'], 'deletion');
  }
  for (const record of Object.values(state.tombstones)) {
    assertUuidFields(record, ['repository_id', 'run_id', 'attempt_id', 'capture_id', 'operation_id'], 'tombstone');
  }
  for (const record of Object.values(state.staging_cleanups)) {
    assertUuidFields(record, ['repository_id', 'run_id', 'attempt_id', 'capture_id', 'operation_id', 'owner_token', 'fence_token'], 'staging cleanup');
  }
  assertIdentityMap({ label: 'publications', records: state.publications, identity: (record) => record.run_id });
  assertIdentityMap({ label: 'tombstones', records: state.tombstones, identity: (record) => record.run_id });
  assertIdentityMap({ label: 'holds', records: state.holds, identity: (record) => record.operation_id });
  assertIdentityMap({ label: 'deletions', records: state.deletions, identity: (record) => record.operation_id });
  assertIdentityMap({ label: 'staging cleanups', records: state.staging_cleanups, identity: (record) => record.operation_id });
}

export function parseBrokerJournalState(bytes: Uint8Array): BrokerJournalState {
  const parsed = parseStrictJson(bytes, 64 * 1024 * 1024);
  if (!canonicalJson(parsed).equals(Buffer.from(bytes))) {
    throw new BrokerJournalError('BROKER_JOURNAL_CORRUPT', 'Broker journal state must be canonical strict JSON.');
  }
  const current = stateSchema.safeParse(parsed);
  let state: BrokerJournalState;
  if (current.success) state = current.data;
  else {
    const legacy = legacyStateSchema.safeParse(parsed);
    if (!legacy.success) {
      throw new BrokerJournalError('BROKER_JOURNAL_CORRUPT', 'Broker journal schema or canonical UUID identity is invalid.', { cause: current.error });
    }
    state = { format: JOURNAL_FORMAT, revision: legacy.data.revision, requests: legacy.data.requests,
      publications: legacy.data.publications, holds: {}, deletions: {}, tombstones: {}, staging_cleanups: {} };
  }
  assertBrokerJournalStateMapIdentities(state);
  return state;
}

export interface BrokerJournalSnapshotReadHooks {
  afterOpen?(path: string): Promise<void>;
  afterRead?(path: string): Promise<void>;
}

/** Stable file snapshot only. This neither serializes with broker writes nor claims a transactional point-in-time view. */
export async function readBackupBrokerJournalSnapshot(input: {
  repository: LocalRepository;
  hooks?: BrokerJournalSnapshotReadHooks;
  signal?: AbortSignal;
}): Promise<BrokerJournalState> {
  input.signal?.throwIfAborted();
  try { await assertRepositoryIdentityReadonly(input.repository); }
  catch (cause) { throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Repository identity changed before journal snapshot.', { cause }); }
  const directory = repositoryPath(input.repository, JOURNAL_DIRECTORY);
  let directoryStat;
  try { directoryStat = await fs.lstat(directory, { bigint: true }); }
  catch (cause) { throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_MISSING', 'Broker journal directory is missing.', { cause }); }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() ||
      directoryStat.dev.toString() !== input.repository.deviceId || Number(directoryStat.uid) !== input.repository.ownerUid ||
      Number(directoryStat.gid) !== input.repository.ownerGid || Number(directoryStat.mode & 0o777n) !== 0o700 ||
      await fs.realpath(directory) !== directory) {
    throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal directory is not a protected existing directory.');
  }
  const path = join(directory, JOURNAL_FILE);
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try { handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW); }
  catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    throw new BrokerJournalError(code === 'ENOENT' ? 'BROKER_JOURNAL_SNAPSHOT_MISSING' : 'BROKER_JOURNAL_SNAPSHOT_UNSAFE',
      code === 'ENOENT' ? 'Broker journal state is missing.' : 'Broker journal state could not be opened safely.', { cause });
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.dev.toString() !== input.repository.deviceId ||
        Number(before.uid) !== input.repository.ownerUid || Number(before.gid) !== input.repository.ownerGid ||
        Number(before.mode & 0o777n) !== 0o600 || before.size < 1n || before.size > 64n * 1024n * 1024n) {
      throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal state is not a protected bounded single-link file.');
    }
    await input.hooks?.afterOpen?.(path);
    const expected = Number(before.size); const chunks: Buffer[] = []; let offset = 0;
    while (offset <= expected) {
      input.signal?.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, expected + 1 - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead)); offset += bytesRead;
      if (offset > expected) break;
    }
    await input.hooks?.afterRead?.(path);
    input.signal?.throwIfAborted();
    let after; let pathname;
    try { [after, pathname] = await Promise.all([handle.stat({ bigint: true }), fs.lstat(path, { bigint: true })]); }
    catch (cause) { throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal path changed during snapshot read.', { cause }); }
    if (offset !== expected || pathname.isSymbolicLink() || pathname.dev !== before.dev || pathname.ino !== before.ino ||
        pathname.nlink !== 1n || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.nlink !== before.nlink || after.uid !== before.uid || after.gid !== before.gid || after.mode !== before.mode ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal changed during bounded snapshot read.');
    }
    let parsed: BrokerJournalState;
    try { parsed = parseBrokerJournalState(Buffer.concat(chunks, expected)); }
    catch (cause) { throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_CORRUPT', 'Broker journal snapshot is invalid.', { cause }); }
    const finalDirectory = await fs.lstat(directory, { bigint: true });
    if (finalDirectory.isSymbolicLink() || !finalDirectory.isDirectory() || finalDirectory.dev !== directoryStat.dev ||
        finalDirectory.ino !== directoryStat.ino || finalDirectory.uid !== directoryStat.uid || finalDirectory.gid !== directoryStat.gid ||
        finalDirectory.mode !== directoryStat.mode || await fs.realpath(directory) !== directory) {
      throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal directory changed during snapshot read.');
    }
    try { await assertRepositoryIdentityReadonly(input.repository); }
    catch (cause) { throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Repository identity changed during journal snapshot.', { cause }); }
    input.signal?.throwIfAborted();
    return parsed;
  } finally { await handle.close(); }
}

export class BackupBrokerJournal {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly repository: LocalRepository, private readonly fault?: (stage: 'after-temp-open') => Promise<void>) {}

  private async directory(): Promise<string> {
    await assertRepositoryStillMatches(this.repository);
    const path = repositoryPath(this.repository, JOURNAL_DIRECTORY);
    await fs.mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(path, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== this.repository.deviceId ||
        Number(stat.uid) !== this.repository.ownerUid || Number(stat.gid) !== this.repository.ownerGid || Number(stat.mode & 0o777n) !== 0o700 ||
        await fs.realpath(path) !== path) {
      throw new BrokerJournalError('BROKER_JOURNAL_UNSAFE', 'Broker journal directory is not a protected repository-owned directory.');
    }
    return path;
  }

  private async load(): Promise<BrokerJournalState> {
    const directory = await this.directory(); const path = join(directory, JOURNAL_FILE);
    let stat;
    try { stat = await fs.lstat(path, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initialState(); throw error; }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.dev.toString() !== this.repository.deviceId ||
        Number(stat.uid) !== this.repository.ownerUid || Number(stat.gid) !== this.repository.ownerGid || Number(stat.mode & 0o777n) !== 0o600 || stat.size > 64n * 1024n * 1024n) {
      throw new BrokerJournalError('BROKER_JOURNAL_UNSAFE', 'Broker journal state file is unsafe or exceeds 64 MiB.');
    }
    try {
      return parseBrokerJournalState(await fs.readFile(path));
    }
    catch (cause) { throw new BrokerJournalError('BROKER_JOURNAL_CORRUPT', 'Broker journal state is invalid.', { cause }); }
  }

  private async loadReadonly(): Promise<BrokerJournalState> {
    await assertRepositoryIdentityReadonly(this.repository);
    const directory = repositoryPath(this.repository, JOURNAL_DIRECTORY);
    let before: Awaited<ReturnType<typeof fs.lstat>>;
    try { before = await fs.lstat(directory); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      await assertRepositoryIdentityReadonly(this.repository);
      try { await fs.lstat(directory); }
      catch (afterCause) {
        if ((afterCause as NodeJS.ErrnoException).code === 'ENOENT') return initialState();
        throw afterCause;
      }
      throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal directory appeared during read-only inspection.');
    }
    try { return await readBackupBrokerJournalSnapshot({ repository: this.repository }); }
    catch (cause) {
      if (!(cause instanceof BrokerJournalError) || cause.code !== 'BROKER_JOURNAL_SNAPSHOT_MISSING') throw cause;
      const after = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
        throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal directory changed during read-only inspection.', { cause: error });
      });
      if (before.isSymbolicLink() || !before.isDirectory() || after.isSymbolicLink() || !after.isDirectory() ||
          before.dev !== after.dev || before.ino !== after.ino || before.uid !== after.uid || before.gid !== after.gid ||
          before.mode !== after.mode || Number(after.mode & 0o777) !== 0o700 || await fs.realpath(directory) !== directory) {
        throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal directory changed during read-only inspection.');
      }
      try { await fs.lstat(join(directory, JOURNAL_FILE)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          await assertRepositoryIdentityReadonly(this.repository); return initialState();
        }
        throw error;
      }
      throw new BrokerJournalError('BROKER_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal state appeared during read-only inspection.');
    }
  }

  private async store(state: BrokerJournalState): Promise<void> {
    const directory = await this.directory(); const target = join(directory, JOURNAL_FILE);
    const next = stateSchema.parse({ ...state, revision: state.revision + 1 });
    const temporary = join(directory, `.state.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
      await this.fault?.('after-temp-open');
      await handle.writeFile(canonicalJson(next)); await handle.sync(); await handle.close(); handle = undefined;
      await fs.rename(temporary, target); await fsyncDirectory(directory);
    } catch (error) {
      await handle?.close().catch(() => undefined); await fs.unlink(temporary).catch(() => undefined); throw error;
    }
    state.revision = next.revision;
  }

  async execute(input: {
    requestId: string; requestSha256: string;
    operation(state: BrokerJournalState, checkpoint: () => Promise<void>): Promise<Buffer> | Buffer;
    reconstruct?(state: BrokerJournalState): Promise<Buffer> | Buffer;
    replayOverride?(state: BrokerJournalState): Promise<Buffer | undefined> | Buffer | undefined;
  }): Promise<Buffer> {
    const task = this.queue.then(async () => {
      const state = await this.load(); const replay = state.requests[input.requestId];
      if (replay) {
        if (replay.request_sha256 !== input.requestSha256) throw new BrokerJournalError('BROKER_REPLAY_CONFLICT', 'request_id was replayed with different content.');
        const overridden = await input.replayOverride?.(state);
        if (overridden) return overridden;
        const response = replay.response_base64 === null
          ? await input.reconstruct?.(state)
          : Buffer.from(replay.response_base64, 'base64');
        if (!response || createHash('sha256').update(response).digest('hex') !== replay.response_sha256) throw new BrokerJournalError('BROKER_REPLAY_RECONSTRUCTION_FAILED', 'Compact replay response could not be reconstructed exactly.');
        return response;
      }
      const response = await input.operation(state, async () => { await this.store(state); });
      state.requests[input.requestId] = {
        request_sha256: input.requestSha256, response_sha256: createHash('sha256').update(response).digest('hex'),
        response_base64: response.byteLength <= 1024 * 1024 ? response.toString('base64') : null,
      };
      await this.store(state);
      return response;
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  async inspect(runId: string): Promise<BrokerPublicationRecord | undefined> {
    const task = this.queue.then(async () => (await this.load()).publications[runId]);
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  async query<T>(operation: (state: BrokerJournalState) => Promise<T> | T): Promise<T> {
    const task = this.queue.then(async () => operation(await this.load()));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  /** Queue-serialized broker truth read. It never creates, repairs, checkpoints, or records request replay state. */
  async queryReadonly<T>(operation: (state: BrokerJournalState) => Promise<T> | T): Promise<T> {
    const task = this.queue.then(async () => operation(await this.loadReadonly()));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  /** Resolves only after every operation admitted before this call has settled. */
  async drain(): Promise<void> {
    await this.queue;
  }
}
