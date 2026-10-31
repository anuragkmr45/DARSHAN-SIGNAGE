import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createUserSchema, updateUserSchema, listUsersQuerySchema } from '@/schemas/user';
import { createUserRepository } from '@/db/repositories/user';
import { hashPassword } from '@/auth/password';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { defineAbilityFor, hasGlobalUserManagement } from '@/rbac';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';
import { createRoleRepository } from '@/db/repositories/role';
import { canManageUserTarget } from '@/rbac/policy';
import { canAccessDirectoryUser, directoryReadPredicate, hasDirectoryReadGrant, userActionPermissions } from '@/rbac/user-directory';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { schema } from '@/db';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { abortMultipartUpload, deleteObject } from '@/s3';
import { createMediaUploadSessionRepository } from '@/db/repositories/media-upload-session';
import { createMediaRepository } from '@/db/repositories/media';
import { broadcastSessionInvalidation } from '@/realtime/session-invalidation';
import { subject } from '@casl/ability';

const logger = createLogger('user-routes');
const { CREATED, OK } = HTTP_STATUS;

export async function userRoutes(fastify: FastifyInstance) {
  const userRepo = createUserRepository();
  const roleRepo = createRoleRepository();
  const uploadSessionRepo = createMediaUploadSessionRepository();
  const mediaRepo = createMediaRepository();
  // Create user (admin only)
  fastify.post<{ Body: typeof createUserSchema._type }>(
    apiEndpoints.users.create,
    {
      schema: {
        description: 'Create a new user (admin only)',
        tags: ['Users'],
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
        const data = createUserSchema.parse(request.body);
        const passwordHash = await hashPassword(data.password);
        const { user, role } = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          const [role] = await executor.select().from(schema.roles).where(eq(schema.roles.id, data.role_id));
          if (!role) throw AppError.notFound('Role not found');
          const prospective = { ...data, id: '', is_active: true, deleted_at: null };
          if (!(ability as any).can('create', subject('User', prospective)) ||
              !canManageUserTarget({ departmentId: actor.departmentId, globalUserManagement: hasGlobalUserManagement(ability) },
                { roleName: role.name, isSystem: role.is_system, departmentId: data.department_id })) {
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
            first_name: data.first_name,
            last_name: data.last_name,
            role_id: data.role_id,
            department_id: data.department_id,
          }, executor);
          return { user, role };
        }, { roleLock: 'update' });

        return reply.status(CREATED).send({
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: role.name,
          role_id: user.role_id,
          department_id: user.department_id,
          is_active: user.is_active,
          created_at: user.created_at.toISOString(),
          updated_at: user.updated_at.toISOString(),
        });
      } catch (error) {
        logger.error(error, 'Create user error');
        return respondWithError(reply, error);
      }
    }
  );

  // List users
  fastify.get<{ Querystring: typeof listUsersQuerySchema._type }>(
    apiEndpoints.users.list,
    {
      schema: {
        description: 'List users with pagination and filtering',
        tags: ['Users'],
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
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!hasDirectoryReadGrant(ability)) {
          throw AppError.forbidden('Forbidden');
        }

        const query = listUsersQuerySchema.parse(request.query);
        const result = await userRepo.list({
          page: query.page,
          limit: query.limit,
          role: query.role,
          role_id: query.role_id,
          department_id: query.department_id,
          is_active: query.is_active === 'true' ? true : query.is_active === 'false' ? false : undefined,
          visibility: {
            actorUserId: payload.sub,
            actorDepartmentId: payload.department_id,
            global: hasGlobalUserManagement(ability),
            readPredicate: directoryReadPredicate(ability),
          },
        });

        return reply.send({
          items: result.items.map((user) => ({
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            role: (user as any).role ?? null,
            role_id: user.role_id,
            department_id: user.department_id,
            is_active: user.is_active,
            permissions: userActionPermissions({ userId: payload.sub, departmentId: payload.department_id }, user, ability),
            created_at: user.created_at.toISOString(),
            updated_at: user.updated_at.toISOString(),
          })),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List users error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(apiEndpoints.users.managementOptions, {
    schema: {
      description: 'Assignable roles and departments for account management',
      tags: ['Users'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = extractTokenFromHeader(request.headers.authorization);
      if (!token) throw AppError.unauthorized('Missing authorization header');
      const payload = await verifyAccessToken(token);
      const result = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
        if (!ability.can('create', 'User') && !ability.can('update', 'User')) {
          throw AppError.forbidden('Forbidden');
        }
        const global = hasGlobalUserManagement(ability);
        if (global) {
          const [roles, departments] = await Promise.all([
            executor.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles),
            executor.select({ id: schema.departments.id, name: schema.departments.name }).from(schema.departments),
          ]);
          return { roles, departments, is_global_user_manager: true };
        }
        if (!actor.departmentId) return { roles: [], departments: [], is_global_user_manager: false };
        const [role] = await executor.select({ id: schema.roles.id, name: schema.roles.name })
          .from(schema.roles).where(and(eq(schema.roles.name, 'OPERATOR'), eq(schema.roles.is_system, true)));
        const [department] = await executor.select({ id: schema.departments.id, name: schema.departments.name })
          .from(schema.departments).where(eq(schema.departments.id, actor.departmentId));
        return {
          roles: role ? [role] : [],
          departments: department ? [department] : [],
          is_global_user_manager: false,
        };
      });
      return reply.send(result);
    } catch (error) {
      logger.error(error, 'Management options error');
      return respondWithError(reply, error);
    }
  });

  // Get user by ID
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.users.get,
    {
      schema: {
        description: 'Get user by ID',
        tags: ['Users'],
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
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        const user = await userRepo.findById((request.params as any).id);
        if (!user) {
          throw AppError.notFound('User not found');
        }

        const role = await roleRepo.findById(user.role_id);
        if (!canAccessDirectoryUser({ userId: payload.sub, departmentId: payload.department_id }, user, ability)) {
          throw AppError.notFound('User not found');
        }

        return reply.send({
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: role?.name ?? null,
          role_id: user.role_id,
          department_id: user.department_id,
          is_active: user.is_active,
          permissions: userActionPermissions({ userId: payload.sub, departmentId: payload.department_id },
            { ...user, role: role?.name ?? null, role_is_system: role?.is_system ?? false }, ability),
          created_at: user.created_at.toISOString(),
          updated_at: user.updated_at.toISOString(),
        });
      } catch (error) {
        logger.error(error, 'Get user error');
        return respondWithError(reply, error);
      }
    }
  );

  // Update user
  fastify.patch<{ Params: { id: string }; Body: typeof updateUserSchema._type }>(
    apiEndpoints.users.update,
    {
      schema: {
        description: 'Update user (admin only)',
        tags: ['Users'],
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
        const data = updateUserSchema.parse(request.body);
        const { user, role } = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          const [existingUser] = await executor.select().from(schema.users)
            .where(eq(schema.users.id, (request.params as any).id)).for('update');
          if (!existingUser || existingUser.deleted_at ||
              (!hasGlobalUserManagement(ability) && !existingUser.is_active)) {
            throw AppError.notFound('User not found');
          }
          const [existingRole] = await executor.select().from(schema.roles)
            .where(eq(schema.roles.id, existingUser.role_id));
          const [role] = await executor.select().from(schema.roles)
            .where(eq(schema.roles.id, data.role_id ?? existingUser.role_id));
          if (!existingRole || !role) throw AppError.notFound('Role not found');
          const actorScope = { departmentId: actor.departmentId, globalUserManagement: hasGlobalUserManagement(ability) };
          if (!(ability as any).can('update', subject('User', existingUser)) ||
              !(ability as any).can('update', subject('User', { ...existingUser, ...data })) ||
              !canManageUserTarget(actorScope, { roleName: existingRole.name, isSystem: existingRole.is_system, departmentId: existingUser.department_id }) ||
              !canManageUserTarget(actorScope, { roleName: role.name, isSystem: role.is_system,
                departmentId: data.department_id !== undefined ? data.department_id : existingUser.department_id })) {
            throw AppError.forbidden('Forbidden');
          }
          if (data.department_id) {
            const [department] = await executor.select({ id: schema.departments.id }).from(schema.departments)
              .where(eq(schema.departments.id, data.department_id)).for('share');
            if (!department) throw AppError.notFound('Department not found');
          }
          const user = await userRepo.update(existingUser.id, data, executor);
          if (!user) throw AppError.notFound('User not found');
          return { user, role };
        }, { roleLock: 'update' });
        await broadcastSessionInvalidation([user.id]);

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
        logger.error(error, 'Update user error');
        return respondWithError(reply, error);
      }
    }
  );

  // Delete user (admin only)
  fastify.delete<{ Params: { id: string } }>(
    apiEndpoints.users.delete,
    {
      schema: {
        description: 'Delete user (admin only)',
        tags: ['Users'],
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
        const userId = (request.params as any).id;
        const invalidPasswordHash = await hashPassword(`${randomBytes(32).toString('hex')}A!`);
        const result = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          const [user] = await executor.select().from(schema.users)
            .where(eq(schema.users.id, userId)).for('update');
          if (!user || (!hasGlobalUserManagement(ability) && (user.deleted_at || !user.is_active))) {
            throw AppError.notFound('User not found');
          }
          const [targetRole] = await executor.select().from(schema.roles).where(eq(schema.roles.id, user.role_id));
          if (!targetRole || !(ability as any).can('delete', subject('User', user)) ||
              !canManageUserTarget({ departmentId: actor.departmentId, globalUserManagement: hasGlobalUserManagement(ability) },
                { roleName: targetRole.name, isSystem: targetRole.is_system, departmentId: user.department_id })) {
            throw AppError.forbidden('Forbidden');
          }
          const result = await userRepo.tombstone(userId, actor.userId, invalidPasswordHash, executor);
          if (!result) throw AppError.notFound('User not found');
          return result;
        }, { roleLock: 'update' });
        if (!result.alreadyDeleted) await broadcastSessionInvalidation([userId]);

        let cleanedUploads = 0;
        for (const upload of result.abortedUploads) {
          try {
            if (upload.strategy === 'multipart' && upload.multipart_upload_id) {
              await abortMultipartUpload(
                upload.staging_bucket,
                upload.staging_object_key,
                upload.multipart_upload_id
              ).catch((cleanupError) => {
                logger.warn({ cleanupError, uploadSessionId: upload.id }, 'Multipart upload was already closed or could not be aborted');
              });
            }
            await deleteObject(upload.staging_bucket, upload.staging_object_key);
            await deleteObject(upload.canonical_bucket, upload.canonical_object_key);
            await uploadSessionRepo.update(upload.id, { failure_reason: 'USER_DELETED_UPLOAD_ABORTED' });
            await mediaRepo.update(upload.media_id, {
              status: 'FAILED',
              status_reason: 'USER_DELETED_UPLOAD_ABORTED',
            });
            cleanedUploads += 1;
          } catch (cleanupError) {
            logger.warn({ cleanupError, uploadSessionId: upload.id }, 'Deleted-user upload cleanup will be retried');
          }
        }

        const uploadMediaIds = new Set(result.abortedUploads.map((upload) => upload.media_id));
        for (const media of result.failedMedia) {
          if (uploadMediaIds.has(media.id) || !media.source_bucket || !media.source_object_key) continue;
          try {
            await deleteObject(media.source_bucket, media.source_object_key);
            await mediaRepo.update(media.id, { status_reason: 'USER_DELETED_UPLOAD_ABORTED' });
          } catch (cleanupError) {
            await mediaRepo.update(media.id, { status_reason: 'USER_DELETED_CLEANUP_PENDING' });
            logger.warn({ cleanupError, mediaId: media.id }, 'Deleted-user legacy upload cleanup will be retried');
          }
        }

        return reply.status(OK).send({
          message: result.alreadyDeleted ? 'User was already deleted' : 'User deleted successfully',
          id: userId,
          deleted_at: result.user.deleted_at?.toISOString() ?? null,
          already_deleted: result.alreadyDeleted,
          aborted_uploads: result.abortedUploads.length,
          cleaned_uploads: cleanedUploads,
        });
      } catch (error) {
        logger.error(error, 'Delete user error');
        return respondWithError(reply, error);
      }
    }
  );
}
