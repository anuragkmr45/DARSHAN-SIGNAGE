import { createHash } from 'node:crypto';
import { canonicalJson } from '../../backups/backup-broker-protocol';

export const CONTROLLED_RECOVERY_STATES = [
  'PLANNED', 'SOURCE_HELD', 'PREFLIGHT_PASSED', 'DECRYPTED_VERIFIED',
  'TARGETS_CREATED', 'DATABASE_RESTORED', 'OBJECTS_RESTORED', 'DATA_VALIDATED',
  'APPLICATION_RECONCILED', 'APP_VALIDATED', 'AWAITING_PROMOTION',
  'PROMOTED_PENDING_ACCEPTANCE', 'ACCEPTED', 'ROLLED_BACK',
  'FAILED_RETRYABLE', 'OPERATOR_REVIEW', 'ABANDONED_RETAINED',
] as const;
export type ControlledRecoveryState = typeof CONTROLLED_RECOVERY_STATES[number];

export const CONTROLLED_RECOVERY_MAJOR_STATES = [
  'PLANNED', 'SOURCE_HELD', 'PREFLIGHT_PASSED', 'DECRYPTED_VERIFIED',
  'TARGETS_CREATED', 'DATABASE_RESTORED', 'OBJECTS_RESTORED', 'DATA_VALIDATED',
] as const;
export type ControlledRecoveryMajorState = typeof CONTROLLED_RECOVERY_MAJOR_STATES[number];

export class ControlledRecoveryError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ControlledRecoveryError';
  }
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalDecimal(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', `${label} must be a canonical unsigned decimal.`);
  }
  return BigInt(value);
}

export function safeId(value: string, label: string, pattern = /^[a-z0-9][a-z0-9_-]{0,62}$/): string {
  if (!pattern.test(value)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', `${label} is invalid.`);
  return value;
}

export interface ExactSourceIdentity {
  siteId: string;
  repositoryId: string;
  runId: string;
  manifestSha256: string;
  descriptorSha256: string;
  keyId: string;
  releaseId: string;
  schemaMigrationId: string;
}

export interface OperationIdentity {
  operationId: string;
  siteId: string;
  approvedReleaseId: 'release-01' | 'release-03';
  source: ExactSourceIdentity;
}

export const RECOVERY_PAIRING_REVIEW_REQUIRED = 'RECOVERY_PAIRING_REVIEW_REQUIRED' as const;

