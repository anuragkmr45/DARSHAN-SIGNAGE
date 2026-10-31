import { constants as fsConstants, promises as fs } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { assertCanonicalTimestamp, recoveryDigest, recoverySiteId, recoveryUuid, sha256RecoveryBytes } from './contracts';
import { RecoveryError } from './errors';
import { TARGET_HELPER_OPERATIONS, TARGET_LIFECYCLE_STATES, type TargetHelperOperation,
  encodeTargetHelperResponse, type TargetHelperResponse, type TargetLifecycleState } from './target-helper-protocol';

export const TARGET_HELPER_JOURNAL_FORMAT = 'darshan-recovery-target-helper-journal-v1' as const;
const TARGETS_DIRECTORY = 'target-sets';
const STATE_FILE = 'state.json';
const LOCK_FILE = '.target-helper.lock';
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_REPLAY_ENTRIES = 128;
export type TargetHelperJournalFaultStage = 'after-targets-mkdir-before-parent-fsync' |
  'after-target-directory-mkdir-before-parent-fsync' | 'after-temp-fsync-before-rename' |
  'after-lock-create-before-fstat' | 'after-lock-write-before-sync' | 'after-lock-sync-before-parent-fsync';

export interface TargetHelperIdentity {
  operationId: string;
  siteId: string;
  hostInstallationId: string;
  planSha256: string;
  targetSetId: string;
  generation: number;
  targetSpecificationSha256: string;
}

export interface TargetHelperReplayEntry {
  requestId: string;
  requestSha256: string;
  response: TargetHelperResponse;
}

export interface TargetHelperJournalState extends TargetHelperIdentity {
  format: typeof TARGET_HELPER_JOURNAL_FORMAT;
  helperSequence: number;
  state: TargetLifecycleState;
  pendingAction: TargetHelperOperation | null;
  pendingRequestId: string | null;
  pendingRequestSha256: string | null;
  effectDisposition: 'NONE' | 'DEFINITE' | 'AMBIGUOUS';
  reconciliationEvidenceSha256: string | null;
  lastReceiptSha256: string | null;
  replay: TargetHelperReplayEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ScopedTargetHelperJournal {
  read(): TargetHelperJournalState;
  write(mutate: (state: Readonly<TargetHelperJournalState>) => TargetHelperJournalState): Promise<TargetHelperJournalState>;
}

export interface ReadonlyTargetHelperJournal {
  state: Readonly<TargetHelperJournalState> | undefined;
}

function safeRoot(root: string): string {
  if (!isAbsolute(root) || resolve(root) !== root || root.endsWith(sep)) {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-helper journal root must be a canonical absolute path.');
  }
  return root;
}

function contained(root: string, ...segments: string[]): string {
  const path = resolve(root, ...segments); const suffix = relative(root, path);
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-helper journal path escaped its root.');
  }
  return path;
}

async function directoryDevice(path: string, expectedUid: number, expectedGid: number, expected?: bigint): Promise<bigint> {
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || Number(stat.mode & 0o777n) !== 0o700 ||
      Number(stat.uid) !== expectedUid || Number(stat.gid) !== expectedGid ||
      (expected !== undefined && stat.dev !== expected) || await fs.realpath(path) !== path) {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-helper journal directory is not protected.');
  }
  return stat.dev;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicWrite(path: string, bytes: Buffer, device: bigint, expectedUid: number, expectedGid: number,
  fault?: (stage: TargetHelperJournalFaultStage) => Promise<void>): Promise<void> {
  const parent = resolve(path, '..'); const temp = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await fs.open(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.dev !== device || stat.nlink !== 1n || Number(stat.uid) !== expectedUid ||
        Number(stat.gid) !== expectedGid || Number(stat.mode & 0o777n) !== 0o600) throw new Error('unsafe target-helper temp file');
    await handle.writeFile(bytes); await handle.sync();
  } catch (cause) {
    await handle.close().catch(() => undefined); await fs.unlink(temp).catch(() => undefined); throw cause;
  }
  await handle.close();
  try { await fault?.('after-temp-fsync-before-rename'); await fs.rename(temp, path); await syncDirectory(parent); }
  catch (cause) { await fs.unlink(temp).catch(() => undefined); throw cause; }
}

function exactKeys(value: object, keys: readonly string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', `${label} has missing or unknown fields.`);
  }
}

function validateIdentity(value: TargetHelperIdentity): void {
  recoveryUuid(value.operationId, 'operationId'); recoverySiteId(value.siteId);
  recoveryUuid(value.hostInstallationId, 'hostInstallationId'); recoveryDigest(value.planSha256, 'planSha256');
  recoveryDigest(value.targetSetId, 'targetSetId'); recoveryDigest(value.targetSpecificationSha256, 'targetSpecificationSha256');
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target generation is invalid.');
}

function validateState(value: TargetHelperJournalState): TargetHelperJournalState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper state is invalid.');
  exactKeys(value, ['format', 'operationId', 'siteId', 'hostInstallationId', 'planSha256', 'targetSetId', 'generation',
    'targetSpecificationSha256', 'helperSequence', 'state', 'pendingAction', 'pendingRequestId', 'pendingRequestSha256', 'effectDisposition',
    'reconciliationEvidenceSha256', 'lastReceiptSha256', 'replay', 'createdAt', 'updatedAt'], 'Target-helper state');
  if (value.format !== TARGET_HELPER_JOURNAL_FORMAT) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper journal format is unsupported.');
  validateIdentity(value);
  if (!Number.isSafeInteger(value.helperSequence) || value.helperSequence < 0 || !TARGET_LIFECYCLE_STATES.includes(value.state) ||
      (value.pendingAction !== null && !TARGET_HELPER_OPERATIONS.includes(value.pendingAction)) ||
      !['NONE', 'DEFINITE', 'AMBIGUOUS'].includes(value.effectDisposition) ||
      (value.effectDisposition === 'AMBIGUOUS') !== (value.state === 'RECONCILIATION_REQUIRED')) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper lifecycle fields are inconsistent.');
  }
  if ((value.pendingRequestId === null) !== (value.pendingRequestSha256 === null) ||
      (value.pendingAction === null) !== (value.pendingRequestId === null)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper pending request identity is inconsistent.');
  }
  if (value.pendingRequestId !== null) recoveryUuid(value.pendingRequestId, 'pendingRequestId');
  if (value.pendingRequestSha256 !== null) recoveryDigest(value.pendingRequestSha256, 'pendingRequestSha256');
  if (value.reconciliationEvidenceSha256 !== null) recoveryDigest(value.reconciliationEvidenceSha256, 'reconciliationEvidenceSha256');
  if (value.lastReceiptSha256 !== null) recoveryDigest(value.lastReceiptSha256, 'lastReceiptSha256');
  assertCanonicalTimestamp(value.createdAt, 'createdAt'); assertCanonicalTimestamp(value.updatedAt, 'updatedAt');
  if (!Array.isArray(value.replay) || value.replay.length > MAX_REPLAY_ENTRIES) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper replay ledger exceeds its bound.');
  const requestIds = new Set<string>(); let priorSequence = -1;
  const successfulPrepareReceipts: TargetHelperReplayEntry[] = [];
  for (const entry of value.replay) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper replay entry is invalid.');
    exactKeys(entry, ['requestId', 'requestSha256', 'response'], 'Target-helper replay entry');
    recoveryUuid(entry.requestId, 'requestId'); recoveryDigest(entry.requestSha256, 'requestSha256');
    if (requestIds.has(entry.requestId)) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper replay requestId is duplicated.');
    requestIds.add(entry.requestId);
    try { encodeTargetHelperResponse(entry.response); }
    catch (cause) { throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper replay response schema is invalid.', { cause }); }
    if (entry.response.requestId !== entry.requestId || entry.response.operationId !== value.operationId ||
        entry.response.siteId !== value.siteId || entry.response.hostInstallationId !== value.hostInstallationId ||
        entry.response.planSha256 !== value.planSha256 || entry.response.targetSetId !== value.targetSetId ||
        entry.response.generation !== value.generation || entry.response.targetSpecificationSha256 !== value.targetSpecificationSha256 ||
        entry.response.helperSequence <= priorSequence || entry.response.helperSequence > value.helperSequence) {
      throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper replay response conflicts with journal identity or sequence.');
    }
    if (entry.response.ok && entry.response.operation === 'PREPARE' && entry.response.state === 'READY' &&
        entry.response.pendingAction === null && entry.response.effectDisposition === 'DEFINITE' &&
        entry.response.reconciliationEvidenceSha256 !== null) successfulPrepareReceipts.push(entry);
    priorSequence = entry.response.helperSequence;
  }
  if (successfulPrepareReceipts.length > 1 ||
      (successfulPrepareReceipts.length === 1 && value.lastReceiptSha256 !==
       sha256RecoveryBytes(canonicalJson(successfulPrepareReceipts[0]!.response))) ||
      (value.lastReceiptSha256 !== null && successfulPrepareReceipts.length !== 1)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT',
      'Target-helper journal does not retain exactly one canonical pinned PREPARE receipt.');
  }
  return value;
}

function encode(state: TargetHelperJournalState): Buffer {
  const validated = validateState(state); const stateBytes = canonicalJson(validated);
  return canonicalJson({ state: validated, stateSha256: sha256RecoveryBytes(stateBytes) });
}

async function readState(path: string, device: bigint, expectedUid: number, expectedGid: number): Promise<TargetHelperJournalState> {
  const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== device || before.nlink !== 1n || Number(before.mode & 0o777n) !== 0o600 ||
        Number(before.uid) !== expectedUid || Number(before.gid) !== expectedGid ||
        before.size < 1n || before.size > BigInt(MAX_STATE_BYTES)) throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-helper journal file is unsafe.');
    const expectedSize = Number(before.size); const chunks: Buffer[] = []; let offset = 0;
    while (offset <= expectedSize) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, expectedSize + 1 - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead)); offset += bytesRead;
      if (offset > expectedSize) break;
    }
    const bytes = Buffer.concat(chunks, Math.min(offset, expectedSize)); const [after, pathname] = await Promise.all([
      handle.stat({ bigint: true }), fs.lstat(path, { bigint: true }),
    ]);
    if (offset !== expectedSize || after.ino !== before.ino || after.dev !== before.dev || after.nlink !== before.nlink || after.mode !== before.mode ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs ||
        pathname.isSymbolicLink() || pathname.ino !== before.ino || pathname.dev !== before.dev || pathname.nlink !== 1n) {
      throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper journal changed while read.');
    }
    const envelope = parseStrictJson(bytes, MAX_STATE_BYTES) as { state?: unknown; stateSha256?: unknown };
    if (!canonicalJson(envelope).equals(bytes) || !envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('noncanonical envelope');
    exactKeys(envelope, ['state', 'stateSha256'], 'Target-helper envelope');
    if (typeof envelope.stateSha256 !== 'string' || sha256RecoveryBytes(canonicalJson(envelope.state)) !== envelope.stateSha256) {
      throw new Error('target-helper state checksum mismatch');
    }
    return validateState(envelope.state as TargetHelperJournalState);
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper journal is malformed.', { cause });
  } finally { await handle.close(); }
}

export class TargetHelperJournal {
  private readonly root: string;
  private readonly now: () => Date;
  private readonly expectedUid: number;
  private readonly expectedGid: number;
  private readonly fault?: (stage: TargetHelperJournalFaultStage) => Promise<void>;
  private readonly instanceAuthorityToken?: string;
  private readonly requireInstanceAuthority: boolean;
  constructor(input: { root: string; now?: () => Date; expectedUid?: number; expectedGid?: number;
    fault?: (stage: TargetHelperJournalFaultStage) => Promise<void>;
    instanceAuthorityToken?: string; requireInstanceAuthority?: boolean }) {
    this.root = safeRoot(input.root); this.now = input.now ?? (() => new Date());
    this.expectedUid = input.expectedUid ?? process.getuid?.() ?? -1;
    this.expectedGid = input.expectedGid ?? process.getgid?.() ?? -1;
    this.fault = input.fault;
    this.requireInstanceAuthority = input.requireInstanceAuthority ?? false;
    if (input.instanceAuthorityToken !== undefined && !/^[a-f0-9]{64}$/.test(input.instanceAuthorityToken)) {
      throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-helper instance authority token is invalid.');
    }
    this.instanceAuthorityToken = input.instanceAuthorityToken;
    if (this.requireInstanceAuthority && this.instanceAuthorityToken === undefined) {
      throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE',
        'Production target-helper journal requires native instance authority.');
    }
    if (!Number.isSafeInteger(this.expectedUid) || this.expectedUid < 0 || !Number.isSafeInteger(this.expectedGid) || this.expectedGid < 0) {
      throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-helper journal owner identity is unavailable.');
    }
  }

  private async acquireLock(device: bigint): Promise<() => Promise<void>> {
    const path = contained(this.root, LOCK_FILE);
    let handle;
    try { handle = await fs.open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new RecoveryError('RECOVERY_LOCK_HELD', 'Target-helper journal lock is held.', { cause });
      throw cause;
    }
    let stat;
    try { await this.fault?.('after-lock-create-before-fstat'); stat = await handle.stat({ bigint: true }); }
    catch (cause) { await handle.close().catch(() => undefined); throw cause; }
    if (!stat.isFile() || stat.dev !== device || stat.nlink !== 1n || Number(stat.uid) !== this.expectedUid ||
        Number(stat.gid) !== this.expectedGid || Number(stat.mode & 0o777n) !== 0o600) {
      await handle.close(); throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-helper lock is unsafe.');
    }
    const bytes = canonicalJson(this.instanceAuthorityToken === undefined
      ? { instanceId: randomUUID(), pid: process.pid }
      : { instanceAuthorityToken: this.instanceAuthorityToken, instanceId: randomUUID(), pid: process.pid });
    try {
      await handle.writeFile(bytes); await this.fault?.('after-lock-write-before-sync'); await handle.sync();
      await handle.close(); await this.fault?.('after-lock-sync-before-parent-fsync'); await syncDirectory(this.root);
    } catch (cause) {
      await handle.close().catch(() => undefined);
      const current = await fs.lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined; throw error;
      });
      if (current?.isFile() && !current.isSymbolicLink() && current.dev === stat.dev && current.ino === stat.ino && current.nlink === 1n) {
        await fs.unlink(path); await syncDirectory(this.root);
      }
      throw cause;
    }
    return async () => {
      const readHandle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
      try {
        const before = await readHandle.stat({ bigint: true });
        if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || before.nlink !== 1n ||
            before.size !== BigInt(bytes.byteLength) || before.size > 4096n) {
          throw new RecoveryError('RECOVERY_LOCK_STALE_FENCE', 'Target-helper lock ownership changed before release.');
        }
        const observed = Buffer.alloc(bytes.byteLength + 1); const { bytesRead } = await readHandle.read(observed, 0, observed.byteLength, 0);
        const [after, pathname] = await Promise.all([readHandle.stat({ bigint: true }), fs.lstat(path, { bigint: true })]);
        if (bytesRead !== bytes.byteLength || !observed.subarray(0, bytesRead).equals(bytes) || after.ino !== before.ino ||
            after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs ||
            pathname.isSymbolicLink() || pathname.dev !== before.dev || pathname.ino !== before.ino || pathname.nlink !== 1n) {
          throw new RecoveryError('RECOVERY_LOCK_STALE_FENCE', 'Target-helper lock ownership changed before release.');
        }
      } finally { await readHandle.close(); }
      await fs.unlink(path); await syncDirectory(this.root);
    };
  }

  private async readExisting(identity: TargetHelperIdentity, device: bigint): Promise<TargetHelperJournalState | undefined> {
    const targets = contained(this.root, TARGETS_DIRECTORY);
    try {
      await directoryDevice(targets, this.expectedUid, this.expectedGid, device);
      const directory = contained(targets, identity.targetSetId);
      await directoryDevice(directory, this.expectedUid, this.expectedGid, device);
      const state = await readState(join(directory, STATE_FILE), device, this.expectedUid, this.expectedGid);
      if (Object.entries(identity).some(([key, value]) => state[key as keyof TargetHelperJournalState] !== value)) {
        throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Target-helper journal identity conflicts with this targetSetId.');
      }
      return state;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw cause;
    }
  }

  async withTarget<T>(identity: TargetHelperIdentity, callback: (journal: ScopedTargetHelperJournal) => Promise<T>,
    authorize?: (state: Readonly<TargetHelperJournalState> | undefined) => Promise<void> | void): Promise<T> {
    validateIdentity(identity); const device = await directoryDevice(this.root, this.expectedUid, this.expectedGid); const release = await this.acquireLock(device);
    try {
      await authorize?.(await this.readExisting(identity, device));
      const targets = contained(this.root, TARGETS_DIRECTORY);
      let targetsCreated = false;
      await fs.mkdir(targets, { mode: 0o700 }).then(() => { targetsCreated = true; }).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== 'EEXIST') throw cause; });
      await directoryDevice(targets, this.expectedUid, this.expectedGid, device);
      if (targetsCreated) await this.fault?.('after-targets-mkdir-before-parent-fsync');
      await syncDirectory(this.root);
      const directory = contained(targets, identity.targetSetId);
      let directoryCreated = false;
      await fs.mkdir(directory, { mode: 0o700 }).then(() => { directoryCreated = true; }).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== 'EEXIST') throw cause; });
      await directoryDevice(directory, this.expectedUid, this.expectedGid, device);
      if (directoryCreated) await this.fault?.('after-target-directory-mkdir-before-parent-fsync');
      await syncDirectory(targets);
      const path = join(directory, STATE_FILE);
      let state: TargetHelperJournalState;
      try { state = await readState(path, device, this.expectedUid, this.expectedGid); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
        const timestamp = this.now().toISOString();
        state = validateState({ format: TARGET_HELPER_JOURNAL_FORMAT, ...identity, helperSequence: 0, state: 'ABSENT',
          pendingAction: null, pendingRequestId: null, pendingRequestSha256: null,
          effectDisposition: 'NONE', reconciliationEvidenceSha256: null, lastReceiptSha256: null,
          replay: [], createdAt: timestamp, updatedAt: timestamp });
        await atomicWrite(path, encode(state), device, this.expectedUid, this.expectedGid, this.fault);
      }
      if (Object.entries(identity).some(([key, value]) => state[key as keyof TargetHelperJournalState] !== value)) {
        throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Target-helper journal identity conflicts with this targetSetId.');
      }
      const scope: ScopedTargetHelperJournal = {
        read: () => state,
        write: async (mutate) => {
          const candidate = mutate(state);
          const immutable = ['operationId', 'siteId', 'hostInstallationId', 'planSha256', 'targetSetId', 'generation',
            'targetSpecificationSha256', 'createdAt'] as const;
          if (immutable.some((field) => candidate[field] !== state[field]) || candidate.format !== TARGET_HELPER_JOURNAL_FORMAT) {
            throw new RecoveryError('RECOVERY_JOURNAL_CONFLICT', 'Target-helper mutation changed immutable identity.');
          }
          const next = validateState({ ...candidate, helperSequence: state.helperSequence + 1, updatedAt: this.now().toISOString() });
          await atomicWrite(path, encode(next), device, this.expectedUid, this.expectedGid, this.fault); state = next; return state;
        },
      };
      return await callback(scope);
    } finally { await release(); }
  }

  async withTargetReadonly<T>(identity: TargetHelperIdentity,
    callback: (journal: ReadonlyTargetHelperJournal) => Promise<T>): Promise<T> {
    validateIdentity(identity); const device = await directoryDevice(this.root, this.expectedUid, this.expectedGid);
    return callback({ state: await this.readExisting(identity, device) });
  }

  async read(targetSetId: string): Promise<TargetHelperJournalState> {
    const device = await directoryDevice(this.root, this.expectedUid, this.expectedGid); const targets = contained(this.root, TARGETS_DIRECTORY);
    await directoryDevice(targets, this.expectedUid, this.expectedGid, device); const directory = contained(targets, recoveryDigest(targetSetId, 'targetSetId'));
    await directoryDevice(directory, this.expectedUid, this.expectedGid, device);
    return readState(join(directory, STATE_FILE), device, this.expectedUid, this.expectedGid);
  }
}
