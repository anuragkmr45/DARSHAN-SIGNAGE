import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { subject } from '@casl/ability';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createDepartmentRepository } from '@/db/repositories/department';
import { schema } from '@/db';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { defineAbilityFor } from '@/rbac';
import { departmentReadPredicate } from '@/rbac/department-access';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';

const logger = createLogger('department-routes');
const { CREATED, OK } = HTTP_STATUS;

const createDepartmentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

const listDepartmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export async function departmentRoutes(fastify: FastifyInstance) {
  const deptRepo = createDepartmentRepository();

  // Create department
  fastify.post<{ Body: typeof createDepartmentSchema._type }>(
    apiEndpoints.departments.create,
    {
      schema: {
        description: 'Create a new department (admin only)',
        tags: ['Departments'],
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
        const data = createDepartmentSchema.parse(request.body);
        const department = await withCurrentMutationAuthorization(payload, async ({ ability, executor }) => {
          if (!(ability as any).can('create', subject('Department', data))) {
            throw AppError.forbidden('Forbidden');
          }
          return deptRepo.create(data, executor);
        });

        return reply.status(CREATED).send({
          id: department.id,
          name: department.name,
          description: department.description,
          created_at: department.created_at.toISOString(),
          updated_at: department.updated_at.toISOString(),
        });
      } catch (error) {
        logger.error(error, 'Create department error');
        return respondWithError(reply, error);
      }
    }
  );

  // List departments
  fastify.get<{ Querystring: typeof listDepartmentsQuerySchema._type }>(
    apiEndpoints.departments.list,
    {
      schema: {
        description: 'List departments with pagination',
        tags: ['Departments'],
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
        if (!ability.can('read', 'Department')) {
          throw AppError.forbidden('Forbidden');
        }

        const query = listDepartmentsQuerySchema.parse(request.query);
        const result = await deptRepo.list({
          page: query.page,
          limit: query.limit,
          predicate: departmentReadPredicate(ability),
        });

        return reply.send({
          items: result.items.map((d) => ({
            id: d.id,
            name: d.name,
            description: d.description,
            created_at: d.created_at.toISOString(),
            updated_at: d.updated_at.toISOString(),
          })),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List departments error');
        return respondWithError(reply, error);
      }
    }
  );

  // Get department by ID
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.departments.get,
    {
      schema: {
        description: 'Get department by ID',
        tags: ['Departments'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('read', 'Department')) {
          throw AppError.forbidden('Forbidden');
        }

        const department = await deptRepo.findById((request.params as any).id, departmentReadPredicate(ability));
        if (!department) {
          throw AppError.notFound('Department not found');
        }
        if (!(ability as any).can('read', subject('Department', department))) {
          throw AppError.notFound('Department not found');
        }

        return reply.send({
          id: department.id,
          name: department.name,
          description: department.description,
          created_at: department.created_at.toISOString(),
          updated_at: department.updated_at.toISOString(),
        });
      } catch (error) {
        logger.error(error, 'Get department error');
        return respondWithError(reply, error);
      }
    }
  );

  // Update department
  fastify.patch<{ Params: { id: string }; Body: Partial<typeof createDepartmentSchema._type> }>(
    apiEndpoints.departments.update,
    {
      schema: {
        description: 'Update department (admin only)',
        tags: ['Departments'],
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
        const data = createDepartmentSchema.partial().parse(request.body);
        const department = await withCurrentMutationAuthorization(payload, async ({ ability, executor }) => {
          if (!ability.can('update', 'Department')) throw AppError.forbidden('Forbidden');
          const departmentId = (request.params as any).id;
          const [current] = await executor.select().from(schema.departments)
            .where(eq(schema.departments.id, departmentId)).for('update');
          if (!current) throw AppError.notFound('Department not found');
          if (!(ability as any).can('update', subject('Department', current)) ||
              !(ability as any).can('update', subject('Department', { ...current, ...data }))) {
            throw AppError.forbidden('Forbidden');
          }
          return deptRepo.update(departmentId, data, executor);
        });

        if (!department) {
          throw AppError.notFound('Department not found');
        }

        return reply.send({
          id: department.id,
          name: department.name,
          description: department.description,
          created_at: department.created_at.toISOString(),
          updated_at: department.updated_at.toISOString(),
        });
      } catch (error) {
        logger.error(error, 'Update department error');
        return respondWithError(reply, error);
      }
    }
  );

  // Delete department
  fastify.delete<{ Params: { id: string } }>(
    apiEndpoints.departments.delete,
    {
      schema: {
        description: 'Delete department (admin only)',
        tags: ['Departments'],
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
        const departmentId = (request.params as any).id;
        const result = await withCurrentMutationAuthorization(payload, async ({ ability, executor }) => {
          if (!ability.can('delete', 'Department')) throw AppError.forbidden('Forbidden');
          return deptRepo.deleteIfUnused(departmentId, executor, (department) => {
            if (!(ability as any).can('delete', subject('Department', department))) {
              throw AppError.forbidden('Forbidden');
            }
          });
        });
        if (result.status === 'not_found') {
          throw AppError.notFound('Department not found');
        }
        if (result.status === 'in_use') {
          throw new AppError({
            statusCode: 409,
            code: 'DEPARTMENT_IN_USE',
            message: 'Department cannot be deleted while it owns users or content.',
            details: result.usage,
          });
        }
        return reply.status(OK).send({ message: 'Department deleted successfully', id: departmentId });
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === '23503'
        ) {
          return respondWithError(
            reply,
            new AppError({
              statusCode: 409,
              code: 'DEPARTMENT_IN_USE',
              message: 'Department cannot be deleted because ownership changed during deletion. Refresh and try again.',
            })
          );
        }
        logger.error(error, 'Delete department error');
        return respondWithError(reply, error);
      }
    }
  );
}
