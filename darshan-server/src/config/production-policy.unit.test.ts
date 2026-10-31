import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
let tempDir: string;

function secretFile(name: string, value: string) {
  const file = path.join(tempDir, name);
  writeFileSync(file, value, { mode: 0o600 });
  return file;
}

function configureProductionEnv(overrides: NodeJS.ProcessEnv = {}) {
  tempDir = mkdtempSync(path.join(tmpdir(), 'darshan-production-config-'));
  const caPath = secretFile('ca.crt', 'test ca');
  for (const key of [
    'DATABASE_URL',
    'JWT_SECRET',
    'MINIO_ACCESS_KEY',
    'MINIO_SECRET_KEY',
    'VALKEY_URL',
    'REDIS_URL',
    'OBSERVABILITY_METRICS_BEARER_TOKEN',
    'BACKUP_OFFHOST_ACCESS_KEY',
    'BACKUP_OFFHOST_SECRET_KEY',
    'ADMIN_EMAIL',
    'ADMIN_PASSWORD',
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, {
    DOTENV_CONFIG_PATH: secretFile('empty.env', ''),
    NODE_ENV: 'production',
    DATABASE_URL_FILE: secretFile('database-url', 'postgresql://darshan:secret@db.example.test:5432/darshan'),
    DATABASE_TLS_ENABLED: 'true',
    DATABASE_CA_CERT_PATH: caPath,
    JWT_SECRET_FILE: secretFile('jwt-secret', '01234567890123456789012345678901'),
    MINIO_ACCESS_KEY_FILE: secretFile('minio-access-key', 'DarshanAccess1'),
    MINIO_SECRET_KEY_FILE: secretFile('minio-secret-key', 'StrongMinioSecret-123'),
    VALKEY_URL_FILE: secretFile('valkey-url', 'rediss://:StrongValkeyPassword-123@valkey.example.test:6379/0'),
    VALKEY_TLS_ENABLED: 'true',
    VALKEY_AUTH_REQUIRED: 'true',
    VALKEY_CA_CERT_PATH: caPath,
    LOGIN_THROTTLE_PROVIDER: 'valkey',
    BACKUP_INTERVAL_HOURS: '24',
    BACKUP_RETENTION_DAYS: '30',
    BACKUP_REPOSITORY_KIND: 'LEGACY_OFF_HOST',
    BACKUP_SITE_ID: 'site-a',
    BACKUP_SCHEDULE_TIME: '02:30',
    BACKUP_SCHEDULE_TIMEZONE: 'Asia/Kolkata',
    BACKUP_OFFHOST_DESTINATION: 's3://backups.example.test/darshan/site-a',
    BACKUP_OFFHOST_ENDPOINT: 'https://s3.backups.example.test',
    BACKUP_OFFHOST_REGION: 'us-east-1',
    DEVICE_AUTH_MODE: 'signature',
    ...overrides,
  });
}

async function loadConfig() {
  vi.resetModules();
  return import('./index');
}

describe('production config policy', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('defaults websocket device auth to signature-only when production DEVICE_AUTH_MODE is signature', async () => {
    configureProductionEnv();

    const { config } = await loadConfig();

    expect(config.DEVICE_AUTH_MODE).toBe('signature');
    expect(config.DEVICE_SOCKET_LEGACY_AUTH_ALLOWED).toBe(false);
    expect(config.DEVICE_SOCKET_SIGNED_AUTH_ENABLED).toBe(true);
  });

  it('allows websocket legacy compatibility only when production dual mode is explicit and expiring', async () => {
    configureProductionEnv({
      DEVICE_AUTH_MODE: 'dual',
      DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT: '2099-01-01T00:00:00.000Z',
    });

    const { config } = await loadConfig();

    expect(config.DEVICE_SOCKET_LEGACY_AUTH_ALLOWED).toBe(true);
  });

  it('rejects a production signature-only configuration that explicitly leaves websocket legacy auth open', async () => {
    configureProductionEnv({ DEVICE_SOCKET_LEGACY_AUTH_ALLOWED: 'true' });

    await expect(loadConfig()).rejects.toThrow(
      'Production signature-only device authentication forbids DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=true.'
    );
  });

  it('rejects production ADMIN_PASSWORD so demo seed cannot become a bootstrap path', async () => {
    configureProductionEnv({ ADMIN_PASSWORD: 'ShouldNeverBootstrapProd123!' });

    await expect(loadConfig()).rejects.toThrow(
      'ADMIN_PASSWORD is forbidden in production. Use the one-shot protected bootstrap password file instead.'
    );
  });

  it('accepts an explicitly selected site-owned local repository without off-host credentials', async () => {
    configureProductionEnv({
      DARSHAN_PROCESS_ROLE: 'worker',
      BACKUP_REPOSITORY_KIND: 'LOCAL_FILESYSTEM',
      BACKUP_REPOSITORY_ROOT: '/var/lib/darshan/site-a/backup-repository',
      BACKUP_REPOSITORY_DEVICE_ID: '2049',
      BACKUP_REPOSITORY_OWNER_UID: '1000',
      BACKUP_REPOSITORY_OWNER_GID: '1000',
      BACKUP_REPOSITORY_MIN_FREE_BYTES: '1073741824',
      BACKUP_REPOSITORY_ID: 'e7e59c16-0743-4fde-95c4-71853e935acd',
      BACKUP_ENCRYPTION_RECIPIENT: 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p',
      BACKUP_ENCRYPTION_KEY_ID: 'site-a-recovery-2026',
      AGE_PATH: '/usr/local/bin/age',
      AGE_VERSION: '1.3.2',
      AGE_SHA256: 'e'.repeat(64),
      BACKUP_LOCAL_PROTOCOL: 'V1_HELPER',
      BACKUP_CAPSULE_HELPER_PATH: '/usr/local/libexec/darshan-backup-capsule',
      BACKUP_CAPSULE_HELPER_VERSION: '1',
      BACKUP_CAPSULE_HELPER_SHA256: 'c'.repeat(64),
      BACKUP_OFFHOST_DESTINATION: '',
      BACKUP_OFFHOST_ENDPOINT: '',
      BACKUP_OFFHOST_REGION: '',
    });

    const { config } = await loadConfig();
    expect(config.BACKUP_REPOSITORY_KIND).toBe('LOCAL_FILESYSTEM');
  });

  it('rejects a fully pinned local worker when its v1/v2 protocol selection is absent', async () => {
    configureProductionEnv({
      DARSHAN_PROCESS_ROLE: 'worker', BACKUP_REPOSITORY_KIND: 'LOCAL_FILESYSTEM',
      BACKUP_REPOSITORY_ROOT: '/var/lib/darshan/site-a/backup-repository', BACKUP_REPOSITORY_DEVICE_ID: '2049',
      BACKUP_REPOSITORY_OWNER_UID: '1000', BACKUP_REPOSITORY_OWNER_GID: '1000', BACKUP_REPOSITORY_MIN_FREE_BYTES: '1073741824',
      BACKUP_REPOSITORY_ID: 'e7e59c16-0743-4fde-95c4-71853e935acd',
      BACKUP_ENCRYPTION_RECIPIENT: 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p',
      BACKUP_ENCRYPTION_KEY_ID: 'site-a-recovery-2026', AGE_PATH: '/usr/local/bin/age', AGE_VERSION: '1.3.2', AGE_SHA256: 'e'.repeat(64),
      BACKUP_OFFHOST_DESTINATION: '', BACKUP_OFFHOST_ENDPOINT: '', BACKUP_OFFHOST_REGION: '',
    });
    await expect(loadConfig()).rejects.toThrow('requires an explicit BACKUP_LOCAL_PROTOCOL');
  });

  it('rejects private age identity material in production local repository policy', async () => {
    configureProductionEnv({
      BACKUP_REPOSITORY_KIND: 'LOCAL_FILESYSTEM',
      BACKUP_REPOSITORY_ROOT: '/var/lib/darshan/site-a/backup-repository',
      BACKUP_REPOSITORY_DEVICE_ID: '2049',
      BACKUP_REPOSITORY_OWNER_UID: '1000',
      BACKUP_REPOSITORY_OWNER_GID: '1000',
      BACKUP_REPOSITORY_MIN_FREE_BYTES: '1073741824',
      BACKUP_OFFHOST_DESTINATION: '',
      BACKUP_OFFHOST_ENDPOINT: '',
      BACKUP_OFFHOST_REGION: '',
      AGE_IDENTITY_FILE: '/run/secrets/recovery-age-identity',
    });

    await expect(loadConfig()).rejects.toThrow('forbids private age identity field AGE_IDENTITY_FILE');
  });

  it('rejects a local production worker without recipient and pinned tool metadata', async () => {
    configureProductionEnv({
      DARSHAN_PROCESS_ROLE: 'worker',
      BACKUP_REPOSITORY_KIND: 'LOCAL_FILESYSTEM',
      BACKUP_REPOSITORY_ROOT: '/var/lib/darshan/site-a/backup-repository',
      BACKUP_REPOSITORY_DEVICE_ID: '2049',
      BACKUP_REPOSITORY_OWNER_UID: '1000',
      BACKUP_REPOSITORY_OWNER_GID: '1000',
      BACKUP_REPOSITORY_MIN_FREE_BYTES: '1073741824',
      BACKUP_OFFHOST_DESTINATION: '',
      BACKUP_OFFHOST_ENDPOINT: '',
      BACKUP_OFFHOST_REGION: '',
    });

    await expect(loadConfig()).rejects.toThrow('requires repository id, public encryption recipient, and encryption key id');
  });

  it('does not silently infer a production repository kind', async () => {
    configureProductionEnv();
    delete process.env.BACKUP_REPOSITORY_KIND;
    await expect(loadConfig()).rejects.toThrow('Production requires BACKUP_RETENTION_DAYS');
  });

  it('rejects production retention shorter than thirty days', async () => {
    configureProductionEnv({ BACKUP_RETENTION_DAYS: '29' });
    await expect(loadConfig()).rejects.toThrow('must be at least 30');
  });
});
