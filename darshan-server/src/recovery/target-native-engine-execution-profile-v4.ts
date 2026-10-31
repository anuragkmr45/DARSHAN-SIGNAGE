import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { targetAuthorityHandleSchema } from './target-engine-contracts';
import { parseInstalledEngineAssetsV1, type InstalledEngineAssetsV1 } from './target-native-engine-asset-manifest';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({
  format: z.literal('darshan-recovery-target-native-engine-execution-profile-v4'),
  targetHandle: targetAuthorityHandleSchema, generation: z.string().regex(/^[1-9][0-9]{0,19}$/),
  historicalProfileV2Sha256: digest, credentialProfileV3Sha256: digest,
  historicalResourceAdmissionV2Sha256: digest, credentialAdmissionReceiptSha256: digest,
  credentialUseWitnessSha256: digest, physicalAllocationIdentitySha256: digest,
  allocationLedgerHeadSha256: digest, installedAssetManifestSha256: digest,
  daemonCompatibilitySha256: digest, effectivePolicySha256: digest,
  backend: z.literal('FIXED_DOCKER_LOCAL_UNIX_V1'), availability: z.literal('UNAVAILABLE'),
  dispatchEnabled: z.literal(false), lifecycleEnabled: z.literal(false),
  profileSha256: digest,
}).strict();
const admissionSchema = z.object({
  format: z.literal('darshan-recovery-target-backend-resource-admission-v3'),
  targetHandle: targetAuthorityHandleSchema, generation: z.string().regex(/^[1-9][0-9]{0,19}$/),
  executionProfileV4Sha256: digest, installedAssetManifestSha256: digest,
  credentialAdmissionReceiptSha256: digest, credentialUseWitnessSha256: digest,
  physicalAllocationIdentitySha256: digest, allocationLedgerHeadSha256: digest,
  daemonCompatibilitySha256: digest, effectivePolicySha256: digest,
  status: z.literal('UNAVAILABLE'), materializationEnabled: z.literal(false), lifecycleEnabled: z.literal(false),
  admissionSha256: digest,
}).strict();
export type TargetNativeEngineExecutionProfileV4 = z.infer<typeof schema>;
export type TargetBackendResourceAdmissionV3 = z.infer<typeof admissionSchema>;

function hash(domain: string, value: object): string {
  return createHash('sha256').update(Buffer.from(`${domain}\0`)).update(canonicalJson(value)).digest('hex');
}
function without<T extends Record<string, unknown>>(value: T, key: keyof T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}
export function targetNativeEngineExecutionProfileV4Sha256(value: Omit<TargetNativeEngineExecutionProfileV4, 'profileSha256'> | TargetNativeEngineExecutionProfileV4): string {
  return hash('darshan-recovery-target-native-engine-execution-profile-v4', 'profileSha256' in value ? without(value, 'profileSha256') : value);
}
export function targetBackendResourceAdmissionV3Sha256(value: Omit<TargetBackendResourceAdmissionV3, 'admissionSha256'> | TargetBackendResourceAdmissionV3): string {
  return hash('darshan-recovery-target-backend-resource-admission-v3', 'admissionSha256' in value ? without(value, 'admissionSha256') : value);
}
function validateProfile(value: TargetNativeEngineExecutionProfileV4, assets?: InstalledEngineAssetsV1): void {
  if (value.profileSha256 !== targetNativeEngineExecutionProfileV4Sha256(value) ||
      (assets && value.installedAssetManifestSha256 !== assets.manifestSha256)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Execution profile v4 self-hash or installed asset binding differs.');
  }
}
export function encodeTargetNativeEngineExecutionProfileV4(value: TargetNativeEngineExecutionProfileV4, assets?: InstalledEngineAssetsV1): Buffer {
  const parsed = schema.parse(value); validateProfile(parsed, assets); return canonicalJson(parsed);
}
export function parseTargetNativeEngineExecutionProfileV4(bytes: Uint8Array, installedAssetsBytes?: Uint8Array): TargetNativeEngineExecutionProfileV4 {
  try {
    const source = Buffer.from(bytes); if (source.byteLength > 64 * 1024) throw new Error('oversize');
    const value = schema.parse(parseStrictJson(source, 64 * 1024));
    validateProfile(value, installedAssetsBytes ? parseInstalledEngineAssetsV1(installedAssetsBytes) : undefined);
    if (!encodeTargetNativeEngineExecutionProfileV4(value).equals(source)) throw new Error('noncanonical'); return value;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Execution profile v4 is not strict canonical bounded JSON.', { cause });
  }
}
export function encodeTargetBackendResourceAdmissionV3(value: TargetBackendResourceAdmissionV3, profile: TargetNativeEngineExecutionProfileV4): Buffer {
  const parsed = admissionSchema.parse(value);
  if (parsed.admissionSha256 !== targetBackendResourceAdmissionV3Sha256(parsed) ||
      parsed.executionProfileV4Sha256 !== profile.profileSha256 || parsed.targetHandle !== profile.targetHandle ||
      parsed.generation !== profile.generation || parsed.installedAssetManifestSha256 !== profile.installedAssetManifestSha256 ||
      parsed.credentialAdmissionReceiptSha256 !== profile.credentialAdmissionReceiptSha256 ||
      parsed.credentialUseWitnessSha256 !== profile.credentialUseWitnessSha256 ||
      parsed.physicalAllocationIdentitySha256 !== profile.physicalAllocationIdentitySha256 ||
      parsed.allocationLedgerHeadSha256 !== profile.allocationLedgerHeadSha256 ||
      parsed.daemonCompatibilitySha256 !== profile.daemonCompatibilitySha256 ||
      parsed.effectivePolicySha256 !== profile.effectivePolicySha256) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Resource admission v3 differs from execution profile v4.');
  }
  return canonicalJson(parsed);
}
