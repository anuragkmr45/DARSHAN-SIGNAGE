import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    DARSHAN_RELEASE_ID: 'test-release',
    WORKER_HEARTBEAT_STALE_MS: 60_000,
    REALTIME_BUS_PROVIDER: 'memory',
    LOGIN_THROTTLE_PROVIDER: 'memory',
    VALKEY_URL: undefined as string | undefined,
    VALKEY_TLS_ENABLED: false,
    VALKEY_CA_CERT_PATH: undefined as string | undefined,
    REALTIME_VALKEY_PUBLISH_TIMEOUT_MS: 2_000,
  },
  execute: vi.fn(),
  query: vi.fn(),
  manifest: vi.fn(),
  send: vi.fn(),
  heartbeat: vi.fn(),
  valkeyCommand: vi.fn(),
  valkeyClose: vi.fn(),
}));

vi.mock('@/config', () => ({ config: mocks.config }));
vi.mock('@/db', () => ({
  getDatabase: () => ({ execute: mocks.execute }),
  getDatabasePool: () => ({ query: mocks.query }),
}));
vi.mock('@/deployment/migration-ledger', () => ({ loadMigrationManifest: mocks.manifest }));
vi.mock('@/s3', () => ({ getS3Client: () => ({ send: mocks.send }) }));
vi.mock('@/runtime/worker-heartbeat', () => ({ getCurrentWorkerHeartbeat: mocks.heartbeat }));
vi.mock('@/realtime/valkey-resp-client', () => ({
  ValkeyCommandClient: vi.fn().mockImplementation((options) => {
    if (options.caCertPath === '/missing/valkey-ca.crt') {
      throw new Error('Unable to read VALKEY_CA_CERT_PATH /missing/valkey-ca.crt');
    }
    return {
      command: mocks.valkeyCommand,
      close: mocks.valkeyClose,
    };
  }),
}));

describe('runtime readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.config, {
      DARSHAN_RELEASE_ID: 'test-release',
      WORKER_HEARTBEAT_STALE_MS: 60_000,
      REALTIME_BUS_PROVIDER: 'memory',
      LOGIN_THROTTLE_PROVIDER: 'memory',
      VALKEY_URL: undefined,
      VALKEY_TLS_ENABLED: false,
      VALKEY_CA_CERT_PATH: undefined,
      REALTIME_VALKEY_PUBLISH_TIMEOUT_MS: 2_000,
    });
  });

  it('reports ready only after every required dependency verifies', async () => {
    const { config } = await import('@/config');
    const { PRODUCTION_BUCKETS } = await import('@/deployment/storage-buckets');
    mocks.execute.mockResolvedValue({ rows: [{}] });
    mocks.manifest.mockResolvedValue([{ id: '0000_test.sql', checksum: 'a'.repeat(64) }]);
    mocks.query.mockResolvedValue({ rows: [{ migration_id: '0000_test.sql', checksum_sha256: 'a'.repeat(64) }] });
    mocks.send.mockResolvedValue({});
    mocks.heartbeat.mockResolvedValue({ release_id: config.DARSHAN_RELEASE_ID, observed_at: new Date() });
    const { collectReadiness } = await import('./readiness');

    await expect(collectReadiness()).resolves.toMatchObject({
      ready: true,
      checks: { database: 'ok', migrations: 'ok', bootstrap: 'ok', minio: 'ok', worker: 'ok' },
    });
    expect(mocks.send).toHaveBeenCalledTimes(PRODUCTION_BUCKETS.length);
    expect(mocks.send.mock.calls.map(([command]) => command.input.Bucket)).toEqual([...PRODUCTION_BUCKETS]);
  });

  it('requires Valkey readiness when login throttling uses Valkey even if realtime fanout does not', async () => {
    const { config } = await import('@/config');
    config.REALTIME_BUS_PROVIDER = 'memory';
    config.LOGIN_THROTTLE_PROVIDER = 'valkey';
    config.VALKEY_URL = 'rediss://:test-password@valkey.example.test:6379';
    mocks.execute.mockResolvedValue({ rows: [{}] });
    mocks.manifest.mockResolvedValue([{ id: '0000_test.sql', checksum: 'a'.repeat(64) }]);
    mocks.query.mockResolvedValue({ rows: [{ migration_id: '0000_test.sql', checksum_sha256: 'a'.repeat(64) }] });
    mocks.send.mockResolvedValue({});
    mocks.heartbeat.mockResolvedValue({ release_id: config.DARSHAN_RELEASE_ID, observed_at: new Date() });
    mocks.valkeyCommand.mockRejectedValue(new Error('valkey unavailable'));
    const { collectReadiness } = await import('./readiness');

    await expect(collectReadiness()).resolves.toMatchObject({
      ready: false,
      checks: { valkey: 'failed' },
    });
    expect(mocks.valkeyCommand).toHaveBeenCalledWith(['PING']);
    expect(mocks.valkeyClose).toHaveBeenCalled();
  });

  it('reports Valkey as failed when readiness cannot construct the TLS client', async () => {
    const { config } = await import('@/config');
    config.REALTIME_BUS_PROVIDER = 'valkey';
    config.VALKEY_URL = 'rediss://:test-password@valkey.example.test:6379';
    config.VALKEY_TLS_ENABLED = true;
    config.VALKEY_CA_CERT_PATH = '/missing/valkey-ca.crt';
    mocks.execute.mockResolvedValue({ rows: [{}] });
    mocks.manifest.mockResolvedValue([{ id: '0000_test.sql', checksum: 'a'.repeat(64) }]);
    mocks.query.mockResolvedValue({ rows: [{ migration_id: '0000_test.sql', checksum_sha256: 'a'.repeat(64) }] });
    mocks.send.mockResolvedValue({});
    mocks.heartbeat.mockResolvedValue({ release_id: config.DARSHAN_RELEASE_ID, observed_at: new Date() });
    const { collectReadiness } = await import('./readiness');

    await expect(collectReadiness()).resolves.toMatchObject({
      ready: false,
      checks: { valkey: 'failed' },
    });
    expect(mocks.valkeyCommand).not.toHaveBeenCalled();
    expect(mocks.valkeyClose).not.toHaveBeenCalled();
  });

  it('fails storage readiness if any required production bucket is unavailable', async () => {
    const { config } = await import('@/config');
    mocks.execute.mockResolvedValue({ rows: [{}] });
    mocks.manifest.mockResolvedValue([{ id: '0000_test.sql', checksum: 'a'.repeat(64) }]);
    mocks.query.mockResolvedValue({ rows: [{ migration_id: '0000_test.sql', checksum_sha256: 'a'.repeat(64) }] });
    mocks.send.mockImplementation((command) => {
      if (command.input.Bucket === 'logs-system') return Promise.reject(new Error('missing bucket'));
      return Promise.resolve({});
    });
    mocks.heartbeat.mockResolvedValue({ release_id: config.DARSHAN_RELEASE_ID, observed_at: new Date() });
    const { collectReadiness } = await import('./readiness');

    await expect(collectReadiness()).resolves.toMatchObject({ ready: false, checks: { minio: 'failed' } });
  });

  it('fails closed for a stale worker while preserving non-sensitive diagnostics', async () => {
    const { config } = await import('@/config');
    mocks.execute.mockResolvedValue({ rows: [{}] });
    mocks.manifest.mockResolvedValue([{ id: '0000_test.sql', checksum: 'a'.repeat(64) }]);
    mocks.query.mockResolvedValue({ rows: [{ migration_id: '0000_test.sql', checksum_sha256: 'a'.repeat(64) }] });
    mocks.send.mockResolvedValue({});
    mocks.heartbeat.mockResolvedValue({
      release_id: config.DARSHAN_RELEASE_ID,
      observed_at: new Date(Date.now() - config.WORKER_HEARTBEAT_STALE_MS - 1),
    });
    const { collectReadiness } = await import('./readiness');

    await expect(collectReadiness()).resolves.toMatchObject({ ready: false, checks: { worker: 'failed' } });
  });

  it('fails closed when the migration ledger checksum differs from the release manifest', async () => {
    const { config } = await import('@/config');
    mocks.execute.mockResolvedValue({ rows: [{}] });
    mocks.manifest.mockResolvedValue([{ id: '0000_test.sql', checksum: 'a'.repeat(64) }]);
    mocks.query.mockResolvedValue({ rows: [{ migration_id: '0000_test.sql', checksum_sha256: 'b'.repeat(64) }] });
    mocks.send.mockResolvedValue({});
    mocks.heartbeat.mockResolvedValue({ release_id: config.DARSHAN_RELEASE_ID, observed_at: new Date() });
    const { collectReadiness } = await import('./readiness');

    await expect(collectReadiness()).resolves.toMatchObject({ ready: false, checks: { migrations: 'failed' } });
  });
});
