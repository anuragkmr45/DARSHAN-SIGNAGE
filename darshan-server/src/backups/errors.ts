export type BackupErrorCode =
  | 'BACKUP_ABORTED'
  | 'BACKUP_TIMEOUT'
  | 'BACKUP_IO_TRANSIENT'
  | 'BACKUP_CAPACITY_EXHAUSTED'
  | 'BACKUP_INVALID_INPUT'
  | 'BACKUP_UNSAFE_PATH'
  | 'BACKUP_INVENTORY_LIMIT_EXCEEDED'
  | 'BACKUP_INVENTORY_UNSAFE_ENTRY'
  | 'BACKUP_INVENTORY_CHANGED'
  | 'BACKUP_MANIFEST_INVALID'
  | 'BACKUP_MANIFEST_VERSION_UNSUPPORTED'
  | 'BACKUP_MANIFEST_DUPLICATE_ENTRY'
  | 'BACKUP_MANIFEST_SIGNATURE_REQUIRED'
  | 'BACKUP_MANIFEST_SIGNATURE_INVALID'
  | 'BACKUP_HOST_HELPER_INVALID'
  | 'BACKUP_HOST_HELPER_FAILED'
  | 'BACKUP_HOST_HELPER_PROTOCOL_INVALID'
  | 'BACKUP_AGE_EXECUTABLE_INVALID'
  | 'BACKUP_AGE_VERSION_MISMATCH'
  | 'BACKUP_AGE_RECIPIENT_INVALID'
  | 'BACKUP_ENCRYPTION_FAILED'
  | 'BACKUP_DECRYPTION_FAILED'
  | 'BACKUP_OUTPUT_EXISTS'
  | 'BACKUP_PARTIAL_CLEANUP_FAILED'
  | 'BACKUP_SPOOL_UNSAFE'
  | 'BACKUP_PUBLICATION_AUTHORITY_EXPIRED'
  | 'BACKUP_RETENTION_POLICY_INVALID'
  | 'BACKUP_RETENTION_STATE_CONFLICT'
  | 'BACKUP_RETENTION_FENCE_REJECTED'
  | 'BACKUP_INTERNAL';

/** Stable, persisted reasons why a backup must not be deleted. */
export const BACKUP_RETENTION_PROTECTION_CODES = [
  'BACKUP_RETENTION_INVALID_CLOCK',
  'BACKUP_RETENTION_INVALID_EXPIRY',
  'BACKUP_RETENTION_FUTURE_TIMESTAMP',
  'BACKUP_RETENTION_EXECUTION_NOT_SUCCESSFUL',
  'BACKUP_RETENTION_UNVERIFIED',
  'BACKUP_RETENTION_NOT_AVAILABLE',
  'BACKUP_RETENTION_ACTIVE_OPERATION',
  'BACKUP_RETENTION_RESTORE_HOLD',
  'BACKUP_RETENTION_RESTORE_HOLD_UNCERTAIN',
  'BACKUP_RETENTION_LIFECYCLE_UNCERTAIN',
  'BACKUP_RETENTION_MINIMUM_AGE',
  'BACKUP_RETENTION_NEWEST_THREE',
] as const;

export type BackupRetentionProtectionCode = (typeof BACKUP_RETENTION_PROTECTION_CODES)[number];

export type BackupFailureClass =
  | 'TRANSIENT'
  | 'PREREQUISITE'
  | 'INVALID_INPUT'
  | 'INTEGRITY'
  | 'CANCELLED'
  | 'INTERNAL';

export type BackupRetryDisposition = 'AUTOMATIC' | 'AFTER_PREREQUISITE_CHANGE' | 'NEVER';

type Classification = Readonly<{
  failureClass: BackupFailureClass;
  retryDisposition: BackupRetryDisposition;
}>;

const CLASSIFICATIONS: Readonly<Record<BackupErrorCode, Classification>> = {
  BACKUP_ABORTED: { failureClass: 'CANCELLED', retryDisposition: 'NEVER' },
  BACKUP_TIMEOUT: { failureClass: 'TRANSIENT', retryDisposition: 'AUTOMATIC' },
  BACKUP_IO_TRANSIENT: { failureClass: 'TRANSIENT', retryDisposition: 'AUTOMATIC' },
  BACKUP_CAPACITY_EXHAUSTED: { failureClass: 'PREREQUISITE', retryDisposition: 'AFTER_PREREQUISITE_CHANGE' },
  BACKUP_INVALID_INPUT: { failureClass: 'INVALID_INPUT', retryDisposition: 'NEVER' },
  BACKUP_UNSAFE_PATH: { failureClass: 'INVALID_INPUT', retryDisposition: 'NEVER' },
  BACKUP_INVENTORY_LIMIT_EXCEEDED: { failureClass: 'PREREQUISITE', retryDisposition: 'AFTER_PREREQUISITE_CHANGE' },
  BACKUP_INVENTORY_UNSAFE_ENTRY: { failureClass: 'INTEGRITY', retryDisposition: 'NEVER' },
  BACKUP_INVENTORY_CHANGED: { failureClass: 'TRANSIENT', retryDisposition: 'AUTOMATIC' },
  BACKUP_MANIFEST_INVALID: { failureClass: 'INTEGRITY', retryDisposition: 'NEVER' },
  BACKUP_MANIFEST_VERSION_UNSUPPORTED: { failureClass: 'INVALID_INPUT', retryDisposition: 'NEVER' },
  BACKUP_MANIFEST_DUPLICATE_ENTRY: { failureClass: 'INTEGRITY', retryDisposition: 'NEVER' },
  BACKUP_MANIFEST_SIGNATURE_REQUIRED: { failureClass: 'INTEGRITY', retryDisposition: 'NEVER' },
  BACKUP_MANIFEST_SIGNATURE_INVALID: { failureClass: 'INTEGRITY', retryDisposition: 'NEVER' },
  BACKUP_HOST_HELPER_INVALID: { failureClass: 'PREREQUISITE', retryDisposition: 'AFTER_PREREQUISITE_CHANGE' },
  BACKUP_HOST_HELPER_FAILED: { failureClass: 'PREREQUISITE', retryDisposition: 'AFTER_PREREQUISITE_CHANGE' },
  BACKUP_HOST_HELPER_PROTOCOL_INVALID: { failureClass: 'INTEGRITY', retryDisposition: 'NEVER' },
  BACKUP_AGE_EXECUTABLE_INVALID: { failureClass: 'PREREQUISITE', retryDisposition: 'AFTER_PREREQUISITE_CHANGE' },
  BACKUP_AGE_VERSION_MISMATCH: { failureClass: 'PREREQUISITE', retryDisposition: 'AFTER_PREREQUISITE_CHANGE' },
  BACKUP_AGE_RECIPIENT_INVALID: { failureClass: 'PREREQUISITE', retryDisposition: 'AFTER_PREREQUISITE_CHANGE' },
  BACKUP_ENCRYPTION_FAILED: { failureClass: 'TRANSIENT', retryDisposition: 'AUTOMATIC' },
  BACKUP_DECRYPTION_FAILED: { failureClass: 'INTEGRITY', retryDisposition: 'NEVER' },
  BACKUP_OUTPUT_EXISTS: { failureClass: 'INVALID_INPUT', retryDisposition: 'NEVER' },
  BACKUP_PARTIAL_CLEANUP_FAILED: { failureClass: 'PREREQUISITE', retryDisposition: 'AFTER_PREREQUISITE_CHANGE' },
  BACKUP_SPOOL_UNSAFE: { failureClass: 'INTEGRITY', retryDisposition: 'NEVER' },
  BACKUP_PUBLICATION_AUTHORITY_EXPIRED: { failureClass: 'CANCELLED', retryDisposition: 'NEVER' },
  BACKUP_RETENTION_POLICY_INVALID: { failureClass: 'INVALID_INPUT', retryDisposition: 'NEVER' },
  BACKUP_RETENTION_STATE_CONFLICT: { failureClass: 'TRANSIENT', retryDisposition: 'AUTOMATIC' },
  BACKUP_RETENTION_FENCE_REJECTED: { failureClass: 'CANCELLED', retryDisposition: 'NEVER' },
  BACKUP_INTERNAL: { failureClass: 'INTERNAL', retryDisposition: 'NEVER' },
};

export function classifyBackupErrorCode(code: BackupErrorCode): Classification {
  return CLASSIFICATIONS[code];
}

export class BackupError extends Error {
  readonly failureClass: BackupFailureClass;
  readonly retryDisposition: BackupRetryDisposition;
  readonly retryable: boolean;

  constructor(
    public readonly code: BackupErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'BackupError';
    const classification = classifyBackupErrorCode(code);
    this.failureClass = classification.failureClass;
    this.retryDisposition = classification.retryDisposition;
    this.retryable = classification.retryDisposition === 'AUTOMATIC';
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      failureClass: this.failureClass,
      retryDisposition: this.retryDisposition,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

const TRANSIENT_IO_CODES = new Set(['EAGAIN', 'EBUSY', 'ECONNRESET', 'EIO', 'EMFILE', 'ENFILE', 'ETIMEDOUT']);

export function asBackupError(error: unknown, fallbackCode: BackupErrorCode = 'BACKUP_INTERNAL'): BackupError {
  if (error instanceof BackupError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new BackupError('BACKUP_ABORTED', 'Backup operation was aborted.', undefined, { cause: error });
  }
  const systemError = error as NodeJS.ErrnoException;
  if (systemError?.code === 'ENOSPC' || systemError?.code === 'EDQUOT') {
    return new BackupError('BACKUP_CAPACITY_EXHAUSTED', 'Backup storage capacity is exhausted.', undefined, { cause: error });
  }
  if (systemError?.code && TRANSIENT_IO_CODES.has(systemError.code)) {
    return new BackupError('BACKUP_IO_TRANSIENT', 'A transient backup I/O failure occurred.', { errno: systemError.code }, { cause: error });
  }
  const message = error instanceof Error ? error.message : 'Unknown backup failure.';
  return new BackupError(fallbackCode, message, undefined, error instanceof Error ? { cause: error } : undefined);
}
