import { join, resolve } from 'node:path';
import { RecoveryError } from './errors';
import { readProtectedOperatorFile, type ProtectedOperatorReadHooks } from './operator-inputs';
import {
  targetStorageEvidenceV2EnvelopeSha256,
  verifyTargetStorageEvidenceV2,
  type CapacityEvidenceV2,
  type EngineProfileEvidenceV2,
  type HostPolicyEvidenceV2,
  type ProtectionInventoryEvidenceV2,
  type SignedTargetStorageEvidenceV2,
  type StorageInventoryEvidenceV2,
  type TargetStorageStableEvidenceKind,
} from './target-storage-contracts-v2';

export interface TargetStorageEvidenceBindingV2 {
  siteId: string;
  hostInstallationId: string;
  operationId: string;
  generation: string;
  targetReleaseIdentitySha256: string;
  targetLogicalIdentitySha256: string;
  topologyMode: 'SINGLE_HOST' | 'SPLIT_HOST';
  hostPolicyEnvelopeSha256: string;
  engineProfileEnvelopeSha256: string;
  storageInventoryEnvelopeSha256: string;
  protectionInventoryEnvelopeSha256: string;
}

export interface VerifiedTargetStorageEvidenceDagV2 {
  hostPolicy: HostPolicyEvidenceV2;
  engineProfile: EngineProfileEvidenceV2;
  storageInventory: StorageInventoryEvidenceV2;
  protectionInventory: ProtectionInventoryEvidenceV2;
  capacityEvidence: CapacityEvidenceV2;
  envelopeSha256: Readonly<Record<TargetStorageStableEvidenceKind | 'CAPACITY_EVIDENCE', string>>;
}

export class ProtectedTargetStorageEvidenceLoaderV2 {
  constructor(private readonly options: {
    root: string; expectedUid: number; expectedGid: number; keys: ReadonlyMap<string, string>;
    revokedKeyIds?: ReadonlySet<string>; revokedEnvelopeSha256?: ReadonlySet<string>;
    now?: () => Date; hooks?: ProtectedOperatorReadHooks;
  }) {
    if (!this.options.root.startsWith('/') || resolve(this.options.root) !== this.options.root || this.options.root === '/') {
      throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Storage evidence root must be a canonical absolute directory.');
    }
  }

  async load(envelopeSha256: string, signal?: AbortSignal): Promise<SignedTargetStorageEvidenceV2> {
    if (!/^[a-f0-9]{64}$/.test(envelopeSha256)) {
      throw new RecoveryError('RECOVERY_DIGEST_INVALID', 'Storage evidence name must be a lowercase SHA-256 digest.');
    }
    const bytes = await readProtectedOperatorFile({ path: join(this.options.root, `${envelopeSha256}.json`),
      maximumBytes: 64 * 1024, expectedUid: this.options.expectedUid, expectedGid: this.options.expectedGid,
      hooks: this.options.hooks, signal });
    const envelope = verifyTargetStorageEvidenceV2({ bytes, keys: this.options.keys,
      revokedKeyIds: this.options.revokedKeyIds, revokedEnvelopeSha256: this.options.revokedEnvelopeSha256,
      now: this.options.now?.() });
    if (targetStorageEvidenceV2EnvelopeSha256(envelope) !== envelopeSha256) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Storage evidence v2 content does not match its content-addressed name.');
    }
    return envelope;
  }
}

function stableBinding(value: SignedTargetStorageEvidenceV2, expected: TargetStorageEvidenceBindingV2): void {
  const evidence = value.evidence;
  if (evidence.kind === 'CAPACITY_EVIDENCE' || evidence.siteId !== expected.siteId ||
      evidence.hostInstallationId !== expected.hostInstallationId ||
      evidence.targetReleaseIdentitySha256 !== expected.targetReleaseIdentitySha256 ||
      evidence.targetLogicalIdentitySha256 !== expected.targetLogicalIdentitySha256) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Stable evidence v2 does not bind the exact site, host, release, and logical target.');
  }
}

export async function loadVerifiedTargetStorageEvidenceDagV2(input: {
  loader: ProtectedTargetStorageEvidenceLoaderV2;
  capacityEvidenceEnvelopeSha256: string;
  expected: TargetStorageEvidenceBindingV2;
  signal?: AbortSignal;
}): Promise<VerifiedTargetStorageEvidenceDagV2> {
  input.signal?.throwIfAborted();
  const capacityEnvelope = await input.loader.load(input.capacityEvidenceEnvelopeSha256, input.signal);
  if (capacityEnvelope.evidence.kind !== 'CAPACITY_EVIDENCE') {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Capacity evidence v2 root has the wrong kind.');
  }
  const capacity = capacityEnvelope.evidence;
  const expected = input.expected;
  if (capacity.siteId !== expected.siteId || capacity.hostInstallationId !== expected.hostInstallationId ||
      capacity.operationId !== expected.operationId || capacity.generation !== expected.generation ||
      capacity.targetReleaseIdentitySha256 !== expected.targetReleaseIdentitySha256 ||
      capacity.targetLogicalIdentitySha256 !== expected.targetLogicalIdentitySha256) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Capacity evidence v2 does not bind the exact operation, generation, host, release, and logical target.');
  }
  const named = {
    HOST_POLICY: expected.hostPolicyEnvelopeSha256,
    ENGINE_PROFILE: expected.engineProfileEnvelopeSha256,
    STORAGE_INVENTORY: expected.storageInventoryEnvelopeSha256,
    PROTECTION_INVENTORY: expected.protectionInventoryEnvelopeSha256,
  } as const;
  if (capacity.hostPolicyEnvelopeSha256 !== named.HOST_POLICY ||
      capacity.engineProfileEnvelopeSha256 !== named.ENGINE_PROFILE ||
      capacity.storageInventoryEnvelopeSha256 !== named.STORAGE_INVENTORY ||
      capacity.protectionInventoryEnvelopeSha256 !== named.PROTECTION_INVENTORY) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Capacity evidence v2 does not bind the exact four stable signed envelopes.');
  }
  if (Object.values(named).some((digest) => capacity.revokedEnvelopeSha256.includes(digest))) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_REVOKED', 'Capacity evidence v2 revokes one of its stable dependencies.');
  }
  const loaded = await Promise.all((Object.entries(named) as [keyof typeof named, string][]).map(async ([kind, sha256]) => {
    const envelope = await input.loader.load(sha256, input.signal);
    if (envelope.evidence.kind !== kind) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Stable evidence v2 kind mismatch.');
    }
    stableBinding(envelope, expected);
    if (Date.parse(envelope.evidence.issuedAt) > Date.parse(capacity.issuedAt) ||
        Date.parse(envelope.evidence.expiresAt) < Date.parse(capacity.expiresAt) ||
        envelope.evidence.revokedEnvelopeSha256.includes(input.capacityEvidenceEnvelopeSha256) ||
        Object.values(named).some((digest) => envelope.evidence.revokedEnvelopeSha256.includes(digest))) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Evidence v2 time or revocation order is invalid.');
    }
    return [kind, envelope] as const;
  }));
  const byKind = new Map(loaded);
  const hostPolicy = byKind.get('HOST_POLICY')!.evidence as HostPolicyEvidenceV2;
  const engineProfile = byKind.get('ENGINE_PROFILE')!.evidence as EngineProfileEvidenceV2;
  const storageInventory = byKind.get('STORAGE_INVENTORY')!.evidence as StorageInventoryEvidenceV2;
  const protectionInventory = byKind.get('PROTECTION_INVENTORY')!.evidence as ProtectionInventoryEvidenceV2;
  if (hostPolicy.storageAuthorityIdentitySha256 !== storageInventory.storageAuthorityIdentitySha256 ||
      capacity.requiredBytes !== engineProfile.requiredBytes || capacity.requiredInodes !== engineProfile.requiredInodes) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Evidence v2 authority identities or requirements disagree.');
  }
  const availableBytes = BigInt(capacity.availableBytes); const availableInodes = BigInt(capacity.availableInodes);
  const reservedBytes = BigInt(capacity.fullOutstandingReservationBytes);
  const reservedInodes = BigInt(capacity.fullOutstandingReservationInodes);
  const remainingBytes = availableBytes >= reservedBytes ? availableBytes - reservedBytes : 0n;
  const remainingInodes = availableInodes >= reservedInodes ? availableInodes - reservedInodes : 0n;
  if (capacity.remainingBytes !== String(remainingBytes) || capacity.remainingInodes !== String(remainingInodes) ||
      remainingBytes < BigInt(capacity.requiredBytes) || remainingInodes < BigInt(capacity.requiredInodes)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Capacity evidence v2 arithmetic is not conservative.');
  }
  return Object.freeze({ hostPolicy, engineProfile, storageInventory, protectionInventory, capacityEvidence: capacity,
    envelopeSha256: Object.freeze({ ...named, CAPACITY_EVIDENCE: input.capacityEvidenceEnvelopeSha256 }) });
}
