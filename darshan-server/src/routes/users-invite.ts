import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { defineAbilityFor, hasGlobalUserManagement, type AppAbility } from '@/rbac';
import { createUserRepository } from '@/db/repositories/user';
import { hashPassword, validatePasswordStrength, verifyPassword } from '@/auth/password';
import { randomBytes } from 'crypto';
import { createLogger } from '@/utils/logger';
import { getDatabase, schema } from '@/db';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';
import { canManageUserTarget } from '@/rbac/policy';
import { directoryReadPredicate, hasDirectoryReadGrant } from '@/rbac/user-directory';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { broadcastSessionInvalidation } from '@/realtime/session-invalidation';
import { subject } from '@casl/ability';
import { parseInviteExpiry, parseInviteToken } from '@/auth/invite-state';

const logger = createLogger('users-invite-routes');
const { CREATED, OK } = HTTP_STATUS;

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'OPERATOR', 'DEPARTMENT']).optional(),
  role_id: z.string().uuid().optional(),
  department_id: z.string().uuid().optional(),
});

const listInvitesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().optional(), // comma-separated: pending,expired,activated
  email: z.string().optional(),
  role: z.enum(['ADMIN', 'OPERATOR', 'DEPARTMENT']).optional(),
  department_id: z.string().uuid().optional(),
  invited_before: z.coerce.date().optional(),
  invited_after: z.coerce.date().optional(),
});

const inviteStatusLookup = {
  pending: 'pending',
  expired: 'expired',
  activated: 'activated',
  approved: 'activated',
  active: 'activated',
} as const;

export function parseInviteStatuses(raw: string | undefined): ('pending' | 'expired' | 'activated')[] | undefined {
  if (raw === undefined) return undefined;
  const statuses = raw.split(',').map((value) => inviteStatusLookup[value.trim().toLowerCase() as keyof typeof inviteStatusLookup]);
  if (statuses.some((status) => !status)) throw AppError.badRequest('Invalid invite status filter.');
  return Array.from(new Set(statuses));
}

const resetPasswordSchema = z
  .object({
    current_password: z.string().min(1).optional(),
    new_password: z.string().min(8).optional(),
  })
  .optional();

const replaceInviteSchema = z.object({
  expected_updated_at: z.string().datetime({ offset: true }),
});

export function builtInInviteRolePredicate(roleName: 'ADMIN' | 'OPERATOR' | 'DEPARTMENT') {
  return and(eq(schema.roles.name, roleName), eq(schema.roles.is_system, true));
}

type ReplaceableInvite = {
  id: string;
  email: string;
  role_id: string;
  department_id: string | null;
  is_active: boolean;
  deleted_at: Date | null;
  ext: unknown;
  role: string | null;
  role_is_system: boolean | null;
};

export const isPendingInvite = (user: ReplaceableInvite): boolean => {
  const ext = user.ext;
  return user.is_active && !user.deleted_at && Boolean(ext && typeof ext === 'object' && !Array.isArray(ext) &&
    ['PENDING', 'EXPIRED'].includes(String((ext as Record<string, unknown>).invite_status)));
};

export const canIssueInviteFor = (ability: AppAbility, actorDepartmentId: string | null | undefined,
  user: ReplaceableInvite): boolean =>
  canManageUserTarget(
    { departmentId: actorDepartmentId, globalUserManagement: hasGlobalUserManagement(ability) },
    { roleName: user.role ?? '', isSystem: user.role_is_system === true, departmentId: user.department_id },
  ) && (ability as unknown as { can: (action: string, target: unknown) => boolean }).can('create', subject('User', {
    id: user.id,
    email: user.email,
    role_id: user.role_id,
    department_id: user.department_id,
    is_active: true,
  }));

const createInviteSerializer =
  (referenceDate: Date, ability: AppAbility, actorDepartmentId: string | null | undefined) =>
    (user: any) => {
      const ext = user.ext || {};
      const inviteToken = parseInviteToken(ext.invite_token);
      const expiresAt = parseInviteExpiry(ext.invite_expires_at);
      let derivedStatus: string | null = null;
      if (isPendingInvite(user) && (!inviteToken || !expiresAt || expiresAt <= referenceDate)) {
        derivedStatus = 'EXPIRED';
      } else if (ext.invite_status) {
        derivedStatus = ext.invite_status;
      } else if (inviteToken) {
        derivedStatus = expiresAt && expiresAt < referenceDate ? 'EXPIRED' : 'PENDING';
      }

      return {
        id: user.id,
        email: user.email,
        role: user.role,
        department_id: user.department_id,
        invite_expires_at: ext.invite_expires_at ?? null,
        invite_status: derivedStatus,
        can_replace: isPendingInvite(user) && canIssueInviteFor(ability, actorDepartmentId, user),
        invited_at: ext.invited_at ?? null,
        is_active: user.is_active,
        created_at: user.created_at.toISOString(),
        updated_at: user.updated_at.toISOString(),
      };
    };

export async function userInviteRoutes(fastify: FastifyInstance) {
  const userRepo = createUserRepository();
  const db = getDatabase();

  fastify.post<{ Body: typeof inviteSchema._type }>(
    apiEndpoints.userInvite.invite,
    {
      schema: {
        description: 'Invite user (admin only)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const data = inviteSchema.parse(request.body);

        // The account needs a non-null credential hash before activation, but
        // this secret is deliberately unrecoverable and never returned. The
        // invitation token is the only onboarding credential exposed to the
        // manager; activation replaces this hash with the invitee's password.
        const placeholderPassword = randomBytes(32).toString('base64url');
        const inviteToken = randomBytes(16).toString('hex');
        const now = new Date();
        const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const passwordHash = await hashPassword(placeholderPassword);
        const { user, targetRole } = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          const [targetRole] = data.role_id
            ? await executor.select().from(schema.roles).where(eq(schema.roles.id, data.role_id))
            : await executor.select().from(schema.roles)
                .where(builtInInviteRolePredicate(data.role ?? 'OPERATOR'));
          if (!targetRole) throw AppError.badRequest('Role not found');
          if (!(ability as any).can('create', subject('User', { email: data.email, role_id: targetRole.id, department_id: data.department_id, is_active: true })) ||
              !canManageUserTarget({ departmentId: actor.departmentId, globalUserManagement: hasGlobalUserManagement(ability) },
                { roleName: targetRole.name, isSystem: targetRole.is_system, departmentId: data.department_id })) {
            throw AppError.forbidden('Forbidden');
          }
          if (data.department_id) {
            const [department] = await executor.select({ id: schema.departments.id }).from(schema.departments)
              .where(eq(schema.departments.id, data.department_id)).for('share');
            if (!department) throw AppError.notFound('Department not found');
          }
          const user = await userRepo.create({
            email: data.email,
            password_hash: passwordHash,
            role_id: targetRole.id,
            department_id: data.department_id,
          }, executor);
          await executor.update(schema.users).set({
            ext: {
              invite_token: inviteToken,
              invite_expires_at: expires.toISOString(),
              invite_status: 'PENDING',
              invited_at: now.toISOString(),
            },
          }).where(eq(schema.users.id, user.id));
          return { user, targetRole };
        }, { roleLock: 'update' });

        return reply.header('Cache-Control', 'no-store').status(CREATED).send({
          id: user.id,
          email: user.email,
          role: targetRole.name,
          department_id: user.department_id,
          invite_token: inviteToken,
          invite_expires_at: expires.toISOString(),
          invite_status: 'PENDING',
          invited_at: now.toISOString(),
        });
      } catch (error) {
        logger.error(error, 'Invite user error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: typeof replaceInviteSchema._type }>(
    apiEndpoints.userInvite.replace,
    {
      schema: {
        description: 'Replace a pending invitation link (old link becomes invalid)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: typeof replaceInviteSchema._type }>, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const data = replaceInviteSchema.parse(request.body);
        const now = new Date();
        const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const replaced = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          const [current] = await executor.select().from(schema.users)
            .where(eq(schema.users.id, id)).for('update');
          if (!current || current.deleted_at) throw AppError.notFound('Invitation not found');
          const [role] = await executor.select().from(schema.roles)
            .where(eq(schema.roles.id, current.role_id));
          if (!role) throw AppError.conflict('Invitation role no longer exists');
          const target = { ...current, role: role.name, role_is_system: role.is_system };
          const globalUserManagement = hasGlobalUserManagement(ability);
          if (!globalUserManagement && !current.is_active) throw AppError.notFound('Invitation not found');
          if (!canManageUserTarget(
            { departmentId: actor.departmentId, globalUserManagement },
            { roleName: role.name, isSystem: role.is_system, departmentId: current.department_id },
          )) throw AppError.notFound('Invitation not found');
          if (!canIssueInviteFor(ability, actor.departmentId, target)) throw AppError.forbidden('Forbidden');
          if (!isPendingInvite(target)) throw AppError.conflict('Invitation is no longer pending');
          if (current.updated_at.getTime() !== new Date(data.expected_updated_at).getTime()) {
            throw new AppError({
              statusCode: 409,
              code: 'INVITATION_CHANGED',
              message: 'Invitation changed. Refresh and try again.',
            });
          }
          const ext = current.ext as Record<string, unknown>;
          let inviteToken: string;
          do { inviteToken = randomBytes(16).toString('hex'); }
          while (inviteToken === ext.invite_token);
          const updated = await userRepo.update(id, {
            ext: {
              ...ext,
              invite_token: inviteToken,
              invite_expires_at: expires.toISOString(),
              invite_status: 'PENDING',
              invite_replaced_at: now.toISOString(),
              invite_replaced_by: actor.userId,
            },
          }, executor);
          if (!updated) throw AppError.notFound('Invitation not found');
          await executor.insert(schema.auditLogs).values({
            user_id: actor.userId,
            action: 'USER_INVITE_LINK_REPLACED',
            entity_type: 'USER',
            entity_id: id,
            ip_address: request.ip,
            created_at: now,
          });
          return { user: updated, role: role.name, inviteToken };
        }, { roleLock: 'update' });
        await broadcastSessionInvalidation([replaced.user.id]);
        return reply.header('Cache-Control', 'no-store').status(OK).send({
          id: replaced.user.id,
          email: replaced.user.email,
          role: replaced.role,
          department_id: replaced.user.department_id,
          invite_token: replaced.inviteToken,
          invite_expires_at: expires.toISOString(),
          invite_status: 'PENDING',
          invite_replaced_at: now.toISOString(),
        });
      } catch (error) {
        logger.error(error, 'Replace invitation error');
        return respondWithError(reply, error);
      }
    },
  );

  // List user invites with filters (admin only)
  fastify.get<{ Querystring: typeof listInvitesQuerySchema._type }>(
    apiEndpoints.userInvite.list,
    {
      schema: {
        description: 'List user invites with filters (admin only)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!hasDirectoryReadGrant(ability)) throw AppError.forbidden('Forbidden');

        const query = listInvitesQuerySchema.parse(request.query);
        const statuses = parseInviteStatuses(query.status);

        let roleId: string | undefined;
        if (query.role) {
          const [targetRole] = await db
            .select()
            .from(schema.roles)
            .where(eq(schema.roles.name, query.role));
          if (targetRole) {
            roleId = targetRole.id;
          } else {
            // If filter by role but role not found, return empty
            return reply.send({
              items: [],
              pagination: {
                page: query.page,
                limit: query.limit,
                total: 0,
              },
            });
          }
        }

        const result = await userRepo.listInvites({
          page: query.page,
          limit: query.limit,
          statuses,
          invited_before: query.invited_before,
          invited_after: query.invited_after,
          email: query.email,
          role_id: roleId,
          department_id: query.department_id,
          visibility: {
            actorUserId: payload.sub,
            actorDepartmentId: payload.department_id,
            global: hasGlobalUserManagement(ability),
            readPredicate: directoryReadPredicate(ability),
          },
        });

        const serializeInvite = createInviteSerializer(new Date(), ability, payload.department_id);

        return reply.status(OK).send({
          items: result.items.map(serializeInvite),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List invites error');
        return respondWithError(reply, error);
      }
    }
  );

  // Legacy: list only pending user invites
  fastify.get(
    apiEndpoints.userInvite.pending,
    {
      schema: {
        description: 'List pending user invites (admin only)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!hasDirectoryReadGrant(ability)) throw AppError.forbidden('Forbidden');

        const result = await userRepo.listInvites({
          page: 1,
          limit: 100,
          statuses: ['pending'],
          visibility: {
            actorUserId: payload.sub,
            actorDepartmentId: payload.department_id,
            global: hasGlobalUserManagement(ability),
            readPredicate: directoryReadPredicate(ability),
          },
        });
        const serializeInvite = createInviteSerializer(new Date(), ability, payload.department_id);

        return reply.status(OK).send({
          items: result.items.map(serializeInvite),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List pending invites error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    apiEndpoints.userInvite.resetPassword,
    {
      schema: {
        description: 'Reset user password (admin only)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const data = resetPasswordSchema.parse(request.body);
        const nextPassword = data?.new_password
          ? data.new_password
          : `${randomBytes(6).toString('hex')}A!`;
        validatePasswordStrength(nextPassword);
        const passwordHash = await hashPassword(nextPassword);
        const user = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          const [current] = await executor.select().from(schema.users)
            .where(eq(schema.users.id, (request.params as any).id)).for('update');
          if (!current || current.deleted_at || (!hasGlobalUserManagement(ability) && !current.is_active)) {
            throw AppError.notFound('User not found');
          }
          const [targetRole] = await executor.select().from(schema.roles).where(eq(schema.roles.id, current.role_id));
          if (!targetRole || !(ability as any).can('update', subject('User', current)) ||
              !canManageUserTarget({ departmentId: actor.departmentId, globalUserManagement: hasGlobalUserManagement(ability) },
                { roleName: targetRole.name, isSystem: targetRole.is_system, departmentId: current.department_id })) {
            throw AppError.forbidden('Forbidden');
          }
          if (data?.current_password && !await verifyPassword(data.current_password, current.password_hash)) {
            throw AppError.badRequest('Current password is incorrect');
          }
          const user = await userRepo.update(current.id, { password_hash: passwordHash, ext: current.ext }, executor);
          if (!user) throw AppError.notFound('User not found');
          return user;
        }, { roleLock: 'update' });
        await broadcastSessionInvalidation([user.id]);

        return reply.header('Cache-Control', 'no-store').send({
          id: user.id,
          email: user.email,
          message: 'Password updated successfully',
          temp_password: data?.new_password ? undefined : nextPassword,
        });
      } catch (error) {
        logger.error(error, 'Reset password error');
        return respondWithError(reply, error);
      }
    }
  );
}
