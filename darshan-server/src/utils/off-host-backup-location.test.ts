import { describe, expect, it } from 'vitest';
import { offHostBackupObjectKey, parseOffHostBackupLocation } from './off-host-backup-location';

describe('off-host backup location', () => {
  it('normalizes a credential-free S3 bucket and prefix', () => {
    expect(parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a/')).toEqual({
      bucket: 'backups.example.test',
      prefix: 'darshan/site-a',
      uri: 's3://backups.example.test/darshan/site-a',
    });
    expect(
      offHostBackupObjectKey(parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a'), 'runs/a/manifest.json')
    ).toBe('darshan/site-a/runs/a/manifest.json');
  });

  it.each([
    'https://backups.example.test/darshan/site-a',
    's3://access:secret@backups.example.test/darshan/site-a',
    's3://backups.example.test',
    's3://backups.example.test/darshan/../site-a',
    's3://backups.example.test/darshan/site-a?unsafe=true',
  ])('rejects ambiguous or unsafe backup destinations: %s', (value) => {
    expect(() => parseOffHostBackupLocation(value)).toThrow();
  });

  it('rejects unsafe relative keys', () => {
    const location = parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a');
    expect(() => offHostBackupObjectKey(location, '../manifest.json')).toThrow();
    expect(() => offHostBackupObjectKey(location, '')).toThrow();
  });
});
