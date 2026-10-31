import {
  BackupError,
  type BackupRetentionProtectionCode,
} from './errors';

export const MINIMUM_BACKUP_RETENTION_DAYS = 30;
export const MAXIMUM_BACKUP_RETENTION_DAYS = 100_000_000;
export const MINIMUM_VERIFIED_GOOD_COPIES = 3;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type BackupArtifactLifecycleState =
  | 'AVAILABLE'
  | 'DELETE_REQUESTED'
  | 'DELETING'
  | 'PARTIALLY_DELETED'
  | 'DELETED'
  | 'UNCERTAIN'
  | 'QUARANTINED';

export type BackupRetentionOperationState =
  | 'PREPARED'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'FAILED'
  | 'UNCERTAIN';

export type BackupVerificationProvenance =
  | Readonly<{
      kind: 'PUBLICATION_READ_BACK';
      publicationId: string;
      manifestSha256: string;
      verifiedAt: Date;
    }>
  | Readonly<{ kind: 'LEGACY_UNVERIFIED' }>
  | null;

export interface RetentionBackup {
  id: string;
  siteKey: string;
  repositoryId: string;
  capturedAt: Date | null;
  executionOutcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INCOMPLETE';
  lifecycleState: BackupArtifactLifecycleState;
  verification: BackupVerificationProvenance;
  hasActiveRetentionOperation: boolean;
  restoreHold: 'NONE' | 'ACTIVE' | 'UNCERTAIN';
}

export interface BackupRetentionPolicy {
  retentionDays: number;
  minimumVerifiedGoodCopies: number;
}

export interface RetentionDecision {
  backupId: string;
  eligible: boolean;
  protectionCodes: BackupRetentionProtectionCode[];
  expiresAt: Date | null;
}

const LIFECYCLE_TRANSITIONS: Readonly<Record<BackupArtifactLifecycleState, readonly BackupArtifactLifecycleState[]>> = {
  AVAILABLE: ['DELETE_REQUESTED', 'QUARANTINED', 'UNCERTAIN'],
  DELETE_REQUESTED: ['DELETING', 'AVAILABLE', 'UNCERTAIN'],
  DELETING: ['PARTIALLY_DELETED', 'DELETED', 'UNCERTAIN'],
  PARTIALLY_DELETED: ['DELETE_REQUESTED', 'DELETING', 'DELETED', 'UNCERTAIN'],
  DELETED: [],
  UNCERTAIN: ['AVAILABLE', 'DELETE_REQUESTED', 'PARTIALLY_DELETED', 'QUARANTINED'],
  QUARANTINED: ['AVAILABLE', 'UNCERTAIN'],
};

const OPERATION_TRANSITIONS: Readonly<Record<BackupRetentionOperationState, readonly BackupRetentionOperationState[]>> = {
  PREPARED: ['RUNNING', 'FAILED', 'UNCERTAIN'],
  RUNNING: ['RETRY_WAIT', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'UNCERTAIN'],
  RETRY_WAIT: ['RUNNING', 'FAILED', 'UNCERTAIN'],
  SUCCEEDED: [],
  PARTIAL: ['RETRY_WAIT', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN'],
  FAILED: ['RETRY_WAIT'],
  UNCERTAIN: ['RETRY_WAIT', 'PARTIAL', 'FAILED'],
};

function validInstant(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function stableCompare(left: RetentionBackup, right: RetentionBackup): number {
  const leftTime = left.capturedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightTime = right.capturedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (leftTime !== rightTime) return rightTime - leftTime;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function createBackupRetentionPolicy(input: {
  retentionDays?: number;
  minimumVerifiedGoodCopies?: number;
} = {}): BackupRetentionPolicy {
  const retentionDays = input.retentionDays ?? MINIMUM_BACKUP_RETENTION_DAYS;
  const minimumVerifiedGoodCopies = input.minimumVerifiedGoodCopies ?? MINIMUM_VERIFIED_GOOD_COPIES;
  if (!Number.isSafeInteger(retentionDays) || retentionDays < MINIMUM_BACKUP_RETENTION_DAYS ||
      retentionDays > MAXIMUM_BACKUP_RETENTION_DAYS) {
    throw new BackupError(
      'BACKUP_RETENTION_POLICY_INVALID',
      `Backup retention must be an integer from ${MINIMUM_BACKUP_RETENTION_DAYS} through ${MAXIMUM_BACKUP_RETENTION_DAYS} days.`
    );
  }
  if (!Number.isSafeInteger(minimumVerifiedGoodCopies) || minimumVerifiedGoodCopies < MINIMUM_VERIFIED_GOOD_COPIES) {
    throw new BackupError(
      'BACKUP_RETENTION_POLICY_INVALID',
      `At least ${MINIMUM_VERIFIED_GOOD_COPIES} verified good copies must be protected.`
    );
  }
  return { retentionDays, minimumVerifiedGoodCopies };
}

function hasValidReadBackEvidence(backup: RetentionBackup): backup is RetentionBackup & {
  capturedAt: Date;
  verification: Extract<BackupVerificationProvenance, { kind: 'PUBLICATION_READ_BACK' }>;
} {
  const verification = backup.verification;
  return verification?.kind === 'PUBLICATION_READ_BACK' &&
    UUID_PATTERN.test(verification.publicationId) &&
    SHA256_PATTERN.test(verification.manifestSha256) &&
    validInstant(verification.verifiedAt) &&
    backup.capturedAt !== null && validInstant(backup.capturedAt);
}

function retentionExpiry(anchor: Date, retentionDays: number): Date | null {
  const duration = retentionDays * DAY_MILLISECONDS;
  const milliseconds = anchor.getTime() + duration;
  if (!Number.isSafeInteger(duration) || !Number.isSafeInteger(milliseconds)) return null;
  const result = new Date(milliseconds);
  return validInstant(result) ? result : null;
}

/**
 * Pure, fail-closed retention planning. Dates are compared as UTC instants;
 * invalid clocks and future verification evidence protect every affected run.
 */
export function planBackupRetention(input: {
  now: Date;
  backups: readonly RetentionBackup[];
  policy?: BackupRetentionPolicy;
}): RetentionDecision[] {
  const policy = input.policy ?? createBackupRetentionPolicy();
  const nowValid = validInstant(input.now);
  const groupedGoodCopies = new Map<string, RetentionBackup[]>();

  for (const backup of input.backups) {
    if (
      nowValid &&
      backup.executionOutcome === 'SUCCEEDED' &&
      backup.lifecycleState === 'AVAILABLE' &&
      hasValidReadBackEvidence(backup) &&
      backup.verification.verifiedAt.getTime() <= input.now.getTime() &&
      backup.capturedAt.getTime() <= input.now.getTime()
    ) {
      const key = `${backup.siteKey}\0${backup.repositoryId}`;
      const group = groupedGoodCopies.get(key) ?? [];
      group.push(backup);
      groupedGoodCopies.set(key, group);
    }
  }

  const newestProtected = new Set<string>();
  for (const copies of groupedGoodCopies.values()) {
    copies.sort(stableCompare).slice(0, policy.minimumVerifiedGoodCopies)
      .forEach((copy) => newestProtected.add(copy.id));
  }

  return input.backups.map((backup) => {
    const protections: BackupRetentionProtectionCode[] = [];
    let expiresAt: Date | null = null;

    if (!nowValid) protections.push('BACKUP_RETENTION_INVALID_CLOCK');
    if (backup.executionOutcome !== 'SUCCEEDED') {
      protections.push('BACKUP_RETENTION_EXECUTION_NOT_SUCCESSFUL');
    }
    if (!hasValidReadBackEvidence(backup)) {
      protections.push('BACKUP_RETENTION_UNVERIFIED');
    } else if (nowValid && (
      backup.verification.verifiedAt.getTime() > input.now.getTime() ||
      backup.capturedAt.getTime() > input.now.getTime()
    )) {
      protections.push('BACKUP_RETENTION_FUTURE_TIMESTAMP');
    } else {
      expiresAt = retentionExpiry(backup.verification.verifiedAt, policy.retentionDays);
      if (!expiresAt) {
        protections.push('BACKUP_RETENTION_INVALID_EXPIRY');
      } else if (nowValid && input.now.getTime() < expiresAt.getTime()) {
        protections.push('BACKUP_RETENTION_MINIMUM_AGE');
      }
    }

    if (backup.lifecycleState !== 'AVAILABLE' && backup.lifecycleState !== 'PARTIALLY_DELETED') {
      protections.push(
        backup.lifecycleState === 'UNCERTAIN'
          ? 'BACKUP_RETENTION_LIFECYCLE_UNCERTAIN'
          : 'BACKUP_RETENTION_NOT_AVAILABLE'
      );
    }
    if (backup.hasActiveRetentionOperation) protections.push('BACKUP_RETENTION_ACTIVE_OPERATION');
    if (backup.restoreHold === 'ACTIVE') protections.push('BACKUP_RETENTION_RESTORE_HOLD');
    if (backup.restoreHold === 'UNCERTAIN') protections.push('BACKUP_RETENTION_RESTORE_HOLD_UNCERTAIN');
    if (newestProtected.has(backup.id)) protections.push('BACKUP_RETENTION_NEWEST_THREE');

    return {
      backupId: backup.id,
      eligible: protections.length === 0,
      protectionCodes: protections,
      expiresAt,
    };
  });
}

export function canTransitionBackupArtifactLifecycle(
  from: BackupArtifactLifecycleState,
  to: BackupArtifactLifecycleState
): boolean {
  return from === to || LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function canTransitionBackupRetentionOperation(
  from: BackupRetentionOperationState,
  to: BackupRetentionOperationState
): boolean {
  return from === to || OPERATION_TRANSITIONS[from].includes(to);
}

export function assertBackupArtifactLifecycleTransition(
  from: BackupArtifactLifecycleState,
  to: BackupArtifactLifecycleState
): void {
  if (!canTransitionBackupArtifactLifecycle(from, to)) {
    throw new BackupError('BACKUP_RETENTION_STATE_CONFLICT', `Illegal backup artifact lifecycle transition ${from} -> ${to}.`);
  }
}

export function assertBackupRetentionOperationTransition(
  from: BackupRetentionOperationState,
  to: BackupRetentionOperationState
): void {
  if (!canTransitionBackupRetentionOperation(from, to)) {
    throw new BackupError('BACKUP_RETENTION_STATE_CONFLICT', `Illegal backup retention operation transition ${from} -> ${to}.`);
  }
}
