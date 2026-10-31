import { describe, expect, it } from 'vitest';
import {
  backupScheduleCron,
  createBackupRepositoryPolicy,
  getDailyScheduleIdentity,
} from './policy';

describe('backup policy', () => {
  it('requires the site-owned local repository layout', () => {
    expect(createBackupRepositoryPolicy({
      kind: 'LOCAL_FILESYSTEM',
      siteId: 'site-a',
      root: '/var/lib/darshan/site-a/backup-repository',
    })).toEqual({
      kind: 'LOCAL_FILESYSTEM',
      siteId: 'site-a',
      root: '/var/lib/darshan/site-a/backup-repository',
    });
    expect(() => createBackupRepositoryPolicy({
      kind: 'LOCAL_FILESYSTEM',
      siteId: 'site-a',
      root: '/tmp/backups',
    })).toThrow('must end with');
  });

  it('keeps legacy off-host support explicit', () => {
    expect(createBackupRepositoryPolicy({ kind: 'LEGACY_OFF_HOST', siteId: 'site-a' })).toEqual({
      kind: 'LEGACY_OFF_HOST',
      siteId: 'site-a',
    });
  });

  it('uses one deployment-time daily identity and timezone', () => {
    expect(getDailyScheduleIdentity(new Date('2026-10-28T05:00:00Z'), 'Asia/Kolkata', '09:00')).toBe('2026-10-28');
    expect(getDailyScheduleIdentity(new Date('2026-10-28T02:00:00Z'), 'Asia/Kolkata', '09:00')).toBe('2026-10-27');
    expect(getDailyScheduleIdentity(new Date('2026-10-27T18:40:00Z'), 'Asia/Kolkata', '09:00')).toBe('2026-10-27');
    expect(backupScheduleCron('09:05')).toBe('5 9 * * *');
  });

  it('coalesces DST gap and fold scheduling to one local-date identity', () => {
    // pg-boss/cron-parser advances the missing 02:30 to 03:30 on spring-forward.
    expect(getDailyScheduleIdentity(
      new Date('2026-03-08T07:30:00.000Z'), 'America/New_York', '02:30'
    )).toBe('2026-03-08');
    // Even if both fall-back 01:30 instants are delivered, the unique local
    // schedule identity admits only one automatic run for the date.
    expect(getDailyScheduleIdentity(
      new Date('2026-11-01T05:30:00.000Z'), 'America/New_York', '01:30'
    )).toBe('2026-11-01');
    expect(getDailyScheduleIdentity(
      new Date('2026-11-01T06:30:00.000Z'), 'America/New_York', '01:30'
    )).toBe('2026-11-01');
  });
});
