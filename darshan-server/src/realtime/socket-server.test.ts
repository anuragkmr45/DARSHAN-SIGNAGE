import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ORIGINAL_ENV = { ...process.env };
const secretDirectory = mkdtempSync(join(tmpdir(), 'darshan-socket-server-test-'));
const testCaPath = join(secretDirectory, 'transport-ca.crt');
const productionSecretFiles = {
  DATABASE_URL: join(secretDirectory, 'database-url'),
  JWT_SECRET: join(secretDirectory, 'jwt-secret'),
  MINIO_ACCESS_KEY: join(secretDirectory, 'minio-access-key'),
  MINIO_SECRET_KEY: join(secretDirectory, 'minio-secret-key'),
  VALKEY_URL: join(secretDirectory, 'valkey-url'),
  BACKUP_OFFHOST_ACCESS_KEY: join(secretDirectory, 'backup-offhost-access-key'),
  BACKUP_OFFHOST_SECRET_KEY: join(secretDirectory, 'backup-offhost-secret-key'),
};
writeFileSync(testCaPath, 'test-ca');
writeFileSync(productionSecretFiles.DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:5432/darshan_test');
writeFileSync(productionSecretFiles.JWT_SECRET, '12345678901234567890123456789012');
writeFileSync(productionSecretFiles.MINIO_ACCESS_KEY, 'minioadmin');
writeFileSync(productionSecretFiles.MINIO_SECRET_KEY, 'minioadmin');
writeFileSync(productionSecretFiles.VALKEY_URL, 'rediss://:test-password@127.0.0.1:6379');
writeFileSync(productionSecretFiles.BACKUP_OFFHOST_ACCESS_KEY, 'offhost-access-key');
writeFileSync(productionSecretFiles.BACKUP_OFFHOST_SECRET_KEY, 'offhost-secret-key-value');
for (const filePath of Object.values(productionSecretFiles)) chmodSync(filePath, 0o600);
type OriginValidator = (
  origin: string | undefined,
  callback: (error: Error | null, allowed: boolean) => void
) => void;

async function loadSocketServer() {
  vi.resetModules();
  return await import('./socket-server');
}

function applyRequiredEnv(): void {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/darshan';
  process.env.JWT_SECRET = '12345678901234567890123456789012';
  process.env.MINIO_ACCESS_KEY = 'minioadmin';
  process.env.MINIO_SECRET_KEY = 'minioadmin';
  process.env.ADMIN_EMAIL = 'admin@darshan.invalid';
  process.env.VALKEY_URL = 'redis://127.0.0.1:6379';
  // The developer shell may load a legacy local seed password. Production
  // configuration intentionally rejects it, so origin tests must isolate it.
  delete process.env.ADMIN_PASSWORD;
  for (const key of Object.keys(productionSecretFiles)) delete process.env[`${key}_FILE`];
}

function applyProductionFileBackedSecrets(): void {
  for (const [key, filePath] of Object.entries(productionSecretFiles)) {
    delete process.env[key];
    process.env[`${key}_FILE`] = filePath;
  }
  process.env.DATABASE_TLS_ENABLED = 'true';
  process.env.DATABASE_CA_CERT_PATH = testCaPath;
  process.env.VALKEY_TLS_ENABLED = 'true';
  process.env.VALKEY_AUTH_REQUIRED = 'true';
  process.env.VALKEY_CA_CERT_PATH = testCaPath;
  delete process.env.DARSHAN_DEVICE_AUTH_MODE;
  delete process.env.HEXMON_DEVICE_AUTH_MODE;
  process.env.DEVICE_AUTH_MODE = 'signature';
  process.env.BACKUP_INTERVAL_HOURS = '24';
  process.env.BACKUP_RETENTION_DAYS = '30';
  process.env.BACKUP_OFFHOST_DESTINATION = 's3://backups.example.test/darshan/test';
  process.env.BACKUP_OFFHOST_ENDPOINT = 'https://s3.backups.example.test';
  process.env.BACKUP_OFFHOST_REGION = 'us-east-1';
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

afterAll(() => {
  rmSync(secretDirectory, { recursive: true, force: true });
});

describe('socket-server origin handling', () => {
  it('allows localhost fallback only outside production', async () => {
    applyRequiredEnv();
    process.env.NODE_ENV = 'development';
    process.env.CORS_ORIGINS = '';
    process.env.SOCKET_ALLOWED_ORIGINS = '';
    delete process.env.APP_PUBLIC_BASE_URL;

    const { getHttpAllowedOrigins, getSocketAllowedOrigins, isAllowedOrigin } =
      await loadSocketServer();

    expect(getHttpAllowedOrigins()).toContain('http://localhost:8080');
    expect(getSocketAllowedOrigins()).toContain('http://localhost:8080');
    expect(isAllowedOrigin('http://localhost:8081', getHttpAllowedOrigins())).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173', getHttpAllowedOrigins())).toBe(true);
  });

  it('uses only configured IP-based origins in production', async () => {
    applyRequiredEnv();
    process.env.NODE_ENV = 'production';
    applyProductionFileBackedSecrets();
    process.env.CORS_ORIGINS = 'https://10.20.0.30';
    process.env.SOCKET_ALLOWED_ORIGINS = '';
    process.env.APP_PUBLIC_BASE_URL = 'https://10.20.0.30';

    const { getHttpAllowedOrigins, getSocketAllowedOrigins } = await loadSocketServer();

    expect(getHttpAllowedOrigins()).toEqual(['https://10.20.0.30']);
    expect(getSocketAllowedOrigins()).toEqual(['https://10.20.0.30']);
    expect(getHttpAllowedOrigins()).not.toContain('http://localhost:8080');
  });

  it('prefers explicit socket origins in production', async () => {
    applyRequiredEnv();
    process.env.NODE_ENV = 'production';
    applyProductionFileBackedSecrets();
    process.env.CORS_ORIGINS = 'https://10.20.0.30';
    process.env.APP_PUBLIC_BASE_URL = 'https://10.20.0.30';
    process.env.SOCKET_ALLOWED_ORIGINS = 'https://10.20.0.31, https://10.20.0.32';

    const { getSocketAllowedOrigins } = await loadSocketServer();

    expect(getSocketAllowedOrigins()).toEqual(['https://10.20.0.31', 'https://10.20.0.32']);
  });

  it('builds Socket.IO options from realtime config', async () => {
    applyRequiredEnv();
    process.env.NODE_ENV = 'production';
    applyProductionFileBackedSecrets();
    process.env.CORS_ORIGINS = 'https://10.20.0.30';
    process.env.SOCKET_ALLOWED_ORIGINS = 'https://10.20.0.31';
    process.env.REALTIME_WS_PATH = '/custom/socket.io/';
    process.env.REALTIME_SOCKET_TRANSPORT = 'websocket';
    process.env.REALTIME_SOCKET_ALLOW_POLLING = 'true';
    process.env.REALTIME_WS_PING_INTERVAL_MS = '12345';
    process.env.REALTIME_WS_IDLE_TIMEOUT_MS = '54321';
    process.env.WS_NOTIFICATION_MAX_BYTES = '4096';

    const { getSocketServerOptions } = await loadSocketServer();
    const options = getSocketServerOptions();

    expect(options.path).toBe('/custom/socket.io/');
    expect(options.transports).toEqual(['websocket', 'polling']);
    expect(options.pingInterval).toBe(12345);
    expect(options.pingTimeout).toBe(54321);
    expect(options.maxHttpBufferSize).toBe(4096);
  });

  it('keeps Socket.IO CORS origin checks compatible', async () => {
    applyRequiredEnv();
    process.env.NODE_ENV = 'production';
    applyProductionFileBackedSecrets();
    process.env.SOCKET_ALLOWED_ORIGINS = 'https://cms.example.com';

    const { getSocketServerOptions } = await loadSocketServer();
    const cors = getSocketServerOptions().cors;
    if (!cors || typeof cors !== 'object' || typeof cors.origin !== 'function') {
      throw new Error('Socket.IO CORS origin validator is required');
    }
    const origin = cors.origin as OriginValidator;

    await expect(
      new Promise<boolean>((resolve, reject) => {
        origin('https://cms.example.com', (error: Error | null, allowed: boolean) => {
          if (error) reject(error);
          else resolve(allowed);
        });
      })
    ).resolves.toBe(true);

    await expect(
      new Promise<boolean>((resolve, reject) => {
        origin('https://evil.example.com', (error: Error | null, allowed: boolean) => {
          if (error) reject(error);
          else resolve(allowed);
        });
      })
    ).rejects.toThrow('CORS origin not allowed');
  });

  it('defaults Socket.IO to websocket with polling fallback for compatibility', async () => {
    applyRequiredEnv();
    process.env.NODE_ENV = 'production';
    applyProductionFileBackedSecrets();
    process.env.CORS_ORIGINS = 'https://10.20.0.30';

    const { getSocketServerOptions } = await loadSocketServer();

    expect(getSocketServerOptions().transports).toEqual(['websocket', 'polling']);
  });

  it('can disable Socket.IO polling explicitly after websocket-only validation', async () => {
    applyRequiredEnv();
    process.env.NODE_ENV = 'production';
    applyProductionFileBackedSecrets();
    process.env.CORS_ORIGINS = 'https://10.20.0.30';
    process.env.REALTIME_SOCKET_ALLOW_POLLING = 'false';

    const { getSocketServerOptions } = await loadSocketServer();

    expect(getSocketServerOptions().transports).toEqual(['websocket']);
  });

  it('rejects memory-backed login throttling in production', async () => {
    applyRequiredEnv();
    process.env.NODE_ENV = 'production';
    applyProductionFileBackedSecrets();
    process.env.LOGIN_THROTTLE_PROVIDER = 'memory';

    await expect(loadSocketServer()).rejects.toThrow(
      'Production login throttling must use Valkey; memory throttling is forbidden.'
    );
  });
});
