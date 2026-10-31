import { join, resolve } from 'node:path';
import { readProtectedOperatorFile, type ProtectedOperatorReadHooks } from './operator-inputs';
import { RecoveryError } from './errors';
import { targetStorageEvidenceEnvelopeSha256, verifyTargetStorageEvidence,
  type CapacityEvidence, type EngineProfileEvidence, type HostPolicyEvidence,
  type ProtectionInventoryEvidence, type SignedTargetStorageEvidence, type StorageInventoryEvidence,
  type TargetStorageEvidenceKind } from './target-storage-contracts';

export interface TargetStorageEvidenceBinding {
  siteId: string;
  hostInstallationId: string;
  operationId: string;
  generation: string;
  targetSetId: string;
  targetSpecificationSha256: string;
  targetReleaseIdentitySha256: string;
}

export interface VerifiedTargetStorageEvidenceDag {
  hostPolicy: HostPolicyEvidence;
  engineProfile: EngineProfileEvidence;
  storageInventory: StorageInventoryEvidence;
  protectionInventory: ProtectionInventoryEvidence;
  capacityEvidence: CapacityEvidence;
  envelopeSha256: Readonly<Record<TargetStorageEvidenceKind, string>>;
}

export class ProtectedTargetStorageEvidenceLoader {
  constructor(private readonly options: {
    root: string;
    expectedUid: number;
    expectedGid: number;
    keys: ReadonlyMap<string, string>;
    revokedKeyIds?: ReadonlySet<string>;
    revokedEnvelopeSha256?: ReadonlySet<string>;
    now?: () => Date;
    hooks?: ProtectedOperatorReadHooks;
  }) {
    if (!this.options.root.startsWith('/') || resolve(this.options.root) !== this.options.root || this.options.root === '/') {
      throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Storage evidence root must be a canonical absolute directory.');
    }
  }

  async load(envelopeSha256: string, signal?: AbortSignal): Promise<SignedTargetStorageEvidence> {
    if (!/^[a-f0-9]{64}$/.test(envelopeSha256)) {
      throw new RecoveryError('RECOVERY_DIGEST_INVALID', 'Storage evidence name must be a lowercase SHA-256 digest.');
    }
    const path = join(this.options.root, `${envelopeSha256}.json`);
    const bytes = await readProtectedOperatorFile({ path, maximumBytes: 64 * 1024,
      expectedUid: this.options.expectedUid, expectedGid: this.options.expectedGid,
      hooks: this.options.hooks, signal });
    const envelope = verifyTargetStorageEvidence({ bytes, keys: this.options.keys,
      revokedKeyIds: this.options.revokedKeyIds, revokedEnvelopeSha256: this.options.revokedEnvelopeSha256,
      now: this.options.now?.() });
    if (targetStorageEvidenceEnvelopeSha256(envelope) !== envelopeSha256) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Storage evidence content does not match its content-addressed name.');
    }
    return envelope;
  }
}

function assertBinding(envelope: SignedTargetStorageEvidence, expected: TargetStorageEvidenceBinding): void {
  const value = envelope.evidence;
  if (value.siteId !== expected.siteId || value.hostInstallationId !== expected.hostInstallationId ||
      value.operationId !== expected.operationId || value.generation !== expected.generation ||
      value.targetSetId !== expected.targetSetId || value.targetSpecificationSha256 !== expected.targetSpecificationSha256 ||
      value.targetReleaseIdentitySha256 !== expected.targetReleaseIdentitySha256) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Storage evidence does not bind the exact site, host, operation, generation, release, specification, and target set.');
  }
}

function dependencyMap(value: SignedTargetStorageEvidence): Map<TargetStorageEvidenceKind, string> {
  return new Map(value.evidence.dependencies.map((dependency) => [dependency.kind, dependency.envelopeSha256]));
}

export async function loadVerifiedTargetStorageEvidenceDag(input: {
  loader: ProtectedTargetStorageEvidenceLoader;
  capacityEvidenceSha256: string;
  expected: TargetStorageEvidenceBinding;
  signal?: AbortSignal;
}): Promise<VerifiedTargetStorageEvidenceDag> {
  input.signal?.throwIfAborted();
  const capacityEnvelope = await input.loader.load(input.capacityEvidenceSha256, input.signal);
  if (capacityEnvelope.evidence.kind !== 'CAPACITY_EVIDENCE') {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Capacity evidence root has the wrong evidence kind.');
  }
  assertBinding(capacityEnvelope, input.expected);
  const capacity = capacityEnvelope.evidence;
  const named = {
    HOST_POLICY: capacity.hostPolicyEnvelopeSha256,
    ENGINE_PROFILE: capacity.engineProfileEnvelopeSha256,
    STORAGE_INVENTORY: capacity.storageInventoryEnvelopeSha256,
    PROTECTION_INVENTORY: capacity.protectionInventoryEnvelopeSha256,
  } as const;
  const declared = dependencyMap(capacityEnvelope);
  if (declared.size !== 4 || Object.entries(named).some(([kind, digest]) => declared.get(kind as TargetStorageEvidenceKind) !== digest)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Capacity evidence does not declare its exact four evidence dependencies.');
  }
  if (Object.values(named).some((digest) => capacity.revokedEnvelopeSha256.includes(digest))) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_REVOKED', 'Capacity evidence revokes one of its own dependencies.');
  }
  const loaded = await Promise.all((Object.entries(named) as [keyof typeof named, string][]).map(async ([kind, sha256]) => {
    const envelope = await input.loader.load(sha256, input.signal);
    if (envelope.evidence.kind !== kind) throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Storage evidence DAG kind mismatch.');
    assertBinding(envelope, input.expected);
    if (envelope.evidence.dependencies.length !== 0) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Storage evidence DAG contains an undeclared edge or cycle.');
    }
    if (Date.parse(envelope.evidence.issuedAt) > Date.parse(capacity.issuedAt) ||
        Date.parse(envelope.evidence.expiresAt) < Date.parse(capacity.expiresAt) ||
        envelope.evidence.revokedEnvelopeSha256.includes(input.capacityEvidenceSha256) ||
        Object.values(named).some((digest) => envelope.evidence.revokedEnvelopeSha256.includes(digest))) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Storage evidence DAG time or revocation order is invalid.');
    }
    return [kind, envelope] as const;
  }));
  const byKind = new Map(loaded);
  const hostPolicy = byKind.get('HOST_POLICY')!.evidence as HostPolicyEvidence;
  const engineProfile = byKind.get('ENGINE_PROFILE')!.evidence as EngineProfileEvidence;
  const storageInventory = byKind.get('STORAGE_INVENTORY')!.evidence as StorageInventoryEvidence;
  const protectionInventory = byKind.get('PROTECTION_INVENTORY')!.evidence as ProtectionInventoryEvidence;
  if (hostPolicy.storageAuthorityIdentitySha256 !== storageInventory.storageAuthorityIdentitySha256 ||
      capacity.requiredBytes !== engineProfile.requiredBytes || capacity.requiredInodes !== engineProfile.requiredInodes) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Storage evidence DAG identities or requirements disagree.');
  }
  const availableBytes = BigInt(capacity.availableBytes); const availableInodes = BigInt(capacity.availableInodes);
  const reservedBytes = BigInt(capacity.fullOutstandingReservationBytes);
  const reservedInodes = BigInt(capacity.fullOutstandingReservationInodes);
  const remainingBytes = availableBytes >= reservedBytes ? availableBytes - reservedBytes : 0n;
  const remainingInodes = availableInodes >= reservedInodes ? availableInodes - reservedInodes : 0n;
  if (capacity.remainingBytes !== String(remainingBytes) || capacity.remainingInodes !== String(remainingInodes) ||
      remainingBytes < BigInt(capacity.requiredBytes) || remainingInodes < BigInt(capacity.requiredInodes)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Capacity evidence arithmetic or admission result is not conservative.');
  }
  const envelopeSha256 = Object.freeze({ ...named, CAPACITY_EVIDENCE: input.capacityEvidenceSha256 });
  return Object.freeze({ hostPolicy, engineProfile, storageInventory, protectionInventory,
    capacityEvidence: capacity, envelopeSha256 });
}

