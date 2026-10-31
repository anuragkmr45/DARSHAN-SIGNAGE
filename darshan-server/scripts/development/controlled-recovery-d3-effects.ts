import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { PACKET_C_E2E_STAGES, type PacketCE2EHarnessBoundary, type PacketCE2EReadinessObservation, type PacketCE2EStage } from '../../src/recovery/controlled-docker/controlled-recovery-e2e-harness';
import type { DevelopmentD2Activation } from './controlled-recovery-d2';
import { deriveD3OperationAuthority } from './controlled-recovery-d3-authority';

export type D3Stage = Exclude<PacketCE2EStage, 'READINESS'>;
export const D3_REQUIRED_AVAILABLE_BYTES = '2717908992'; // 2,080 MiB stage peak + 512 MiB host reserve.
const sha = z.string().regex(/^[a-f0-9]{64}$/); const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const d3OwnedResourceSchema = z.object({ role: z.string(), name: z.string(), id: z.string().regex(/^[a-f0-9]{12,64}$/), labelsSha256: sha,
  memoryBytes: decimal, nanoCpus: decimal, pidsLimit: z.number().int().positive(), running: z.boolean() }).strict();
export type D3OwnedResource = z.infer<typeof d3OwnedResourceSchema>;
export const d3ReceiptSchema = z.object({ stage: z.enum(PACKET_C_E2E_STAGES.slice(1) as [D3Stage, ...D3Stage[]]), evidenceSha256: sha,
  physicalSourceTargetSha256: sha, mutableContentSha256: sha, sourceContentSealSha256: sha.optional(), liveInvariantSha256: sha,
  measurementEvidenceSha256: sha, durationMs: decimal, peakMemoryBytes: decimal, hostSwapUsedBytes: decimal,
  retainedResources: z.array(d3OwnedResourceSchema).max(16), ownedResourceIdsSha256: sha.optional(), }).strict();
export type D3StageReceipt = z.infer<typeof d3ReceiptSchema>;
export interface D3LiveObservation { physicalSourceTargetSha256: string; mutableContentSha256: string; liveInvariantSha256: string; retainedResources: readonly D3OwnedResource[]; }
export interface D3StageDriver { execute(stage: D3Stage): Promise<D3StageReceipt>; observe(stage: D3Stage): Promise<D3LiveObservation | null>; }
export interface D3Journal { completed(): Promise<readonly D3StageReceipt[]>; append(value: D3StageReceipt): Promise<void>; }
export interface D3ReadinessGate { assert(stage: D3Stage, completed: readonly D3StageReceipt[]): Promise<PacketCE2EReadinessObservation>; }

function assertCompletedPrefix(values: readonly D3StageReceipt[]): void {
  const expected = PACKET_C_E2E_STAGES.slice(1, values.length + 1);
  if (values.some(({ stage }, index) => stage !== expected[index])) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_JOURNAL_PREFIX_INVALID', 'D3 journal is not a durable completed stage prefix.');
}

function assertAuthoritativeObservation(receipt: D3StageReceipt, live: D3LiveObservation | null): void {
  if (!live || live.physicalSourceTargetSha256 !== receipt.physicalSourceTargetSha256 || live.mutableContentSha256 !== receipt.mutableContentSha256 ||
      live.liveInvariantSha256 !== receipt.liveInvariantSha256 || !sameResources(live.retainedResources, receipt.retainedResources))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_RESUME_AMBIGUOUS', 'Latest D3 checkpoint and live invariants differ.');
}

const d3JournalSchema = z.object({ format: z.literal('darshan-controlled-recovery-development-d3-journal-v1'), operationId: z.string().uuid(), receipts: z.array(d3ReceiptSchema).max(12) }).strict();
export class DevelopmentD3FileJournal implements D3Journal {
  constructor(private readonly activation: DevelopmentD2Activation) { deriveD3OperationAuthority(activation); }
  private get path() { return join(this.activation.evidence_root, 'd3-stage-journal.json'); }
  async completed(): Promise<readonly D3StageReceipt[]> { let handle; try { handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause; }
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('unsafe journal');
      const bytes = await handle.readFile(); const value = d3JournalSchema.parse(parseStrictJson(bytes, 1024 * 1024));
      if (!canonicalJson(value).equals(bytes) || value.operationId !== this.activation.operation_id) throw new Error('journal identity'); return value.receipts; }
    catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_JOURNAL_CORRUPT', 'D3 journal is invalid.', { cause }); } finally { await handle.close(); } }
  async append(receipt: D3StageReceipt): Promise<void> { const parsed = d3ReceiptSchema.parse(receipt); const current = await this.completed();
    if (current.some(({ stage }) => stage === parsed.stage)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_JOURNAL_CONFLICT', 'D3 stage receipt already exists.');
    await mkdir(this.activation.evidence_root, { recursive: true, mode: 0o700 }); const temporary = `${this.path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(canonicalJson(d3JournalSchema.parse({ format: 'darshan-controlled-recovery-development-d3-journal-v1', operationId: this.activation.operation_id, receipts: [...current, parsed] }))); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, this.path); const directory = await open(this.activation.evidence_root, constants.O_RDONLY | constants.O_DIRECTORY); try { await directory.sync(); } finally { await directory.close(); } }
    finally { await unlink(temporary).catch(() => undefined); }
  }
}

function sameResources(left: readonly D3OwnedResource[], right: readonly D3OwnedResource[]): boolean {
  const normalize = (values: readonly D3OwnedResource[]) => [...values].map((value) => d3OwnedResourceSchema.parse(value)).sort((a, b) => a.role.localeCompare(b.role));
  return digest(normalize(left)) === digest(normalize(right));
}
function validateNewReceipt(stage: D3Stage, value: D3StageReceipt, completed: readonly D3StageReceipt[]): D3StageReceipt {
  const receipt = d3ReceiptSchema.parse(value); if (receipt.stage !== stage) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_RECEIPT_INVALID', 'D3 stage receipt differs.');
  const first = completed[0]; if (first && receipt.physicalSourceTargetSha256 !== first.physicalSourceTargetSha256)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_TARGET_CHANGED', 'Physical source target identity changed.');
  const stopped = stage === 'STOP_SOURCE_APPLICATION' ? receipt : completed.find(({ stage: valueStage }) => valueStage === 'STOP_SOURCE_APPLICATION');
  const seal = stopped?.sourceContentSealSha256; if (stage === 'STOP_SOURCE_APPLICATION' && receipt.sourceContentSealSha256 !== receipt.mutableContentSha256)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_SEAL_INVALID', 'STOP_SOURCE_APPLICATION did not seal the current content identity.');
  if (seal && PACKET_C_E2E_STAGES.indexOf(stage) > PACKET_C_E2E_STAGES.indexOf('STOP_SOURCE_APPLICATION') && receipt.mutableContentSha256 !== seal)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_CONTENT_CHANGED', 'Source content changed after its stop-stage seal.');
  return receipt;
}

export class DevelopmentD3HarnessBoundary implements PacketCE2EHarnessBoundary {
  constructor(private readonly readiness: D3ReadinessGate, private readonly driver: D3StageDriver, private readonly journal: D3Journal) {}
  async observeReadiness(): Promise<PacketCE2EReadinessObservation> { const completed = await this.journal.completed(); assertCompletedPrefix(completed);
    const latest = completed.at(-1); const next = PACKET_C_E2E_STAGES[completed.length + 1] as D3Stage | undefined;
    const result = await this.readiness.assert(next ?? latest?.stage ?? 'SEED_REPRESENTATIVE_DATA', completed);
    if (latest) assertAuthoritativeObservation(latest, await this.driver.observe(latest.stage)); return result; }
  async execute(stage: D3Stage) { const completed = await this.journal.completed(); assertCompletedPrefix(completed); await this.readiness.assert(stage, completed);
    const position = PACKET_C_E2E_STAGES.indexOf(stage); if (!PACKET_C_E2E_STAGES.slice(1, position).every((prior) => completed.some(({ stage: done }) => done === prior)))
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_STAGE_ORDER_INVALID', 'D3 prior stage evidence is incomplete.');
    const existing = completed.find(({ stage: done }) => done === stage); if (existing) {
      // A later durable checkpoint supersedes mutable truth from this stage. Always re-observe that newest checkpoint, never the obsolete stage.
      const latest = completed.at(-1)!; assertAuthoritativeObservation(latest, await this.driver.observe(latest.stage));
      // Return the retained receipt so duration/peak/swap remain measured evidence rather than re-observed fabrications.
      return existing; }
    const value = validateNewReceipt(stage, await this.driver.execute(stage), completed); await this.journal.append(value);
    return { evidenceSha256: value.evidenceSha256, ...(value.ownedResourceIdsSha256 ? { ownedResourceIdsSha256: value.ownedResourceIdsSha256 } : {}) }; }
  async report() { const values = await this.journal.completed(); const publicValues = values.map(({ stage, evidenceSha256, measurementEvidenceSha256, durationMs, peakMemoryBytes, hostSwapUsedBytes }) =>
      ({ stage, evidenceSha256, measurementEvidenceSha256, durationMs, peakMemoryBytes, hostSwapUsedBytes }));
    return { evidenceSha256: digest(publicValues), completedStages: values.length ? ['READINESS' as const, ...values.map(({ stage }) => stage)] : [], summaries: publicValues }; }
}

export interface D3ReadinessObservation { prerequisite: PacketCE2EReadinessObservation; pressureUnsafe: boolean; foreignResources: readonly D3OwnedResource[];
  ownedResources: readonly D3OwnedResource[]; toolsEvidenceSha256: string; cgroupEvidenceSha256: string; }
export interface D3ReadinessObserver { observe(): Promise<D3ReadinessObservation>; }
export class StageAwareD3Readiness implements D3ReadinessGate {
  constructor(private readonly observer: D3ReadinessObserver) {}
  async assert(stage: D3Stage, completed: readonly D3StageReceipt[]): Promise<PacketCE2EReadinessObservation> { const observed = await this.observer.observe();
    const prerequisite = observed.prerequisite;
    if (![prerequisite.enrolledAssetsSha256, observed.toolsEvidenceSha256, observed.cgroupEvidenceSha256].every((value) => /^[a-f0-9]{64}$/.test(value)) ||
        !prerequisite.firefoxUntouched || BigInt(prerequisite.availableRamBytes) < BigInt(D3_REQUIRED_AVAILABLE_BYTES) ||
        BigInt(prerequisite.swapInUseBytes) > BigInt(prerequisite.maximumSwapInUseBytes) || observed.pressureUnsafe)
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PRESSURE_UNSAFE', 'D3 RAM reserve, swap, or pressure gate failed.');
    if (observed.foreignResources.length) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_FOREIGN_RESOURCE', 'Foreign Docker resources are present.');
    const firstStage = stage === 'SEED_REPRESENTATIVE_DATA' && completed.length === 0; const retained = completed.at(-1)?.retainedResources ?? [];
    if (firstStage ? observed.ownedResources.length !== 0 : !sameResources(observed.ownedResources, retained))
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_OWNED_RESOURCE_CHANGED', 'Retained owned Docker resources are absent, partial, changed, or unexpected.');
    return { ...prerequisite, requiredRamBytes: D3_REQUIRED_AVAILABLE_BYTES,
      enrolledAssetsSha256: digest({ d1: prerequisite.enrolledAssetsSha256, tools: observed.toolsEvidenceSha256, cgroup: observed.cgroupEvidenceSha256 }) }; }
}
