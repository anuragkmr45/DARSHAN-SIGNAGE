import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalJson, parseStrictJson } from '../../backups/backup-broker-protocol';
import { ControlledRecoveryError, CONTROLLED_RECOVERY_STATES, digest, sha256, type ControlledRecoveryState, type OperationIdentity } from './contracts';

export type JournalOutcome = 'INTENT' | 'RESULT' | 'OBSERVATION' | 'FAILURE';
export type EffectTruth = 'NONE' | 'PENDING' | 'CONFIRMED' | 'AMBIGUOUS';

export interface ControlledRecoveryJournalEvent {
  format: 'darshan-controlled-recovery-journal-event-v1';
  sequence: number;
  recordedAt: string;
  operationId: string;
  siteId: string;
  phase: ControlledRecoveryState;
  outcome: JournalOutcome;
  effectTruth: EffectTruth;
  code: string;
  evidenceSha256: string | null;
  previousSha256: string;
  eventSha256: string;
}

export interface ControlledRecoveryJournalSnapshot {
  identity: OperationIdentity;
  events: ControlledRecoveryJournalEvent[];
  state: ControlledRecoveryState;
  pendingPhase: ControlledRecoveryState | null;
  ambiguous: boolean;
}

const ZERO = '0'.repeat(64);
const activeFormat = 'darshan-controlled-recovery-active-v1';
const lockOwnerFormat = 'darshan-controlled-recovery-lock-owner-v2';
declare const operationLockBrand: unique symbol;
export type ControlledRecoveryOperationLock = { readonly [operationLockBrand]: true };

type LockOwner = {
  format: typeof lockOwnerFormat;
  kind: 'OPERATION' | 'RECLAIM';
  pid: number;
  nonce: string;
  createdAt: string;
};

export interface ControlledRecoveryJournalLockHooks {
  afterStaleOwnerObserved?: () => Promise<void>;
  afterReclaimLockPublished?: () => Promise<void>;
}

function eventHash(event: Omit<ControlledRecoveryJournalEvent, 'eventSha256'>): string { return sha256(canonicalJson(event)); }

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function durableExclusive(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}

function validateEvent(value: unknown, previous: string, sequence: number, identity: OperationIdentity): ControlledRecoveryJournalEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('event');
  const event = value as ControlledRecoveryJournalEvent;
  const expectedKeys = ['code', 'effectTruth', 'eventSha256', 'evidenceSha256', 'format', 'operationId', 'outcome', 'phase', 'previousSha256', 'recordedAt', 'sequence', 'siteId'];
  const unsigned = { format: event.format, sequence: event.sequence, recordedAt: event.recordedAt, operationId: event.operationId,
    siteId: event.siteId, phase: event.phase, outcome: event.outcome, effectTruth: event.effectTruth,
    code: event.code, evidenceSha256: event.evidenceSha256, previousSha256: event.previousSha256 };
  if (event.format !== 'darshan-controlled-recovery-journal-event-v1' || event.sequence !== sequence ||
      event.operationId !== identity.operationId || event.siteId !== identity.siteId || event.previousSha256 !== previous ||
      JSON.stringify(Object.keys(event).sort()) !== JSON.stringify(expectedKeys) || !Number.isSafeInteger(event.sequence) ||
      !Number.isFinite(Date.parse(event.recordedAt)) || new Date(event.recordedAt).toISOString() !== event.recordedAt ||
      !/^[A-Z][A-Z0-9_]{0,127}$/.test(event.code) || (event.evidenceSha256 !== null && !/^[a-f0-9]{64}$/.test(event.evidenceSha256)) ||
      !CONTROLLED_RECOVERY_STATES.includes(event.phase) || !['INTENT', 'RESULT', 'OBSERVATION', 'FAILURE'].includes(event.outcome) ||
      !['NONE', 'PENDING', 'CONFIRMED', 'AMBIGUOUS'].includes(event.effectTruth) || eventHash(unsigned) !== event.eventSha256) throw new Error('event');
  return event;
}

export class ControlledRecoveryJournal {
  private heldLock: ControlledRecoveryOperationLock | null = null;
  private constructor(readonly root: string, readonly identity: OperationIdentity, private readonly lockHooks: ControlledRecoveryJournalLockHooks = {}) {}
  private get operationDirectory() { return join(this.root, 'operations', this.identity.operationId); }
  private get journalPath() { return join(this.operationDirectory, 'journal.ndjson'); }
  private get identityPath() { return join(this.operationDirectory, 'identity.json'); }
  private get activePath() { return join(this.root, 'sites', `${this.identity.siteId}.active.json`); }
  private get processLock() { return join(this.root, 'locks', `${this.identity.siteId}.${this.identity.operationId}.lock`); }
  private get reclaimLock() { return `${this.processLock}.reclaim`; }

  static async create(root: string, identity: OperationIdentity, now = new Date()): Promise<ControlledRecoveryJournal> {
    await mkdir(join(root, 'operations'), { recursive: true, mode: 0o700 });
    await mkdir(join(root, 'sites'), { recursive: true, mode: 0o700 });
    await mkdir(join(root, 'locks'), { recursive: true, mode: 0o700 });
    const journal = new ControlledRecoveryJournal(root, identity);
    await mkdir(journal.operationDirectory, { recursive: false, mode: 0o700 }).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== 'EEXIST') throw cause;
    });
    const active = canonicalJson({ format: activeFormat, operationId: identity.operationId, siteId: identity.siteId, identitySha256: digest(identity), createdAt: now.toISOString() });
    try { await durableExclusive(journal.activePath, active); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      const current = parseStrictJson(await readFile(journal.activePath), 64 * 1024) as { operationId?: string; identitySha256?: string };
      if (current.operationId !== identity.operationId || current.identitySha256 !== digest(identity)) {
        throw new ControlledRecoveryError('CONTROLLED_RECOVERY_SITE_ACTIVE', 'A durable active controlled-recovery operation already protects this site.');
      }
    }
    try { await durableExclusive(journal.identityPath, canonicalJson(identity)); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST' || !Buffer.from(await readFile(journal.identityPath)).equals(canonicalJson(identity))) {
        throw new ControlledRecoveryError('CONTROLLED_RECOVERY_IDENTITY_CONFLICT', 'Operation identity differs from durable journal identity.', { cause });
      }
    }
    try { await durableExclusive(journal.journalPath, Buffer.alloc(0)); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; }
    await journal.withOperationLock(async (lock) => {
      if ((await journal.read(lock)).events.length === 0) {
        await journal.record({ phase: 'PLANNED', outcome: 'RESULT', effectTruth: 'CONFIRMED', code: 'CONTROLLED_RECOVERY_PLANNED', evidence: identity, now }, lock);
      }
    });
    return journal;
  }

  static async open(root: string, operationId: string, lockHooks: ControlledRecoveryJournalLockHooks = {}): Promise<ControlledRecoveryJournal> {
    const identity = parseStrictJson(await readFile(join(root, 'operations', operationId, 'identity.json')), 64 * 1024) as OperationIdentity;
    if (identity.operationId !== operationId) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_JOURNAL_CORRUPT', 'Journal identity is inconsistent.');
    return new ControlledRecoveryJournal(root, identity, lockHooks);
  }

  private newLockOwner(kind: LockOwner['kind']): LockOwner {
    return { format: lockOwnerFormat, kind, pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() };
  }

  private async publishLock(path: string, owner: LockOwner): Promise<Buffer> {
    const bytes = canonicalJson(owner);
    const temporary = `${path}.claim-${owner.nonce}`;
    await durableExclusive(temporary, bytes);
    try {
      await link(temporary, path);
      await syncDirectory(dirname(path));
    } finally {
      await rm(temporary, { force: true });
    }
    return bytes;
  }

  private async readLockOwner(path: string): Promise<{ bytes: Buffer; owner: LockOwner }> {
    const bytes = await readFile(path);
    if (bytes.byteLength === 0 || bytes.byteLength > 4096) throw new Error('lock owner size');
    const owner = parseStrictJson(bytes, 4096) as LockOwner;
    const keys = ['createdAt', 'format', 'kind', 'nonce', 'pid'];
    if (owner.format !== lockOwnerFormat || !['OPERATION', 'RECLAIM'].includes(owner.kind) ||
        !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner.nonce) ||
        !Number.isFinite(Date.parse(owner.createdAt)) || new Date(owner.createdAt).toISOString() !== owner.createdAt ||
        JSON.stringify(Object.keys(owner).sort()) !== JSON.stringify(keys)) throw new Error('lock owner');
    return { bytes, owner };
  }

  private ownerIsAlive(owner: LockOwner): boolean {
    try { process.kill(owner.pid, 0); return true; }
    catch (cause) { return (cause as NodeJS.ErrnoException).code !== 'ESRCH'; }
  }

  private async releaseLock(path: string, expected: Buffer): Promise<void> {
    let current: Buffer;
    try { current = await readFile(path); }
    catch (cause) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_BUSY', 'Controlled-recovery lock ownership was lost before release.', { cause });
    }
    if (!current.equals(expected)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_BUSY', 'Controlled-recovery lock ownership changed before release.');
    await unlink(path);
    await syncDirectory(dirname(path));
  }

  private busy(cause?: unknown): ControlledRecoveryError {
    return new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_BUSY', 'Controlled-recovery operation is currently locked.', cause === undefined ? undefined : { cause });
  }

  private async acquire(): Promise<() => Promise<void>> {
    // Lock order is always durable site active record, then operation process lock.
    const active = parseStrictJson(await readFile(this.activePath), 64 * 1024) as { operationId?: string; identitySha256?: string };
    if (active.operationId !== this.identity.operationId || active.identitySha256 !== digest(this.identity)) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_SITE_ACTIVE', 'Durable active-site ownership differs.');
    }
    const owner = this.newLockOwner('OPERATION');
    let ownerBytes: Buffer;
    try { ownerBytes = await this.publishLock(this.processLock, owner); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      let stale: { bytes: Buffer; owner: LockOwner };
      try { stale = await this.readLockOwner(this.processLock); }
      catch (invalidClaim) { throw this.busy(invalidClaim); }
      if (stale.owner.kind !== 'OPERATION' || this.ownerIsAlive(stale.owner)) throw this.busy(cause);
      await this.lockHooks.afterStaleOwnerObserved?.();

      const reclaimOwner = this.newLockOwner('RECLAIM');
      let reclaimBytes: Buffer;
      try { reclaimBytes = await this.publishLock(this.reclaimLock, reclaimOwner); }
      catch (reclaimCause) {
        if ((reclaimCause as NodeJS.ErrnoException).code === 'EEXIST') throw this.busy(reclaimCause);
        throw reclaimCause;
      }
      try {
        await this.lockHooks.afterReclaimLockPublished?.();
        let current: { bytes: Buffer; owner: LockOwner };
        try { current = await this.readLockOwner(this.processLock); }
        catch (revalidationCause) { throw this.busy(revalidationCause); }
        if (!current.bytes.equals(stale.bytes) || current.owner.kind !== 'OPERATION' || this.ownerIsAlive(current.owner)) {
          throw this.busy();
        }
        await unlink(this.processLock);
        await syncDirectory(dirname(this.processLock));
        try { ownerBytes = await this.publishLock(this.processLock, owner); }
        catch (claimCause) {
          if ((claimCause as NodeJS.ErrnoException).code === 'EEXIST') throw this.busy(claimCause);
          throw claimCause;
        }
      } finally {
        await this.releaseLock(this.reclaimLock, reclaimBytes);
      }
    }
    return async () => { await this.releaseLock(this.processLock, ownerBytes); };
  }

  private assertHeldLock(lock: ControlledRecoveryOperationLock): void {
    if (this.heldLock !== lock) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_BUSY', 'Controlled-recovery operation lock is not held by this execution.');
  }

  private async validateBytes(bytes: Buffer): Promise<ControlledRecoveryJournalEvent[]> {
    const lines = bytes.toString('utf8').split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (lines.some((line) => line.length === 0)) throw new Error('blank journal frame');
    let previous = ZERO;
    return lines.map((line, index) => {
      const event = validateEvent(parseStrictJson(Buffer.from(line, 'utf8'), 64 * 1024), previous, index + 1, this.identity);
      previous = event.eventSha256;
      return event;
    });
  }

  /** Repairs only a provably incomplete final JSON frame while the operation lock is held. */
  private async recoverIncompleteTail(lock: ControlledRecoveryOperationLock): Promise<void> {
    this.assertHeldLock(lock);
    const bytes = await readFile(this.journalPath);
    if (bytes.length === 0 || bytes.at(-1) === 0x0a) return;
    const newline = bytes.lastIndexOf(0x0a);
    const prefixLength = newline < 0 ? 0 : newline + 1;
    await this.validateBytes(bytes.subarray(0, prefixLength));
    const tail = bytes.subarray(prefixLength);
    try {
      const prior = await this.validateBytes(bytes.subarray(0, prefixLength));
      const value = parseStrictJson(tail, 64 * 1024);
      validateEvent(value, prior.at(-1)?.eventSha256 ?? ZERO, prior.length + 1, this.identity);
      const handle = await open(this.journalPath, 'a', 0o600);
      try { await handle.writeFile(Buffer.from('\n')); await handle.sync(); } finally { await handle.close(); }
      await syncDirectory(this.operationDirectory);
      return;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      const offset = /(?:byte|position)\s+(\d+)/i.exec(message)?.[1];
      const failedAtEnd = offset !== undefined && Number(offset) >= tail.byteLength;
      if (!/unexpected end/i.test(message) && !failedAtEnd) {
        throw new ControlledRecoveryError('CONTROLLED_RECOVERY_JOURNAL_CORRUPT', 'Controlled-recovery journal has a complete invalid trailing frame.', { cause });
      }
    }
    const handle = await open(this.journalPath, 'r+');
    try { await handle.truncate(prefixLength); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(this.operationDirectory);
  }

  async withOperationLock<T>(work: (lock: ControlledRecoveryOperationLock) => Promise<T>): Promise<T> {
    if (this.heldLock) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_BUSY', 'Controlled-recovery operation is already executing.');
    const release = await this.acquire();
    const lock = Object.freeze({}) as ControlledRecoveryOperationLock;
    this.heldLock = lock;
    try {
      await this.recoverIncompleteTail(lock);
      return await work(lock);
    } finally {
      this.heldLock = null;
      await release();
    }
  }

  private async readUnlocked(lock: ControlledRecoveryOperationLock): Promise<ControlledRecoveryJournalSnapshot> {
    this.assertHeldLock(lock);
    try {
      const bytes = await readFile(this.journalPath);
      const events = await this.validateBytes(bytes);
      const last = events.at(-1);
      const pending = [...events].reverse().find((entry) => entry.outcome === 'INTENT' && !events.some((candidate) => candidate.sequence > entry.sequence && candidate.phase === entry.phase && candidate.outcome !== 'INTENT'));
      return { identity: this.identity, events, state: last?.phase ?? 'PLANNED', pendingPhase: pending?.phase ?? null,
        ambiguous: Boolean(pending && (pending.effectTruth === 'PENDING' || pending.effectTruth === 'AMBIGUOUS')) || last?.effectTruth === 'AMBIGUOUS' };
    } catch (cause) {
      if (cause instanceof ControlledRecoveryError) throw cause;
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_JOURNAL_CORRUPT', 'Controlled-recovery journal is missing or invalid.', { cause });
    }
  }

  async read(lock?: ControlledRecoveryOperationLock): Promise<ControlledRecoveryJournalSnapshot> {
    if (lock) return this.readUnlocked(lock);
    return this.withOperationLock((held) => this.readUnlocked(held));
  }

  private async recordUnlocked(input: { phase: ControlledRecoveryState; outcome: JournalOutcome; effectTruth: EffectTruth; code: string; evidence?: unknown; now?: Date }, lock: ControlledRecoveryOperationLock): Promise<ControlledRecoveryJournalEvent> {
      const snapshot = await this.readUnlocked(lock); const previous = snapshot.events.at(-1)?.eventSha256 ?? ZERO;
      const unsigned = { format: 'darshan-controlled-recovery-journal-event-v1' as const, sequence: snapshot.events.length + 1,
        recordedAt: (input.now ?? new Date()).toISOString(), operationId: this.identity.operationId, siteId: this.identity.siteId,
        phase: input.phase, outcome: input.outcome, effectTruth: input.effectTruth, code: input.code,
        evidenceSha256: input.evidence === undefined ? null : digest(input.evidence), previousSha256: previous };
      const event = { ...unsigned, eventSha256: eventHash(unsigned) };
      const handle = await open(this.journalPath, 'a', 0o600);
      try { await handle.writeFile(canonicalJson(event)); await handle.sync(); } finally { await handle.close(); }
      await syncDirectory(this.operationDirectory);
      return event;
  }

  async record(input: { phase: ControlledRecoveryState; outcome: JournalOutcome; effectTruth: EffectTruth; code: string; evidence?: unknown; now?: Date }, lock?: ControlledRecoveryOperationLock): Promise<ControlledRecoveryJournalEvent> {
    if (lock) return this.recordUnlocked(input, lock);
    return this.withOperationLock((held) => this.recordUnlocked(input, held));
  }

  async retainAbandoned(code: string): Promise<void> {
    await this.record({ phase: 'ABANDONED_RETAINED', outcome: 'RESULT', effectTruth: 'CONFIRMED', code });
    // Packet 1 intentionally keeps the durable site-active record, source hold, workspace and owned targets.
  }
}

