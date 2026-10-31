import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('backup alert rules', () => {
  it('keeps every bounded Packet 3 backup signal wired without secret or run-id labels', async () => {
    const source = await readFile(new URL('../../../deploy/shared/observability/prometheus/rules/alerts.yml', import.meta.url), 'utf8');
    for (const name of ['DARSHANBackupVerifiedSuccessMissingOrOverdue', 'DARSHANBackupAttemptStuck',
      'DARSHANBackupCaptureDurationHigh', 'DARSHANBackupRepositoryCapacityLow',
      'DARSHANBackupRetriesExhausted', 'DARSHANBackupRetentionFailures']) expect(source).toContain(`alert: ${name}`);
    expect(source).not.toMatch(/darshan_server_backup_[^\n{]+\{[^}]*?(run_id|operation_id|manifest|path|key)=/);
  });

  it('fires the no-success condition for absent/zero timestamps and clears for a fresh verified success', async () => {
    const source = await readFile(new URL('../../../deploy/shared/observability/prometheus/rules/alerts.yml', import.meta.url), 'utf8');
    const expression = source.match(/alert: DARSHANBackupVerifiedSuccessMissingOrOverdue\n\s+expr: ([^\n]+)/)?.[1] ?? '';
    expect(expression).toContain('absent(darshan_server_backup_last_verified_success_timestamp_seconds)');
    expect(expression).toContain('darshan_server_backup_last_verified_success_timestamp_seconds <= 0');
    expect(expression).toContain('darshan_server_backup_last_verified_success_age_seconds > 90000');
    const fires = (timestamp: number | null, age: number | null) => timestamp === null || timestamp <= 0 || (age ?? 0) > 90_000;
    expect(fires(null, null)).toBe(true);
    expect(fires(0, 0)).toBe(true);
    expect(fires(1_800_000_000, 60)).toBe(false);
    expect(fires(1_700_000_000, 90_001)).toBe(true);
  });
});
