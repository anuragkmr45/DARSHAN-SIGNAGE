import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { RECOVERY_PLAN_FORMAT_V3, recoverySourceDescriptorV2Digest, recoveryTargetSetId, sha256RecoveryBytes } from './contracts';
import { buildRecoveryPlanV3 } from './plan';
import { parseRecoveryPlanFile } from './plan-file';
import { RELEASE_RECOVERY_TARGET } from './release-target';
import { targetAdmissionSigningPayload, targetDispositionSigningPayload, verifyTargetAdmission, verifyTargetDisposition,
  type RecoveryTargetAdmission, type RecoveryTargetDispositionDecision } from './target-contracts';
import { TargetHelperJournal } from './target-helper-journal';
import { DeterministicFakeTargetEngine, RecoveryTargetHelperService } from './target-helper-service';
import { encodeTargetHelperRequest, parseTargetHelperRequest, parseTargetHelperResponse, type TargetHelperRequest } from './target-helper-protocol';
import { RecoveryJournal } from './journal';
import { RecoveryTargetClient } from './target-client';
import { RecoveryTargetWorkflow } from './target-workflow';
import { buildRecoveryTargetSpecification } from './target-specification';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

function planFixture() {
  const identity = { kind: 'LOCAL_FILESYSTEM_V2' as const, siteId: 'site-a', repositoryId: randomUUID(), runId: randomUUID(),
    attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 2, manifestSha256: 'a'.repeat(64), releaseId: 'release-01',
    schemaMigrationId: RELEASE_RECOVERY_TARGET.terminalMigrationId, schemaFingerprintSha256: 'b'.repeat(64),
    repositoryDescriptorSha256: 'c'.repeat(64) };
  const operationId = randomUUID();
  const targetPreparation = { generation: 1, hostInstallationId: randomUUID(), topologyMode: 'SINGLE_HOST' as const,
    hostPolicySha256: '1'.repeat(64), helperRoleSha256: '2'.repeat(64), engineProfileSha256: '3'.repeat(64),
    protectionInventorySha256: '4'.repeat(64), capacityEvidenceSha256: '5'.repeat(64),
    storageInventorySha256: '6'.repeat(64) };
  return buildRecoveryPlanV3({ source: { ...identity, descriptorSha256: recoverySourceDescriptorV2Digest(identity), fullyEligible: true },
    compatibility: { classification: 'COMPATIBLE_CURRENT', targetReleaseId: 'release-01',
      targetSchemaMigrationId: RELEASE_RECOVERY_TARGET.terminalMigrationId, sourceLedgerLength: 55,
      pendingMigrationIds: [], fullyEligible: true }, target: RELEASE_RECOVERY_TARGET,
    targetPreparation,
    targetSpecification: buildRecoveryTargetSpecification({ operationId, target: RELEASE_RECOVERY_TARGET, targetPreparation }),
    planId: randomUUID(), operationId, createdAt: new Date('2026-10-29T00:00:00.000Z') });
}

function request(plan = planFixture(), operation: TargetHelperRequest['operation'] = 'PREPARE'): TargetHelperRequest {
  return { format: 'darshan-recovery-target-helper-v1', requestId: randomUUID(), operation,
    operationId: plan.plan.operationId, siteId: plan.plan.source.siteId,
    hostInstallationId: plan.plan.targetPreparation.hostInstallationId, planSha256: plan.sha256,
    targetSetId: plan.plan.targetPreparation.targetSetId, generation: 1,
    targetSpecificationSha256: plan.plan.targetPreparation.targetSpecificationSha256,
    authorizationSha256: '8'.repeat(64), expectedHelperSequence: null };
}

function signedAdmission(built: ReturnType<typeof planFixture>, keys: ReturnType<typeof generateKeyPairSync>, keyId: string) {
  const admission: RecoveryTargetAdmission = { format: 'darshan-recovery-target-admission-v1', admissionId: randomUUID(),
    operationId: built.plan.operationId, siteId: built.plan.source.siteId,
    hostInstallationId: built.plan.targetPreparation.hostInstallationId, planSha256: built.sha256,
    targetSetId: built.plan.targetPreparation.targetSetId, generation: built.plan.targetPreparation.generation,
    targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256,
    allowedActions: ['PREPARE', 'INSPECT'], issuedAt: '2026-10-29T00:00:00.000Z', expiresAt: '2026-10-29T01:00:00.000Z' };
  return canonicalJson({ admission, signature: { algorithm: 'Ed25519', keyId,
    valueBase64: sign(null, targetAdmissionSigningPayload(admission), keys.privateKey).toString('base64') } });
}

function signedDisposition(built: ReturnType<typeof planFixture>, keys: ReturnType<typeof generateKeyPairSync>, keyId: string,
  expectedHelperSequence: number, preparedReceiptSha256: string, action: 'STOP_RETAIN' | 'RETIRE' = 'STOP_RETAIN') {
  const decision: RecoveryTargetDispositionDecision = { format: 'darshan-recovery-target-disposition-v1',
    decisionId: randomUUID(), operationId: built.plan.operationId, siteId: built.plan.source.siteId,
    hostInstallationId: built.plan.targetPreparation.hostInstallationId, planSha256: built.sha256,
    targetSetId: built.plan.targetPreparation.targetSetId, generation: built.plan.targetPreparation.generation,
    action, expectedHelperSequence, expectedTargetState: 'READY', preparedReceiptSha256,
    issuedAt: '2026-10-29T00:00:00.000Z', expiresAt: '2026-10-29T01:00:00.000Z' };
  return canonicalJson({ decision, signature: { algorithm: 'Ed25519', keyId,
    valueBase64: sign(null, targetDispositionSigningPayload(decision), keys.privateKey).toString('base64') } });
}

async function targetWorkflowFixture(input: {
  helperFault?: ConstructorParameters<typeof RecoveryTargetHelperService>[0]['fault'];
  recoveryFault?: ConstructorParameters<typeof RecoveryJournal>[0]['fault'];
  hold?: () => Promise<boolean>;
  authorize?: ConstructorParameters<typeof RecoveryTargetHelperService>[0]['authorize'];
} = {}) {
  const recoveryRoot = await fs.mkdtemp(join(tmpdir(), 'target-correction-recovery-')); roots.push(recoveryRoot);
  const helperRoot = await fs.mkdtemp(join(tmpdir(), 'target-correction-helper-')); roots.push(helperRoot);
  const built = planFixture(); const ownerId = randomUUID(); const fenceToken = randomUUID();
  const journal = new RecoveryJournal({ root: recoveryRoot, fault: input.recoveryFault,
    now: () => new Date('2026-10-29T00:10:00.000Z') });
  let state = await journal.create({ operationId: built.plan.operationId, siteId: built.plan.source.siteId,
    planId: built.plan.planId, planSha256: built.sha256, sourceDescriptorSha256: built.plan.source.descriptorSha256,
    ownerId, fenceToken, targetBinding: { targetSetId: built.plan.targetPreparation.targetSetId,
      generation: 1, hostInstallationId: built.plan.targetPreparation.hostInstallationId,
      topologyMode: 'SINGLE_HOST', targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256 } });
  state = await journal.withOperation(state.operationId, { expectedSequence: 0, expectedOwnerId: ownerId, expectedFenceToken: fenceToken,
    expectedSiteId: 'site-a', expectedPlanId: built.plan.planId, expectedPlanSha256: built.sha256 }, async (operation) => {
    await operation.recordPhaseIntent('SOURCE_HELD'); await operation.completePhase('SOURCE_HELD');
    await operation.recordPhaseIntent('SOURCE_VERIFIED'); return operation.completePhase('SOURCE_VERIFIED');
  });
  const engine = new DeterministicFakeTargetEngine(); const helperJournal = new TargetHelperJournal({ root: helperRoot });
  const service = new RecoveryTargetHelperService({ journal: helperJournal, engine, authorize: input.authorize ?? (() => undefined),
    fault: input.helperFault, now: () => new Date('2026-10-29T00:10:00.000Z') });
  const client = new RecoveryTargetClient({ transport: { request: (bytes) => service.handle(bytes) } });
  const keys = generateKeyPairSync('ed25519'); const keyId = 'target-authority-1';
  const admissionBytes = signedAdmission(built, keys, keyId);
  const workflow = new RecoveryTargetWorkflow({ journal, client,
    inspectSourceHoldActive: input.hold ?? (async () => true),
    admissionKeys: new Map([[keyId, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
    now: () => new Date('2026-10-29T00:10:00.000Z') });
  return { built, journal, helperRoot, helperJournal, engine, service, client, keys, keyId, admissionBytes, workflow, state };
}

describe('recovery target foundation', () => {
  it('builds and strictly reads plan v3 with a non-circular domain-separated targetSetId', () => {
    const built = planFixture(); expect(built.plan.format).toBe(RECOVERY_PLAN_FORMAT_V3);
    const { targetSetId, ...identity } = built.plan.targetPreparation;
    expect(targetSetId).toBe(recoveryTargetSetId(identity));
    expect(parseRecoveryPlanFile(built.bytes, built.sha256)).toEqual(built.plan);
    expect(() => parseRecoveryPlanFile(canonicalJson({ ...built.plan, targetPreparation: {
      ...built.plan.targetPreparation, targetSpecificationSha256: '9'.repeat(64) } }))).toThrowError(expect.objectContaining({ code: 'RECOVERY_PLAN_CORRUPT' }));
  });

  it('verifies exact Ed25519 admission bindings, action, expiry, revocation, and duplicate rejection', () => {
    const built = planFixture(); const keys = generateKeyPairSync('ed25519'); const keyId = 'target-authority-1';
    const admission: RecoveryTargetAdmission = { format: 'darshan-recovery-target-admission-v1', admissionId: randomUUID(),
      operationId: built.plan.operationId, siteId: 'site-a', hostInstallationId: built.plan.targetPreparation.hostInstallationId,
      planSha256: built.sha256, targetSetId: built.plan.targetPreparation.targetSetId, generation: 1,
      targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256, allowedActions: ['PREPARE', 'INSPECT'],
      issuedAt: '2026-10-29T00:00:00.000Z', expiresAt: '2026-10-29T01:00:00.000Z' };
    const signed = canonicalJson({ admission, signature: { algorithm: 'Ed25519', keyId,
      valueBase64: sign(null, targetAdmissionSigningPayload(admission), keys.privateKey).toString('base64') } });
    const context = { keys: new Map([[keyId, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
      now: new Date('2026-10-29T00:30:00.000Z'), expected: { operationId: built.plan.operationId, siteId: 'site-a',
        hostInstallationId: built.plan.targetPreparation.hostInstallationId, planSha256: built.sha256,
        targetSetId: built.plan.targetPreparation.targetSetId, generation: 1,
        targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256 } };
    expect(verifyTargetAdmission(signed, context, 'PREPARE').admission.admissionId).toBe(admission.admissionId);
    expect(() => verifyTargetAdmission(signed, context, 'RETIRE')).toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_ACTION_NOT_ALLOWED' }));
    expect(() => verifyTargetAdmission(signed, { ...context, now: new Date('2026-10-29T02:00:00.000Z') }, 'PREPARE'))
      .toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_AUTH_EXPIRED' }));
    expect(() => verifyTargetAdmission(signed, { ...context, revokedKeyIds: new Set([keyId]) }, 'PREPARE'))
      .toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_AUTH_REVOKED' }));
    const wrong = generateKeyPairSync('ed25519');
    expect(() => verifyTargetAdmission(signed, { ...context,
      keys: new Map([[keyId, wrong.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]) }, 'PREPARE'))
      .toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_AUTH_INVALID' }));
    expect(() => verifyTargetAdmission(signed, { ...context, expected: { ...context.expected, siteId: 'site-b' } }, 'PREPARE'))
      .toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' }));
    expect(() => verifyTargetAdmission(signed, { ...context,
      expected: { ...context.expected, hostInstallationId: randomUUID() } }, 'PREPARE'))
      .toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' }));
    const changedBody = canonicalJson({ admission: { ...admission, siteId: 'site-b' },
      signature: { algorithm: 'Ed25519', keyId,
        valueBase64: sign(null, targetAdmissionSigningPayload(admission), keys.privateKey).toString('base64') } });
    expect(() => verifyTargetAdmission(changedBody, { ...context, expected: { ...context.expected, siteId: 'site-b' } }, 'PREPARE'))
      .toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_AUTH_INVALID' }));
    expect(() => verifyTargetAdmission(canonicalJson({ admission: { ...admission, allowedActions: ['PREPARE', 'PREPARE'] },
      signature: { algorithm: 'Ed25519', keyId, valueBase64: 'A'.repeat(88) } }), context, 'PREPARE'))
      .toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_AUTH_INVALID' }));
    const decision: RecoveryTargetDispositionDecision = { format: 'darshan-recovery-target-disposition-v1',
      decisionId: randomUUID(), operationId: admission.operationId, siteId: admission.siteId,
      hostInstallationId: admission.hostInstallationId, planSha256: admission.planSha256,
      targetSetId: admission.targetSetId, generation: admission.generation, action: 'STOP_RETAIN', expectedHelperSequence: 2,
      expectedTargetState: 'READY', preparedReceiptSha256: 'f'.repeat(64),
      issuedAt: admission.issuedAt, expiresAt: admission.expiresAt };
    const signedDecision = canonicalJson({ decision, signature: { algorithm: 'Ed25519', keyId,
      valueBase64: sign(null, targetDispositionSigningPayload(decision), keys.privateKey).toString('base64') } });
    expect(verifyTargetDisposition(signedDecision, context, 'STOP_RETAIN').decision.decisionId).toBe(decision.decisionId);
    expect(() => verifyTargetDisposition(signedDecision, context, 'RETIRE'))
      .toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_ACTION_NOT_ALLOWED' }));
  });

  it('rejects protocol unknown fields, noncanonical bytes, and oversized requests', () => {
    const value = request(); const bytes = encodeTargetHelperRequest(value);
    expect(parseTargetHelperRequest(bytes)).toEqual(value);
    expect(() => parseTargetHelperRequest(canonicalJson({ ...value, unknown: true }))).toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_PROTOCOL_INVALID' }));
    expect(() => parseTargetHelperRequest(Buffer.from(JSON.stringify(value)))).toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_PROTOCOL_INVALID' }));
    expect(() => parseTargetHelperRequest(Buffer.alloc(64 * 1024 + 1, 0x20))).toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_PROTOCOL_INVALID' }));
  });

  it('prepares, inspects, stops, retires, and coalesces exact duplicate helper requests', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-helper-')); roots.push(root); const built = planFixture();
    const engine = new DeterministicFakeTargetEngine(); const service = new RecoveryTargetHelperService({
      journal: new TargetHelperJournal({ root, now: () => new Date('2026-10-29T00:00:00.000Z') }), engine, authorize: () => undefined,
      now: () => new Date('2026-10-29T00:00:00.000Z') });
    const prepare = request(built); const [firstBytes, concurrentBytes] = await Promise.all([
      service.handle(encodeTargetHelperRequest(prepare)), service.handle(encodeTargetHelperRequest(prepare)),
    ]);
    expect(concurrentBytes).toEqual(firstBytes);
    expect(parseTargetHelperResponse(firstBytes)).toMatchObject({ ok: true, state: 'READY', helperSequence: 2 });
    expect(await service.handle(encodeTargetHelperRequest(prepare))).toEqual(firstBytes);
    const inspect = { ...request(built, 'INSPECT'), expectedHelperSequence: null };
    expect(parseTargetHelperResponse(await service.handle(encodeTargetHelperRequest(inspect)))).toMatchObject({ ok: true, state: 'READY' });
    expect(parseTargetHelperResponse(await service.handle(encodeTargetHelperRequest({ ...inspect, requestId: randomUUID() }))))
      .toMatchObject({ ok: true, state: 'READY', helperSequence: 2 });
    expect(await new TargetHelperJournal({ root }).read(built.plan.targetPreparation.targetSetId))
      .toMatchObject({ helperSequence: 2, state: 'READY' });
    const stop = { ...request(built, 'STOP_RETAIN'), expectedHelperSequence: 2 };
    expect(parseTargetHelperResponse(await service.handle(encodeTargetHelperRequest(stop)))).toMatchObject({ ok: true, state: 'STOPPED_RETAINED' });
    const retire = { ...request(built, 'RETIRE'), expectedHelperSequence: 4 };
    expect(parseTargetHelperResponse(await service.handle(encodeTargetHelperRequest(retire)))).toMatchObject({ ok: true, state: 'RETIRED' });
  });

  it('rejects requestId body conflict and reconciles an ambiguous lost response after helper restart', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-helper-')); roots.push(root); const built = planFixture();
    const engine = new DeterministicFakeTargetEngine(); engine.injectFailure('PREPARE', 'AMBIGUOUS');
    const journal = new TargetHelperJournal({ root, now: () => new Date('2026-10-29T00:00:00.000Z') });
    const first = new RecoveryTargetHelperService({ journal, engine, authorize: () => undefined,
      now: () => new Date('2026-10-29T00:00:00.000Z') });
    const prepare = request(built);
    await expect(first.handle(encodeTargetHelperRequest(prepare))).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    const restarted = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root }), engine,
      authorize: () => undefined, now: () => new Date('2026-10-29T00:01:00.000Z') });
    expect(parseTargetHelperResponse(await restarted.handle(encodeTargetHelperRequest(prepare))))
      .toMatchObject({ ok: true, state: 'READY', effectDisposition: 'DEFINITE' });
    await expect(restarted.handle(encodeTargetHelperRequest({ ...prepare, operation: 'RETIRE' })))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_REQUEST_CONFLICT' });
    const state = await journal.read(built.plan.targetPreparation.targetSetId);
    expect(state).toMatchObject({ state: 'READY', pendingAction: null, replay: [{ requestId: prepare.requestId }] });
    expect(JSON.stringify(state)).not.toMatch(/private|password|credential|secret/i);
    expect(state.lastReceiptSha256).toBe(sha256RecoveryBytes(canonicalJson(state.replay[0]!.response)));
  });

  it.each(['after-intent', 'before-effect', 'after-effect', 'before-receipt', 'after-receipt'] as const)(
    'restarts safely across the %s crash boundary', async (stage) => {
      const root = await fs.mkdtemp(join(tmpdir(), 'target-boundary-')); roots.push(root); const built = planFixture();
      const engine = new DeterministicFakeTargetEngine(); const journal = new TargetHelperJournal({ root }); let fail = true;
      const crashing = new RecoveryTargetHelperService({ journal, engine, authorize: () => undefined,
        fault: async (point) => { if (point === stage && fail) { fail = false; throw new Error(`crash:${stage}`); } } });
      const prepare = request(built);
      await expect(crashing.handle(encodeTargetHelperRequest(prepare))).rejects.toThrow(`crash:${stage}`);
      const restarted = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root }), engine,
        authorize: () => undefined });
      expect(parseTargetHelperResponse(await restarted.handle(encodeTargetHelperRequest(prepare))))
        .toMatchObject({ ok: true, state: 'READY', pendingAction: null });
      expect(await journal.read(built.plan.targetPreparation.targetSetId)).toMatchObject({ state: 'READY', pendingAction: null });
    },
  );

  describe.each(['STOP_RETAIN', 'RETIRE'] as const)('%s exact retry sequencing', (operation) => {
    it.each(['after-intent', 'before-effect', 'after-effect', 'before-receipt', 'after-receipt'] as const)(
      'reconciles before stale expected-sequence rejection at %s', async (stage) => {
        const root = await fs.mkdtemp(join(tmpdir(), 'target-disposition-boundary-')); roots.push(root); const built = planFixture();
        const engine = new DeterministicFakeTargetEngine(); const journal = new TargetHelperJournal({ root });
        const normal = new RecoveryTargetHelperService({ journal, engine, authorize: () => undefined });
        const prepared = parseTargetHelperResponse(await normal.handle(encodeTargetHelperRequest(request(built))));
        expect(prepared).toMatchObject({ ok: true, state: 'READY' });
        const disposition = { ...request(built, operation), expectedHelperSequence: prepared.helperSequence };
        let fail = true;
        const crashing = new RecoveryTargetHelperService({ journal, engine, authorize: () => undefined,
          fault: async (point) => { if (point === stage && fail) { fail = false; throw new Error(`crash:${stage}`); } } });
        await expect(crashing.handle(encodeTargetHelperRequest(disposition))).rejects.toThrow(`crash:${stage}`);
        const restarted = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root }), engine,
          authorize: () => undefined });
        const response = parseTargetHelperResponse(await restarted.handle(encodeTargetHelperRequest(disposition)));
        expect(response).toMatchObject({ ok: true,
          state: operation === 'STOP_RETAIN' ? 'STOPPED_RETAINED' : 'RETIRED', pendingAction: null });
        expect(response.helperSequence).toBeGreaterThan(prepared.helperSequence);
      },
    );
  });

  it.each(['after-intent', 'before-effect', 'after-effect', 'before-receipt', 'after-receipt'] as const)(
    'workflow restart reuses exact PREPARE request across %s and blocks release while unknown', async (stage) => {
      let armed = false;
      const fixture = await targetWorkflowFixture({ helperFault: async (point) => {
        if (armed && point === stage) { armed = false; throw new Error(`workflow-crash:${stage}`); }
      } });
      armed = true;
      await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        admissionBytes: fixture.admissionBytes })).rejects.toThrow(`workflow-crash:${stage}`);
      const pending = await fixture.journal.read(fixture.built.plan.operationId);
      expect(pending).toMatchObject({ phase: 'SOURCE_VERIFIED', pendingPhase: 'TARGETS_PREPARED',
        targetEffectStatus: 'PREPARE_DISPATCH_UNKNOWN', targetPreparationRequest: { status: 'DISPATCH_UNKNOWN' } });
      const release = { decisionId: randomUUID(), closedAs: 'ABORTED_PRE_IMPORT' as const, action: 'RELEASE' as const,
        status: 'PENDING' as const, reviewSha256: '1'.repeat(64), reviewEvidenceSha256: '2'.repeat(64),
        reviewedAt: '2026-10-29T00:11:00.000Z', observedStatus: 'ACTIVE' as const,
        observedEvidenceSha256: '3'.repeat(64), confirmedAt: null, failureCode: null, priorDecisionSha256: null };
      await expect(fixture.journal.withOperation(pending.operationId, { expectedSequence: pending.sequence,
        expectedOwnerId: pending.ownerId, expectedFenceToken: pending.fenceToken, expectedSiteId: pending.siteId,
        expectedPlanId: pending.planId, expectedPlanSha256: pending.planSha256 },
      (operation) => operation.recordHoldDisposition(release))).rejects.toMatchObject({ code: 'RECOVERY_STATE_INVALID' });
      const restartedService = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root: fixture.helperRoot }),
        engine: fixture.engine, authorize: () => undefined });
      const restartedWorkflow = new RecoveryTargetWorkflow({ journal: fixture.journal,
        client: new RecoveryTargetClient({ transport: { request: (bytes) => restartedService.handle(bytes) } }),
        inspectSourceHoldActive: async () => true,
        admissionKeys: new Map([[fixture.keyId, fixture.keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
        now: () => new Date('2026-10-29T00:12:00.000Z') });
      await expect(restartedWorkflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        admissionBytes: fixture.admissionBytes })).resolves.toMatchObject({ lifecycle: 'READY' });
      const completed = await fixture.journal.read(fixture.built.plan.operationId);
      expect(completed.targetPreparationRequest?.requestId).toBe(pending.targetPreparationRequest?.requestId);
      expect(completed).toMatchObject({ targetEffectStatus: 'READY_PROVEN', targetPreparationRequest: { status: 'COMPLETED' } });
    },
  );

  it('workflow reconciles an ambiguous engine effect with the exact retained PREPARE request', async () => {
    const fixture = await targetWorkflowFixture(); fixture.engine.injectFailure('PREPARE', 'AMBIGUOUS');
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    const pending = await fixture.journal.read(fixture.built.plan.operationId);
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes })).resolves.toMatchObject({ lifecycle: 'READY' });
    const completed = await fixture.journal.read(fixture.built.plan.operationId);
    expect(completed.targetPreparationRequest?.requestId).toBe(pending.targetPreparationRequest?.requestId);
  });

  it('retains definite PREPARE rejection evidence and permits only a fresh sequence-bound retry', async () => {
    const fixture = await targetWorkflowFixture(); fixture.engine.injectFailure('PREPARE', 'DEFINITE');
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_NOT_READY' });
    const rejected = await fixture.journal.read(fixture.built.plan.operationId);
    expect(rejected).toMatchObject({ phase: 'SOURCE_VERIFIED', pendingPhase: null, targetEffectStatus: 'NONE_PROVEN',
      targetPreparationRequest: null, targetRejectedRequests: [{ action: 'PREPARE', rejectionCode: 'TARGET_ENGINE_FAILED',
        rejectionHelperSequence: 2 }] });
    const retainedRequestId = rejected.targetRejectedRequests[0]!.requestId;
    expect((await fixture.helperJournal.read(fixture.built.plan.targetPreparation.targetSetId)).replay)
      .toEqual(expect.arrayContaining([expect.objectContaining({ requestId: retainedRequestId,
        response: expect.objectContaining({ ok: false, error: { code: 'TARGET_ENGINE_FAILED', message: expect.any(String) } }) })]));
    const freshAdmission = signedAdmission(fixture.built, fixture.keys, fixture.keyId);
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: freshAdmission })).resolves.toMatchObject({ lifecycle: 'READY' });
    const completed = await fixture.journal.read(fixture.built.plan.operationId);
    expect(completed.targetPreparationRequest).toMatchObject({ expectedHelperSequence: 2, status: 'COMPLETED' });
    expect(completed.targetPreparationRequest?.requestId).not.toBe(retainedRequestId);
    expect(completed.targetRejectedRequests).toHaveLength(1);
  });

  it('resumes a retained PREPARE rejection by read-only proof without replaying its engine effect', async () => {
    let crashInspect = true; let prepareEffects = 0;
    const fixture = await targetWorkflowFixture({ authorize: (value) => {
      if (value.operation === 'INSPECT' && crashInspect) throw new Error('crash-after-prepare-rejection');
    } });
    const originalPrepare = fixture.engine.prepare.bind(fixture.engine);
    fixture.engine.prepare = async (identity) => { prepareEffects += 1; return originalPrepare(identity); };
    fixture.engine.injectFailure('PREPARE', 'DEFINITE');
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes })).rejects.toThrow('crash-after-prepare-rejection');
    const retained = await fixture.journal.read(fixture.built.plan.operationId);
    expect(retained).toMatchObject({ targetEffectStatus: 'PREPARE_REJECTED_DEFINITE',
      targetPreparationRequest: { status: 'REJECTED_DEFINITE' } });
    const rejected = retained.targetPreparationRequest!;
    const exact = { requestId: rejected.requestId, requestSha256: rejected.requestSha256,
      receiptSha256: rejected.rejectionReceiptSha256!, helperSequence: rejected.rejectionHelperSequence!,
      state: rejected.rejectionState!, code: rejected.rejectionCode! };
    const idempotent = await fixture.journal.withOperation(retained.operationId, { expectedSequence: retained.sequence,
      expectedOwnerId: retained.ownerId, expectedFenceToken: retained.fenceToken, expectedSiteId: retained.siteId,
      expectedPlanId: retained.planId, expectedPlanSha256: retained.planSha256 },
    (operation) => operation.recordTargetPreparationRejection(exact));
    expect(idempotent.sequence).toBe(retained.sequence);
    await expect(fixture.journal.withOperation(retained.operationId, { expectedSequence: retained.sequence,
      expectedOwnerId: retained.ownerId, expectedFenceToken: retained.fenceToken, expectedSiteId: retained.siteId,
      expectedPlanId: retained.planId, expectedPlanSha256: retained.planSha256 },
    (operation) => operation.recordTargetPreparationRejection({ ...exact, receiptSha256: 'f'.repeat(64) })))
      .rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CONFLICT' });
    await expect(fixture.journal.withOperation(retained.operationId, { expectedSequence: retained.sequence,
      expectedOwnerId: retained.ownerId, expectedFenceToken: retained.fenceToken, expectedSiteId: retained.siteId,
      expectedPlanId: retained.planId, expectedPlanSha256: retained.planSha256 },
    (operation) => operation.recordTargetPreparationRejection({ ...exact, requestSha256: 'e'.repeat(64) })))
      .rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CONFLICT' });
    crashInspect = false;
    const concurrent = await Promise.allSettled([
      fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        admissionBytes: fixture.admissionBytes }),
      fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        admissionBytes: fixture.admissionBytes }),
    ]);
    expect(concurrent.every((outcome) => outcome.status === 'rejected')).toBe(true);
    expect(prepareEffects).toBe(1);
    expect(await fixture.journal.read(fixture.built.plan.operationId)).toMatchObject({ targetEffectStatus: 'NONE_PROVEN',
      targetPreparationRequest: null, targetRejectedRequests: [{ requestId: rejected.requestId }] });
    const freshAdmission = signedAdmission(fixture.built, fixture.keys, fixture.keyId);
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: freshAdmission })).resolves.toMatchObject({ lifecycle: 'READY' });
    expect(prepareEffects).toBe(2);
  });

  it('retains PREPARE rejection across invalid inspection and a failed resolution journal write', async () => {
    let failResolution = false; let armResolutionFailure = true;
    const fixture = await targetWorkflowFixture({ authorize: (value) => {
      if (value.operation === 'INSPECT' && armResolutionFailure) { failResolution = true; armResolutionFailure = false; }
    }, recoveryFault: async (stage) => {
      if (stage === 'after-temp-fsync-before-rename' && failResolution) {
        failResolution = false; throw new Error('prepare-rejection-resolution-write');
      }
    } });
    fixture.engine.injectFailure('PREPARE', 'DEFINITE');
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes })).rejects.toThrow('prepare-rejection-resolution-write');
    expect(await fixture.journal.read(fixture.built.plan.operationId)).toMatchObject({
      targetEffectStatus: 'PREPARE_REJECTED_DEFINITE' });
    fixture.engine.setState(fixture.built.plan.targetPreparation.targetSetId, 'READY');
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    expect(await fixture.journal.read(fixture.built.plan.operationId)).toMatchObject({
      targetEffectStatus: 'PREPARE_REJECTED_DEFINITE' });
    fixture.engine.setState(fixture.built.plan.targetPreparation.targetSetId, 'ABSENT');
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_NOT_READY' });
    expect(await fixture.journal.read(fixture.built.plan.operationId)).toMatchObject({ targetEffectStatus: 'NONE_PROVEN' });
  });

  it('keeps an ambiguous PREPARE pinned and rejects a fresh authorization/body', async () => {
    const fixture = await targetWorkflowFixture(); fixture.engine.injectFailure('PREPARE', 'AMBIGUOUS');
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    const pending = await fixture.journal.read(fixture.built.plan.operationId);
    const freshAdmission = signedAdmission(fixture.built, fixture.keys, fixture.keyId);
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: freshAdmission })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
    const unchanged = await fixture.journal.read(fixture.built.plan.operationId);
    expect(unchanged.targetPreparationRequest?.requestId).toBe(pending.targetPreparationRequest?.requestId);
    expect(unchanged.targetRejectedRequests).toHaveLength(0);
  });

  it.each(['STOP_RETAIN', 'RETIRE'] as const)(
    'retains definite %s rejection evidence and accepts a newly signed fresh-sequence decision', async (action) => {
      const fixture = await targetWorkflowFixture();
      await fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        admissionBytes: fixture.admissionBytes });
      const prepared = await fixture.journal.read(fixture.built.plan.operationId);
      fixture.engine.injectFailure(action, 'DEFINITE');
      const rejectedDecision = signedDisposition(fixture.built, fixture.keys, fixture.keyId,
        prepared.targetHelperSequence!, prepared.targetReceiptSha256!, action);
      await expect(fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        decisionBytes: rejectedDecision })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_NOT_READY' });
      const rejected = await fixture.journal.read(fixture.built.plan.operationId);
      expect(rejected).toMatchObject({ targetEffectStatus: 'READY_PROVEN', targetDispositionIntent: null,
        targetHelperSequence: 4, targetRejectedRequests: [{ action, rejectionCode: 'TARGET_ENGINE_FAILED',
          rejectionHelperSequence: 4 }] });
      const retainedRequestId = rejected.targetRejectedRequests[0]!.requestId;
      expect((await fixture.helperJournal.read(fixture.built.plan.targetPreparation.targetSetId)).replay)
        .toEqual(expect.arrayContaining([expect.objectContaining({ requestId: retainedRequestId,
          response: expect.objectContaining({ ok: false }) })]));
      const freshDecision = signedDisposition(fixture.built, fixture.keys, fixture.keyId,
        rejected.targetHelperSequence!, rejected.targetReceiptSha256!, action);
      await expect(fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        decisionBytes: freshDecision })).resolves.toMatchObject({ lifecycle: action === 'STOP_RETAIN' ? 'STOPPED_RETAINED' : 'RETIRED' });
      expect((await fixture.journal.read(fixture.built.plan.operationId)).targetRejectedRequests).toHaveLength(1);
    },
  );

  it.each(['STOP_RETAIN', 'RETIRE'] as const)(
    'resumes retained %s rejection by inspection without replaying its engine effect', async (action) => {
      let inspections = 0; let dispositionEffects = 0;
      const fixture = await targetWorkflowFixture({ authorize: (value) => {
        if (value.operation === 'INSPECT' && ++inspections === 2) throw new Error(`crash-after-${action}-rejection`);
      } });
      await fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        admissionBytes: fixture.admissionBytes });
      const prepared = await fixture.journal.read(fixture.built.plan.operationId);
      const originalEffect = action === 'STOP_RETAIN'
        ? fixture.engine.stopRetain.bind(fixture.engine) : fixture.engine.retire.bind(fixture.engine);
      if (action === 'STOP_RETAIN') fixture.engine.stopRetain = async (identity) => {
        dispositionEffects += 1; return originalEffect(identity);
      };
      else fixture.engine.retire = async (identity) => { dispositionEffects += 1; return originalEffect(identity); };
      fixture.engine.injectFailure(action, 'DEFINITE');
      const decision = signedDisposition(fixture.built, fixture.keys, fixture.keyId,
        prepared.targetHelperSequence!, prepared.targetReceiptSha256!, action);
      await expect(fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        decisionBytes: decision })).rejects.toThrow(`crash-after-${action}-rejection`);
      const retained = await fixture.journal.read(fixture.built.plan.operationId); const intent = retained.targetDispositionIntent!;
      expect(retained).toMatchObject({ targetEffectStatus: 'DISPOSITION_REJECTED_DEFINITE',
        targetDispositionIntent: { status: 'REJECTED_DEFINITE', action } });
      const exact = { requestId: intent.requestId, requestSha256: intent.requestSha256,
        receiptSha256: intent.rejectionReceiptSha256!, helperSequence: intent.rejectionHelperSequence!,
        state: intent.rejectionState!, code: intent.rejectionCode! };
      const same = await fixture.journal.withOperation(retained.operationId, { expectedSequence: retained.sequence,
        expectedOwnerId: retained.ownerId, expectedFenceToken: retained.fenceToken, expectedSiteId: retained.siteId,
        expectedPlanId: retained.planId, expectedPlanSha256: retained.planSha256 },
      (operation) => operation.recordTargetDispositionRejection(exact));
      expect(same.sequence).toBe(retained.sequence);
      await expect(fixture.journal.withOperation(retained.operationId, { expectedSequence: retained.sequence,
        expectedOwnerId: retained.ownerId, expectedFenceToken: retained.fenceToken, expectedSiteId: retained.siteId,
        expectedPlanId: retained.planId, expectedPlanSha256: retained.planSha256 },
      (operation) => operation.recordTargetDispositionRejection({ ...exact, code: 'TARGET_STATE_CONFLICT' })))
        .rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CONFLICT' });
      await expect(fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        decisionBytes: decision })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_NOT_READY' });
      expect(dispositionEffects).toBe(1);
      const resolved = await fixture.journal.read(fixture.built.plan.operationId);
      expect(resolved).toMatchObject({ targetEffectStatus: 'READY_PROVEN', targetDispositionIntent: null,
        targetRejectedRequests: [{ requestId: intent.requestId, action }] });
      const freshDecision = signedDisposition(fixture.built, fixture.keys, fixture.keyId,
        resolved.targetHelperSequence!, resolved.targetReceiptSha256!, action);
      await expect(fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        decisionBytes: freshDecision })).resolves.toMatchObject({
          lifecycle: action === 'STOP_RETAIN' ? 'STOPPED_RETAINED' : 'RETIRED' });
      expect(dispositionEffects).toBe(2);
    },
  );

  it('keeps an ambiguous disposition pinned and rejects a newly signed decision', async () => {
    const fixture = await targetWorkflowFixture();
    await fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes });
    const prepared = await fixture.journal.read(fixture.built.plan.operationId);
    fixture.engine.injectFailure('STOP_RETAIN', 'AMBIGUOUS');
    const originalDecision = signedDisposition(fixture.built, fixture.keys, fixture.keyId,
      prepared.targetHelperSequence!, prepared.targetReceiptSha256!);
    await expect(fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      decisionBytes: originalDecision })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    const pending = await fixture.journal.read(fixture.built.plan.operationId);
    const freshDecision = signedDisposition(fixture.built, fixture.keys, fixture.keyId,
      prepared.targetHelperSequence!, prepared.targetReceiptSha256!);
    await expect(fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      decisionBytes: freshDecision })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
    expect((await fixture.journal.read(fixture.built.plan.operationId)).targetDispositionIntent?.requestId)
      .toBe(pending.targetDispositionIntent?.requestId);
  });

  it('keeps online status read-only across repeated and concurrent disposition inspection', async () => {
    const fixture = await targetWorkflowFixture();
    await fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes });
    const prepared = await fixture.journal.read(fixture.built.plan.operationId);
    const helperStatePath = join(fixture.helperRoot, 'target-sets', fixture.built.plan.targetPreparation.targetSetId, 'state.json');
    const beforeStatusBytes = await fs.readFile(helperStatePath);
    await fixture.workflow.status({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes });
    expect(await fs.readFile(helperStatePath)).toEqual(beforeStatusBytes);
    await fixture.workflow.status({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes });
    expect(await fixture.helperJournal.read(fixture.built.plan.targetPreparation.targetSetId))
      .toMatchObject({ helperSequence: prepared.targetHelperSequence, state: 'READY' });
    const decisionBytes = signedDisposition(fixture.built, fixture.keys, fixture.keyId,
      prepared.targetHelperSequence!, prepared.targetReceiptSha256!);
    const [status, disposed] = await Promise.all([
      fixture.workflow.status({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
        admissionBytes: fixture.admissionBytes }),
      fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256, decisionBytes }),
    ]);
    expect(['READY', 'STOPPED_RETAINED']).toContain(status.lifecycle);
    expect(disposed).toMatchObject({ lifecycle: 'STOPPED_RETAINED' });
  });

  it('durably retries the exact signed disposition after delivery loss and helper restart', async () => {
    let armed = false;
    const fixture = await targetWorkflowFixture({ helperFault: async (point) => {
      if (armed && point === 'after-receipt') { armed = false; throw new Error('lost-disposition-response'); }
    } });
    await fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes });
    const prepared = await fixture.journal.read(fixture.built.plan.operationId);
    const decisionBytes = signedDisposition(fixture.built, fixture.keys, fixture.keyId,
      prepared.targetHelperSequence!, prepared.targetReceiptSha256!);
    armed = true;
    await expect(fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256, decisionBytes }))
      .rejects.toThrow('lost-disposition-response');
    const pending = await fixture.journal.read(fixture.built.plan.operationId);
    expect(pending).toMatchObject({ targetEffectStatus: 'DISPOSITION_DISPATCH_UNKNOWN',
      targetDispositionIntent: { status: 'DISPATCH_UNKNOWN', action: 'STOP_RETAIN' }, targetDisposition: null });
    const restartedService = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root: fixture.helperRoot }),
      engine: fixture.engine, authorize: () => undefined });
    const restarted = new RecoveryTargetWorkflow({ journal: fixture.journal,
      client: new RecoveryTargetClient({ transport: { request: (bytes) => restartedService.handle(bytes) } }),
      inspectSourceHoldActive: async () => true,
      admissionKeys: new Map([[fixture.keyId, fixture.keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
      now: () => new Date('2026-10-29T00:12:00.000Z') });
    await expect(restarted.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256, decisionBytes }))
      .resolves.toMatchObject({ lifecycle: 'STOPPED_RETAINED' });
    const completed = await fixture.journal.read(fixture.built.plan.operationId);
    expect(completed.targetDispositionIntent?.requestId).toBe(pending.targetDispositionIntent?.requestId);
    expect(completed).toMatchObject({ targetEffectStatus: 'DISPOSED_PROVEN',
      targetDispositionIntent: { status: 'COMPLETED' }, targetDisposition: { finalState: 'STOPPED_RETAINED' } });
  });

  it('recovers exact disposition after local completion write failure and fences a concurrent retry', async () => {
    let dispositionWrites = 0; let armed = false;
    const fixture = await targetWorkflowFixture({ recoveryFault: async (stage) => {
      if (armed && stage === 'after-temp-fsync-before-rename' && ++dispositionWrites === 3) {
        throw new Error('disposition-local-write-failure');
      }
    } });
    await fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes });
    const prepared = await fixture.journal.read(fixture.built.plan.operationId);
    const decisionBytes = signedDisposition(fixture.built, fixture.keys, fixture.keyId,
      prepared.targetHelperSequence!, prepared.targetReceiptSha256!, 'RETIRE');
    armed = true;
    await expect(fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256, decisionBytes }))
      .rejects.toThrow('disposition-local-write-failure');
    const pending = await fixture.journal.read(fixture.built.plan.operationId);
    expect(pending).toMatchObject({ targetEffectStatus: 'DISPOSITION_DISPATCH_UNKNOWN', targetDisposition: null });
    armed = false;
    const outcomes = await Promise.allSettled([
      fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256, decisionBytes }),
      fixture.workflow.dispose({ plan: fixture.built.plan, planSha256: fixture.built.sha256, decisionBytes }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(await fixture.journal.read(fixture.built.plan.operationId)).toMatchObject({
      targetEffectStatus: 'DISPOSED_PROVEN', targetDisposition: { finalState: 'RETIRED' } });
  });

  it('blocks release after READY when the local READY journal write fails, then reconciles exact request', async () => {
    let writes = 0; let armed = false;
    const fixture = await targetWorkflowFixture({ recoveryFault: async (stage) => {
      if (armed && stage === 'after-temp-fsync-before-rename' && ++writes === 3) throw new Error('ready-local-write-failure');
    } });
    armed = true;
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes })).rejects.toThrow('ready-local-write-failure');
    const pending = await fixture.journal.read(fixture.built.plan.operationId);
    expect(pending).toMatchObject({ phase: 'SOURCE_VERIFIED', targetEffectStatus: 'PREPARE_DISPATCH_UNKNOWN',
      targetPreparationRequest: { status: 'DISPATCH_UNKNOWN' }, targetReceiptSha256: null });
    const release = { decisionId: randomUUID(), closedAs: 'ABORTED_PRE_IMPORT' as const, action: 'RELEASE' as const,
      status: 'PENDING' as const, reviewSha256: '1'.repeat(64), reviewEvidenceSha256: '2'.repeat(64),
      reviewedAt: '2026-10-29T00:11:00.000Z', observedStatus: 'ACTIVE' as const,
      observedEvidenceSha256: '3'.repeat(64), confirmedAt: null, failureCode: null, priorDecisionSha256: null };
    await expect(fixture.journal.withOperation(pending.operationId, { expectedSequence: pending.sequence,
      expectedOwnerId: pending.ownerId, expectedFenceToken: pending.fenceToken, expectedSiteId: pending.siteId,
      expectedPlanId: pending.planId, expectedPlanSha256: pending.planSha256 },
    (operation) => operation.recordHoldDisposition(release))).rejects.toMatchObject({ code: 'RECOVERY_STATE_INVALID' });
    armed = false;
    await expect(fixture.workflow.prepare({ plan: fixture.built.plan, planSha256: fixture.built.sha256,
      admissionBytes: fixture.admissionBytes })).resolves.toMatchObject({ lifecycle: 'READY' });
  });

  it.each(['after-targets-mkdir-before-parent-fsync', 'after-target-directory-mkdir-before-parent-fsync'] as const)(
    'fails before engine effects when directory durability fails at %s and safely retries', async (stage) => {
      const root = await fs.mkdtemp(join(tmpdir(), 'target-fsync-order-')); roots.push(root); const built = planFixture();
      const engine = new DeterministicFakeTargetEngine(); let fail = true;
      const journal = new TargetHelperJournal({ root, fault: async (point) => {
        if (point === stage && fail) { fail = false; throw new Error(`fsync-order:${stage}`); }
      } });
      const service = new RecoveryTargetHelperService({ journal, engine, authorize: () => undefined });
      const prepare = request(built);
      await expect(service.handle(encodeTargetHelperRequest(prepare))).rejects.toThrow(`fsync-order:${stage}`);
      expect(await engine.inspect({ operationId: built.plan.operationId, siteId: 'site-a',
        hostInstallationId: built.plan.targetPreparation.hostInstallationId, planSha256: built.sha256,
        targetSetId: built.plan.targetPreparation.targetSetId, generation: 1,
        targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256 })).toMatchObject({ state: 'ABSENT' });
      const retry = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root }), engine, authorize: () => undefined });
      expect(parseTargetHelperResponse(await retry.handle(encodeTargetHelperRequest(prepare))))
        .toMatchObject({ ok: true, state: 'READY' });
    },
  );

  it('enforces helper owner/mode and cleans only its exact proven lock after initialization failure', async () => {
    const unsafeRoot = await fs.mkdtemp(join(tmpdir(), 'target-owner-')); roots.push(unsafeRoot); await fs.chmod(unsafeRoot, 0o755);
    const built = planFixture();
    const unsafe = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root: unsafeRoot }),
      engine: new DeterministicFakeTargetEngine(), authorize: () => undefined });
    await expect(unsafe.handle(encodeTargetHelperRequest(request(built)))).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_UNSAFE' });
    const wrongOwnerRoot = await fs.mkdtemp(join(tmpdir(), 'target-owner-id-')); roots.push(wrongOwnerRoot);
    const wrongOwner = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root: wrongOwnerRoot,
      expectedUid: (process.getuid?.() ?? 0) + 1, expectedGid: process.getgid?.() ?? 0 }),
    engine: new DeterministicFakeTargetEngine(), authorize: () => undefined });
    await expect(wrongOwner.handle(encodeTargetHelperRequest(request(built)))).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_UNSAFE' });
    const root = await fs.mkdtemp(join(tmpdir(), 'target-lock-cleanup-')); roots.push(root);
    const failing = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root,
      fault: async (stage) => { if (stage === 'after-lock-write-before-sync') throw new Error('lock-init-failure'); } }),
    engine: new DeterministicFakeTargetEngine(), authorize: () => undefined });
    await expect(failing.handle(encodeTargetHelperRequest(request(built)))).rejects.toThrow('lock-init-failure');
    await expect(fs.lstat(join(root, '.target-helper.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    const descriptorTargets = await Promise.all((await fs.readdir('/proc/self/fd')).map((descriptor) =>
      fs.readlink(join('/proc/self/fd', descriptor)).catch(() => '')));
    expect(descriptorTargets).not.toContain(join(root, '.target-helper.lock'));
  });

  it('rejects a canonical replay response whose request or journal sequence semantics were changed', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-replay-corrupt-')); roots.push(root); const built = planFixture();
    const journal = new TargetHelperJournal({ root }); const service = new RecoveryTargetHelperService({ journal,
      engine: new DeterministicFakeTargetEngine(), authorize: () => undefined });
    await service.handle(encodeTargetHelperRequest(request(built)));
    const path = join(root, 'target-sets', built.plan.targetPreparation.targetSetId, 'state.json');
    const envelope = JSON.parse(await fs.readFile(path, 'utf8')) as { state: { replay: Array<{ response: { requestId: string } }> }; stateSha256: string };
    envelope.state.replay[0]!.response.requestId = randomUUID();
    envelope.stateSha256 = sha256RecoveryBytes(canonicalJson(envelope.state));
    await fs.writeFile(path, canonicalJson(envelope), { mode: 0o600 });
    await expect(journal.read(built.plan.targetPreparation.targetSetId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
  });

  it('prepares only from SOURCE_VERIFIED, rechecks the hold, and distinguishes offline from online truth', async () => {
    const recoveryRoot = await fs.mkdtemp(join(tmpdir(), 'target-workflow-recovery-')); roots.push(recoveryRoot);
    const helperRoot = await fs.mkdtemp(join(tmpdir(), 'target-workflow-helper-')); roots.push(helperRoot);
    const built = planFixture(); const ids = { ownerId: randomUUID(), fenceToken: randomUUID() };
    const recoveryJournal = new RecoveryJournal({ root: recoveryRoot, now: () => new Date('2026-10-29T00:10:00.000Z') });
    let state = await recoveryJournal.create({ operationId: built.plan.operationId, siteId: built.plan.source.siteId,
      planId: built.plan.planId, planSha256: built.sha256, sourceDescriptorSha256: built.plan.source.descriptorSha256, ...ids,
      targetBinding: { targetSetId: built.plan.targetPreparation.targetSetId, generation: built.plan.targetPreparation.generation,
        hostInstallationId: built.plan.targetPreparation.hostInstallationId, topologyMode: built.plan.targetPreparation.topologyMode,
        targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256 } });
    const journalGuard = () => ({ expectedSequence: state.sequence, expectedOwnerId: ids.ownerId,
      expectedFenceToken: ids.fenceToken, expectedSiteId: built.plan.source.siteId,
      expectedPlanId: built.plan.planId, expectedPlanSha256: built.sha256 });
    state = await recoveryJournal.withOperation(built.plan.operationId, journalGuard(), async (operation) => {
      await operation.recordPhaseIntent('SOURCE_HELD'); await operation.completePhase('SOURCE_HELD');
      await operation.recordPhaseIntent('SOURCE_VERIFIED'); return operation.completePhase('SOURCE_VERIFIED');
    });
    const service = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root: helperRoot }),
      engine: new DeterministicFakeTargetEngine(), authorize: () => undefined,
      now: () => new Date('2026-10-29T00:10:00.000Z') });
    const client = new RecoveryTargetClient({ transport: { request: (bytes) => service.handle(bytes) } });
    const keys = generateKeyPairSync('ed25519'); const keyId = 'target-authority-1';
    const bytes = signedAdmission(built, keys, keyId); let holdChecks = 0;
    const workflow = new RecoveryTargetWorkflow({ journal: recoveryJournal, client,
      inspectSourceHoldActive: async () => { holdChecks += 1; return true; },
      admissionKeys: new Map([[keyId, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
      now: () => new Date('2026-10-29T00:10:00.000Z') });
    await expect(workflow.prepare({ plan: built.plan, planSha256: built.sha256, admissionBytes: bytes }))
      .resolves.toMatchObject({ lifecycle: 'READY', nextAction: 'STOP_RETAIN_OR_RETIRE' });
    expect(holdChecks).toBe(2);
    expect(await workflow.status({ plan: built.plan, planSha256: built.sha256, offline: true }))
      .toMatchObject({ lifecycle: 'UNKNOWN' });
    expect(await workflow.status({ plan: built.plan, planSha256: built.sha256, admissionBytes: bytes }))
      .toMatchObject({ lifecycle: 'READY' });
  });

  it('does not commit READY across hold invalidation and resumes by exact inspection', async () => {
    const recoveryRoot = await fs.mkdtemp(join(tmpdir(), 'target-race-recovery-')); roots.push(recoveryRoot);
    const helperRoot = await fs.mkdtemp(join(tmpdir(), 'target-race-helper-')); roots.push(helperRoot);
    const built = planFixture(); const ownerId = randomUUID(); const fenceToken = randomUUID();
    const journal = new RecoveryJournal({ root: recoveryRoot, now: () => new Date('2026-10-29T00:10:00.000Z') });
    let state = await journal.create({ operationId: built.plan.operationId, siteId: built.plan.source.siteId,
      planId: built.plan.planId, planSha256: built.sha256, sourceDescriptorSha256: built.plan.source.descriptorSha256,
      ownerId, fenceToken, targetBinding: { targetSetId: built.plan.targetPreparation.targetSetId,
        generation: 1, hostInstallationId: built.plan.targetPreparation.hostInstallationId,
        topologyMode: 'SINGLE_HOST', targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256 } });
    state = await journal.withOperation(state.operationId, { expectedSequence: 0, expectedOwnerId: ownerId, expectedFenceToken: fenceToken,
      expectedSiteId: 'site-a', expectedPlanId: built.plan.planId, expectedPlanSha256: built.sha256 }, async (operation) => {
      await operation.recordPhaseIntent('SOURCE_HELD'); await operation.completePhase('SOURCE_HELD');
      await operation.recordPhaseIntent('SOURCE_VERIFIED'); return operation.completePhase('SOURCE_VERIFIED');
    });
    const service = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root: helperRoot }),
      engine: new DeterministicFakeTargetEngine(), authorize: () => undefined,
      now: () => new Date('2026-10-29T00:10:00.000Z') });
    const keys = generateKeyPairSync('ed25519'); const keyId = 'target-authority-1'; const admissionBytes = signedAdmission(built, keys, keyId);
    let checks = 0; let invalidate = true;
    const workflow = new RecoveryTargetWorkflow({ journal,
      client: new RecoveryTargetClient({ transport: { request: (bytes) => service.handle(bytes) } }),
      inspectSourceHoldActive: async () => { checks += 1; return !(invalidate && checks === 2); },
      admissionKeys: new Map([[keyId, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
      now: () => new Date('2026-10-29T00:10:00.000Z') });
    await expect(workflow.prepare({ plan: built.plan, planSha256: built.sha256, admissionBytes }))
      .rejects.toMatchObject({ code: 'RECOVERY_HOLD_NOT_ACTIVE' });
    expect(await journal.read(built.plan.operationId)).toMatchObject({ phase: 'SOURCE_VERIFIED', pendingPhase: 'TARGETS_PREPARED',
      failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT', targetReceiptSha256: null });
    invalidate = false;
    await expect(workflow.prepare({ plan: built.plan, planSha256: built.sha256, admissionBytes }))
      .resolves.toMatchObject({ lifecycle: 'READY' });
    expect(await journal.read(built.plan.operationId)).toMatchObject({ phase: 'TARGETS_PREPARED', pendingPhase: null });
    void state;
  });
});
