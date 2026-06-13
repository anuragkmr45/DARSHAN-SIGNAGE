import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

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
  process.env.ADMIN_PASSWORD = 'LocalDev@123';
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
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
    process.env.CORS_ORIGINS = 'https://10.20.0.30';
    process.env.APP_PUBLIC_BASE_URL = 'https://10.20.0.30';
    process.env.SOCKET_ALLOWED_ORIGINS = 'https://10.20.0.31, https://10.20.0.32';

    const { getSocketAllowedOrigins } = await loadSocketServer();

    expect(getSocketAllowedOrigins()).toEqual(['https://10.20.0.31', 'https://10.20.0.32']);
  });

  it('builds Socket.IO options from realtime config', async () => {
    applyRequiredEnv();
    process.env.NODE_ENV = 'production';
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
    process.env.SOCKET_ALLOWED_ORIGINS = 'https://cms.example.com';

    const { getSocketServerOptions } = await loadSocketServer();
    const origin = (getSocketServerOptions().cors as any).origin as Function;

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
    process.env.CORS_ORIGINS = 'https://10.20.0.30';

    const { getSocketServerOptions } = await loadSocketServer();

    expect(getSocketServerOptions().transports).toEqual(['websocket', 'polling']);
  });

  it('can disable Socket.IO polling explicitly after websocket-only validation', async () => {
    applyRequiredEnv();
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://10.20.0.30';
    process.env.REALTIME_SOCKET_ALLOW_POLLING = 'false';

    const { getSocketServerOptions } = await loadSocketServer();

    expect(getSocketServerOptions().transports).toEqual(['websocket']);
  });
});
