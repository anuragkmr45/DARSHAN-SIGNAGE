import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createPresentationRepository } from '@/db/repositories/presentation';
import { createPresentationItemRepository } from '@/db/repositories/presentation-item';
import { createMediaRepository } from '@/db/repositories/media';
import { createPresentationSlotItemRepository } from '@/db/repositories/presentation-slot-item';
import { createLayoutRepository } from '@/db/repositories/layout';
import { extractTokenFromHeader, verifyAccessToken, type JWTPayload } from '@/auth/jwt';
import {
  withCurrentMutationAuthorization,
  type MutationAuthorizationContext,
} from '@/auth/mutation-authorization';
import { defineAbilityFor } from '@/rbac';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { getDatabase, schema } from '@/db';
import { eq, inArray } from 'drizzle-orm';
import { AppError } from '@/utils/app-error';
import { serializeMediaRecord } from '@/utils/media';
import { normalizeDocumentPage } from '@/utils/document-page-selection';
import { normalizeVideoLoopEnabled } from '@/utils/video-loop';
import type { ActorContext } from '@/rbac/policy';
import {
  canManageContentResource,
  canReadContentResource,
  canReferenceContentResource,
  contentResponseMetadata,
  ownershipForNewContent,
  resolveContentOwnershipViews,
} from '@/rbac/content-ownership';

const logger = createLogger('presentation-routes');
const { CREATED, NO_CONTENT } = HTTP_STATUS;

const createPresentationSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  layout_id: z.string().uuid().optional(),
});

const listPresentationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const presentationItemSchema = z.object({
  media_id: z.string().uuid(),
  order: z.number().int().nonnegative().optional(),
  duration_seconds: z.number().int().positive().optional(),
  page_number: z.number().int().positive().optional(),
});

const presentationSlotItemSchema = z.object({
  slot_id: z.string().min(1),
  media_id: z.string().uuid(),
  order: z.number().int().nonnegative().optional(),
  duration_seconds: z.number().int().positive().optional(),
  fit_mode: z.string().optional(),
  audio_enabled: z.boolean().optional(),
  loop_enabled: z.boolean().optional(),
  page_number: z.number().int().positive().optional(),
});

const replacePresentationSlotsSchema = z.object({
  items: z.array(presentationSlotItemSchema),
});

function layoutSlotIds(spec: unknown): Set<string> {
  const slots = Array.isArray(spec)
    ? spec
    : spec && typeof spec === 'object' && Array.isArray((spec as { slots?: unknown }).slots)
      ? (spec as { slots: unknown[] }).slots
      : [];
  return new Set(
    slots
      .map((slot) => (slot && typeof slot === 'object' ? (slot as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );
}

export async function presentationRoutes(fastify: FastifyInstance) {
  const presRepo = createPresentationRepository();
  const presItemRepo = createPresentationItemRepository();
  const mediaRepo = createMediaRepository();
  const slotItemRepo = createPresentationSlotItemRepository();
  const layoutRepo = createLayoutRepository();
  const db = getDatabase();
  const actorFor = (payload: { sub: string; role: string; department_id?: string | null }): ActorContext => ({
    userId: payload.sub,
    roleName: payload.role,
    departmentId: payload.department_id,
  });
  const authorizePresentation = async (
    payload: { sub: string; role: string; role_id: string; department_id?: string | null },
    presentation: any,
    action: 'read' | 'update' | 'delete'
  ) => {
    const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id ?? undefined);
    if (!ability.can(action, 'Presentation')) throw AppError.forbidden('Forbidden');
    const actor = actorFor(payload);
    const allowed = action === 'read'
      ? canReadContentResource(actor, presentation, ability, 'Presentation')
      : canManageContentResource(actor, presentation, ability, 'Presentation', action);
    if (!allowed) throw AppError.forbidden('Forbidden');
    return { ability, actor };
  };
  const withPresentationMutation = async <T>(
    payload: JWTPayload,
    presentationId: string,
    action: 'update' | 'delete',
    execute: (
      context: MutationAuthorizationContext & {
        presentation: typeof schema.presentations.$inferSelect;
      }
    ) => Promise<T>
  ) =>
    withCurrentMutationAuthorization(payload, async (context) => {
      if (!context.ability.can(action, 'Presentation')) throw AppError.forbidden('Forbidden');
      const [presentation] = await context.executor
        .select()
        .from(schema.presentations)
        .where(eq(schema.presentations.id, presentationId))
        .for('update');
      if (!presentation) throw AppError.notFound('Presentation not found');
      if (!canManageContentResource(
        context.actor,
        presentation,
        context.ability,
        'Presentation',
        action
      )) throw AppError.forbidden('Forbidden');
      return execute({ ...context, presentation });
    });
  const serializePresentation = (presentation: any, ownership: any, ability: any, actor: ActorContext) => {
    return {
      id: presentation.id,
      name: presentation.name,
      description: presentation.description,
      layout_id: presentation.layout_id ?? null,
      ...contentResponseMetadata(presentation, ownership, actor, ability, 'Presentation'),
      created_at: presentation.created_at.toISOString?.() ?? presentation.created_at,
      updated_at: presentation.updated_at.toISOString?.() ?? presentation.updated_at,
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
    ...serializeMediaRecord(media),
    ...contentResponseMetadata(media, ownership, actor, ability, 'Media'),
  });

  // Create presentation
  fastify.post<{ Body: typeof createPresentationSchema._type }>(
    apiEndpoints.presentations.create,
    {
      schema: {
        description: 'Create a new presentation',
        tags: ['Presentations'],
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
        const data = createPresentationSchema.parse(request.body);
        const authorized = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          if (!ability.can('create', 'Presentation')) throw AppError.forbidden('Forbidden');
          const newOwnership = ownershipForNewContent(actor, ability, 'Presentation');

          if (data.layout_id) {
            const layout = await layoutRepo.findById(data.layout_id, executor);
            if (!layout) throw AppError.notFound('Layout not found');
            if (!canReadContentResource(actor, layout, ability, 'Layout')) throw AppError.forbidden('Forbidden');
            if (!canReferenceContentResource({ id: 'new-presentation', ...newOwnership }, layout)) {
              throw AppError.badRequest('The selected layout has narrower ownership than the presentation.');
            }
          }

          const presentation = await presRepo.create({
            ...data,
            created_by: actor.userId,
            ...newOwnership,
          }, executor);
          return { presentation, actor, ability };
        });
        const ownership = (await resolveContentOwnershipViews([authorized.presentation])).get(authorized.presentation.id);
        return reply.status(CREATED).send(
          serializePresentation(authorized.presentation, ownership, authorized.ability, authorized.actor)
        );
      } catch (error) {
        logger.error(error, 'Create presentation error');
        return respondWithError(reply, error);
      }
    }
  );

  // List presentations
  fastify.get<{ Querystring: typeof listPresentationsQuerySchema._type }>(
    apiEndpoints.presentations.list,
    {
      schema: {
        description: 'List presentations with pagination',
        tags: ['Presentations'],
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
        if (!ability.can('read', 'Presentation')) throw AppError.forbidden('Forbidden');
        const actor = actorFor(payload);

        const query = listPresentationsQuerySchema.parse(request.query);
        const result = await presRepo.list({
          page: query.page,
          limit: query.limit,
          actor,
          ability,
        });
        const ownershipViews = await resolveContentOwnershipViews(result.items);

        return reply.send({
          items: result.items.map((presentation) =>
            serializePresentation(presentation, ownershipViews.get(presentation.id), ability, actor)
          ),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List presentations error');
        return respondWithError(reply, error);
      }
    }
  );

  // Get presentation by ID
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.presentations.get,
    {
      schema: {
        description: 'Get presentation by ID',
        tags: ['Presentations'],
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

        const presentation = await presRepo.findById((request.params as any).id);
        if (!presentation) {
          throw AppError.notFound('Presentation not found');
        }
        const { ability, actor } = await authorizePresentation(payload, presentation, 'read');

        let layout: any = null;
        if ((presentation as any).layout_id) {
          layout = await layoutRepo.findById((presentation as any).layout_id);
          if (layout && !canReadContentResource(actor, layout, ability, 'Layout')) {
            throw AppError.forbidden('Forbidden');
          }
        }

        const slotItems = await slotItemRepo.listByPresentation(presentation.id);
        const mediaIds = slotItems.map((i: any) => i.media_id);
        const mediaRows = mediaIds.length
          ? await db.select().from(schema.media).where(inArray(schema.media.id, mediaIds as any))
          : [];
        const mediaMap = new Map(mediaRows.map((m) => [m.id, m]));
        if (mediaRows.some((media) => !canReadContentResource(actor, media, ability, 'Media'))) {
          throw AppError.forbidden('Presentation contains media outside your ownership scope.');
        }

        const ownershipViews = await resolveContentOwnershipViews([
          presentation,
          ...(layout ? [layout] : []),
          ...mediaRows,
        ]);
        return reply.send({
          ...serializePresentation(presentation, ownershipViews.get(presentation.id), ability, actor),
          id: presentation.id,
          name: presentation.name,
          description: presentation.description,
          layout: layout
            ? serializeNestedLayout(layout, ownershipViews.get(layout.id), ability, actor)
            : null,
          slots: slotItems.map((i: any) => ({
            id: i.id,
            slot_id: i.slot_id,
            media_id: i.media_id,
            order: i.order,
            duration_seconds: i.duration_seconds,
            page_number: i.page_number ?? (mediaMap.get(i.media_id)?.type === 'DOCUMENT' ? 1 : null),
            fit_mode: i.fit_mode,
            audio_enabled: i.audio_enabled,
            loop_enabled: normalizeVideoLoopEnabled(mediaMap.get(i.media_id)?.type, i.loop_enabled),
            created_at: i.created_at.toISOString?.() ?? i.created_at,
            media: mediaMap.get(i.media_id)
              ? serializeNestedMedia(
                  mediaMap.get(i.media_id),
                  ownershipViews.get(i.media_id),
                  ability,
                  actor
                )
              : null,
          })),
        });
      } catch (error) {
        logger.error(error, 'Get presentation error');
        return respondWithError(reply, error);
      }
    }
  );

  // List presentation items
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.presentations.items,
    {
      schema: {
        description: 'List media items within a presentation',
        tags: ['Presentations'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');

        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('read', 'Presentation')) throw AppError.forbidden('Forbidden');

        const presentation = await presRepo.findById((request.params as any).id);
        if (!presentation) throw AppError.notFound('Presentation not found');
        const actor = actorFor(payload);
        if (!canReadContentResource(actor, presentation, ability, 'Presentation')) {
          throw AppError.forbidden('Forbidden');
        }

        const items = await presItemRepo.listByPresentation(presentation.id);
        const mediaIds = items.map((i: any) => i.media_id);
        const db = getDatabase();
        const mediaRows = mediaIds.length
          ? await db.select().from(schema.media).where(inArray(schema.media.id, mediaIds as any))
          : [];
        const mediaMap = new Map(mediaRows.map((m) => [m.id, m]));
        if (mediaRows.some((media) => !canReadContentResource(actor, media, ability, 'Media'))) {
          throw AppError.forbidden('Presentation contains media outside your ownership scope.');
        }
        const ownershipViews = await resolveContentOwnershipViews(mediaRows);

        return reply.send({
          items: items.map((i: any) => {
            const media = mediaMap.get(i.media_id);
            return {
              id: i.id,
              media_id: i.media_id,
              order: i.order,
              duration_seconds: i.duration_seconds,
              page_number: i.page_number ?? (media?.type === 'DOCUMENT' ? 1 : null),
              created_at: i.created_at.toISOString?.() ?? i.created_at,
              media: media
                ? serializeNestedMedia(media, ownershipViews.get(media.id), ability, actor)
                : null,
            };
          }),
        });
      } catch (error) {
        logger.error(error, 'List presentation items error');
        return respondWithError(reply, error);
      }
    }
  );

  // Add presentation item
  fastify.post<{ Params: { id: string }; Body: typeof presentationItemSchema._type }>(
    apiEndpoints.presentations.items,
    {
      schema: {
        description: 'Add media to a presentation playlist',
        tags: ['Presentations'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');

        const payload = await verifyAccessToken(token);
        const data = presentationItemSchema.parse(request.body);
        const authorized = await withPresentationMutation(
          payload,
          (request.params as any).id,
          'update',
          async ({ presentation, actor, ability, executor }) => {
            const media = await mediaRepo.findById(data.media_id, executor);
            if (!media) throw AppError.notFound('Media not found');
            if (!canReadContentResource(actor, media, ability, 'Media')) throw AppError.forbidden('Forbidden');
            if (!canReferenceContentResource(presentation, media)) {
              throw AppError.badRequest('The selected media has narrower ownership than the presentation.');
            }
            if (media.status !== 'READY') {
              throw AppError.validation({ reason: 'MEDIA_NOT_READY', media_id: media.id });
            }
            const pageNumber = normalizeDocumentPage(media, data.page_number);

            const existing = await presItemRepo.listByPresentation(presentation.id, executor);
            const desiredOrder =
              data.order ?? (existing.length ? Math.max(...existing.map((i: any) => i.order)) + 1 : 0);
            if (data.order !== undefined && existing.some((i: any) => i.order === desiredOrder)) {
              throw AppError.badRequest('Order already used in this presentation');
            }

            const item = await presItemRepo.create({
              presentation_id: presentation.id,
              media_id: data.media_id,
              order: desiredOrder,
              duration_seconds: data.duration_seconds,
              page_number: pageNumber,
            }, executor);
            return { item, media, actor, ability };
          }
        );
        const ownership = (await resolveContentOwnershipViews([authorized.media])).get(authorized.media.id);

        return reply.status(CREATED).send({
          id: authorized.item.id,
          presentation_id: (request.params as any).id,
          media_id: authorized.item.media_id,
          order: authorized.item.order,
          duration_seconds: authorized.item.duration_seconds,
          page_number: authorized.item.page_number ?? (authorized.media.type === 'DOCUMENT' ? 1 : null),
          created_at: authorized.item.created_at.toISOString?.() ?? authorized.item.created_at,
          media: serializeNestedMedia(
            authorized.media,
            ownership,
            authorized.ability,
            authorized.actor
          ),
        });
      } catch (error) {
        logger.error(error, 'Add presentation item error');
        return respondWithError(reply, error);
      }
    }
  );

  // Delete presentation item
  fastify.delete<{ Params: { id: string; itemId: string } }>(
    apiEndpoints.presentations.item,
    {
      schema: {
        description: 'Delete a media item from a presentation',
        tags: ['Presentations'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');

        const payload = await verifyAccessToken(token);
        await withPresentationMutation(
          payload,
          (request.params as any).id,
          'update',
          async ({ presentation, executor }) => {
            const item = await presItemRepo.findById((request.params as any).itemId, executor);
            if (!item || item.presentation_id !== presentation.id) {
              throw AppError.notFound('Presentation item not found');
            }
            await presItemRepo.delete(item.id, executor);
          }
        );
        return reply.status(NO_CONTENT).send();
      } catch (error) {
        logger.error(error, 'Delete presentation item error');
        return respondWithError(reply, error);
      }
    }
  );

  // List presentation slot items
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.presentations.slotItems,
    {
      schema: {
        description: 'List slot media items for a presentation layout',
        tags: ['Presentations'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('read', 'Presentation')) throw AppError.forbidden('Forbidden');

        const presentation = await presRepo.findById((request.params as any).id);
        if (!presentation) throw AppError.notFound('Presentation not found');
        const actor = actorFor(payload);
        if (!canReadContentResource(actor, presentation, ability, 'Presentation')) {
          throw AppError.forbidden('Forbidden');
        }

        const slots = await slotItemRepo.listByPresentation(presentation.id);
        const mediaIds = slots.map((i: any) => i.media_id);
        const mediaRows = mediaIds.length
          ? await db.select().from(schema.media).where(inArray(schema.media.id, mediaIds as any))
          : [];
        const mediaMap = new Map(mediaRows.map((m) => [m.id, m]));
        if (mediaRows.some((media) => !canReadContentResource(actor, media, ability, 'Media'))) {
          throw AppError.forbidden('Presentation contains media outside your ownership scope.');
        }
        const ownershipViews = await resolveContentOwnershipViews(mediaRows);

        return reply.send({
          items: slots.map((i: any) => ({
            id: i.id,
            slot_id: i.slot_id,
            media_id: i.media_id,
            order: i.order,
            duration_seconds: i.duration_seconds,
            page_number: i.page_number ?? (mediaMap.get(i.media_id)?.type === 'DOCUMENT' ? 1 : null),
            fit_mode: i.fit_mode,
            audio_enabled: i.audio_enabled,
            loop_enabled: normalizeVideoLoopEnabled(mediaMap.get(i.media_id)?.type, i.loop_enabled),
            created_at: i.created_at.toISOString?.() ?? i.created_at,
            media: mediaMap.get(i.media_id)
              ? serializeNestedMedia(
                  mediaMap.get(i.media_id),
                  ownershipViews.get(i.media_id),
                  ability,
                  actor
                )
              : null,
          })),
        });
      } catch (error) {
        logger.error(error, 'List presentation slot items error');
        return respondWithError(reply, error);
      }
    }
  );

  // Add presentation slot item
  fastify.post<{ Params: { id: string }; Body: typeof presentationSlotItemSchema._type }>(
    apiEndpoints.presentations.slotItems,
    {
      schema: {
        description: 'Add media to a presentation slot',
        tags: ['Presentations'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const data = presentationSlotItemSchema.parse(request.body);
        const authorized = await withPresentationMutation(
          payload,
          (request.params as any).id,
          'update',
          async ({ presentation, actor, ability, executor }) => {
            if (!presentation.layout_id) {
              throw AppError.badRequest('Presentation has no layout assigned');
            }

            const layout = await layoutRepo.findById(presentation.layout_id, executor);
            if (!layout || !layoutSlotIds(layout.spec).has(data.slot_id)) {
              throw AppError.validation({ reason: 'LAYOUT_SLOT_NOT_FOUND', slot_id: data.slot_id });
            }
            if (!canReadContentResource(actor, layout, ability, 'Layout')) throw AppError.forbidden('Forbidden');
            if (!canReferenceContentResource(presentation, layout)) {
              throw AppError.badRequest('The presentation layout has narrower ownership than the presentation.');
            }
            const media = await mediaRepo.findById(data.media_id, executor);
            if (!media) throw AppError.notFound('Media not found');
            if (!canReadContentResource(actor, media, ability, 'Media')) throw AppError.forbidden('Forbidden');
            if (!canReferenceContentResource(presentation, media)) {
              throw AppError.badRequest('The selected media has narrower ownership than the presentation.');
            }
            if (media.status !== 'READY') {
              throw AppError.validation({ reason: 'MEDIA_NOT_READY', media_id: media.id });
            }
            const pageNumber = normalizeDocumentPage(media, data.page_number);

            const existing = await slotItemRepo.listByPresentation(presentation.id, executor);
            const order =
              data.order ??
              (() => {
                const inSlot = existing.filter((i: any) => i.slot_id === data.slot_id);
                return inSlot.length ? Math.max(...inSlot.map((i: any) => i.order || 0)) + 1 : 0;
              })();
            if (existing.some((item: any) => item.slot_id === data.slot_id && item.order === order)) {
              throw AppError.validation({
                reason: 'PRESENTATION_SLOT_ORDER_CONFLICT',
                slot_id: data.slot_id,
                order,
              });
            }

            const item = await slotItemRepo.create({
              presentation_id: presentation.id,
              slot_id: data.slot_id,
              media_id: data.media_id,
              order,
              duration_seconds: data.duration_seconds,
              fit_mode: data.fit_mode,
              audio_enabled: data.audio_enabled,
              loop_enabled: normalizeVideoLoopEnabled(media.type, data.loop_enabled),
              page_number: pageNumber,
            }, executor);
            return { item, media, actor, ability };
          }
        );
        const ownership = (await resolveContentOwnershipViews([authorized.media])).get(authorized.media.id);

        return reply.status(CREATED).send({
          id: authorized.item.id,
          presentation_id: (request.params as any).id,
          slot_id: authorized.item.slot_id,
          media_id: authorized.item.media_id,
          order: authorized.item.order,
          duration_seconds: authorized.item.duration_seconds,
          fit_mode: authorized.item.fit_mode,
          audio_enabled: authorized.item.audio_enabled,
          loop_enabled: normalizeVideoLoopEnabled(authorized.media.type, authorized.item.loop_enabled),
          page_number: authorized.item.page_number ?? (authorized.media.type === 'DOCUMENT' ? 1 : null),
          created_at: authorized.item.created_at.toISOString?.() ?? authorized.item.created_at,
          media: serializeNestedMedia(
            authorized.media,
            ownership,
            authorized.ability,
            authorized.actor
          ),
        });
      } catch (error) {
        logger.error(error, 'Add presentation slot item error');
        return respondWithError(reply, error);
      }
    }
  );

  // Atomically replace all layout-slot items for a presentation.
  fastify.put<{ Params: { id: string }; Body: typeof replacePresentationSlotsSchema._type }>(
    apiEndpoints.presentations.slotItems,
    {
      schema: {
        description: 'Atomically replace all media assigned to presentation layout slots',
        tags: ['Presentations'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const data = replacePresentationSlotsSchema.parse(request.body);
        const authorized = await withPresentationMutation(
          payload,
          (request.params as any).id,
          'update',
          async ({ presentation, actor, ability, executor }) => {
            if (!presentation.layout_id) {
              throw AppError.badRequest('Presentation has no layout assigned');
            }
            const layout = await layoutRepo.findById(presentation.layout_id, executor);
            if (!layout) throw AppError.notFound('Presentation layout not found');
            if (!canReadContentResource(actor, layout, ability, 'Layout')) throw AppError.forbidden('Forbidden');
            if (!canReferenceContentResource(presentation, layout)) {
              throw AppError.badRequest('The presentation layout has narrower ownership than the presentation.');
            }
            const allowedSlotIds = layoutSlotIds(layout.spec);
            const mediaIds = Array.from(new Set(data.items.map((item) => item.media_id)));
            const mediaRows = mediaIds.length
              ? await executor.select().from(schema.media).where(inArray(schema.media.id, mediaIds as any))
              : [];
            const mediaMap = new Map(mediaRows.map((media) => [media.id, media]));
            const usedOrders = new Map<string, Set<number>>();
            const nextOrders = new Map<string, number>();

            const normalizedItems = data.items.map((item) => {
              if (!allowedSlotIds.has(item.slot_id)) {
                throw AppError.validation({ reason: 'LAYOUT_SLOT_NOT_FOUND', slot_id: item.slot_id });
              }
              const media = mediaMap.get(item.media_id);
              if (!media) throw AppError.notFound('Media not found', { media_id: item.media_id });
              if (!canReadContentResource(actor, media, ability, 'Media')) throw AppError.forbidden('Forbidden');
              if (!canReferenceContentResource(presentation, media)) {
                throw AppError.badRequest('Selected media has narrower ownership than the presentation.');
              }
              if (media.status !== 'READY') {
                throw AppError.validation({ reason: 'MEDIA_NOT_READY', media_id: media.id });
              }

              const order = item.order ?? nextOrders.get(item.slot_id) ?? 0;
              const orders = usedOrders.get(item.slot_id) ?? new Set<number>();
              if (orders.has(order)) {
                throw AppError.validation({
                  reason: 'PRESENTATION_SLOT_ORDER_CONFLICT',
                  slot_id: item.slot_id,
                  order,
                });
              }
              orders.add(order);
              usedOrders.set(item.slot_id, orders);
              nextOrders.set(item.slot_id, Math.max(nextOrders.get(item.slot_id) ?? 0, order + 1));

              return {
                slot_id: item.slot_id,
                media_id: item.media_id,
                order,
                duration_seconds: item.duration_seconds,
                fit_mode: item.fit_mode,
                audio_enabled: item.audio_enabled,
                loop_enabled: normalizeVideoLoopEnabled(media.type, item.loop_enabled),
                page_number: normalizeDocumentPage(media, item.page_number),
              };
            });

            const replaced = await slotItemRepo.replaceByPresentation(
              presentation.id,
              normalizedItems,
              executor
            );
            return { replaced, mediaRows, mediaMap, actor, ability };
          }
        );
        const ownershipViews = await resolveContentOwnershipViews(authorized.mediaRows);
        return reply.send({
          items: authorized.replaced
            .sort((left, right) => left.slot_id.localeCompare(right.slot_id) || left.order - right.order)
            .map((item) => ({
              id: item.id,
              presentation_id: item.presentation_id,
              slot_id: item.slot_id,
              media_id: item.media_id,
              order: item.order,
              duration_seconds: item.duration_seconds,
              fit_mode: item.fit_mode,
              audio_enabled: item.audio_enabled,
              loop_enabled: normalizeVideoLoopEnabled(authorized.mediaMap.get(item.media_id)?.type, item.loop_enabled),
              page_number: item.page_number ?? (authorized.mediaMap.get(item.media_id)?.type === 'DOCUMENT' ? 1 : null),
              created_at: item.created_at.toISOString?.() ?? item.created_at,
              media: authorized.mediaMap.get(item.media_id)
                ? serializeNestedMedia(
                    authorized.mediaMap.get(item.media_id),
                    ownershipViews.get(item.media_id),
                    authorized.ability,
                    authorized.actor
                  )
                : null,
            })),
        });
      } catch (error) {
        logger.error(error, 'Replace presentation slot items error');
        return respondWithError(reply, error);
      }
    }
  );

  // Delete presentation slot item
  fastify.delete<{ Params: { id: string; slotItemId: string } }>(
    apiEndpoints.presentations.slotItem,
    {
      schema: {
        description: 'Delete a slot media item from a presentation',
        tags: ['Presentations'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        await withPresentationMutation(
          payload,
          (request.params as any).id,
          'update',
          async ({ presentation, executor }) => {
            const item = await slotItemRepo.findById((request.params as any).slotItemId, executor);
            if (!item || item.presentation_id !== presentation.id) {
              throw AppError.notFound('Presentation slot item not found');
            }
            await slotItemRepo.delete(item.id, executor);
          }
        );
        return reply.status(NO_CONTENT).send();
      } catch (error) {
        logger.error(error, 'Delete presentation slot item error');
        return respondWithError(reply, error);
      }
    }
  );

  // Update presentation
  fastify.patch<{ Params: { id: string }; Body: Partial<typeof createPresentationSchema._type> }>(
    apiEndpoints.presentations.update,
    {
      schema: {
        description: 'Update presentation',
        tags: ['Presentations'],
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
        const data = createPresentationSchema.partial().parse(request.body);
        const authorized = await withPresentationMutation(
          payload,
          (request.params as any).id,
          'update',
          async ({ presentation: existing, actor, ability, executor }) => {
            if (data.layout_id) {
              const layout = await layoutRepo.findById(data.layout_id, executor);
              if (!layout) throw AppError.notFound('Layout not found');
              if (!canReadContentResource(actor, layout, ability, 'Layout')) throw AppError.forbidden('Forbidden');
              if (!canReferenceContentResource(existing, layout)) {
                throw AppError.badRequest('The selected layout has narrower ownership than the presentation.');
              }
            }

            const presentation = await presRepo.update(existing.id, data, executor);
            if (!presentation) throw AppError.notFound('Presentation not found');
            return { presentation, actor, ability };
          }
        );

        const ownership = (await resolveContentOwnershipViews([authorized.presentation])).get(authorized.presentation.id);
        return reply.send(
          serializePresentation(authorized.presentation, ownership, authorized.ability, authorized.actor)
        );
      } catch (error) {
        logger.error(error, 'Update presentation error');
        return respondWithError(reply, error);
      }
    }
  );

  // Delete presentation
  fastify.delete<{ Params: { id: string } }>(
    apiEndpoints.presentations.delete,
    {
      schema: {
        description: 'Delete presentation',
        tags: ['Presentations'],
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
        await withPresentationMutation(
          payload,
          (request.params as any).id,
          'delete',
          async ({ presentation, executor }) => {
            await presRepo.delete(presentation.id, executor);
          }
        );
        return reply.status(NO_CONTENT).send();
      } catch (error) {
        logger.error(error, 'Delete presentation error');
        return respondWithError(reply, error);
      }
    }
  );
}
