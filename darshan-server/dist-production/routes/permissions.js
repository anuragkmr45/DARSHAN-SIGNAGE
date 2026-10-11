import { extractTokenFromHeader, verifyAccessToken } from '../auth/jwt.js';
import { defineAbilityFor } from '../rbac/index.js';
import { createLogger } from '../utils/logger.js';
import { apiEndpoints } from '../config/apiEndpoints.js';
import { respondWithError } from '../utils/errors.js';
import { AppError } from '../utils/app-error.js';
import { PERMISSION_ACTIONS, PERMISSION_SUBJECTS } from '../rbac/permissions.js';
const logger = createLogger('permission-routes');
export async function permissionRoutes(fastify) {
    fastify.get(apiEndpoints.permissions.metadata, {
        schema: {
            description: 'Get permissions metadata (actions + subjects)',
            tags: ['Permissions'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token)
                throw AppError.unauthorized('Missing authorization header');
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('read', 'Role'))
                throw AppError.forbidden('Forbidden');
            return reply.send({
                actions: PERMISSION_ACTIONS,
                subjects: PERMISSION_SUBJECTS,
            });
        }
        catch (error) {
            logger.error(error, 'Get permissions metadata error');
            return respondWithError(reply, error);
        }
    });
}
