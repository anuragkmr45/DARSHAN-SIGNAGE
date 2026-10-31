import { constants as fsConstants, promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { sha256RecoveryBytes } from './contracts';
import { RecoveryError } from './errors';
import { TARGET_LIFECYCLE_ACTIONS, TARGET_LIFECYCLE_STEPS, targetAuthorityHandleSchema,
  type TargetLifecycleActionV1,
  type TargetLifecycleStepV1 } from './target-engine-contracts';

export const TARGET_ENGINE_JOURNAL_FORMAT = 'darshan-recovery-target-engine-journal-v1' as const;
export const TARGET_ENGINE_JOURNAL_MAX_RECORD_BYTES = 32 * 1024;
export const TARGET_ENGINE_JOURNAL_MAX_RECORDS = 64;
const ZERO_DIGEST = '0'.repeat(64);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const u64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/);
const bindingSchema = z.object({
  operationId: uuid, siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/), hostInstallationId: uuid,
  planSha256: digest, targetSetId: digest, generation: z.number().int().positive().safe(),
  targetSpecificationSha256: digest, outerEnvelopeSha256: digest, authorizationSha256: digest,
  enrollmentSha256: digest, executionProfileSha256: digest, protectedInventorySha256: digest,
}).strict();
const stableBindingSchema = bindingSchema.omit({ outerEnvelopeSha256: true, authorizationSha256: true });
const identitySchema = z.object({ targetHandle: targetAuthorityHandleSchema, binding: stableBindingSchema }).strict();
const bodySchema = z.object({
  format: z.literal(TARGET_ENGINE_JOURNAL_FORMAT), sequence: u64, previousSha256: digest,
  targetHandle: targetAuthorityHandleSchema, binding: bindingSchema, phase: z.enum(['INTENT', 'RECEIPT']),
  action: z.enum(TARGET_LIFECYCLE_ACTIONS), step: z.enum(TARGET_LIFECYCLE_STEPS), requestId: uuid,
  commandSha256: digest.nullable(), resourceAdmissionSha256: digest,
  resultSha256: digest.nullable(), observationSha256: digest.nullable(),
  lifecycleIdentitySha256: digest.nullable(),
  terminalState: z.enum(['READY', 'STOPPED_RETAINED']).nullable(), recordedAt: z.string().datetime({ offset: false }),
}).strict();
const envelopeSchema = z.object({ body: bodySchema, recordSha256: digest }).strict();
const lockOwnerSchema = z.object({ instanceId: uuid, pid: z.number().int().positive().safe(),
  bootId: uuid, processStartTicks: u64 }).strict();

export type TargetEngineJournalBodyV1 = z.infer<typeof bodySchema>;
export type TargetEngineJournalIdentityV1 = z.infer<typeof identitySchema>;
export interface TargetEngineJournalRecordV1 { readonly body: TargetEngineJournalBodyV1; readonly recordSha256: string }
export type TargetEngineJournalFaultStage = 'after-temp-fsync-before-link' | 'after-link-before-directory-fsync' |
  'after-directory-fsync-before-temp-unlink' | 'after-lock-temp-create' | 'after-lock-link-before-temp-unlink';

export interface ScopedTargetEngineJournal {
  readonly records: readonly TargetEngineJournalRecordV1[];
  append(input: Omit<TargetEngineJournalBodyV1, 'format' | 'sequence' | 'previousSha256' |
    'targetHandle' | 'recordedAt'>): Promise<TargetEngineJournalRecordV1>;
}

function canonicalRoot(root: string): string {
  if (!isAbsolute(root) || resolve(root) !== root || root === '/' || root.endsWith(sep)) {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-engine journal root is not a safe canonical directory.');
  }
  return root;
}

function contained(root: string, ...parts: string[]): string {
  const path = resolve(root, ...parts); const suffix = relative(root, path);
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-engine journal path escaped its root.');
  }
  return path;
}

async function directory(path: string, uid: number, gid: number, device?: bigint): Promise<bigint> {
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || Number(stat.mode & 0o777n) !== 0o700 ||
      Number(stat.uid) !== uid || Number(stat.gid) !== gid || (device !== undefined && stat.dev !== device) ||
      await fs.realpath(path) !== path) {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-engine journal directory is not protected.');
  }
  return stat.dev;
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

type ProcessIdentityProbe = { status: 'PRESENT'; startTicks: string } | { status: 'ABSENT' } | { status: 'UNCERTAIN' };

async function processIdentity(pid: number): Promise<ProcessIdentityProbe> {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8'); const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).trim().split(/\s+/); const value = fields[19];
    return close > 0 && value && /^(?:0|[1-9][0-9]{0,19})$/.test(value)
      ? { status: 'PRESENT', startTicks: value } : { status: 'UNCERTAIN' };
  } catch (cause) {
    return ['ENOENT', 'ESRCH'].includes((cause as NodeJS.ErrnoException).code ?? '')
      ? { status: 'ABSENT' } : { status: 'UNCERTAIN' };
  }
}

async function bootIdentity(): Promise<string | undefined> {
  try {
    const value = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim().toLowerCase();
    return uuid.safeParse(value).success ? value : undefined;
  } catch { return undefined; }
}

async function currentLockOwner(): Promise<z.infer<typeof lockOwnerSchema>> {
  const [bootId, processIdentityValue] = await Promise.all([
    bootIdentity(),
    processIdentity(process.pid),
  ]);
  if (!bootId || processIdentityValue.status !== 'PRESENT') {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Process boot/start identity is unavailable for journal locking.');
  }
  return lockOwnerSchema.parse({ instanceId: randomUUID(), pid: process.pid, bootId,
    processStartTicks: processIdentityValue.startTicks });
}

// Defensive cleanup for an inode created by this invocation. This pathname check
// is not an atomic conditional unlink and must never be used to reclaim a lock
// published by another process.
async function unlinkExact(path: string, identity: { dev: bigint; ino: bigint }): Promise<boolean> {
  const current = await fs.lstat(path, { bigint: true }).catch(() => undefined);
  if (current?.dev !== identity.dev || current.ino !== identity.ino) return false;
  try { await fs.unlink(path); return true; }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw cause;
  }
}

async function createPublishedLock(input: { path: string; root: string; device: bigint; uid: number; gid: number;
  fault?: (stage: TargetEngineJournalFaultStage) => Promise<void> }): Promise<{ handle: Awaited<ReturnType<typeof fs.open>>;
  identity: { dev: bigint; ino: bigint } }> {
  const temp = contained(input.root, `.engine.lock.owner-${randomUUID()}`);
  const handle = await fs.open(temp,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  const created = await handle.stat({ bigint: true });
  const identity = { dev: created.dev, ino: created.ino }; let published = false;
  try {
    if (!created.isFile() || created.dev !== input.device || created.nlink !== 1n ||
        Number(created.mode & 0o777n) !== 0o600 || Number(created.uid) !== input.uid || Number(created.gid) !== input.gid) {
      throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-engine lock owner inode is unsafe.');
    }
    await input.fault?.('after-lock-temp-create');
    await handle.writeFile(canonicalJson(await currentLockOwner())); await handle.sync();
    const complete = await handle.stat({ bigint: true });
    if (complete.dev !== identity.dev || complete.ino !== identity.ino || complete.nlink !== 1n || complete.size < 1n) {
      throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-engine lock owner changed before publication.');
    }
    await fs.link(temp, input.path); published = true;
    await input.fault?.('after-lock-link-before-temp-unlink'); await fsyncDirectory(input.root);
    await unlinkExact(temp, identity); await fsyncDirectory(input.root);
    const final = await fs.lstat(input.path, { bigint: true });
    if (final.dev !== identity.dev || final.ino !== identity.ino || final.nlink !== 1n) {
      throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-engine lock publication is unstable.');
    }
    return { handle, identity };
  } catch (cause) {
    if (published) await unlinkExact(input.path, identity);
    await unlinkExact(temp, identity); await handle.close().catch(() => undefined); throw cause;
  }
}

function encodeRecord(body: TargetEngineJournalBodyV1): Buffer {
  const parsed = bodySchema.parse(body); const recordSha256 = sha256RecoveryBytes(canonicalJson(parsed));
  const bytes = canonicalJson({ body: parsed, recordSha256 });
  if (bytes.byteLength > TARGET_ENGINE_JOURNAL_MAX_RECORD_BYTES) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine journal record exceeds its reviewed bound.');
  }
  return bytes;
}

function parseRecord(bytes: Uint8Array): TargetEngineJournalRecordV1 {
  try {
    const source = Buffer.from(bytes); const value = envelopeSchema.parse(
      parseStrictJson(source, TARGET_ENGINE_JOURNAL_MAX_RECORD_BYTES));
    if (!canonicalJson(value).equals(source) || sha256RecoveryBytes(canonicalJson(value.body)) !== value.recordSha256) {
      throw new Error('noncanonical or checksum mismatch');
    }
    return value;
  } catch (cause) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine journal record is invalid.', { cause });
  }
}

async function stableRead(path: string, device: bigint, uid: number, gid: number,
  expectedLinks: 1n | 2n = 1n, readHook?: (path: string) => Promise<void>): Promise<TargetEngineJournalRecordV1> {
  let handle;
  try { handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK); }
  catch (cause) {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-engine journal record could not be opened safely.', { cause });
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== device || before.nlink !== expectedLinks || Number(before.mode & 0o777n) !== 0o600 ||
        Number(before.uid) !== uid || Number(before.gid) !== gid || before.size < 1n ||
        before.size > BigInt(TARGET_ENGINE_JOURNAL_MAX_RECORD_BYTES)) {
      throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-engine journal record metadata is unsafe.');
    }
    await readHook?.(path);
    const expected = Number(before.size); const bytes = Buffer.alloc(expected + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const [after, name] = await Promise.all([handle.stat({ bigint: true }), fs.lstat(path, { bigint: true })]);
    if (bytesRead !== expected || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== expectedLinks ||
        after.mode !== before.mode || after.uid !== before.uid || after.gid !== before.gid || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || name.isSymbolicLink() ||
        name.dev !== before.dev || name.ino !== before.ino || name.nlink !== expectedLinks || name.mode !== before.mode ||
        name.uid !== before.uid || name.gid !== before.gid || name.size !== before.size ||
        name.mtimeNs !== before.mtimeNs || name.ctimeNs !== before.ctimeNs) {
      throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine journal record changed while read.');
    }
    return parseRecord(bytes.subarray(0, expected));
  } finally { await handle.close(); }
}

async function inspectLinkedPending(input: { pending: string; target: string; targetNames: readonly string[];
  device: bigint; uid: number; gid: number }): Promise<string | undefined> {
  const pendingStat = await fs.lstat(input.pending, { bigint: true });
  if (pendingStat.isSymbolicLink() || !pendingStat.isFile() || pendingStat.dev !== input.device || pendingStat.nlink !== 2n ||
      Number(pendingStat.mode & 0o777n) !== 0o600 || Number(pendingStat.uid) !== input.uid || Number(pendingStat.gid) !== input.gid ||
      pendingStat.size < 1n || pendingStat.size > BigInt(TARGET_ENGINE_JOURNAL_MAX_RECORD_BYTES)) return undefined;
  const matches: string[] = [];
  for (const name of input.targetNames) {
    const stat = await fs.lstat(join(input.target, name), { bigint: true });
    if (!stat.isSymbolicLink() && stat.isFile() && stat.dev === pendingStat.dev && stat.ino === pendingStat.ino &&
        stat.nlink === 2n && stat.mode === pendingStat.mode && stat.uid === pendingStat.uid && stat.gid === pendingStat.gid &&
        stat.size === pendingStat.size && stat.mtimeNs === pendingStat.mtimeNs && stat.ctimeNs === pendingStat.ctimeNs) matches.push(name);
  }
  if (matches.length !== 1) return undefined;
  const handle = await fs.open(input.pending, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  let record: TargetEngineJournalRecordV1;
  try {
    const before = await handle.stat({ bigint: true }); const bytes = Buffer.alloc(Number(before.size) + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0); const after = await handle.stat({ bigint: true });
    if (bytesRead !== Number(before.size) || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 2n ||
        after.mode !== before.mode || after.uid !== before.uid || after.gid !== before.gid || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) return undefined;
    record = parseRecord(bytes.subarray(0, bytesRead));
  } finally { await handle.close(); }
  if (matches[0] !== `${record.body.sequence.padStart(20, '0')}-${record.recordSha256}.json`) return undefined;
  return matches[0];
}

function fixedSteps(action: TargetLifecycleActionV1): readonly TargetLifecycleStepV1[] {
  return action === 'PREPARE'
    ? ['ADMIT_EXISTING_RESOURCES', 'ENSURE_INTERNAL_NETWORK', 'CREATE_POSTGRES', 'CREATE_MINIO',
      'START_POSTGRES', 'START_MINIO', 'VERIFY_READY']
    : ['STOP_MINIO', 'STOP_POSTGRES', 'VERIFY_STOPPED_RETAINED'];
}

function stableBinding(value: TargetEngineJournalBodyV1['binding']): z.infer<typeof stableBindingSchema> {
  const parsed = bindingSchema.parse(value);
  return stableBindingSchema.parse({ operationId: parsed.operationId, siteId: parsed.siteId,
    hostInstallationId: parsed.hostInstallationId, planSha256: parsed.planSha256, targetSetId: parsed.targetSetId,
    generation: parsed.generation, targetSpecificationSha256: parsed.targetSpecificationSha256,
    enrollmentSha256: parsed.enrollmentSha256, executionProfileSha256: parsed.executionProfileSha256,
    protectedInventorySha256: parsed.protectedInventorySha256 });
}

function validateChain(records: readonly TargetEngineJournalRecordV1[], identity: TargetEngineJournalIdentityV1): void {
  if (records.length > TARGET_ENGINE_JOURNAL_MAX_RECORDS) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine journal is over its fixed bound.');
  let previous = ZERO_DIGEST; let action: TargetLifecycleActionV1 = 'PREPARE'; let stepIndex = 0; let phase: 'INTENT' | 'RECEIPT' = 'INTENT';
  let actionRequest: { requestId: string; binding: TargetEngineJournalBodyV1['binding'] } | undefined;
  let actionAdmissionSha256: string | undefined;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!; const body = record.body; const steps = fixedSteps(action);
    const stable = stableBinding(body.binding);
    if (phase === 'INTENT' && stepIndex === 0) {
      actionRequest = { requestId: body.requestId, binding: body.binding };
      actionAdmissionSha256 = body.resourceAdmissionSha256;
    }
    if (body.sequence !== String(index) || body.previousSha256 !== previous || body.targetHandle !== identity.targetHandle ||
        !canonicalJson(stable).equals(canonicalJson(identity.binding)) || body.action !== action ||
        body.step !== steps[stepIndex] || body.phase !== phase || !actionRequest ||
        body.requestId !== actionRequest.requestId || !canonicalJson(body.binding).equals(canonicalJson(actionRequest.binding)) ||
        body.resourceAdmissionSha256 !== actionAdmissionSha256) {
      throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine journal transition or identity is invalid.');
    }
    if (phase === 'INTENT') {
      if (body.resultSha256 !== null || body.observationSha256 !== null || body.lifecycleIdentitySha256 !== null ||
          body.terminalState !== null) {
        throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine intent contains receipt evidence.');
      }
      phase = 'RECEIPT';
    } else {
      const intent = records[index - 1];
      if (!intent || intent.body.requestId !== body.requestId ||
          !canonicalJson(intent.body.binding).equals(canonicalJson(body.binding)) ||
          intent.body.commandSha256 !== body.commandSha256 ||
          intent.body.resourceAdmissionSha256 !== body.resourceAdmissionSha256) {
        throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine receipt differs from its exact intent request binding.');
      }
      if (body.resultSha256 === null || body.observationSha256 === null || body.lifecycleIdentitySha256 === null ||
          (body.step === 'VERIFY_READY') !== (body.terminalState === 'READY') ||
          (body.step === 'VERIFY_STOPPED_RETAINED') !== (body.terminalState === 'STOPPED_RETAINED') ||
          (!['VERIFY_READY', 'VERIFY_STOPPED_RETAINED'].includes(body.step) && body.terminalState !== null)) {
        throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine receipt evidence is incomplete.');
      }
      phase = 'INTENT'; stepIndex += 1;
      if (stepIndex === steps.length && action === 'PREPARE') {
        action = 'STOP_RETAIN'; stepIndex = 0; actionRequest = undefined; actionAdmissionSha256 = undefined;
      }
      else if (stepIndex === steps.length && action === 'STOP_RETAIN' && index + 1 !== records.length) {
        throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine journal has records after its terminal stop receipt.');
      }
    }
    previous = record.recordSha256;
  }
}

export class TargetEngineJournal {
  private readonly root: string; private readonly uid: number; private readonly gid: number;
  private readonly now: () => Date; private readonly fault?: (stage: TargetEngineJournalFaultStage) => Promise<void>;
  private readonly readHook?: (path: string) => Promise<void>;
  constructor(input: { root: string; expectedUid?: number; expectedGid?: number; now?: () => Date;
    fault?: (stage: TargetEngineJournalFaultStage) => Promise<void>; readHook?: (path: string) => Promise<void> }) {
    this.root = canonicalRoot(input.root); this.uid = input.expectedUid ?? process.getuid?.() ?? -1;
    this.gid = input.expectedGid ?? process.getgid?.() ?? -1; this.now = input.now ?? (() => new Date()); this.fault = input.fault;
    this.readHook = input.readHook;
    if (!Number.isSafeInteger(this.uid) || this.uid < 0 || !Number.isSafeInteger(this.gid) || this.gid < 0) {
      throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Target-engine journal owner is unavailable.');
    }
  }

  private async readDirectory(path: string, device: bigint, identity: TargetEngineJournalIdentityV1,
    reconcilePublication: boolean): Promise<TargetEngineJournalRecordV1[]> {
    const allNames = await fs.readdir(path); const names = allNames.filter((name) => name !== '.pending').sort();
    const linkedFinals = new Set<string>();
    if (allNames.includes('.pending')) {
      const pending = join(path, '.pending'); await directory(pending, this.uid, this.gid, device);
      const pendingNames = await fs.readdir(pending);
      let reconciled = false;
      for (const pendingName of pendingNames) {
        const pendingPath = join(pending, pendingName);
        const linked = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/.test(pendingName)
          ? await inspectLinkedPending({ pending: pendingPath, target: path,
            targetNames: names, device, uid: this.uid, gid: this.gid }) : undefined;
        if (!linked) {
          throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT',
            'Target-engine journal has retained pending publication evidence.');
        }
        if (reconcilePublication) { await fs.unlink(pendingPath); reconciled = true; }
        else linkedFinals.add(linked);
      }
      if (reconciled) await fsyncDirectory(pending);
      if (reconcilePublication && (await fs.readdir(pending)).length !== 0) {
        throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT',
          'Target-engine journal has retained pending publication evidence.');
      }
    }
    if (names.length > TARGET_ENGINE_JOURNAL_MAX_RECORDS || names.some((name, index) =>
      !new RegExp(`^${String(index).padStart(20, '0')}-[a-f0-9]{64}\\.json$`).test(name))) {
      throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine journal filenames are not contiguous canonical records.');
    }
    const records: TargetEngineJournalRecordV1[] = [];
    for (const name of names) {
      const record = await stableRead(join(path, name), device, this.uid, this.gid,
        linkedFinals.has(name) ? 2n : 1n, this.readHook);
      if (name !== `${record.body.sequence.padStart(20, '0')}-${record.recordSha256}.json`) {
        throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-engine journal filename does not bind its record.');
      }
      records.push(record);
    }
    validateChain(records, identity); return records;
  }

  private async publish(path: string, bytes: Buffer, record: TargetEngineJournalRecordV1, device: bigint): Promise<void> {
    const pending = join(path, '.pending'); await fs.mkdir(pending, { mode: 0o700 }).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== 'EEXIST') throw cause;
    });
    await directory(pending, this.uid, this.gid, device);
    const temp = join(pending, `${randomUUID()}.tmp`); const destination = join(path,
      `${record.body.sequence.padStart(20, '0')}-${record.recordSha256}.json`);
    const handle = await fs.open(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.dev !== device || stat.nlink !== 1n || Number(stat.mode & 0o777n) !== 0o600 ||
          Number(stat.uid) !== this.uid || Number(stat.gid) !== this.gid) throw new Error('unsafe journal temp');
      await handle.writeFile(bytes); await handle.sync();
    } finally { await handle.close(); }
    try {
      await this.fault?.('after-temp-fsync-before-link'); await fs.link(temp, destination);
      await this.fault?.('after-link-before-directory-fsync'); await fsyncDirectory(path);
      await this.fault?.('after-directory-fsync-before-temp-unlink'); await fs.unlink(temp); await fsyncDirectory(pending);
      await stableRead(destination, device, this.uid, this.gid);
    } catch (cause) {
      await fs.unlink(temp).catch(() => undefined);
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Target-engine journal publication conflicts with an existing record.', { cause });
      }
      throw cause;
    }
  }

  async withTarget<T>(rawIdentity: TargetEngineJournalIdentityV1, callback: (journal: ScopedTargetEngineJournal) => Promise<T>): Promise<T> {
    const identity = identitySchema.parse(rawIdentity); const device = await directory(this.root, this.uid, this.gid);
    const lock = contained(this.root, '.engine.lock'); let acquired;
    const create = () => createPublishedLock({ path: lock, root: this.root, device, uid: this.uid, gid: this.gid,
      fault: this.fault });
    const existing = await fs.lstat(lock, { bigint: true }).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ENOENT') return undefined; throw cause;
    });
    if (existing) throw new RecoveryError('RECOVERY_LOCK_HELD',
      'Target-engine journal lock exists; JavaScript lock recovery is intentionally unavailable.');
    try { acquired = await create(); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new RecoveryError('RECOVERY_LOCK_HELD', 'Target-engine journal lock is held.', { cause });
      }
      else throw cause;
    }
    const lockHandle = acquired.handle; const ownedLock = acquired.identity;
    try {
      await lockHandle.close();
      const targets = contained(this.root, 'targets'); await fs.mkdir(targets, { mode: 0o700 }).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== 'EEXIST') throw cause;
      });
      await directory(targets, this.uid, this.gid, device); await fsyncDirectory(this.root);
      const target = contained(targets, identity.binding.targetSetId); await fs.mkdir(target, { mode: 0o700 }).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== 'EEXIST') throw cause;
      });
      await directory(target, this.uid, this.gid, device); await fsyncDirectory(targets);
      const records = await this.readDirectory(target, device, identity, true);
      const scoped: ScopedTargetEngineJournal = { records,
        append: async (input) => {
          const existing = records.find((record) => record.body.requestId === input.requestId &&
            record.body.action === input.action && record.body.step === input.step && record.body.phase === input.phase);
          const prior = records.at(-1); const body = bodySchema.parse({ ...input, format: TARGET_ENGINE_JOURNAL_FORMAT,
            sequence: String(records.length), previousSha256: prior?.recordSha256 ?? ZERO_DIGEST,
            targetHandle: identity.targetHandle, binding: input.binding, recordedAt: this.now().toISOString() });
          const encoded = encodeRecord(body); const parsed = parseRecord(encoded);
          if (existing) {
            if (!canonicalJson(existing.body).equals(canonicalJson({ ...body, sequence: existing.body.sequence,
              previousSha256: existing.body.previousSha256, recordedAt: existing.body.recordedAt }))) {
              throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Target-engine journal exact duplicate differs.');
            }
            return existing;
          }
          if (prior?.body.phase === 'INTENT' && input.phase === 'INTENT') {
            throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'A different target-engine intent is pending.');
          }
          const candidate = [...records, parsed]; validateChain(candidate, identity); await this.publish(target, encoded, parsed, device);
          records.push(parsed); return parsed;
        } };
      return await callback(scoped);
    } finally {
      await lockHandle.close().catch(() => undefined);
      await unlinkExact(lock, ownedLock);
      await fsyncDirectory(this.root).catch(() => undefined);
    }
  }

  async read(identity: TargetEngineJournalIdentityV1): Promise<readonly TargetEngineJournalRecordV1[]> {
    const parsed = identitySchema.parse(identity); const device = await directory(this.root, this.uid, this.gid);
    try {
      const targets = contained(this.root, 'targets'); await directory(targets, this.uid, this.gid, device);
      const target = contained(targets, parsed.binding.targetSetId); await directory(target, this.uid, this.gid, device);
      return await this.readDirectory(target, device, parsed, false);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
  }
}

