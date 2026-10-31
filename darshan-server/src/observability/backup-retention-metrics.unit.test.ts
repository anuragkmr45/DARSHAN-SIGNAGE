import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ config: { PG_BOSS_SCHEMA: 'pgboss' } }));
vi.mock('@/db', () => ({ getDatabasePool: () => null }));

import {
  getObservabilityRegistry,
  recordBackupRetentionSummary,
  resetObservabilityMetricsForTests,
} from './metrics.js';

describe('backup retention metrics', () => {
  beforeEach(() => resetObservabilityMetricsForTests());

  it('records bounded outcomes, known bytes, and database-clock timestamps', async () => {
    recordBackupRetentionSummary({ checked: 4, eligible: 1, claimed: 1, deleted: 1, partial: 0, uncertain: 0, failed: 0,
      protected: { BACKUP_RETENTION_NEWEST_THREE: 3 }, bytesDeleted: '1024',
      lastCheckAt: '2026-10-29T00:00:00.000Z', lastSuccessAt: '2026-10-29T00:00:00.000Z', lastFailureAt: null });
    const output = await getObservabilityRegistry().metrics();
    expect(output).toContain('darshan_server_backup_retention_candidates_total{result="checked"} 4');
    expect(output).toContain('darshan_server_backup_retention_candidates_total{result="BACKUP_RETENTION_NEWEST_THREE"} 3');
    expect(output).toContain('darshan_server_backup_retention_deleted_bytes_total 1024');
    expect(output).toContain('darshan_server_backup_retention_last_check_timestamp_seconds 1793232000');
  });
});
