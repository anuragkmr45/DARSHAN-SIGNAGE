import { constants as fsConstants, promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RECOVERY_PLAN_FORMAT_V2, RECOVERY_PLAN_FORMAT_V3, RECOVERY_PLAN_FORMAT_V4,
  RECOVERY_TARGET_SET_DERIVATION_V2, RECOVERY_TARGET_TOPOLOGY_MODES,
  assertCanonicalTimestamp, recoveryDigest, recoverySourceDescriptorV2Digest, recoveryTargetSetId,
  recoveryTargetSetIdV2, recoveryUuid, sha256RecoveryBytes, type RecoveryPlanV2, type RecoveryPlanV3,
  type RecoveryPlanV4 } from './contracts';
import { RecoveryError } from './errors';
import { readProtectedOperatorFile, type ProtectedOperatorReadHooks } from './operator-inputs';
import { RELEASE_RECOVERY_TARGET } from './release-target';

const MAX_PLAN_BYTES = 256 * 1024;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const sourceSchema = z.object({
  kind: z.literal('LOCAL_FILESYSTEM_V2'), siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  repositoryId: uuid, runId: uuid, attemptId: uuid, captureId: uuid,
  captureGeneration: z.number().int().positive().safe(), manifestSha256: sha256,
  releaseId: z.string().min(1).max(128), schemaMigrationId: z.string().min(1).max(255),
  schemaFingerprintSha256: sha256, repositoryDescriptorSha256: sha256, descriptorSha256: sha256, fullyEligible: z.literal(true),
}).strict();
const planCommon = {
  planId: uuid, operationId: uuid,
  createdAt: z.string().datetime({ offset: true }), source: sourceSchema,
  target: z.object({ targetId: z.literal('darshan-server-release-01'), releaseId: z.literal('release-01'),
    terminalMigrationId: z.string().min(1).max(255), migrationManifestSha256: sha256 }).strict(),
  compatibility: z.object({ classification: z.enum(['COMPATIBLE_CURRENT', 'COMPATIBLE_FORWARD']),
    targetReleaseId: z.string().min(1).max(128), targetSchemaMigrationId: z.string().min(1).max(255),
    pendingMigrationIds: z.array(z.string().min(1).max(255)).max(4096) }).strict(),
};
const planV2Schema = z.object({ format: z.literal(RECOVERY_PLAN_FORMAT_V2), ...planCommon }).strict();
const targetPreparationSchema = z.object({
  targetSetId: sha256,
  generation: z.number().int().positive().safe(),
  hostInstallationId: uuid,
  topologyMode: z.enum(RECOVERY_TARGET_TOPOLOGY_MODES),
  hostPolicySha256: sha256,
  helperRoleSha256: sha256,
  engineProfileSha256: sha256,
  protectionInventorySha256: sha256,
  capacityEvidenceSha256: sha256,
  storageInventorySha256: sha256,
  targetSpecificationSha256: sha256,
}).strict();
const planV3Schema = z.object({ format: z.literal(RECOVERY_PLAN_FORMAT_V3), ...planCommon,
  targetPreparation: targetPreparationSchema }).strict();
const targetPreparationV2Schema = z.object({
  derivationVersion: z.literal(RECOVERY_TARGET_SET_DERIVATION_V2), targetSetId: sha256,
  generation: z.number().int().positive().safe(), hostInstallationId: uuid,
  topologyMode: z.enum(RECOVERY_TARGET_TOPOLOGY_MODES), helperRoleSha256: sha256,
  hostPolicyEnvelopeSha256: sha256, engineProfileEnvelopeSha256: sha256,
  storageInventoryEnvelopeSha256: sha256, protectionInventoryEnvelopeSha256: sha256,
  capacityEvidenceEnvelopeSha256: sha256, targetSpecificationSha256: sha256,
  operationAttestationSha256: sha256,
}).strict();
const planV4Schema = z.object({ format: z.literal(RECOVERY_PLAN_FORMAT_V4), ...planCommon,
  targetPreparation: targetPreparationV2Schema }).strict();
const planSchema = z.discriminatedUnion('format', [planV2Schema, planV3Schema, planV4Schema]);

export function parseRecoveryPlanFile(bytes: Uint8Array, expectedSha256?: string): RecoveryPlanV2 | RecoveryPlanV3 | RecoveryPlanV4 {
  try {
    const buffer = Buffer.from(bytes);
    if (expectedSha256 !== undefined && sha256RecoveryBytes(buffer) !== recoveryDigest(expectedSha256, 'expectedPlanSha256')) {
      throw new Error('plan digest mismatch');
    }
    const plan = planSchema.parse(parseStrictJson(buffer, MAX_PLAN_BYTES));
    if (!canonicalJson(plan).equals(buffer)) throw new Error('plan is not canonical JSON');
    for (const [value, label] of [[plan.planId, 'planId'], [plan.operationId, 'operationId'],
      [plan.source.repositoryId, 'repositoryId'], [plan.source.runId, 'runId'], [plan.source.attemptId, 'attemptId'],
      [plan.source.captureId, 'captureId']] as const) {
      if (recoveryUuid(value, label) !== value) throw new Error(`${label} is not lowercase canonical UUID`);
    }
    assertCanonicalTimestamp(plan.createdAt, 'createdAt');
    if (recoverySourceDescriptorV2Digest(plan.source) !== plan.source.descriptorSha256) {
      throw new Error('source descriptor digest mismatch');
    }
    if (plan.compatibility.targetReleaseId !== plan.target.releaseId ||
        plan.compatibility.targetSchemaMigrationId !== plan.target.terminalMigrationId) throw new Error('target identity mismatch');
    if (plan.target.targetId !== RELEASE_RECOVERY_TARGET.targetId || plan.target.releaseId !== RELEASE_RECOVERY_TARGET.releaseId ||
        plan.target.terminalMigrationId !== RELEASE_RECOVERY_TARGET.terminalMigrationId ||
        plan.target.migrationManifestSha256 !== RELEASE_RECOVERY_TARGET.migrationManifestSha256) {
      throw new Error('plan target does not match release-owned recovery target');
    }
    if (plan.format === RECOVERY_PLAN_FORMAT_V3) {
      const { targetSetId, ...identity } = plan.targetPreparation;
      if (recoveryTargetSetId(identity) !== targetSetId) throw new Error('target set identity digest mismatch');
      if (recoveryUuid(plan.targetPreparation.hostInstallationId, 'hostInstallationId') !== plan.targetPreparation.hostInstallationId) {
        throw new Error('hostInstallationId is not lowercase canonical UUID');
      }
    } else if (plan.format === RECOVERY_PLAN_FORMAT_V4) {
      const preparation = plan.targetPreparation;
      if (recoveryTargetSetIdV2({ targetSpecificationSha256: preparation.targetSpecificationSha256,
        operationId: plan.operationId, generation: preparation.generation,
        hostInstallationId: preparation.hostInstallationId }) !== preparation.targetSetId) {
        throw new Error('target set identity v2 digest mismatch');
      }
      if (recoveryUuid(preparation.hostInstallationId, 'hostInstallationId') !== preparation.hostInstallationId) {
        throw new Error('hostInstallationId is not lowercase canonical UUID');
      }
    }
    return plan as RecoveryPlanV2 | RecoveryPlanV3 | RecoveryPlanV4;
  } catch (cause) {
    throw new RecoveryError('RECOVERY_PLAN_CORRUPT', 'Recovery plan file is invalid, non-canonical, or has the wrong digest.', { cause });
  }
}

export function requireEffectEligibleRecoveryPlan(plan: RecoveryPlanV2 | RecoveryPlanV3 | RecoveryPlanV4): RecoveryPlanV4 {
  if (plan.format !== RECOVERY_PLAN_FORMAT_V4) {
    throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE',
      'Historical recovery plans remain readable but are target-effect-ineligible.');
  }
  return plan;
}

export async function readRecoveryPlanFile(input: {
  path: string; expectedSha256: string; expectedUid?: number; expectedGid?: number; hooks?: ProtectedOperatorReadHooks;
  signal?: AbortSignal;
}): Promise<RecoveryPlanV2 | RecoveryPlanV3 | RecoveryPlanV4> {
  const expectedUid = input.expectedUid ?? process.getuid?.(); const expectedGid = input.expectedGid ?? process.getgid?.();
  if (expectedUid === undefined || expectedGid === undefined) throw new RecoveryError('RECOVERY_PLAN_UNSAFE', 'Plan ownership cannot be established.');
  try {
    const bytes = await readProtectedOperatorFile({ path: input.path, maximumBytes: MAX_PLAN_BYTES, expectedUid, expectedGid,
      hooks: input.hooks, signal: input.signal });
    return parseRecoveryPlanFile(bytes, input.expectedSha256);
  } catch (cause) {
    if (cause instanceof RecoveryError && (cause.code === 'RECOVERY_PLAN_CORRUPT' || cause.code === 'RECOVERY_CANCELLED')) throw cause;
    throw new RecoveryError('RECOVERY_PLAN_UNSAFE', 'Recovery plan could not be read safely.', { cause });
  }
}

export interface RecoveryPlanFileOperations {
  syncFile(handle: Awaited<ReturnType<typeof fs.open>>): Promise<void>;
  syncDirectory(handle: Awaited<ReturnType<typeof fs.open>>, path: string): Promise<void>;
  beforeCreate?(parentHandle: Awaited<ReturnType<typeof fs.open>>, originalPath: string, anchoredPath: string): Promise<void>;
}

const defaultOperations: RecoveryPlanFileOperations = {
  async syncFile(handle) { await handle.sync(); },
  async syncDirectory(handle) { await handle.sync(); },
};

async function verifyPlanReadback(input: {
  handle: Awaited<ReturnType<typeof fs.open>>;
  anchoredPath: string;
  originalPath: string;
  expectedBytes: Buffer;
  expectedDevice: bigint;
  expectedInode: bigint;
  expectedUid: number;
  expectedGid: number;
}): Promise<string> {
  const before = await input.handle.stat({ bigint: true });
  if (!before.isFile() || before.dev !== input.expectedDevice || before.ino !== input.expectedInode || before.nlink !== 1n ||
      before.size !== BigInt(input.expectedBytes.byteLength) || Number(before.uid) !== input.expectedUid ||
      Number(before.gid) !== input.expectedGid || Number(before.mode & 0o777n) !== 0o600) {
    throw new Error('created plan file metadata changed before readback');
  }
  const chunks: Buffer[] = []; let offset = 0; const expected = input.expectedBytes.byteLength;
  while (offset <= expected) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, expected + 1 - offset));
    const { bytesRead } = await input.handle.read(chunk, 0, chunk.byteLength, offset);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead)); offset += bytesRead;
    if (offset > expected) break;
  }
  const bytes = Buffer.concat(chunks, Math.min(offset, expected));
  const [after, anchored, original] = await Promise.all([
    input.handle.stat({ bigint: true }), fs.lstat(input.anchoredPath, { bigint: true }), fs.lstat(input.originalPath, { bigint: true }),
  ]);
  if (offset !== expected || !bytes.equals(input.expectedBytes) || after.dev !== before.dev || after.ino !== before.ino ||
      after.nlink !== before.nlink || after.size !== before.size || after.uid !== before.uid || after.gid !== before.gid ||
      after.mode !== before.mode || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs ||
      anchored.isSymbolicLink() || anchored.dev !== before.dev || anchored.ino !== before.ino || anchored.nlink !== 1n ||
      original.isSymbolicLink() || original.dev !== before.dev || original.ino !== before.ino || original.nlink !== 1n) {
    throw new Error('created plan bytes or identity changed during readback');
  }
  return sha256RecoveryBytes(bytes);
}

export async function writeRecoveryPlanFile(input: {
  path: string;
  bytes: Buffer;
  expectedUid?: number;
  expectedGid?: number;
  operations?: Partial<RecoveryPlanFileOperations>;
  signal?: AbortSignal;
}): Promise<{ path: string; sha256: string }> {
  input.signal?.throwIfAborted();
  const expectedUid = input.expectedUid ?? process.getuid?.(); const expectedGid = input.expectedGid ?? process.getgid?.();
  if (expectedUid === undefined || expectedGid === undefined || !isAbsolute(input.path) || resolve(input.path) !== input.path ||
      input.path.endsWith(sep) || input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_PLAN_BYTES) {
    throw new RecoveryError('RECOVERY_PLAN_UNSAFE', 'Plan output path or bytes are outside the reviewed bounds.');
  }
  parseRecoveryPlanFile(input.bytes);
  const parent = dirname(input.path);
  const name = basename(input.path);
  if (!name || name === '.' || name === '..' || Buffer.byteLength(name, 'utf8') > 255 || /[\\/\0]/.test(name)) {
    throw new RecoveryError('RECOVERY_PLAN_UNSAFE', 'Plan output filename is outside the reviewed bounds.');
  }
  let parentStat;
  try { parentStat = await fs.lstat(parent, { bigint: true }); }
  catch (cause) { throw new RecoveryError('RECOVERY_PLAN_UNSAFE', 'Plan output parent must already exist.', { cause }); }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory() || Number(parentStat.uid) !== expectedUid ||
      Number(parentStat.gid) !== expectedGid || Number(parentStat.mode & 0o777n) !== 0o700 || await fs.realpath(parent) !== parent) {
    throw new RecoveryError('RECOVERY_PLAN_UNSAFE', 'Plan output parent must be a canonical owner-only existing directory.');
  }
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let parentHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let createdIdentity: { dev: bigint; ino: bigint } | undefined;
  const operations = { ...defaultOperations, ...input.operations };
  try {
    parentHandle = await fs.open(parent, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    const openedParent = await parentHandle.stat({ bigint: true });
    if (!openedParent.isDirectory() || openedParent.dev !== parentStat.dev || openedParent.ino !== parentStat.ino ||
        openedParent.uid !== parentStat.uid || openedParent.gid !== parentStat.gid || openedParent.mode !== parentStat.mode) {
      throw new Error('plan output parent changed before create');
    }
    const anchoredPath = `/proc/self/fd/${parentHandle.fd}/${name}`;
    await operations.beforeCreate?.(parentHandle, input.path, anchoredPath);
    input.signal?.throwIfAborted();
    try { handle = await fs.open(anchoredPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new RecoveryError('RECOVERY_PLAN_EXISTS', 'Recovery plan output already exists; it will not be overwritten.', { cause });
      throw cause;
    }
    const opened = await handle.stat({ bigint: true }); createdIdentity = { dev: opened.dev, ino: opened.ino };
    if (!opened.isFile() || opened.nlink !== 1n || Number(opened.uid) !== expectedUid || Number(opened.gid) !== expectedGid ||
        Number(opened.mode & 0o777n) !== 0o600 || opened.dev !== parentStat.dev) throw new Error('unsafe created plan file');
    let offset = 0;
    while (offset < input.bytes.byteLength) {
      input.signal?.throwIfAborted();
      const { bytesWritten } = await handle.write(input.bytes, offset, input.bytes.byteLength - offset, offset);
      if (bytesWritten < 1) throw new Error('plan write made no progress');
      offset += bytesWritten;
    }
    await operations.syncFile(handle);
    input.signal?.throwIfAborted();
    const firstDigest = await verifyPlanReadback({ handle, anchoredPath, originalPath: input.path, expectedBytes: input.bytes,
      expectedDevice: opened.dev, expectedInode: opened.ino, expectedUid, expectedGid });
    const finalParent = await fs.lstat(parent, { bigint: true });
    if (finalParent.isSymbolicLink() || !finalParent.isDirectory() || finalParent.dev !== parentStat.dev ||
        finalParent.ino !== parentStat.ino || finalParent.uid !== parentStat.uid || finalParent.gid !== parentStat.gid ||
        finalParent.mode !== parentStat.mode || await fs.realpath(parent) !== parent) {
      throw new Error('plan output parent changed before durability boundary');
    }
    await operations.syncDirectory(parentHandle, parent);
    const secondDigest = await verifyPlanReadback({ handle, anchoredPath, originalPath: input.path, expectedBytes: input.bytes,
      expectedDevice: opened.dev, expectedInode: opened.ino, expectedUid, expectedGid });
    const durableParent = await fs.lstat(parent, { bigint: true });
    if (durableParent.isSymbolicLink() || !durableParent.isDirectory() || durableParent.dev !== parentStat.dev ||
        durableParent.ino !== parentStat.ino || durableParent.uid !== parentStat.uid || durableParent.gid !== parentStat.gid ||
        durableParent.mode !== parentStat.mode || await fs.realpath(parent) !== parent || secondDigest !== firstDigest) {
      throw new Error('plan output path changed across parent durability boundary');
    }
    await handle.close(); handle = undefined;
    await parentHandle.close(); parentHandle = undefined;
    return { path: input.path, sha256: secondDigest };
  } catch (cause) {
    await handle?.close().catch(() => undefined);
    await parentHandle?.close().catch(() => undefined);
    // Node 20 exposes no unlinkat-by-directory-fd primitive. Once creation has
    // occurred, retain the exact exclusive inode on any uncertain failure
    // rather than risk deleting a pathname replacement after a TOCTOU race.
    void createdIdentity;
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_PLAN_WRITE_FAILED', 'Recovery plan could not be written durably.', { cause });
  }
}
