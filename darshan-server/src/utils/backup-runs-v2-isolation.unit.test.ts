import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openRepository: vi.fn(), requestCapsule: vi.fn(), runBrokered: vi.fn(), runV1: vi.fn() }));
vi.mock('@/config', () => ({ config: { NODE_ENV: 'production', BACKUP_REPOSITORY_KIND: 'LOCAL_FILESYSTEM', BACKUP_SITE_ID: 'site-a',
  DARSHAN_RELEASE_ID: 'release-1', BACKUP_ENCRYPTION_RECIPIENT: 'age-test', BACKUP_ENCRYPTION_KEY_ID: 'age-key', AGE_PATH: '/age', AGE_SHA256: 'a'.repeat(64), AGE_VERSION: '1' } }));
vi.mock('@/db', () => ({ schema: {}, getDatabase: () => ({ execute: vi.fn().mockResolvedValue({ rows: [{ bytes: '0' }] }) }),
  getDatabasePool: () => ({ query: vi.fn().mockResolvedValue({ rows: [{ migration_id: '0051', checksum_sha256: 'b'.repeat(64) }] }) }) }));
vi.mock('@/s3', () => ({ getS3Client: () => ({ send: vi.fn().mockResolvedValue({ Contents: [], IsTruncated: false }) }),
  deleteObject: vi.fn(), getPresignedUrl: vi.fn(), putFile: vi.fn() }));
vi.mock('@/utils/runtime-dependencies', () => ({ getResolvedPgDumpPath: () => '/pg_dump', getResolvedTarPath: () => '/tar' }));
vi.mock('@/utils/off-host-backup', () => ({ createOffHostBackupManifest: vi.fn(), createOffHostBackupPolicy: vi.fn(), getOffHostBackupClient: vi.fn(), uploadOffHostFile: vi.fn(), uploadOffHostManifest: vi.fn(), verifyOffHostBackupManifest: vi.fn() }));
vi.mock('@/utils/off-host-backup-location', () => ({ offHostBackupObjectKey: vi.fn() }));
vi.mock('@/deployment/backup-contract', () => ({ BACKUP_OBJECT_SOURCES: [], isBackupObjectAllowed: () => true }));
vi.mock('@/backups/coordination', () => ({ transitionBackupStage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/backups/local-repository', () => ({ openLocalRepository: mocks.openRepository }));
vi.mock('@/backups/consistent-capture', () => ({ runConsistentCapture: vi.fn() }));
vi.mock('@/backups/configuration-capsule', () => ({ requestConfigurationCapsule: mocks.requestCapsule }));
vi.mock('@/backups/local-backup-orchestrator', () => ({ runLocalEncryptedBackup: mocks.runV1 }));
vi.mock('@/backups/brokered-backup-orchestrator', () => ({ runBrokeredEncryptedBackup: mocks.runBrokered }));
vi.mock('@/maintenance', () => ({ MaintenanceCoordinator: class {} }));

import { runFullBackup } from './backup-runs.js';

describe('runFullBackup v2 repository isolation', () => {
  it('dispatches V2 without opening repository or invoking the v1 capsule helper', async () => {
    mocks.runBrokered.mockResolvedValue(undefined);
    const deadline = new Date(Date.now() + 60_000);
    await runFullBackup(randomUUID(), randomUUID(), deadline, new AbortController().signal, {
      protocol: 'V2_BROKER', broker: {} as never,
      spool: { root: '/tmp', deviceId: '1', ownerUid: 0, ownerGid: 0 },
    });
    expect(mocks.runBrokered).toHaveBeenCalledOnce();
    expect(mocks.runBrokered.mock.calls[0][0].deadlineAt).toBe(deadline);
    expect(mocks.openRepository).not.toHaveBeenCalled();
    expect(mocks.requestCapsule).not.toHaveBeenCalled();
    expect(mocks.runV1).not.toHaveBeenCalled();
  });
});
