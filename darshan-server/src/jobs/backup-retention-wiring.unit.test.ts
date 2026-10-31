import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('backup retention queue wiring', () => {
  it('registers one bounded hourly singleton and one startup reconciliation delivery', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain("registerObservedWorker<BackupRetentionJob>('backup:retention'");
    expect(source).toContain("jobs.schedule('backup:retention', '7 * * * *'");
    expect(source).toContain("singletonKey: `backup-retention:${appConfig.BACKUP_SITE_ID");
    expect(source).toContain("sendJob('backup:retention', { trigger: 'startup-reconciliation' }");
    expect(source).toContain('maxCandidates: 25');
    expect(source).toContain('createBackupRetentionPolicy({ retentionDays: appConfig.BACKUP_RETENTION_DAYS })');
    expect(source).toContain('BACKUP_RETENTION_PASS_BUDGET_MS + BACKUP_RETENTION_JOB_GRACE_MS');
    expect(source).toContain('projectTerminalBackupExecutionOutcomes({ siteKey, repositoryId })');
    expect(source).not.toMatch(/backup:retention[^\n]+\*\/\d+/);
  });
});
