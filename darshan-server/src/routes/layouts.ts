import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createLayoutRepository } from '@/db/repositories/layout';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { defineAbilityFor } from '@/rbac';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import type { ActorContext } from '@/rbac/policy';
import {
  canManageContentResource,
  canReadContentResource,
  contentResponseMetadata,
  ownershipForNewContent,
  resolveContentOwnershipViews,
} from '@/rbac/content-ownership';

const logger = createLogger('layout-routes');
const { CREATED } = HTTP_STATUS;

const layoutSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  aspect_ratio: z.string().min(1),
  spec: z.record(z.any()),
});

const listLayoutsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  aspect_ratio: z.string().optional(),
  search: z.string().min(1).optional(),
});

export async function layoutRoutes(fastify: FastifyInstance) {
  const repo = createLayoutRepository();
  const actorFor = (payload: { sub: string; role: string; department_id?: string | null }): ActorContext => ({
    userId: payload.sub,
    roleName: payload.role,
    departmentId: payload.department_id,
  });
  const serializeLayout = (layout: any, ownership: any, ability: any, actor: ActorContext) => {
    return {
      id: layout.id,
      name: layout.name,
      description: layout.description,
      aspect_ratio: layout.aspect_ratio,
      spec: layout.spec,
      is_shared: layout.owner_scope === 'ORGANIZATION',
      ...contentResponseMetadata(layout, ownership, actor, ability, 'Layout'),
      created_at: layout.created_at.toISOString?.() ?? layout.created_at,
      updated_at: layout.updated_at.toISOString?.() ?? layout.updated_at,
    };
  };
  const validateLayoutSpec = (spec: any) => {
    const slots = Array.isArray(spec) ? spec : spec?.slots;
    if (!Array.isArray(slots) || slots.length === 0) {
      throw new Error('spec must be an array of slot objects or { slots: [...] }');
    }

    const seenIds = new Set<string>();
    slots.forEach((slot: any, idx: number) => {
      const id = slot.id ?? slot.slot_id;
      const coords = ['x', 'y', 'w', 'h'];
      if (!id || typeof id !== 'string') {
        throw new Error(`slot[${idx}].id is required`);
      }
      if (seenIds.has(id)) throw new Error(`duplicate slot id "${id}"`);
      seenIds.add(id);
      coords.forEach((c) => {
        const v = slot[c];
        if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`slot[${idx}].${c} must be a number`);
        if (c === 'w' || c === 'h') {
          if (v <= 0 || v > 1) throw new Error(`slot[${idx}].${c} must be between 0 and 1`);
        } else {
          if (v < 0 || v >= 1) throw new Error(`slot[${idx}].${c} must be between 0 and 1`);
        }
      });
      if (typeof slot.z !== 'undefined' && (typeof slot.z !== 'number' || Number.isNaN(slot.z))) {
        throw new Error(`slot[${idx}].z must be a number when provided`);
      }
      if (
        typeof slot.audio_enabled !== 'undefined' &&
        typeof slot.audio_enabled !== 'boolean'
      ) {
        throw new Error(`slot[${idx}].audio_enabled must be boolean when provided`);
      }
      if (slot.fit && typeof slot.fit !== 'string') {
        throw new Error(`slot[${idx}].fit must be a string when provided`);
      }
    });
  };

  // Create layout
  fastify.post<{ Body: typeof layoutSchema._type }>(
    apiEndpoints.layouts.create,
    {
      schema: {
        description: 'Create a new layout (mosaic)',
        tags: ['Layouts'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const data = layoutSchema.parse(request.body);
        try {
          validateLayoutSpec((data as any).spec);
        } catch (err: any) {
          throw AppError.validation([
            { field: 'spec', message: err?.message || 'Invalid layout spec' },
          ]);
        }
        const authorized = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          if (!ability.can('create', 'Layout')) throw AppError.forbidden('Forbidden');
          const layout = await repo.create({
            ...data,
            created_by: actor.userId,
            ...ownershipForNewContent(actor, ability, 'Layout'),
          }, executor);
          return { layout, actor, ability };
        });
        const ownership = (await resolveContentOwnershipViews([authorized.layout])).get(authorized.layout.id);
        return reply.status(CREATED).send(
          serializeLayout(authorized.layout, ownership, authorized.ability, authorized.actor)
        );
      } catch (error) {
        logger.error(error, 'Create layout error');
        return respondWithError(reply, error);
      }
    }
  );

  // List layouts
  fastify.get<{ Querystring: typeof listLayoutsQuerySchema._type }>(
    apiEndpoints.layouts.list,
    {
      schema: {
        description: 'List layouts',
        tags: ['Layouts'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('read', 'Layout')) throw AppError.forbidden('Forbidden');

        const query = listLayoutsQuerySchema.parse(request.query);
        const actor = actorFor(payload);
        const result = await repo.list({
          page: query.page,
          limit: query.limit,
          aspect_ratio: query.aspect_ratio,
          search: query.search,
          actor,
          ability,
        });
        const ownershipViews = await resolveContentOwnershipViews(result.items);

        return reply.send({
          items: result.items.map((layout: any) =>
            serializeLayout(layout, ownershipViews.get(layout.id), ability, actor)
          ),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List layouts error');
        return respondWithError(reply, error);
      }
    }
  );

  // Get layout by ID
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.layouts.get,
    {
      schema: {
        description: 'Get layout by ID',
        tags: ['Layouts'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('read', 'Layout')) throw AppError.forbidden('Forbidden');

        const layout = await repo.findById((request.params as any).id);
        if (!layout) throw AppError.notFound('Layout not found');
        const actor = actorFor(payload);
        if (!canReadContentResource(actor, layout, ability, 'Layout')) throw AppError.forbidden('Forbidden');
        const ownership = (await resolveContentOwnershipViews([layout])).get(layout.id);
        return reply.send(serializeLayout(layout, ownership, ability, actor));
      } catch (error) {
        logger.error(error, 'Get layout error');
        return respondWithError(reply, error);
      }
    }
  );

  // Update layout
  fastify.patch<{ Params: { id: string }; Body: Partial<typeof layoutSchema._type> }>(
    apiEndpoints.layouts.update,
    {
      schema: {
        description: 'Update layout',
        tags: ['Layouts'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const data = layoutSchema.partial().parse(request.body);
        if (data.spec) {
          try {
            validateLayoutSpec((data as any).spec);
          } catch (err: any) {
            throw AppError.validation([
              { field: 'spec', message: err?.message || 'Invalid layout spec' },
            ]);
          }
        }
        const authorized = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          if (!ability.can('update', 'Layout')) throw AppError.forbidden('Forbidden');
          const existingLayout = await repo.findById((request.params as any).id, executor);
          if (!existingLayout) throw AppError.notFound('Layout not found');
          if (!canManageContentResource(actor, existingLayout, ability, 'Layout', 'update')) {
            throw AppError.forbidden('You cannot edit this layout.');
          }
          const layout = await repo.update((request.params as any).id, data, executor);
          if (!layout) throw AppError.notFound('Layout not found');
          return { layout, actor, ability };
        });
        const ownership = (await resolveContentOwnershipViews([authorized.layout])).get(authorized.layout.id);
        return reply.send(
          serializeLayout(authorized.layout, ownership, authorized.ability, authorized.actor)
        );
      } catch (error) {
        logger.error(error, 'Update layout error');
        return respondWithError(reply, error);
      }
    }
  );

  // Delete layout
  fastify.delete<{ Params: { id: string } }>(
    apiEndpoints.layouts.delete,
    {
      schema: {
        description: 'Delete layout',
        tags: ['Layouts'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          if (!ability.can('delete', 'Layout')) throw AppError.forbidden('Forbidden');
          const layout = await repo.findById((request.params as any).id, executor);
          if (!layout) throw AppError.notFound('Layout not found');
          if (!canManageContentResource(actor, layout, ability, 'Layout', 'delete')) {
            throw AppError.forbidden('You cannot delete this layout.');
          }
          await repo.delete(layout.id, executor);
        });
        return reply.status(204).send();
      } catch (error) {
        logger.error(error, 'Delete layout error');
        return respondWithError(reply, error);
      }
    }
  );
}
