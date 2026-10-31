import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { subject as caslSubject } from '@casl/ability';
import { desc, eq, inArray, and } from 'drizzle-orm';
import {
  createScheduleSchema,
  updateScheduleSchema,
  listSchedulesQuerySchema,
  publishScheduleSchema,
  displayPreflightSchema,
} from '@/schemas/schedule';
import { apiEndpoints } from '@/config/apiEndpoints';
import { createScheduleRepository } from '@/db/repositories/schedule';
import { createScheduleItemRepository } from '@/db/repositories/schedule-item';
import { createPresentationRepository } from '@/db/repositories/presentation';
import { getDatabase, schema } from '@/db';
import { extractTokenFromHeader, verifyAccessToken, type JWTPayload } from '@/auth/jwt';
import {
  withCurrentMutationAuthorization,
  type MutationAuthorizationContext,
} from '@/auth/mutation-authorization';
import { canUnconditionally, defineAbilityFor } from '@/rbac';
import { createLogger } from '@/utils/logger';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import {
  findScheduleOwnershipCompatibilityIssues,
  getScheduleDisplayPreflight,
  publishScheduleSnapshot,
  resolvePresentations,
} from '@/routes/schedule-publish-helper';
import z from 'zod';
import { AppError } from '@/utils/app-error';
import { type ActorContext } from '@/rbac/policy';
import {
  canAccessContentMutationScope,
  canManageContentResource,
  canReadContentResource,
  canReferenceContentResource,
  contentResponseMetadata,
  ownershipForNewContent,
  resolveContentOwnershipViews,
} from '@/rbac/content-ownership';
import { createScheduleReservationService } from '@/services/scheduling/reservation-service';
import { dispatchPlaybackRefresh } from '@/services/playback-refresh-dispatch';

const logger = createLogger('schedule-routes');
const { CREATED } = HTTP_STATUS;

const scheduleItemSchema = z.object({
  presentation_id: z.string().uuid(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  priority: z.number().int().default(0),
  screen_ids: z.array(z.string().uuid()).default([]),
  screen_group_ids: z.array(z.string().uuid()).default([]),
});

const takeDownPublishSchema = z.object({
  reason: z.string().optional(),
});

export async function scheduleRoutes(fastify: FastifyInstance) {
  const scheduleRepo = createScheduleRepository();
  const scheduleItemRepo = createScheduleItemRepository();
  const presentationRepo = createPresentationRepository();
  const reservationService = createScheduleReservationService();
  const db = getDatabase();
  const actorFor = (payload: { sub: string; role: string; department_id?: string | null }): ActorContext => ({
    userId: payload.sub,
    roleName: payload.role,
    departmentId: payload.department_id,
  });
  const serializeSchedule = (schedule: any, ownership: any, ability: any, actor: ActorContext) => {
    return {
      id: schedule.id,
      name: schedule.name,
      description: schedule.description,
      timezone: schedule.timezone ?? null,
      start_at: schedule.start_at?.toISOString?.() ?? schedule.start_at,
      end_at: schedule.end_at?.toISOString?.() ?? schedule.end_at,
      is_active: schedule.is_active,
      ...contentResponseMetadata(schedule, ownership, actor, ability, 'Schedule', false),
      created_at: schedule.created_at.toISOString?.() ?? schedule.created_at,
      updated_at: schedule.updated_at.toISOString?.() ?? schedule.updated_at,
    };
  };
  const serializeNestedLayout = (layout: any, ownership: any, ability: any, actor: ActorContext) => ({
    id: layout.id,
    name: layout.name,
    description: layout.description,
    aspect_ratio: layout.aspect_ratio,
    spec: layout.spec,
    ...contentResponseMetadata(layout, ownership, actor, ability, 'Layout'),
    created_at: layout.created_at?.toISOString?.() ?? layout.created_at,
    updated_at: layout.updated_at?.toISOString?.() ?? layout.updated_at,
  });
  const serializeNestedMedia = (media: any, ownership: any, ability: any, actor: ActorContext) => ({
    id: media.id,
    name: media.name,
    type: media.type,
    status: media.status,
    source_bucket: media.source_bucket,
    source_object_key: media.source_object_key,
    ready_object_id: media.ready_object_id,
    thumbnail_object_id: media.thumbnail_object_id,
    page_count: media.page_count ?? null,
    ...contentResponseMetadata(media, ownership, actor, ability, 'Media'),
    created_at: media.created_at?.toISOString?.() ?? media.created_at,
    updated_at: media.updated_at?.toISOString?.() ?? media.updated_at,
  });

  const validateStartEnd = (start: string, end: string) => {
    const now = new Date();
    const startAt = new Date(start);
    const endAt = new Date(end);
    const bufferMs = 60_000; // allow slight clock drift when defaulting to "now"

    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      throw AppError.badRequest('Invalid date format');
    }
    if (startAt.getTime() < now.getTime() - bufferMs) {
      throw AppError.badRequest('start_at cannot be in the past');
    }
    if (endAt.getTime() < now.getTime() - bufferMs) {
      throw AppError.badRequest('end_at cannot be in the past');
    }
    if (startAt >= endAt) {
      throw AppError.badRequest('start_at must be before end_at');
    }
    return { startAt, endAt };
  };

  const validateTimeZone = (timezone?: string | null) => {
    if (!timezone) return null;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return timezone;
    } catch {
      throw AppError.badRequest('Invalid timezone');
    }
  };

  const targetsIntersect = (
    existing: { screen_ids?: string[]; screen_group_ids?: string[] },
    incoming: { screen_ids?: string[]; screen_group_ids?: string[] }
  ) => {
    const existingScreens = existing.screen_ids || [];
    const existingGroups = existing.screen_group_ids || [];
    const incomingScreens = incoming.screen_ids || [];
    const incomingGroups = incoming.screen_group_ids || [];

    const existingHasTargets = existingScreens.length > 0 || existingGroups.length > 0;
    const incomingHasTargets = incomingScreens.length > 0 || incomingGroups.length > 0;

    if (!existingHasTargets && !incomingHasTargets) return true; // both global
    if (!existingHasTargets) return true; // existing applies to all
    if (!incomingHasTargets) return true; // new applies to all

    const screenOverlap = existingScreens.some((sid) => incomingScreens.includes(sid));
    const groupOverlap = existingGroups.some((gid) => incomingGroups.includes(gid));
    return screenOverlap || groupOverlap;
  };

  const hasOverlap = (items: any[], startAt: Date, endAt: Date, incomingTargets: { screen_ids?: string[]; screen_group_ids?: string[] }) => {
    return items.some((i) => {
      const existingStart = new Date(i.start_at);
      const existingEnd = new Date(i.end_at);
      if (!targetsIntersect(i, incomingTargets)) return false;
      return startAt < existingEnd && endAt > existingStart;
    });
  };

  const assertScheduleAccess = async (
    payload: JWTPayload,
    scheduleId: string,
    manage = false
  ) => {
    const schedule = await scheduleRepo.findById(scheduleId);
    if (!schedule) throw AppError.notFound('Schedule not found');
    const actor = actorFor(payload);
    const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
    const canAccessSchedule = manage
      ? canManageContentResource(actor, schedule, ability, 'Schedule', 'update')
      : canReadContentResource(actor, schedule, ability, 'Schedule');
    if (!canAccessSchedule) throw AppError.forbidden('Forbidden');
    return schedule;
  };
  const withScheduleMutation = async <T>(
    payload: JWTPayload,
    scheduleId: string,
    permission: { action: 'create' | 'update' | 'delete' | 'publish'; subject: 'Schedule' | 'ScheduleItem' | 'ScheduleRequest' },
    execute: (
      context: MutationAuthorizationContext & {
        schedule: typeof schema.schedules.$inferSelect;
      }
    ) => Promise<T>
  ) =>
    withCurrentMutationAuthorization(payload, async (context) => {
      const [schedule] = await context.executor
        .select()
        .from(schema.schedules)
        .where(eq(schema.schedules.id, scheduleId))
        .for('update');
      if (!schedule) throw AppError.notFound('Schedule not found');
      const scheduleSubject = caslSubject('Schedule', { ...schedule });
      const hasAction = permission.subject === 'Schedule'
        ? (context.ability as any).can(permission.action, scheduleSubject)
        : canUnconditionally(context.ability, permission.action, permission.subject);
      if (!hasAction && !(context.ability as any).can('manage', scheduleSubject)) {
        throw AppError.forbidden('Forbidden');
      }
      if (!canAccessContentMutationScope(context.actor, schedule, context.ability, 'Schedule')) {
        throw AppError.forbidden('Forbidden');
      }
      return execute({ ...context, schedule });
    });

  fastify.post<{ Body: typeof displayPreflightSchema._type }>(
    apiEndpoints.schedules.displayPreflight,
    {
      schema: {
        description: 'Analyze target display aspect compatibility before publish',
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
        if (!ability.can('read', 'Schedule')) throw AppError.forbidden('Forbidden');
        const data = displayPreflightSchema.parse(request.body);
        await assertScheduleAccess(payload, data.schedule_id);
        return reply.send(
          await getScheduleDisplayPreflight({
            scheduleId: data.schedule_id,
            screenIds: Array.from(new Set(data.screen_ids || [])),
            screenGroupIds: Array.from(new Set(data.screen_group_ids || [])),
            db,
            scheduleItemRepo,
          })
        );
      } catch (error) {
        logger.error(error, 'Display preflight error');
        return respondWithError(reply, error);
      }
    }
  );


  // Create schedule
  fastify.post<{ Body: typeof createScheduleSchema._type }>(
    apiEndpoints.schedules.create,
    {
      schema: {
        description: 'Create a new schedule',
        tags: ['Schedules'],
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
        const data = createScheduleSchema.parse(request.body);
        const startIso = data.start_at ?? new Date().toISOString();
        const endIso =
          data.end_at ?? new Date(new Date(startIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
        const { startAt, endAt } = validateStartEnd(startIso, endIso);
        const timezone = validateTimeZone(data.timezone);
        const authorized = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          if (!ability.can('create', 'Schedule')) throw AppError.forbidden('Forbidden');
          const schedule = await scheduleRepo.create({
            ...data,
            timezone,
            start_at: startAt,
            end_at: endAt,
            created_by: actor.userId,
            ...ownershipForNewContent(actor, ability, 'Schedule', { ...data, timezone, start_at: startAt, end_at: endAt }),
          }, executor);
          return { schedule, actor, ability };
        });
        const ownership = (await resolveContentOwnershipViews([authorized.schedule])).get(authorized.schedule.id);
        return reply.status(CREATED).send(
          serializeSchedule(authorized.schedule, ownership, authorized.ability, authorized.actor)
        );
      } catch (error) {
        logger.error(error, 'Create schedule error');
        return respondWithError(reply, error);
      }
    }
  );

  // Publish status and history
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.schedules.publishes,
    {
      schema: {
        description: 'Get publish history and target status for a schedule',
        tags: ['Schedules'],
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
        if (!ability.can('read', 'Schedule')) throw AppError.forbidden('Forbidden');
        await assertScheduleAccess(payload, (request.params as any).id);

        const publishes = await db
          .select()
          .from(schema.publishes)
          .where(eq(schema.publishes.schedule_id, (request.params as any).id))
          .orderBy(desc(schema.publishes.published_at));

        const publishIds = publishes.map((p) => p.id);
        const targets = publishIds.length
          ? await db.select().from(schema.publishTargets).where(inArray(schema.publishTargets.publish_id, publishIds))
          : [];
        const targetsByPublish = new Map<string, any[]>();
        targets.forEach((t) => {
          const arr = targetsByPublish.get(t.publish_id) || [];
          arr.push(t);
          targetsByPublish.set(t.publish_id, arr);
        });

        return reply.send({
          items: publishes.map((p) => ({
            ...p,
            published_at: p.published_at.toISOString?.() ?? p.published_at,
            targets: targetsByPublish.get(p.id) || [],
          })),
        });
      } catch (error) {
        logger.error(error, 'List publishes error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { publishId: string; targetId: string }; Body: { status: string; error?: string } }>(
    apiEndpoints.schedules.updatePublishTarget,
    {
      schema: {
        description: 'Update publish target status',
        tags: ['Schedules'],
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
        const body = request.body as any;
        const target = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          if (!ability.can('update', 'Schedule')) {
            throw AppError.forbidden('Forbidden');
          }
          const [publish] = await executor
            .select()
            .from(schema.publishes)
            .where(eq(schema.publishes.id, (request.params as any).publishId))
            .for('update');
          if (!publish) throw AppError.notFound('Publish not found');
          const [schedule] = await executor
            .select()
            .from(schema.schedules)
            .where(eq(schema.schedules.id, publish.schedule_id))
            .for('update');
          if (!schedule || !canManageContentResource(actor, schedule, ability, 'Schedule', 'update')) {
            throw AppError.forbidden('Forbidden');
          }
          const [updatedTarget] = await executor
            .update(schema.publishTargets)
            .set({ status: body.status, error: body.error, updated_at: new Date() })
            .where(
              and(
                eq(schema.publishTargets.id, (request.params as any).targetId),
                eq(schema.publishTargets.publish_id, publish.id)
              )
            )
            .returning();
          if (!updatedTarget) throw AppError.notFound('Target not found');
          return updatedTarget;
        });
        return reply.send(target);
      } catch (error) {
        logger.error(error, 'Update publish target error');
        return respondWithError(reply, error);
      }
    }
  );

  // List schedules
  fastify.get<{ Querystring: typeof listSchedulesQuerySchema._type }>(
    apiEndpoints.schedules.list,
    {
      schema: {
        description: 'List schedules with pagination',
        tags: ['Schedules'],
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
        if (!ability.can('read', 'Schedule')) throw AppError.forbidden('Forbidden');

        const query = listSchedulesQuerySchema.parse(request.query);
        const actor = actorFor(payload);
        const result = await scheduleRepo.list({
          page: query.page,
          limit: query.limit,
          is_active: query.is_active === 'true' ? true : query.is_active === 'false' ? false : undefined,
          actor,
          ability,
        });
        const ownershipViews = await resolveContentOwnershipViews(result.items);

        return reply.send({
          items: result.items.map((schedule) =>
            serializeSchedule(schedule, ownershipViews.get(schedule.id), ability, actor)
          ),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List schedules error');
        return respondWithError(reply, error);
      }
    }
  );

  // Get schedule by ID
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.schedules.get,
    {
      schema: {
        description: 'Get schedule by ID',
        tags: ['Schedules'],
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
        if (!ability.can('read', 'Schedule')) throw AppError.forbidden('Forbidden');

        const schedule = await assertScheduleAccess(payload, (request.params as any).id);
        await reservationService.assertScheduleMutable(schedule.id, db);

        const actor = actorFor(payload);
        const ownership = (await resolveContentOwnershipViews([schedule])).get(schedule.id);
        return reply.send(serializeSchedule(schedule, ownership, ability, actor));
      } catch (error) {
        logger.error(error, 'Get schedule error');
        return respondWithError(reply, error);
      }
    }
  );

  // List schedule items (with resolved presentations/media for preview)
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.schedules.items,
    {
      schema: {
        description: 'List schedule items (presentation slots)',
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
        if (!ability.can('read', 'Schedule')) throw AppError.forbidden('Forbidden');

        const schedule = await assertScheduleAccess(payload, (request.params as any).id);
        await reservationService.assertScheduleMutable(schedule.id, db);

        const items = await scheduleItemRepo.listBySchedule(schedule.id);
        const presMap = await resolvePresentations(items.map((i: any) => i.presentation_id));
        const actor = actorFor(payload);
        for (const presentation of presMap.values()) {
          if (!canReadContentResource(actor, presentation, ability, 'Presentation')) {
            throw AppError.forbidden('Schedule contains a presentation outside your ownership scope.');
          }
          if (presentation.layout && !canReadContentResource(actor, presentation.layout, ability, 'Layout')) {
            throw AppError.forbidden('Schedule contains a layout outside your ownership scope.');
          }
          const referencedMedia = [...(presentation.items || []), ...(presentation.slots || [])]
            .map((item: any) => item.media)
            .filter(Boolean);
          if (referencedMedia.some((media: any) => !canReadContentResource(actor, media, ability, 'Media'))) {
            throw AppError.forbidden('Schedule contains media outside your ownership scope.');
          }
        }
        const presentations = Array.from(presMap.values());
        const layouts = presentations.map((presentation) => presentation.layout).filter(Boolean);
        const media = presentations.flatMap((presentation) =>
          [...(presentation.items || []), ...(presentation.slots || [])]
            .map((item: any) => item.media)
            .filter(Boolean)
        );
        const ownershipViews = await resolveContentOwnershipViews([
          ...presentations,
          ...layouts,
          ...media,
        ]);

        return reply.send({
          items: items.map((i: any) => {
            const pres = presMap.get(i.presentation_id);
            return {
              id: i.id,
              presentation_id: i.presentation_id,
              start_at: i.start_at.toISOString?.() ?? i.start_at,
              end_at: i.end_at.toISOString?.() ?? i.end_at,
              priority: i.priority,
              screen_ids: i.screen_ids || [],
              screen_group_ids: i.screen_group_ids || [],
              created_at: i.created_at.toISOString?.() ?? i.created_at,
              presentation: pres
                ? {
                    id: pres.id,
                    name: pres.name,
                    description: pres.description,
                    layout_id: pres.layout_id ?? null,
                    ...contentResponseMetadata(
                      pres,
                      ownershipViews.get(pres.id),
                      actor,
                      ability,
                      'Presentation'
                    ),
                    created_at: pres.created_at?.toISOString?.() ?? pres.created_at,
                    updated_at: pres.updated_at?.toISOString?.() ?? pres.updated_at,
                    layout: pres.layout
                      ? serializeNestedLayout(
                          pres.layout,
                          ownershipViews.get(pres.layout.id),
                          ability,
                          actor
                        )
                      : null,
                    items: (pres.items || []).map((pi: any) => ({
                      id: pi.id,
                      media_id: pi.media_id,
                      order: pi.order,
                      duration_seconds: pi.duration_seconds,
                      page_number: pi.page_number ?? (pi.media?.type === 'DOCUMENT' ? 1 : null),
                      media: pi.media
                        ? serializeNestedMedia(
                            pi.media,
                            ownershipViews.get(pi.media.id),
                            ability,
                            actor
                          )
                        : null,
                    })),
                    slots: (pres.slots || []).map((si: any) => ({
                      id: si.id,
                      slot_id: si.slot_id,
                      media_id: si.media_id,
                      order: si.order,
                      duration_seconds: si.duration_seconds,
                      fit_mode: si.fit_mode,
                      audio_enabled: si.audio_enabled,
                      loop_enabled: si.loop_enabled ?? false,
                      page_number: si.page_number ?? (si.media?.type === 'DOCUMENT' ? 1 : null),
                      media: si.media
                        ? serializeNestedMedia(
                            si.media,
                            ownershipViews.get(si.media.id),
                            ability,
                            actor
                          )
                        : null,
                    })),
                  }
                : null,
            };
          }),
        });
      } catch (error) {
        logger.error(error, 'List schedule items error');
        return respondWithError(reply, error);
      }
    }
  );

  // Add schedule item
  fastify.post<{ Params: { id: string }; Body: typeof scheduleItemSchema._type }>(
    apiEndpoints.schedules.items,
    {
      schema: {
        description: 'Add a presentation to a schedule time window',
        tags: ['Schedules'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const data = scheduleItemSchema.parse(request.body);
        const { startAt, endAt } = validateStartEnd(data.start_at, data.end_at);
        const authorized = await withScheduleMutation(
          payload,
          (request.params as any).id,
          { action: 'create', subject: 'ScheduleItem' },
          async ({ schedule, actor, ability, executor }) => {
            const pres = await presentationRepo.findById(data.presentation_id, executor);
            if (!pres) throw AppError.notFound('Presentation not found');
            if (!canReadContentResource(actor, pres, ability, 'Presentation')) {
              throw AppError.forbidden('Forbidden');
            }
            if (!canReferenceContentResource(schedule, pres)) {
              throw AppError.badRequest('The selected presentation has narrower ownership than the schedule.');
            }
            const resolvedPresentation = (await resolvePresentations([pres.id], executor)).get(pres.id);
            const ownershipIssues = findScheduleOwnershipCompatibilityIssues(
              schedule,
              resolvedPresentation ? [resolvedPresentation] : [pres]
            );
            if (ownershipIssues.length > 0) {
              throw AppError.badRequest('The selected presentation contains content with incompatible ownership.', {
                reason: 'INCOMPATIBLE_CONTENT_OWNERSHIP',
                invalid_references: ownershipIssues,
              });
            }

            const uniqueScreenIds = Array.from(new Set(data.screen_ids || []));
            if (uniqueScreenIds.length) {
              const screens = await executor
                .select({ id: schema.screens.id })
                .from(schema.screens)
                .where(inArray(schema.screens.id, uniqueScreenIds as any));
              if (screens.length !== uniqueScreenIds.length) {
                throw AppError.badRequest('One or more screen_ids are invalid');
              }
            }

            const uniqueGroupIds = Array.from(new Set(data.screen_group_ids || []));
            if (uniqueGroupIds.length) {
              const groups = await executor
                .select({ id: schema.screenGroups.id })
                .from(schema.screenGroups)
                .where(inArray(schema.screenGroups.id, uniqueGroupIds as any));
              if (groups.length !== uniqueGroupIds.length) {
                throw AppError.badRequest('One or more screen_group_ids are invalid');
              }
            }

            if (startAt < new Date(schedule.start_at) || endAt > new Date(schedule.end_at)) {
              throw AppError.badRequest('Item window must be within the schedule start/end window');
            }

            const existing = await scheduleItemRepo.listBySchedule(schedule.id, executor);
            if (hasOverlap(existing, startAt, endAt, { screen_ids: uniqueScreenIds, screen_group_ids: uniqueGroupIds })) {
              throw AppError.badRequest('Schedule item overlaps with an existing item for the same targets');
            }

            const item = await scheduleItemRepo.create({
              schedule_id: schedule.id,
              presentation_id: data.presentation_id,
              start_at: startAt,
              end_at: endAt,
              priority: data.priority ?? 0,
              screen_ids: uniqueScreenIds,
              screen_group_ids: uniqueGroupIds,
            }, executor);
            return { item, scheduleId: schedule.id };
          }
        );

        return reply.status(CREATED).send({
          id: authorized.item.id,
          schedule_id: authorized.scheduleId,
          presentation_id: authorized.item.presentation_id,
          start_at: authorized.item.start_at.toISOString?.() ?? authorized.item.start_at,
          end_at: authorized.item.end_at.toISOString?.() ?? authorized.item.end_at,
          priority: authorized.item.priority,
          screen_ids: authorized.item.screen_ids || [],
          screen_group_ids: authorized.item.screen_group_ids || [],
        });
      } catch (error) {
        logger.error(error, 'Add schedule item error');
        return respondWithError(reply, error);
      }
    }
  );

  // Delete schedule item
  fastify.delete<{ Params: { id: string; itemId: string } }>(
    apiEndpoints.schedules.item,
    {
      schema: {
        description: 'Delete a schedule item',
        tags: ['Schedules'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        await withScheduleMutation(
          payload,
          (request.params as any).id,
          { action: 'delete', subject: 'ScheduleItem' },
          async ({ schedule, executor }) => {
            const [item] = await executor
              .select()
              .from(schema.scheduleItems)
              .where(
                and(
                  eq(schema.scheduleItems.id, (request.params as any).itemId),
                  eq(schema.scheduleItems.schedule_id, schedule.id)
                )
              )
              .for('update');
            if (!item) throw AppError.notFound('Schedule item not found');
            await scheduleItemRepo.delete(item.id, executor);
          }
        );
        return reply.status(204).send();
      } catch (error) {
        logger.error(error, 'Delete schedule item error');
        return respondWithError(reply, error);
      }
    }
  );

  // Update schedule
  fastify.patch<{ Params: { id: string }; Body: typeof updateScheduleSchema._type }>(
    apiEndpoints.schedules.update,
    {
      schema: {
        description: 'Update schedule',
        tags: ['Schedules'],
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
        const data = updateScheduleSchema.parse(request.body);
        const timezone =
          Object.prototype.hasOwnProperty.call(data, 'timezone') ? validateTimeZone(data.timezone ?? null) : undefined;

        let startAt: Date | undefined;
        let endAt: Date | undefined;
        if (data.start_at) startAt = new Date(data.start_at);
        if (data.end_at) endAt = new Date(data.end_at);

        // Validate provided dates
        if (startAt || endAt) {
          const now = new Date();
          if (startAt && isNaN(startAt.getTime())) throw AppError.badRequest('Invalid start_at');
          if (endAt && isNaN(endAt.getTime())) throw AppError.badRequest('Invalid end_at');
          if (startAt && startAt < now) throw AppError.badRequest('start_at cannot be in the past');
          if (endAt && endAt < now) throw AppError.badRequest('end_at cannot be in the past');
          if (startAt && endAt && startAt >= endAt) throw AppError.badRequest('start_at must be before end_at');
        }

        const authorized = await withScheduleMutation(
          payload,
          (request.params as any).id,
          { action: 'update', subject: 'Schedule' },
          async ({ schedule: existingSchedule, actor, ability, executor }) => {
            await reservationService.assertScheduleMutable(existingSchedule.id, executor);

            const nextStartAt = startAt ?? existingSchedule.start_at;
            const nextEndAt = endAt ?? existingSchedule.end_at;
            const existingItems = await scheduleItemRepo.listBySchedule(existingSchedule.id, executor);
            const outOfBoundsItem = existingItems.find(
              (item: any) => item.start_at < nextStartAt || item.end_at > nextEndAt
            );
            if (outOfBoundsItem) {
              throw AppError.badRequest('Updated schedule window would exclude one or more existing schedule items');
            }

            const schedule = await scheduleRepo.update(existingSchedule.id, {
              ...data,
              timezone,
              start_at: startAt,
              end_at: endAt,
            }, executor);
            return { schedule, actor, ability };
          }
        );

        const ownership = (await resolveContentOwnershipViews([authorized.schedule])).get(authorized.schedule.id);
        return reply.send(serializeSchedule(
          authorized.schedule,
          ownership,
          authorized.ability,
          authorized.actor
        ));
      } catch (error) {
        logger.error(error, 'Update schedule error');
        return respondWithError(reply, error);
      }
    }
  );

  // Publish schedule
  fastify.post<{ Params: { id: string }; Body: typeof publishScheduleSchema._type }>(
    apiEndpoints.schedules.publish,
    {
      schema: {
        description: 'Publish schedule to screens',
        tags: ['Schedules'],
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
        const data = publishScheduleSchema.parse(request.body);
        const uniqueScreens = Array.from(new Set(data.screen_ids || []));
        const uniqueGroups = Array.from(new Set(data.screen_group_ids || []));
        const authorized = await withScheduleMutation(
          payload,
          (request.params as any).id,
          { action: 'publish', subject: 'ScheduleRequest' },
          async ({ schedule, actor, executor }) => {
            if (uniqueScreens.length) {
              const screens = await executor
                .select({ id: schema.screens.id })
                .from(schema.screens)
                .where(inArray(schema.screens.id, uniqueScreens as any));
              if (screens.length !== uniqueScreens.length) {
                throw AppError.badRequest('One or more screen_ids are invalid');
              }
            }
            if (uniqueGroups.length) {
              const groups = await executor
                .select({ id: schema.screenGroups.id })
                .from(schema.screenGroups)
                .where(inArray(schema.screenGroups.id, uniqueGroups as any));
              if (groups.length !== uniqueGroups.length) {
                throw AppError.badRequest('One or more screen_group_ids are invalid');
              }
            }

            let scheduleRequest: typeof schema.scheduleRequests.$inferSelect | null = null;
            if (data.schedule_request_id) {
              const [req] = await executor
                .select()
                .from(schema.scheduleRequests)
                .where(eq(schema.scheduleRequests.id, data.schedule_request_id))
                .for('update');
              if (!req) throw AppError.notFound('Schedule request not found');
              if (req.schedule_id && req.schedule_id !== schedule.id) {
                throw AppError.badRequest('Schedule request does not match this schedule');
              }
              const validation = await reservationService.validateApprovedRequestForPublish(req.id, executor);
              if (validation.alreadyPublished && validation.publishId) {
                const [existingPublish] = await executor
                  .select()
                  .from(schema.publishes)
                  .where(eq(schema.publishes.id, validation.publishId));
                if (!existingPublish) {
                  throw AppError.conflict('The request is marked as published but the publish record could not be found.');
                }
                return {
                  kind: 'existing' as const,
                  scheduleId: schedule.id,
                  publishId: existingPublish.id,
                  snapshotId: existingPublish.snapshot_id,
                };
              }
              scheduleRequest = req;
            }

            const publishResult = await publishScheduleSnapshot({
              scheduleId: schedule.id,
              screenIds: uniqueScreens,
              screenGroupIds: uniqueGroups,
              publishedBy: actor.userId,
              notes: data.notes,
              aspectOverride: data.aspect_override ?? null,
              db: executor,
              scheduleRepo,
              scheduleItemRepo,
              onPublished: async ({ tx, publish }) => {
                if (scheduleRequest) {
                  await reservationService.finalizeRequestPublish(
                    {
                      scheduleRequestId: scheduleRequest.id,
                      publishId: publish.id,
                    },
                    tx
                  );
                  return;
                }

                await reservationService.acquireDirectPublishedReservations(
                  {
                    scheduleId: schedule.id,
                    ownerUserId: actor.userId,
                    publishId: publish.id,
                    explicitScreenIds: uniqueScreens,
                    explicitScreenGroupIds: uniqueGroups,
                  },
                  tx
                );
              },
            });

            if (data.aspect_override) {
              await executor.insert(schema.systemLogs).values({
                level: 'INFO',
                message: 'Display aspect override accepted for schedule publish',
                context: {
                  schedule_id: schedule.id,
                  publish_id: publishResult.publish.id,
                  accepted_by: actor.userId,
                  accepted_at: new Date().toISOString(),
                  issue_hash: data.aspect_override.issue_hash,
                  reason: data.aspect_override.reason ?? null,
                },
              });
            }

            return { kind: 'published' as const, scheduleId: schedule.id, publishResult, actor };
          }
        );

        if (authorized.kind === 'existing') {
          return reply.send({
            message: 'Schedule was already published successfully',
            schedule_id: authorized.scheduleId,
            publish_id: authorized.publishId,
            snapshot_id: authorized.snapshotId,
          });
        }

        await dispatchPlaybackRefresh(fastify, {
          reason: 'PUBLISH',
          screenIds: authorized.publishResult.resolvedScreenIds,
          groupIds: uniqueGroups,
          createdBy: authorized.actor.userId,
          publishId: authorized.publishResult.publish.id,
          snapshotId: authorized.publishResult.snapshot.id,
        });

        return reply.send({
          message: 'Schedule published successfully',
          schedule_id: authorized.scheduleId,
          publish_id: authorized.publishResult.publish.id,
          snapshot_id: authorized.publishResult.snapshot.id,
          targets: authorized.publishResult.targets.length,
          resolved_screen_ids: authorized.publishResult.resolvedScreenIds,
        });
      } catch (error) {
        logger.error(error, 'Publish schedule error');
        return respondWithError(reply, error);
      }
    }
  );

  // Poll single publish
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    apiEndpoints.schedules.takeDownPublish,
    {
      schema: {
        description: 'Take down a publish record and remove it from targeted screens',
        tags: ['Schedules'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const body = takeDownPublishSchema.parse(request.body ?? {});
        const authorized = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          const [publish] = await executor
            .select()
            .from(schema.publishes)
            .where(eq(schema.publishes.id, (request.params as any).id))
            .for('update');
          if (!publish) throw AppError.notFound('Publish not found');
          const [schedule] = await executor
            .select()
            .from(schema.schedules)
            .where(eq(schema.schedules.id, publish.schedule_id))
            .for('update');
          if (schedule && !canUnconditionally(ability, 'publish', 'ScheduleRequest') &&
              !(ability as any).can('manage', caslSubject('Schedule', { ...schedule }))) {
            throw AppError.forbidden('Forbidden');
          }
          if (!schedule || !canAccessContentMutationScope(actor, schedule, ability, 'Schedule')) {
            throw AppError.forbidden('Forbidden');
          }
          const takedownResult = await reservationService.takeDownPublish(
            {
              publishId: publish.id,
              takenDownBy: actor.userId,
              takedownReason: body.reason ?? null,
            },
            executor
          );
          return { takedownResult, publish, actor };
        });

        if (authorized.takedownResult.screenIds.length > 0) {
          await dispatchPlaybackRefresh(fastify, {
            reason: 'TAKE_DOWN',
            screenIds: authorized.takedownResult.screenIds,
            createdBy: authorized.actor.userId,
            publishId: authorized.publish.id,
          });
        }

        const responsePublish = authorized.takedownResult.publish ?? authorized.publish;
        return reply.send({
          ...responsePublish,
          published_at: responsePublish.published_at.toISOString?.() ?? responsePublish.published_at,
          taken_down_at: responsePublish.taken_down_at?.toISOString?.() ?? responsePublish.taken_down_at ?? null,
          resolved_screen_ids: authorized.takedownResult.screenIds,
          message: authorized.takedownResult.alreadyTakenDown
            ? 'Publish was already taken down'
            : 'Publish removed from targeted screens.',
        });
      } catch (error) {
        logger.error(error, 'Take down publish error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.schedules.publishStatus,
    {
      schema: {
        description: 'Get publish record and target statuses',
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
        if (!ability.can('read', 'Schedule')) throw AppError.forbidden('Forbidden');

        const [publish] = await db
          .select()
          .from(schema.publishes)
          .where(eq(schema.publishes.id, (request.params as any).id));
        if (!publish) throw AppError.notFound('Publish not found');
        await assertScheduleAccess(payload, publish.schedule_id);

        const targets = await db
          .select()
          .from(schema.publishTargets)
          .where(eq(schema.publishTargets.publish_id, publish.id));

        return reply.send({
          ...publish,
          published_at: publish.published_at.toISOString?.() ?? publish.published_at,
          targets,
        });
      } catch (error) {
        logger.error(error, 'Get publish error');
        return respondWithError(reply, error);
      }
    }
  );
}
