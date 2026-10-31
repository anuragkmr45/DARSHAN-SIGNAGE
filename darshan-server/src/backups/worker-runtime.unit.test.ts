import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openRepository: vi.fn(), createV1Helper: vi.fn(), createBroker: vi.fn(),
  broker: { capability: { repository_id: '11111111-1111-4111-8111-111111111111' }, inspect: vi.fn(), validateEvidence: vi.fn() },
  poolQuery: vi.fn(),
}));

vi.mock('@/config', () => ({ config: {
  NODE_ENV: 'production', BACKUP_REPOSITORY_KIND: 'LOCAL_FILESYSTEM', BACKUP_LOCAL_PROTOCOL: 'V2_BROKER',
  LOG_LEVEL: 'info',
  BACKUP_BROKER_SOCKET_PATH: '/run/darshan/broker.sock', BACKUP_BROKER_HELPER_VERSION: '2', BACKUP_BROKER_POLICY_SHA256: 'a'.repeat(64),
  BACKUP_SITE_ID: 'site-a', BACKUP_REPOSITORY_ID: '11111111-1111-4111-8111-111111111111', BACKUP_MANIFEST_PUBLIC_KEYRING_PATH: '/run/darshan/keyring.json',
  DARSHAN_RELEASE_ID: 'release-1', SIGNHEX_DEPLOYMENT_ID: 'deployment-1', DARSHAN_COMPATIBILITY_GENERATION: 1,
  BACKUP_ENCRYPTION_KEY_ID: 'age-key', BACKUP_CAPSULE_GENERATION: 'capsule-1', BACKUP_CAPSULE_SHA256: 'b'.repeat(64),
  BACKUP_WORKER_SPOOL_ROOT: '/var/lib/darshan/worker-spool', BACKUP_WORKER_SPOOL_DEVICE_ID: '1', BACKUP_WORKER_SPOOL_OWNER_UID: 1000, BACKUP_WORKER_SPOOL_OWNER_GID: 1000,
} }));
vi.mock('@/db', () => ({ getDatabasePool: () => ({ query: mocks.poolQuery }) }));
vi.mock('./local-repository', async (importOriginal) => ({ ...await importOriginal<typeof import('./local-repository')>(), openLocalRepository: mocks.openRepository }));
vi.mock('./backup-host-helper', () => ({ createBackupHostHelperRuntime: mocks.createV1Helper }));
vi.mock('./backup-broker-worker-adapter', () => ({ BackupBrokerWorkerAdapter: { create: mocks.createBroker } }));

import { createLocalBackupWorkerRuntime } from './worker-runtime.js';

describe('local backup worker runtime v2 isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.createBroker.mockResolvedValue(mocks.broker); });

  it('constructs only broker/spool dependencies and never opens repository or v1 helper', async () => {
    const runtime = await createLocalBackupWorkerRuntime();
    expect(runtime?.runDependencies).toMatchObject({ protocol: 'V2_BROKER', broker: mocks.broker });
    expect(mocks.createBroker).toHaveBeenCalledOnce();
    expect(mocks.openRepository).not.toHaveBeenCalled();
    expect(mocks.createV1Helper).not.toHaveBeenCalled();
  });

  it('inspects the sealed capture and preserves broker PREPARED when SQL intent is missing', async () => {
    const runtime = await createLocalBackupWorkerRuntime();
    mocks.poolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: '33333333-3333-4333-8333-333333333333', generation: '7' }] });
    mocks.broker.inspect.mockResolvedValueOnce({ operation: 'INSPECT_PUBLICATION', status: 'PREPARED' });
    await expect(runtime!.inspectPublication({ id: '22222222-2222-4222-8222-222222222222', attempt_id: '44444444-4444-4444-8444-444444444444',
      deadline_at: new Date(Date.now() + 60_000), cancellation_requested_at: null } as never)).resolves.toBe('PRESERVE');
    expect(mocks.broker.inspect).toHaveBeenCalledOnce();
  });

  it('validates and preserves broker COMMITTED when SQL intent is missing', async () => {
    const runtime = await createLocalBackupWorkerRuntime();
    mocks.poolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: '33333333-3333-4333-8333-333333333333', generation: '7' }] });
    mocks.broker.inspect.mockResolvedValueOnce({ operation: 'INSPECT_PUBLICATION', status: 'COMMITTED',
      evidence: { canonical_signed_manifest_base64: Buffer.from('signed').toString('base64') } });
    await expect(runtime!.inspectPublication({ id: '22222222-2222-4222-8222-222222222222', attempt_id: '44444444-4444-4444-8444-444444444444',
      deadline_at: new Date(Date.now() + 60_000), cancellation_requested_at: null } as never)).resolves.toBe('PRESERVE');
    expect(mocks.broker.validateEvidence).toHaveBeenCalledOnce();
  });
});
