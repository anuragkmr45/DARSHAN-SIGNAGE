import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createUserSchema, updateUserSchema, listUsersQuerySchema } from '@/schemas/user';
import { createUserRepository } from '@/db/repositories/user';
import { hashPassword } from '@/auth/password';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { defineAbilityFor } from '@/rbac';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';
import { createRoleRepository } from '@/db/repositories/role';
import { canManageUserRecord, canManageUserRoleTarget, canReadUserRecord } from '@/rbac/policy';
import { randomBytes } from 'node:crypto';
import { abortMultipartUpload, deleteObject } from '@/s3';
import { createMediaUploadSessionRepository } from '@/db/repositories/media-upload-session';
import { createMediaRepository } from '@/db/repositories/media';
import { disconnectAuthenticatedUserSockets } from '@/realtime/socket-server';

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
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);

        if (!ability.can('create', 'User')) {
          throw AppError.forbidden('Forbidden');
        }

        const data = createUserSchema.parse(request.body);
        const passwordHash = await hashPassword(data.password);

        const role = await roleRepo.findById(data.role_id);
        if (!role) {
          throw AppError.notFound('Role not found');
        }
        if (!canManageUserRoleTarget(payload.role, role.name)) {
          throw AppError.forbidden('Forbidden');
        }
        if (payload.role === 'DEPARTMENT' && data.department_id !== payload.department_id) {
          throw AppError.forbidden('Department users can only manage operators in their own department.');
        }

        const user = await userRepo.create({
          email: data.email,
          password_hash: passwordHash,
          first_name: data.first_name,
          last_name: data.last_name,
          role_id: data.role_id,
          department_id: data.department_id,
        });

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
        if (!ability.can('read', 'User')) {
          throw AppError.forbidden('Forbidden');
        }

        const query = listUsersQuerySchema.parse(request.query);
        const effectiveRole =
          payload.role === 'OPERATOR'
            ? 'OPERATOR'
            : payload.role === 'DEPARTMENT'
              ? 'OPERATOR'
              : query.role;
        const effectiveDepartmentId =
          payload.role === 'DEPARTMENT' ? payload.department_id : query.department_id;
        const result = await userRepo.list({
          page: query.page,
          limit: query.limit,
          role: effectiveRole,
          role_id: query.role_id,
          department_id: effectiveDepartmentId,
          is_active: query.is_active === 'true' ? true : query.is_active === 'false' ? false : undefined,
        });

        const items = result.items.filter((user) =>
          canReadUserRecord(
            { userId: payload.sub, roleName: payload.role, departmentId: payload.department_id },
            { roleName: (user as any).role ?? '', departmentId: user.department_id }
          )
        );

        return reply.send({
          items: items.map((user) => ({
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            role: (user as any).role ?? null,
            role_id: user.role_id,
            department_id: user.department_id,
            is_active: user.is_active,
            created_at: user.created_at.toISOString(),
            updated_at: user.updated_at.toISOString(),
          })),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: items.length,
          },
        });
      } catch (error) {
        logger.error(error, 'List users error');
        return respondWithError(reply, error);
      }
    }
  );

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
        if (!ability.can('read', 'User')) {
          throw AppError.forbidden('Forbidden');
        }

        const user = await userRepo.findById((request.params as any).id);
        if (!user || user.deleted_at) {
          throw AppError.notFound('User not found');
        }

        const role = await roleRepo.findById(user.role_id);
        if (
          !canReadUserRecord(
            { userId: payload.sub, roleName: payload.role, departmentId: payload.department_id },
            { roleName: role?.name ?? '', departmentId: user.department_id }
          )
        ) {
          throw AppError.forbidden('Forbidden');
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
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);

        if (!ability.can('update', 'User')) {
          throw AppError.forbidden('Forbidden');
        }

        const data = updateUserSchema.parse(request.body);
        if (data.role_id) {
          const role = await roleRepo.findById(data.role_id);
          if (!role) {
            throw AppError.notFound('Role not found');
          }
          if (!canManageUserRoleTarget(payload.role, role.name)) {
            throw AppError.forbidden('Forbidden');
          }
          if (payload.role === 'DEPARTMENT' && data.department_id !== payload.department_id) {
            throw AppError.forbidden('Department users can only manage operators in their own department.');
          }
        }
        const existingUser = await userRepo.findById((request.params as any).id);
        if (!existingUser || existingUser.deleted_at) {
          throw AppError.notFound('User not found');
        }
        if (
          payload.role === 'DEPARTMENT' &&
          Object.prototype.hasOwnProperty.call(data, 'department_id') &&
          data.department_id !== payload.department_id
        ) {
          throw AppError.forbidden('Department users can only manage operators in their own department.');
        }
        const existingRole = await roleRepo.findById(existingUser.role_id);
        if (
          !canManageUserRecord(
            { userId: payload.sub, roleName: payload.role, departmentId: payload.department_id },
            {
              id: existingUser.id,
              roleName: existingRole?.name ?? '',
              departmentId: existingUser.department_id,
            }
          )
        ) {
          throw AppError.forbidden('Forbidden');
        }
        const user = await userRepo.update((request.params as any).id, data);

        if (!user) {
          throw AppError.notFound('User not found');
        }
        disconnectAuthenticatedUserSockets(user.id);

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
      let user: {
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
        role_id?: string;
        department_id?: string | null;
        deleted_at?: Date | null;
      } | null = null;

      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);

        if (!ability.can('delete', 'User')) {
          throw AppError.forbidden('Forbidden');
        }

        const userId = (request.params as any).id;
        user = await userRepo.findById(userId);
        if (!user) {
          throw AppError.notFound('User not found');
        }
        const targetRole = user.role_id ? await roleRepo.findById(user.role_id) : null;
        if (targetRole?.name === 'SUPER_ADMIN') {
          throw AppError.forbidden('SUPER_ADMIN accounts cannot be deleted.');
        }
        if (
          !canManageUserRecord(
            { userId: payload.sub, roleName: payload.role, departmentId: payload.department_id },
            {
              id: userId,
              roleName: targetRole?.name ?? '',
              departmentId: (user as any).department_id,
            }
          )
        ) {
          throw AppError.forbidden('Forbidden');
        }

        const invalidPasswordHash = await hashPassword(`${randomBytes(32).toString('hex')}A!`);
        const result = await userRepo.tombstone(userId, payload.sub, invalidPasswordHash);
        if (!result) throw AppError.notFound('User not found');

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

        disconnectAuthenticatedUserSockets(userId);
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
