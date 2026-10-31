import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'crypto';
import { z } from 'zod';
import { eq, inArray, sql } from 'drizzle-orm';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { canUnconditionally, defineAbilityFor } from '@/rbac';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { createLogger, getRecentLogs, setRuntimeLogLevel } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import {
  DEFAULT_MEDIA_SETTING_KEY,
  DEFAULT_MEDIA_TARGETS_SETTING_KEY,
  DEFAULT_MEDIA_VARIANTS_SETTING_KEY,
  canonicalizeDefaultMediaTargets,
  extractDefaultMediaTargets,
  getDefaultMedia,
  getDefaultMediaTargetAssignments,
  getDefaultMediaVariants,
} from '@/utils/default-media';
import { AppError } from '@/utils/app-error';
import { serializeMediaRecord } from '@/utils/media';
import { resolveMediaAccess } from '@/utils/media-access';
import { dispatchPlaybackRefresh } from '@/services/playback-refresh-dispatch';
import {
  APPEARANCE_SETTINGS_KEY,
  BACKUPS_SETTINGS_KEY,
  BRANDING_SETTINGS_KEY,
  GENERAL_SETTINGS_KEY,
  SECURITY_SETTINGS_KEY,
  appearanceSettingsSchema,
  backupsSettingsSchema,
  brandingSettingsSchema,
  generalSettingsSchema,
  getSettingsSection,
  resolveBrandingMediaMap,
  saveSettingsSection,
  securitySettingsSchema,
  type AppearanceSettings,
  type BackupsSettings,
  type BrandingSettings,
  type GeneralSettings,
  type SecuritySettings,
} from '@/utils/settings';
import { requestCoordinatedBackup, queueManualBackupDeletion } from '@/jobs';
import { resolveAspectRatio } from '@/utils/aspect-ratio';
import { config as appConfig } from '@/config';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import {
  admitManualBackupDeletion,
  getBackupDetail,
  getBackupOperation,
  listBackupHistory,
} from '@/backups/api-service';
import { openEncryptedBackupArtifact } from '@/backups/encrypted-download';
import { createAuditLogRepository } from '@/db/repositories/audit-log';

const logger = createLogger('settings-routes');
const { CREATED, OK } = HTTP_STATUS;

function serializeBackupSettings(settings: BackupsSettings) {
  const productionManaged = appConfig.NODE_ENV === 'production';
  return {
    ...settings,
    schedule_managed_by_deployment: productionManaged,
    off_host_copy_required: productionManaged,
    retention_days: productionManaged ? appConfig.BACKUP_RETENTION_DAYS : null,
  };
}

const upsertSettingSchema = z.object({
  key: z.string().min(1),
  value: z.any(),
});

const defaultMediaUpdateSchema = z.object({
  media_id: z.string().uuid().nullable(),
});

const defaultMediaVariantsUpdateSchema = z.object({
  variants: z.record(z.string().uuid().nullable()),
});

const defaultMediaTargetAssignmentSchema = z.object({
  target_type: z.enum(['SCREEN', 'GROUP']),
  target_id: z.string().uuid(),
  media_id: z.string().uuid(),
  aspect_ratio: z.string().min(1),
  priority: z.number().int().min(0).max(100).optional(),
});

const defaultMediaTargetsUpdateSchema = z.object({
  assignments: z.array(defaultMediaTargetAssignmentSchema),
  expected_revision: z.string().length(64).nullable().optional(),
});

const defaultMediaTargetsRevision = (assignments: ReturnType<typeof extractDefaultMediaTargets>) => {
  const canonical = canonicalizeDefaultMediaTargets(assignments.map((assignment) => ({
    target_type: assignment.target_type,
    target_id: assignment.target_id,
    media_id: assignment.media_id,
    aspect_ratio: assignment.aspect_ratio,
    priority: assignment.priority,
  })));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

const logsQuerySchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const backupIdSchema = z.object({ id: z.string().uuid() });
const backupOperationParamsSchema = z.object({ operationId: z.string().uuid() });
const backupHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(2_000).optional(),
});
const backupDownloadQuerySchema = z.object({ artifact: z.enum(['DATABASE', 'OBJECTS', 'CONFIGURATION']) });
const idempotencyKeySchema = z.string().trim().min(1).max(200);

async function getSettingsActor(request: FastifyRequest) {
  const token = extractTokenFromHeader(request.headers.authorization);
  if (!token) throw AppError.unauthorized('Missing authorization header');
  const payload = await verifyAccessToken(token);
  const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
  return { payload, ability };
}

async function requireAccess(
  request: FastifyRequest,
  action: 'read' | 'update',
  subject: 'OrgSettings' | 'BrandingSettings'
) {
  const { payload, ability } = await getSettingsActor(request);
  // These settings endpoints operate on a singleton or entire collection;
  // there is no resource record on which a conditional grant can be checked.
  if (!canUnconditionally(ability, action, subject)) {
    throw AppError.forbidden('Forbidden');
  }
  return payload;
}

async function requireBackupAccess(request: FastifyRequest, action: 'read' | 'create' | 'delete' | 'download') {
  const { payload, ability } = await getSettingsActor(request);
  if (!canUnconditionally(ability, action, 'Backup')) throw AppError.forbidden('Forbidden');
  return { payload, ability };
}

async function ensureMediaIdsExist(ids: Array<string | null | undefined>) {
  const requestedIds = Array.from(new Set(ids.filter((value): value is string => Boolean(value))));
  if (requestedIds.length === 0) return;

  const db = getDatabase();
  const rows = await db.select({ id: schema.media.id }).from(schema.media).where(inArray(schema.media.id, requestedIds as string[]));
  if (rows.length !== requestedIds.length) {
    throw AppError.notFound('Media not found');
  }
}

function assertDefaultMediaReady(media: { id: string; status?: string | null }) {
  if (media.status !== 'READY') {
    throw AppError.badRequest('Default media must be READY before it can be assigned.', {
      reason: 'MEDIA_NOT_READY',
      media_ids: [media.id],
    });
  }
}

async function ensureReadyDefaultMediaIds(
  ids: Array<string | null | undefined>,
  executor: DbExecutor = getDatabase()
) {
  const requestedIds = Array.from(new Set(ids.filter((value): value is string => Boolean(value))));
  if (requestedIds.length === 0) return;

  const rows = await executor
    .select({ id: schema.media.id, status: schema.media.status })
    .from(schema.media)
    .where(inArray(schema.media.id, requestedIds as string[]));
  if (rows.length !== requestedIds.length) {
    throw AppError.notFound('Media not found');
  }

  const nonReadyIds = rows.filter((media) => media.status !== 'READY').map((media) => media.id).sort();
  if (nonReadyIds.length > 0) {
    throw AppError.badRequest('Default media must be READY before it can be assigned.', {
      reason: 'MEDIA_NOT_READY',
      media_ids: nonReadyIds,
    });
  }
}

async function serializeBranding(settings: BrandingSettings) {
  const mediaMap = await resolveBrandingMediaMap([
    settings.logo_media_id,
    settings.icon_media_id,
    settings.favicon_media_id,
  ]);

  return {
    ...settings,
    logo_url: settings.logo_media_id ? (mediaMap.get(settings.logo_media_id)?.url ?? null) : null,
    icon_url: settings.icon_media_id ? (mediaMap.get(settings.icon_media_id)?.url ?? null) : null,
    favicon_url: settings.favicon_media_id ? (mediaMap.get(settings.favicon_media_id)?.url ?? null) : null,
  };
}

async function validateDefaultMediaTargets(
  assignments: Array<z.infer<typeof defaultMediaTargetAssignmentSchema>>,
  executor: DbExecutor = getDatabase()
) {
  if (assignments.length === 0) return;

  await ensureReadyDefaultMediaIds(assignments.map((assignment) => assignment.media_id), executor);

  const screenAssignments = assignments.filter((assignment) => assignment.target_type === 'SCREEN');
  const groupAssignments = assignments.filter((assignment) => assignment.target_type === 'GROUP');

  if (screenAssignments.length > 0) {
    const screenIds = screenAssignments.map((assignment) => assignment.target_id);
    const screens = await executor
      .select({
        id: schema.screens.id,
        aspect_ratio: schema.screens.aspect_ratio,
        width: schema.screens.width,
        height: schema.screens.height,
      })
      .from(schema.screens)
      .where(inArray(schema.screens.id, screenIds as string[]));

    if (screens.length !== screenIds.length) {
      throw AppError.notFound('Screen not found');
    }

    const screensById = new Map(screens.map((screen) => [screen.id, screen]));
    for (const assignment of screenAssignments) {
      const screen = screensById.get(assignment.target_id);
      const aspectRatio = screen ? resolveAspectRatio(screen) : null;
      if (!aspectRatio || aspectRatio !== assignment.aspect_ratio) {
        throw AppError.badRequest('Screen default media assignment aspect ratio does not match the target screen.');
      }
    }
  }

  if (groupAssignments.length > 0) {
    const groupIds = groupAssignments.map((assignment) => assignment.target_id);
    const groups = await executor
      .select({ id: schema.screenGroups.id })
      .from(schema.screenGroups)
      .where(inArray(schema.screenGroups.id, groupIds as string[]));

    if (groups.length !== groupIds.length) {
      throw AppError.notFound('Screen group not found');
    }

    const members = await executor
      .select({
        group_id: schema.screenGroupMembers.group_id,
        screen_id: schema.screenGroupMembers.screen_id,
        aspect_ratio: schema.screens.aspect_ratio,
        width: schema.screens.width,
        height: schema.screens.height,
      })
      .from(schema.screenGroupMembers)
      .innerJoin(schema.screens, eq(schema.screenGroupMembers.screen_id, schema.screens.id))
      .where(inArray(schema.screenGroupMembers.group_id, groupIds as string[]));

    const membersByGroup = new Map<string, typeof members>();
    for (const member of members) {
      const existing = membersByGroup.get(member.group_id) ?? [];
      existing.push(member);
      membersByGroup.set(member.group_id, existing);
    }

    for (const assignment of groupAssignments) {
      const groupMembers = membersByGroup.get(assignment.target_id) ?? [];
      if (groupMembers.length === 0) {
        throw AppError.badRequest('Screen group must contain at least one screen.');
      }

      const aspectRatios = Array.from(
        new Set(
          groupMembers
            .map((member) =>
              resolveAspectRatio({
                aspect_ratio: member.aspect_ratio,
                width: member.width,
                height: member.height,
              })
            )
            .filter((value): value is string => Boolean(value))
        )
      );

      if (aspectRatios.length !== 1) {
        throw AppError.badRequest('Screen group must contain screens with the same aspect ratio.');
      }

      if (aspectRatios[0] !== assignment.aspect_ratio) {
        throw AppError.badRequest('Group default media assignment aspect ratio does not match the target screens.');
      }
    }
  }
}

export async function settingsRoutes(fastify: FastifyInstance) {
  const db = getDatabase();

  const serializeMedia = async (media: any) => {
    const mediaAccess = await resolveMediaAccess(media, db);
    return serializeMediaRecord(media, mediaAccess.media_url, {
      content_type: mediaAccess.content_type,
      source_content_type: mediaAccess.source_content_type,
      size: mediaAccess.size,
      ready_object_id: mediaAccess.ready_object_id,
      ready_object_sha256: mediaAccess.ready_object_sha256,
      ready_object_created_at: mediaAccess.ready_object_created_at,
    });
  };

  const serializeDefaultMediaVariants = async () => {
    const data = await getDefaultMediaVariants(db);
    return {
      global_media_id: data.global_media_id,
      global_media: data.global_media ? await serializeMedia(data.global_media) : null,
      variants: await Promise.all(
        data.variants.map(async (variant) => ({
          aspect_ratio: variant.aspect_ratio,
          media_id: variant.media_id,
          media: variant.media ? await serializeMedia(variant.media) : null,
        }))
      ),
    };
  };

  const serializeDefaultMediaTargets = async () => {
    const data = await getDefaultMediaTargetAssignments(db);
    return {
      revision: defaultMediaTargetsRevision(data.map((assignment) => ({
        target_type: assignment.target_type,
        target_id: assignment.target_id,
        media_id: assignment.media_id,
        aspect_ratio: assignment.aspect_ratio,
        priority: assignment.priority,
      }))),
      assignments: await Promise.all(
        data.map(async (assignment) => ({
          target_type: assignment.target_type,
          target_id: assignment.target_id,
          aspect_ratio: assignment.aspect_ratio,
          media_id: assignment.media_id,
          priority: assignment.priority,
          media: assignment.media ? await serializeMedia(assignment.media) : null,
        }))
      ),
    };
  };

  fastify.get(
    apiEndpoints.settings.list,
    {
      schema: {
        description: 'List org settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { ability } = await getSettingsActor(request);
        if (!canUnconditionally(ability, 'read', 'OrgSettings')) throw AppError.forbidden('Forbidden');
        const canReadBranding = canUnconditionally(ability, 'read', 'BrandingSettings');
        const canReadBackups = canUnconditionally(ability, 'read', 'Backup');
        const items = (await db.select().from(schema.settings))
          .filter((item) => item.key !== BRANDING_SETTINGS_KEY || canReadBranding)
          .filter((item) => item.key !== BACKUPS_SETTINGS_KEY || canReadBackups);
        return reply.send({ items });
      } catch (error) {
        logger.error(error, 'List settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Body: typeof upsertSettingSchema._type }>(
    apiEndpoints.settings.upsert,
    {
      schema: {
        description: 'Upsert org setting',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { ability } = await getSettingsActor(request);
        const data = upsertSettingSchema.parse(request.body);
        if (data.key === BACKUPS_SETTINGS_KEY) {
          throw AppError.badRequest('Backup settings must be updated through the dedicated backup settings endpoint.');
        }
        const subject = data.key === BRANDING_SETTINGS_KEY ? 'BrandingSettings' : 'OrgSettings';
        if (!canUnconditionally(ability, 'update', subject)) throw AppError.forbidden('Forbidden');

        const knownSections = {
          [GENERAL_SETTINGS_KEY]: generalSettingsSchema,
          [BRANDING_SETTINGS_KEY]: brandingSettingsSchema,
          [SECURITY_SETTINGS_KEY]: securitySettingsSchema,
          [APPEARANCE_SETTINGS_KEY]: appearanceSettingsSchema,
        } as const;

        let value = data.value;
        if (data.key === BRANDING_SETTINGS_KEY) {
          value = brandingSettingsSchema.parse(data.value);
          await ensureMediaIdsExist([value.logo_media_id, value.icon_media_id, value.favicon_media_id]);
        } else if (data.key in knownSections) {
          value = (knownSections as any)[data.key].parse(data.value);
        }

        const [record] = await db
          .insert(schema.settings)
          .values({ key: data.key, value })
          .onConflictDoUpdate({
            target: schema.settings.key,
            set: { value, updated_at: new Date() },
          })
          .returning();

        return reply.status(OK).send(record);
      } catch (error) {
        logger.error(error, 'Upsert setting error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(
    apiEndpoints.settings.general,
    {
      schema: {
        description: 'Get general organization settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'read', 'OrgSettings');
        return reply.send(await getSettingsSection(GENERAL_SETTINGS_KEY));
      } catch (error) {
        logger.error(error, 'Get general settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.put<{ Body: GeneralSettings }>(
    apiEndpoints.settings.general,
    {
      schema: {
        description: 'Update general organization settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'update', 'OrgSettings');
        const data = generalSettingsSchema.parse(request.body);
        return reply.status(OK).send(await saveSettingsSection(GENERAL_SETTINGS_KEY, data));
      } catch (error) {
        logger.error(error, 'Update general settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(
    apiEndpoints.settings.branding,
    {
      schema: {
        description: 'Get branding settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'read', 'BrandingSettings');
        return reply.send(await serializeBranding(await getSettingsSection(BRANDING_SETTINGS_KEY)));
      } catch (error) {
        logger.error(error, 'Get branding settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.put<{ Body: BrandingSettings }>(
    apiEndpoints.settings.branding,
    {
      schema: {
        description: 'Update branding settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'update', 'BrandingSettings');
        const data = brandingSettingsSchema.parse(request.body);
        await ensureMediaIdsExist([data.logo_media_id, data.icon_media_id, data.favicon_media_id]);
        const saved = await saveSettingsSection(BRANDING_SETTINGS_KEY, data);
        return reply.status(OK).send(await serializeBranding(saved));
      } catch (error) {
        logger.error(error, 'Update branding settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(
    apiEndpoints.settings.security,
    {
      schema: {
        description: 'Get security settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'read', 'OrgSettings');
        return reply.send(await getSettingsSection(SECURITY_SETTINGS_KEY));
      } catch (error) {
        logger.error(error, 'Get security settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.put<{ Body: SecuritySettings }>(
    apiEndpoints.settings.security,
    {
      schema: {
        description: 'Update security settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'update', 'OrgSettings');
        const data = securitySettingsSchema.parse(request.body);
        return reply.status(OK).send(await saveSettingsSection(SECURITY_SETTINGS_KEY, data));
      } catch (error) {
        logger.error(error, 'Update security settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(
    apiEndpoints.settings.appearance,
    {
      schema: {
        description: 'Get appearance settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'read', 'OrgSettings');
        return reply.send(await getSettingsSection(APPEARANCE_SETTINGS_KEY));
      } catch (error) {
        logger.error(error, 'Get appearance settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.put<{ Body: AppearanceSettings }>(
    apiEndpoints.settings.appearance,
    {
      schema: {
        description: 'Update appearance settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'update', 'OrgSettings');
        const data = appearanceSettingsSchema.parse(request.body);
        return reply.status(OK).send(await saveSettingsSection(APPEARANCE_SETTINGS_KEY, data));
      } catch (error) {
        logger.error(error, 'Update appearance settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(
    apiEndpoints.settings.backups,
    {
      schema: {
        description: 'Get backups settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireBackupAccess(request, 'read');
        return reply.send(serializeBackupSettings(await getSettingsSection(BACKUPS_SETTINGS_KEY)));
      } catch (error) {
        logger.error(error, 'Get backups settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.put<{ Body: BackupsSettings }>(
    apiEndpoints.settings.backups,
    {
      schema: {
        description: 'Update backups settings',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const data = backupsSettingsSchema.parse(request.body);
        const saved = await withCurrentMutationAuthorization(payload, async ({ ability }) => {
          if (!canUnconditionally(ability, 'update', 'OrgSettings')) throw AppError.forbidden('Forbidden');
          return saveSettingsSection(BACKUPS_SETTINGS_KEY, data);
        });
        setRuntimeLogLevel(saved.log_level);
        return reply.status(OK).send(serializeBackupSettings(saved));
      } catch (error) {
        logger.error(error, 'Update backups settings error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post(
    apiEndpoints.settings.backupRun,
    {
      schema: {
        description: 'Queue a manual backup run',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const { run, coalesced } = await withCurrentMutationAuthorization(payload, async ({ ability, actor }) => {
          if (!canUnconditionally(ability, 'create', 'Backup')) throw AppError.forbidden('Forbidden');
          return requestCoordinatedBackup({ triggerType: 'MANUAL', triggeredBy: actor.userId });
        });
        return reply.status(coalesced ? OK : CREATED).send({
          id: run.id,
          status: run.status,
          trigger_type: run.trigger_type,
          coalesced,
        });
      } catch (error) {
        logger.error(error, 'Run backup error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.delete<{ Params: { id: string }; Headers: { 'idempotency-key'?: string } }>(
    apiEndpoints.settings.backupById,
    {
      schema: {
        description: 'Admit durable asynchronous deletion of eligible backup artifacts',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Headers: { 'idempotency-key'?: string } }>, reply: FastifyReply) => {
      try {
        const { id } = backupIdSchema.parse(request.params);
        const idempotencyKey = request.headers['idempotency-key']
          ? idempotencyKeySchema.parse(request.headers['idempotency-key']) : undefined;
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const result = await withCurrentMutationAuthorization(payload, async ({ ability, actor, executor }) => {
          if (!canUnconditionally(ability, 'delete', 'Backup')) throw AppError.forbidden('Forbidden');
          return admitManualBackupDeletion({ executor, backupRunId: id, requesterId: actor.userId, idempotencyKey });
        });
        if (result.disposition === 'DELETED') return reply.status(OK).send(result);
        try {
          await queueManualBackupDeletion(id);
        } catch (deliveryError) {
          logger.error({ deliveryError, backupRunId: id, operationId: result.operation_id },
            'Manual backup deletion was admitted but immediate worker delivery failed');
        }
        const location = apiEndpoints.settings.backupOperation.replace(':operationId', result.operation_id);
        return reply.header('Location', location).header('Retry-After', '5').status(HTTP_STATUS.ACCEPTED).send(result);
      } catch (error) {
        logger.error(error, 'Delete backup run error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Querystring: z.infer<typeof backupHistoryQuerySchema> }>(
    apiEndpoints.settings.backupHistory,
    {
      schema: {
        description: 'List recent backup runs',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest<{ Querystring: z.infer<typeof backupHistoryQuerySchema> }>, reply: FastifyReply) => {
      try {
        const { ability } = await requireBackupAccess(request, 'read');
        const query = backupHistoryQuerySchema.parse(request.query);
        return reply.send(await listBackupHistory({
          executor: db,
          limit: query.limit,
          cursor: query.cursor,
          canDelete: canUnconditionally(ability, 'delete', 'Backup'),
          canDownload: canUnconditionally(ability, 'download', 'Backup'),
        }));
      } catch (error) {
        logger.error(error, 'List backup history error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string }; Querystring: z.infer<typeof backupDownloadQuerySchema>;
    Headers: { range?: string } }>(
    apiEndpoints.settings.backupById,
    {
      schema: { description: 'Get a safe backup history record', tags: ['Settings'], security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      try {
        const { id } = backupIdSchema.parse(request.params);
        const { ability } = await requireBackupAccess(request, 'read');
        return reply.send(await getBackupDetail({ executor: db, backupRunId: id,
          canDelete: canUnconditionally(ability, 'delete', 'Backup'),
          canDownload: canUnconditionally(ability, 'download', 'Backup') }));
      } catch (error) {
        logger.error(error, 'Get backup detail error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { operationId: string } }>(
    apiEndpoints.settings.backupOperation,
    {
      schema: { description: 'Get a backup deletion operation', tags: ['Settings'], security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      try {
        const { operationId } = backupOperationParamsSchema.parse(request.params);
        await requireBackupAccess(request, 'read');
        return reply.send(await getBackupOperation(db, operationId));
      } catch (error) {
        logger.error(error, 'Get backup operation error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.settings.backupDownload,
    {
      schema: { description: 'Download one trusted encrypted backup artifact', tags: ['Settings'], security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      try {
        const { id } = backupIdSchema.parse(request.params);
        const { artifact } = backupDownloadQuerySchema.parse(request.query);
        if (request.headers.range) {
          throw new AppError({ statusCode: 416, code: 'BACKUP_DOWNLOAD_RANGE_NOT_SUPPORTED',
            message: 'Encrypted backup downloads require a complete trusted stream.' });
        }
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const detail = await withCurrentMutationAuthorization(payload, async ({ ability, executor }) => {
          if (!canUnconditionally(ability, 'download', 'Backup')) throw AppError.forbidden('Forbidden');
          return getBackupDetail({ executor, backupRunId: id, canDelete: false, canDownload: true });
        });
        if (!detail.permissions.can_download || !detail.verification.manifest_sha256) {
          throw new AppError({ statusCode: 409,
            code: detail.permissions.download_unavailable_code ?? 'BACKUP_DOWNLOAD_SOURCE_NOT_VERIFIED',
            message: 'This backup does not have a trusted encrypted download source.' });
        }
        const controller = new AbortController();
        request.raw.once('aborted', () => controller.abort(new Error('client aborted')));
        const download = await openEncryptedBackupArtifact({ runId: id,
          manifestSha256: detail.verification.manifest_sha256, artifactKind: artifact, signal: controller.signal });
        try {
          const freshPayload = await verifyAccessToken(token);
          await withCurrentMutationAuthorization(freshPayload, async ({ ability }) => {
            if (!canUnconditionally(ability, 'download', 'Backup')) throw AppError.forbidden('Forbidden');
          });
          await createAuditLogRepository().create({ user_id: freshPayload.sub,
            action: 'BACKUP_ENCRYPTED_ARTIFACT_DOWNLOAD', resource_type: 'Backup', resource_id: id,
            changes: { artifact_kind: artifact, ciphertext_sha256: download.sha256,
              ciphertext_size_bytes: download.contentLength, manifest_sha256: download.manifestSha256 } });
        } catch (error) {
          download.stream.destroy();
          throw error;
        }
        return reply
          .header('Content-Type', 'application/octet-stream')
          .header('Content-Length', download.contentLength)
          .header('Content-Disposition', `attachment; filename="${download.filename}"`)
          .header('Cache-Control', 'no-store')
          .header('X-Content-Type-Options', 'nosniff')
          .header('Accept-Ranges', 'none')
          .send(download.stream);
      } catch (error) {
        logger.error(error, 'Download backup error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Querystring: typeof logsQuerySchema._type }>(
    apiEndpoints.settings.logs,
    {
      schema: {
        description: 'List recent application logs',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'read', 'OrgSettings');
        const query = logsQuerySchema.parse(request.query);
        return reply.send({ items: getRecentLogs(query) });
      } catch (error) {
        logger.error(error, 'List recent logs error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(
    apiEndpoints.settings.defaultMedia,
    {
      schema: {
        description: 'Get default media setting',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'read', 'OrgSettings');
        const defaultMedia = await getDefaultMedia(db);
        if (!defaultMedia || !defaultMedia.media) {
          return reply.send({
            media_id: defaultMedia?.media_id ?? null,
            media: null,
          });
        }

        return reply.send({
          media_id: defaultMedia.media_id,
          media: await serializeMedia(defaultMedia.media),
        });
      } catch (error) {
        logger.error(error, 'Get default media setting error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.put<{ Body: typeof defaultMediaUpdateSchema._type }>(
    apiEndpoints.settings.defaultMedia,
    {
      schema: {
        description: 'Update default media setting',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = await requireAccess(request, 'update', 'OrgSettings');
        const data = defaultMediaUpdateSchema.parse(request.body);
        if (data.media_id === null) {
          await db.delete(schema.settings).where(eq(schema.settings.key, DEFAULT_MEDIA_SETTING_KEY));
          await dispatchPlaybackRefresh(fastify, {
            reason: 'DEFAULT_MEDIA',
            targetAll: true,
            createdBy: payload.sub,
          });
          return reply.status(OK).send({ media_id: null, media: null });
        }

        const [media] = await db.select().from(schema.media).where(eq(schema.media.id, data.media_id));
        if (!media) {
          throw AppError.notFound('Media not found');
        }
        assertDefaultMediaReady(media);

        await db
          .insert(schema.settings)
          .values({ key: DEFAULT_MEDIA_SETTING_KEY, value: data.media_id })
          .onConflictDoUpdate({
            target: schema.settings.key,
            set: { value: data.media_id, updated_at: new Date() },
          });

        await dispatchPlaybackRefresh(fastify, {
          reason: 'DEFAULT_MEDIA',
          targetAll: true,
          createdBy: payload.sub,
        });

        return reply.status(OK).send({
          media_id: media.id,
          media: await serializeMedia(media),
        });
      } catch (error) {
        logger.error(error, 'Update default media setting error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(
    apiEndpoints.settings.defaultMediaVariants,
    {
      schema: {
        description: 'Get default media variants by aspect ratio',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'read', 'OrgSettings');
        return reply.send(await serializeDefaultMediaVariants());
      } catch (error) {
        logger.error(error, 'Get default media variants error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.put<{ Body: typeof defaultMediaVariantsUpdateSchema._type }>(
    apiEndpoints.settings.defaultMediaVariants,
    {
      schema: {
        description: 'Update default media variants by aspect ratio',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = await requireAccess(request, 'update', 'OrgSettings');
        const data = defaultMediaVariantsUpdateSchema.parse(request.body);
        const requestedIds = Array.from(
          new Set(Object.values(data.variants).filter((value): value is string => typeof value === 'string' && value.length > 0))
        );

        await ensureReadyDefaultMediaIds(requestedIds);

        const normalized = Object.entries(data.variants).reduce<Record<string, string>>((acc, [aspectRatio, mediaId]) => {
          if (mediaId) {
            acc[aspectRatio.trim()] = mediaId;
          }
          return acc;
        }, {});

        if (Object.keys(normalized).length === 0) {
          await db.delete(schema.settings).where(eq(schema.settings.key, DEFAULT_MEDIA_VARIANTS_SETTING_KEY));
        } else {
          await db
            .insert(schema.settings)
            .values({ key: DEFAULT_MEDIA_VARIANTS_SETTING_KEY, value: normalized })
            .onConflictDoUpdate({
              target: schema.settings.key,
              set: { value: normalized, updated_at: new Date() },
            });
        }

        await dispatchPlaybackRefresh(fastify, {
          reason: 'DEFAULT_MEDIA',
          targetAll: true,
          createdBy: payload.sub,
        });

        return reply.status(OK).send(await serializeDefaultMediaVariants());
      } catch (error) {
        logger.error(error, 'Update default media variants error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(
    apiEndpoints.settings.defaultMediaTargets,
    {
      schema: {
        description: 'Get target-based default media assignments',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await requireAccess(request, 'read', 'OrgSettings');
        return reply.send(await serializeDefaultMediaTargets());
      } catch (error) {
        logger.error(error, 'Get default media targets error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.put<{ Body: typeof defaultMediaTargetsUpdateSchema._type }>(
    apiEndpoints.settings.defaultMediaTargets,
    {
      schema: {
        description: 'Update target-based default media assignments',
        tags: ['Settings'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = await requireAccess(request, 'update', 'OrgSettings');
        const data = defaultMediaTargetsUpdateSchema.parse(request.body);
        const keys = data.assignments.map((assignment) => `${assignment.target_type}:${assignment.target_id}`);
        if (new Set(keys).size !== keys.length) {
          throw AppError.badRequest('Default media targets must not contain duplicate screen or group assignments.');
        }

        const savedAssignments = await db.transaction(async (tx) => {
          // The settings row does not exist before the first save, so a row lock
          // cannot serialize every writer. This transaction-scoped advisory lock
          // gives first-save and later-save operations the same concurrency rule.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${DEFAULT_MEDIA_TARGETS_SETTING_KEY}))`);

          const [currentSetting] = await tx
            .select()
            .from(schema.settings)
            .where(eq(schema.settings.key, DEFAULT_MEDIA_TARGETS_SETTING_KEY));
          const currentAssignments = extractDefaultMediaTargets(currentSetting?.value);
          const priorityByTarget = new Map(
            currentAssignments.map((assignment) => [`${assignment.target_type}:${assignment.target_id}`, assignment.priority])
          );
          const normalizedAssignments = canonicalizeDefaultMediaTargets(data.assignments.map((assignment) => ({
            ...assignment,
            aspect_ratio: assignment.aspect_ratio.trim(),
            priority: assignment.target_type === 'GROUP'
              ? assignment.priority ?? priorityByTarget.get(`${assignment.target_type}:${assignment.target_id}`) ?? 0
              : 0,
          })));

          if (data.expected_revision !== undefined
            && data.expected_revision !== defaultMediaTargetsRevision(currentAssignments)) {
            throw AppError.conflict('Default media assignments changed. Refresh and review the latest values.', {
              reason: 'DEFAULT_MEDIA_TARGETS_STALE',
            });
          }

          await validateDefaultMediaTargets(normalizedAssignments, tx);

          if (normalizedAssignments.length === 0) {
            await tx.delete(schema.settings).where(eq(schema.settings.key, DEFAULT_MEDIA_TARGETS_SETTING_KEY));
            return normalizedAssignments;
          }

          await tx
            .insert(schema.settings)
            .values({ key: DEFAULT_MEDIA_TARGETS_SETTING_KEY, value: normalizedAssignments })
            .onConflictDoUpdate({
              target: schema.settings.key,
              set: { value: normalizedAssignments, updated_at: new Date() },
            });
          return normalizedAssignments;
        });

        await dispatchPlaybackRefresh(fastify, {
          reason: 'DEFAULT_MEDIA',
          targetAll: true,
          createdBy: payload.sub,
        });

        if (savedAssignments.length === 0) {
          return reply.status(OK).send({ assignments: [], revision: defaultMediaTargetsRevision([]) });
        }
        return reply.status(OK).send(await serializeDefaultMediaTargets());
      } catch (error) {
        logger.error(error, 'Update default media targets error');
        return respondWithError(reply, error);
      }
    }
  );
}
