import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { apiEndpoints } from '@/config/apiEndpoints';
import { schema } from '@/db';
import { PERMISSION_ACTIONS, PERMISSION_SUBJECTS } from '@/rbac/permissions';
import { AppError } from '@/utils/app-error';
import { respondWithError } from '@/utils/errors';

/** Coarse UI visibility only. Current CASL conditions, denials and inheritance
 * are evaluated by the server; no role graph or record access is delegated. */
export async function selfAuthorizationRoutes(fastify: FastifyInstance) {
  fastify.get(apiEndpoints.auth.authorization, { schema: { tags: ['Auth'], security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    try {
      const token = extractTokenFromHeader(request.headers.authorization); if (!token) throw AppError.unauthorized();
      const payload = await verifyAccessToken(token); z.object({}).strict().parse(request.query);
      const result = await withCurrentMutationAuthorization(payload, async context => {
        const [user] = await context.executor.select({ role_id: schema.users.role_id }).from(schema.users).where(eq(schema.users.id, context.actor.userId));
        if (!user) throw AppError.unauthorized();
        const capabilities: Array<{ action: string; subject: string }> = [];
        // Expands manage/all according to actual CASL semantics, retaining
        // inversion/precedence. Conditional positives are potential visibility,
        // never an unconditional grant for a resource instance.
        for (const action of PERMISSION_ACTIONS) for (const subject of PERMISSION_SUBJECTS) {
          let permitted = false;
          try { permitted = context.ability.can(action, subject); } catch { /* Unsupported rules fail closed. */ }
          if (permitted) capabilities.push({ action, subject });
        }
        return { version: 1 as const, user_id: context.actor.userId, role: { id: user.role_id, name: context.actor.roleName },
          department_id: context.actor.departmentId ?? null, department_ids: [...new Set(context.actor.departmentIds ?? [])].sort(), capabilities };
      }, { userLock: 'share', sessionLock: 'share' });
      return reply.send(result);
    } catch (error) { return respondWithError(reply, error); }
  });
}
