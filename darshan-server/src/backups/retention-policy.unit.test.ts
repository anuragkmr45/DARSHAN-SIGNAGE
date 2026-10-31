import { describe, expect, it } from 'vitest';
import {
  assertBackupArtifactLifecycleTransition,
  assertBackupRetentionOperationTransition,
  canTransitionBackupArtifactLifecycle,
  canTransitionBackupRetentionOperation,
  createBackupRetentionPolicy,
  MAXIMUM_BACKUP_RETENTION_DAYS,
  planBackupRetention,
  type RetentionBackup,
} from './retention-policy';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const DAY = 86_400_000;

function backup(overrides: Partial<RetentionBackup> & { id: string; ageMs?: number }): RetentionBackup {
  const ageMs = overrides.ageMs ?? 40 * DAY;
  return {
    id: overrides.id,
    siteKey: overrides.siteKey ?? 'site-a',
    repositoryId: overrides.repositoryId ?? 'repo-a',
    capturedAt: overrides.capturedAt === undefined
      ? new Date(NOW.getTime() - ageMs - DAY)
      : overrides.capturedAt,
    executionOutcome: overrides.executionOutcome ?? 'SUCCEEDED',
    lifecycleState: overrides.lifecycleState ?? 'AVAILABLE',
    verification: overrides.verification === undefined ? {
      kind: 'PUBLICATION_READ_BACK',
      publicationId: '11111111-1111-4111-8111-111111111111',
      manifestSha256: 'a'.repeat(64),
      verifiedAt: new Date(NOW.getTime() - ageMs),
    } : overrides.verification,
    hasActiveRetentionOperation: overrides.hasActiveRetentionOperation ?? false,
    restoreHold: overrides.restoreHold ?? 'NONE',
  };
}

function decision(item: RetentionBackup, now = NOW, policy = createBackupRetentionPolicy()) {
  return planBackupRetention({ now, backups: [item], policy })[0];
}

describe('backup retention policy', () => {
  it('enforces the thirty-day floor and minimum three verified copies', () => {
    expect(() => createBackupRetentionPolicy({ retentionDays: 29 })).toThrow(/30 through 100000000/);
    expect(() => createBackupRetentionPolicy({ minimumVerifiedGoodCopies: 2 })).toThrow(/At least 3/);
    expect(createBackupRetentionPolicy({ retentionDays: 45, minimumVerifiedGoodCopies: 5 }))
      .toEqual({ retentionDays: 45, minimumVerifiedGoodCopies: 5 });
    expect(createBackupRetentionPolicy({ retentionDays: MAXIMUM_BACKUP_RETENTION_DAYS }).retentionDays)
      .toBe(MAXIMUM_BACKUP_RETENTION_DAYS);
    expect(() => createBackupRetentionPolicy({ retentionDays: MAXIMUM_BACKUP_RETENTION_DAYS + 1 }))
      .toThrow(/30 through 100000000/);
  });

  it('uses an exact UTC boundary at 30d-1ms, 30d, and 30d+1ms', () => {
    const copies = [
      backup({ id: 'minus', ageMs: 30 * DAY - 1 }),
      backup({ id: 'equal', ageMs: 30 * DAY }),
      backup({ id: 'plus', ageMs: 30 * DAY + 1 }),
      backup({ id: 'newer-1', ageMs: DAY }),
      backup({ id: 'newer-2', ageMs: 2 * DAY }),
      backup({ id: 'newer-3', ageMs: 3 * DAY }),
    ];
    const results = new Map(planBackupRetention({ now: NOW, backups: copies }).map((item) => [item.backupId, item]));
    expect(results.get('minus')).toMatchObject({ eligible: false, protectionCodes: ['BACKUP_RETENTION_MINIMUM_AGE'] });
    expect(results.get('equal')).toMatchObject({ eligible: true, protectionCodes: [] });
    expect(results.get('plus')).toMatchObject({ eligible: true, protectionCodes: [] });
  });

  it('honors a longer configured retention period', () => {
    const copies = [backup({ id: 'candidate', ageMs: 44 * DAY }), ...[1, 2, 3].map((n) => backup({ id: `new-${n}`, ageMs: n * DAY }))];
    const result = planBackupRetention({ now: NOW, backups: copies, policy: createBackupRetentionPolicy({ retentionDays: 45 }) });
    expect(result.find((item) => item.backupId === 'candidate')?.protectionCodes)
      .toContain('BACKUP_RETENTION_MINIMUM_AGE');
  });

  it.each([0, 1, 2, 3, 4, 5])('protects newest three with %i verified copies', (count) => {
    const copies = Array.from({ length: count }, (_, index) => backup({ id: `copy-${index}`, ageMs: (40 + index) * DAY }));
    const results = planBackupRetention({ now: NOW, backups: copies });
    expect(results.filter((item) => item.protectionCodes.includes('BACKUP_RETENTION_NEWEST_THREE'))).toHaveLength(Math.min(3, count));
    expect(results.filter((item) => item.eligible)).toHaveLength(Math.max(0, count - 3));
  });

  it('excludes failed, corrupt, unverified and legacy synthetic verification from good-copy ranking', () => {
    const protectedInputs: RetentionBackup[] = [
      backup({ id: 'failed', executionOutcome: 'FAILED' }),
      backup({ id: 'corrupt', lifecycleState: 'QUARANTINED' }),
      backup({ id: 'unverified', verification: null }),
      backup({ id: 'legacy', verification: { kind: 'LEGACY_UNVERIFIED' } }),
    ];
    const valid = [0, 1, 2, 3].map((index) => backup({ id: `valid-${index}`, ageMs: (40 + index) * DAY }));
    const results = planBackupRetention({ now: NOW, backups: [...protectedInputs, ...valid] });
    expect(results.find((item) => item.backupId === 'failed')?.protectionCodes)
      .toContain('BACKUP_RETENTION_EXECUTION_NOT_SUCCESSFUL');
    expect(results.find((item) => item.backupId === 'corrupt')?.protectionCodes)
      .toContain('BACKUP_RETENTION_NOT_AVAILABLE');
    expect(results.find((item) => item.backupId === 'unverified')?.protectionCodes)
      .toContain('BACKUP_RETENTION_UNVERIFIED');
    expect(results.find((item) => item.backupId === 'legacy')?.protectionCodes)
      .toContain('BACKUP_RETENTION_UNVERIFIED');
    expect(valid.filter((copy) => results.find((item) => item.backupId === copy.id)?.protectionCodes
      .includes('BACKUP_RETENTION_NEWEST_THREE'))).toHaveLength(3);
    expect(results.find((item) => item.backupId === 'valid-3')?.eligible).toBe(true);
  });

  it('breaks equal verification timestamps by stable backup id within each site/repository', () => {
    const copies = ['delta', 'bravo', 'alpha', 'charlie'].map((id) => backup({ id }));
    const results = new Map(planBackupRetention({ now: NOW, backups: copies }).map((item) => [item.backupId, item]));
    expect(results.get('alpha')?.protectionCodes).toContain('BACKUP_RETENTION_NEWEST_THREE');
    expect(results.get('bravo')?.protectionCodes).toContain('BACKUP_RETENTION_NEWEST_THREE');
    expect(results.get('charlie')?.protectionCodes).toContain('BACKUP_RETENTION_NEWEST_THREE');
    expect(results.get('delta')?.eligible).toBe(true);
  });

  it('ranks newest copies by immutable capture time, not later reverification time', () => {
    const olderReverified = backup({
      id: 'older-reverified',
      capturedAt: new Date('2026-08-01T00:00:00.000Z'),
      verification: {
        kind: 'PUBLICATION_READ_BACK', publicationId: '11111111-1111-4111-8111-111111111111',
        manifestSha256: 'a'.repeat(64), verifiedAt: new Date('2026-09-20T00:00:00.000Z'),
      },
    });
    const newerCaptures = [1, 2, 3].map((day) => backup({
      id: `newer-${day}`,
      capturedAt: new Date(`2026-09-${String(10 + day).padStart(2, '0')}T00:00:00.000Z`),
      verification: {
        kind: 'PUBLICATION_READ_BACK', publicationId: `22222222-2222-4222-8222-22222222222${day}`,
        manifestSha256: 'b'.repeat(64), verifiedAt: new Date(`2026-09-${String(10 + day).padStart(2, '0')}T01:00:00.000Z`),
      },
    }));
    const results = new Map(planBackupRetention({ now: NOW, backups: [olderReverified, ...newerCaptures] })
      .map((item) => [item.backupId, item]));
    expect(results.get('older-reverified')?.protectionCodes).not.toContain('BACKUP_RETENTION_NEWEST_THREE');
    expect(newerCaptures.every((copy) => results.get(copy.id)?.protectionCodes
      .includes('BACKUP_RETENTION_NEWEST_THREE'))).toBe(true);
  });

  it('ranks copies independently per site and repository', () => {
    const copies = [
      ...[0, 1, 2, 3].map((index) => backup({ id: `a-${index}`, siteKey: 'a' })),
      ...[0, 1, 2, 3].map((index) => backup({ id: `b-${index}`, siteKey: 'b' })),
      ...[0, 1, 2, 3].map((index) => backup({ id: `r-${index}`, repositoryId: 'repo-b' })),
    ];
    const results = planBackupRetention({ now: NOW, backups: copies });
    expect(results.filter((item) => item.eligible)).toHaveLength(3);
  });

  it('protects active operations, active/uncertain holds, and uncertain lifecycle state', () => {
    const copies = [
      backup({ id: 'active', hasActiveRetentionOperation: true }),
      backup({ id: 'held', restoreHold: 'ACTIVE' }),
      backup({ id: 'hold-uncertain', restoreHold: 'UNCERTAIN' }),
      backup({ id: 'state-uncertain', lifecycleState: 'UNCERTAIN' }),
    ];
    const codes = planBackupRetention({ now: NOW, backups: copies }).flatMap((item) => item.protectionCodes);
    expect(codes).toContain('BACKUP_RETENTION_ACTIVE_OPERATION');
    expect(codes).toContain('BACKUP_RETENTION_RESTORE_HOLD');
    expect(codes).toContain('BACKUP_RETENTION_RESTORE_HOLD_UNCERTAIN');
    expect(codes).toContain('BACKUP_RETENTION_LIFECYCLE_UNCERTAIN');
  });

  it('fails closed for an invalid clock, invalid evidence time, and future verification', () => {
    expect(decision(backup({ id: 'clock' }), new Date(Number.NaN)).protectionCodes)
      .toContain('BACKUP_RETENTION_INVALID_CLOCK');
    expect(decision(backup({ id: 'invalid', verification: {
      kind: 'PUBLICATION_READ_BACK', publicationId: 'p', manifestSha256: 'a'.repeat(64), verifiedAt: new Date(Number.NaN),
    } })).protectionCodes).toContain('BACKUP_RETENTION_UNVERIFIED');
    expect(decision(backup({ id: 'future', ageMs: -1 })).protectionCodes)
      .toContain('BACKUP_RETENTION_FUTURE_TIMESTAMP');
  });

  it('fails closed for malformed runtime provenance even when supplied as typed strings', () => {
    const malformed = [
      backup({ id: 'empty-publication', verification: {
        kind: 'PUBLICATION_READ_BACK', publicationId: '', manifestSha256: 'a'.repeat(64), verifiedAt: new Date(0),
      } }),
      backup({ id: 'malformed-publication', verification: {
        kind: 'PUBLICATION_READ_BACK', publicationId: 'not-a-uuid', manifestSha256: 'a'.repeat(64), verifiedAt: new Date(0),
      } }),
      backup({ id: 'uppercase-digest', verification: {
        kind: 'PUBLICATION_READ_BACK', publicationId: '11111111-1111-4111-8111-111111111111', manifestSha256: 'A'.repeat(64), verifiedAt: new Date(0),
      } }),
      backup({ id: 'short-digest', verification: {
        kind: 'PUBLICATION_READ_BACK', publicationId: '11111111-1111-4111-8111-111111111111', manifestSha256: 'a'.repeat(63), verifiedAt: new Date(0),
      } }),
    ];
    expect(planBackupRetention({ now: NOW, backups: malformed })
      .every((item) => item.protectionCodes.includes('BACKUP_RETENTION_UNVERIFIED'))).toBe(true);
  });

  it('fails closed when a valid-date anchor plus retention overflows the Date range', () => {
    const nearMaximum = new Date(8_640_000_000_000_000 - 1);
    const copies = ['a', 'b', 'c', 'z'].map((id) => backup({
      id,
      capturedAt: new Date(nearMaximum.getTime() - 2),
      verification: {
        kind: 'PUBLICATION_READ_BACK', publicationId: '11111111-1111-4111-8111-111111111111',
        manifestSha256: 'a'.repeat(64), verifiedAt: new Date(nearMaximum.getTime() - 1),
      },
    }));
    const target = planBackupRetention({ now: nearMaximum, backups: copies })
      .find((item) => item.backupId === 'z');
    expect(target).toMatchObject({ eligible: false, expiresAt: null });
    expect(target?.protectionCodes).toContain('BACKUP_RETENTION_INVALID_EXPIRY');
    expect(target?.protectionCodes).not.toContain('BACKUP_RETENTION_NEWEST_THREE');
  });

  it('defines legal/idempotent lifecycle and operation transitions', () => {
    expect(canTransitionBackupArtifactLifecycle('AVAILABLE', 'AVAILABLE')).toBe(true);
    expect(canTransitionBackupArtifactLifecycle('AVAILABLE', 'DELETE_REQUESTED')).toBe(true);
    expect(canTransitionBackupArtifactLifecycle('DELETED', 'AVAILABLE')).toBe(false);
    expect(() => assertBackupArtifactLifecycleTransition('DELETED', 'AVAILABLE')).toThrow(/Illegal/);
    expect(canTransitionBackupRetentionOperation('RUNNING', 'RUNNING')).toBe(true);
    expect(canTransitionBackupRetentionOperation('RUNNING', 'PARTIAL')).toBe(true);
    expect(canTransitionBackupRetentionOperation('SUCCEEDED', 'RUNNING')).toBe(false);
    expect(() => assertBackupRetentionOperationTransition('SUCCEEDED', 'RUNNING')).toThrow(/Illegal/);
  });
});
