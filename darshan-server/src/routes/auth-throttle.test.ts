import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from './auth';

const mocks = vi.hoisted(() => ({
  appConfig: {
    AUTH_COOKIE_SECURE: false,
    LOGIN_LOCKOUT_WINDOW_SECONDS: 900,
    LOGIN_MAX_ATTEMPTS: 5,
    LOGIN_THROTTLE_FAIL_CLOSED: true,
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
  findByEmail: vi.fn(),
  findById: vi.fn(),
  createSession: vi.fn(),
  revokeByJti: vi.fn(),
  findSessionByJti: vi.fn(),
  verifyPassword: vi.fn(),
  generateAccessToken: vi.fn(),
  extractTokenFromHeader: vi.fn(),
  verifyAccessToken: vi.fn(),
  getIdleTimeoutSeconds: vi.fn(() => 3600),
  throttle: {
    isLocked: vi.fn(),
    recordFailure: vi.fn(),
    reset: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  config: mocks.appConfig,
}));

vi.mock('@/db/repositories/user', () => ({
  createUserRepository: () => ({
    findByEmail: mocks.findByEmail,
    findById: mocks.findById,
  }),
}));

vi.mock('@/db/repositories/session', () => ({
  createSessionRepository: () => ({
    create: mocks.createSession,
    revokeByJti: mocks.revokeByJti,
    findByJti: mocks.findSessionByJti,
  }),
}));

vi.mock('@/db/repositories/role', () => ({
  createRoleRepository: () => ({ findById: vi.fn() }),
}));

vi.mock('@/auth/password', () => ({ verifyPassword: mocks.verifyPassword }));
vi.mock('@/auth/jwt', () => ({
  generateAccessToken: mocks.generateAccessToken,
  extractTokenFromHeader: mocks.extractTokenFromHeader,
  verifyAccessToken: mocks.verifyAccessToken,
}));
vi.mock('@/auth/login-throttle', () => ({
  getLoginThrottleStore: () => mocks.throttle,
}));
vi.mock('@/utils/settings', () => ({
  getIdleTimeoutSeconds: mocks.getIdleTimeoutSeconds,
}));

describe('auth route login throttle fail-closed behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appConfig.LOGIN_THROTTLE_FAIL_CLOSED = true;
    mocks.throttle.isLocked.mockResolvedValue({ status: 'available', locked: false });
    mocks.throttle.recordFailure.mockResolvedValue({ status: 'available', locked: false });
    mocks.throttle.reset.mockResolvedValue({ status: 'available', locked: false });
  });

  async function injectLogin(payload = { email: 'operator@example.test', password: 'WrongPassword123!' }) {
    const server = Fastify();
    server.setErrorHandler((error, _request, reply) => {
      reply.status(error.statusCode ?? 500).send({
        success: false,
        error: {
          code: 'code' in error ? error.code : 'INTERNAL_ERROR',
          message: error.message,
        },
      });
    });
    await server.register(authRoutes);
    try {
      return await server.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
    } finally {
      await server.close();
    }
  }

  it('returns 503 before user lookup when centralized throttle state is unavailable', async () => {
    mocks.throttle.isLocked.mockResolvedValue({ status: 'unavailable' });

    const response = await injectLogin();

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      error: { code: 'AUTH_THROTTLE_UNAVAILABLE' },
    });
    expect(mocks.findByEmail).not.toHaveBeenCalled();
  });

  it('returns 503 instead of invalid credentials when failure recording is unavailable', async () => {
    mocks.findByEmail.mockResolvedValue(null);
    mocks.throttle.recordFailure.mockResolvedValue({ status: 'unavailable' });

    const response = await injectLogin();

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      error: { code: 'AUTH_THROTTLE_UNAVAILABLE' },
    });
    expect(mocks.throttle.recordFailure).toHaveBeenCalledOnce();
  });

  it('keeps non-production fail-open compatibility explicit when configured', async () => {
    mocks.appConfig.LOGIN_THROTTLE_FAIL_CLOSED = false;
    mocks.findByEmail.mockResolvedValue(null);
    mocks.throttle.recordFailure.mockResolvedValue({ status: 'unavailable' });

    const response = await injectLogin();

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });
});
