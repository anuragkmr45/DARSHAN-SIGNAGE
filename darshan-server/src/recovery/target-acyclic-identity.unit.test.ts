import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { recoverySourceDescriptorV2Digest, recoveryTargetSetIdV2, sha256RecoveryBytes,
  type RecoverySourceDescriptorV2 } from './contracts';
import { buildRecoveryPlanV3, buildRecoveryPlanV4 } from './plan';
import { parseRecoveryPlanFile } from './plan-file';
import { RELEASE_RECOVERY_TARGET } from './release-target';
import { targetAdmissionV2SigningPayload, targetAuthorizationV2BodySha256,
  type RecoveryTargetAdmissionV2, type SignedRecoveryTargetAdmissionV2 } from './target-contracts-v2';
import { createTargetAuthorizationEnvelope, encodeTargetAuthorizationEnvelope,
  RecoveryTargetAuthorizationGateway } from './target-authorization-envelope';
import { createTargetAuthorizationEnvelopeV2, encodeTargetAuthorizationEnvelopeV2 } from './target-authorization-envelope-v2';
import { TargetHelperJournal } from './target-helper-journal';
import { DeterministicFakeTargetEngine, RecoveryTargetHelperService, TargetEngineEffectError,
  type RecoveryTargetEngineAdapter } from './target-helper-service';
import { encodeTargetHelperRequest, parseTargetHelperResponse, type TargetHelperRequest } from './target-helper-protocol';
import { recoveryTargetLogicalIdentitySha256, recoveryTargetReleaseIdentitySha256,
  buildRecoveryTargetSpecification, buildRecoveryTargetSpecificationV2,
  encodeRecoveryTargetSpecificationV2 } from './target-specification';
import { parseRecoveryTargetInstalledIdentity, type RecoveryTargetInstalledIdentityV2 } from './target-storage-authority';
import { encodeSignedTargetStorageEvidenceV2, targetStorageEvidenceV2EnvelopeSha256,
  targetStorageEvidenceV2SigningPayload, type SignedTargetStorageEvidenceV2,
  type TargetStorageEvidenceV2 } from './target-storage-contracts-v2';
import { ProtectedTargetStorageEvidenceLoaderV2 } from './target-storage-evidence-v2';
import { targetOperationAttestationEnvelopeSha256, targetOperationAttestationSigningPayload,
  type RecoveryTargetOperationAttestation, type SignedRecoveryTargetOperationAttestation } from './target-operation-attestation';
import { targetAdmissionSigningPayload, targetAuthorizationBodySha256,
  type RecoveryTargetAdmission, type SignedRecoveryTargetAdmission } from './target-contracts';
import { encodeSignedTargetStorageEvidence, targetStorageEvidenceSigningPayload, verifyTargetStorageEvidence,
  type TargetStorageEvidence } from './target-storage-contracts';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));
const digest = (label: string) => sha256RecoveryBytes(Buffer.from(`packet-05b1b3b0:${label}`));

function signedEvidence(evidence: TargetStorageEvidenceV2,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): SignedTargetStorageEvidenceV2 {
  return { format: 'darshan-recovery-storage-evidence-envelope-v2', evidence,
    signature: { algorithm: 'Ed25519', keyId: 'evidence-authority',
      valueBase64: sign(null, targetStorageEvidenceV2SigningPayload(evidence), privateKey).toString('base64') } };
}

async function fixture(operationId = randomUUID(), options: {
  topologyMode?: 'SINGLE_HOST' | 'SPLIT_HOST';
  policyHostMode?: 'SINGLE_HOST' | 'SPLIT_HOST';
  inventoryFilesystem?: 'ext4' | 'xfs';
  installedRootMismatch?: 'ACTIVE' | 'QUARANTINE' | 'POOL' | 'CONTROL';
  now?: () => Date;
  ambiguousFirstPrepare?: boolean;
  onInspect?: () => void;
} = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'recovery-acyclic-')); roots.push(root); await fs.chmod(root, 0o700);
  const evidenceRoot = join(root, 'evidence'); const journalRoot = join(root, 'journal');
  await fs.mkdir(evidenceRoot, { mode: 0o700 }); await fs.mkdir(journalRoot, { mode: 0o700 });
  const evidenceKeys = generateKeyPairSync('ed25519'); const attestationKeys = generateKeyPairSync('ed25519');
  const authorizationKeys = generateKeyPairSync('ed25519');
  const publicPem = (keys: ReturnType<typeof generateKeyPairSync>) =>
    keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const siteId = 'site-a'; const hostInstallationId = randomUUID(); const generation = 7;
  const runtimeNow = options.now ?? (() => new Date('2026-10-29T01:00:00.000Z'));
  const topologyMode = options.topologyMode ?? 'SINGLE_HOST';
  const policyHostMode = options.policyHostMode ?? topologyMode;
  const target = { ...RELEASE_RECOVERY_TARGET };
  const targetLogicalIdentitySha256 = recoveryTargetLogicalIdentitySha256(target);
  const targetReleaseIdentitySha256 = recoveryTargetReleaseIdentitySha256(target);
  const stable = { evidenceId: randomUUID(), siteId, hostInstallationId, targetReleaseIdentitySha256,
    targetLogicalIdentitySha256, issuedAt: '2026-10-29T00:00:00.000Z', validFrom: '2026-10-29T00:00:01.000Z',
    expiresAt: '2027-10-29T00:00:00.000Z', revokedEnvelopeSha256: [] as string[] };
  const storageAuthorityIdentitySha256 = digest('storage-authority');
  const inventoryRoots = (['ACTIVE', 'QUARANTINE', 'POOL', 'CONTROL'] as const).map((role, index) => ({ role,
    pathIdentitySha256: digest(`path-${role}`), mountId: String(100 + index), mountParentId: '1',
    filesystemType: options.inventoryFilesystem ?? 'ext4' as const,
    filesystemUuid: digest(`fs-${role}`).slice(0, 32), deviceMajor: '8', deviceMinor: String(index + 1),
    readOnly: false as const, quotaStatus: 'DEDICATED_FILESYSTEM' as const }));
  const rootIdentity = (role: typeof inventoryRoots[number]['role']) =>
    inventoryRoots.find((rootValue) => rootValue.role === role)!.pathIdentitySha256;
  const hostPolicy = signedEvidence({ format: 'darshan-recovery-host-policy-evidence-v2', kind: 'HOST_POLICY', ...stable,
    hostMode: policyHostMode, storageAuthorityIdentitySha256, evidenceRootSha256: digest('evidence-root'),
    allocationControlRootSha256: rootIdentity('CONTROL'), allowedFilesystems: ['ext4'] }, evidenceKeys.privateKey);
  const engineProfile = signedEvidence({ format: 'darshan-recovery-engine-profile-evidence-v2', kind: 'ENGINE_PROFILE',
    ...stable, evidenceId: randomUUID(), postgresUid: '1101', postgresGid: '1101', minioUid: '1102', minioGid: '1102',
    allocationDirectoryMode: '0700', postgresDirectoryMode: '0700', minioDirectoryMode: '0700',
    requiredBytes: '1000', requiredInodes: '10' }, evidenceKeys.privateKey);
  const storageInventory = signedEvidence({ format: 'darshan-recovery-storage-inventory-evidence-v2',
    kind: 'STORAGE_INVENTORY', ...stable, evidenceId: randomUUID(), storageAuthorityIdentitySha256,
    roots: inventoryRoots }, evidenceKeys.privateKey);
  const protectionInventory = signedEvidence({ format: 'darshan-recovery-protection-inventory-evidence-v2',
    kind: 'PROTECTION_INVENTORY', ...stable, evidenceId: randomUUID(),
    protectedPathIdentitySha256: [digest('protected-path')], observedMountinfoSha256: digest('mountinfo') },
  evidenceKeys.privateKey);
  const stableEnvelopes = { hostPolicyEnvelopeSha256: targetStorageEvidenceV2EnvelopeSha256(hostPolicy),
    engineProfileEnvelopeSha256: targetStorageEvidenceV2EnvelopeSha256(engineProfile),
    storageInventoryEnvelopeSha256: targetStorageEvidenceV2EnvelopeSha256(storageInventory),
    protectionInventoryEnvelopeSha256: targetStorageEvidenceV2EnvelopeSha256(protectionInventory) };
  const capacity = signedEvidence({ format: 'darshan-recovery-capacity-evidence-v2', kind: 'CAPACITY_EVIDENCE',
    evidenceId: randomUUID(), siteId, hostInstallationId, operationId, generation: String(generation),
    targetReleaseIdentitySha256, targetLogicalIdentitySha256, issuedAt: '2026-10-29T00:00:02.000Z',
    validFrom: '2026-10-29T00:00:03.000Z', expiresAt: '2027-10-28T00:00:00.000Z',
    revokedEnvelopeSha256: [], ...stableEnvelopes, allocationLedgerHeadSha256: digest('ledger-head'),
    availableBytes: '5000', availableInodes: '100', fullOutstandingReservationBytes: '500',
    fullOutstandingReservationInodes: '5', requiredBytes: '1000', requiredInodes: '10',
    remainingBytes: '4500', remainingInodes: '95', controlAvailableBytes: '4096', controlAvailableInodes: '64' },
  evidenceKeys.privateKey);
  const capacityEvidenceEnvelopeSha256 = targetStorageEvidenceV2EnvelopeSha256(capacity);
  const evidenceBySha = new Map([[stableEnvelopes.hostPolicyEnvelopeSha256, hostPolicy],
    [stableEnvelopes.engineProfileEnvelopeSha256, engineProfile],
    [stableEnvelopes.storageInventoryEnvelopeSha256, storageInventory],
    [stableEnvelopes.protectionInventoryEnvelopeSha256, protectionInventory],
    [capacityEvidenceEnvelopeSha256, capacity]]);
  for (const [sha256, envelope] of evidenceBySha) {
    await fs.writeFile(join(evidenceRoot, `${sha256}.json`), encodeSignedTargetStorageEvidenceV2(envelope), { mode: 0o600 });
  }
  const specification = buildRecoveryTargetSpecificationV2({ operationId, generation, hostInstallationId,
    topologyMode, target, ...stableEnvelopes, capacityEvidenceEnvelopeSha256 });
  const targetSpecificationSha256 = sha256RecoveryBytes(encodeRecoveryTargetSpecificationV2(specification));
  const targetSetId = recoveryTargetSetIdV2({ operationId, generation, hostInstallationId, targetSpecificationSha256 });
  const attestation: RecoveryTargetOperationAttestation = { format: 'darshan-recovery-target-operation-attestation-v1',
    attestationId: randomUUID(), operationId, siteId, generation, hostInstallationId, targetSetId,
    targetSpecificationSha256, targetLogicalIdentitySha256, targetReleaseIdentitySha256, ...stableEnvelopes,
    capacityEvidenceEnvelopeSha256, issuedAt: '2026-10-29T00:00:04.000Z', expiresAt: '2027-10-28T00:00:00.000Z' };
  const signedAttestation: SignedRecoveryTargetOperationAttestation = {
    format: 'darshan-recovery-target-operation-attestation-envelope-v1', attestation,
    signature: { algorithm: 'Ed25519', keyId: 'attestation-authority',
      valueBase64: sign(null, targetOperationAttestationSigningPayload(attestation), attestationKeys.privateKey).toString('base64') } };
  const sourceIdentity = { kind: 'LOCAL_FILESYSTEM_V2' as const, siteId, repositoryId: randomUUID(), runId: randomUUID(),
    attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 1, manifestSha256: digest('manifest'),
    releaseId: 'release-01', schemaMigrationId: RELEASE_RECOVERY_TARGET.terminalMigrationId,
    schemaFingerprintSha256: RELEASE_RECOVERY_TARGET.migrationManifestSha256,
    repositoryDescriptorSha256: digest('repository-descriptor') };
  const source: RecoverySourceDescriptorV2 = { ...sourceIdentity,
    descriptorSha256: recoverySourceDescriptorV2Digest(sourceIdentity), fullyEligible: true };
  const helperRoleSha256 = digest('helper-role');
  const built = buildRecoveryPlanV4({ source, compatibility: { classification: 'COMPATIBLE_CURRENT', fullyEligible: true,
    targetReleaseId: target.releaseId, targetSchemaMigrationId: target.terminalMigrationId, pendingMigrationIds: [] },
  target, operationId, planId: randomUUID(), createdAt: new Date('2026-10-29T00:00:05.000Z'),
  targetPreparation: { generation, hostInstallationId, topologyMode, helperRoleSha256,
    ...stableEnvelopes, capacityEvidenceEnvelopeSha256 }, targetSpecification: specification,
  operationAttestation: signedAttestation });
  const admission: RecoveryTargetAdmissionV2 = { format: 'darshan-recovery-target-admission-v2', admissionId: randomUUID(),
    operationId, siteId, hostInstallationId, planSha256: built.sha256, targetSetId, generation,
    targetSpecificationSha256, operationAttestationSha256: targetOperationAttestationEnvelopeSha256(signedAttestation),
    allowedActions: ['PREPARE', 'INSPECT'], issuedAt: '2026-10-29T00:00:06.000Z', expiresAt: '2027-10-28T00:00:00.000Z' };
  const signedAdmission: SignedRecoveryTargetAdmissionV2 = { admission,
    signature: { algorithm: 'Ed25519', keyId: 'authorization-authority',
      valueBase64: sign(null, targetAdmissionV2SigningPayload(admission), authorizationKeys.privateKey).toString('base64') } };
  const request: TargetHelperRequest = { format: 'darshan-recovery-target-helper-v1', requestId: randomUUID(),
    operation: 'PREPARE', operationId, siteId, hostInstallationId, planSha256: built.sha256, targetSetId, generation,
    targetSpecificationSha256, authorizationSha256: targetAuthorizationV2BodySha256(signedAdmission), expectedHelperSequence: null };
  const installed: RecoveryTargetInstalledIdentityV2 = parseRecoveryTargetInstalledIdentity(canonicalJson({
    format: 'darshan-recovery-target-helper-installation-v2', siteId, hostInstallationId,
    hostPolicySha256: stableEnvelopes.hostPolicyEnvelopeSha256,
    helperRoleSha256, engineProfileSha256: stableEnvelopes.engineProfileEnvelopeSha256,
    specificationRootSha256: digest('specification-root'), evidenceRootSha256: hostPolicy.evidence.evidenceRootSha256,
    allocationLedgerRootSha256: digest('ledger-root'),
    allocationControlRootSha256: options.installedRootMismatch === 'CONTROL' ? digest('wrong-control-root') : rootIdentity('CONTROL'),
    activeRootSha256: options.installedRootMismatch === 'ACTIVE' ? digest('wrong-active-root') : rootIdentity('ACTIVE'),
    quarantineRootSha256: options.installedRootMismatch === 'QUARANTINE'
      ? digest('wrong-quarantine-root') : rootIdentity('QUARANTINE'),
    poolRootSha256: options.installedRootMismatch === 'POOL' ? digest('wrong-pool-root') : rootIdentity('POOL'),
    storageAuthorityIdentitySha256, hostMode: policyHostMode })) as RecoveryTargetInstalledIdentityV2;
  const envelope = createTargetAuthorizationEnvelopeV2({ request, authorization: signedAdmission,
    targetSpecification: specification, operationAttestation: signedAttestation, plan: built.plan,
    planSha256: built.sha256, specificationRootSha256: installed.specificationRootSha256 });
  const loader = new ProtectedTargetStorageEvidenceLoaderV2({ root: evidenceRoot, expectedUid: process.getuid(),
    expectedGid: process.getgid(), keys: new Map([['evidence-authority', publicPem(evidenceKeys)]]),
    now: runtimeNow });
  let effects = 0; let sawStorage = false; let firstPrepare = true; const fake = new DeterministicFakeTargetEngine();
  const engine: RecoveryTargetEngineAdapter = { inspect: (identity, context) => {
    options.onInspect?.(); return fake.inspect(identity, context);
  }, prepare: async (identity, context) => { effects += 1; sawStorage = context.storage?.evidence.capacityEvidence.operationId === operationId;
      if (options.ambiguousFirstPrepare && firstPrepare) {
        firstPrepare = false; throw new TargetEngineEffectError('injected ambiguous pre-retry fixture', 'AMBIGUOUS');
      }
      return fake.prepare(identity, context); },
    stopRetain: (identity, context) => fake.stopRetain(identity, context), retire: (identity, context) => fake.retire(identity, context) };
  const helperJournal = new TargetHelperJournal({ root: journalRoot });
  const service = new RecoveryTargetHelperService({ journal: helperJournal, engine,
    authorize: () => undefined, now: runtimeNow });
  const gateway = new RecoveryTargetAuthorizationGateway({ service,
    keys: new Map([['authorization-authority', publicPem(authorizationKeys)]]),
    attestationKeys: new Map([['attestation-authority', publicPem(attestationKeys)]]),
    evidenceLoaderV2: loader, installedIdentity: installed, now: runtimeNow });
  return { root, evidenceRoot, journalRoot, specification, signedAttestation, built, envelope, gateway, request,
    helperJournal, effects: () => effects, sawStorage: () => sawStorage, targetSetId, targetSpecificationSha256 };
}

describe('Packet 05B1b3b0 acyclic target identity', () => {
  it('constructs the real signed chain in dependency order and reaches only the deterministic fake adapter', async () => {
    const value = await fixture();
    const response = parseTargetHelperResponse(await value.gateway.handle(encodeTargetAuthorizationEnvelopeV2(value.envelope),
      { deadline: new Date('2027-10-29T00:00:00.000Z') }));
    expect(response).toMatchObject({ ok: true, operation: 'PREPARE', state: 'READY', targetSetId: value.targetSetId });
    expect(value.effects()).toBe(1); expect(value.sawStorage()).toBe(true);
    expect(parseRecoveryPlanFile(value.built.bytes, value.built.sha256)).toEqual(value.built.plan);
    expect(recoveryTargetSetIdV2({ operationId: value.built.plan.operationId,
      generation: value.built.plan.targetPreparation.generation,
      hostInstallationId: value.built.plan.targetPreparation.hostInstallationId,
      targetSpecificationSha256: value.targetSpecificationSha256 })).toBe(value.targetSetId);
    expect(recoveryTargetSetIdV2({ operationId: randomUUID(),
      generation: value.built.plan.targetPreparation.generation,
      hostInstallationId: value.built.plan.targetPreparation.hostInstallationId,
      targetSpecificationSha256: value.targetSpecificationSha256 })).not.toBe(value.targetSetId);
    expect(recoveryTargetSetIdV2({ operationId: value.built.plan.operationId,
      generation: value.built.plan.targetPreparation.generation + 1,
      hostInstallationId: value.built.plan.targetPreparation.hostInstallationId,
      targetSpecificationSha256: value.targetSpecificationSha256 })).not.toBe(value.targetSetId);
    expect(recoveryTargetSetIdV2({ operationId: value.built.plan.operationId,
      generation: value.built.plan.targetPreparation.generation,
      hostInstallationId: randomUUID(), targetSpecificationSha256: value.targetSpecificationSha256 })).not.toBe(value.targetSetId);
    expect(recoveryTargetSetIdV2({ operationId: value.built.plan.operationId,
      generation: value.built.plan.targetPreparation.generation,
      hostInstallationId: value.built.plan.targetPreparation.hostInstallationId,
      targetSpecificationSha256: digest('caller-supplied-noncanonical-spec') })).not.toBe(value.targetSetId);
    expect(value.built.plan.targetPreparation).not.toHaveProperty('planSha256');
    expect(value.specification).not.toHaveProperty('targetSetId');
    expect(value.specification).not.toHaveProperty('operationAttestationSha256');
    for (const name of ['hostPolicyEnvelopeSha256', 'engineProfileEnvelopeSha256',
      'storageInventoryEnvelopeSha256', 'protectionInventoryEnvelopeSha256'] as const) {
      expect(value.signedAttestation.attestation[name]).toBe(value.built.plan.targetPreparation[name]);
    }
  });

  it.each([
    ['installed ACTIVE root', { installedRootMismatch: 'ACTIVE' }],
    ['installed QUARANTINE root', { installedRootMismatch: 'QUARANTINE' }],
    ['installed POOL root', { installedRootMismatch: 'POOL' }],
    ['installed CONTROL root', { installedRootMismatch: 'CONTROL' }],
    ['plan/spec topology versus installed policy mode', { topologyMode: 'SPLIT_HOST', policyHostMode: 'SINGLE_HOST' }],
    ['inventory filesystem outside host policy', { inventoryFilesystem: 'xfs' }],
  ] as const)('rejects correctly signed/content-addressed semantic mismatch: %s', async (_label, options) => {
    const value = await fixture(randomUUID(), options);
    await expect(value.gateway.handle(encodeTargetAuthorizationEnvelopeV2(value.envelope),
      { deadline: new Date('2027-10-29T00:00:00.000Z') })).rejects.toMatchObject({
        code: 'RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      });
    expect(value.effects()).toBe(0); expect(await fs.readdir(value.journalRoot)).toEqual([]);
  });

  it('rechecks expiry after asynchronous evidence loading before journal creation', async () => {
    let reads = 0; const active = new Date('2026-10-29T01:00:00.000Z'); const expired = new Date('2027-10-29T00:00:00.000Z');
    const value = await fixture(randomUUID(), { now: () => ++reads <= 7 ? active : expired });
    await expect(value.gateway.handle(encodeTargetAuthorizationEnvelopeV2(value.envelope),
      { deadline: new Date('2028-10-29T00:00:00.000Z') })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_EXPIRED' });
    expect(value.effects()).toBe(0); expect(await fs.readdir(value.journalRoot)).toEqual([]);
  });

  it('rechecks expiry immediately before dispatch under the helper lock', async () => {
    let reads = 0; const active = new Date('2026-10-29T01:00:00.000Z'); const expired = new Date('2027-10-29T00:00:00.000Z');
    const value = await fixture(randomUUID(), { now: () => ++reads <= 8 ? active : expired });
    await expect(value.gateway.handle(encodeTargetAuthorizationEnvelopeV2(value.envelope),
      { deadline: new Date('2028-10-29T00:00:00.000Z') })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_EXPIRED' });
    expect(value.effects()).toBe(0);
  });

  it('rechecks the execution deadline after asynchronous evidence loading', async () => {
    let reads = 0; const beforeDeadline = new Date('2026-10-29T01:00:00.000Z');
    const afterDeadline = new Date('2026-12-01T00:00:00.000Z');
    const value = await fixture(randomUUID(), { now: () => ++reads <= 7 ? beforeDeadline : afterDeadline });
    await expect(value.gateway.handle(encodeTargetAuthorizationEnvelopeV2(value.envelope),
      { deadline: new Date('2026-11-01T00:00:00.000Z') })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_EXPIRED' });
    expect(value.effects()).toBe(0); expect(await fs.readdir(value.journalRoot)).toEqual([]);
  });

  it('rechecks signed-chain freshness after reconciliation inspect and before retry effect', async () => {
    let current = new Date('2026-10-29T01:00:00.000Z');
    const value = await fixture(randomUUID(), { ambiguousFirstPrepare: true, now: () => current,
      onInspect: () => { current = new Date('2027-10-29T00:00:00.000Z'); } });
    const bytes = encodeTargetAuthorizationEnvelopeV2(value.envelope);
    await expect(value.gateway.handle(bytes, { deadline: new Date('2027-01-01T00:00:00.000Z') }))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    const before = await value.helperJournal.read(value.targetSetId);
    await expect(value.gateway.handle(bytes, { deadline: new Date('2027-01-01T00:00:00.000Z') }))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_AUTH_EXPIRED' });
    expect(value.effects()).toBe(1);
    expect(await value.helperJournal.read(value.targetSetId)).toEqual(before);
  });

  it('rechecks cancellation after reconciliation inspect and makes no retry effect or journal claim', async () => {
    const abort = new AbortController(); let abortOnInspect = false;
    const value = await fixture(randomUUID(), { ambiguousFirstPrepare: true,
      onInspect: () => { if (abortOnInspect) abort.abort(); } });
    const bytes = encodeTargetAuthorizationEnvelopeV2(value.envelope);
    await expect(value.gateway.handle(bytes, { deadline: new Date('2028-10-29T00:00:00.000Z') }))
      .rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    const before = await value.helperJournal.read(value.targetSetId); abortOnInspect = true;
    await expect(value.gateway.handle(bytes, { deadline: new Date('2028-10-29T00:00:00.000Z'), signal: abort.signal }))
      .rejects.toBeDefined();
    expect(value.effects()).toBe(1);
    expect(await value.helperJournal.read(value.targetSetId)).toEqual(before);
  });

  it('uses one injected default deadline for direct service screening, lock, dispatch, and engine context', async () => {
    const value = await fixture(); const directRoot = join(value.root, 'direct-default-deadline');
    await fs.mkdir(directRoot, { mode: 0o700 });
    const effectiveDeadline = new Date('2027-01-01T00:00:00.000Z'); const observed: Date[] = [];
    const fake = new DeterministicFakeTargetEngine();
    const engine: RecoveryTargetEngineAdapter = { inspect: (identity, context) => fake.inspect(identity, context),
      prepare: (identity, context) => { observed.push(context.deadline); return fake.prepare(identity, context); },
      stopRetain: (identity, context) => fake.stopRetain(identity, context),
      retire: (identity, context) => fake.retire(identity, context) };
    const service = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root: directRoot }), engine,
      authorize: () => undefined, defaultDeadline: () => effectiveDeadline,
      deadlineNow: () => new Date('2026-10-29T00:00:00.000Z') });
    const response = parseTargetHelperResponse(await service.handle(encodeTargetHelperRequest(value.request), {
      screen: (_request, freshness) => { observed.push(freshness.deadline); },
      locked: (_request, _state, freshness) => { observed.push(freshness.deadline); },
      beforeDispatch: (_request, _state, freshness) => { observed.push(freshness.deadline); },
    }));
    expect(response).toMatchObject({ ok: true, state: 'READY' });
    expect(observed).toHaveLength(4);
    expect(observed.every((deadline) => deadline === effectiveDeadline)).toBe(true);
  });

  it.each([
    ['stable signed evidence', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const sha256 = value.built.plan.targetPreparation.hostPolicyEnvelopeSha256;
      const path = join(value.evidenceRoot, `${sha256}.json`);
      const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as { evidence: Record<string, unknown> };
      parsed.evidence.hostMode = 'SPLIT_HOST'; await fs.writeFile(path, canonicalJson(parsed), { mode: 0o600 });
      return encodeTargetAuthorizationEnvelopeV2(value.envelope);
    }],
    ['capacity operation binding', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const sha256 = value.built.plan.targetPreparation.capacityEvidenceEnvelopeSha256;
      const path = join(value.evidenceRoot, `${sha256}.json`);
      const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as { evidence: Record<string, unknown> };
      parsed.evidence.operationId = randomUUID(); await fs.writeFile(path, canonicalJson(parsed), { mode: 0o600 });
      return encodeTargetAuthorizationEnvelopeV2(value.envelope);
    }],
    ['content-addressed envelope name', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const preparation = value.built.plan.targetPreparation;
      const validWrongBytes = await fs.readFile(join(value.evidenceRoot, `${preparation.hostPolicyEnvelopeSha256}.json`));
      await fs.writeFile(join(value.evidenceRoot, `${preparation.capacityEvidenceEnvelopeSha256}.json`), validWrongBytes, { mode: 0o600 });
      return encodeTargetAuthorizationEnvelopeV2(value.envelope);
    }],
    ['specification binding', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      (outer.targetSpecification as Record<string, unknown>).operationId = randomUUID(); return canonicalJson(outer);
    }],
    ['target-set derivation', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      (outer.preparationIdentity as Record<string, unknown>).targetSetId = digest('mutated-target-set'); return canonicalJson(outer);
    }],
    ['operation attestation', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      const signed = outer.operationAttestation as Record<string, unknown>;
      (signed.attestation as Record<string, unknown>).capacityEvidenceEnvelopeSha256 = digest('mutated-capacity');
      return canonicalJson(outer);
    }],
    ['plan binding', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      (outer.plan as Record<string, unknown>).operationId = randomUUID(); return canonicalJson(outer);
    }],
    ['admission binding', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      const signed = outer.authorization as Record<string, unknown>;
      (signed.admission as Record<string, unknown>).operationAttestationSha256 = digest('mutated-attestation');
      return canonicalJson(outer);
    }],
    ['request binding', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      (outer.request as Record<string, unknown>).hostInstallationId = randomUUID(); return canonicalJson(outer);
    }],
    ['strict outer envelope', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      outer.targetPath = '/tmp/not-authority'; return canonicalJson(outer);
    }],
    ['outer version cross-mix', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      outer.format = 'darshan-recovery-target-authorization-envelope-v1'; return canonicalJson(outer);
    }],
    ['specification version cross-mix', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      (outer.targetSpecification as Record<string, unknown>).format = 'darshan-recovery-target-specification-v1';
      return canonicalJson(outer);
    }],
    ['plan version cross-mix', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      (outer.plan as Record<string, unknown>).format = 'darshan-recovery-plan-v3'; return canonicalJson(outer);
    }],
    ['admission version cross-mix', async (value: Awaited<ReturnType<typeof fixture>>) => {
      const outer = structuredClone(value.envelope) as unknown as Record<string, unknown>;
      ((outer.authorization as Record<string, unknown>).admission as Record<string, unknown>).format =
        'darshan-recovery-target-admission-v1';
      return canonicalJson(outer);
    }],
  ] as const)('rejects mutated %s before journal or engine effect', async (_label, mutate) => {
    const value = await fixture(); const bytes = await mutate(value);
    await expect(value.gateway.handle(bytes, { deadline: new Date('2027-10-29T00:00:00.000Z') })).rejects.toBeDefined();
    expect(value.effects()).toBe(0); expect(await fs.readdir(value.journalRoot)).toEqual([]);
  });

  it('keeps v1 evidence and plan v3 readable while both INSPECT and PREPARE remain effect-ineligible', async () => {
    const current = await fixture(); const keys = generateKeyPairSync('ed25519');
    const operationId = randomUUID(); const hostInstallationId = randomUUID(); const target = { ...RELEASE_RECOVERY_TARGET };
    const targetPreparation = { generation: 1, hostInstallationId, topologyMode: 'SINGLE_HOST' as const,
      hostPolicySha256: digest('legacy-host-policy'), helperRoleSha256: digest('legacy-helper-role'),
      engineProfileSha256: digest('legacy-engine-profile'), protectionInventorySha256: digest('legacy-protection'),
      capacityEvidenceSha256: digest('legacy-capacity'), storageInventorySha256: digest('legacy-storage') };
    const specification = buildRecoveryTargetSpecification({ operationId, target, targetPreparation });
    const built = buildRecoveryPlanV3({ source: current.built.plan.source,
      compatibility: { classification: 'COMPATIBLE_CURRENT', fullyEligible: true, targetReleaseId: target.releaseId,
        targetSchemaMigrationId: target.terminalMigrationId, pendingMigrationIds: [] }, target, targetPreparation,
      targetSpecification: specification, operationId, planId: randomUUID(), createdAt: new Date('2026-10-29T00:00:00.000Z') });
    expect(parseRecoveryPlanFile(built.bytes, built.sha256)).toEqual(built.plan);
    const legacyEvidence: TargetStorageEvidence = { format: 'darshan-recovery-host-policy-evidence-v1', kind: 'HOST_POLICY',
      evidenceId: randomUUID(), siteId: built.plan.source.siteId, hostInstallationId, operationId, generation: '1',
      targetSetId: built.plan.targetPreparation.targetSetId,
      targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256,
      targetReleaseIdentitySha256: recoveryTargetReleaseIdentitySha256(target),
      issuedAt: '2026-10-29T00:00:00.000Z', validFrom: '2026-10-29T00:00:01.000Z',
      expiresAt: '2027-10-29T00:00:00.000Z', dependencies: [], revokedEnvelopeSha256: [], hostMode: 'SINGLE_HOST',
      storageAuthorityIdentitySha256: digest('legacy-storage-authority'), evidenceRootSha256: digest('legacy-evidence-root'),
      allocationControlRootSha256: digest('legacy-control-root'), allowedFilesystems: ['ext4'] };
    const signedLegacyEvidence = { format: 'darshan-recovery-storage-evidence-envelope-v1' as const,
      evidence: legacyEvidence, signature: { algorithm: 'Ed25519' as const, keyId: 'legacy-authority',
        valueBase64: sign(null, targetStorageEvidenceSigningPayload(legacyEvidence), keys.privateKey).toString('base64') } };
    expect(verifyTargetStorageEvidence({ bytes: encodeSignedTargetStorageEvidence(signedLegacyEvidence),
      keys: new Map([['legacy-authority', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
      now: new Date('2026-10-29T01:00:00.000Z') })).toEqual(signedLegacyEvidence);
    const admission: RecoveryTargetAdmission = { format: 'darshan-recovery-target-admission-v1', admissionId: randomUUID(),
      operationId, siteId: built.plan.source.siteId, hostInstallationId, planSha256: built.sha256,
      targetSetId: built.plan.targetPreparation.targetSetId, generation: 1,
      targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256,
      allowedActions: ['PREPARE', 'INSPECT'], issuedAt: '2026-10-29T00:00:00.000Z', expiresAt: '2027-10-29T00:00:00.000Z' };
    const signedAdmission: SignedRecoveryTargetAdmission = { admission, signature: { algorithm: 'Ed25519',
      keyId: 'legacy-authority', valueBase64: sign(null, targetAdmissionSigningPayload(admission), keys.privateKey).toString('base64') } };
    const legacyJournalRoot = join(current.root, 'legacy-journal'); await fs.mkdir(legacyJournalRoot, { mode: 0o700 });
    let effects = 0; const fake = new DeterministicFakeTargetEngine();
    const engine: RecoveryTargetEngineAdapter = { inspect: async (identity, context) => { effects += 1; return fake.inspect(identity, context); },
      prepare: async (identity, context) => { effects += 1; return fake.prepare(identity, context); },
      stopRetain: (identity, context) => fake.stopRetain(identity, context), retire: (identity, context) => fake.retire(identity, context) };
    const service = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root: legacyJournalRoot }), engine,
      authorize: () => undefined, now: () => new Date('2026-10-29T01:00:00.000Z') });
    const gateway = new RecoveryTargetAuthorizationGateway({ service,
      keys: new Map([['legacy-authority', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
      installedIdentity: { format: 'darshan-recovery-target-helper-installation-v2', siteId: built.plan.source.siteId, hostInstallationId,
        hostPolicySha256: targetPreparation.hostPolicySha256, helperRoleSha256: targetPreparation.helperRoleSha256,
        engineProfileSha256: targetPreparation.engineProfileSha256, specificationRootSha256: digest('legacy-spec-root'),
        evidenceRootSha256: digest('legacy-installed-evidence-root'), allocationLedgerRootSha256: digest('legacy-ledger-root'),
        allocationControlRootSha256: digest('legacy-installed-control-root'), activeRootSha256: digest('legacy-active-root'),
        quarantineRootSha256: digest('legacy-quarantine-root'), poolRootSha256: digest('legacy-pool-root'),
        storageAuthorityIdentitySha256: digest('legacy-installed-storage-authority'), hostMode: 'SINGLE_HOST' },
      now: () => new Date('2026-10-29T01:00:00.000Z') });
    for (const operation of ['INSPECT', 'PREPARE'] as const) {
      const request: TargetHelperRequest = { format: 'darshan-recovery-target-helper-v1', requestId: randomUUID(), operation,
        operationId, siteId: built.plan.source.siteId, hostInstallationId, planSha256: built.sha256,
        targetSetId: built.plan.targetPreparation.targetSetId, generation: 1,
        targetSpecificationSha256: built.plan.targetPreparation.targetSpecificationSha256,
        authorizationSha256: targetAuthorizationBodySha256(signedAdmission), expectedHelperSequence: null };
      const outer = createTargetAuthorizationEnvelope({ request, authorization: signedAdmission,
        targetSpecification: specification, plan: built.plan, planSha256: built.sha256,
        specificationRootSha256: digest('legacy-spec-root') });
      await expect(gateway.handle(encodeTargetAuthorizationEnvelope(outer),
        { deadline: new Date('2027-10-29T00:00:00.000Z') })).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_INELIGIBLE' });
    }
    expect(effects).toBe(0); expect(await fs.readdir(legacyJournalRoot)).toEqual([]);
  });
});
