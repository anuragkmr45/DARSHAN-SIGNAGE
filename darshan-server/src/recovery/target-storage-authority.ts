import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { type TargetHelperRequest } from './target-helper-protocol';
import { loadVerifiedTargetStorageEvidenceDag, type ProtectedTargetStorageEvidenceLoader,
  type TargetStorageEvidenceBinding, type VerifiedTargetStorageEvidenceDag } from './target-storage-evidence';
import { loadVerifiedTargetStorageEvidenceDagV2, type ProtectedTargetStorageEvidenceLoaderV2,
  type TargetStorageEvidenceBindingV2, type VerifiedTargetStorageEvidenceDagV2 } from './target-storage-evidence-v2';

export const RECOVERY_TARGET_INSTALLED_IDENTITY_V1 = 'darshan-recovery-target-helper-installation-v1' as const;
export const RECOVERY_TARGET_INSTALLED_IDENTITY_V2 = 'darshan-recovery-target-helper-installation-v2' as const;
export const TARGET_STORAGE_NATIVE_OPERATIONS = ['VALIDATE', 'RESERVE_ALLOCATE', 'INSPECT', 'QUARANTINE'] as const;
export type TargetStorageNativeOperation = typeof TARGET_STORAGE_NATIVE_OPERATIONS[number];
export const TARGET_STORAGE_COMPONENTS = ['POSTGRES', 'MINIO'] as const;
export type TargetStorageComponent = typeof TARGET_STORAGE_COMPONENTS[number];

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const common = { siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/), hostInstallationId: uuid,
  hostPolicySha256: digest, helperRoleSha256: digest, engineProfileSha256: digest, specificationRootSha256: digest };
const identityV1Schema = z.object({ format: z.literal(RECOVERY_TARGET_INSTALLED_IDENTITY_V1), ...common }).strict();
const identityV2Schema = z.object({
  format: z.literal(RECOVERY_TARGET_INSTALLED_IDENTITY_V2), ...common,
  evidenceRootSha256: digest,
  allocationLedgerRootSha256: digest,
  allocationControlRootSha256: digest,
  activeRootSha256: digest,
  quarantineRootSha256: digest,
  poolRootSha256: digest,
  storageAuthorityIdentitySha256: digest,
  hostMode: z.enum(['SINGLE_HOST', 'SPLIT_HOST']),
}).strict();
const installedIdentitySchema = z.discriminatedUnion('format', [identityV1Schema, identityV2Schema]);
export type RecoveryTargetInstalledIdentityAny = z.infer<typeof installedIdentitySchema>;
export type RecoveryTargetInstalledIdentityV2 = z.infer<typeof identityV2Schema>;

export function parseRecoveryTargetInstalledIdentity(bytes: Uint8Array): RecoveryTargetInstalledIdentityAny {
  try {
    const source = Buffer.from(bytes); const value = installedIdentitySchema.parse(parseStrictJson(source, 8192));
    if (!canonicalJson(value).equals(source)) throw new Error('non-canonical installed identity');
    return value;
  } catch (cause) {
    throw new RecoveryError('RECOVERY_INPUT_INVALID', 'Installed target identity is not strict canonical v1/v2 JSON.', { cause });
  }
}

export function requireEffectEligibleInstalledIdentity(value: RecoveryTargetInstalledIdentityAny): RecoveryTargetInstalledIdentityV2 {
  if (value.format !== RECOVERY_TARGET_INSTALLED_IDENTITY_V2) {
    throw new RecoveryError('RECOVERY_TARGET_UNSUPPORTED', 'Historical installed identity v1 is readable but effect-ineligible.');
  }
  return value;
}

const verifiedBrand: unique symbol = Symbol('VerifiedTargetStorageContext');
export interface VerifiedTargetStorageContext {
  readonly [verifiedBrand]: true;
  readonly installedIdentity: RecoveryTargetInstalledIdentityV2;
  readonly evidence: VerifiedTargetStorageEvidenceDag;
  readonly verifiedAt: string;
}

export interface VerifiedTargetStorageContextV2 {
  readonly [verifiedBrand]: true;
  readonly installedIdentity: RecoveryTargetInstalledIdentityV2;
  readonly evidence: VerifiedTargetStorageEvidenceDagV2;
  readonly verifiedAt: string;
}

export async function verifyTargetStorageContextForLockedGateway(input: {
  installedIdentity: RecoveryTargetInstalledIdentityAny;
  loader: ProtectedTargetStorageEvidenceLoader;
  capacityEvidenceSha256: string;
  expected: TargetStorageEvidenceBinding;
  now?: Date;
  signal?: AbortSignal;
}): Promise<VerifiedTargetStorageContext> {
  const installed = requireEffectEligibleInstalledIdentity(input.installedIdentity);
  const evidence = await loadVerifiedTargetStorageEvidenceDag({ loader: input.loader,
    capacityEvidenceSha256: input.capacityEvidenceSha256, expected: input.expected, signal: input.signal });
  if (evidence.hostPolicy.evidenceRootSha256 !== installed.evidenceRootSha256 ||
      evidence.hostPolicy.allocationControlRootSha256 !== installed.allocationControlRootSha256 ||
      evidence.hostPolicy.storageAuthorityIdentitySha256 !== installed.storageAuthorityIdentitySha256 ||
      evidence.hostPolicy.hostMode !== installed.hostMode ||
      evidence.storageInventory.storageAuthorityIdentitySha256 !== installed.storageAuthorityIdentitySha256 ||
      evidence.storageInventory.roots.find((root) => root.role === 'ACTIVE')?.pathIdentitySha256 !== installed.activeRootSha256 ||
      evidence.storageInventory.roots.find((root) => root.role === 'QUARANTINE')?.pathIdentitySha256 !== installed.quarantineRootSha256 ||
      evidence.storageInventory.roots.find((root) => root.role === 'POOL')?.pathIdentitySha256 !== installed.poolRootSha256 ||
      evidence.storageInventory.roots.find((root) => root.role === 'CONTROL')?.pathIdentitySha256 !== installed.allocationControlRootSha256 ||
      evidence.storageInventory.roots.some((root) => !evidence.hostPolicy.allowedFilesystems.includes(root.filesystemType))) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Verified storage evidence differs from installed identity v2.');
  }
  return Object.freeze({ [verifiedBrand]: true as const, installedIdentity: installed, evidence,
    verifiedAt: (input.now ?? new Date()).toISOString() });
}

export async function verifyTargetStorageContextV2ForLockedGateway(input: {
  installedIdentity: RecoveryTargetInstalledIdentityAny;
  loader: ProtectedTargetStorageEvidenceLoaderV2;
  capacityEvidenceEnvelopeSha256: string;
  expected: TargetStorageEvidenceBindingV2;
  now?: Date;
  signal?: AbortSignal;
}): Promise<VerifiedTargetStorageContextV2> {
  const installed = requireEffectEligibleInstalledIdentity(input.installedIdentity);
  const evidence = await loadVerifiedTargetStorageEvidenceDagV2({ loader: input.loader,
    capacityEvidenceEnvelopeSha256: input.capacityEvidenceEnvelopeSha256, expected: input.expected, signal: input.signal });
  if (input.expected.hostPolicyEnvelopeSha256 !== installed.hostPolicySha256 ||
      input.expected.engineProfileEnvelopeSha256 !== installed.engineProfileSha256 ||
      evidence.hostPolicy.evidenceRootSha256 !== installed.evidenceRootSha256 ||
      evidence.hostPolicy.allocationControlRootSha256 !== installed.allocationControlRootSha256 ||
      evidence.hostPolicy.storageAuthorityIdentitySha256 !== installed.storageAuthorityIdentitySha256 ||
      evidence.hostPolicy.hostMode !== installed.hostMode || evidence.hostPolicy.hostMode !== input.expected.topologyMode ||
      evidence.storageInventory.storageAuthorityIdentitySha256 !== installed.storageAuthorityIdentitySha256 ||
      evidence.storageInventory.roots.find((root) => root.role === 'ACTIVE')?.pathIdentitySha256 !== installed.activeRootSha256 ||
      evidence.storageInventory.roots.find((root) => root.role === 'QUARANTINE')?.pathIdentitySha256 !== installed.quarantineRootSha256 ||
      evidence.storageInventory.roots.find((root) => root.role === 'POOL')?.pathIdentitySha256 !== installed.poolRootSha256 ||
      evidence.storageInventory.roots.find((root) => root.role === 'CONTROL')?.pathIdentitySha256 !== installed.allocationControlRootSha256 ||
      evidence.storageInventory.roots.some((root) => !evidence.hostPolicy.allowedFilesystems.includes(root.filesystemType))) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Verified acyclic storage evidence differs from installed identity v2.');
  }
  return Object.freeze({ [verifiedBrand]: true as const, installedIdentity: installed, evidence,
    verifiedAt: (input.now ?? new Date()).toISOString() });
}

export interface RecoveryTargetEngineCallContext {
  request: Readonly<TargetHelperRequest>;
  requestBody: Uint8Array;
  authorizationSha256: string;
  deadline: Date;
  signal: AbortSignal;
  storage?: VerifiedTargetStorageContext | VerifiedTargetStorageContextV2;
  /** Gateway-produced synchronous re-verification of signed authorization, attestation, and evidence freshness. */
  assertFresh?: () => void;
}

export interface TargetStorageNativeRequest {
  format: 'darshan-recovery-target-storage-native-v1';
  operation: TargetStorageNativeOperation;
  targetSetId: string;
  generation: string;
  requestNonce: string;
  component: TargetStorageComponent | null;
  expectedLedgerHeadSha256: string;
}

const nativeLedgerRecordSchema = z.object({
  sequence: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
  phase: z.enum(['INTENT', 'RECEIPT']), action: z.enum(['ALLOCATE', 'RETIRE_INTENT']),
  stage: z.enum(['ALLOCATING', 'FILESYSTEM_ALLOCATED', 'QUARANTINED']),
  installedIdentitySha256: digest, siteIdentitySha256: digest, hostIdentitySha256: digest, policySha256: digest,
  profileSha256: digest, specificationSha256: digest, evidenceContextSha256: digest,
  targetSetSha256: digest, nonce: digest, basename: z.string().regex(/^t-[a-f0-9]{64}-[a-f0-9]{64}$/), markerSha256: digest, previousSha256: digest,
  reservationIdSha256: digest, reservationBytes: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/), reservationInodes: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
  requestSha256: digest, bodySha256: digest, authorizationSha256: digest,
  sourceDev: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/), sourceIno: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
  sourceMountId: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/), activeDev: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
  activeIno: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/), activeMountId: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
  quarantineDev: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/), quarantineIno: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
  quarantineMountId: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
  destinationDev: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/), destinationIno: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
  destinationMountId: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
}).strict();
export type TargetStorageNativeLedgerRecord = z.infer<typeof nativeLedgerRecordSchema>;

export function encodeTargetStorageNativeLedgerRecord(input: TargetStorageNativeLedgerRecord): Buffer {
  const value = nativeLedgerRecordSchema.parse(input); const pad = (field: string): string => field.padStart(20, '0');
  const text = `format=darshan-target-storage-ledger-v1\nsequence=${pad(value.sequence)}\nphase=${value.phase}\naction=${value.action}\nstage=${value.stage}\ninstalled_identity_sha256=${value.installedIdentitySha256}\nsite_identity_sha256=${value.siteIdentitySha256}\nhost_identity_sha256=${value.hostIdentitySha256}\npolicy_sha256=${value.policySha256}\nprofile_sha256=${value.profileSha256}\nspecification_sha256=${value.specificationSha256}\nevidence_context_sha256=${value.evidenceContextSha256}\ntarget_set_sha256=${value.targetSetSha256}\nnonce=${value.nonce}\nbasename=${value.basename}\nmarker_sha256=${value.markerSha256}\nprevious_sha256=${value.previousSha256}\nreservation_id_sha256=${value.reservationIdSha256}\nreservation_bytes=${pad(value.reservationBytes)}\nreservation_inodes=${pad(value.reservationInodes)}\nrequest_sha256=${value.requestSha256}\nbody_sha256=${value.bodySha256}\nauthorization_sha256=${value.authorizationSha256}\nsource_dev=${pad(value.sourceDev)}\nsource_ino=${pad(value.sourceIno)}\nsource_mount_id=${pad(value.sourceMountId)}\nactive_dev=${pad(value.activeDev)}\nactive_ino=${pad(value.activeIno)}\nactive_mount_id=${pad(value.activeMountId)}\nquarantine_dev=${pad(value.quarantineDev)}\nquarantine_ino=${pad(value.quarantineIno)}\nquarantine_mount_id=${pad(value.quarantineMountId)}\ndestination_dev=${pad(value.destinationDev)}\ndestination_ino=${pad(value.destinationIno)}\ndestination_mount_id=${pad(value.destinationMountId)}\n`;
  return Buffer.from(text, 'ascii');
}

const nativeRequestSchema = z.object({
  format: z.literal('darshan-recovery-target-storage-native-v1'), operation: z.enum(TARGET_STORAGE_NATIVE_OPERATIONS),
  targetSetId: digest, generation: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/),
  requestNonce: z.string().regex(/^[a-f0-9]{64}$/), component: z.enum(TARGET_STORAGE_COMPONENTS).nullable(),
  expectedLedgerHeadSha256: digest,
}).strict();

export function parseTargetStorageNativeRequest(bytes: Uint8Array): TargetStorageNativeRequest {
  try {
    const source = Buffer.from(bytes); const value = nativeRequestSchema.parse(parseStrictJson(source, 4096));
    if (!canonicalJson(value).equals(source)) throw new Error('non-canonical native storage request');
    return value;
  } catch (cause) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native storage request is not strict fixed-enum canonical JSON.', { cause });
  }
}

const U64_MAX = 0xffff_ffff_ffff_ffffn;
function checkedU64(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]{0,19})$/.test(value)) throw new RecoveryError('RECOVERY_STATE_INVALID', `${label} is not a canonical u64.`);
  const parsed = BigInt(value); if (parsed > U64_MAX) throw new RecoveryError('RECOVERY_STATE_INVALID', `${label} exceeds u64.`);
  return parsed;
}
function checkedMul(left: bigint, right: bigint): bigint {
  const value = left * right; if (value > U64_MAX) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Capacity multiplication overflows u64.');
  return value;
}
function checkedAdd(left: bigint, right: bigint): bigint {
  const value = left + right; if (value > U64_MAX) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Capacity addition overflows u64.');
  return value;
}

export function calculateFullOutstandingCapacity(input: {
  fBavail: string; fFrsize: string; fFavail: string;
  outstandingReservationBytes: readonly string[];
  outstandingReservationInodes: readonly string[];
  requiredBytes: string; requiredInodes: string;
}): { availableBytes: string; availableInodes: string; fullOutstandingReservationBytes: string;
  fullOutstandingReservationInodes: string; remainingBytes: string; remainingInodes: string; admitted: boolean } {
  const availableBytes = checkedMul(checkedU64(input.fBavail, 'f_bavail'), checkedU64(input.fFrsize, 'f_frsize'));
  const availableInodes = checkedU64(input.fFavail, 'f_favail');
  const reservedBytes = input.outstandingReservationBytes.reduce((sum, value) => checkedAdd(sum, checkedU64(value, 'reserved bytes')), 0n);
  const reservedInodes = input.outstandingReservationInodes.reduce((sum, value) => checkedAdd(sum, checkedU64(value, 'reserved inodes')), 0n);
  const remainingBytes = availableBytes >= reservedBytes ? availableBytes - reservedBytes : 0n;
  const remainingInodes = availableInodes >= reservedInodes ? availableInodes - reservedInodes : 0n;
  const requiredBytes = checkedU64(input.requiredBytes, 'required bytes');
  const requiredInodes = checkedU64(input.requiredInodes, 'required inodes');
  return { availableBytes: String(availableBytes), availableInodes: String(availableInodes),
    fullOutstandingReservationBytes: String(reservedBytes), fullOutstandingReservationInodes: String(reservedInodes),
    remainingBytes: String(remainingBytes), remainingInodes: String(remainingInodes),
    admitted: remainingBytes >= requiredBytes && remainingInodes >= requiredInodes };
}

