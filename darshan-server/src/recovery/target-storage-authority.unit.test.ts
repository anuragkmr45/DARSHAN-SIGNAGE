import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { calculateFullOutstandingCapacity, parseRecoveryTargetInstalledIdentity,
  encodeTargetStorageNativeLedgerRecord, parseTargetStorageNativeRequest,
  requireEffectEligibleInstalledIdentity } from './target-storage-authority';
import { encodeSignedTargetStorageEvidence, targetStorageEvidenceEnvelopeSha256,
  targetStorageEvidenceSigningPayload, verifyTargetStorageEvidence,
  type SignedTargetStorageEvidence, type TargetStorageEvidence } from './target-storage-contracts';
import { loadVerifiedTargetStorageEvidenceDag, ProtectedTargetStorageEvidenceLoader } from './target-storage-evidence';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));
const binding = { siteId: 'site-a', hostInstallationId: '00000000-0000-4000-8000-000000000001',
  operationId: '00000000-0000-4000-8000-000000000002', generation: '1', targetSetId: '1'.repeat(64),
  targetSpecificationSha256: '2'.repeat(64), targetReleaseIdentitySha256: '3'.repeat(64),
  evidenceId: randomUUID(), issuedAt: '2026-10-29T00:00:00.000Z', validFrom: '2026-10-29T00:00:01.000Z',
  expiresAt: '2026-10-30T00:00:00.000Z', revokedEnvelopeSha256: [] as string[] };

function signed(evidence: TargetStorageEvidence, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): SignedTargetStorageEvidence {
  return { format: 'darshan-recovery-storage-evidence-envelope-v1', evidence,
    signature: { algorithm: 'Ed25519', keyId: 'authority',
      valueBase64: sign(null, targetStorageEvidenceSigningPayload(evidence), privateKey).toString('base64') } };
}

describe('target storage authority contracts', () => {
  it('reads historical v1 identity but refuses to make it effect-eligible', () => {
    const v1 = parseRecoveryTargetInstalledIdentity(canonicalJson({ format: 'darshan-recovery-target-helper-installation-v1',
      siteId: 'site-a', hostInstallationId: binding.hostInstallationId, hostPolicySha256: '1'.repeat(64),
      helperRoleSha256: '2'.repeat(64), engineProfileSha256: '3'.repeat(64), specificationRootSha256: '4'.repeat(64) }));
    expect(v1.format).toBe('darshan-recovery-target-helper-installation-v1');
    expect(() => requireEffectEligibleInstalledIdentity(v1)).toThrow(/readable but effect-ineligible/);
  });

  it('requires every installed storage identity field in canonical v2', () => {
    const value = { format: 'darshan-recovery-target-helper-installation-v2', siteId: 'site-a',
      hostInstallationId: binding.hostInstallationId, hostPolicySha256: '1'.repeat(64), helperRoleSha256: '2'.repeat(64),
      engineProfileSha256: '3'.repeat(64), specificationRootSha256: '4'.repeat(64), evidenceRootSha256: '5'.repeat(64),
      allocationLedgerRootSha256: '6'.repeat(64), allocationControlRootSha256: '7'.repeat(64),
      activeRootSha256: '8'.repeat(64), quarantineRootSha256: '9'.repeat(64), poolRootSha256: 'a'.repeat(64),
      storageAuthorityIdentitySha256: 'b'.repeat(64), hostMode: 'SPLIT_HOST' };
    expect(requireEffectEligibleInstalledIdentity(parseRecoveryTargetInstalledIdentity(canonicalJson(value)))).toEqual(value);
    expect(() => parseRecoveryTargetInstalledIdentity(canonicalJson({ ...value, activeRootSha256: undefined }))).toThrow();
  });

  it('uses f_bavail*f_frsize and subtracts every outstanding byte and inode reservation', () => {
    expect(calculateFullOutstandingCapacity({ fBavail: '100', fFrsize: '4096', fFavail: '20',
      outstandingReservationBytes: ['1000', '2000'], outstandingReservationInodes: ['3', '4'],
      requiredBytes: '400000', requiredInodes: '13' })).toEqual({ availableBytes: '409600', availableInodes: '20',
      fullOutstandingReservationBytes: '3000', fullOutstandingReservationInodes: '7',
      remainingBytes: '406600', remainingInodes: '13', admitted: true });
    expect(() => calculateFullOutstandingCapacity({ fBavail: '18446744073709551615', fFrsize: '2', fFavail: '0',
      outstandingReservationBytes: [], outstandingReservationInodes: [], requiredBytes: '0', requiredInodes: '0' })).toThrow(/overflows/);
  });

  it('admits only fixed native fields and never accepts caller quarantine authority', () => {
    const base = { format: 'darshan-recovery-target-storage-native-v1', operation: 'VALIDATE', targetSetId: '1'.repeat(64),
      generation: '1', requestNonce: '2'.repeat(64), component: null, expectedLedgerHeadSha256: '3'.repeat(64) };
    expect(parseTargetStorageNativeRequest(canonicalJson(base))).toEqual(base);
    expect(() => parseTargetStorageNativeRequest(canonicalJson({ ...base, path: '/tmp/escape' }))).toThrow();
    expect(parseTargetStorageNativeRequest(canonicalJson({ ...base, operation: 'QUARANTINE' }))).toMatchObject({ operation: 'QUARANTINE' });
    expect(() => parseTargetStorageNativeRequest(canonicalJson({ ...base, stopProofSha256: '4'.repeat(64) }))).toThrow();
  });

  it('matches the strict native canonical ledger line protocol', () => {
    const bytes = encodeTargetStorageNativeLedgerRecord({ sequence: '1', phase: 'INTENT', action: 'RETIRE_INTENT',
      stage: 'FILESYSTEM_ALLOCATED', installedIdentitySha256: 'a'.repeat(64), siteIdentitySha256: 'b'.repeat(64),
      hostIdentitySha256: 'c'.repeat(64), policySha256: 'd'.repeat(64), profileSha256: 'e'.repeat(64),
      specificationSha256: 'f'.repeat(64), evidenceContextSha256: '0'.repeat(64), targetSetSha256: '1'.repeat(64),
      nonce: '2'.repeat(64), basename: `t-${'1'.repeat(64)}-${'2'.repeat(64)}`, markerSha256: '3'.repeat(64),
      previousSha256: '4'.repeat(64), reservationIdSha256: '5'.repeat(64), reservationBytes: '100', reservationInodes: '10',
      requestSha256: '6'.repeat(64), bodySha256: '7'.repeat(64), authorizationSha256: '8'.repeat(64),
      sourceDev: '5', sourceIno: '6', sourceMountId: '7', activeDev: '8',
      activeIno: '9', activeMountId: '10', quarantineDev: '11', quarantineIno: '12', quarantineMountId: '13',
      destinationDev: '0', destinationIno: '0', destinationMountId: '0' });
    expect(bytes.includes(0)).toBe(false);
    expect(bytes.toString()).toContain('sequence=00000000000000000001\nphase=INTENT\naction=RETIRE_INTENT\n');
    expect(bytes.toString()).toMatch(/quarantine_mount_id=00000000000000000013\ndestination_dev=00000000000000000000\ndestination_ino=00000000000000000000\ndestination_mount_id=00000000000000000000\n$/);
  });

  it('verifies public signatures and hashes the full envelope', () => {
    const keys = generateKeyPairSync('ed25519');
    const evidence: TargetStorageEvidence = { format: 'darshan-recovery-host-policy-evidence-v1', kind: 'HOST_POLICY',
      ...binding, dependencies: [], hostMode: 'SPLIT_HOST', storageAuthorityIdentitySha256: '4'.repeat(64),
      evidenceRootSha256: '5'.repeat(64), allocationControlRootSha256: '6'.repeat(64), allowedFilesystems: ['ext4'] };
    const envelope = signed(evidence, keys.privateKey); const bytes = encodeSignedTargetStorageEvidence(envelope);
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyTargetStorageEvidence({ bytes, keys: new Map([['authority', publicKey]]),
      now: new Date('2026-10-29T01:00:00.000Z') })).toEqual(envelope);
    expect(targetStorageEvidenceEnvelopeSha256(envelope)).not.toBe(
      targetStorageEvidenceEnvelopeSha256({ ...envelope, signature: { ...envelope.signature, keyId: 'changed' } }));
    expect(() => verifyTargetStorageEvidence({ bytes, keys: new Map([['authority', publicKey]]),
      revokedKeyIds: new Set(['authority']), now: new Date('2026-10-29T01:00:00.000Z') })).toThrow(/revoked/);
  });

  it('loads the exact content-addressed five-document DAG and rejects renamed evidence', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'storage-evidence-')); roots.push(root); await fs.chmod(root, 0o700);
    const keys = generateKeyPairSync('ed25519'); const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const leafBase = { ...binding, dependencies: [] as [], evidenceId: randomUUID() };
    const leaves: TargetStorageEvidence[] = [
      { format: 'darshan-recovery-host-policy-evidence-v1', kind: 'HOST_POLICY', ...leafBase,
        hostMode: 'SPLIT_HOST', storageAuthorityIdentitySha256: '4'.repeat(64), evidenceRootSha256: '5'.repeat(64),
        allocationControlRootSha256: '6'.repeat(64), allowedFilesystems: ['ext4'] },
      { format: 'darshan-recovery-engine-profile-evidence-v1', kind: 'ENGINE_PROFILE', ...leafBase,
        postgresUid: '70', postgresGid: '70', minioUid: '71', minioGid: '71', allocationDirectoryMode: '0700',
        postgresDirectoryMode: '0700', minioDirectoryMode: '0700', requiredBytes: '100', requiredInodes: '10' },
      { format: 'darshan-recovery-storage-inventory-evidence-v1', kind: 'STORAGE_INVENTORY', ...leafBase,
        storageAuthorityIdentitySha256: '4'.repeat(64), roots: ['ACTIVE', 'QUARANTINE', 'POOL', 'CONTROL'].map((role, index) => ({
          role: role as 'ACTIVE' | 'QUARANTINE' | 'POOL' | 'CONTROL', pathIdentitySha256: String(index + 5).repeat(64),
          mountId: String(index + 1), mountParentId: '0', filesystemType: 'ext4' as const,
          filesystemUuid: `${index}123456789abcdef`, deviceMajor: '8', deviceMinor: String(index), readOnly: false as const,
          quotaStatus: 'DEDICATED_FILESYSTEM' as const })) },
      { format: 'darshan-recovery-protection-inventory-evidence-v1', kind: 'PROTECTION_INVENTORY', ...leafBase,
        protectedPathIdentitySha256: ['a'.repeat(64)], observedMountinfoSha256: 'b'.repeat(64) },
    ];
    const digests = new Map<string, string>();
    for (const leaf of leaves) { const envelope = signed(leaf, keys.privateKey); const digest = targetStorageEvidenceEnvelopeSha256(envelope);
      digests.set(leaf.kind, digest); await fs.writeFile(join(root, `${digest}.json`), encodeSignedTargetStorageEvidence(envelope), { mode: 0o600 }); }
    const dependencies = [...digests].map(([kind, envelopeSha256]) => ({ kind: kind as TargetStorageEvidence['kind'], envelopeSha256 }))
      .sort((left, right) => `${left.kind}:${left.envelopeSha256}`.localeCompare(`${right.kind}:${right.envelopeSha256}`));
    const capacity: TargetStorageEvidence = { format: 'darshan-recovery-capacity-evidence-v1', kind: 'CAPACITY_EVIDENCE',
      ...binding, evidenceId: randomUUID(), dependencies, hostPolicyEnvelopeSha256: digests.get('HOST_POLICY')!,
      engineProfileEnvelopeSha256: digests.get('ENGINE_PROFILE')!, storageInventoryEnvelopeSha256: digests.get('STORAGE_INVENTORY')!,
      protectionInventoryEnvelopeSha256: digests.get('PROTECTION_INVENTORY')!, allocationLedgerHeadSha256: 'c'.repeat(64),
      availableBytes: '1000', availableInodes: '100', fullOutstandingReservationBytes: '0',
      fullOutstandingReservationInodes: '0', requiredBytes: '100', requiredInodes: '10', remainingBytes: '1000',
      remainingInodes: '100', controlAvailableBytes: '100', controlAvailableInodes: '10' };
    const capacityEnvelope = signed(capacity, keys.privateKey); const capacitySha = targetStorageEvidenceEnvelopeSha256(capacityEnvelope);
    await fs.writeFile(join(root, `${capacitySha}.json`), encodeSignedTargetStorageEvidence(capacityEnvelope), { mode: 0o600 });
    const loader = new ProtectedTargetStorageEvidenceLoader({ root, expectedUid: process.getuid(), expectedGid: process.getgid(),
      keys: new Map([['authority', publicKey]]), now: () => new Date('2026-10-29T01:00:00.000Z') });
    await expect(loadVerifiedTargetStorageEvidenceDag({ loader, capacityEvidenceSha256: capacitySha, expected: binding })).resolves
      .toMatchObject({ capacityEvidence: { kind: 'CAPACITY_EVIDENCE' }, hostPolicy: { kind: 'HOST_POLICY' } });
    await fs.writeFile(join(root, `${'f'.repeat(64)}.json`), encodeSignedTargetStorageEvidence(capacityEnvelope), { mode: 0o600 });
    await expect(loader.load('f'.repeat(64))).rejects.toThrow(/content-addressed name/);
  });
});
