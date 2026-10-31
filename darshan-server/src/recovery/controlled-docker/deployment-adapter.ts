import type { BrokerLifecycleIdentity } from '../../backups/backup-broker-worker-adapter';
import type { TrustedRecoverySource } from '../repository-source';
import { assessRecoveryCompatibility, type RecoveryCompatibilityDecision } from '../compatibility';
import type { MigrationManifestEntry } from '../../deployment/migration-manifest';
import { acquireAndVerifyRestoreHold, assertExactSourceIdentity, exactSourceIdentity, type RestoreHoldBroker } from './source';
import { runControlledPreflight, type PreflightAdapter } from './preflight';
import { buildTargetSpecification, createAndVerifyFreshTargets, verifyOwnedFreshTargets, type FixedDeploymentAdapter, type RecoveryTargetSpecification } from './docker-targets';
import { restoreDatabase, type DatabaseObservation } from './database';
import { validateRecoveredData, type DataValidationAdapter } from './data-validation';
import { restoreDiskBackedObjects } from './target-object-adapter';
import { TargetDatabaseAdapter, type FixedDatabaseExecutor } from './target-database-adapter';
import { databaseDump, objectDescriptors, operationWorkspace, type FixedArtifactBoundary, type ProtectedSourceBoundary, type DecryptedArtifactSet } from './file-artifacts';
import { RecoveryOperationStore } from './recovery-operation-store';
import type { StreamingObjectStoreAdapter } from './streaming-artifacts';
import { ControlledRecoveryError, digest, type ControlledRecoveryMajorState, type ExactSourceIdentity, type OperationIdentity } from './contracts';
import type { ControlledRecoveryProfile } from './profile';
import type { ControlledRecoveryRequest, ControlledRecoveryWorkflowAdapter, PhaseResult } from './workflow';

type EffectPhase = Exclude<ControlledRecoveryMajorState, 'PLANNED'>;

export async function loadAndVerifyDurableDatabaseBaseline(input: {
  operationStore: RecoveryOperationStore;
  operationId: string;
  database: FixedDatabaseExecutor;
  specification: RecoveryTargetSpecification;
  signal?: AbortSignal;
}): Promise<Record<string, string>> {
  const durable = await input.operationStore.readReceipt(input.operationId, 'DATABASE_RESTORED');
  if (!durable) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_RECEIPT_MISSING', 'Durable database baseline receipt is absent.');
  const current = await input.database.observe({ specification: input.specification, signal: input.signal });
  if (!current.owned || current.importMarker !== 'COMPLETED' || !current.tableCounts || Object.entries(durable.aggregates).some(([table, count]) =>
    !/^(0|[1-9][0-9]*)$/.test(count) || !/^(0|[1-9][0-9]*)$/.test(current.tableCounts?.[table] ?? '') || BigInt(current.tableCounts![table]) < BigInt(count))) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_BASELINE_CHANGED', 'Current database counts lost rows or differ from durable restore authority.');
  }
  return durable.aggregates;
}

export interface Packet1PhaseTruthBoundary {
  observe(input: { phase: EffectPhase; identity: OperationIdentity; source: TrustedRecoverySource; specification: RecoveryTargetSpecification;
    receiptEvidenceSha256: string; signal?: AbortSignal }): Promise<{ evidenceSha256: string } | null>;
}

export interface Packet1PreflightBoundary {
  adapter(input: { source: TrustedRecoverySource; identity: OperationIdentity }): PreflightAdapter;
  expected: { expectedProfileAssetsSha256: string; expectedToolsSha256: string; expectedImagesSha256: string; expectedConfigurationSha256: string };
}

export interface Packet1DeploymentDependencies {
  source: ProtectedSourceBoundary;
  targetManifest: readonly MigrationManifestEntry[];
  broker(input: { source: TrustedRecoverySource; identity: BrokerLifecycleIdentity }): RestoreHoldBroker;
  preflight: Packet1PreflightBoundary;
  artifacts: FixedArtifactBoundary;
  deployment: FixedDeploymentAdapter;
  database: FixedDatabaseExecutor;
  objects(input: { specification: RecoveryTargetSpecification }): StreamingObjectStoreAdapter;
  validation(input: { specification: RecoveryTargetSpecification; baselineCounts: Record<string, string> }): DataValidationAdapter;
  phaseTruth: Packet1PhaseTruthBoundary;
  operationStore: RecoveryOperationStore;
  allowedReconciliationDeltas: Record<string, string>;
  now?(): Date;
}

interface Context { request: ControlledRecoveryRequest; profile: ControlledRecoveryProfile; identity?: OperationIdentity;
  source: TrustedRecoverySource; compatibility: RecoveryCompatibilityDecision; specification: RecoveryTargetSpecification; artifacts?: DecryptedArtifactSet }

function lifecycle(identity: OperationIdentity, source: TrustedRecoverySource, ownerToken: string, fenceToken: string): BrokerLifecycleIdentity {
  return { runId: source.manifest.run.id, attemptId: source.manifest.run.attemptId, captureId: source.manifest.capture.id,
    captureGeneration: Number(source.manifest.capture.generation), manifestSha256: identity.source.manifestSha256,
    operationId: identity.operationId, ownerToken, fenceToken };
}

export function createControlledRecoveryWorkflowAdapter(dependencies: Packet1DeploymentDependencies): ControlledRecoveryWorkflowAdapter {
  const contexts = new Map<string, Context>(); const reobservedSources = new Map<string, TrustedRecoverySource>();
  const baselines = new Map<string, Record<string, string>>();
  const now = dependencies.now ?? (() => new Date());
  async function sourceFor(request: ControlledRecoveryRequest, profile: ControlledRecoveryProfile, signal?: AbortSignal): Promise<TrustedRecoverySource> {
    const selected = await dependencies.source.select({ request, profile, signal });
    if (selected.descriptor.siteId !== request.siteId || selected.descriptor.runId !== request.backupRunId || selected.descriptor.manifestSha256 !== request.manifestSha256)
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_SOURCE_MISMATCH', 'Protected source boundary returned a different source.');
    return selected;
  }
  function compatibility(source: TrustedRecoverySource, profile: ControlledRecoveryProfile): RecoveryCompatibilityDecision {
    try { return assessRecoveryCompatibility({ sourceKind: source.descriptor.kind, sourceManifest: source.manifest, sourcePolicy: source.policy,
      targetReleaseId: profile.release_id, targetManifest: dependencies.targetManifest }); }
    catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_RELEASE_INCOMPATIBLE', 'Source release is not enrolled for the fixed target ledger.', { cause }); }
  }
  async function context(input: { request: ControlledRecoveryRequest; profile: ControlledRecoveryProfile; identity: OperationIdentity; signal?: AbortSignal }): Promise<Context> {
    let value = contexts.get(input.identity.operationId);
    if (!value) { const source = await sourceFor(input.request, input.profile, input.signal); assertExactSourceIdentity(input.identity.source, source);
      value = { ...input, source, compatibility: compatibility(source, input.profile), specification: buildTargetSpecification(input.profile, input.identity.operationId, 1) }; contexts.set(input.identity.operationId, value); }
    return value;
  }
  async function receipt(input: { identity: OperationIdentity; phase: EffectPhase; evidence: unknown; aggregates?: Record<string, string>; started: number }): Promise<PhaseResult> {
    const evidenceSha256 = digest(input.evidence); const timingsMs = { [input.phase.toLowerCase()]: Math.max(0, Date.now() - input.started).toString() };
    await dependencies.operationStore.recordReceipt({ format: 'darshan-controlled-recovery-operation-receipt-v1', operation_id: input.identity.operationId,
      phase: input.phase, source_identity_sha256: digest(input.identity.source), evidence_sha256: evidenceSha256,
      aggregates: input.aggregates ?? {}, timings_ms: timingsMs, completed_at: now().toISOString() });
    return { evidence: { evidenceSha256 }, aggregates: input.aggregates, timingsMs };
  }
  return {
    async selectSource({ request, profile, signal }): Promise<ExactSourceIdentity> { const source = await sourceFor(request, profile, signal); const exact = exactSourceIdentity(source);
      await dependencies.operationStore.bindSource(request.operationId, exact); contexts.set(request.operationId, { request, profile, source,
        compatibility: compatibility(source, profile), specification: buildTargetSpecification(profile, request.operationId, 1) }); return exact; },
    async assessCompatibility({ source, request, profile, signal }) { const selected = await sourceFor(request, profile, signal); assertExactSourceIdentity(source, selected); return compatibility(selected, profile); },
    async reobserveSource({ expected, profile, signal }) { const cached = contexts.get([...contexts.keys()].find((key) => contexts.get(key)?.source.descriptor.runId === expected.runId) ?? '');
      const reobserveRequest: ControlledRecoveryRequest = cached?.request ?? { operationId: '00000000-0000-4000-8000-000000000000',
        backupRunId: expected.runId, manifestSha256: expected.manifestSha256, siteId: expected.siteId,
        approvedReleaseId: profile.release_id, recoveryKeyFile: `${profile.recovery_key_root}/reobserve-only` };
      const selected = await sourceFor(reobserveRequest, profile, signal); assertExactSourceIdentity(expected, selected);
      reobservedSources.set(expected.runId, selected); if (cached) cached.source = selected; },
    async observePhase({ phase, identity, profile, signal }) { const cached = contexts.get(identity.operationId);
      if (phase === 'PLANNED') return { confirmed: true, evidence: { planned: true } };
      const source = cached?.source ?? reobservedSources.get(identity.source.runId); if (!source) return { confirmed: false };
      const specification = cached?.specification ?? buildTargetSpecification(profile, identity.operationId, 1);
      const stored = await dependencies.operationStore.readReceipt(identity.operationId, phase); if (!stored) return { confirmed: false };
      const observed = await dependencies.phaseTruth.observe({ phase, identity, source, specification,
        receiptEvidenceSha256: stored.evidence_sha256, signal });
      return observed?.evidenceSha256 === stored.evidence_sha256 ? { confirmed: true, evidence: { evidenceSha256: observed.evidenceSha256 } } : { confirmed: false }; },
    async sourceHeld(input) { const started = Date.now(); const value = await context(input); const binding = await dependencies.operationStore.ensureHoldBinding(input.identity.operationId, digest(input.identity.source));
      const bound = lifecycle(input.identity, value.source, binding.owner_token, binding.fence_token); await acquireAndVerifyRestoreHold({ broker: dependencies.broker({ source: value.source, identity: bound }), identity: bound, signal: input.signal });
      return receipt({ identity: input.identity, phase: 'SOURCE_HELD', evidence: { source: digest(input.identity.source), hold: digest(binding) }, started }); },
    async preflightPassed(input) { const started = Date.now(); const value = await context(input);
      const inspected = await dependencies.artifacts.inspectPlaintext(value.source, input.signal);
      const result = await runControlledPreflight({ profile: input.profile, manifest: value.source.manifest, compatibility: value.compatibility,
        keyFile: input.request.recoveryKeyFile, ...dependencies.preflight.expected, plaintextDatabaseBytes: inspected.databaseBytes,
        plaintextObjectBytes: inspected.objectBytes, plaintextConfigurationBytes: inspected.configurationBytes,
        expectedObjectCount: inspected.objectCount, adapter: dependencies.preflight.adapter({ source: value.source, identity: input.identity }) });
      return receipt({ identity: input.identity, phase: 'PREFLIGHT_PASSED', evidence: result, aggregates: { requiredTargetBytes: result.capacity.targetDiskBytes }, started }); },
    async decryptedVerified(input) { const started = Date.now(); const value = await context(input); value.artifacts = await dependencies.artifacts.decrypt({ source: value.source,
        keyFile: input.request.recoveryKeyFile, workspaceRoot: operationWorkspace(input.profile, input.identity.operationId), signal: input.signal });
      return receipt({ identity: input.identity, phase: 'DECRYPTED_VERIFIED', evidence: { evidenceSha256: value.artifacts.evidenceSha256 }, aggregates: {
        databaseFiles: value.artifacts.database.length.toString(), objectFiles: value.artifacts.objects.length.toString(), configurationFiles: value.artifacts.configuration.length.toString() }, started }); },
    async targetsCreated(input) { const started = Date.now(); const value = await context(input); const result = await createAndVerifyFreshTargets({ adapter: dependencies.deployment, specification: value.specification, signal: input.signal });
      return receipt({ identity: input.identity, phase: 'TARGETS_CREATED', evidence: { targetEvidenceSha256: result.targetEvidenceSha256 }, aggregates: { targetResources: result.resources.length.toString() }, started }); },
    async databaseRestored(input) { const started = Date.now(); const value = await context(input); value.artifacts ??= await dependencies.artifacts.reobserve({ source: value.source, workspaceRoot: operationWorkspace(input.profile, input.identity.operationId), signal: input.signal });
      verifyOwnedFreshTargets(value.specification, await dependencies.deployment.inspect(value.specification, input.signal)); const dump = databaseDump(value.artifacts.database);
      const result = await restoreDatabase({ adapter: new TargetDatabaseAdapter(value.specification, dump, dependencies.database), dumpFile: dump.path,
        expectedTargetId: digest(value.specification), terminalMigrationId: input.profile.terminal_migration_id, signal: input.signal }); baselines.set(input.identity.operationId, result.baselineTableCounts);
      return receipt({ identity: input.identity, phase: 'DATABASE_RESTORED', evidence: result, aggregates: result.baselineTableCounts, started }); },
    async objectsRestored(input) { const started = Date.now(); const value = await context(input); value.artifacts ??= await dependencies.artifacts.reobserve({ source: value.source, workspaceRoot: operationWorkspace(input.profile, input.identity.operationId), signal: input.signal });
      verifyOwnedFreshTargets(value.specification, await dependencies.deployment.inspect(value.specification, input.signal)); const result = await restoreDiskBackedObjects({ adapter: dependencies.objects({ specification: value.specification }),
        expected: objectDescriptors(value.artifacts.objects), batchSize: input.profile.limits.object_batch_size, maximumObjectBytes: input.profile.limits.max_artifact_bytes, signal: input.signal });
      return receipt({ identity: input.identity, phase: 'OBJECTS_RESTORED', evidence: result, aggregates: { objectCount: result.count, objectBytes: result.bytes }, started }); },
    async dataValidated(input) { const started = Date.now(); const value = await context(input);
      const baseline = await loadAndVerifyDurableDatabaseBaseline({ operationStore: dependencies.operationStore, operationId: input.identity.operationId,
        database: dependencies.database, specification: value.specification, signal: input.signal }); const inMemory = baselines.get(input.identity.operationId);
      if (inMemory && digest(inMemory) !== digest(baseline)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_BASELINE_CHANGED', 'In-memory and durable database baselines differ.');
      const result = await validateRecoveredData({ adapter: dependencies.validation({ specification: value.specification, baselineCounts: baseline }), baselineTableCounts: baseline,
        allowedReconciliationDeltas: dependencies.allowedReconciliationDeltas, signal: input.signal });
      return receipt({ identity: input.identity, phase: 'DATA_VALIDATED', evidence: result, aggregates: { ...result.aggregateCounts, excludedCount: result.excludedCount }, started }); },
  };
}

export type Packet1DatabaseObservation = DatabaseObservation;
