import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { subject as caslSubject } from '@casl/ability';
import { z } from 'zod';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { canUnconditionally, defineAbilityFor } from '@/rbac';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { respondWithError } from '@/utils/errors';
import { createScheduleReservationService } from '@/services/scheduling/reservation-service';
import { createScheduleRepository } from '@/db/repositories/schedule';
import { canAccessContentMutationScope, canReadContentResource } from '@/rbac/content-ownership';
import { AppError } from '@/utils/app-error';

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
    if (value.schedule_id) return;
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

export async function scheduleReservationRoutes(fastify: FastifyInstance) {
  const reservationService = createScheduleReservationService();
  const scheduleRepo = createScheduleRepository();

  fastify.post<{ Body: typeof previewSchema._type }>(
    apiEndpoints.scheduleReservations.preview,
    {
      schema: {
        description: 'Preview authoritative scheduling conflicts and active reservations',
        tags: ['Schedules'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        const body = previewSchema.parse(request.body);
        if (body.schedule_id) {
          const schedule = await scheduleRepo.findById(body.schedule_id);
          if (!schedule) throw AppError.notFound('Schedule not found');
          const actor = { userId: payload.sub, roleName: payload.role, departmentId: payload.department_id };
          const canRead = canUnconditionally(ability, 'read', 'ScheduleRequest') &&
            canReadContentResource(actor, schedule, ability, 'Schedule');
          const canCreate = (ability as any).can('create', caslSubject('ScheduleRequest', {
            schedule_id: body.schedule_id,
            requested_by: payload.sub,
            status: 'PENDING',
          })) && canAccessContentMutationScope(actor, schedule, ability, 'Schedule');
          if (!canRead && !canCreate) throw AppError.forbidden('Forbidden');
        } else if (!canUnconditionally(ability, 'read', 'ScheduleRequest') &&
                   !canUnconditionally(ability, 'create', 'ScheduleRequest')) {
          throw AppError.forbidden('Forbidden');
        }
        const result = await reservationService.previewConflicts({
          scheduleId: body.schedule_id,
          startAt: body.start_at ? new Date(body.start_at) : undefined,
          endAt: body.end_at ? new Date(body.end_at) : undefined,
          screenIds: body.screen_ids,
          screenGroupIds: body.screen_group_ids,
          currentUserId: payload.sub,
          allowPrivateRefs: canUnconditionally(ability, 'manage', 'Schedule'),
        });

        return reply.send({
          server_time: new Date().toISOString(),
          ...result,
        });
      } catch (error) {
        logger.error(error, 'Preview schedule reservations error');
        return respondWithError(reply, error);
      }
    }
  );
}
