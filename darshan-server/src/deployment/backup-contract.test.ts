import { describe, expect, it } from 'vitest';
import {
  BACKUP_BUCKETS,
  BACKUP_CONTRACT_VERSION,
  BACKUP_OBJECT_SOURCES,
  assertBackupContractCoversProductionBuckets,
  isBackupObjectAllowed,
} from './backup-contract';

describe('production backup contract', () => {
  it('uses one valid versioned inventory', () => {
    expect(BACKUP_CONTRACT_VERSION).toBe(1);
    expect(() => assertBackupContractCoversProductionBuckets()).not.toThrow();
    expect(BACKUP_BUCKETS).toContain('logs-auth');
    expect(BACKUP_BUCKETS).toContain('archives');
    expect(BACKUP_OBJECT_SOURCES).not.toContainEqual({ bucket: 'media-staging' });
  });

  it('includes log archives without recursively including backup archives', () => {
    expect(isBackupObjectAllowed('archives', 'logs/audit/2026-01.ndjson')).toBe(true);
    expect(isBackupObjectAllowed('archives', 'backups/run-1/database.sql.gz')).toBe(false);
    expect(isBackupObjectAllowed('archives', '../logs/audit.ndjson')).toBe(false);
    expect(isBackupObjectAllowed('logs-auth', '2026/bad\nkey.json')).toBe(false);
    expect(isBackupObjectAllowed('logs-auth', '2026\\bad.json')).toBe(false);
    expect(isBackupObjectAllowed('logs-auth', '2026/entry.json')).toBe(true);
  });
});
