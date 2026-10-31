import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { targetAuthorityHandleSchema } from './target-engine-contracts';
import { parseTargetNativeEngineInspectionV3, targetNativeEngineInspectionV3Sha256,
  type TargetNativeEngineCommandV3, type TargetNativeEngineInspectionV3 } from './target-native-engine-contracts';

export const TARGET_ENGINE_MATERIALIZATION_MAX_RECORD_BYTES = 64 * 1024;
export const TARGET_ENGINE_MATERIALIZATION_MAX_RECORDS = 256;
export const TARGET_ENGINE_MATERIALIZATION_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const ZERO_SHA256 = '0'.repeat(64);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const positiveU64 = z.string().regex(/^[1-9][0-9]{0,19}$/).refine((value) => BigInt(value) <= 0xffff_ffff_ffff_ffffn);
const resourceId = z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/);

const materializationIdentity = {
  operationId: uuid,
  operation: z.enum(['ENSURE_INTERNAL_NETWORK', 'CREATE_POSTGRES', 'CREATE_MINIO']),
  targetHandle: targetAuthorityHandleSchema,
  generation: positiveU64,
  role: z.enum(['NETWORK', 'POSTGRES', 'MINIO']),
  resourceAuthorityHandle: targetAuthorityHandleSchema,
  profileSha256: digest,
  admissionSha256: digest,
  commandSha256: digest,
  commandNonce: z.string().regex(/^[a-f0-9]{32}$/),
};
const intentBodySchema = z.object({
  format: z.literal('darshan-recovery-target-materialization-intent-v2'),
  kind: z.literal('INTENT'), sequence: positiveU64,
  ...materializationIdentity,
  previousHeadSha256: digest,
}).strict();
const intentSchema = intentBodySchema.extend({ recordSha256: digest }).strict();
const actualResourceSchema = z.object({
  resourceId: resourceId.nullable(), imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  imageConfigSha256: digest.nullable(), effectiveConfigurationSha256: digest.nullable(),
  ownerLabelsSha256: digest.nullable(), consumerSetSha256: digest.nullable(),
  daemonIdentitySha256: digest.nullable(),
}).strict();
const receiptBodySchema = z.object({
  format: z.literal('darshan-recovery-target-materialization-receipt-v2'),
  kind: z.literal('RECEIPT'), sequence: positiveU64,
  ...materializationIdentity,
  previousHeadSha256: digest, intentRecordSha256: digest,
  observationSha256: digest, outcome: z.enum(['COMPLETE', 'AMBIGUOUS']),
  actual: actualResourceSchema,
}).strict();
const receiptSchema = receiptBodySchema.extend({ recordSha256: digest }).strict();
const recordSchema = z.union([intentSchema, receiptSchema]);

export type TargetEngineMaterializationIntent = z.infer<typeof intentSchema>;
export type TargetEngineMaterializationReceipt = z.infer<typeof receiptSchema>;
export type TargetEngineMaterializationRecord = z.infer<typeof recordSchema>;
export type TargetEngineActualResource = z.infer<typeof actualResourceSchema>;

export interface TargetEngineMaterializationStore {
  readonly inodeBound: number;
  scan(signal: AbortSignal): Promise<readonly Uint8Array[]>;
  publishNoClobber(recordSha256: string, bytes: Uint8Array, signal: AbortSignal): Promise<'PUBLISHED' | 'EXACT_REPLAY'>;
}

function body(record: TargetEngineMaterializationRecord): z.infer<typeof intentBodySchema> | z.infer<typeof receiptBodySchema> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'recordSha256')) as
    z.infer<typeof intentBodySchema> | z.infer<typeof receiptBodySchema>;
}
function recordHash(record: TargetEngineMaterializationRecord): string {
  return createHash('sha256').update(canonicalJson(body(record))).digest('hex');
}
function validateRecordSemantics(record: TargetEngineMaterializationRecord): void {
  const expectedRole = record.operation === 'ENSURE_INTERNAL_NETWORK' ? 'NETWORK' :
    record.operation === 'CREATE_POSTGRES' ? 'POSTGRES' : 'MINIO';
  if (record.role !== expectedRole) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID',
      'Materialization operation and role are semantically inconsistent.');
  }
  if (record.kind === 'INTENT') return;
  const values = Object.values(record.actual);
  if (record.outcome === 'AMBIGUOUS') {
    if (values.some((value) => value !== null)) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID',
        'Ambiguous materialization receipt must keep every actual identity null.');
    }
    return;
  }
  const actual = record.actual;
  if (actual.resourceId === null || actual.effectiveConfigurationSha256 === null ||
      actual.ownerLabelsSha256 === null || actual.consumerSetSha256 === null ||
      actual.daemonIdentitySha256 === null ||
      (record.role === 'NETWORK' ? actual.imageId !== null || actual.imageConfigSha256 !== null :
        actual.imageId === null || actual.imageConfigSha256 === null)) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID',
      'Complete materialization receipt lacks the exact role-specific actual identities.');
  }
}
function encodeRecord(record: TargetEngineMaterializationRecord): Buffer {
  const parsed = recordSchema.parse(record); validateRecordSemantics(parsed);
  if (recordHash(parsed) !== parsed.recordSha256) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Materialization record self-hash differs.');
  }
  const bytes = canonicalJson(parsed);
  if (bytes.byteLength > TARGET_ENGINE_MATERIALIZATION_MAX_RECORD_BYTES) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Materialization record exceeds 64 KiB.');
  }
  return bytes;
}
function parseRecord(bytes: Uint8Array): TargetEngineMaterializationRecord {
  try {
    const source = Buffer.from(bytes);
    if (!source.byteLength || source.byteLength > TARGET_ENGINE_MATERIALIZATION_MAX_RECORD_BYTES) throw new Error('size');
    const parsed = recordSchema.parse(parseStrictJson(source, TARGET_ENGINE_MATERIALIZATION_MAX_RECORD_BYTES));
    validateRecordSemantics(parsed);
    if (!encodeRecord(parsed).equals(source)) throw new Error('canonical');
    return parsed;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Materialization record is not canonical bounded data.', { cause });
  }
}
export { encodeRecord as encodeTargetEngineMaterializationRecord,
  parseRecord as parseTargetEngineMaterializationRecord };

function freezeRecord<T extends TargetEngineMaterializationRecord>(record: T): T {
  return Object.freeze(record) as T;
}
function withHash<T extends z.infer<typeof intentBodySchema> | z.infer<typeof receiptBodySchema>>(value: T):
    T & { recordSha256: string } {
  return { ...value, recordSha256: createHash('sha256').update(canonicalJson(value)).digest('hex') };
}

export function fixedTargetOwnershipLabels(input: {
  operationId: string; targetHandle: string; generation: string; role: 'NETWORK' | 'POSTGRES' | 'MINIO';
  resourceAuthorityHandle: string; profileSha256: string; commandNonce: string;
}): Readonly<Record<string, string>> {
  return Object.freeze({
    'com.darshan.recovery.owner': 'darshan-recovery',
    'com.darshan.recovery.operation-id': input.operationId,
    'com.darshan.recovery.target-handle': input.targetHandle,
    'com.darshan.recovery.generation': input.generation,
    'com.darshan.recovery.role': input.role,
    'com.darshan.recovery.resource-handle': input.resourceAuthorityHandle,
    'com.darshan.recovery.profile-sha256': input.profileSha256,
    'com.darshan.recovery.command-nonce': input.commandNonce,
  });
}

export function targetOwnershipLabelsSha256(labels: Readonly<Record<string, string>>): string {
  return createHash('sha256').update(canonicalJson(labels)).digest('hex');
}

function assertIdentity(record: TargetEngineMaterializationRecord, expected: TargetEngineMaterializationIntent): void {
  for (const key of ['operationId', 'targetHandle', 'generation', 'role', 'resourceAuthorityHandle',
    'operation', 'profileSha256', 'admissionSha256', 'commandSha256', 'commandNonce'] as const) {
    if (record[key] !== expected[key]) {
      throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', `Materialization ${key} conflicts with durable intent.`);
    }
  }
}

export class TargetEngineMaterializationJournal {
  constructor(private readonly store: TargetEngineMaterializationStore) {
    if (!Number.isSafeInteger(store.inodeBound) || store.inodeBound < 1 ||
        store.inodeBound > TARGET_ENGINE_MATERIALIZATION_MAX_RECORDS) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Materialization store inode bound is outside the reviewed limit.');
    }
  }

  async scan(signal: AbortSignal): Promise<readonly TargetEngineMaterializationRecord[]> {
    signal.throwIfAborted(); const entries = await this.store.scan(signal); signal.throwIfAborted();
    if (entries.length > this.store.inodeBound || entries.length > TARGET_ENGINE_MATERIALIZATION_MAX_RECORDS ||
        entries.reduce((total, entry) => total + entry.byteLength, 0) > TARGET_ENGINE_MATERIALIZATION_MAX_TOTAL_BYTES) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Materialization scan exceeds record, byte, or inode bounds.');
    }
    const records = entries.map(parseRecord); let head = ZERO_SHA256;
    const pending = new Map<string, TargetEngineMaterializationIntent>();
    const commands = new Set<string>();
    records.forEach((record, index) => {
      if (record.sequence !== String(index + 1) || record.previousHeadSha256 !== head) {
        throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Materialization hash chain is incomplete or reordered.');
      }
      if (record.kind === 'INTENT') {
        if (commands.has(record.commandSha256)) {
          throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Materialization command has duplicate durable intent.');
        }
        commands.add(record.commandSha256); pending.set(record.recordSha256, record);
      } else {
        const intent = pending.get(record.intentRecordSha256);
        if (!intent) {
          throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Materialization receipt is orphaned or duplicated.');
        }
        assertIdentity(record, intent); pending.delete(record.intentRecordSha256);
      }
      head = record.recordSha256;
    });
    return Object.freeze(records.map(freezeRecord));
  }

  async publishIntent(command: TargetNativeEngineCommandV3, signal: AbortSignal): Promise<TargetEngineMaterializationIntent> {
    if (command.operation === 'INSPECT_TARGET') {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Readonly inspection cannot publish materialization intent.');
    }
    const records = await this.scan(signal); const head = records.at(-1)?.recordSha256 ?? ZERO_SHA256;
    if (!command.role) throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Materialization command role is absent.');
    const commandSha256 = createHash('sha256').update(canonicalJson(command)).digest('hex');
    const same = records.find((record) => record.kind === 'INTENT' && record.commandSha256 === commandSha256);
    if (same) {
      const intent = same as TargetEngineMaterializationIntent;
      const expected = { operationId: command.binding.operationId, operation: command.operation, targetHandle: command.targetHandle,
        generation: command.binding.generation, role: command.role, resourceAuthorityHandle: command.resourceAuthorityHandle,
        profileSha256: command.binding.profileSha256, admissionSha256: command.binding.admissionSha256,
        commandSha256, commandNonce: command.commandNonce };
      for (const [key, value] of Object.entries(expected)) if (intent[key as keyof typeof intent] !== value) {
        throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Duplicate command conflicts with durable intent.');
      }
      return intent;
    }
    if (command.materializationHeadSha256 !== head) {
      throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Materialization command head is stale.');
    }
    const candidate = withHash({ format: 'darshan-recovery-target-materialization-intent-v2' as const,
      kind: 'INTENT' as const, sequence: String(records.length + 1), operationId: command.binding.operationId,
      operation: command.operation,
      targetHandle: command.targetHandle, generation: command.binding.generation, role: command.role,
      resourceAuthorityHandle: command.resourceAuthorityHandle, profileSha256: command.binding.profileSha256,
      admissionSha256: command.binding.admissionSha256, commandSha256, commandNonce: command.commandNonce,
      previousHeadSha256: head });
    const intent = intentSchema.parse(candidate); const bytes = encodeRecord(intent);
    try { await this.store.publishNoClobber(intent.recordSha256, bytes, signal); }
    catch (cause) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
        'Materialization intent publication did not produce an authoritative durable outcome.', { cause });
    }
    signal.throwIfAborted(); const after = await this.scan(signal);
    const published = after.find((record) => record.recordSha256 === intent.recordSha256);
    if (!published || !encodeRecord(published).equals(bytes)) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Materialization intent cannot be confirmed exactly.');
    }
    return freezeRecord(intent);
  }

  async publishReceipt(input: { intent: TargetEngineMaterializationIntent; inspection: TargetNativeEngineInspectionV3;
    actual: TargetEngineActualResource; outcome: 'COMPLETE' | 'AMBIGUOUS'; signal: AbortSignal }):
      Promise<TargetEngineMaterializationReceipt> {
    const records = await this.scan(input.signal); const durableIntent = records.find((record) =>
      record.recordSha256 === input.intent.recordSha256 && record.kind === 'INTENT');
    if (!durableIntent) throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Receipt has no exact durable intent.');
    assertIdentity(durableIntent, input.intent);
    const existing = records.find((record) => record.kind === 'RECEIPT' &&
      record.intentRecordSha256 === input.intent.recordSha256);
    const inspection = parseTargetNativeEngineInspectionV3(Buffer.from(canonicalJson(input.inspection)));
    const observed = input.intent.role === 'NETWORK' ? inspection.network :
      input.intent.role === 'POSTGRES' ? inspection.postgres : inspection.minio;
    const observedConsumerSetSha256 = createHash('sha256')
      .update(canonicalJson([...observed.consumerIds].sort())).digest('hex');
    if (inspection.binding.operationId !== input.intent.operationId ||
        inspection.binding.targetHandle !== input.intent.targetHandle ||
        inspection.binding.generation !== input.intent.generation || inspection.binding.profileSha256 !== input.intent.profileSha256 ||
        inspection.binding.admissionSha256 !== input.intent.admissionSha256 ||
        inspection.command.commandSha256 !== input.intent.commandSha256 || inspection.command.operation !== input.intent.operation ||
        inspection.command.role !== input.intent.role ||
        inspection.command.resourceAuthorityHandle !== input.intent.resourceAuthorityHandle ||
        inspection.command.commandNonce !== input.intent.commandNonce ||
        inspection.command.materializationHeadSha256 !== input.intent.previousHeadSha256) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Receipt observation differs from its exact pending materialization intent.');
    }
    if (input.outcome === 'COMPLETE' && (!inspection.observationComplete ||
        Object.values(inspection.enumerationComplete).some((complete) => !complete) ||
        observed.configuration !== 'MATCH' || observed.state === 'ERROR' || observed.resourceId === null ||
        observed.effectiveConfigurationSha256 === null || observed.ownerLabelsSha256 === null ||
        observed.daemonIdentitySha256 === null ||
        input.actual.resourceId !== observed.resourceId || input.actual.imageId !== observed.imageId ||
        input.actual.imageConfigSha256 !== observed.imageConfigSha256 ||
        input.actual.effectiveConfigurationSha256 !== observed.effectiveConfigurationSha256 ||
        input.actual.ownerLabelsSha256 !== observed.ownerLabelsSha256 ||
        input.actual.consumerSetSha256 !== observedConsumerSetSha256 ||
        input.actual.daemonIdentitySha256 !== observed.daemonIdentitySha256)) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
        'Complete receipt requires authoritative complete matching observation with actual identities.');
    }
    if (input.outcome === 'AMBIGUOUS' && Object.values(input.actual).some((value) => value !== null)) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID',
        'Ambiguous receipt cannot invent any authoritative actual identity.');
    }
    const observationSha256 = targetNativeEngineInspectionV3Sha256(inspection);
    const parsedActual = actualResourceSchema.parse(input.actual);
    if (existing) {
      const receipt = existing as TargetEngineMaterializationReceipt;
      assertIdentity(receipt, input.intent);
      if (receipt.outcome !== input.outcome || receipt.observationSha256 !== observationSha256 ||
          !canonicalJson(receipt.actual).equals(canonicalJson(parsedActual))) {
        throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Conflicting receipt already exists.');
      }
      return receipt;
    }
    const candidate = receiptSchema.parse(withHash({
      format: 'darshan-recovery-target-materialization-receipt-v2' as const, kind: 'RECEIPT' as const,
      sequence: String(records.length + 1), operationId: input.intent.operationId,
      operation: input.intent.operation,
      targetHandle: input.intent.targetHandle, generation: input.intent.generation, role: input.intent.role,
      resourceAuthorityHandle: input.intent.resourceAuthorityHandle, profileSha256: input.intent.profileSha256,
      admissionSha256: input.intent.admissionSha256, commandSha256: input.intent.commandSha256,
      commandNonce: input.intent.commandNonce, previousHeadSha256: records.at(-1)?.recordSha256 ?? ZERO_SHA256,
      intentRecordSha256: input.intent.recordSha256, observationSha256,
      outcome: input.outcome, actual: parsedActual,
    }));
    try { await this.store.publishNoClobber(candidate.recordSha256, encodeRecord(candidate), input.signal); }
    catch (cause) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Receipt publication is ambiguous.', { cause });
    }
    input.signal.throwIfAborted(); const after = await this.scan(input.signal);
    if (!after.some((record) => record.recordSha256 === candidate.recordSha256)) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Receipt publication cannot be confirmed.');
    }
    return freezeRecord(candidate);
  }
}

export interface TargetOwnedResourceCandidate {
  readonly role: 'NETWORK' | 'POSTGRES' | 'MINIO';
  readonly resourceAuthorityHandle: string;
  readonly resourceId: string;
  readonly profileSha256: string;
  readonly admissionSha256: string;
  readonly commandNonce: string;
  readonly ownerLabelsSha256: string;
  readonly effectiveConfigurationSha256: string;
  readonly consumerSetSha256: string;
  readonly daemonIdentitySha256: string;
  readonly complete: boolean;
}

export function adoptUniqueExactOwnedResource(input: {
  intent: TargetEngineMaterializationIntent; candidates: readonly TargetOwnedResourceCandidate[];
  expectedOwnerLabelsSha256: string; expectedConfigurationSha256: string;
  expectedConsumerSetSha256: string; expectedDaemonIdentitySha256: string;
}): TargetOwnedResourceCandidate {
  const matches = input.candidates.filter((candidate) => candidate.complete && candidate.role === input.intent.role &&
    candidate.resourceAuthorityHandle === input.intent.resourceAuthorityHandle &&
    candidate.profileSha256 === input.intent.profileSha256 && candidate.admissionSha256 === input.intent.admissionSha256 &&
    candidate.commandNonce === input.intent.commandNonce &&
    candidate.ownerLabelsSha256 === input.expectedOwnerLabelsSha256 &&
    candidate.effectiveConfigurationSha256 === input.expectedConfigurationSha256 &&
    candidate.consumerSetSha256 === input.expectedConsumerSetSha256 &&
    candidate.daemonIdentitySha256 === input.expectedDaemonIdentitySha256);
  if (matches.length !== 1 || input.candidates.some((candidate) => candidate.commandNonce === input.intent.commandNonce &&
      !matches.includes(candidate))) {
    throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
      'Lost response adoption requires exactly one complete, exact, owned resource and no nonce collision.');
  }
  return Object.freeze(matches[0]!);
}

/** Explicitly test-only store. The durable native implementation is the b1
 * boundary; this fixture does not authorize production materialization. */
export class TestOnlyInMemoryTargetEngineMaterializationStore implements TargetEngineMaterializationStore {
  readonly inodeBound = TARGET_ENGINE_MATERIALIZATION_MAX_RECORDS;
  private readonly entries: Buffer[] = [];
  constructor(marker: 'TEST_ONLY_DO_NOT_USE_IN_PRODUCTION') {
    if (marker !== 'TEST_ONLY_DO_NOT_USE_IN_PRODUCTION') throw new Error('test-only marker required');
  }
  async scan(signal: AbortSignal): Promise<readonly Uint8Array[]> {
    signal.throwIfAborted(); return this.entries.map((entry) => Buffer.from(entry));
  }
  async publishNoClobber(recordSha256: string, bytes: Uint8Array, signal: AbortSignal): Promise<'PUBLISHED' | 'EXACT_REPLAY'> {
    signal.throwIfAborted(); const parsed = parseRecord(bytes);
    if (parsed.recordSha256 !== recordSha256) throw new Error('name/hash mismatch');
    const existing = this.entries.find((entry) => parseRecord(entry).recordSha256 === recordSha256);
    if (existing) {
      if (!existing.equals(Buffer.from(bytes))) throw new Error('conflicting no-clobber replay');
      return 'EXACT_REPLAY';
    }
    this.entries.push(Buffer.from(bytes)); return 'PUBLISHED';
  }
}

