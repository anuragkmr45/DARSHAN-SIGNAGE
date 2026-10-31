import { describe, expect, it } from 'vitest';

import { BackupError, asBackupError, classifyBackupErrorCode } from './errors';

describe('backup error contract', () => {
  it('keeps retry classifications explicit and stable', () => {
    expect(classifyBackupErrorCode('BACKUP_IO_TRANSIENT')).toEqual({ failureClass: 'TRANSIENT', retryDisposition: 'AUTOMATIC' });
    expect(new BackupError('BACKUP_AGE_VERSION_MISMATCH', 'wrong tool')).toMatchObject({
      code: 'BACKUP_AGE_VERSION_MISMATCH',
      failureClass: 'PREREQUISITE',
      retryDisposition: 'AFTER_PREREQUISITE_CHANGE',
      retryable: false,
    });
    expect(new BackupError('BACKUP_MANIFEST_SIGNATURE_INVALID', 'bad signature').retryable).toBe(false);
  });

  it('normalizes capacity and transient system failures without leaking unstable messages', () => {
    expect(asBackupError(Object.assign(new Error('disk details'), { code: 'ENOSPC' }))).toMatchObject({ code: 'BACKUP_CAPACITY_EXHAUSTED' });
    expect(asBackupError(Object.assign(new Error('device details'), { code: 'EIO' }))).toMatchObject({ code: 'BACKUP_IO_TRANSIENT', retryable: true });
  });
});
