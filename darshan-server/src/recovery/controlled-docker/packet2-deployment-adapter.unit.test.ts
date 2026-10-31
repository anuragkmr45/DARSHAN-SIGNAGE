import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { promoteControlledRecovery, reconcileRecoveredApplication, validateIsolatedRecoveredApplication, type RecoveryPromotionAdapter, type RecoveryReconciliationReceipt } from './packet2';
import { FixedRecoveryAppValidationAdapter } from './application-validation-adapter';
import { acceptFromProtectedAuthority, FixedRecoveryPromotionAdapter, rollbackFromProtectedAuthority, TransactionalRecoveryReconciliationAdapter, type FixedPromotionBoundary, type TargetBoundPacket2SqlClient, type TargetBoundReconciliationTransaction } from './packet2-deployment-adapter';
import { PACKET_C_E2E_STAGES, assertPacketCE2EReadiness, runPacketCE2E } from './controlled-recovery-e2e-harness';
import { currentControlledRecoveryPacket2ProfileSchema, controlledRecoveryPacket2ProfileSchema } from './packet2-profile';
import { runControlledRecoveryE2ECli } from '../../../scripts/controlled-recovery-e2e';
import { ProtectedDeploymentAuthorityStore } from './protected-deployment-authority';
import { sha256 } from './contracts';

const hash = (value = 'a') => value.repeat(64);

describe('Activation Packet C deployment adapters', () => {
  it('commits reconciliation actions and exact receipt in one target-bound transaction and replays idempotently', async () => {
    const operationId = randomUUID(); const generation = randomUUID(); let committed: RecoveryReconciliationReceipt | null = null; let transactions = 0;
    const sql: TargetBoundPacket2SqlClient = { proveOwnedTargets: async () => ({ operationId, siteId: 'site-a', generation, databaseTargetId: 'db', objectTargetId: 'objects', ownershipEvidenceSha256: hash() }),
      loadReceipt: async () => committed, async transaction<T>(_input: unknown, work: (transaction: TargetBoundReconciliationTransaction) => Promise<T>) { transactions += 1; let pending: RecoveryReconciliationReceipt | null = null;
        const result = await work({ execute: async () => '1', scheduleFreshJob: async () => undefined,
          insertExactReceipt: async (receipt: RecoveryReconciliationReceipt) => { pending = receipt; return 'INSERTED'; } }); committed = pending; return result; } };
    const adapter = new TransactionalRecoveryReconciliationAdapter(sql);
    const input = { operationId, siteId: 'site-a', generation, expectedDatabaseTargetId: 'db', expectedObjectTargetId: 'objects', adapter };
    const first = await reconcileRecoveredApplication(input); const second = await reconcileRecoveredApplication(input);
    expect(second).toEqual(first); expect(transactions).toBe(1); expect(committed).toEqual(first);
  });

  it('does not expose a receipt when the target transaction crashes before commit', async () => {
    const operationId = randomUUID(); const generation = randomUUID(); const committed: RecoveryReconciliationReceipt | null = null;
    const sql: TargetBoundPacket2SqlClient = { proveOwnedTargets: async () => ({ operationId, siteId: 'site-a', generation, databaseTargetId: 'db', objectTargetId: 'objects', ownershipEvidenceSha256: hash() }),
      loadReceipt: async () => committed, async transaction<T>(_input: { operationId: string; generation: string; ownedTargetEvidenceSha256: string }, work: (transaction: TargetBoundReconciliationTransaction) => Promise<T>) { await work({ execute: async () => '1', scheduleFreshJob: async () => undefined,
        insertExactReceipt: async () => { throw new Error('crash-before-commit'); } }); throw new Error('unreachable'); } };
    const adapter = new TransactionalRecoveryReconciliationAdapter(sql);
    await expect(reconcileRecoveredApplication({ operationId, siteId: 'site-a', generation, expectedDatabaseTargetId: 'db', expectedObjectTargetId: 'objects', adapter })).rejects.toThrow('crash-before-commit');
    expect(committed).toBeNull();
  });

  it('uses the fixed app case catalog and reports missing cases while always stopping isolation', async () => {
    const stop = vi.fn(); const executor = { proveIsolation: async () => ({ egressBlocked: true, productionCredentialsAbsent: true, targetsEvidenceSha256: hash() }),
      execute: vi.fn(async ({ test }) => ({ passed: test !== 'OFFLINE_WEBPAGE_FIXTURE', evidenceSha256: hash('b') })), stop };
    const adapter = new FixedRecoveryAppValidationAdapter(randomUUID(), randomUUID(), executor);
    await expect(validateIsolatedRecoveredApplication({ adapter, operationId: randomUUID(), generation: randomUUID() })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_APP_VALIDATION_FAILED' });
    expect(adapter.missingCases()).toContain('OFFLINE_WEBPAGE_FIXTURE'); expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps release-03 Packet C separate from immutable release-02/0056', async () => {
    const current = JSON.parse(await readFile(new URL('../../../../deploy/production/controlled-recovery/profile.packet-c.example.json', import.meta.url), 'utf8'));
    expect(currentControlledRecoveryPacket2ProfileSchema.parse(current)).toMatchObject({ release_id: 'release-03', terminal_migration_id: '0057_controlled_recovery_report_projection.sql' });
    expect(controlledRecoveryPacket2ProfileSchema.safeParse(current).success).toBe(false);
  });

  it('stores previous deployment bytes privately behind exact hashes for rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-packet-c-authority-')); const store = new ProtectedDeploymentAuthorityStore(root, process.getuid!(), process.getgid!());
    const pointerBytes = Buffer.from('fixed-pointer'); const overlayBytes = Buffer.from('fixed-overlay'); const operationId = randomUUID();
    const receipt = { pointerSha256: sha256(pointerBytes), overlaySha256: sha256(overlayBytes), containerSetSha256: hash('c'), originalTargetSetSha256: hash('d') };
    const binding = { operationId, reportSha256: hash(), sourceIdentitySha256: hash('b'), targetIdentitySha256: hash('c'), profileSha256: hash('d'), configurationSha256: hash('e') };
    await store.persist({ operationId, binding, pointerBytes, overlayBytes, receipt });
    await expect(store.load(operationId)).resolves.toMatchObject({ binding_sha256: expect.stringMatching(/^[a-f0-9]{64}$/), receipt });
    await expect(store.persist({ operationId, binding, pointerBytes, overlayBytes, receipt })).resolves.toBeUndefined();
    const changedPointer = Buffer.from('changed');
    await expect(store.persist({ operationId, binding, pointerBytes: changedPointer, overlayBytes, receipt: { ...receipt, pointerSha256: sha256(changedPointer) } })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_PREVIOUS_DEPLOYMENT_CONFLICT' });
    const capturePrevious = vi.fn();
    const boundary = { withLocks: async <T>(_order: readonly ['SITE', 'OPERATION', 'DEPLOYMENT_ROLE', 'PROMOTION'], work: () => Promise<T>) => work(),
      loadLatestPassingBinding: async () => binding, capturePrevious, fence: vi.fn(), proveStopped: async () => true, recheckPresentTimeAuthority: async () => true,
      applyFixedOverlay: vi.fn(), start: vi.fn(), proveReady: async () => true, restorePrevious: vi.fn(), transition: vi.fn() } as FixedPromotionBoundary;
    const promotion = new FixedRecoveryPromotionAdapter(operationId, binding, boundary, store);
    await expect(promotion.capturePreviousDeployment()).resolves.toEqual(receipt); expect(capturePrevious).not.toHaveBeenCalled();
  });

  it('rejects changed promotion identity and unproven writer fencing', async () => {
    const operationId = randomUUID(); const binding = { operationId, reportSha256: hash(), sourceIdentitySha256: hash('b'), targetIdentitySha256: hash('c'), profileSha256: hash('d'), configurationSha256: hash('e') };
    const previous = { pointerSha256: hash('1'), overlaySha256: hash('2'), containerSetSha256: hash('3'), originalTargetSetSha256: hash('4') };
    const adapter: RecoveryPromotionAdapter = { async withLocks<T>(_order: readonly ['SITE', 'OPERATION', 'DEPLOYMENT_ROLE', 'PROMOTION'], work: () => Promise<T>) { return work(); }, loadLatestPassingBinding: async () => ({ ...binding, reportSha256: hash('f') }),
      capturePreviousDeployment: async () => previous, persistPreviousDeploymentReceipt: vi.fn(), fencePreviousWriters: vi.fn(), provePreviousWritersStopped: async () => false,
      recheckPresentTimeAuthority: async () => true, applyFixedApprovedOverlay: vi.fn(), startRecoveredServices: vi.fn(), proveRecoveredServicesReady: async () => true, transition: vi.fn() };
    await expect(promoteControlledRecovery({ binding, confirmOperationId: operationId, confirmReportSha256: binding.reportSha256,
      approval: { authorize: async () => ({ actorId: randomUUID(), approvalId: 'approval-1' }) }, generation: randomUUID(), adapter })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_PROMOTION_BINDING_CHANGED' });
    adapter.loadLatestPassingBinding = async () => binding;
    await expect(promoteControlledRecovery({ binding, confirmOperationId: operationId, confirmReportSha256: binding.reportSha256,
      approval: { authorize: async () => ({ actorId: randomUUID(), approvalId: 'approval-2' }) }, generation: randomUUID(), adapter })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_PROMOTION_FENCE_UNPROVEN' });
  });

  it('uses protected write truth for acceptance/replay and refuses automatic post-write rollback', async () => {
    const operationId = randomUUID(); let used = false; const transition = vi.fn();
    const approval = { authorize: async () => { if (used) throw new Error('APPROVAL_REPLAY'); used = true; return { approvalId: 'approval-1' }; } };
    const withLocks = async <T>(_order: readonly ['SITE', 'OPERATION', 'DEPLOYMENT_ROLE', 'PROMOTION'], work: () => Promise<T>) => work();
    const frozen = { withLocks, observe: async () => ({ writeFreeze: true, writesResumed: false, evidenceSha256: hash() }) };
    await acceptFromProtectedAuthority({ operationId, reportSha256: hash('b'), authority: frozen, approval, transition });
    await expect(acceptFromProtectedAuthority({ operationId, reportSha256: hash('b'), authority: frozen, approval, transition })).rejects.toThrow('APPROVAL_REPLAY');
    const rollbackAdapter = { fenceRecoveredWriters: vi.fn(), proveRecoveredWritersStopped: async () => true, restoreExactPreviousDeployment: vi.fn(), startPreviousServices: vi.fn(), provePreviousServicesReady: async () => true, transition: vi.fn() };
    await expect(rollbackFromProtectedAuthority({ operationId, previous: { pointerSha256: hash('1'), overlaySha256: hash('2'), containerSetSha256: hash('3'), originalTargetSetSha256: hash('4') },
      authority: { withLocks, observe: async () => ({ writeFreeze: false, writesResumed: true, evidenceSha256: hash() }) }, adapter: rollbackAdapter })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_ROLLBACK_POST_WRITE_DECISION_REQUIRED' });
    expect(rollbackAdapter.restoreExactPreviousDeployment).not.toHaveBeenCalled();
  });

  it('serializes accept and rollback across reobservation, authorization, effects, and write-resume transition', async () => {
    const operationId = randomUUID(); let tail = Promise.resolve(); let writesResumed = false; const events: string[] = [];
    const withLocks = async <T>(_order: readonly ['SITE', 'OPERATION', 'DEPLOYMENT_ROLE', 'PROMOTION'], work: () => Promise<T>) => {
      const predecessor = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; }); await predecessor;
      try { return await work(); } finally { release(); }
    };
    let authorizeRelease!: () => void; const authorizeGate = new Promise<void>((resolve) => { authorizeRelease = resolve; });
    const authority = { withLocks, observe: async () => { events.push(`observe:${writesResumed}`); return { writeFreeze: !writesResumed, writesResumed, evidenceSha256: hash() }; } };
    const accepting = acceptFromProtectedAuthority({ operationId, reportSha256: hash('b'), authority,
      approval: { authorize: async () => { events.push('authorize'); await authorizeGate; return { approvalId: 'approval' }; } },
      transition: async () => { events.push('accept-transition'); writesResumed = true; } });
    while (!events.includes('authorize')) await Promise.resolve();
    const rollbackAdapter = { fenceRecoveredWriters: vi.fn(), proveRecoveredWritersStopped: async () => true, restoreExactPreviousDeployment: vi.fn(), startPreviousServices: vi.fn(), provePreviousServicesReady: async () => true, transition: vi.fn() };
    const rollingBack = rollbackFromProtectedAuthority({ operationId, previous: { pointerSha256: hash('1'), overlaySha256: hash('2'), containerSetSha256: hash('3'), originalTargetSetSha256: hash('4') }, authority, adapter: rollbackAdapter });
    await Promise.resolve(); expect(events).toEqual(['observe:false', 'authorize']); authorizeRelease(); await accepting;
    await expect(rollingBack).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_ROLLBACK_POST_WRITE_DECISION_REQUIRED' });
    expect(events).toEqual(['observe:false', 'authorize', 'accept-transition', 'observe:true']); expect(rollbackAdapter.fenceRecoveredWriters).not.toHaveBeenCalled();
  });
});

describe('tiny disposable Packet C harness', () => {
  const ready = { availableRamBytes: '2147483648', requiredRamBytes: '1073741824', workspaceFreeBytes: '2000', requiredWorkspaceBytes: '1000', targetFreeBytes: '3000', requiredTargetBytes: '2000', swapInUseBytes: '0', maximumSwapInUseBytes: '1', firefoxUntouched: true as const, enrolledAssetsSha256: hash() };
  it('rejects RAM/swap pressure without executing a stage', () => {
    expect(() => assertPacketCE2EReadiness({ ...ready, availableRamBytes: '1' })).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_E2E_READINESS_FAILED' }));
    expect(() => assertPacketCE2EReadiness({ ...ready, swapInUseBytes: '2' })).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_E2E_READINESS_FAILED' }));
  });
  it('requires exact enrollment/confirmation and executes the fixed serial order with owned cleanup evidence', async () => {
    const calls: string[] = []; const boundary = { observeReadiness: async () => ready, report: async () => ({ evidenceSha256: hash(), completedStages: [] }),
      execute: async (stage: string) => { calls.push(stage); return { evidenceSha256: hash('b'), ...(stage === 'CLEANUP_EXACT_OWNED_RESOURCES' ? { ownedResourceIdsSha256: hash('c') } : {}) }; } };
    await expect(runPacketCE2E({ activation: { mode: 'TINY_DISPOSABLE_PACKET_C', nonProduction: true, siteId: 'fixture', profileSha256: hash(), packetAEnrolled: true, packetBEnrolled: true, packetCEnrolled: true }, confirmation: 'wrong', boundary })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_E2E_NOT_ACTIVATED' });
    const result = await runPacketCE2E({ activation: { mode: 'TINY_DISPOSABLE_PACKET_C', nonProduction: true, siteId: 'fixture', profileSha256: hash(), packetAEnrolled: true, packetBEnrolled: true, packetCEnrolled: true }, confirmation: 'RUN_TINY_DISPOSABLE_PACKET_C', boundary });
    expect(calls).toEqual(PACKET_C_E2E_STAGES.slice(1)); expect(result).toMatchObject({ completed: true, nonProduction: true, topologyAndRtoSatisfied: false });
  });
  it('keeps report harmless and run fail-closed when Packet C activation is absent', async () => {
    const execute = vi.fn(); const boundary = { observeReadiness: async () => ready, execute,
      report: async () => ({ evidenceSha256: hash(), completedStages: [] }) }; const output = { stdout: vi.fn(), stderr: vi.fn() };
    await expect(runControlledRecoveryE2ECli(['report'], { boundary }, output)).resolves.toBe(0); expect(execute).not.toHaveBeenCalled();
    await expect(runControlledRecoveryE2ECli(['run', '--confirm', 'RUN_TINY_DISPOSABLE_PACKET_C'], { boundary }, output)).resolves.toBe(5); expect(execute).not.toHaveBeenCalled();
  });
});
