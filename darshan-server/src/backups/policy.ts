import { isAbsolute, normalize, sep } from 'node:path';

export const BACKUP_REPOSITORY_KINDS = ['LOCAL_FILESYSTEM', 'LEGACY_OFF_HOST'] as const;
export type BackupRepositoryKind = (typeof BACKUP_REPOSITORY_KINDS)[number];

export type BackupRepositoryPolicy =
  | {
      kind: 'LOCAL_FILESYSTEM';
      siteId: string;
      root: string;
    }
  | {
      kind: 'LEGACY_OFF_HOST';
      siteId: string;
    };

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const DAILY_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function assertIanaTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
  } catch {
    throw new Error(`BACKUP_SCHEDULE_TIMEZONE must be a valid IANA timezone, received ${JSON.stringify(value)}.`);
  }
  return value;
}

export function assertDailyBackupTime(value: string): string {
  if (!DAILY_TIME_PATTERN.test(value)) {
    throw new Error('BACKUP_SCHEDULE_TIME must use 24-hour HH:mm format.');
  }
  return value;
}

export function createBackupRepositoryPolicy(input: {
  kind: BackupRepositoryKind;
  siteId: string;
  root?: string;
}): BackupRepositoryPolicy {
  if (!SITE_ID_PATTERN.test(input.siteId)) {
    throw new Error('BACKUP_SITE_ID must contain only lowercase letters, digits, underscores, or hyphens.');
  }
  if (input.kind === 'LEGACY_OFF_HOST') {
    return { kind: input.kind, siteId: input.siteId };
  }

  if (!input.root || !isAbsolute(input.root)) {
    throw new Error('LOCAL_FILESYSTEM backups require an absolute BACKUP_REPOSITORY_ROOT.');
  }
  const root = normalize(input.root);
  const requiredSuffix = `${sep}${input.siteId}${sep}backup-repository`;
  if (!root.endsWith(requiredSuffix)) {
    throw new Error(`BACKUP_REPOSITORY_ROOT must end with ${requiredSuffix}.`);
  }
  return { kind: input.kind, siteId: input.siteId, root };
}

export function getDailyScheduleIdentity(now: Date, timeZone: string, scheduleTime: string): string {
  assertIanaTimeZone(timeZone);
  assertDailyBackupTime(scheduleTime);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${value.year}-${value.month}-${value.day}`;
  const localTime = `${value.hour}:${value.minute}`;
  if (localTime >= scheduleTime) return localDate;

  // Calendar arithmetic on the already-resolved local date avoids DST gaps,
  // folds, and the near-midnight two-days-back bug caused by elapsed-hour math.
  const [year, month, day] = localDate.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return previous.toISOString().slice(0, 10);
}

export function backupScheduleCron(scheduleTime: string): string {
  assertDailyBackupTime(scheduleTime);
  const [hour, minute] = scheduleTime.split(':').map(Number);
  return `${minute} ${hour} * * *`;
}
