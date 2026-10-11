import { z } from 'zod';
import { extractTokenFromHeader, verifyAccessToken } from '../auth/jwt.js';
import { defineAbilityFor } from '../rbac/index.js';
import { createLogger } from '../utils/logger.js';
import { apiEndpoints } from '../config/apiEndpoints.js';
import { respondWithError } from '../utils/errors.js';
import { createScheduleReservationService } from '../services/scheduling/reservation-service.js';
import { AppError } from '../utils/app-error.js';
import { isAdminLike } from '../rbac/policy.js';
const logger = createLogger('schedule-reservation-routes');
const previewSchema = z
    .object({
    schedule_id: z.string().uuid().optional(),
    start_at: z.string().datetime().optional(),
    end_at: z.string().datetime().optional(),
    screen_ids: z.array(z.string().uuid()).default([]),
    screen_group_ids: z.array(z.string().uuid()).default([]),
})
    .superRefine((value, ctx) => {
    if (value.schedule_id)
        return;
    if (!value.start_at) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['start_at'], message: 'start_at is required' });
    }
    if (!value.end_at) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end_at'], message: 'end_at is required' });
    }
    if (value.start_at && value.end_at && new Date(value.end_at) <= new Date(value.start_at)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end_at'], message: 'end_at must be after start_at' });
    }
});
export async function scheduleReservationRoutes(fastify) {
    const reservationService = createScheduleReservationService();
    fastify.post(apiEndpoints.scheduleReservations.preview, {
        schema: {
            description: 'Preview authoritative scheduling conflicts and active reservations',
            tags: ['Schedules'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token)
                throw AppError.unauthorized('Missing authorization header');
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('read', 'ScheduleRequest') && !ability.can('create', 'ScheduleRequest')) {
                throw AppError.forbidden('Forbidden');
            }
            const body = previewSchema.parse(request.body);
            const result = await reservationService.previewConflicts({
                scheduleId: body.schedule_id,
                startAt: body.start_at ? new Date(body.start_at) : undefined,
                endAt: body.end_at ? new Date(body.end_at) : undefined,
                screenIds: body.screen_ids,
                screenGroupIds: body.screen_group_ids,
                currentUserId: payload.sub,
                allowPrivateRefs: isAdminLike(payload.role),
            });
            return reply.send({
                server_time: new Date().toISOString(),
                ...result,
            });
        }
        catch (error) {
            logger.error(error, 'Preview schedule reservations error');
            return respondWithError(reply, error);
        }
    });
}
