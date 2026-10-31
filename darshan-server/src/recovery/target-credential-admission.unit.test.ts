import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import {
  credentialAdmissionV1Sha256, credentialDescriptorIdentityV1Sha256, credentialProvisionJournalRecordSha256,
  credentialProvisionScopeV1Sha256, credentialProvisionScopeWireV1Sha256,
  encodeCredentialAdmissionV1, encodeCredentialProvisionJournalV1,
  encodeCredentialProvisionScopeV1, encodeCredentialProvisionScopeWireV1,
  encodeTargetNativeEngineProfileV3, encodeTargetResourceAdmissionV2,
  parseCredentialAdmissionV1, parseCredentialProvisionScopeV1,
  parseTargetNativeEngineProfileV3, parseTargetResourceAdmissionV2,
  type CredentialAdmissionV1, type CredentialDescriptorIdentityV1,
  type CredentialProvisionJournalV1, type CredentialProvisionScopeV1,
} from './target-credential-contracts';
import { credentialAuthorizationMessage, TargetCredentialAdmissionVerifier,
  verifyCredentialPrepareAuthorizationV1 } from './target-credential-admission';

const a = 'a'.repeat(64); const b = 'b'.repeat(64); const c = 'c'.repeat(64); const d = 'd'.repeat(64);
const h = (name: string) => `tra:v1:${name}:abcdefghijklmnop`;
const scope: CredentialProvisionScopeV1 = {
  format: 'darshan-recovery-credential-provision-scope-v1', operation: 'PREPARE',
  operationId: '10000000-0000-4000-8000-000000000001', generation: '7',
  targetHandle: h('target'), authorityTargetHandle: 'rtea:v1:target:abcdefghijklmnop',
  authorityHandle: h('credential-authority'),
  profileV2Sha256: a, precredentialTemplateSha256: b, allocationIdentitySha256: c,
  allocationLedgerHeadSha256: d, authorizationSha256: b,
  outerEnvelopeSha256: c, credentialPolicySha256: d, authorityInstanceSha256: a,
  supervisorGeneration: '9', challengeNonce: '1'.repeat(32), deadlineUnixMs: '2000000000000',
  previousJournalHeadSha256: '0'.repeat(64),
  roles: [
    { role: 'POSTGRES_PASSWORD', authorityHandle: h('postgres-password') },
    { role: 'MINIO_ROOT_PASSWORD', authorityHandle: h('minio-root-password') },
    { role: 'MINIO_ROOT_USER', authorityHandle: h('minio-root-user') },
  ],
};
const descriptor = (value: Omit<CredentialDescriptorIdentityV1, 'descriptorIdentitySha256'>): CredentialDescriptorIdentityV1 =>
  ({ ...value, descriptorIdentitySha256: credentialDescriptorIdentityV1Sha256(value) });
const descriptors: [CredentialDescriptorIdentityV1, CredentialDescriptorIdentityV1, CredentialDescriptorIdentityV1] = [
  descriptor({ role: 'POSTGRES_PASSWORD', authorityHandle: scope.roles[0].authorityHandle,
    deviceMajor: '8', deviceMinor: '1', inode: '101', mountId: '55', ownerUid: '999', ownerGid: '999', mode: '0400' },
  ), descriptor({ role: 'MINIO_ROOT_PASSWORD', authorityHandle: scope.roles[1].authorityHandle,
    deviceMajor: '8', deviceMinor: '1', inode: '102', mountId: '55', ownerUid: '1000', ownerGid: '1000', mode: '0400' },
  ), descriptor({ role: 'MINIO_ROOT_USER', authorityHandle: scope.roles[2].authorityHandle,
    deviceMajor: '8', deviceMinor: '1', inode: '103', mountId: '55', ownerUid: '1000', ownerGid: '1000', mode: '0400' },
  ),
];

function recordsAndReceipt(activeScope: CredentialProvisionScopeV1 = scope): { records: CredentialProvisionJournalV1[]; receipt: CredentialAdmissionV1 } {
  const common = {
    operationId: activeScope.operationId, generation: activeScope.generation, targetHandle: activeScope.targetHandle,
    scopeSemanticSha256: credentialProvisionScopeV1Sha256(activeScope), scopeWireSha256: credentialProvisionScopeWireV1Sha256(activeScope),
    authorizationSha256: activeScope.authorizationSha256, allocationIdentitySha256: activeScope.allocationIdentitySha256,
    allocationLedgerHeadSha256: activeScope.allocationLedgerHeadSha256, credentialPolicySha256: activeScope.credentialPolicySha256,
    authorityInstanceSha256: activeScope.authorityInstanceSha256,
  };
  const intentBody = { format: 'darshan-recovery-credential-provision-journal-v1' as const, state: 'INTENT' as const,
    sequence: '1', ...common, previousHeadSha256: activeScope.previousJournalHeadSha256 };
  const intent: CredentialProvisionJournalV1 = { ...intentBody, recordSha256: credentialProvisionJournalRecordSha256(intentBody) };
  const durableBody = { format: 'darshan-recovery-credential-provision-journal-v1' as const, state: 'FILES_DURABLE' as const,
    sequence: '2', ...common, previousHeadSha256: intent.recordSha256, intentRecordSha256: intent.recordSha256, descriptors };
  const durable: CredentialProvisionJournalV1 = { ...durableBody, recordSha256: credentialProvisionJournalRecordSha256(durableBody) };
  const receiptBody = {
    format: 'darshan-recovery-credential-admission-v1' as const, status: 'FULLY_ENROLLED' as const,
    operationId: activeScope.operationId, generation: activeScope.generation, targetHandle: activeScope.targetHandle,
    authorityHandle: activeScope.authorityHandle, scopeSemanticSha256: common.scopeSemanticSha256,
    scopeWireSha256: common.scopeWireSha256, intentRecordSha256: intent.recordSha256,
    filesDurableRecordSha256: durable.recordSha256, allocationIdentitySha256: activeScope.allocationIdentitySha256,
    allocationLedgerHeadSha256: activeScope.allocationLedgerHeadSha256, credentialPolicySha256: activeScope.credentialPolicySha256,
    requestSha256: credentialProvisionScopeWireV1Sha256(activeScope), authorizationSha256: activeScope.authorizationSha256,
    authorityInstanceSha256: activeScope.authorityInstanceSha256, descriptors,
  };
  const receipt: CredentialAdmissionV1 = { ...receiptBody,
    receiptSha256: credentialProvisionJournalRecordSha256(receiptBody as never) };
  const admittedBody = { format: 'darshan-recovery-credential-provision-journal-v1' as const, state: 'ADMITTED' as const,
    sequence: '3', ...common, previousHeadSha256: durable.recordSha256, intentRecordSha256: intent.recordSha256,
    filesDurableRecordSha256: durable.recordSha256, admissionReceiptSha256: credentialAdmissionV1Sha256(receipt) };
  const admitted: CredentialProvisionJournalV1 = { ...admittedBody, recordSha256: credentialProvisionJournalRecordSha256(admittedBody) };
  return { records: [intent, durable, admitted], receipt };
}

describe('credential provisioning contracts and admission', () => {
  it('has one exact domain-separated wire encoding and distinct semantic/wire digests', () => {
    const semantic = encodeCredentialProvisionScopeV1(scope); const wire = encodeCredentialProvisionScopeWireV1(scope);
    expect(parseCredentialProvisionScopeV1(semantic)).toEqual(scope);
    expect(wire.toString()).toBe([
      'domain=darshan-recovery-credential-provision-scope-wire-v1', 'operation=PREPARE',
      `operation_id=${scope.operationId}`, `scope_semantic_sha256=${credentialProvisionScopeV1Sha256(scope)}`,
      'generation=00000000000000000007', `target_handle=${scope.targetHandle}`,
      `authority_target_handle=${scope.authorityTargetHandle}`,
      `authority_handle=${scope.authorityHandle}`, `profile_v2_sha256=${a}`, `precredential_template_sha256=${b}`,
      `allocation_identity_sha256=${c}`, `allocation_ledger_head_sha256=${d}`,
      `authorization_sha256=${b}`, `outer_envelope_sha256=${c}`, `credential_policy_sha256=${d}`,
      `authority_instance_sha256=${a}`, 'supervisor_generation=00000000000000000009', `challenge_nonce=${'1'.repeat(32)}`,
      'deadline_unix_ms=00000002000000000000', `previous_journal_head_sha256=${'0'.repeat(64)}`,
      `postgres_password_handle=${scope.roles[0].authorityHandle}`,
      `minio_root_password_handle=${scope.roles[1].authorityHandle}`, `minio_root_user_handle=${scope.roles[2].authorityHandle}`, '',
    ].join('\n'));
    expect(credentialProvisionScopeV1Sha256(scope)).toBe('9f496d22fa1e242528f812425faed559f90dda95e09255d543112c47c517ec11');
    expect(credentialProvisionScopeWireV1Sha256(scope)).toBe('9df4b8e32bdc928ee4892a95fff9ba7d5643150eaa76eb641c4babc03394f41a');
  });

  it('verifies exact signed PREPARE scope and rejects expiry or binding substitution', () => {
    const keys = generateKeyPairSync('ed25519');
    const body = { format: 'darshan-recovery-credential-prepare-authorization-v1' as const,
      scopeSemanticSha256: credentialProvisionScopeV1Sha256(scope), scopeWireSha256: credentialProvisionScopeWireV1Sha256(scope),
      keyId: 'fixture-key', algorithm: 'Ed25519' as const };
    const authorization = { ...body, signatureBase64: sign(null, credentialAuthorizationMessage(body), keys.privateKey).toString('base64') };
    const valid = { scope, authorization, expectedKeyId: 'fixture-key',
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), nowUnixMs: 1_900_000_000_000n };
    expect(() => verifyCredentialPrepareAuthorizationV1(valid)).not.toThrow();
    expect(() => verifyCredentialPrepareAuthorizationV1({ ...valid, nowUnixMs: 2_000_000_000_000n })).toThrow();
    expect(() => verifyCredentialPrepareAuthorizationV1({ ...valid, scope: { ...scope, generation: '8' } })).toThrow();
  });

  it('admits only the exact contiguous journal and receipt and rejects stale heads/substitutions', async () => {
    const fixture = recordsAndReceipt();
    const store = { scan: async () => fixture.records.map(encodeCredentialProvisionJournalV1),
      readAdmission: async () => encodeCredentialAdmissionV1(fixture.receipt) };
    const requestDigest = credentialProvisionScopeWireV1Sha256(scope);
    await expect(new TargetCredentialAdmissionVerifier(store).readExactAdmission(scope, requestDigest)).resolves.toEqual(fixture.receipt);
    await expect(new TargetCredentialAdmissionVerifier(store).readExactAdmission(scope, a)).rejects.toThrow();
    const stale = { ...fixture.records[1]!, previousHeadSha256: d } as CredentialProvisionJournalV1;
    await expect(new TargetCredentialAdmissionVerifier({ ...store,
      scan: async () => [fixture.records[0]!, stale, fixture.records[2]!].map((record) =>
        record === stale ? canonicalJson(record) : encodeCredentialProvisionJournalV1(record)) }).readExactAdmission(scope, requestDigest)).rejects.toThrow();
    await expect(new TargetCredentialAdmissionVerifier(store).readExactAdmission({ ...scope, authorityInstanceSha256: b }, requestDigest)).rejects.toThrow();
    await expect(new TargetCredentialAdmissionVerifier({ ...store,
      scan: async () => [...(await store.scan()), new Uint8Array([1])] }).readExactAdmission(scope, requestDigest)).rejects.toThrow();
    const changedReceipt = { ...fixture.receipt, descriptors: [
      { ...fixture.receipt.descriptors[0], inode: '999' }, fixture.receipt.descriptors[1], fixture.receipt.descriptors[2],
    ] as typeof fixture.receipt.descriptors };
    const changedBody = Object.fromEntries(Object.entries(changedReceipt).filter(([key]) => key !== 'receiptSha256'));
    await expect(new TargetCredentialAdmissionVerifier({ ...store, readAdmission: async () => encodeCredentialAdmissionV1({
      ...changedReceipt, receiptSha256: credentialProvisionJournalRecordSha256(changedBody as never),
    }) }).readExactAdmission(scope, requestDigest)).rejects.toThrow();
    const nonzeroScope = { ...scope, previousJournalHeadSha256: d };
    await expect(new TargetCredentialAdmissionVerifier(store).readExactAdmission(nonzeroScope, credentialProvisionScopeWireV1Sha256(nonzeroScope))).rejects.toThrow();
    const nonzeroFixture = recordsAndReceipt(nonzeroScope);
    await expect(new TargetCredentialAdmissionVerifier({
      scan: async () => nonzeroFixture.records.map(encodeCredentialProvisionJournalV1),
      readAdmission: async () => encodeCredentialAdmissionV1(nonzeroFixture.receipt),
    }).readExactAdmission(nonzeroScope, credentialProvisionScopeWireV1Sha256(nonzeroScope))).resolves.toEqual(nonzeroFixture.receipt);
  });

  it('keeps profile v3 and resource admission unavailable or fully enrolled without enabling lifecycle', () => {
    const unavailable = { format: 'darshan-recovery-target-native-engine-profile-v3' as const, baseProfileV2Sha256: a,
      enrollment: { status: 'UNAVAILABLE' as const, credentialAdmissionReceiptSha256: null, credentials: [] as [], dispatchEnabled: false as const } };
    expect(parseTargetNativeEngineProfileV3(encodeTargetNativeEngineProfileV3(unavailable)).enrollment.status).toBe('UNAVAILABLE');
    const fixture = recordsAndReceipt(); const enrolled = { format: unavailable.format, baseProfileV2Sha256: a,
      enrollment: { status: 'FULLY_ENROLLED' as const, credentialAdmissionReceiptSha256: credentialAdmissionV1Sha256(fixture.receipt),
        credentials: descriptors, dispatchEnabled: false as const } };
    expect(parseTargetNativeEngineProfileV3(encodeTargetNativeEngineProfileV3(enrolled)).enrollment.status).toBe('FULLY_ENROLLED');
    const resource = { format: 'darshan-recovery-target-resource-admission-v2' as const, targetHandle: scope.targetHandle,
      generation: scope.generation, profileV3Sha256: a, credentialStatus: 'FULLY_ENROLLED' as const,
      credentialAdmissionReceiptSha256: credentialAdmissionV1Sha256(fixture.receipt), credentialDescriptors: descriptors,
      materializationEnabled: false as const, lifecycleEnabled: false as const };
    expect(parseTargetResourceAdmissionV2(encodeTargetResourceAdmissionV2(resource)).lifecycleEnabled).toBe(false);
    expect(() => encodeTargetResourceAdmissionV2({ ...resource, credentialStatus: 'UNAVAILABLE', credentialAdmissionReceiptSha256: null })).toThrow();
  });

  it('rejects role order, aliases, self-hash changes, trailing JSON, and secret-shaped receipt fields', () => {
    const fixture = recordsAndReceipt();
    expect(() => encodeCredentialAdmissionV1({ ...fixture.receipt, descriptors: [descriptors[1], descriptors[0], descriptors[2]] })).toThrow();
    expect(() => encodeCredentialProvisionScopeV1({ ...scope, roles: [scope.roles[0],
      { ...scope.roles[1], authorityHandle: scope.roles[0].authorityHandle }, scope.roles[2]] })).toThrow();
    expect(() => encodeCredentialAdmissionV1({ ...fixture.receipt, descriptors: [
      { ...descriptors[0], ownerUid: '1000' }, descriptors[1], descriptors[2],
    ] })).toThrow();
    expect(() => encodeCredentialAdmissionV1({ ...fixture.receipt, descriptors: [
      { ...descriptors[0], descriptorIdentitySha256: d }, descriptors[1], descriptors[2],
    ] })).toThrow();
    expect(() => encodeCredentialAdmissionV1({ ...fixture.receipt, receiptSha256: d })).toThrow();
    expect(() => parseCredentialAdmissionV1(Buffer.concat([encodeCredentialAdmissionV1(fixture.receipt), Buffer.from('{}')]))).toThrow();
    expect(Object.keys(fixture.receipt).join(',')).not.toMatch(/value|password|secret|digest/i);
  });
});
