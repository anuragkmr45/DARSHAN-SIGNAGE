import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { loginSchema } from '@/schemas/auth';
import { createUserRepository } from '@/db/repositories/user';
import { createSessionRepository } from '@/db/repositories/session';
import { verifyPassword } from '@/auth/password';
import { generateAccessToken, extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { config as appConfig } from '@/config';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { getLoginThrottleStore } from '@/auth/login-throttle';
import { AppError } from '@/utils/app-error';
import { createRoleRepository } from '@/db/repositories/role';
import { getIdleTimeoutSeconds } from '@/utils/settings';
import { getDatabase, schema } from '@/db';
import { eq } from 'drizzle-orm';

const logger = createLogger('auth-routes');
const { TOO_MANY_REQUESTS } = HTTP_STATUS;

export async function authRoutes(fastify: FastifyInstance) {
  const userRepo = createUserRepository();
  const sessionRepo = createSessionRepository();
  const roleRepo = createRoleRepository();
  const loginThrottle = getLoginThrottleStore();
  fastify.addHook('onClose', async () => {
    await loginThrottle.close();
  });

  // Login
  fastify.post<{ Body: typeof loginSchema._type }>(
    apiEndpoints.auth.login,
    {
      schema: {
        description: 'Login with email and password',
        tags: ['Auth'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
          },
        },
      },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { email, password } = loginSchema.parse(request.body);

        const throttleKey = `${email.toLowerCase()}\u0000${request.ip}`;
        const lockoutWindowMs = appConfig.LOGIN_LOCKOUT_WINDOW_SECONDS * 1000;
        const locked = await loginThrottle.isLocked(throttleKey, lockoutWindowMs);
        if (locked.status === 'unavailable' && appConfig.LOGIN_THROTTLE_FAIL_CLOSED) {
          throw new AppError({
            statusCode: 503,
            code: 'AUTH_THROTTLE_UNAVAILABLE',
            message: 'Login protection is temporarily unavailable. Try again later.',
          });
        }
        if (locked.status === 'available' && locked.locked) {
          throw new AppError({
            statusCode: TOO_MANY_REQUESTS,
            code: 'RATE_LIMITED',
            message: 'Too many failed attempts. Try again later.',
            details: { retry_after_seconds: locked.retryAfter },
          });
        }

        const user = await userRepo.findByEmail(email);
        if (!user) {
          const failure = await loginThrottle.recordFailure(throttleKey, appConfig.LOGIN_MAX_ATTEMPTS, lockoutWindowMs);
          if (failure.status === 'unavailable' && appConfig.LOGIN_THROTTLE_FAIL_CLOSED) {
            throw new AppError({ statusCode: 503, code: 'AUTH_THROTTLE_UNAVAILABLE', message: 'Login protection is temporarily unavailable. Try again later.' });
          }
          throw AppError.unauthorized('Invalid credentials');
        }

        const passwordValid = await verifyPassword(password, user.password_hash);
        if (!passwordValid) {
          const failure = await loginThrottle.recordFailure(throttleKey, appConfig.LOGIN_MAX_ATTEMPTS, lockoutWindowMs);
          if (failure.status === 'unavailable' && appConfig.LOGIN_THROTTLE_FAIL_CLOSED) {
            throw new AppError({ statusCode: 503, code: 'AUTH_THROTTLE_UNAVAILABLE', message: 'Login protection is temporarily unavailable. Try again later.' });
          }
          throw AppError.unauthorized('Invalid credentials');
        }
        const reset = await loginThrottle.reset(throttleKey);
        if (reset.status === 'unavailable' && appConfig.LOGIN_THROTTLE_FAIL_CLOSED) {
          throw new AppError({ statusCode: 503, code: 'AUTH_THROTTLE_UNAVAILABLE', message: 'Login protection is temporarily unavailable. Try again later.' });
        }

        if (!user.is_active) {
          throw AppError.forbidden('User account is inactive');
        }

        // Serialize session issuance with account update/tombstone. If login
        // commits first, the waiting account change removes this session; if
        // the account change commits first, the credential/state recheck below
        // prevents a session from being created from the stale pre-change row.
        const issued = await getDatabase().transaction(async (tx) => {
          const [current] = await tx
            .select({
              id: schema.users.id,
              email: schema.users.email,
              password_hash: schema.users.password_hash,
              first_name: schema.users.first_name,
              last_name: schema.users.last_name,
              role_id: schema.users.role_id,
              department_id: schema.users.department_id,
              is_active: schema.users.is_active,
              deleted_at: schema.users.deleted_at,
            })
            .from(schema.users)
            .where(eq(schema.users.id, user.id))
            .for('update');

          if (!current || current.deleted_at || current.password_hash !== user.password_hash) {
            return { status: 'stale_credentials' as const };
          }
          if (!current.is_active) {
            return { status: 'inactive' as const };
          }

          const [role] = await tx
            .select({ id: schema.roles.id, name: schema.roles.name })
            .from(schema.roles)
            .where(eq(schema.roles.id, current.role_id))
            .for('share');
          if (!role) {
            return { status: 'missing_role' as const };
          }

          const access = await generateAccessToken(
            current.id,
            current.email,
            role.id,
            role.name,
            current.department_id,
            { expiresInSeconds: getIdleTimeoutSeconds() }
          );
          await tx.insert(schema.sessions).values({
            user_id: current.id,
            access_jti: access.jti,
            expires_at: access.expiresAt,
          });

          return { status: 'issued' as const, current, role, ...access };
        });

        if (issued.status === 'inactive') {
          throw AppError.forbidden('User account is inactive');
        }
        if (issued.status === 'missing_role') {
          throw AppError.forbidden('Role not found');
        }
        if (issued.status === 'stale_credentials') {
          throw AppError.unauthorized('Credentials or account state changed during login. Please try again.');
        }

        const { current, role, token, expiresAt } = issued;
        const csrfToken = randomUUID();

        // Issue cookies (JWT as HttpOnly, CSRF as readable token)
        const secure = appConfig.AUTH_COOKIE_SECURE;
        const maxAge = Math.max(Math.floor((expiresAt.getTime() - Date.now()) / 1000), 0);
        const accessCookie = [
          `access_token=${token}`,
          'Path=/',
          'HttpOnly',
          'SameSite=Lax',
          `Max-Age=${maxAge}`,
          secure ? 'Secure' : '',
        ]
          .filter(Boolean)
          .join('; ');
        const csrfCookie = [
          `csrf_token=${csrfToken}`,
          'Path=/',
          'SameSite=Lax',
          `Max-Age=${maxAge}`,
          secure ? 'Secure' : '',
        ]
          .filter(Boolean)
          .join('; ');
        reply.header('Set-Cookie', [accessCookie, csrfCookie]);

        const includeTokensInBody = appConfig.NODE_ENV === 'development';
        const responseBody: {
          user: {
            id: string;
            email: string;
            first_name: string | null;
            last_name: string | null;
            role: string;
            role_id: string;
            department_id: string | null;
          };
          expiresAt: string;
          token?: string;
          csrf_token?: string;
        } = {
          user: {
            id: current.id,
            email: current.email,
            first_name: current.first_name,
            last_name: current.last_name,
            role: role.name,
            role_id: role.id,
            department_id: current.department_id ?? null,
          },
          expiresAt: expiresAt.toISOString(),
        };
        if (includeTokensInBody) {
          responseBody.token = token;
          responseBody.csrf_token = csrfToken;
        }

        return reply.send(responseBody);
      } catch (error) {
        logger.error(error, 'Login error');
        return respondWithError(reply, error);
      }
    }
  );

  // Logout
  fastify.post(
    apiEndpoints.auth.logout,
    {
      schema: {
        description: 'Logout and revoke token',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secure = appConfig.AUTH_COOKIE_SECURE;
      const expired = 'Max-Age=0; Path=/; SameSite=Lax' + (secure ? '; Secure' : '');

      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (token) {
          try {
            const payload = await verifyAccessToken(token);
            await sessionRepo.revokeByJti(payload.jti);
          } catch (tokenError) {
            logger.warn(tokenError, 'Ignoring invalid token during logout');
          }
        }
      } catch (error) {
        logger.warn(error, 'Ignoring logout revoke error');
      } finally {
        reply.header('Set-Cookie', [`access_token=; ${expired}; HttpOnly`, `csrf_token=; ${expired}`]);
      }

      return reply.send({ message: 'Logged out successfully' });
    }
  );

  // Get current user
  fastify.get(
    apiEndpoints.auth.me,
    {
      schema: {
        description: 'Get current authenticated user',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);

        // Check if token is revoked
        const session = await sessionRepo.findByJti(payload.jti);
        if (!session) {
          throw AppError.unauthorized('Token has been revoked');
        }

        const user = await userRepo.findById(payload.sub);
        if (!user) {
          throw AppError.notFound('User not found');
        }

        const role = await roleRepo.findById(user.role_id);

        return reply.send({
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: role?.name ?? null,
          role_id: user.role_id,
          department_id: user.department_id,
          is_active: user.is_active,
          created_at: user.created_at.toISOString(),
          updated_at: user.updated_at.toISOString(),
        });
      } catch (error) {
        logger.error(error, 'Get me error');
        throw AppError.unauthorized('Invalid token');
      }
    }
  );
}
