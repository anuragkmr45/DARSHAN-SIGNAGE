import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { recoverySourceDescriptorV2Digest, recoveryTargetSetId, sha256RecoveryBytes } from './contracts';
import { RecoveryJournal } from './journal';
import type { RecoveryOperatorConfigV3 } from './operator-inputs';
import { buildRecoveryPlanV3 } from './plan';
import { RELEASE_RECOVERY_TARGET } from './release-target';
import { createTargetAuthorizationEnvelope, encodeTargetAuthorizationEnvelope,
  RecoveryTargetAuthorizationGateway } from './target-authorization-envelope';
import { targetAdmissionSigningPayload, targetAuthorizationBodySha256, targetDispositionSigningPayload,
  type RecoveryTargetAdmission, type RecoveryTargetDispositionDecision } from './target-contracts';
import { DeterministicFakeTargetEngine, RecoveryTargetHelperService,
  type RecoveryTargetEngineAdapter } from './target-helper-service';
import { TargetHelperJournal } from './target-helper-journal';
import { parseTargetHelperRequest, parseTargetHelperResponse, type TargetHelperRequest } from './target-helper-protocol';
import { TargetUnixClient, TargetUnixTransportError } from './target-unix-client';
import { BoundedTargetUnixGateway, encodeTargetUnixFrame, TargetUnixFrameDecoder } from './target-unix-framing';
import { buildRecoveryTargetSpecification, encodeRecoveryTargetSpecification,
  parseRecoveryTargetSpecification } from './target-specification';
import { ProductionRecoveryTargetController } from './target-controller';
import { RecoveryTargetClient } from './target-client';
import { RecoveryTargetWorkflow } from './target-workflow';

const roots: string[] = [];
const SPECIFICATION_ROOT_SHA256 = '9'.repeat(64);
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

function fixture(operationId = randomUUID()) {
  const sourceIdentity = { kind: 'LOCAL_FILESYSTEM_V2' as const, siteId: 'site-a', repositoryId: randomUUID(), runId: randomUUID(),
    attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 1, manifestSha256: 'a'.repeat(64), releaseId: 'release-01',
    schemaMigrationId: RELEASE_RECOVERY_TARGET.terminalMigrationId, schemaFingerprintSha256: 'b'.repeat(64),
    repositoryDescriptorSha256: 'c'.repeat(64) };
  const targetPreparation = { generation: 1, hostInstallationId: randomUUID(), topologyMode: 'SINGLE_HOST' as const,
    hostPolicySha256: '1'.repeat(64), helperRoleSha256: '2'.repeat(64), engineProfileSha256: '3'.repeat(64),
    protectionInventorySha256: '4'.repeat(64), capacityEvidenceSha256: '5'.repeat(64), storageInventorySha256: '6'.repeat(64) };
  const specification = buildRecoveryTargetSpecification({ operationId, target: RELEASE_RECOVERY_TARGET, targetPreparation });
  const built = buildRecoveryPlanV3({ source: { ...sourceIdentity,
    descriptorSha256: recoverySourceDescriptorV2Digest(sourceIdentity), fullyEligible: true },
  compatibility: { classification: 'COMPATIBLE_CURRENT', targetReleaseId: 'release-01',
    targetSchemaMigrationId: RELEASE_RECOVERY_TARGET.terminalMigrationId, pendingMigrationIds: [],
    sourceLedgerLength: 55, fullyEligible: true }, target: RELEASE_RECOVERY_TARGET,
  targetPreparation, targetSpecification: specification, operationId, planId: randomUUID(),
  createdAt: new Date('2026-10-29T00:00:00.000Z') });
  return { ...built, specification };
}

function admission(built: ReturnType<typeof fixture>, keys: ReturnType<typeof generateKeyPairSync>,
  overrides: Partial<RecoveryTargetAdmission> = {}) {
  const body: RecoveryTargetAdmission = { format: 'darshan-recovery-target-admission-v1', admissionId: randomUUID(),
    operationId: built.plan.operationId, siteId: built.plan.source.siteId,
    hostInstallationId: built.plan.targetPreparation.hostInstallationId, planSha256: built.sha256,
    targetSetId: built.plan.targetPreparation.targetSetId, generation: built.plan.targetPreparation.generation,
    targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256,
    allowedActions: ['PREPARE', 'INSPECT'], issuedAt: '2026-10-29T00:00:00.000Z',
    expiresAt: '2026-10-29T01:00:00.000Z', ...overrides };
  return { admission: body, signature: { algorithm: 'Ed25519' as const, keyId: 'authority-1',
    valueBase64: sign(null, targetAdmissionSigningPayload(body), keys.privateKey).toString('base64') } };
}

function request(built: ReturnType<typeof fixture>, authorizationSha256: string,
  operation: TargetHelperRequest['operation'] = 'PREPARE', expectedHelperSequence: number | null = null): TargetHelperRequest {
  return { format: 'darshan-recovery-target-helper-v1', requestId: randomUUID(), operation,
    operationId: built.plan.operationId, siteId: built.plan.source.siteId,
    hostInstallationId: built.plan.targetPreparation.hostInstallationId, planSha256: built.sha256,
    targetSetId: built.plan.targetPreparation.targetSetId, generation: built.plan.targetPreparation.generation,
    targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256,
    authorizationSha256, expectedHelperSequence };
}

function envelope(built: ReturnType<typeof fixture>, authorization: ReturnType<typeof admission>,
  operation: TargetHelperRequest['operation'] = 'PREPARE', sequence: number | null = null) {
  return createTargetAuthorizationEnvelope({ plan: built.plan, planSha256: built.sha256,
    targetSpecification: built.specification, authorization, specificationRootSha256: SPECIFICATION_ROOT_SHA256,
    request: request(built, targetAuthorizationBodySha256(authorization), operation, sequence) });
}

function disposition(built: ReturnType<typeof fixture>, keys: ReturnType<typeof generateKeyPairSync>,
  prepared: { helperSequence: number; receiptSha256: string }, action: 'STOP_RETAIN' | 'RETIRE') {
  const decision: RecoveryTargetDispositionDecision = { format: 'darshan-recovery-target-disposition-v1',
    decisionId: randomUUID(), operationId: built.plan.operationId, siteId: built.plan.source.siteId,
    hostInstallationId: built.plan.targetPreparation.hostInstallationId, planSha256: built.sha256,
    targetSetId: built.plan.targetPreparation.targetSetId, generation: built.plan.targetPreparation.generation,
    action, expectedHelperSequence: prepared.helperSequence, expectedTargetState: 'READY',
    preparedReceiptSha256: prepared.receiptSha256, issuedAt: '2026-10-29T00:00:00.000Z',
    expiresAt: '2026-10-29T01:00:00.000Z' };
  return { decision, signature: { algorithm: 'Ed25519' as const, keyId: 'authority-1',
    valueBase64: sign(null, targetDispositionSigningPayload(decision), keys.privateKey).toString('base64') } };
}

function dispositionEnvelope(built: ReturnType<typeof fixture>, authorization: ReturnType<typeof disposition>,
  operation: 'INSPECT' | 'STOP_RETAIN' | 'RETIRE', requestId = randomUUID()) {
  return createTargetAuthorizationEnvelope({ plan: built.plan, planSha256: built.sha256,
    targetSpecification: built.specification, authorization, specificationRootSha256: SPECIFICATION_ROOT_SHA256,
    request: { ...request(built, targetAuthorizationBodySha256(authorization), operation,
      operation === 'INSPECT' ? null : authorization.decision.expectedHelperSequence), requestId } });
}

async function gatewayFixture(now: () => Date = () => new Date('2026-10-29T00:10:00.000Z'),
  installedIdentity?: ConstructorParameters<typeof RecoveryTargetAuthorizationGateway>[0]['installedIdentity']) {
  const root = await fs.mkdtemp(join(tmpdir(), 'target-auth-gateway-')); roots.push(root);
  const keys = generateKeyPairSync('ed25519'); const engine = new DeterministicFakeTargetEngine();
  const journal = new TargetHelperJournal({ root });
  const service = new RecoveryTargetHelperService({ journal, engine, authorize: () => undefined });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { root, keys, engine, journal, gateway: new RecoveryTargetAuthorizationGateway({ service,
    keys: new Map([['authority-1', publicKey]]), now, installedIdentity }) };
}

async function workflowGatewayFixture() {
  const recoveryRoot = await fs.mkdtemp(join(tmpdir(), 'target-workflow-gateway-recovery-')); roots.push(recoveryRoot);
  const helperRoot = await fs.mkdtemp(join(tmpdir(), 'target-workflow-gateway-helper-')); roots.push(helperRoot);
  const built = fixture(); const keys = generateKeyPairSync('ed25519'); const engine = new DeterministicFakeTargetEngine();
  const recoveryJournal = new RecoveryJournal({ root: recoveryRoot,
    now: () => new Date('2026-10-29T00:10:00.000Z') });
  const ownerId = randomUUID(); const fenceToken = randomUUID();
  let recoveryState = await recoveryJournal.create({ operationId: built.plan.operationId, siteId: built.plan.source.siteId,
    planId: built.plan.planId, planSha256: built.sha256, sourceDescriptorSha256: built.plan.source.descriptorSha256,
    ownerId, fenceToken, targetBinding: { targetSetId: built.plan.targetPreparation.targetSetId,
      generation: built.plan.targetPreparation.generation, hostInstallationId: built.plan.targetPreparation.hostInstallationId,
      topologyMode: built.plan.targetPreparation.topologyMode,
      targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256 } });
  recoveryState = await recoveryJournal.withOperation(recoveryState.operationId, { expectedSequence: recoveryState.sequence,
    expectedOwnerId: ownerId, expectedFenceToken: fenceToken, expectedSiteId: built.plan.source.siteId,
    expectedPlanId: built.plan.planId, expectedPlanSha256: built.sha256 }, async (operation) => {
    await operation.recordPhaseIntent('SOURCE_HELD'); await operation.completePhase('SOURCE_HELD');
    await operation.recordPhaseIntent('SOURCE_VERIFIED'); return operation.completePhase('SOURCE_VERIFIED');
  });
  void recoveryState;
  const helperJournal = new TargetHelperJournal({ root: helperRoot });
  const publicKeys = new Map([['authority-1', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]);
  const service = new RecoveryTargetHelperService({ journal: helperJournal, engine, authorize: () => undefined,
    now: () => new Date('2026-10-29T00:10:00.000Z') });
  const authorizationGateway = new RecoveryTargetAuthorizationGateway({ service, keys: publicKeys,
    now: () => new Date('2026-10-29T00:10:00.000Z') });
  let authorizationBytes = canonicalJson(admission(built, keys));
  const client = new RecoveryTargetClient({ transport: { request: async (bytes) => {
    const helperRequest = parseTargetHelperRequest(bytes);
    const envelopeValue = createTargetAuthorizationEnvelope({ request: helperRequest, authorization: authorizationBytes,
      targetSpecification: built.specification, plan: built.plan, planSha256: built.sha256,
      specificationRootSha256: SPECIFICATION_ROOT_SHA256 });
    return authorizationGateway.handle(encodeTargetAuthorizationEnvelope(envelopeValue));
  } } });
  const workflow = new RecoveryTargetWorkflow({ journal: recoveryJournal, client, inspectSourceHoldActive: async () => true,
    admissionKeys: publicKeys, now: () => new Date('2026-10-29T00:10:00.000Z') });
  return { built, keys, engine, helperJournal, recoveryJournal, workflow,
    setAuthorization: (bytes: Buffer) => { authorizationBytes = bytes; }, admissionBytes: authorizationBytes };
}

describe('operation-bound target specification', () => {
  it('is canonical and changes its plan binding for a different operation without circularity', () => {
    const first = fixture(); const second = fixture();
    expect(parseRecoveryTargetSpecification(encodeRecoveryTargetSpecification(first.specification))).toEqual(first.specification);
    expect(first.plan.targetPreparation.targetSpecificationSha256).not.toBe(second.plan.targetPreparation.targetSpecificationSha256);
    expect(first.plan.targetPreparation.targetSetId).not.toBe(second.plan.targetPreparation.targetSetId);
    expect(first.plan.targetPreparation.targetSpecificationSha256)
      .toBe(sha256RecoveryBytes(encodeRecoveryTargetSpecification(first.specification)));
  });

  it('rejects wrong operation, unknown fields, duplicates, and noncanonical bytes before plan creation', () => {
    const built = fixture(); const bytes = encodeRecoveryTargetSpecification(built.specification);
    expect(() => buildRecoveryPlanV3({ source: built.plan.source, compatibility: { ...built.plan.compatibility,
      sourceLedgerLength: 55, fullyEligible: true }, target: built.plan.target,
    targetPreparation: { ...built.plan.targetPreparation, targetSpecificationSha256: undefined as never,
      targetSetId: undefined as never }, targetSpecification: built.specification, operationId: randomUUID() })).toThrow();
    expect(() => parseRecoveryTargetSpecification(canonicalJson({ ...built.specification, extra: true }))).toThrow();
    const text = bytes.toString();
    expect(() => parseRecoveryTargetSpecification(Buffer.from(text.replace('{', `{"format":"${built.specification.format}",`)))).toThrow();
    expect(() => parseRecoveryTargetSpecification(Buffer.concat([bytes, Buffer.from(' ') ]))).toThrow();
  });
});

describe('strict public authorization gateway', () => {
  it('rejects foreign installed site/host/policy identity before journal creation or engine effect', async () => {
    const built = fixture(); const preparation = built.plan.targetPreparation;
    const runtime = await gatewayFixture(() => new Date('2026-10-29T00:10:00.000Z'), {
      siteId: 'foreign-site', hostInstallationId: preparation.hostInstallationId,
      hostPolicySha256: preparation.hostPolicySha256, helperRoleSha256: preparation.helperRoleSha256,
      engineProfileSha256: preparation.engineProfileSha256, specificationRootSha256: SPECIFICATION_ROOT_SHA256,
    });
    await expect(runtime.gateway.handle(encodeTargetAuthorizationEnvelope(envelope(built, admission(built, runtime.keys)))))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
    await expect(fs.lstat(join(runtime.root, 'target-sets'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await runtime.engine.inspect({ operationId: built.plan.operationId, siteId: built.plan.source.siteId,
      hostInstallationId: preparation.hostInstallationId, planSha256: built.sha256,
      targetSetId: preparation.targetSetId, generation: preparation.generation,
      targetSpecificationSha256: preparation.targetSpecificationSha256 })).toMatchObject({ state: 'ABSENT' });
  });

  it('rejects a foreign enrolled specification-root identity before journal creation or engine effect', async () => {
    const built = fixture(); const preparation = built.plan.targetPreparation;
    const runtime = await gatewayFixture(() => new Date('2026-10-29T00:10:00.000Z'), {
      siteId: built.plan.source.siteId, hostInstallationId: preparation.hostInstallationId,
      hostPolicySha256: preparation.hostPolicySha256, helperRoleSha256: preparation.helperRoleSha256,
      engineProfileSha256: preparation.engineProfileSha256, specificationRootSha256: SPECIFICATION_ROOT_SHA256,
    });
    const exact = envelope(built, admission(built, runtime.keys));
    await expect(runtime.gateway.handle(encodeTargetAuthorizationEnvelope({ ...exact,
      installationContext: { specificationRootSha256: '8'.repeat(64) } })))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
    await expect(fs.lstat(join(runtime.root, 'target-sets'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await runtime.engine.inspect({ operationId: built.plan.operationId, siteId: built.plan.source.siteId,
      hostInstallationId: preparation.hostInstallationId, planSha256: built.sha256,
      targetSetId: preparation.targetSetId, generation: preparation.generation,
      targetSpecificationSha256: preparation.targetSpecificationSha256 })).toMatchObject({ state: 'ABSENT' });
  });

  it('accepts an exact envelope and rejects unknown, trailing, wrong digest, key, revocation, and expiry', async () => {
    const built = fixture(); const runtime = await gatewayFixture(); const signed = admission(built, runtime.keys);
    const exact = envelope(built, signed);
    expect(parseTargetHelperResponse(await runtime.gateway.handle(encodeTargetAuthorizationEnvelope(exact)))).toMatchObject({ ok: true, state: 'READY' });
    await expect(runtime.gateway.handle(canonicalJson({ ...exact, unknown: true }))).rejects.toMatchObject({ code: 'RECOVERY_TARGET_PROTOCOL_INVALID' });
    await expect(runtime.gateway.handle(Buffer.concat([encodeTargetAuthorizationEnvelope(exact), Buffer.from(' ') ])))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_PROTOCOL_INVALID' });
    await expect(runtime.gateway.handle(encodeTargetAuthorizationEnvelope({ ...exact,
      request: { ...exact.request, authorizationSha256: 'f'.repeat(64) } }))).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
    const foreign = generateKeyPairSync('ed25519');
    await expect(runtime.gateway.handle(encodeTargetAuthorizationEnvelope(envelope(fixture(), admission(fixture(), foreign)))))
      .rejects.toBeDefined();
    const revokedRoot = await fs.mkdtemp(join(tmpdir(), 'target-auth-revoked-')); roots.push(revokedRoot);
    const service = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root: revokedRoot }),
      engine: new DeterministicFakeTargetEngine(), authorize: () => undefined });
    const revoked = new RecoveryTargetAuthorizationGateway({ service, keys: new Map([['authority-1',
      runtime.keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]), revokedKeyIds: new Set(['authority-1']),
    now: () => new Date('2026-10-29T00:10:00.000Z') });
    await expect(revoked.handle(encodeTargetAuthorizationEnvelope(exact))).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_REVOKED' });
    const expiredRuntime = await gatewayFixture(() => new Date('2026-10-29T01:00:00.000Z'));
    const expiredBuilt = fixture();
    await expect(expiredRuntime.gateway.handle(encodeTargetAuthorizationEnvelope(envelope(expiredBuilt,
      admission(expiredBuilt, expiredRuntime.keys))))).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_EXPIRED' });
    await expect(fs.lstat(join(expiredRuntime.root, 'target-sets'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechecks expiry under the journal lock before any effect', async () => {
    let checks = 0; const runtime = await gatewayFixture(() => new Date(checks++ === 0
      ? '2026-10-29T00:10:00.000Z' : '2026-10-29T01:00:00.000Z'));
    const built = fixture();
    await expect(runtime.gateway.handle(encodeTargetAuthorizationEnvelope(envelope(built, admission(built, runtime.keys)))))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_EXPIRED' });
    expect(await runtime.engine.inspect({ operationId: built.plan.operationId, siteId: built.plan.source.siteId,
      hostInstallationId: built.plan.targetPreparation.hostInstallationId, planSha256: built.sha256,
      targetSetId: built.plan.targetPreparation.targetSetId, generation: 1,
      targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256 })).toMatchObject({ state: 'ABSENT' });
  });

  it('does not persist initial helper directories when locked authorization rejects a fresh mutation', async () => {
    const runtime = await gatewayFixture(); const built = fixture();
    const signed = disposition(built, runtime.keys, { helperSequence: 0, receiptSha256: 'f'.repeat(64) }, 'STOP_RETAIN');
    await expect(runtime.gateway.handle(encodeTargetAuthorizationEnvelope(
      dispositionEnvelope(built, signed, 'STOP_RETAIN')))).rejects.toMatchObject({
        code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
    await expect(fs.lstat(join(runtime.root, 'target-sets'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a pending exact request pinned when its authorization expires before reconciliation', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-auth-pending-')); roots.push(root);
    const built = fixture(); const keys = generateKeyPairSync('ed25519'); const engine = new DeterministicFakeTargetEngine();
    const journal = new TargetHelperJournal({ root }); let fail = true;
    const crashing = new RecoveryTargetHelperService({ journal, engine, authorize: () => undefined,
      fault: async (stage) => { if (stage === 'after-intent' && fail) { fail = false; throw new Error('injected crash'); } } });
    const publicKeys = new Map([['authority-1', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]);
    const active = new RecoveryTargetAuthorizationGateway({ service: crashing, keys: publicKeys,
      now: () => new Date('2026-10-29T00:10:00.000Z') });
    const exact = envelope(built, admission(built, keys)); const bytes = encodeTargetAuthorizationEnvelope(exact);
    await expect(active.handle(bytes)).rejects.toThrow('injected crash');
    const pending = await journal.read(built.plan.targetPreparation.targetSetId);
    expect(pending).toMatchObject({ pendingAction: 'PREPARE', state: 'RESERVED' });
    const restarted = new RecoveryTargetAuthorizationGateway({ service: new RecoveryTargetHelperService({
      journal: new TargetHelperJournal({ root }), engine, authorize: () => undefined }), keys: publicKeys,
    now: () => new Date('2026-10-29T01:00:00.000Z') });
    await expect(restarted.handle(bytes)).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_EXPIRED' });
    expect(await journal.read(built.plan.targetPreparation.targetSetId)).toMatchObject({
      pendingAction: 'PREPARE', pendingRequestId: exact.request.requestId, state: 'RESERVED' });
    expect(await engine.inspect({ operationId: built.plan.operationId, siteId: built.plan.source.siteId,
      hostInstallationId: built.plan.targetPreparation.hostInstallationId, planSha256: built.sha256,
      targetSetId: built.plan.targetPreparation.targetSetId, generation: 1,
      targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256 })).toMatchObject({ state: 'ABSENT' });
    await expect(fs.lstat(join(root, 'target-sets'))).resolves.toBeDefined();
  });

  it('rejects admission/disposition confusion and permits disposition INSPECT only for exact locked READY evidence', async () => {
    const built = fixture(); const runtime = await gatewayFixture(); const prepareAuth = admission(built, runtime.keys);
    const preparedResponse = parseTargetHelperResponse(await runtime.gateway.handle(encodeTargetAuthorizationEnvelope(envelope(built, prepareAuth))));
    expect(preparedResponse.ok).toBe(true);
    const receipt = sha256RecoveryBytes(canonicalJson(preparedResponse));
    const decision: RecoveryTargetDispositionDecision = { format: 'darshan-recovery-target-disposition-v1',
      decisionId: randomUUID(), operationId: built.plan.operationId, siteId: built.plan.source.siteId,
      hostInstallationId: built.plan.targetPreparation.hostInstallationId, planSha256: built.sha256,
      targetSetId: built.plan.targetPreparation.targetSetId, generation: 1, action: 'STOP_RETAIN',
      expectedHelperSequence: preparedResponse.helperSequence, expectedTargetState: 'READY', preparedReceiptSha256: receipt,
      issuedAt: '2026-10-29T00:00:00.000Z', expiresAt: '2026-10-29T01:00:00.000Z' };
    const signed = { decision, signature: { algorithm: 'Ed25519' as const, keyId: 'authority-1',
      valueBase64: sign(null, targetDispositionSigningPayload(decision), runtime.keys.privateKey).toString('base64') } };
    const inspect = createTargetAuthorizationEnvelope({ plan: built.plan, planSha256: built.sha256,
      targetSpecification: built.specification, authorization: signed, specificationRootSha256: SPECIFICATION_ROOT_SHA256,
      request: request(built, targetAuthorizationBodySha256(signed), 'INSPECT', null) });
    expect(parseTargetHelperResponse(await runtime.gateway.handle(encodeTargetAuthorizationEnvelope(inspect))))
      .toMatchObject({ ok: true, state: 'READY', helperSequence: preparedResponse.helperSequence });
    const wrongReceipt = { ...signed, decision: { ...decision, preparedReceiptSha256: 'f'.repeat(64) } };
    wrongReceipt.signature.valueBase64 = sign(null, targetDispositionSigningPayload(wrongReceipt.decision),
      runtime.keys.privateKey).toString('base64');
    await expect(runtime.gateway.handle(encodeTargetAuthorizationEnvelope(createTargetAuthorizationEnvelope({
      plan: built.plan, planSha256: built.sha256, targetSpecification: built.specification, authorization: wrongReceipt,
      specificationRootSha256: SPECIFICATION_ROOT_SHA256,
      request: request(built, targetAuthorizationBodySha256(wrongReceipt), 'INSPECT', null) }))))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
    const admissionStop = envelope(built, prepareAuth, 'STOP_RETAIN', preparedResponse.helperSequence);
    await expect(runtime.gateway.handle(encodeTargetAuthorizationEnvelope(admissionStop)))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_ACTION_NOT_ALLOWED' });
  });
});

describe('gateway disposition durable replay and reconciliation', () => {
  const stages = ['after-intent', 'before-effect', 'after-effect', 'before-receipt', 'after-receipt'] as const;
  it.each(['STOP_RETAIN', 'RETIRE'].flatMap((action) => stages.map((stage) => [action, stage] as const)))(
    'reconciles exact %s across %s without reinterpreting terminal state as a fresh admission', async (action, stage) => {
      const root = await fs.mkdtemp(join(tmpdir(), 'target-gateway-crash-')); roots.push(root);
      const built = fixture(); const keys = generateKeyPairSync('ed25519'); const engine = new DeterministicFakeTargetEngine();
      const journal = new TargetHelperJournal({ root }); let armed = false; let crashed = false;
      const service = new RecoveryTargetHelperService({ journal, engine, authorize: () => undefined,
        fault: async (observed) => {
          if (armed && !crashed && observed === stage) { crashed = true; throw new Error(`crash-${stage}`); }
        } });
      const publicKeys = new Map([['authority-1', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]);
      const gateway = new RecoveryTargetAuthorizationGateway({ service, keys: publicKeys,
        now: () => new Date('2026-10-29T00:10:00.000Z') });
      const prepared = parseTargetHelperResponse(await gateway.handle(encodeTargetAuthorizationEnvelope(
        envelope(built, admission(built, keys)))));
      if (!prepared.ok) throw new Error('prepare failed');
      const signed = disposition(built, keys, { helperSequence: prepared.helperSequence,
        receiptSha256: sha256RecoveryBytes(canonicalJson(prepared)) }, action);
      const mutation = dispositionEnvelope(built, signed, action); const bytes = encodeTargetAuthorizationEnvelope(mutation);
      armed = true;
      await expect(gateway.handle(bytes)).rejects.toThrow(`crash-${stage}`);
      const restarted = new RecoveryTargetAuthorizationGateway({ service: new RecoveryTargetHelperService({
        journal: new TargetHelperJournal({ root }), engine, authorize: () => undefined }), keys: publicKeys,
      now: () => new Date('2026-10-29T00:11:00.000Z') });
      const reconciled = parseTargetHelperResponse(await restarted.handle(bytes));
      expect(reconciled).toMatchObject({ ok: true,
        state: action === 'STOP_RETAIN' ? 'STOPPED_RETAINED' : 'RETIRED', pendingAction: null });
      const replayed = parseTargetHelperResponse(await restarted.handle(bytes));
      expect(replayed).toEqual(reconciled);
    }, 10_000);

  it.each(['STOP_RETAIN', 'RETIRE'] as const)(
    'permits narrow %s rejection-resolution INSPECT from exact retained request evidence', async (action) => {
      const root = await fs.mkdtemp(join(tmpdir(), 'target-gateway-rejection-')); roots.push(root);
      const built = fixture(); const keys = generateKeyPairSync('ed25519'); const engine = new DeterministicFakeTargetEngine();
      const journal = new TargetHelperJournal({ root }); const publicKeys = new Map([['authority-1',
        keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]);
      const gateway = new RecoveryTargetAuthorizationGateway({ service: new RecoveryTargetHelperService({ journal, engine,
        authorize: () => undefined }), keys: publicKeys, now: () => new Date('2026-10-29T00:10:00.000Z') });
      const prepared = parseTargetHelperResponse(await gateway.handle(encodeTargetAuthorizationEnvelope(
        envelope(built, admission(built, keys)))));
      if (!prepared.ok) throw new Error('prepare failed');
      const signed = disposition(built, keys, { helperSequence: prepared.helperSequence,
        receiptSha256: sha256RecoveryBytes(canonicalJson(prepared)) }, action);
      engine.injectFailure(action, 'DEFINITE');
      const rejected = parseTargetHelperResponse(await gateway.handle(encodeTargetAuthorizationEnvelope(
        dispositionEnvelope(built, signed, action))));
      expect(rejected).toMatchObject({ ok: false, state: 'READY', error: { code: 'TARGET_ENGINE_FAILED' } });
      const statePath = join(root, 'target-sets', built.plan.targetPreparation.targetSetId, 'state.json');
      const before = await fs.readFile(statePath);
      const inspected = parseTargetHelperResponse(await gateway.handle(encodeTargetAuthorizationEnvelope(
        dispositionEnvelope(built, signed, 'INSPECT'))));
      expect(inspected).toMatchObject({ ok: true, state: 'READY', helperSequence: rejected.helperSequence });
      expect(await fs.readFile(statePath)).toEqual(before);
    });

  it('keeps disposition INSPECT filesystem-readonly while a mutation advances the coherent snapshot', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-gateway-inspect-lock-')); roots.push(root);
    const built = fixture(); const keys = generateKeyPairSync('ed25519');
    let lifecycle: 'ABSENT' | 'READY' | 'STOPPED_RETAINED' = 'ABSENT';
    let blockInspect = false; let entered!: () => void; let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const observation = () => ({ state: lifecycle, evidenceSha256: sha256RecoveryBytes(canonicalJson({ lifecycle })) });
    const engine: RecoveryTargetEngineAdapter = {
      inspect: async () => { if (blockInspect) { entered(); await releasePromise; } return observation(); },
      prepare: async () => { lifecycle = 'READY'; return observation(); },
      stopRetain: async () => { lifecycle = 'STOPPED_RETAINED'; return observation(); },
      retire: async () => { throw new Error('not used'); },
    };
    const journal = new TargetHelperJournal({ root }); const service = new RecoveryTargetHelperService({ journal, engine,
      authorize: () => undefined }); const publicKeys = new Map([['authority-1',
      keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]);
    const gateway = new RecoveryTargetAuthorizationGateway({ service, keys: publicKeys,
      now: () => new Date('2026-10-29T00:10:00.000Z') });
    const prepared = parseTargetHelperResponse(await gateway.handle(encodeTargetAuthorizationEnvelope(
      envelope(built, admission(built, keys)))));
    if (!prepared.ok) throw new Error('prepare failed');
    const signed = disposition(built, keys, { helperSequence: prepared.helperSequence,
      receiptSha256: sha256RecoveryBytes(canonicalJson(prepared)) }, 'STOP_RETAIN');
    const statePath = join(root, 'target-sets', built.plan.targetPreparation.targetSetId, 'state.json');
    const before = await fs.readFile(statePath); blockInspect = true;
    const inspection = gateway.handle(encodeTargetAuthorizationEnvelope(dispositionEnvelope(built, signed, 'INSPECT')));
    await enteredPromise;
    const stopped = parseTargetHelperResponse(await gateway.handle(
      encodeTargetAuthorizationEnvelope(dispositionEnvelope(built, signed, 'STOP_RETAIN'))));
    expect(stopped).toMatchObject({ ok: true, state: 'STOPPED_RETAINED' });
    release();
    expect(parseTargetHelperResponse(await inspection)).toMatchObject({ ok: true, state: 'STOPPED_RETAINED',
      helperSequence: stopped.helperSequence });
    expect(await fs.readFile(statePath)).not.toEqual(before);
  });

  it.each(['STOP_RETAIN', 'RETIRE'] as const)(
    'pins PREPARE receipt across more than 128 %s rejection/resolution attempts', async (action) => {
      const root = await fs.mkdtemp(join(tmpdir(), 'target-gateway-pinned-prepare-')); roots.push(root);
      const built = fixture(); const keys = generateKeyPairSync('ed25519'); const engine = new DeterministicFakeTargetEngine();
      const journal = new TargetHelperJournal({ root }); const publicKeys = new Map([['authority-1',
        keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]);
      const gateway = new RecoveryTargetAuthorizationGateway({ service: new RecoveryTargetHelperService({ journal, engine,
        authorize: () => undefined }), keys: publicKeys, now: () => new Date('2026-10-29T00:10:00.000Z') });
      const prepared = parseTargetHelperResponse(await gateway.handle(encodeTargetAuthorizationEnvelope(
        envelope(built, admission(built, keys)))));
      if (!prepared.ok) throw new Error('prepare failed');
      const preparedReceiptSha256 = sha256RecoveryBytes(canonicalJson(prepared)); let currentSequence = prepared.helperSequence;
      const stale = disposition(built, keys, { helperSequence: currentSequence, receiptSha256: preparedReceiptSha256 }, action);
      for (let index = 0; index < 129; index += 1) {
        const signed = disposition(built, keys, { helperSequence: currentSequence, receiptSha256: preparedReceiptSha256 }, action);
        engine.injectFailure(action, 'DEFINITE');
        const rejected = parseTargetHelperResponse(await gateway.handle(encodeTargetAuthorizationEnvelope(
          dispositionEnvelope(built, signed, action))));
        expect(rejected).toMatchObject({ ok: false, state: 'READY', error: { code: 'TARGET_ENGINE_FAILED' } });
        const inspected = parseTargetHelperResponse(await gateway.handle(encodeTargetAuthorizationEnvelope(
          dispositionEnvelope(built, signed, 'INSPECT'))));
        expect(inspected).toMatchObject({ ok: true, state: 'READY', pendingAction: null });
        currentSequence = inspected.helperSequence;
      }
      const beforeFinal = await journal.read(built.plan.targetPreparation.targetSetId);
      expect(beforeFinal.replay).toHaveLength(128);
      expect(beforeFinal.replay.filter((entry) => entry.response.ok && entry.response.operation === 'PREPARE'))
        .toEqual([expect.objectContaining({ response: expect.objectContaining({ helperSequence: prepared.helperSequence }) })]);
      expect(beforeFinal.lastReceiptSha256).toBe(preparedReceiptSha256);

      await expect(gateway.handle(encodeTargetAuthorizationEnvelope(dispositionEnvelope(built, stale, action))))
        .rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
      const changedReceipt = disposition(built, keys, { helperSequence: currentSequence, receiptSha256: 'f'.repeat(64) }, action);
      await expect(gateway.handle(encodeTargetAuthorizationEnvelope(dispositionEnvelope(built, changedReceipt, action))))
        .rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
      const expired = disposition(built, keys, { helperSequence: currentSequence, receiptSha256: preparedReceiptSha256 }, action);
      expired.decision.issuedAt = '2026-10-28T22:00:00.000Z'; expired.decision.expiresAt = '2026-10-28T23:00:00.000Z';
      expired.signature.valueBase64 = sign(null, targetDispositionSigningPayload(expired.decision), keys.privateKey).toString('base64');
      await expect(gateway.handle(encodeTargetAuthorizationEnvelope(dispositionEnvelope(built, expired, action))))
        .rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_EXPIRED' });

      const fresh = disposition(built, keys, { helperSequence: currentSequence, receiptSha256: preparedReceiptSha256 }, action);
      const finalBytes = encodeTargetAuthorizationEnvelope(dispositionEnvelope(built, fresh, action));
      const completed = parseTargetHelperResponse(await gateway.handle(finalBytes));
      expect(completed).toMatchObject({ ok: true, state: action === 'STOP_RETAIN' ? 'STOPPED_RETAINED' : 'RETIRED' });
      expect(parseTargetHelperResponse(await gateway.handle(finalBytes))).toEqual(completed);
      const finalState = await journal.read(built.plan.targetPreparation.targetSetId);
      expect(finalState.replay.length).toBeLessThanOrEqual(128); expect(finalState.lastReceiptSha256).toBe(preparedReceiptSha256);
      expect(finalState.replay.some((entry) => entry.response.ok && entry.response.operation === 'PREPARE' &&
        sha256RecoveryBytes(canonicalJson(entry.response)) === preparedReceiptSha256)).toBe(true);
    }, 30_000);

  it('rejects duplicate and foreign corrupt pinned PREPARE receipts during journal decode', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-gateway-corrupt-pin-')); roots.push(root);
    const built = fixture(); const keys = generateKeyPairSync('ed25519'); const journal = new TargetHelperJournal({ root });
    const gateway = new RecoveryTargetAuthorizationGateway({ service: new RecoveryTargetHelperService({ journal,
      engine: new DeterministicFakeTargetEngine(), authorize: () => undefined }), keys: new Map([['authority-1',
      keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
    now: () => new Date('2026-10-29T00:10:00.000Z') });
    const signedAdmission = admission(built, keys);
    await gateway.handle(encodeTargetAuthorizationEnvelope(envelope(built, signedAdmission)));
    const staleRequest = envelope(built, signedAdmission, 'PREPARE', 0);
    expect(parseTargetHelperResponse(await gateway.handle(encodeTargetAuthorizationEnvelope(staleRequest))))
      .toMatchObject({ ok: false, error: { code: 'TARGET_SEQUENCE_CONFLICT' } });
    const statePath = join(root, 'target-sets', built.plan.targetPreparation.targetSetId, 'state.json');
    const original = JSON.parse((await fs.readFile(statePath)).toString()) as { state: Record<string, unknown>; stateSha256: string };
    const originalState = original.state as { helperSequence: number; replay: Array<Record<string, unknown>> };
    const prepareEntry = originalState.replay.find((entry) => (entry.response as { operation?: string }).operation === 'PREPARE')!;
    const duplicate = structuredClone(prepareEntry) as { requestId: string; requestSha256: string;
      response: Record<string, unknown> };
    duplicate.requestId = randomUUID(); duplicate.requestSha256 = 'e'.repeat(64);
    duplicate.response.requestId = duplicate.requestId; duplicate.response.helperSequence = originalState.helperSequence;
    const duplicateState = structuredClone(originalState); duplicateState.replay = [prepareEntry, duplicate];
    await fs.writeFile(statePath, canonicalJson({ state: duplicateState,
      stateSha256: sha256RecoveryBytes(canonicalJson(duplicateState)) }));
    await expect(journal.read(built.plan.targetPreparation.targetSetId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });

    const foreignState = structuredClone(originalState); const foreignPrepare = foreignState.replay
      .find((entry) => (entry.response as { operation?: string }).operation === 'PREPARE')!;
    (foreignPrepare.response as Record<string, unknown>).targetSetId = 'f'.repeat(64);
    await fs.writeFile(statePath, canonicalJson({ state: foreignState,
      stateSha256: sha256RecoveryBytes(canonicalJson(foreignState)) }));
    await expect(journal.read(built.plan.targetPreparation.targetSetId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
  });
});

describe('full workflow through authorization envelope gateway', () => {
  it.each(['STOP_RETAIN', 'RETIRE'] as const)(
    'resolves definite %s rejection and admits a fresh current-sequence decision against immutable PREPARE receipt', async (action) => {
      const runtime = await workflowGatewayFixture(); let effectCalls = 0;
      if (action === 'STOP_RETAIN') {
        const original = runtime.engine.stopRetain.bind(runtime.engine);
        runtime.engine.stopRetain = async (identity) => { effectCalls += 1; return original(identity); };
      } else {
        const original = runtime.engine.retire.bind(runtime.engine);
        runtime.engine.retire = async (identity) => { effectCalls += 1; return original(identity); };
      }
      await runtime.workflow.prepare({ plan: runtime.built.plan, planSha256: runtime.built.sha256,
        admissionBytes: runtime.admissionBytes });
      const prepared = await runtime.recoveryJournal.read(runtime.built.plan.operationId);
      expect(prepared).toMatchObject({ targetEffectStatus: 'READY_PROVEN', targetHelperSequence: 2 });
      const rejectedAuthorization = disposition(runtime.built, runtime.keys, {
        helperSequence: prepared.targetHelperSequence!, receiptSha256: prepared.targetReceiptSha256! }, action);
      const rejectedBytes = canonicalJson(rejectedAuthorization); runtime.setAuthorization(rejectedBytes);
      runtime.engine.injectFailure(action, 'DEFINITE');
      await expect(runtime.workflow.dispose({ plan: runtime.built.plan, planSha256: runtime.built.sha256,
        decisionBytes: rejectedBytes })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_NOT_READY' });
      const resolved = await runtime.recoveryJournal.read(runtime.built.plan.operationId);
      expect(resolved).toMatchObject({ targetEffectStatus: 'READY_PROVEN', targetHelperSequence: 4,
        targetDispositionIntent: null });
      expect(await runtime.helperJournal.read(runtime.built.plan.targetPreparation.targetSetId))
        .toMatchObject({ state: 'READY', helperSequence: 4, pendingAction: null,
          lastReceiptSha256: prepared.targetReceiptSha256 });

      runtime.setAuthorization(rejectedBytes);
      await expect(runtime.workflow.dispose({ plan: runtime.built.plan, planSha256: runtime.built.sha256,
        decisionBytes: rejectedBytes })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
      const changedReceipt = disposition(runtime.built, runtime.keys, { helperSequence: 4,
        receiptSha256: 'f'.repeat(64) }, action); const changedReceiptBytes = canonicalJson(changedReceipt);
      runtime.setAuthorization(changedReceiptBytes);
      await expect(runtime.workflow.dispose({ plan: runtime.built.plan, planSha256: runtime.built.sha256,
        decisionBytes: changedReceiptBytes })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });

      const fresh = disposition(runtime.built, runtime.keys, { helperSequence: 4,
        receiptSha256: prepared.targetReceiptSha256! }, action); const freshBytes = canonicalJson(fresh);
      runtime.setAuthorization(freshBytes);
      await expect(runtime.workflow.dispose({ plan: runtime.built.plan, planSha256: runtime.built.sha256,
        decisionBytes: freshBytes })).resolves.toMatchObject({
          lifecycle: action === 'STOP_RETAIN' ? 'STOPPED_RETAINED' : 'RETIRED' });
      await expect(runtime.workflow.dispose({ plan: runtime.built.plan, planSha256: runtime.built.sha256,
        decisionBytes: freshBytes })).resolves.toMatchObject({
          lifecycle: action === 'STOP_RETAIN' ? 'STOPPED_RETAINED' : 'RETIRED' });
      expect(effectCalls).toBe(2);
    });

  it.each(['STOP_RETAIN', 'RETIRE'] as const)(
    'keeps ambiguous %s pinned and rejects a fresh decision without duplicate effect', async (action) => {
      const runtime = await workflowGatewayFixture(); let effectCalls = 0;
      const original = action === 'STOP_RETAIN' ? runtime.engine.stopRetain.bind(runtime.engine) : runtime.engine.retire.bind(runtime.engine);
      if (action === 'STOP_RETAIN') runtime.engine.stopRetain = async (identity) => { effectCalls += 1; return original(identity); };
      else runtime.engine.retire = async (identity) => { effectCalls += 1; return original(identity); };
      await runtime.workflow.prepare({ plan: runtime.built.plan, planSha256: runtime.built.sha256,
        admissionBytes: runtime.admissionBytes });
      const prepared = await runtime.recoveryJournal.read(runtime.built.plan.operationId);
      const first = disposition(runtime.built, runtime.keys, { helperSequence: prepared.targetHelperSequence!,
        receiptSha256: prepared.targetReceiptSha256! }, action); const firstBytes = canonicalJson(first);
      runtime.setAuthorization(firstBytes); runtime.engine.injectFailure(action, 'AMBIGUOUS');
      await expect(runtime.workflow.dispose({ plan: runtime.built.plan, planSha256: runtime.built.sha256,
        decisionBytes: firstBytes })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
      const fresh = disposition(runtime.built, runtime.keys, { helperSequence: prepared.targetHelperSequence!,
        receiptSha256: prepared.targetReceiptSha256! }, action); const freshBytes = canonicalJson(fresh);
      runtime.setAuthorization(freshBytes);
      await expect(runtime.workflow.dispose({ plan: runtime.built.plan, planSha256: runtime.built.sha256,
        decisionBytes: freshBytes })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH' });
      expect(effectCalls).toBe(1);
      expect(await runtime.helperJournal.read(runtime.built.plan.targetPreparation.targetSetId))
        .toMatchObject({ state: 'RECONCILIATION_REQUIRED', pendingAction: action, effectDisposition: 'AMBIGUOUS' });
    });
});

describe('production controller prevalidation', () => {
  it.each([
    ['operation', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, operationId: randomUUID() })],
    ['generation', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, generation: value.generation + 1 })],
    ['host', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, hostInstallationId: randomUUID() })],
    ['topology', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, topologyMode: 'SPLIT_HOST' as const })],
    ['host-policy', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, hostPolicySha256: 'f'.repeat(64) })],
    ['helper-role', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, helperRoleSha256: 'f'.repeat(64) })],
    ['engine', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, engineProfileSha256: 'f'.repeat(64) })],
    ['protection', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, protectionInventorySha256: 'f'.repeat(64) })],
    ['capacity', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, capacityEvidenceSha256: 'f'.repeat(64) })],
    ['storage', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, storageInventorySha256: 'f'.repeat(64) })],
    ['target-logical', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, targetLogicalIdentitySha256: 'f'.repeat(64) })],
    ['target-release', (value: ReturnType<typeof fixture>['specification']) => ({ ...value, targetReleaseIdentitySha256: 'f'.repeat(64) })],
  ])('rejects wrong %s specification before journal intent or transport dispatch', async (_label, mutate) => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-controller-prevalidate-')); roots.push(root); await fs.chmod(root, 0o700);
    const specificationRoot = join(root, 'specifications'); const authorizationRoot = join(root, 'authorizations');
    const journalRoot = join(root, 'journal');
    await Promise.all([fs.mkdir(specificationRoot, { mode: 0o700 }), fs.mkdir(authorizationRoot, { mode: 0o700 }),
      fs.mkdir(journalRoot, { mode: 0o700 })]);
    const built = fixture(); const keys = generateKeyPairSync('ed25519');
    await fs.writeFile(join(specificationRoot, `${built.plan.operationId}.target-specification.json`),
      encodeRecoveryTargetSpecification(mutate(built.specification)), { mode: 0o600 });
    await fs.writeFile(join(authorizationRoot, `${built.plan.operationId}.prepare.json`),
      canonicalJson(admission(built, keys)), { mode: 0o600 });
    const keyringPath = join(authorizationRoot, 'keys.json');
    await fs.writeFile(keyringPath, canonicalJson({ 'authority-1': keys.publicKey.export({
      type: 'spki', format: 'pem' }).toString() }), { mode: 0o600 });
    const config: RecoveryOperatorConfigV3 = { format: 'darshan-recovery-operator-config-v3', site_id: 'site-a',
      repository: { root: '/srv/repository', device_id: '1', owner_uid: 1000, owner_gid: 1000, repository_id: randomUUID() },
      trust: { policy_keyring_file: '/secure/policy.json', manifest_keyring_file: '/secure/manifest.json' },
      target: { target_id: 'darshan-server-release-01', release_id: 'release-01', migrations_directory: '/app/migrations' },
      broker: { socket_path: '/run/darshan/broker.sock', helper_version: 'release-01',
        policy_sha256: 'a'.repeat(64), control_timeout_ms: 60_000 }, journal: { root: journalRoot },
      target_gateway: { relay_socket_path: '/run/darshan/target.sock', specification_root: specificationRoot,
        authorization_root: authorizationRoot, authorization_keyring_file: keyringPath, action_deadline_ms: 10_000 } };
    let dispatches = 0;
    const controller = new ProductionRecoveryTargetController(config, { journal: new RecoveryJournal({ root: journalRoot }),
      inspectSourceHoldActive: async () => true, transport: { request: async () => { dispatches += 1; throw new Error('unexpected dispatch'); } } });
    await expect(controller.prepare(built.plan, built.sha256)).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_INELIGIBLE' });
    expect(dispatches).toBe(0); expect(await fs.readdir(journalRoot)).toEqual([]);
  });

  it('rejects an opaque plan/spec digest and targetSet mismatch before controller effects', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-controller-opaque-')); roots.push(root); await fs.chmod(root, 0o700);
    const specificationRoot = join(root, 'specifications'); const authorizationRoot = join(root, 'authorizations');
    const journalRoot = join(root, 'journal');
    await Promise.all([fs.mkdir(specificationRoot, { mode: 0o700 }), fs.mkdir(authorizationRoot, { mode: 0o700 }),
      fs.mkdir(journalRoot, { mode: 0o700 })]);
    const built = fixture(); const keys = generateKeyPairSync('ed25519'); const opaquePreparation = { ...built.plan.targetPreparation,
      targetSpecificationSha256: 'f'.repeat(64) };
    const opaquePlan = { ...built.plan, targetPreparation: { ...opaquePreparation,
      targetSetId: recoveryTargetSetId(opaquePreparation) } };
    const opaqueSha256 = sha256RecoveryBytes(canonicalJson(opaquePlan));
    await fs.writeFile(join(specificationRoot, `${built.plan.operationId}.target-specification.json`),
      encodeRecoveryTargetSpecification(built.specification), { mode: 0o600 });
    await fs.writeFile(join(authorizationRoot, `${built.plan.operationId}.prepare.json`),
      canonicalJson(admission(built, keys)), { mode: 0o600 });
    const keyringPath = join(authorizationRoot, 'keys.json');
    await fs.writeFile(keyringPath, canonicalJson({ 'authority-1': keys.publicKey.export({
      type: 'spki', format: 'pem' }).toString() }), { mode: 0o600 });
    const config: RecoveryOperatorConfigV3 = { format: 'darshan-recovery-operator-config-v3', site_id: 'site-a',
      repository: { root: '/srv/repository', device_id: '1', owner_uid: 1000, owner_gid: 1000, repository_id: randomUUID() },
      trust: { policy_keyring_file: '/secure/policy.json', manifest_keyring_file: '/secure/manifest.json' },
      target: { target_id: 'darshan-server-release-01', release_id: 'release-01', migrations_directory: '/app/migrations' },
      broker: { socket_path: '/run/darshan/broker.sock', helper_version: 'release-01',
        policy_sha256: 'a'.repeat(64), control_timeout_ms: 60_000 }, journal: { root: journalRoot },
      target_gateway: { relay_socket_path: '/run/darshan/target.sock', specification_root: specificationRoot,
        authorization_root: authorizationRoot, authorization_keyring_file: keyringPath, action_deadline_ms: 10_000 } };
    let dispatches = 0; const controller = new ProductionRecoveryTargetController(config, {
      journal: new RecoveryJournal({ root: journalRoot }), inspectSourceHoldActive: async () => true,
      transport: { request: async () => { dispatches += 1; throw new Error('unexpected dispatch'); } } });
    await expect(controller.prepare(opaquePlan, opaqueSha256)).rejects.toMatchObject({
      code: 'RECOVERY_TARGET_EFFECT_INELIGIBLE' });

    const siteIdentity = { ...built.plan.source, siteId: 'site-b' };
    const sitePlan = { ...built.plan, source: { ...siteIdentity,
      descriptorSha256: recoverySourceDescriptorV2Digest(siteIdentity) } };
    await expect(controller.prepare(sitePlan, sha256RecoveryBytes(canonicalJson(sitePlan)))).rejects.toMatchObject({
      code: 'RECOVERY_TARGET_SPECIFICATION_MISMATCH' });
    const wrongTargetSetPlan = { ...built.plan, targetPreparation: { ...built.plan.targetPreparation,
      targetSetId: 'f'.repeat(64) } };
    await expect(controller.prepare(wrongTargetSetPlan, sha256RecoveryBytes(canonicalJson(wrongTargetSetPlan))))
      .rejects.toMatchObject({ code: 'RECOVERY_PLAN_CORRUPT' });
    expect(dispatches).toBe(0); expect(await fs.readdir(journalRoot)).toEqual([]);
  });
});

describe('bounded Unix framing and client', () => {
  const localSocketAuthority = { uid: process.getuid(), gid: process.getgid() };
  it('accepts one newline+EOF and rejects oversize, multiframe, trailing, and incomplete input', () => {
    const payload = canonicalJson({ value: true }); const decoder = new TargetUnixFrameDecoder(1024);
    decoder.push(payload.subarray(0, payload.byteLength - 1)); decoder.push(Buffer.from('\n')); expect(decoder.finish()).toEqual(payload);
    for (const bytes of [Buffer.from('{}\n{}\n'), Buffer.from('{}\nx'), Buffer.from('{}')]) {
      const invalid = new TargetUnixFrameDecoder(8);
      expect(() => { invalid.push(bytes); invalid.finish(); }).toThrow();
    }
    expect(() => encodeTargetUnixFrame(Buffer.concat([Buffer.alloc(8, 0x61), Buffer.from('\n')]), 8)).toThrow();
  });

  it('round-trips only a local temporary Unix fixture and classifies a lost response after dispatch', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-unix-client-')); roots.push(root);
    const socketPath = join(root, 'relay.sock'); const response = canonicalJson({ accepted: true });
    const server = createServer((socket) => socket.on('data', () => socket.end(encodeTargetUnixFrame(response, 1024))));
    await new Promise<void>((resolve, reject) => server.listen(socketPath, (error?: Error) => error ? reject(error) : resolve()));
    await fs.chmod(root, 0o710); await fs.chmod(socketPath, 0o660);
    const client = new TargetUnixClient({ socketPath, actionDeadlineMs: 2_000, socketAuthority: localSocketAuthority });
    expect(await client.request(canonicalJson({ request: true }))).toEqual(response);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

    const lostPath = join(root, 'lost.sock'); const lost = createServer((socket) => socket.on('data', () => setImmediate(() => socket.destroy())));
    await new Promise<void>((resolve, reject) => lost.listen(lostPath, (error?: Error) => error ? reject(error) : resolve()));
    await fs.chmod(lostPath, 0o660);
    await expect(new TargetUnixClient({ socketPath: lostPath, actionDeadlineMs: 2_000, socketAuthority: localSocketAuthority })
      .request(canonicalJson({ request: true }))).rejects.toSatisfy((cause: unknown) =>
        cause instanceof TargetUnixTransportError && ['LOST_RESPONSE_AFTER_DISPATCH', 'RESPONSE_INVALID'].includes(cause.classification));
    await new Promise<void>((resolve, reject) => lost.close((error) => error ? reject(error) : resolve()));
  });

  it('allows first response bytes after 5.2s when the separate 10s action deadline remains active', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-unix-delayed-')); roots.push(root);
    const socketPath = join(root, 'relay.sock'); const response = canonicalJson({ delayed: true });
    const server = createServer({ allowHalfOpen: true },
      (socket) => socket.on('data', () => setTimeout(() => socket.end(response), 5_200)));
    await new Promise<void>((resolve, reject) => server.listen(socketPath, (error?: Error) => error ? reject(error) : resolve()));
    await fs.chmod(root, 0o710); await fs.chmod(socketPath, 0o660);
    expect(await new TargetUnixClient({ socketPath, actionDeadlineMs: 10_000, socketAuthority: localSocketAuthority })
      .request(canonicalJson({ request: true }))).toEqual(response);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }, 8_000);

  it.each(['partial', 'newline-without-eof'] as const)(
    'applies the absolute incomplete-frame timeout after %s response framing begins', async (variant) => {
      const root = await fs.mkdtemp(join(tmpdir(), 'target-unix-stall-')); roots.push(root);
      const socketPath = join(root, `${variant}.sock`); const sockets = new Set<import('node:net').Socket>();
      const server = createServer({ allowHalfOpen: true }, (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket));
        socket.on('data', () => socket.write(variant === 'partial' ? Buffer.from('{') : canonicalJson({ complete: true }))); });
      await new Promise<void>((resolve, reject) => server.listen(socketPath, (error?: Error) => error ? reject(error) : resolve()));
      await fs.chmod(root, 0o710); await fs.chmod(socketPath, 0o660);
      await expect(new TargetUnixClient({ socketPath, actionDeadlineMs: 7_000, socketAuthority: localSocketAuthority }).request(canonicalJson({ request: true })))
        .rejects.toMatchObject({ classification: 'TIMEOUT_AFTER_DISPATCH' });
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }, 8_000);

  it('classifies cancellation before and after dispatch and a separate action timeout', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-unix-cancel-')); roots.push(root);
    const socketPath = join(root, 'relay.sock'); const sockets = new Set<import('node:net').Socket>();
    const server = createServer({ allowHalfOpen: true }, (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket));
      socket.on('data', () => undefined); });
    await new Promise<void>((resolve, reject) => server.listen(socketPath, (error?: Error) => error ? reject(error) : resolve()));
    await fs.chmod(root, 0o710); await fs.chmod(socketPath, 0o660);
    const before = new AbortController(); before.abort();
    await expect(new TargetUnixClient({ socketPath, actionDeadlineMs: 1_000, socketAuthority: localSocketAuthority }).request(canonicalJson({ request: true }), before.signal))
      .rejects.toMatchObject({ classification: 'CANCELLED_BEFORE_DISPATCH' });
    const after = new AbortController(); const pending = new TargetUnixClient({ socketPath, actionDeadlineMs: 1_000, socketAuthority: localSocketAuthority })
      .request(canonicalJson({ request: true }), after.signal);
    setTimeout(() => after.abort(), 50);
    await expect(pending).rejects.toMatchObject({ classification: 'CANCELLED_AFTER_DISPATCH' });
    await expect(new TargetUnixClient({ socketPath, actionDeadlineMs: 100, socketAuthority: localSocketAuthority }).request(canonicalJson({ request: true })))
      .rejects.toMatchObject({ classification: 'TIMEOUT_AFTER_DISPATCH' });
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('removes per-read abort listeners for byte-by-byte frames', async () => {
    const signal = new AbortController(); const payload = canonicalJson({ bytewise: true });
    const gateway = new BoundedTargetUnixGateway({ actionDeadlineMs: 1_000,
      handle: async (bytes) => bytes });
    async function* chunks() { for (const byte of payload) yield Buffer.from([byte]); }
    expect(await gateway.handleConnection(chunks(), signal.signal)).toEqual(payload);
    expect(getEventListeners(signal.signal, 'abort')).toHaveLength(0);
  });

  it('requests iterator closure when cancellation interrupts an incomplete read', async () => {
    const controller = new AbortController(); let returned = false;
    const iterator: AsyncIterator<Uint8Array> = {
      next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
      return: async () => { returned = true; return { done: true, value: undefined }; },
    };
    const chunks: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => iterator };
    const gateway = new BoundedTargetUnixGateway({ actionDeadlineMs: 1_000,
      handle: async (bytes) => bytes });
    const pending = gateway.handleConnection(chunks, controller.signal); controller.abort();
    await expect(pending).rejects.toBeDefined();
    await new Promise((resolve) => setImmediate(resolve));
    expect(returned).toBe(true); expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
});
