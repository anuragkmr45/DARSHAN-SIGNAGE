import { createHash } from 'node:crypto';
import { RecoveryError } from './errors';

export const TARGET_NATIVE_ENGINE_WIRE_V4_MAX_BYTES = 16 * 1024;
export const TARGET_NATIVE_ENGINE_WIRE_V4_OPERATIONS = [
  'INSPECT_TARGET', 'ENSURE_INTERNAL_NETWORK', 'CREATE_POSTGRES', 'CREATE_MINIO',
] as const;
export const TARGET_NATIVE_ENGINE_WIRE_V4_ROLES = ['NONE', 'NETWORK', 'POSTGRES', 'MINIO'] as const;

type Operation = typeof TARGET_NATIVE_ENGINE_WIRE_V4_OPERATIONS[number];
type Role = typeof TARGET_NATIVE_ENGINE_WIRE_V4_ROLES[number];

export interface TargetNativeEngineCommandV4 {
  readonly format: 'darshan-recovery-target-native-engine-command-v4';
  readonly operation: Operation;
  readonly role: Role;
  readonly installationId: string;
  readonly siteId: string;
  readonly hostInstallationId: string;
  readonly operationId: string;
  readonly targetHandle: string;
  readonly generation: string;
  readonly acquiredRequestSha256: string;
  readonly profileV4Sha256: string;
  readonly resourceAdmissionV3Sha256: string;
  readonly credentialAdmissionReceiptSha256: string;
  readonly credentialUseWitnessSha256: string;
  readonly authorityInstanceSha256: string;
  readonly supervisorGeneration: string;
  readonly challengeNonce: string;
  readonly commandNonce: string;
  readonly materializationHeadSha256: string;
  readonly deadlineUnixMs: string;
  readonly assetManifestSha256: string;
}

export interface TargetNativeEngineInspectionV4 {
  readonly format: 'darshan-recovery-target-native-engine-inspection-v4';
  readonly operation: Operation;
  readonly role: Role;
  readonly operationId: string;
  readonly targetHandle: string;
  readonly generation: string;
  readonly commandSemanticSha256: string;
  readonly commandWireSha256: string;
  readonly commandNonce: string;
  readonly authorityInstanceSha256: string;
  readonly supervisorGeneration: string;
  readonly challengeNonce: string;
  readonly materializationHeadSha256: string;
  readonly assetManifestSha256: string;
  readonly daemonIdentitySha256: string;
  readonly daemonResponseSha256: string;
  readonly observationComplete: 'true';
  readonly absenceReliable: 'true' | 'false';
  readonly containersCount: string;
  readonly networksCount: string;
  readonly consumersCount: string;
  readonly networkProjectionSha256: string;
  readonly postgresProjectionSha256: string;
  readonly minioProjectionSha256: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{32}$/;
const HANDLE = /^tra:v1:[A-Za-z0-9_:-]{16,112}$/;
const SITE = /^[a-z][a-z0-9-]{0,62}$/;
const U64 = /^(?:0|[1-9][0-9]{0,19})$/;
const MAX_U64 = 0xffff_ffff_ffff_ffffn;

function u64(value: string, positive = false): boolean {
  return U64.test(value) && BigInt(value) <= MAX_U64 && (!positive || value !== '0');
}
function validOperationRole(operation: Operation, role: Role): boolean {
  return (operation === 'INSPECT_TARGET' && role === 'NONE') ||
    (operation === 'ENSURE_INTERNAL_NETWORK' && role === 'NETWORK') ||
    (operation === 'CREATE_POSTGRES' && role === 'POSTGRES') ||
    (operation === 'CREATE_MINIO' && role === 'MINIO');
}
function fail(label: string): never {
  throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', `${label} is not strict fixed-order command-v4/inspection-v4 wire.`);
}
function digest(bytes: Uint8Array, domain: string): string {
  return createHash('sha256').update(Buffer.from(`${domain}\0`, 'utf8')).update(bytes).digest('hex');
}
function exactLines(bytes: Uint8Array, keys: readonly string[], label: string): readonly string[] {
  const source = Buffer.from(bytes);
  if (!source.length || source.length > TARGET_NATIVE_ENGINE_WIRE_V4_MAX_BYTES || source[source.length - 1] !== 0x0a ||
      source.includes(0) || source.includes(0x0d)) fail(label);
  const lines = source.toString('utf8').slice(0, -1).split('\n');
  if (lines.length !== keys.length) fail(label);
  return lines.map((line, index) => {
    const prefix = `${keys[index]}=`;
    if (!line.startsWith(prefix) || line.length === prefix.length) fail(label);
    return line.slice(prefix.length);
  });
}
function lines(fields: readonly (readonly [string, string])[]): Buffer {
  const result = Buffer.from(`${fields.map(([key, value]) => `${key}=${value}`).join('\n')}\n`, 'utf8');
  if (result.byteLength > TARGET_NATIVE_ENGINE_WIRE_V4_MAX_BYTES) fail('Native engine v4');
  return result;
}

const COMMAND_KEYS = [
  'format', 'operation', 'role', 'installation_id', 'site_id', 'host_installation_id', 'operation_id',
  'target_handle', 'generation', 'acquired_request_sha256', 'profile_v4_sha256',
  'resource_admission_v3_sha256', 'credential_admission_receipt_sha256', 'credential_use_witness_sha256',
  'authority_instance_sha256', 'supervisor_generation', 'challenge_nonce', 'command_nonce',
  'materialization_head_sha256', 'deadline_unix_ms', 'asset_manifest_sha256',
] as const;

function commandFields(value: TargetNativeEngineCommandV4): readonly (readonly [string, string])[] {
  return [
    ['format', value.format], ['operation', value.operation], ['role', value.role],
    ['installation_id', value.installationId], ['site_id', value.siteId], ['host_installation_id', value.hostInstallationId],
    ['operation_id', value.operationId], ['target_handle', value.targetHandle], ['generation', value.generation],
    ['acquired_request_sha256', value.acquiredRequestSha256], ['profile_v4_sha256', value.profileV4Sha256],
    ['resource_admission_v3_sha256', value.resourceAdmissionV3Sha256],
    ['credential_admission_receipt_sha256', value.credentialAdmissionReceiptSha256],
    ['credential_use_witness_sha256', value.credentialUseWitnessSha256],
    ['authority_instance_sha256', value.authorityInstanceSha256], ['supervisor_generation', value.supervisorGeneration],
    ['challenge_nonce', value.challengeNonce], ['command_nonce', value.commandNonce],
    ['materialization_head_sha256', value.materializationHeadSha256], ['deadline_unix_ms', value.deadlineUnixMs],
    ['asset_manifest_sha256', value.assetManifestSha256],
  ];
}
function validateCommand(value: TargetNativeEngineCommandV4): void {
  const digests = [value.acquiredRequestSha256, value.profileV4Sha256, value.resourceAdmissionV3Sha256,
    value.credentialAdmissionReceiptSha256, value.credentialUseWitnessSha256, value.authorityInstanceSha256,
    value.materializationHeadSha256, value.assetManifestSha256];
  if (value.format !== 'darshan-recovery-target-native-engine-command-v4' ||
      !TARGET_NATIVE_ENGINE_WIRE_V4_OPERATIONS.includes(value.operation) ||
      !TARGET_NATIVE_ENGINE_WIRE_V4_ROLES.includes(value.role) || !validOperationRole(value.operation, value.role) ||
      !UUID.test(value.installationId) || !SITE.test(value.siteId) || !UUID.test(value.hostInstallationId) ||
      !UUID.test(value.operationId) || !HANDLE.test(value.targetHandle) || !u64(value.generation, true) ||
      digests.some((item) => !DIGEST.test(item)) || !u64(value.supervisorGeneration, true) ||
      !NONCE.test(value.challengeNonce) || !NONCE.test(value.commandNonce) ||
      value.challengeNonce === value.commandNonce || !u64(value.deadlineUnixMs, true)) fail('Native engine command v4');
}
export function encodeTargetNativeEngineCommandV4(value: TargetNativeEngineCommandV4): Buffer {
  validateCommand(value); return lines(commandFields(value));
}
export function parseTargetNativeEngineCommandV4(bytes: Uint8Array): TargetNativeEngineCommandV4 {
  const v = exactLines(bytes, COMMAND_KEYS, 'Native engine command v4');
  const value: TargetNativeEngineCommandV4 = Object.freeze({
    format: v[0] as TargetNativeEngineCommandV4['format'], operation: v[1] as Operation, role: v[2] as Role,
    installationId: v[3]!, siteId: v[4]!, hostInstallationId: v[5]!, operationId: v[6]!, targetHandle: v[7]!,
    generation: v[8]!, acquiredRequestSha256: v[9]!, profileV4Sha256: v[10]!, resourceAdmissionV3Sha256: v[11]!,
    credentialAdmissionReceiptSha256: v[12]!, credentialUseWitnessSha256: v[13]!, authorityInstanceSha256: v[14]!,
    supervisorGeneration: v[15]!, challengeNonce: v[16]!, commandNonce: v[17]!, materializationHeadSha256: v[18]!,
    deadlineUnixMs: v[19]!, assetManifestSha256: v[20]!,
  });
  validateCommand(value); if (!encodeTargetNativeEngineCommandV4(value).equals(Buffer.from(bytes))) fail('Native engine command v4');
  return value;
}
export function targetNativeEngineCommandSemanticV4Sha256(value: TargetNativeEngineCommandV4): string {
  return digest(lines([['domain', 'darshan-recovery-target-native-engine-command-semantic-v4'], ...commandFields(value).slice(1)]),
    'darshan-recovery-target-native-engine-command-semantic-digest-v4');
}
export function targetNativeEngineCommandWireV4Sha256(value: TargetNativeEngineCommandV4 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? Buffer.from(value) : encodeTargetNativeEngineCommandV4(value);
  parseTargetNativeEngineCommandV4(bytes);
  return digest(bytes, 'darshan-recovery-target-native-engine-command-wire-v4');
}

const INSPECTION_KEYS = [
  'format', 'operation', 'role', 'operation_id', 'target_handle', 'generation', 'command_semantic_sha256',
  'command_wire_sha256', 'command_nonce', 'authority_instance_sha256', 'supervisor_generation', 'challenge_nonce',
  'materialization_head_sha256', 'asset_manifest_sha256', 'daemon_identity_sha256', 'daemon_response_sha256',
  'observation_complete', 'absence_reliable', 'containers_count', 'networks_count', 'consumers_count',
  'network_projection_sha256', 'postgres_projection_sha256', 'minio_projection_sha256',
] as const;
function inspectionFields(value: TargetNativeEngineInspectionV4): readonly (readonly [string, string])[] {
  return [
    ['format', value.format], ['operation', value.operation], ['role', value.role], ['operation_id', value.operationId],
    ['target_handle', value.targetHandle], ['generation', value.generation], ['command_semantic_sha256', value.commandSemanticSha256],
    ['command_wire_sha256', value.commandWireSha256], ['command_nonce', value.commandNonce],
    ['authority_instance_sha256', value.authorityInstanceSha256], ['supervisor_generation', value.supervisorGeneration],
    ['challenge_nonce', value.challengeNonce], ['materialization_head_sha256', value.materializationHeadSha256],
    ['asset_manifest_sha256', value.assetManifestSha256], ['daemon_identity_sha256', value.daemonIdentitySha256],
    ['daemon_response_sha256', value.daemonResponseSha256], ['observation_complete', value.observationComplete],
    ['absence_reliable', value.absenceReliable], ['containers_count', value.containersCount],
    ['networks_count', value.networksCount], ['consumers_count', value.consumersCount],
    ['network_projection_sha256', value.networkProjectionSha256], ['postgres_projection_sha256', value.postgresProjectionSha256],
    ['minio_projection_sha256', value.minioProjectionSha256],
  ];
}
function validateInspection(value: TargetNativeEngineInspectionV4): void {
  const digests = [value.commandSemanticSha256, value.commandWireSha256, value.authorityInstanceSha256,
    value.materializationHeadSha256, value.assetManifestSha256, value.daemonIdentitySha256, value.daemonResponseSha256,
    value.networkProjectionSha256, value.postgresProjectionSha256, value.minioProjectionSha256];
  if (value.format !== 'darshan-recovery-target-native-engine-inspection-v4' ||
      !TARGET_NATIVE_ENGINE_WIRE_V4_OPERATIONS.includes(value.operation) || !TARGET_NATIVE_ENGINE_WIRE_V4_ROLES.includes(value.role) ||
      !validOperationRole(value.operation, value.role) || !UUID.test(value.operationId) || !HANDLE.test(value.targetHandle) ||
      !u64(value.generation, true) || digests.some((item) => !DIGEST.test(item)) || !NONCE.test(value.commandNonce) ||
      !u64(value.supervisorGeneration, true) || !NONCE.test(value.challengeNonce) ||
      value.observationComplete !== 'true' || !['true', 'false'].includes(value.absenceReliable) ||
      !u64(value.containersCount) || !u64(value.networksCount) || !u64(value.consumersCount)) fail('Native engine inspection v4');
}
export function encodeTargetNativeEngineInspectionV4(value: TargetNativeEngineInspectionV4): Buffer {
  validateInspection(value); return lines(inspectionFields(value));
}
export function parseTargetNativeEngineInspectionV4(bytes: Uint8Array): TargetNativeEngineInspectionV4 {
  const v = exactLines(bytes, INSPECTION_KEYS, 'Native engine inspection v4');
  const value: TargetNativeEngineInspectionV4 = Object.freeze({
    format: v[0] as TargetNativeEngineInspectionV4['format'], operation: v[1] as Operation, role: v[2] as Role,
    operationId: v[3]!, targetHandle: v[4]!, generation: v[5]!, commandSemanticSha256: v[6]!, commandWireSha256: v[7]!,
    commandNonce: v[8]!, authorityInstanceSha256: v[9]!, supervisorGeneration: v[10]!, challengeNonce: v[11]!,
    materializationHeadSha256: v[12]!, assetManifestSha256: v[13]!, daemonIdentitySha256: v[14]!, daemonResponseSha256: v[15]!,
    observationComplete: v[16] as 'true', absenceReliable: v[17] as 'true' | 'false', containersCount: v[18]!,
    networksCount: v[19]!, consumersCount: v[20]!, networkProjectionSha256: v[21]!, postgresProjectionSha256: v[22]!,
    minioProjectionSha256: v[23]!,
  });
  validateInspection(value); if (!encodeTargetNativeEngineInspectionV4(value).equals(Buffer.from(bytes))) fail('Native engine inspection v4');
  return value;
}
export function targetNativeEngineInspectionWireV4Sha256(value: TargetNativeEngineInspectionV4 | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? Buffer.from(value) : encodeTargetNativeEngineInspectionV4(value);
  parseTargetNativeEngineInspectionV4(bytes);
  return digest(bytes, 'darshan-recovery-target-native-engine-inspection-wire-v4');
}
