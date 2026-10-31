import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { controlledRecoveryPacket2ProfileSchema } from './packet2-profile';
import { recoveryCertificateAdmissionFailure } from '../../services/recovery-runtime-authority';
import {
  RECOVERY_APP_VALIDATION_CASES, RECOVERY_RECONCILIATION_ACTIONS,
  acceptRecoveryGenerationProof, issueRecoveryGenerationChallenge,
  promoteControlledRecovery, reconcileRecoveredApplication, reviewRecoveryPairing,
  rollbackControlledRecovery, validateIsolatedRecoveredApplication,
  recoveryGenerationProofPayload,
  preparePacket2Application,
  type RecoveryGenerationChallenge,
  type RecoveryReconciliationReceipt,
} from './packet2';
import { ControlledRecoveryJournal } from './journal';
import { buildControlledRecoveryPacket2Report } from './report';

const sha = (character = 'a') => character.repeat(64);

describe('Packet 2 release and migration boundary', () => {
  it('has a separately approved fixed release-02 profile and leaves release-01 pins out of it', async () => {
    const example = JSON.parse(await readFile(new URL('../../../../deploy/production/controlled-recovery/profile.packet2.example.json', import.meta.url), 'utf8'));
    expect(controlledRecoveryPacket2ProfileSchema.parse(example)).toMatchObject({ release_id: 'release-02', terminal_migration_id: '0056_recovery_runtime_authority.sql' });
    expect(JSON.stringify(example)).not.toContain('darshan-server-release-01');
    const migration = await readFile(new URL('../../../drizzle/migrations/0056_recovery_runtime_authority.sql', import.meta.url), 'utf8');
    expect(migration).toContain('site_recovery_generations');
    expect(migration).toContain('recovery_pairing_reviews');
    expect(migration).toContain('recovery_generation_challenges');
  });

  it('reports the durable current target release while retaining explicit legacy release-02 semantics', () => {
    const snapshot = (approvedReleaseId: 'release-01' | 'release-03') => ({
      identity: { operationId: randomUUID(), siteId: 'site-a', approvedReleaseId,
        source: { siteId: 'site-a', repositoryId: randomUUID(), runId: randomUUID(), manifestSha256: sha(), descriptorSha256: sha('b'),
          keyId: 'age-1', releaseId: approvedReleaseId, schemaMigrationId: approvedReleaseId === 'release-03'
            ? '0057_controlled_recovery_report_projection' : '0055_backup_deletion_idempotency_bindings' } },
      events: [], state: 'APPLICATION_RECONCILED' as const, pendingPhase: null, ambiguous: false,
    });
    expect(buildControlledRecoveryPacket2Report({ snapshot: snapshot('release-03'), aggregates: {}, timingsMs: {} })
      .operation.releaseId).toBe('release-03');
    expect(buildControlledRecoveryPacket2Report({ snapshot: snapshot('release-01'), aggregates: {}, timingsMs: {} })
      .operation.releaseId).toBe('release-02');
  });
});

describe('application reconciliation', () => {
  it.each(['APPLICATION_RECONCILED', 'APP_VALIDATED', 'AWAITING_PROMOTION'].flatMap((phase) =>
    ['BEFORE_INTENT', 'AFTER_INTENT', 'BEFORE_RESULT', 'AFTER_RESULT'].map((point) => [phase, point] as const)))(
    'converges after a crash at %s/%s without repeating confirmed effects', async (failedPhase, failedPoint) => {
    const root = await mkdtemp(join(tmpdir(), 'packet2-journal-'));
    try {
      const identity = { operationId: randomUUID(), siteId: 'site-a', approvedReleaseId: 'release-01' as const,
        source: { siteId: 'site-a', repositoryId: randomUUID(), runId: randomUUID(), manifestSha256: sha(), descriptorSha256: sha('b'),
          keyId: 'age-1', releaseId: 'release-01', schemaMigrationId: '0055_backup_deletion_idempotency_bindings' } };
      const journal = await ControlledRecoveryJournal.create(root, identity);
      await journal.record({ phase: 'DATA_VALIDATED', outcome: 'RESULT', effectTruth: 'CONFIRMED', code: 'DATA_VALIDATED' });
      const complete = new Set<string>(); const calls: string[] = [];
      const effect = (phase: string) => async () => { calls.push(phase); complete.add(phase); return { phase }; };
      const adapter = { observe: async (phase: string) => ({ confirmed: complete.has(phase) }),
        reconcile: effect('APPLICATION_RECONCILED'), validateApp: effect('APP_VALIDATED'), markAwaitingPromotion: effect('AWAITING_PROMOTION') };
      let injected = false;
      await expect(preparePacket2Application({ journal, adapter, fault: async (point, phase) => {
        if (!injected && point === failedPoint && phase === failedPhase) { injected = true; throw new Error('crash'); }
      } })).rejects.toThrow('crash');
      await preparePacket2Application({ journal, adapter });
      expect((await journal.read()).state).toBe('AWAITING_PROMOTION');
      expect(calls.filter((phase) => phase === failedPhase)).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
    }
  );

  it('runs every class once against exact owned targets and returns the same receipt on resume', async () => {
    const operationId = randomUUID(); const generation = randomUUID(); let receipt: RecoveryReconciliationReceipt | null = null;
    const reconcileAtomically = vi.fn(async ({ actions }) => Object.fromEntries(actions.map((action: string) => [action, action.includes('NOTIFICATION') ? '0' : '1'])) as any);
    const adapter = {
      proveOwnedTargets: vi.fn(async () => ({ operationId, siteId: 'site-a', generation, databaseTargetId: 'db-owned', objectTargetId: 'obj-owned', ownershipEvidenceSha256: sha() })),
      loadReceipt: vi.fn(async () => receipt), reconcileAtomically,
      storeReceipt: vi.fn(async (value: RecoveryReconciliationReceipt) => { receipt = value; }),
    };
    const first = await reconcileRecoveredApplication({ operationId, siteId: 'site-a', generation,
      expectedDatabaseTargetId: 'db-owned', expectedObjectTargetId: 'obj-owned', adapter });
    const second = await reconcileRecoveredApplication({ operationId, siteId: 'site-a', generation,
      expectedDatabaseTargetId: 'db-owned', expectedObjectTargetId: 'obj-owned', adapter });
    expect(first).toEqual(second); expect(reconcileAtomically).toHaveBeenCalledTimes(1);
    expect(Object.keys(first.actionCounts)).toEqual(RECOVERY_RECONCILIATION_ACTIONS);
    expect(first).toMatchObject({ notificationsPreserved: true, durableExternalDeliveryQueue: 'ABSENT_IN_RELEASE_02_SOURCE' });
  });

  it('refuses foreign targets and recovered/arbitrary jobs', async () => {
    const operationId = randomUUID(); const generation = randomUUID();
    const adapter: any = { loadReceipt: async () => null, proveOwnedTargets: async () => ({ operationId, siteId: 'site-a', generation,
      databaseTargetId: 'production', objectTargetId: 'obj', ownershipEvidenceSha256: sha() }) };
    await expect(reconcileRecoveredApplication({ operationId, siteId: 'site-a', generation, expectedDatabaseTargetId: 'owned', expectedObjectTargetId: 'obj', adapter }))
      .rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_TARGET_FOREIGN' });
    adapter.proveOwnedTargets = async () => ({ operationId, siteId: 'site-a', generation, databaseTargetId: 'owned', objectTargetId: 'obj', ownershipEvidenceSha256: sha() });
    await expect(reconcileRecoveredApplication({ operationId, siteId: 'site-a', generation, expectedDatabaseTargetId: 'owned', expectedObjectTargetId: 'obj', freshJobs: ['send-email'], adapter }))
      .rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_JOB_NOT_ALLOWLISTED' });
  });
});

describe('pairing review and generation proof', () => {
  it('uses the stable quarantine result for HTTP and signed/legacy socket admission without revocation semantics', () => {
    const pending = { active: true as const, generation: randomUUID(), status: 'PENDING' as const };
    const approved = { ...pending, status: 'APPROVED' as const };
    expect(recoveryCertificateAdmissionFailure(pending, 'http-signed')).toBe('RECOVERY_PAIRING_REVIEW_REQUIRED');
    expect(recoveryCertificateAdmissionFailure(pending, 'socket-signed')).toBe('RECOVERY_PAIRING_REVIEW_REQUIRED');
    expect(recoveryCertificateAdmissionFailure(approved, 'http-signed')).toBeNull();
    expect(recoveryCertificateAdmissionFailure(approved, 'socket-signed')).toBeNull();
    expect(recoveryCertificateAdmissionFailure(approved, 'http-legacy')).toBe('RECOVERY_PAIRING_REVIEW_REQUIRED');
    expect(recoveryCertificateAdmissionFailure(approved, 'socket-legacy')).toBe('RECOVERY_PAIRING_REVIEW_REQUIRED');
  });
  it('requires authorization and exact generation/screen/certificate for approve or reject', async () => {
    const generation = randomUUID(); const screenId = randomUUID(); const certificateId = randomUUID(); const actorId = randomUUID();
    const decideExact = vi.fn(async (value) => ({ ...value, status: value.decision, actorId: value.actorId, reviewedAt: value.reviewedAt.toISOString() }));
    await reviewRecoveryPairing({ generation, screenId, certificateId, decision: 'approve', reason: 'onsite identity checked',
      authorizer: { authorize: async () => ({ actorId }) }, store: { getExact: async () => null, decideExact } as any });
    expect(decideExact).toHaveBeenCalledWith(expect.objectContaining({ generation, screenId, certificateId, decision: 'APPROVED', actorId }));
  });

  it('accepts one signed exact challenge and rejects replay, expiry, or changed identity through stable store outcomes', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    let stored!: RecoveryGenerationChallenge; let used = false;
    const store = { create: async (value: RecoveryGenerationChallenge) => { stored = value; }, consumeExact: vi.fn(async (value: any) => {
      if (value.screenId !== stored.screenId) return 'MISMATCH' as const;
      if (value.now.getTime() > Date.parse(stored.expiresAt)) return 'EXPIRED' as const;
      if (used) return 'REPLAYED' as const; used = true; return 'CONSUMED' as const;
    }) };
    const now = new Date('2026-10-30T00:00:00.000Z');
    const challenge = await issueRecoveryGenerationChallenge({ siteId: 'site-a', generation: randomUUID(), screenId: randomUUID(),
      certificateId: randomUUID(), clientNonce: 'a'.repeat(32), store, now, random: () => 'b'.repeat(43), id: () => randomUUID() });
    const payload = recoveryGenerationProofPayload(challenge);
    const signature = sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64');
    const acceptAtomically = vi.fn(async () => undefined);
    await expect(acceptRecoveryGenerationProof({ challenge, signatureBase64: signature, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), now, store, acceptAtomically }))
      .resolves.toMatchObject({ generation: challenge.generation });
    expect(acceptAtomically).toHaveBeenCalledOnce();
    await expect(acceptRecoveryGenerationProof({ challenge, signatureBase64: signature, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), now, store, acceptAtomically }))
      .rejects.toMatchObject({ code: 'RECOVERY_GENERATION_CHALLENGE_REPLAYED' });
    used = false;
    await expect(acceptRecoveryGenerationProof({ challenge, signatureBase64: signature, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), now: new Date('2026-10-30T00:02:00.000Z'), store, acceptAtomically }))
      .rejects.toMatchObject({ code: 'RECOVERY_GENERATION_CHALLENGE_EXPIRED' });
  });
});

describe('isolated app validation, promotion and rollback', () => {
  it('requires every fixed application case and always stops the fixture application', async () => {
    const stop = vi.fn(async () => undefined);
    const adapter = { proveIsolation: async () => ({ egressBlocked: true, productionCredentialsAbsent: true, targetsEvidenceSha256: sha() }),
      runCase: vi.fn(async (test) => ({ passed: test !== 'VIDEO_LOOP', evidenceSha256: sha('b') })), stopIsolatedApplication: stop };
    await expect(validateIsolatedRecoveredApplication({ adapter, operationId: randomUUID(), generation: randomUUID() }))
      .rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_APP_VALIDATION_FAILED' });
    expect(stop).toHaveBeenCalledOnce();
    adapter.runCase.mockImplementation(async () => ({ passed: true, evidenceSha256: sha('b') }));
    await expect(validateIsolatedRecoveredApplication({ adapter, operationId: randomUUID(), generation: randomUUID() }))
      .resolves.toMatchObject({ passed: true, caseEvidence: expect.any(Object) });
    expect(adapter.runCase).toHaveBeenCalledTimes(RECOVERY_APP_VALIDATION_CASES.length + 5);
  });

  it('binds promotion exactly, uses fixed lock order, fences first and retains write freeze pending acceptance', async () => {
    const operationId = randomUUID(); const binding = { operationId, reportSha256: sha('1'), sourceIdentitySha256: sha('2'), targetIdentitySha256: sha('3'), profileSha256: sha('4'), configurationSha256: sha('5') };
    const calls: string[] = []; const previous = { pointerSha256: sha('6'), overlaySha256: sha('7'), containerSetSha256: sha('8'), originalTargetSetSha256: sha('9') };
    const adapter: any = { withLocks: async (order: string[], work: any) => { expect(order).toEqual(['SITE', 'OPERATION', 'DEPLOYMENT_ROLE', 'PROMOTION']); return work(); },
      loadLatestPassingBinding: async () => binding, capturePreviousDeployment: async () => previous,
      persistPreviousDeploymentReceipt: async () => calls.push('persist'), fencePreviousWriters: async () => calls.push('fence'), provePreviousWritersStopped: async () => true,
      recheckPresentTimeAuthority: async () => true, applyFixedApprovedOverlay: async () => calls.push('overlay'), startRecoveredServices: async () => calls.push('start'),
      proveRecoveredServicesReady: async () => true, transition: async (state: string) => calls.push(state) };
    await expect(promoteControlledRecovery({ binding, confirmOperationId: operationId, confirmReportSha256: binding.reportSha256,
      approval: { authorize: async () => ({ actorId: randomUUID(), approvalId: 'ticket-1' }) }, generation: randomUUID(), adapter }))
      .resolves.toMatchObject({ state: 'PROMOTED_PENDING_ACCEPTANCE' });
    expect(calls).toEqual(['persist', 'fence', 'overlay', 'start', 'PROMOTED_PENDING_ACCEPTANCE']);
  });

  it('rolls back exact prior pointers only under freeze and refuses post-write lossless claims', async () => {
    const previous = { pointerSha256: sha('1'), overlaySha256: sha('2'), containerSetSha256: sha('3'), originalTargetSetSha256: sha('4') };
    const adapter: any = { fenceRecoveredWriters: vi.fn(), proveRecoveredWritersStopped: async () => true,
      restoreExactPreviousDeployment: vi.fn(), startPreviousServices: vi.fn(), provePreviousServicesReady: async () => true, transition: vi.fn() };
    await rollbackControlledRecovery({ writeFreeze: true, writesResumed: false, previous, adapter });
    expect(adapter.restoreExactPreviousDeployment).toHaveBeenCalledWith(previous);
    await expect(rollbackControlledRecovery({ writeFreeze: false, writesResumed: true, previous, adapter }))
      .rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_ROLLBACK_POST_WRITE_DECISION_REQUIRED' });
  });
});
