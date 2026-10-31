import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { PACKET_C_E2E_STAGES, type PacketCE2EHarnessBoundary, type PacketCE2EReadinessObservation, type PacketCE2EStage } from '../../src/recovery/controlled-docker/controlled-recovery-e2e-harness';
import { loadDevelopmentReadinessActivation, observeDevelopmentReadiness, type DevelopmentReadinessActivation, type DevelopmentReadinessSystem } from './controlled-recovery-readiness';

const safe = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/); const absolute = z.string().startsWith('/').max(512); const sha = z.string().regex(/^[a-f0-9]{64}$/);
const resourceRole = z.enum(['postgres', 'minio', 'valkey', 'api', 'worker', 'cms', 'browser', 'player', 'controller']);
export const developmentD2ActivationSchema = z.object({
  format: z.literal('darshan-controlled-recovery-development-d2-v1'), enabled: z.boolean(), non_production: z.literal(true),
  operation_id: z.string().uuid(), deterministic_prefix: z.string().regex(/^darshan-d2-[a-z0-9-]{1,48}$/), confirmation: z.literal('RUN_TINY_DISPOSABLE_PACKET_C'),
  d1_activation_sha256: sha, work_root: absolute, evidence_root: absolute, fixture_manifest: z.object({ path: absolute, sha256: sha }).strict(),
  assets: z.array(z.object({ role: safe, path: absolute, sha256: sha }).strict()).min(5).max(32),
  images: z.array(z.object({ role: z.enum(['postgres', 'minio', 'valkey']), reference: z.string(), image_id: z.string().regex(/^sha256:[a-f0-9]{64}$/), repo_digest: z.string() }).strict()).length(3),
  resources: z.array(z.object({ role: resourceRole, name: z.string().regex(/^darshan-d2-[a-z0-9-]{1,80}$/), memory_bytes: z.string().regex(/^(0|[1-9][0-9]*)$/), pids_limit: z.number().int().positive().max(1024), nano_cpus: z.string().regex(/^(0|[1-9][0-9]*)$/) }).strict()).length(9),
  docker: z.object({ network: z.string().regex(/^darshan-d2-[a-z0-9-]+$/), postgres_volume: z.string().regex(/^darshan-d2-[a-z0-9-]+$/), minio_volume: z.string().regex(/^darshan-d2-[a-z0-9-]+$/), valkey_volume: z.string().regex(/^darshan-d2-[a-z0-9-]+$/), public_ports: z.literal(false) }).strict(),
  dataset: z.object({ maximum_bytes: z.literal('33554432'), cases: z.array(z.enum(['IMAGE', 'SHORT_VIDEO', 'MULTIPAGE_PDF_SELECTED_PAGE', 'OFFLINE_WEBPAGE', 'LAYOUT_PRESENTATION', 'SCHEDULE_DEFAULT', 'EMERGENCY_LOOP', 'CHAT_ATTACHMENT', 'PROOF_OF_PLAY', 'SCREENSHOT', 'LOGS', 'OLD_SESSION_PAIRING_COMMAND_OUTBOX_JOBS'])).length(12) }).strict(),
  retain_on_failure: z.literal(true), cleanup_requires_evidence: z.literal(true), firefox_untouched: z.literal(true),
}).strict();
export type DevelopmentD2Activation = z.infer<typeof developmentD2ActivationSchema>;
export const DEVELOPMENT_D2_ACTIVATION_PATH = fileURLToPath(new URL('../../../deploy/development/controlled-recovery/tiny-e2e-d2.activation.json', import.meta.url));

export async function loadDevelopmentD2Activation(): Promise<DevelopmentD2Activation> {
  const handle = await open(DEVELOPMENT_D2_ACTIVATION_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o664 || stat.size > 512 * 1024)
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_ACTIVATION_UNSAFE', 'Fixed D2 activation file identity differs.');
    const bytes = await handle.readFile(); const value = developmentD2ActivationSchema.parse(parseStrictJson(bytes, 512 * 1024));
    if (!canonicalJson(value).equals(bytes)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_ACTIVATION_INVALID', 'D2 activation is not canonical JSON.'); return value;
  } catch (cause) { if (cause instanceof ControlledRecoveryError) throw cause; throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_ACTIVATION_INVALID', 'D2 activation is invalid.', { cause }); }
  finally { await handle.close(); }
}

export async function verifyDevelopmentD2Assets(activation: DevelopmentD2Activation): Promise<void> {
  for (const asset of activation.assets) { const handle = await open(asset.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024 * 1024 || sha256(await handle.readFile()) !== asset.sha256)
        throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_ASSET_CHANGED', 'A fixed D2 asset identity differs.'); }
    finally { await handle.close(); } }
  const fixture = await open(activation.fixture_manifest.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (sha256(await fixture.readFile()) !== activation.fixture_manifest.sha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_ASSET_CHANGED', 'D2 fixture manifest identity differs.'); }
  finally { await fixture.close(); }
}

export interface DevelopmentD2StageReceipt { stage: Exclude<PacketCE2EStage, 'READINESS'>; evidenceSha256: string; ownedResourceIdsSha256?: string;
  sourceTargetBeforeSha256: string; sourceTargetAfterSha256: string; peakMemoryBytes: string; hostSwapUsedBytes: string; durationMs: string; }
export interface DevelopmentD2StageDriver {
  observe(stage: Exclude<PacketCE2EStage, 'READINESS'>, activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt | null>;
  execute(stage: Exclude<PacketCE2EStage, 'READINESS'>, activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
}
export interface DevelopmentD2Journal { completed(): Promise<readonly DevelopmentD2StageReceipt[]>; append(receipt: DevelopmentD2StageReceipt): Promise<void>; }

export interface DevelopmentD2FixedEffects {
  seedRepresentativeData(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  createEncryptedBackup(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  stopSourceApplication(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  prepareWithOneInterruption(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  validateRecoveredApi(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  validateCmsBrowserSerial(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  validateApiPlayer(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  drainWorker(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  promoteSeparately(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  rollbackUnderFreeze(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  retainEvidence(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  cleanupExactOwnedResources(activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt>;
  observe(stage: Exclude<PacketCE2EStage, 'READINESS'>, activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt | null>;
}
export class FixedDevelopmentD2StageDriver implements DevelopmentD2StageDriver {
  constructor(private readonly effects: DevelopmentD2FixedEffects) {}
  observe(stage: Exclude<PacketCE2EStage, 'READINESS'>, activation: DevelopmentD2Activation) { return this.effects.observe(stage, activation); }
  execute(stage: Exclude<PacketCE2EStage, 'READINESS'>, activation: DevelopmentD2Activation): Promise<DevelopmentD2StageReceipt> {
    const fixed: Record<Exclude<PacketCE2EStage, 'READINESS'>, () => Promise<DevelopmentD2StageReceipt>> = {
      SEED_REPRESENTATIVE_DATA: () => this.effects.seedRepresentativeData(activation), CREATE_ENCRYPTED_BACKUP: () => this.effects.createEncryptedBackup(activation),
      STOP_SOURCE_APPLICATION: () => this.effects.stopSourceApplication(activation), PREPARE_WITH_ONE_INTERRUPTION: () => this.effects.prepareWithOneInterruption(activation),
      API_VALIDATION: () => this.effects.validateRecoveredApi(activation), CMS_BROWSER_SERIAL: () => this.effects.validateCmsBrowserSerial(activation),
      API_PLAYER: () => this.effects.validateApiPlayer(activation), WORKER_DRAIN: () => this.effects.drainWorker(activation), PROMOTE_SEPARATELY: () => this.effects.promoteSeparately(activation),
      ROLLBACK_UNDER_FREEZE: () => this.effects.rollbackUnderFreeze(activation), RETAIN_EVIDENCE: () => this.effects.retainEvidence(activation),
      CLEANUP_EXACT_OWNED_RESOURCES: () => this.effects.cleanupExactOwnedResources(activation), };
    return fixed[stage]();
  }
}

const receiptSchema = z.object({ stage: z.enum(PACKET_C_E2E_STAGES.slice(1) as [EffectStage, ...EffectStage[]]), evidenceSha256: sha,
  ownedResourceIdsSha256: sha.optional(), sourceTargetBeforeSha256: sha, sourceTargetAfterSha256: sha,
  peakMemoryBytes: z.string().regex(/^(0|[1-9][0-9]*)$/), hostSwapUsedBytes: z.string().regex(/^(0|[1-9][0-9]*)$/), durationMs: z.string().regex(/^(0|[1-9][0-9]*)$/) }).strict();
type EffectStage = Exclude<PacketCE2EStage, 'READINESS'>;
const journalSchema = z.object({ format: z.literal('darshan-controlled-recovery-development-d2-journal-v1'), operation_id: z.string().uuid(), receipts: z.array(receiptSchema).max(12) }).strict();
export class DevelopmentD2FileJournal implements DevelopmentD2Journal {
  constructor(private readonly activation: DevelopmentD2Activation) {}
  private get path() { return join(this.activation.evidence_root, 'stage-journal.json'); }
  async completed(): Promise<readonly DevelopmentD2StageReceipt[]> { let handle; try { handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause; }
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('unsafe');
      const bytes = await handle.readFile(); const value = journalSchema.parse(parseStrictJson(bytes, 1024 * 1024)); if (!canonicalJson(value).equals(bytes) || value.operation_id !== this.activation.operation_id) throw new Error('identity'); return value.receipts; }
    catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_JOURNAL_CORRUPT', 'D2 journal is invalid.', { cause }); } finally { await handle.close(); } }
  async append(receipt: DevelopmentD2StageReceipt): Promise<void> { const current = await this.completed(); if (current.some(({ stage }) => stage === receipt.stage)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_JOURNAL_CONFLICT', 'D2 stage receipt already exists.');
    await mkdir(this.activation.evidence_root, { recursive: true, mode: 0o700 }); const temporary = `${this.path}.${randomUUID()}.tmp`; const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(canonicalJson(journalSchema.parse({ format: 'darshan-controlled-recovery-development-d2-journal-v1', operation_id: this.activation.operation_id, receipts: [...current, receipt] }))); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, this.path); const directory = await open(this.activation.evidence_root, constants.O_RDONLY | constants.O_DIRECTORY); try { await directory.sync(); } finally { await directory.close(); } }
    finally { await unlink(temporary).catch(() => undefined); } }
}

function validateReceipt(stage: Exclude<PacketCE2EStage, 'READINESS'>, value: DevelopmentD2StageReceipt): void {
  if (value.stage !== stage || !/^[a-f0-9]{64}$/.test(value.evidenceSha256) || !/^[a-f0-9]{64}$/.test(value.sourceTargetBeforeSha256) ||
      value.sourceTargetBeforeSha256 !== value.sourceTargetAfterSha256 || !/^(0|[1-9][0-9]*)$/.test(value.peakMemoryBytes) || !/^(0|[1-9][0-9]*)$/.test(value.hostSwapUsedBytes) || !/^(0|[1-9][0-9]*)$/.test(value.durationMs))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_RECEIPT_INVALID', 'D2 stage receipt is invalid or original targets changed.');
  if (stage === 'CLEANUP_EXACT_OWNED_RESOURCES' && !/^[a-f0-9]{64}$/.test(value.ownedResourceIdsSha256 ?? ''))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_CLEANUP_UNPROVEN', 'D2 cleanup lacks exact retained ID/label evidence.');
}

export class DevelopmentD2HarnessBoundary implements PacketCE2EHarnessBoundary {
  constructor(private readonly activation: DevelopmentD2Activation, private readonly d1: DevelopmentReadinessActivation,
    private readonly system: DevelopmentReadinessSystem, private readonly driver: DevelopmentD2StageDriver, private readonly journal: DevelopmentD2Journal) {}
  async observeReadiness(): Promise<PacketCE2EReadinessObservation> { const report = await observeDevelopmentReadiness(this.d1, this.system);
    if (report.status !== 'READY' || !report.artifacts.firefoxUntouched) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_READINESS_FAILED', 'D1 readiness failed before a D2 stage.');
    return { availableRamBytes: report.memory.availableBytes, requiredRamBytes: report.projectedSerialPeak.requiredAvailableBytes,
      workspaceFreeBytes: report.workspace.availableBytes, requiredWorkspaceBytes: this.d1.resources.required_workspace_bytes,
      targetFreeBytes: report.target.availableBytes, requiredTargetBytes: this.d1.resources.required_target_bytes,
      swapInUseBytes: report.memory.swapUsedBytes, maximumSwapInUseBytes: this.d1.resources.maximum_swap_used_bytes,
      firefoxUntouched: true, enrolledAssetsSha256: digest({ d1: report.activationSha256, d2: digest(this.activation) }) }; }
  async execute(stage: Exclude<PacketCE2EStage, 'READINESS'>) { await this.observeReadiness(); const completed = await this.journal.completed();
    const index = PACKET_C_E2E_STAGES.indexOf(stage); const expectedPrior = PACKET_C_E2E_STAGES.slice(1, index);
    if (!expectedPrior.every((prior) => completed.some(({ stage: value }) => value === prior))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_STAGE_ORDER_INVALID', 'D2 prior stage evidence is incomplete.');
    const existing = completed.find(({ stage: value }) => value === stage); if (existing) { const observed = await this.driver.observe(stage, this.activation);
      if (!observed || digest(observed) !== digest(existing)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_RESUME_AMBIGUOUS', 'D2 stage journal and live truth differ.'); validateReceipt(stage, observed); return observed; }
    const result = await this.driver.execute(stage, this.activation); validateReceipt(stage, result); await this.journal.append(result); return result; }
  async report() { const completed = await this.journal.completed(); const summaries = completed.map(({ stage, evidenceSha256, peakMemoryBytes, hostSwapUsedBytes, durationMs }) => ({ stage, evidenceSha256, peakMemoryBytes, hostSwapUsedBytes, durationMs }));
    return { evidenceSha256: digest(summaries), completedStages: completed.length ? ['READINESS' as const, ...completed.map(({ stage }) => stage)] : [], summaries }; }
}

export async function loadDevelopmentD2Inputs(): Promise<{ d1: DevelopmentReadinessActivation; d2: DevelopmentD2Activation }> {
  const [d1, d2] = await Promise.all([loadDevelopmentReadinessActivation(), loadDevelopmentD2Activation()]);
  if (digest(d1) !== d2.d1_activation_sha256 || d2.images.some((image) => !d1.docker.images.some((value) => digest(value) === digest(image))))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_D1_IDENTITY_CHANGED', 'D2 no longer matches the enrolled D1 authority.');
  if (!d2.enabled) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_NOT_ACTIVATED', 'D2 remains disabled until its exact effect assets are enrolled.');
  await verifyDevelopmentD2Assets(d2); return { d1, d2 };
}
