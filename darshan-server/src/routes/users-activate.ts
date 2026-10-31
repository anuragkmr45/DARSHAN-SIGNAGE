import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createUserRepository } from '@/db/repositories/user';
import { hashPassword, validatePasswordStrength } from '@/auth/password';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';
import { broadcastSessionInvalidation } from '@/realtime/session-invalidation';
import { getDatabase, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { parseInviteExpiry, parseInviteToken } from '@/auth/invite-state';

const logger = createLogger('user-activate-route');

const activateSchema = z.object({
  token: z.string().trim().regex(/^[0-9a-fA-F]{32}$/, 'Invalid activation token'),
  password: z.string().min(8),
});

export async function userActivateRoutes(fastify: FastifyInstance) {
  const userRepo = createUserRepository();

  fastify.post<{ Body: typeof activateSchema._type }>(
    apiEndpoints.userActivate.activate,
    {
      schema: {
        description: 'Activate invited user with token',
        tags: ['Users'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = activateSchema.parse(request.body);
        const token = parseInviteToken(data.token);
        if (!token) throw AppError.badRequest('Invalid activation token');
        const user = await userRepo.findByInviteToken(token);
        if (!user) throw AppError.notFound('Invalid or expired token');

        validatePasswordStrength(data.password);
        const passwordHash = await hashPassword(data.password);
        const updated = await getDatabase().transaction(async (tx) => {
          const [current] = await tx.select().from(schema.users)
            .where(eq(schema.users.id, user.id)).for('update');
          const invite = current?.ext as (Record<string, unknown> & {
            invite_token?: string;
            invite_status?: string;
            invite_expires_at?: string;
          }) | null;
          if (!current || current.deleted_at || !current.is_active ||
              String(invite?.invite_token ?? '').toLowerCase() !== token ||
              invite?.invite_status !== 'PENDING') {
            throw AppError.notFound('Invalid or expired token');
          }
          const expiresAt = parseInviteExpiry(invite?.invite_expires_at);
          if (!expiresAt || expiresAt.getTime() <= Date.now()) {
            throw AppError.badRequest('Invite token expired');
          }
          return userRepo.update(current.id, {
            password_hash: passwordHash,
            ext: {
              ...invite,
              invite_token: null,
              invite_expires_at: null,
              invite_status: 'ACTIVATED',
              activated_at: new Date().toISOString(),
            },
          }, tx);
        });
        if (!updated) throw AppError.notFound('Invalid or expired token');
        await broadcastSessionInvalidation([user.id]);
        return reply.send({ success: true, user_id: updated.id });
      } catch (error) {
        logger.error(error, 'Activate user error');
        return respondWithError(reply, error);
      }
    }
  );
}
