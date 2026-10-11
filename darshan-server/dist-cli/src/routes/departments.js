import { z } from 'zod';
import { createDepartmentRepository } from '../db/repositories/department.js';
import { extractTokenFromHeader, verifyAccessToken } from '../auth/jwt.js';
import { defineAbilityFor } from '../rbac/index.js';
import { createLogger } from '../utils/logger.js';
import { apiEndpoints } from '../config/apiEndpoints.js';
import { HTTP_STATUS } from '../http-status-codes.js';
import { respondWithError } from '../utils/errors.js';
import { AppError } from '../utils/app-error.js';
import { isAdminLike } from '../rbac/policy.js';
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
export async function departmentRoutes(fastify) {
    const deptRepo = createDepartmentRepository();
    // Create department
    fastify.post(apiEndpoints.departments.create, {
        schema: {
            description: 'Create a new department (admin only)',
            tags: ['Departments'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('create', 'Department')) {
                throw AppError.forbidden('Forbidden');
            }
            const data = createDepartmentSchema.parse(request.body);
            const department = await deptRepo.create(data);
            return reply.status(CREATED).send({
                id: department.id,
                name: department.name,
                description: department.description,
                created_at: department.created_at.toISOString(),
                updated_at: department.updated_at.toISOString(),
            });
        }
        catch (error) {
            logger.error(error, 'Create department error');
            return respondWithError(reply, error);
        }
    });
    // List departments
    fastify.get(apiEndpoints.departments.list, {
        schema: {
            description: 'List departments with pagination',
            tags: ['Departments'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('read', 'Department') || !isAdminLike(payload.role)) {
                throw AppError.forbidden('Forbidden');
            }
            const query = listDepartmentsQuerySchema.parse(request.query);
            const result = await deptRepo.list({
                page: query.page,
                limit: query.limit,
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
        }
        catch (error) {
            logger.error(error, 'List departments error');
            return respondWithError(reply, error);
        }
    });
    // Get department by ID
    fastify.get(apiEndpoints.departments.get, {
        schema: {
            description: 'Get department by ID',
            tags: ['Departments'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('read', 'Department') || !isAdminLike(payload.role)) {
                throw AppError.forbidden('Forbidden');
            }
            const department = await deptRepo.findById(request.params.id);
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
        }
        catch (error) {
            logger.error(error, 'Get department error');
            return respondWithError(reply, error);
        }
    });
    // Update department
    fastify.patch(apiEndpoints.departments.update, {
        schema: {
            description: 'Update department (admin only)',
            tags: ['Departments'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('update', 'Department')) {
                throw AppError.forbidden('Forbidden');
            }
            const data = createDepartmentSchema.partial().parse(request.body);
            const department = await deptRepo.update(request.params.id, data);
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
        }
        catch (error) {
            logger.error(error, 'Update department error');
            return respondWithError(reply, error);
        }
    });
    // Delete department
    fastify.delete(apiEndpoints.departments.delete, {
        schema: {
            description: 'Delete department (admin only)',
            tags: ['Departments'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('delete', 'Department')) {
                throw AppError.forbidden('Forbidden');
            }
            const departmentId = request.params.id;
            const exists = await deptRepo.findById(departmentId);
            if (!exists) {
                throw AppError.notFound('Department not found');
            }
            await deptRepo.delete(departmentId);
            return reply.status(OK).send({ message: 'Department deleted successfully', id: departmentId });
        }
        catch (error) {
            logger.error(error, 'Delete department error');
            return respondWithError(reply, error);
        }
    });
}
