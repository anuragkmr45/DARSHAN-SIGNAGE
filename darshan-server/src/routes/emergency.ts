import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Server as SocketIOServer } from 'socket.io';
import { inArray, sql } from 'drizzle-orm';
import { createEmergencyRepository } from '@/db/repositories/emergency';
import { createEmergencyTypeRepository } from '@/db/repositories/emergency-type';
import { createMediaRepository } from '@/db/repositories/media';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { getDatabase, schema } from '@/db';
import { getPresignedUrl } from '@/s3';
import { AppError } from '@/utils/app-error';
import { defineAbilityFor } from '@/rbac';
import { buildContentDisposition } from '@/utils/object-key';
import { getOrCreateSocketServer } from '@/realtime/socket-server';
import { createHash } from 'node:crypto';
import { queueEmergencyTransitionReconcile } from '@/jobs';
import { emitScreensRefreshRequired } from '@/realtime/screens-namespace';

const logger = createLogger('emergency-routes');
const { CREATED } = HTTP_STATUS;

const triggerEmergencySchema = z.object({
  emergency_type_id: z.string().uuid().optional(),
  message: z.string().min(1).max(1000).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  media_id: z.string().uuid().optional(),
  screen_ids: z.array(z.string().uuid()).max(1000).optional(),
  screen_group_ids: z.array(z.string().uuid()).max(1000).optional(),
  target_all: z.boolean().optional(),
  expires_at: z.string().datetime().optional().nullable(),
  audit_note: z.string().min(1).max(1000).optional(),
});

const clearEmergencySchema = z.object({
  clear_reason: z.string().min(1).max(1000).optional(),
});

const emergencyTypeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  message: z.string().min(1).max(1000),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional().default('HIGH'),
  media_id: z.string().uuid().nullable().optional(),
});

const emergencyTypeUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  message: z.string().min(1).max(1000).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  media_id: z.string().uuid().nullable().optional(),
});

const listEmergencyTypesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export async function emergencyRoutes(fastify: FastifyInstance) {
  const emergencyRepo = createEmergencyRepository();
  const emergencyTypeRepo = createEmergencyTypeRepository();
  const mediaRepo = createMediaRepository();
  const db = getDatabase();
  const io: SocketIOServer = getOrCreateSocketServer(fastify);

  fastify.addHook('onClose', (_, done) => {
    io.close();
    done();
  });

  const requireEmergencyAdmin = async (payload: any, _reply: FastifyReply) => {
    const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
    if (payload.role === 'ADMIN' || payload.role === 'SUPER_ADMIN' || ability.can('manage', 'all')) {
      return true;
    }
    if (!ability.can('update', 'Screen')) {
      throw AppError.forbidden('Forbidden');
    }
    return true;
  };

  const getScopeLabel = (screenIds: string[], groupIds: string[], targetAll: boolean) => {
    if (targetAll || (!screenIds.length && !groupIds.length)) return 'GLOBAL';
    if (groupIds.length > 0 && screenIds.length === 0) return 'GROUP';
    if (screenIds.length > 0 && groupIds.length === 0) return 'SCREEN';
    return 'MIXED';
  };

  const getSeverityRank = (severity: string | null | undefined) => {
    switch ((severity || '').toUpperCase()) {
      case 'CRITICAL':
        return 4;
      case 'HIGH':
        return 3;
      case 'MEDIUM':
        return 2;
      case 'LOW':
        return 1;
      default:
        return 0;
    }
  };

  const getScopeRank = (scope: string) => {
    switch (scope) {
      case 'GLOBAL':
        return 3;
      case 'GROUP':
        return 2;
      case 'SCREEN':
        return 1;
      default:
        return 0;
    }
  };

  const resolveMediaUrl = async (mediaId?: string | null) => {
    if (!mediaId) return null;
    const media = await mediaRepo.findById(mediaId);
    if (!media) return null;
    const filename = (media as any).original_filename ?? media.name ?? 'file';
    const contentDisposition = buildContentDisposition(filename, 'inline');
    try {
      if (media.ready_object_id) {
        const [stor] = await db
          .select()
          .from(schema.storageObjects)
          .where(inArray(schema.storageObjects.id, [media.ready_object_id] as any));
        if (stor) {
          return await getPresignedUrl(stor.bucket, stor.object_key, {
            expiresIn: 3600,
            responseContentDisposition: contentDisposition,
          });
        }
      }
      if (media.source_bucket && media.source_object_key) {
        return await getPresignedUrl(media.source_bucket, media.source_object_key, {
          expiresIn: 3600,
          responseContentDisposition: contentDisposition,
        });
      }
    } catch {
      return null;
    }
    return null;
  };

  const validateTargets = async (screenIds: string[], groupIds: string[]) => {
    if (screenIds.length) {
      const rows = await db.select({ id: schema.screens.id }).from(schema.screens).where(inArray(schema.screens.id, screenIds as any));
      if (rows.length !== screenIds.length) {
        throw AppError.badRequest('One or more screen_ids are invalid');
      }
    }
    if (groupIds.length) {
      const rows = await db
        .select({ id: schema.screenGroups.id })
        .from(schema.screenGroups)
        .where(inArray(schema.screenGroups.id, groupIds as any));
      if (rows.length !== groupIds.length) {
        throw AppError.badRequest('One or more screen_group_ids are invalid');
      }
    }
  };

  const assertMessageEmergencySupported = async (
    screenIds: string[],
    groupIds: string[],
    targetAll: boolean
  ) => {
    const columns = {
      total: sql<number>`count(DISTINCT ${schema.screens.id})`,
      unsupported: sql<number>`count(DISTINCT ${schema.screens.id}) FILTER (
        WHERE NOT (COALESCE(${schema.screens.device_info}->'player_capabilities'->'features', '[]'::jsonb) ? 'message_emergency_v1')
      )`,
    };

    const [counts] = targetAll
      ? await db.select(columns).from(schema.screens)
      : screenIds.length > 0
        ? await db.select(columns).from(schema.screens).where(inArray(schema.screens.id, screenIds as any))
        : await db
            .select(columns)
            .from(schema.screens)
            .innerJoin(schema.screenGroupMembers, sql`${schema.screenGroupMembers.screen_id} = ${schema.screens.id}`)
            .where(inArray(schema.screenGroupMembers.group_id, groupIds as any));

    const unsupported = Number(counts?.unsupported ?? 0);
    if (unsupported > 0) {
      throw new AppError({
        statusCode: 409,
        code: 'MESSAGE_EMERGENCY_UNSUPPORTED',
        message: 'Message-only emergency cannot target players that have not reported message_emergency_v1 support.',
        details: {
          targeted_screen_count: Number(counts?.total ?? 0),
          unsupported_screen_count: unsupported,
          required_capability: 'message_emergency_v1',
        },
      });
    }
  };

  const serializeEmergency = async (emergency: any) => {
    const screenIds = ((emergency as any).screen_ids || []) as string[];
    const groupIds = ((emergency as any).screen_group_ids || []) as string[];
    const targetAll = (emergency as any).target_all === true || (!screenIds.length && !groupIds.length);
    const mediaUrl = await resolveMediaUrl((emergency as any).media_id);

    return {
      id: emergency.id,
      triggered_by: emergency.triggered_by,
      message: emergency.message,
      severity: emergency.priority,
      created_at: emergency.created_at.toISOString?.() ?? emergency.created_at,
      triggered_at: emergency.triggered_at?.toISOString?.() ?? emergency.triggered_at ?? emergency.created_at?.toISOString?.(),
      cleared_at: emergency.cleared_at?.toISOString?.() || null,
      cleared_by: emergency.cleared_by || null,
      expires_at: emergency.expires_at?.toISOString?.() || null,
      clear_reason: emergency.clear_reason ?? null,
      audit_note: emergency.audit_note ?? null,
      emergency_type_id: emergency.emergency_type_id ?? null,
      media_id: emergency.media_id ?? null,
      media_url: mediaUrl,
      screen_ids: screenIds,
      screen_group_ids: groupIds,
      target_all: targetAll,
      kind: emergency.media_id ? 'MEDIA' : 'MESSAGE',
      active:
        emergency.is_active === true &&
        emergency.cleared_at == null &&
        (!emergency.expires_at || new Date(emergency.expires_at).getTime() > Date.now()),
      version: `${emergency.id}:${emergency.transition_version ?? 1}`,
      scope: getScopeLabel(screenIds, groupIds, targetAll),
      is_active:
        emergency.is_active === true &&
        emergency.cleared_at == null &&
        (!emergency.expires_at || new Date(emergency.expires_at).getTime() > Date.now()),
    };
  };

  // Emergency types: create
  fastify.post<{ Body: typeof emergencyTypeSchema._type }>(
    apiEndpoints.emergencyTypes.create,
    {
      schema: {
        description: 'Create an emergency type (admin only)',
        tags: ['Emergency'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        if (!(await requireEmergencyAdmin(payload, reply))) return;

        const data = emergencyTypeSchema.parse(request.body);
        if (data.media_id) {
          const media = await mediaRepo.findById(data.media_id);
          if (!media) throw AppError.badRequest('Media not found');
        }

        const created = await emergencyTypeRepo.create({
          name: data.name,
          description: data.description,
          message: data.message,
          severity: data.severity ?? 'HIGH',
          media_id: data.media_id ?? null,
        });

        return reply.status(CREATED).send({
          id: created.id,
          name: created.name,
          description: created.description,
          message: created.message,
          severity: created.severity,
          media_id: created.media_id,
          created_at: created.created_at.toISOString?.() ?? created.created_at,
          updated_at: created.updated_at.toISOString?.() ?? created.updated_at,
        });
      } catch (error) {
        logger.error(error, 'Create emergency type error');
        return respondWithError(reply, error);
      }
    }
  );

  // Emergency types: list
  fastify.get<{ Querystring: typeof listEmergencyTypesQuerySchema._type }>(
    apiEndpoints.emergencyTypes.list,
    {
      schema: {
        description: 'List emergency types (admin only)',
        tags: ['Emergency'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        if (!(await requireEmergencyAdmin(payload, reply))) return;

        const query = listEmergencyTypesQuerySchema.parse(request.query);
        const result = await emergencyTypeRepo.list({ page: query.page, limit: query.limit });

        return reply.send({
          items: result.items.map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            message: t.message,
            severity: t.severity,
            media_id: t.media_id,
            created_at: t.created_at.toISOString?.() ?? t.created_at,
            updated_at: t.updated_at.toISOString?.() ?? t.updated_at,
          })),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List emergency types error');
        return respondWithError(reply, error);
      }
    }
  );

  // Emergency types: get by id
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.emergencyTypes.get,
    {
      schema: {
        description: 'Get emergency type by ID (admin only)',
        tags: ['Emergency'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        if (!(await requireEmergencyAdmin(payload, reply))) return;

        const type = await emergencyTypeRepo.findById((request.params as any).id);
        if (!type) throw AppError.notFound('Emergency type not found');

        return reply.send({
          id: type.id,
          name: type.name,
          description: type.description,
          message: type.message,
          severity: type.severity,
          media_id: type.media_id,
          created_at: type.created_at.toISOString?.() ?? type.created_at,
          updated_at: type.updated_at.toISOString?.() ?? type.updated_at,
        });
      } catch (error) {
        logger.error(error, 'Get emergency type error');
        return respondWithError(reply, error);
      }
    }
  );

  // Emergency types: update
  fastify.patch<{ Params: { id: string }; Body: typeof emergencyTypeUpdateSchema._type }>(
    apiEndpoints.emergencyTypes.update,
    {
      schema: {
        description: 'Update emergency type (admin only)',
        tags: ['Emergency'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        if (!(await requireEmergencyAdmin(payload, reply))) return;

        const data = emergencyTypeUpdateSchema.parse(request.body);
        if (Object.prototype.hasOwnProperty.call(data, 'media_id') && data.media_id) {
          const media = await mediaRepo.findById(data.media_id);
          if (!media) throw AppError.badRequest('Media not found');
        }

        const updated = await emergencyTypeRepo.update((request.params as any).id, data);
        if (!updated) throw AppError.notFound('Emergency type not found');

        return reply.send({
          id: updated.id,
          name: updated.name,
          description: updated.description,
          message: updated.message,
          severity: updated.severity,
          media_id: updated.media_id,
          created_at: updated.created_at.toISOString?.() ?? updated.created_at,
          updated_at: updated.updated_at.toISOString?.() ?? updated.updated_at,
        });
      } catch (error) {
        logger.error(error, 'Update emergency type error');
        return respondWithError(reply, error);
      }
    }
  );

  // Emergency types: delete
  fastify.delete<{ Params: { id: string } }>(
    apiEndpoints.emergencyTypes.delete,
    {
      schema: {
        description: 'Delete emergency type (admin only)',
        tags: ['Emergency'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        if (!(await requireEmergencyAdmin(payload, reply))) return;

        const existing = await emergencyTypeRepo.findById((request.params as any).id);
        if (!existing) throw AppError.notFound('Emergency type not found');

        await emergencyTypeRepo.delete(existing.id);
        return reply.status(204).send();
      } catch (error) {
        logger.error(error, 'Delete emergency type error');
        return respondWithError(reply, error);
      }
    }
  );

  // Trigger emergency
  fastify.post<{ Body: typeof triggerEmergencySchema._type }>(
    apiEndpoints.emergency.trigger,
    {
      schema: {
        description: 'Trigger emergency alert (admin only)',
        tags: ['Emergency'],
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
        if (!(await requireEmergencyAdmin(payload, reply))) return;

        const rawIdempotencyKey = request.headers['idempotency-key'];
        const idempotencyKey = (Array.isArray(rawIdempotencyKey) ? rawIdempotencyKey[0] : rawIdempotencyKey)?.trim();
        if (!idempotencyKey || idempotencyKey.length > 255) {
          throw AppError.badRequest('Idempotency-Key header is required and must be at most 255 characters');
        }

        const data = triggerEmergencySchema.parse(request.body);
        if (!data.emergency_type_id && !data.message) {
          throw AppError.badRequest('emergency_type_id or message is required');
        }

        const type = data.emergency_type_id
          ? await emergencyTypeRepo.findById(data.emergency_type_id)
          : null;
        if (data.emergency_type_id && !type) {
          throw AppError.notFound('Emergency type not found');
        }

        const message = data.message ?? type?.message;
        if (!message) {
          throw AppError.badRequest('Emergency message is required');
        }
        const severity = data.severity ?? (type?.severity as any) ?? 'HIGH';
        const mediaId = data.media_id ?? type?.media_id ?? null;

        if (mediaId) {
          const media = await mediaRepo.findById(mediaId);
          if (!media) throw AppError.badRequest('Media not found');
        }

        const uniqueScreenIds = Array.from(new Set(data.screen_ids || [])).sort();
        const uniqueGroupIds = Array.from(new Set(data.screen_group_ids || [])).sort();
        const targetAll = data.target_all === true;
        const scopeCount = Number(targetAll) + Number(uniqueScreenIds.length > 0) + Number(uniqueGroupIds.length > 0);
        if (scopeCount !== 1) {
          throw AppError.badRequest('Emergency target scope must be exactly one of target_all, screen_ids, or screen_group_ids');
        }
        if (!targetAll) {
          await validateTargets(uniqueScreenIds, uniqueGroupIds);
        }
        if (!mediaId) {
          await assertMessageEmergencySupported(uniqueScreenIds, uniqueGroupIds, targetAll);
        }

        const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
        if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
          throw AppError.badRequest('expires_at must be a future datetime');
        }

        const requestFingerprint = createHash('sha256').update(JSON.stringify({
          message,
          severity,
          emergency_type_id: type?.id ?? null,
          media_id: mediaId,
          screen_ids: targetAll ? [] : uniqueScreenIds,
          screen_group_ids: targetAll ? [] : uniqueGroupIds,
          target_all: targetAll,
          expires_at: expiresAt?.toISOString() ?? null,
          audit_note: data.audit_note ?? null,
        })).digest('hex');

        const existing = await emergencyRepo.findByUserAndIdempotencyKey(payload.sub, idempotencyKey);
        if (existing) {
          if (existing.request_fingerprint !== requestFingerprint) {
            throw AppError.conflict('Idempotency-Key is already associated with a different emergency');
          }
          reply.header('Idempotent-Replay', 'true');
          return reply.send(await serializeEmergency(existing));
        }

        let emergency;
        try {
          emergency = await emergencyRepo.create({
            triggered_by: payload.sub,
            message,
            severity,
            emergency_type_id: type?.id ?? null,
            media_id: mediaId,
            screen_ids: targetAll ? [] : uniqueScreenIds,
            screen_group_ids: targetAll ? [] : uniqueGroupIds,
            target_all: targetAll,
            expires_at: expiresAt,
            audit_note: data.audit_note ?? null,
            idempotency_key: idempotencyKey,
            request_fingerprint: requestFingerprint,
          });
        } catch (error) {
          if ((error as { code?: string })?.code !== '23505') throw error;
          const concurrent = await emergencyRepo.findByUserAndIdempotencyKey(payload.sub, idempotencyKey);
          if (!concurrent || concurrent.request_fingerprint !== requestFingerprint) {
            throw AppError.conflict('Idempotency-Key is already associated with a different emergency');
          }
          reply.header('Idempotent-Replay', 'true');
          return reply.send(await serializeEmergency(concurrent));
        }
        const serializedEmergency = await serializeEmergency(emergency);
        io.emit('emergency:triggered', serializedEmergency);
        emitScreensRefreshRequired(fastify, {
          reason: 'EMERGENCY',
          screen_ids: uniqueScreenIds,
          group_ids: uniqueGroupIds,
          target_all: targetAll,
          transition_version: `${emergency.id}:${emergency.transition_version ?? 1}`,
        });
        void queueEmergencyTransitionReconcile({}).catch((error) => {
          logger.warn({ err: error, emergencyId: emergency.id }, 'Emergency transition wake-up failed; durable reconciliation remains pending');
        });
        logger.warn(
          {
            emergencyId: emergency.id,
            severity: emergency.priority,
            message: emergency.message,
          },
          'Emergency triggered'
        );

        await db.insert(schema.auditLogs).values({
          user_id: payload.sub,
          action: 'EMERGENCY_TRIGGER',
          entity_type: 'EMERGENCY',
          entity_id: emergency.id,
          ip_address: request.ip,
        });

        return reply.status(CREATED).send(serializedEmergency);
      } catch (error) {
        logger.error(error, 'Trigger emergency error');
        return respondWithError(reply, error);
      }
    }
  );

  // Get emergency status
  fastify.get(
    apiEndpoints.emergency.status,
    {
      schema: {
        description: 'Get current emergency status (admin only)',
        tags: ['Emergency'],
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
        if (!(await requireEmergencyAdmin(payload, reply))) return;

        const activeEmergencies = await emergencyRepo.listActive();

        if (activeEmergencies.length === 0) {
          return reply.send({
            active: false,
            emergency: null,
            active_count: 0,
            active_emergencies: [],
          });
        }

        const serialized = await Promise.all(activeEmergencies.map((emergency) => serializeEmergency(emergency)));
        serialized.sort((left, right) => {
          const severityDelta = getSeverityRank(right.severity) - getSeverityRank(left.severity);
          if (severityDelta !== 0) return severityDelta;
          const scopeDelta = getScopeRank(right.scope) - getScopeRank(left.scope);
          if (scopeDelta !== 0) return scopeDelta;
          const createdDelta = Date.parse(right.created_at) - Date.parse(left.created_at);
          return createdDelta || right.id.localeCompare(left.id);
        });

        return reply.send({
          active: true,
          active_count: serialized.length,
          emergency: serialized[0],
          active_emergencies: serialized,
        });
      } catch (error) {
        logger.error(error, 'Get emergency status error');
        return respondWithError(reply, error);
      }
    }
  );

  // Clear emergency
  fastify.post<{ Params: { id: string }; Body: typeof clearEmergencySchema._type }>(
    apiEndpoints.emergency.clear,
    {
      schema: {
        description: 'Clear emergency alert (admin only)',
        tags: ['Emergency'],
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
        if (!(await requireEmergencyAdmin(payload, reply))) return;

        const clearPayload = clearEmergencySchema.parse(request.body || {});
        const clearResult = await emergencyRepo.clear((request.params as any).id, payload.sub, clearPayload.clear_reason ?? null);

        if (!clearResult) {
          throw AppError.notFound('Emergency not found');
        }
        const { emergency, transitioned } = clearResult;
        if (!transitioned) {
          reply.header('Idempotent-Replay', 'true');
          return reply.send(await serializeEmergency(emergency));
        }
        const serializedEmergency = await serializeEmergency(emergency);
        io.emit('emergency:cleared', serializedEmergency);
        emitScreensRefreshRequired(fastify, {
          reason: 'EMERGENCY',
          screen_ids: emergency.screen_ids ?? [],
          group_ids: emergency.screen_group_ids ?? [],
          target_all: emergency.target_all === true,
          transition_version: `${emergency.id}:${emergency.transition_version ?? 1}`,
        });
        void queueEmergencyTransitionReconcile({}).catch((error) => {
          logger.warn({ err: error, emergencyId: emergency.id }, 'Emergency clear wake-up failed; durable reconciliation remains pending');
        });
        logger.info(
          {
            emergencyId: emergency.id,
            clearedBy: payload.sub,
          },
          'Emergency cleared'
        );

        await db.insert(schema.auditLogs).values({
          user_id: payload.sub,
          action: 'EMERGENCY_CLEAR',
          entity_type: 'EMERGENCY',
          entity_id: emergency.id,
          ip_address: request.ip,
        });

        return reply.send(serializedEmergency);
      } catch (error) {
        logger.error(error, 'Clear emergency error');
        return respondWithError(reply, error);
      }
    }
  );

  // List emergency history
  fastify.get<{ Querystring: { page?: number; limit?: number } }>(
    apiEndpoints.emergency.history,
    {
      schema: {
        description: 'List emergency history (admin only)',
        tags: ['Emergency'],
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
        if (!(await requireEmergencyAdmin(payload, reply))) return;

        const page = (request.query as any).page ? parseInt((request.query as any).page as string) : 1;
        const limit = (request.query as any).limit ? parseInt((request.query as any).limit as string) : 20;

        const result = await emergencyRepo.list({ page, limit });

        return reply.send({
          items: await Promise.all(result.items.map((e) => serializeEmergency(e))),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List emergency history error');
        return respondWithError(reply, error);
      }
    }
  );
}
