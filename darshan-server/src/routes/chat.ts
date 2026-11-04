import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { config as appConfig } from '@/config';
import { apiEndpoints } from '@/config/apiEndpoints';
import { chatAuthPreHandler, getRequestAuthContext } from '@/auth/request-auth';
import { createChatRepository } from '@/db/repositories/chat';
import { createAuditLogRepository } from '@/db/repositories/audit-log';
import { createLogger } from '@/utils/logger';
import { AppError } from '@/utils/app-error';
import { respondWithError } from '@/utils/errors';
import { emitChatEvent, emitChatInboxChanged, evictChatUserFromConversation, setupChatNamespace } from '@/realtime/chat-namespace';
import { emitNotificationCountEvent } from '@/realtime/notifications-namespace';
import { notifyMessageEvent } from '@/chat/notify';
import { createNotificationCounterRepository } from '@/db/repositories/notification-counter';
import { createRateLimiter } from '@/chat/rate-limit';
import { assertAttachmentAccess, assertAttachmentMediaReady } from '@/chat/attachment-auth';
import { assertCanWriteToConversation, assertConversationWritable, assertNotBanned, getActiveModeration } from '@/chat/guard';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { headObject } from '@/s3';
import { canAccessDirectoryUser } from '@/rbac/user-directory';
import { getUserDepartmentsBatch } from '@/db/repositories/user-departments';
import { canReadContentResource } from '@/rbac/content-ownership';
import { serializeMediaRecord } from '@/utils/media';
import { resolveMediaAccess } from '@/utils/media-access';
import { defineAbilityFor, type AppAbility } from '@/rbac';

const logger = createLogger('chat-routes');
const chatRepo = createChatRepository();
const auditRepo = createAuditLogRepository();
const notificationCounterRepo = createNotificationCounterRepository();
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

const createDmSchema = z.object({
  otherUserId: z.string().uuid(),
});

const createConversationSchema = z.object({
  type: z.enum(['GROUP_CLOSED', 'FORUM_OPEN']),
  title: z.string().min(1).max(255).optional(),
  topic: z.string().max(2000).optional(),
  purpose: z.string().max(2000).optional(),
  members: z.array(z.string().uuid()).optional(),
  invite_policy: z
    .enum(['ANY_MEMBER_CAN_INVITE', 'ADMINS_ONLY_CAN_INVITE', 'INVITES_DISABLED'])
    .optional(),
  settings: z
    .object({
      mention_policy: z
        .object({
          everyone: z.enum(['ANY_MEMBER', 'ADMINS_ONLY', 'DISABLED']).optional(),
          channel: z.enum(['ANY_MEMBER', 'ADMINS_ONLY', 'DISABLED']).optional(),
          here: z.enum(['ANY_MEMBER', 'ADMINS_ONLY', 'DISABLED']).optional(),
        })
        .optional(),
      edit_policy: z.enum(['OWN', 'ADMINS_ONLY', 'DISABLED']).optional(),
      delete_policy: z.enum(['OWN', 'ADMINS_ONLY', 'DISABLED']).optional(),
    })
    .optional(),
});

const listMessagesQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).optional(),
  beforeSeq: z.coerce.number().int().positive().optional(),
  latest: z.literal('true').optional(),
  aroundMessageId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
}).refine(
  (query) => [query.afterSeq !== undefined, query.beforeSeq !== undefined, Boolean(query.latest), Boolean(query.aroundMessageId)].filter(Boolean).length <= 1,
  { message: 'Choose only one message cursor: afterSeq, beforeSeq, latest, or aroundMessageId' }
);

const sendMessageSchema = z
  .object({
    text: z.string().trim().min(1).optional(),
    replyTo: z.string().uuid().optional(),
    alsoToChannel: z.boolean().optional(),
    attachmentMediaIds: z.array(z.string().uuid()).optional(),
  })
  .refine((value) => Boolean(value.text || value.attachmentMediaIds?.length), {
    message: 'text or attachmentMediaIds is required',
  })
  .refine((value) => !value.alsoToChannel || Boolean(value.replyTo), {
    message: 'alsoToChannel is only valid for thread replies',
  });

const editMessageSchema = z.object({
  text: z.string().trim().min(1),
});

const reactionSchema = z.object({
  emoji: z.string().min(1).max(64),
  op: z.enum(['add', 'remove']),
});

const readSchema = z.object({
  lastReadSeq: z.coerce.number().int().min(0),
});

const inviteSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
});

const removeMemberSchema = z.object({
  userId: z.string().uuid(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  topic: z.string().max(2000).optional(),
  purpose: z.string().max(2000).optional(),
  invite_policy: z
    .enum(['ANY_MEMBER_CAN_INVITE', 'ADMINS_ONLY_CAN_INVITE', 'INVITES_DISABLED'])
    .optional(),
  state: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  settings: z
    .object({
      mention_policy: z
        .object({
          everyone: z.enum(['ANY_MEMBER', 'ADMINS_ONLY', 'DISABLED']).optional(),
          channel: z.enum(['ANY_MEMBER', 'ADMINS_ONLY', 'DISABLED']).optional(),
          here: z.enum(['ANY_MEMBER', 'ADMINS_ONLY', 'DISABLED']).optional(),
        })
        .optional(),
      edit_policy: z.enum(['OWN', 'ADMINS_ONLY', 'DISABLED']).optional(),
      delete_policy: z.enum(['OWN', 'ADMINS_ONLY', 'DISABLED']).optional(),
    })
    .optional(),
});

const moderationSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(['MUTE', 'BAN', 'UNMUTE', 'UNBAN']),
  until: z.string().datetime().optional(),
  reason: z.string().max(2000).optional(),
});

const bookmarkSchema = z.object({
  type: z.enum(['LINK', 'FILE', 'MESSAGE']),
  label: z.string().min(1).max(255),
  emoji: z.string().max(32).optional(),
  url: z.string().url().optional(),
  mediaAssetId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

function parseMentionedUserIds(text?: string): string[] {
  if (!text) return [];
  const regex = /@([0-9a-fA-F-]{36})/g;
  const ids = new Set<string>();
  for (const match of text.matchAll(regex)) {
    if (match[1] && z.string().uuid().safeParse(match[1]).success) ids.add(match[1]);
  }
  return Array.from(ids);
}

type MentionPolicyValue = 'ANY_MEMBER' | 'ADMINS_ONLY' | 'DISABLED';
type MutationPolicyValue = 'OWN' | 'ADMINS_ONLY' | 'DISABLED';
type ConversationSettings = {
  mention_policy: {
    everyone: MentionPolicyValue;
    channel: MentionPolicyValue;
    here: MentionPolicyValue;
  };
  edit_policy: MutationPolicyValue;
  delete_policy: MutationPolicyValue;
};

const DEFAULT_CONVERSATION_SETTINGS: ConversationSettings = {
  mention_policy: {
    everyone: 'ADMINS_ONLY',
    channel: 'ADMINS_ONLY',
    here: 'ANY_MEMBER',
  },
  edit_policy: 'OWN',
  delete_policy: 'OWN',
};

function parseSpecialMentions(text?: string): Array<'everyone' | 'channel' | 'here'> {
  if (!text) return [];
  const found = new Set<'everyone' | 'channel' | 'here'>();
  const regex = /@(?:everyone|channel|here)\b/gi;
  for (const match of text.matchAll(regex)) {
    const token = match[0].slice(1).toLowerCase();
    if (token === 'everyone' || token === 'channel' || token === 'here') {
      found.add(token);
    }
  }
  return Array.from(found);
}

function getConversationSettings(conversation: {
  metadata?: unknown;
}): ConversationSettings {
  const metadata =
    conversation.metadata && typeof conversation.metadata === 'object'
      ? (conversation.metadata as Record<string, unknown>)
      : {};
  const settings =
    metadata.settings && typeof metadata.settings === 'object'
      ? (metadata.settings as Record<string, unknown>)
      : {};
  const mentionPolicy =
    settings.mention_policy && typeof settings.mention_policy === 'object'
      ? (settings.mention_policy as Record<string, unknown>)
      : {};

  const normalizeMention = (key: 'everyone' | 'channel' | 'here'): MentionPolicyValue => {
    const value = mentionPolicy[key];
    return value === 'ANY_MEMBER' || value === 'ADMINS_ONLY' || value === 'DISABLED'
      ? value
      : DEFAULT_CONVERSATION_SETTINGS.mention_policy[key];
  };

  const normalizeMutation = (value: unknown, fallback: MutationPolicyValue): MutationPolicyValue =>
    value === 'OWN' || value === 'ADMINS_ONLY' || value === 'DISABLED' ? value : fallback;

  return {
    mention_policy: {
      everyone: normalizeMention('everyone'),
      channel: normalizeMention('channel'),
      here: normalizeMention('here'),
    },
    edit_policy: normalizeMutation(
      settings.edit_policy,
      DEFAULT_CONVERSATION_SETTINGS.edit_policy
    ),
    delete_policy: normalizeMutation(
      settings.delete_policy,
      DEFAULT_CONVERSATION_SETTINGS.delete_policy
    ),
  };
}

function mergeConversationMetadataSettings(
  currentMetadata: unknown,
  settingsPatch: z.infer<typeof updateConversationSchema>['settings'] | z.infer<typeof createConversationSchema>['settings'] | undefined
) {
  const baseMetadata =
    currentMetadata && typeof currentMetadata === 'object'
      ? ({ ...(currentMetadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  if (!settingsPatch) return baseMetadata;

  const currentSettings = getConversationSettings({ metadata: currentMetadata });
  const nextSettings: ConversationSettings = {
    mention_policy: {
      everyone:
        settingsPatch.mention_policy?.everyone ??
        currentSettings.mention_policy.everyone,
      channel:
        settingsPatch.mention_policy?.channel ??
        currentSettings.mention_policy.channel,
      here:
        settingsPatch.mention_policy?.here ??
        currentSettings.mention_policy.here,
    },
    edit_policy: settingsPatch.edit_policy ?? currentSettings.edit_policy,
    delete_policy: settingsPatch.delete_policy ?? currentSettings.delete_policy,
  };
  baseMetadata.settings = nextSettings;
  return baseMetadata;
}

function canMutateMessageByPolicy(input: {
  policy: MutationPolicyValue;
  isOwner: boolean;
  isConversationAdmin: boolean;
}): boolean {
  if (input.policy === 'DISABLED') return false;
  if (input.policy === 'ADMINS_ONLY') return input.isConversationAdmin;
  return input.isOwner;
}

async function appendAudit(
  request: FastifyRequest,
  userId: string,
  action: string,
  entityType: string,
  entityId?: string
) {
  try {
    await auditRepo.create({
      user_id: userId,
      action,
      resource_type: entityType,
      resource_id: entityId,
      ip_address: request.ip,
      user_agent: request.headers['user-agent'] as string | undefined,
    });
  } catch (error) {
    logger.warn(error, 'Failed to persist chat audit event');
  }
}

async function appendRequiredAudit(
  request: FastifyRequest,
  executor: DbExecutor,
  userId: string,
  action: string,
  entityType: string,
  entityId?: string
) {
  await auditRepo.create({
    user_id: userId,
    action,
    resource_type: entityType,
    resource_id: entityId,
    ip_address: request.ip,
    user_agent: request.headers['user-agent'] as string | undefined,
  }, executor);
}

function authenticate(request: FastifyRequest) {
  return getRequestAuthContext(request);
}

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current && typeof (current as { code?: unknown }).code === 'string') {
      return (current as { code: string }).code;
    }
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

async function getConversationForAccess(
  conversationId: string,
  userId: string,
  roleName?: string
) {
  const conversation = await chatRepo.getConversationById(conversationId);
  if (!conversation || conversation.state === 'DELETED') throw AppError.notFound('Conversation not found');
  const canAccess = await chatRepo.canAccessConversation(conversationId, userId, roleName);
  if (!canAccess) throw AppError.forbidden('Forbidden');
  return conversation;
}

function buildConversationShareLink(conversationId: string): { path: string; url?: string } {
  const path = `/chat/${conversationId}`;
  if (!appConfig.APP_PUBLIC_BASE_URL) {
    return { path };
  }

  const baseUrl = appConfig.APP_PUBLIC_BASE_URL.replace(/\/+$/, '');
  return {
    path,
    url: `${baseUrl}${path}`,
  };
}

export async function chatRoutes(fastify: FastifyInstance) {
  await setupChatNamespace(fastify);
  const forumLimiter = createRateLimiter({ capacity: 30, refillPerSecond: 1 });
  const forumAttachmentLimiter = createRateLimiter({ capacity: 10, refillPerSecond: 0.5 });
  const db = getDatabase();
  const assertRestoreAdmin = (payload: { role: string }, ability: AppAbility) => {
    if (!['SUPER_ADMIN', 'ADMIN'].includes(payload.role) || !ability.can('manage', 'Conversation')) {
      throw AppError.forbidden('Administrator conversation restore permission required');
    }
  };
  const deletedListOffset = (query: unknown): number => {
    const value = (query as { page?: string } | undefined)?.page ?? '1';
    const page = Number(value);
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw AppError.badRequest('Invalid deleted-content page');
    return (page - 1) * 100;
  };
  const verifyMessageObjects = async (messageId: string, tx: any) => {
    const attachments = await tx.select({ media_asset_id: schema.chatAttachments.media_asset_id })
      .from(schema.chatAttachments).where(eq(schema.chatAttachments.message_id, messageId));
    for (const attachment of attachments) {
      const [media] = await tx.select().from(schema.media).where(eq(schema.media.id, attachment.media_asset_id));
      if (!media || media.deleted_at) throw new AppError({ statusCode: 409, code: 'CHAT_RESTORE_MEDIA_MISSING', message: 'An attachment is unavailable.' });
      const ids = [media.source_object_id, media.ready_object_id].filter(Boolean) as string[];
      const objects = ids.length ? await tx.select().from(schema.storageObjects).where(inArray(schema.storageObjects.id, ids)) : [];
      if (objects.length !== new Set(ids).size) throw new AppError({ statusCode: 409, code: 'CHAT_RESTORE_MEDIA_MISSING', message: 'An attachment object is missing.' });
      const locations = new Map<string, { bucket: string; key: string }>(objects.map((item: typeof schema.storageObjects.$inferSelect) => [`${item.bucket}/${item.object_key}`, { bucket: item.bucket, key: item.object_key }]));
      if (media.source_bucket && media.source_object_key) locations.set(`${media.source_bucket}/${media.source_object_key}`, { bucket: media.source_bucket, key: media.source_object_key });
      for (const location of locations.values()) {
        try { await headObject(location.bucket, location.key); }
        catch { throw new AppError({ statusCode: 409, code: 'CHAT_RESTORE_MEDIA_MISSING', message: 'An attachment object is unavailable.' }); }
      }
    }
  };
  const assertDirectoryTargets = async (payload: any, ability: any, userIds: string[]) => {
    const uniqueIds = Array.from(new Set(userIds));
    if (uniqueIds.length === 0) return;
    const users = await db.select().from(schema.users).where(inArray(schema.users.id, uniqueIds as any));
    const memberships = await getUserDepartmentsBatch(uniqueIds, db);
    if (
      users.length !== uniqueIds.length ||
      users.some((user) => !canAccessDirectoryUser(
        { userId: payload.sub, departmentId: payload.department_id,
          departmentIds: payload.department_ids },
        { ...user, department_ids: memberships.get(user.id)?.departmentIds },
        ability
      ))
    ) throw AppError.notFound('User not found');
  };

  fastify.post<{ Body: typeof createDmSchema._type }>(
    apiEndpoints.chat.createDm,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload, ability } = await authenticate(request);
        const data = createDmSchema.parse(request.body);
        if (data.otherUserId === payload.sub) throw AppError.badRequest('Cannot create DM with yourself');
        await assertDirectoryTargets(payload, ability, [data.otherUserId]);

        const conversation = await chatRepo.getOrCreateDm(payload.sub, data.otherUserId);
        await appendAudit(request, payload.sub, 'CHAT_CONVERSATION_CREATE', 'ChatConversation', conversation.id);
        emitChatInboxChanged(fastify, [payload.sub, data.otherUserId], conversation.id);
        return reply.send({ conversation });
      } catch (error) {
        logger.error(error, 'Create DM error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Body: typeof createConversationSchema._type }>(
    apiEndpoints.chat.createConversation,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload, ability } = await authenticate(request);
        const data = createConversationSchema.parse(request.body);
        await assertDirectoryTargets(payload, ability, data.members ?? []);
        const metadata = mergeConversationMetadataSettings({}, data.settings);
        const conversation = await chatRepo.createConversation({
          type: data.type,
          title: data.title,
          topic: data.topic,
          purpose: data.purpose,
          invite_policy: data.invite_policy,
          createdBy: payload.sub,
          members: data.members,
          metadata,
        });
        await appendAudit(request, payload.sub, 'CHAT_CONVERSATION_CREATE', 'ChatConversation', conversation.id);
        emitChatEvent(fastify, conversation.id, 'chat:conversation:updated', {
          conversationId: conversation.id,
          patch: { state: conversation.state },
        });
        if (conversation.type === 'FORUM_OPEN') {
          emitChatInboxChanged(fastify);
        } else {
          try {
            const members = await chatRepo.listMembers(conversation.id);
            emitChatInboxChanged(fastify, members.map((member) => member.user_id), conversation.id);
          } catch (error) {
            logger.warn(error, 'Conversation created but inbox refresh could not be sent');
          }
        }
        return reply.send({ conversation });
      } catch (error) {
        logger.error(error, 'Create conversation error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(
    apiEndpoints.chat.listConversations,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const items = await chatRepo.listConversations(payload.sub);
        return reply.send({ items });
      } catch (error) {
        logger.error(error, 'List conversations error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.chat.getConversation,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const conversationId = (request.params as any).id;
        const conversation = await getConversationForAccess(conversationId, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(conversationId, payload.sub);
        assertNotBanned(moderation);
        const member = await chatRepo.getMember(conversationId, payload.sub);

        return reply.send({
          conversation: {
            id: conversation.id,
            type: conversation.type,
            state: conversation.state,
            title: conversation.title,
            topic: conversation.topic,
            purpose: conversation.purpose,
            invite_policy: conversation.invite_policy,
            last_seq: conversation.last_seq,
          },
          viewer: {
            is_member: Boolean(member),
            role: member?.role ?? null,
          },
        });
      } catch (error) {
        logger.error(error, 'Get conversation error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string; mediaId: string } }>(
    apiEndpoints.chat.attachmentMedia,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const { id: conversationId, mediaId } = request.params;
        z.string().uuid().parse(mediaId);
        await getConversationForAccess(conversationId, payload.sub, payload.role);
        assertNotBanned(await chatRepo.getModeration(conversationId, payload.sub));

        const [messageAttachment] = await db.select({ id: schema.chatAttachments.id })
          .from(schema.chatAttachments)
          .innerJoin(schema.chatMessages, eq(schema.chatAttachments.message_id, schema.chatMessages.id))
          .where(and(
            eq(schema.chatAttachments.media_asset_id, mediaId),
            eq(schema.chatMessages.conversation_id, conversationId),
            isNull(schema.chatMessages.deleted_at)
          )).limit(1);
        const [fileBookmark] = messageAttachment ? [] : await db.select({
          id: schema.chatBookmarks.id,
          created_by: schema.chatBookmarks.created_by,
          share_authorized_at: schema.chatBookmarks.share_authorized_at,
        })
          .from(schema.chatBookmarks)
          .where(and(
            eq(schema.chatBookmarks.conversation_id, conversationId),
            eq(schema.chatBookmarks.type, 'FILE'),
            eq(schema.chatBookmarks.media_asset_id, mediaId)
          )).limit(1);
        if (!messageAttachment && !fileBookmark) throw AppError.notFound('Attachment not found');

        const [media] = await db.select().from(schema.media).where(eq(schema.media.id, mediaId)).limit(1);
        if (!media || media.deleted_at || media.status !== 'READY') throw AppError.notFound('Attachment not found');
        // Legacy bookmarks have no immutable proof of authorization at share
        // time. New bookmarks retain their verified share after role or
        // department changes, while legacy bookmarks keep the old guard.
        if (!messageAttachment && fileBookmark && !fileBookmark.share_authorized_at) {
          const [creator] = await db.select({
            id: schema.users.id,
            role_id: schema.users.role_id,
            department_id: schema.users.department_id,
          }).from(schema.users).where(eq(schema.users.id, fileBookmark.created_by)).limit(1);
          if (!creator) throw AppError.notFound('Attachment not found');
          const creatorAbility = await defineAbilityFor(
            creator.role_id,
            creator.id,
            creator.department_id ?? undefined
          );
          const creatorMembership = await getUserDepartmentsBatch([creator.id], db);
          if (!canReadContentResource({
            userId: creator.id,
            roleName: '',
            departmentId: creator.department_id,
            departmentIds: creatorMembership.get(creator.id)?.departmentIds,
          }, media, creatorAbility, 'Media')) {
            throw AppError.notFound('Attachment not found');
          }
        }
        const access = await resolveMediaAccess(media, db);
        if (access.is_object_missing || !access.media_url) throw AppError.notFound('Attachment is unavailable');
        reply.header('Cache-Control', 'no-store');
        return reply.send(serializeMediaRecord(media, access.media_url, {
          content_type: access.content_type,
          source_content_type: access.source_content_type,
          size: access.size,
          ready_object_id: access.ready_object_id,
          ready_object_sha256: access.ready_object_sha256,
          ready_object_created_at: access.ready_object_created_at,
        }));
      } catch (error) {
        logger.error(error, 'Get chat attachment error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    apiEndpoints.chat.shareLink,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const conversationId = (request.params as any).id;
        await getConversationForAccess(conversationId, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(conversationId, payload.sub);
        assertNotBanned(moderation);
        return reply.send(buildConversationShareLink(conversationId));
      } catch (error) {
        logger.error(error, 'Share link error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string }; Querystring: typeof listMessagesQuerySchema._type }>(
    apiEndpoints.chat.listMessages,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const query = listMessagesQuerySchema.parse(request.query);
        const conversationId = (request.params as any).id;
        await getConversationForAccess(conversationId, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(conversationId, payload.sub);
        assertNotBanned(moderation);
        let throughSeq: number | undefined;
        if (query.aroundMessageId) {
          const anchor = await chatRepo.getMessageById(query.aroundMessageId);
          if (!anchor || anchor.conversation_id !== conversationId ||
            (anchor.thread_root_id && !anchor.also_to_channel)) {
            throw AppError.notFound('Message not found in this conversation');
          }
          throughSeq = anchor.seq;
        }
        const result = await chatRepo.listMessages(conversationId, {
          afterSeq: query.afterSeq,
          beforeSeq: query.beforeSeq,
          latest: query.latest === 'true',
          throughSeq,
          limit: query.limit,
        });
        return reply.send(result);
      } catch (error) {
        logger.error(error, 'List messages error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string; parentMessageId: string }; Querystring: typeof listMessagesQuerySchema._type }>(
    apiEndpoints.chat.listThread,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const query = listMessagesQuerySchema.parse(request.query);
        const conversationId = (request.params as any).id;
        const parentMessageId = (request.params as any).parentMessageId;
        await getConversationForAccess(conversationId, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(conversationId, payload.sub);
        assertNotBanned(moderation);
        const parentMessage = await chatRepo.getMessageById(parentMessageId);
        if (!parentMessage || parentMessage.conversation_id !== conversationId) {
          throw AppError.notFound('Parent message not found');
        }
        const threadRootId = parentMessage.thread_root_id || parentMessage.id;
        const rootMessage = await chatRepo.getMessageWithDetails(threadRootId);
        if (!rootMessage || rootMessage.conversation_id !== conversationId) {
          throw AppError.notFound('Thread root message not found');
        }
        let throughSeq: number | undefined;
        if (query.aroundMessageId) {
          const anchor = await chatRepo.getMessageById(query.aroundMessageId);
          if (!anchor || anchor.conversation_id !== conversationId || anchor.thread_root_id !== threadRootId) {
            throw AppError.notFound('Reply not found in this thread');
          }
          throughSeq = anchor.seq;
        }
        const result = await chatRepo.listMessages(conversationId, {
          afterSeq: query.afterSeq,
          beforeSeq: query.beforeSeq,
          latest: query.latest === 'true',
          throughSeq,
          limit: query.limit,
          threadRootId,
        });
        return reply.send({ ...result, threadRootId, rootMessage });
      } catch (error) {
        logger.error(error, 'List thread error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: typeof sendMessageSchema._type }>(
    apiEndpoints.chat.sendMessage,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload, ability } = await authenticate(request);
        const data = sendMessageSchema.parse(request.body);
        const conversationId = (request.params as any).id;
        if (data.attachmentMediaIds?.length && data.attachmentMediaIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
          throw new AppError({
            statusCode: 400,
            code: 'CHAT_TOO_MANY_ATTACHMENTS',
            message: `Maximum ${MAX_ATTACHMENTS_PER_MESSAGE} attachments allowed per message`,
          });
        }

        const conversation = await getConversationForAccess(conversationId, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(conversationId, payload.sub);
        assertCanWriteToConversation(conversation, moderation);
        const settings = getConversationSettings(conversation);
        const specialMentions = parseSpecialMentions(data.text);
        if (specialMentions.length && conversation.type !== 'DM') {
          const canAdmin = await chatRepo.isConversationAdmin(conversationId, payload.sub, payload.role);
          for (const mention of specialMentions) {
            const policy = settings.mention_policy[mention];
            if (policy === 'DISABLED') {
              throw new AppError({
                statusCode: 403,
                code: 'CHAT_MENTION_POLICY_VIOLATION',
                message: `@${mention} mentions are disabled in this conversation`,
              });
            }
            if (policy === 'ADMINS_ONLY' && !canAdmin) {
              throw new AppError({
                statusCode: 403,
                code: 'CHAT_MENTION_POLICY_VIOLATION',
                message: `@${mention} mention is restricted to admins`,
              });
            }
          }
        }

        if (conversation.type === 'FORUM_OPEN') {
          const key = `${payload.sub}:${conversationId}:forum`;
          const messageLimit = await forumLimiter.consume(key);
          if (!messageLimit.allowed) {
            throw AppError.rateLimited(
              `Forum message rate limit exceeded. Retry in ${messageLimit.retryAfterSeconds ?? 1}s`
            );
          }
          if (data.attachmentMediaIds?.length) {
            const attachmentLimit = await forumAttachmentLimiter.consume(`${key}:attachments`, data.attachmentMediaIds.length);
            if (!attachmentLimit.allowed) {
              throw AppError.rateLimited(
                `Attachment rate limit exceeded. Retry in ${attachmentLimit.retryAfterSeconds ?? 1}s`
              );
            }
          }
        }

        if (data.attachmentMediaIds?.length) {
          const attachmentMediaIds = Array.from(new Set(data.attachmentMediaIds));
          const mediaRows = await db
            .select()
            .from(schema.media)
            .where(inArray(schema.media.id, attachmentMediaIds));

          assertAttachmentMediaReady(mediaRows);
          if (mediaRows.some((media) => !canReadContentResource({
            userId: payload.sub,
            roleName: payload.role,
            departmentId: payload.department_id,
            departmentIds: payload.department_ids,
          }, media, ability, 'Media'))) {
            throw AppError.forbidden('Attachment media is outside your readable scope');
          }

          assertAttachmentAccess({
            requestedMediaIds: attachmentMediaIds,
            mediaRows: mediaRows as Array<{ id: string; created_by?: string | null }>,
            senderId: payload.sub,
            senderRole: payload.role,
            senderDepartmentId: payload.department_id,
            senderDepartmentIds: payload.department_ids,
            canOverrideMedia: ability.can('update', 'Media'),
            canManageMedia: ability.can('manage', 'Media'),
          });

          data.attachmentMediaIds = attachmentMediaIds;
        }

        const mentionedUserIds = parseMentionedUserIds(data.text);
        await assertDirectoryTargets(payload, ability, mentionedUserIds);
        const bodyRich = { mentions: mentionedUserIds };

        const { message, threadRootSenderId } = await chatRepo.sendMessageTx({
          conversationId,
          senderId: payload.sub,
          bodyText: data.text,
          bodyRich,
          replyToMessageId: data.replyTo,
          alsoToChannel: data.alsoToChannel,
          attachmentMediaIds: data.attachmentMediaIds,
        });

        const members = conversation.type === 'DM' ? await chatRepo.listMembers(conversationId) : [];
        const participantA = members[0]?.user_id ?? null;
        const participantB = members[1]?.user_id ?? null;
        notifyMessageEvent({
          conversation: {
            id: conversationId,
            type: conversation.type as any,
            title: conversation.title,
            participantA,
            participantB,
          },
          message: {
            id: message.id,
            body_text: message.body_text,
            threadRootId: message.thread_root_id,
          },
          senderId: payload.sub,
          mentionedUserIds: bodyRich.mentions,
          threadRootSenderId,
          canNotifyUser: async (userId) => {
            if (!(await chatRepo.canAccessConversation(conversationId, userId))) return false;
            const recipientModeration = await chatRepo.getModeration(conversationId, userId);
            return !getActiveModeration(recipientModeration).bannedUntil;
          },
          onNotificationCreated: async ({ userId }) => {
            const unread_total = await notificationCounterRepo.getUnreadTotal(userId);
            emitNotificationCountEvent(fastify, userId, unread_total);
          },
        }).catch((error) => {
          logger.warn(error, 'Notification dispatch failed');
        });

        await appendAudit(request, payload.sub, 'CHAT_MESSAGE_SEND', 'ChatMessage', message.id);
        emitChatEvent(fastify, conversationId, 'chat:message:new', {
          conversationId,
          seq: message.seq,
          message,
        });

        return reply.send({ message });
      } catch (error) {
        logger.error(error, 'Send message error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: string }; Body: typeof editMessageSchema._type }>(
    apiEndpoints.chat.editMessage,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const data = editMessageSchema.parse(request.body);
        const row = await chatRepo.getConversationForMessage((request.params as any).id);
        if (!row) throw AppError.notFound('Message not found');
        const conversation = await getConversationForAccess(row.conversation.id, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(row.conversation.id, payload.sub);
        assertCanWriteToConversation(conversation, moderation);
        const settings = getConversationSettings(conversation);
        const isOwner = row.message.sender_id === payload.sub;
        const isConversationAdmin = await chatRepo.isConversationAdmin(
          row.conversation.id,
          payload.sub,
          payload.role
        );
        const specialMentions = parseSpecialMentions(data.text);
        if (specialMentions.length && conversation.type !== 'DM') {
          for (const mention of specialMentions) {
            const policy = settings.mention_policy[mention];
            if (policy === 'DISABLED') {
              throw new AppError({
                statusCode: 403,
                code: 'CHAT_MENTION_POLICY_VIOLATION',
                message: `@${mention} mentions are disabled in this conversation`,
              });
            }
            if (policy === 'ADMINS_ONLY' && !isConversationAdmin) {
              throw new AppError({
                statusCode: 403,
                code: 'CHAT_MENTION_POLICY_VIOLATION',
                message: `@${mention} mention is restricted to admins`,
              });
            }
          }
        }
        const canEdit = canMutateMessageByPolicy({
          policy: settings.edit_policy,
          isOwner,
          isConversationAdmin,
        });
        if (!canEdit) {
          if (settings.edit_policy === 'DISABLED') {
            throw new AppError({
              statusCode: 403,
              code: 'CHAT_EDIT_POLICY_DISABLED',
              message: 'Message editing is disabled in this conversation',
            });
          }
          throw new AppError({
            statusCode: 403,
            code: 'CHAT_EDIT_POLICY_FORBIDDEN',
            message: 'You cannot edit this message',
          });
        }

        const message = await chatRepo.editMessage({
          messageId: row.message.id,
          editorId: payload.sub,
          newBodyText: data.text,
          newBodyRich: { mentions: parseMentionedUserIds(data.text) },
        });

        await appendAudit(request, payload.sub, 'CHAT_MESSAGE_EDIT', 'ChatMessage', row.message.id);
        emitChatEvent(fastify, row.conversation.id, 'chat:message:updated', {
          conversationId: row.conversation.id,
          messageId: row.message.id,
          patch: message,
        });
        return reply.send({ message });
      } catch (error) {
        logger.error(error, 'Edit message error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(apiEndpoints.chat.deletedConversations, { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    try {
      const { payload, ability } = authenticate(request);
      assertRestoreAdmin(payload, ability);
      const items = await db.transaction(async (tx) => {
        const rows = await tx.select({ id: schema.chatConversations.id, title: schema.chatConversations.title, type: schema.chatConversations.type, created_by: schema.chatConversations.created_by, deleted_at: schema.chatConversations.deleted_at })
          .from(schema.chatConversations).where(eq(schema.chatConversations.state, 'DELETED'))
          .orderBy(desc(schema.chatConversations.deleted_at)).limit(100).offset(deletedListOffset(request.query));
        await appendRequiredAudit(request, tx, payload.sub, 'CHAT_DELETED_CONVERSATIONS_LIST', 'ChatConversation');
        return rows;
      });
      return reply.send({ items });
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.get(apiEndpoints.chat.deletedMessages, { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    try {
      const { payload, ability } = authenticate(request);
      assertRestoreAdmin(payload, ability);
      const items = await db.transaction(async (tx) => {
        const rows = await tx.select({ id: schema.chatMessages.id, conversation_id: schema.chatMessages.conversation_id, sender_id: schema.chatMessages.sender_id, deleted_at: schema.chatMessages.deleted_at })
          .from(schema.chatMessages).where(isNotNull(schema.chatMessages.deleted_at))
          .orderBy(desc(schema.chatMessages.deleted_at)).limit(100).offset(deletedListOffset(request.query));
        await appendRequiredAudit(request, tx, payload.sub, 'CHAT_DELETED_MESSAGES_LIST', 'ChatMessage');
        return rows;
      });
      return reply.send({ items });
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.post<{ Params: { id: string } }>(apiEndpoints.chat.restoreConversation, { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    try {
      const { payload, ability } = authenticate(request);
      assertRestoreAdmin(payload, ability);
      const id = request.params.id;
      const result = await db.transaction(async (tx) => {
        const [conversation] = await tx.select().from(schema.chatConversations).where(eq(schema.chatConversations.id, id)).for('update');
        if (!conversation) throw AppError.notFound('Conversation not found');
        if (conversation.state !== 'DELETED') {
          await appendRequiredAudit(request, tx, payload.sub, 'CHAT_CONVERSATION_RESTORE', 'ChatConversation', id);
          return { conversationId: id, already_restored: true };
        }
        if (conversation.type === 'DM' && conversation.dm_pair_key) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`darshan_chat_dm_pair_v1:${conversation.dm_pair_key}`}))`);
          const [conflict] = await tx.select({ id: schema.chatConversations.id }).from(schema.chatConversations)
            .where(and(
              eq(schema.chatConversations.dm_pair_key, conversation.dm_pair_key),
              eq(schema.chatConversations.type, 'DM'),
              ne(schema.chatConversations.state, 'DELETED')
            )).limit(1);
          if (conflict) throw new AppError({ statusCode: 409, code: 'CHAT_RESTORE_ASSOCIATION_CONFLICT', message: 'Another direct conversation already exists.' });
        }
        const messages = await tx.select({ id: schema.chatMessages.id }).from(schema.chatMessages).where(eq(schema.chatMessages.conversation_id, id));
        for (const message of messages) await verifyMessageObjects(message.id, tx);
        await tx.update(schema.chatConversations).set({ state: conversation.archived_at ? 'ARCHIVED' : 'ACTIVE', deleted_at: null, updated_at: new Date() }).where(eq(schema.chatConversations.id, id));
        await appendRequiredAudit(request, tx, payload.sub, 'CHAT_CONVERSATION_RESTORE', 'ChatConversation', id);
        return { conversationId: id, already_restored: false };
      });
      return reply.send(result);
    } catch (error) {
      if (postgresErrorCode(error) === '23505') {
        return respondWithError(reply, new AppError({ statusCode: 409, code: 'CHAT_RESTORE_ASSOCIATION_CONFLICT', message: 'Another direct conversation already exists.' }));
      }
      return respondWithError(reply, error);
    }
  });

  fastify.post<{ Params: { id: string } }>(apiEndpoints.chat.restoreMessage, { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    try {
      const { payload, ability } = authenticate(request);
      assertRestoreAdmin(payload, ability);
      const id = request.params.id;
      const result = await db.transaction(async (tx) => {
        const [message] = await tx.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, id)).for('update');
        if (!message) throw AppError.notFound('Message not found');
        const [conversation] = await tx.select().from(schema.chatConversations).where(eq(schema.chatConversations.id, message.conversation_id));
        if (!conversation || conversation.state === 'DELETED') throw new AppError({ statusCode: 409, code: 'CHAT_RESTORE_CONVERSATION_FIRST', message: 'Restore the conversation first.' });
        if (!message.deleted_at) {
          await appendRequiredAudit(request, tx, payload.sub, 'CHAT_MESSAGE_RESTORE', 'ChatMessage', id);
          return { messageId: id, already_restored: true };
        }
        await verifyMessageObjects(id, tx);
        await tx.update(schema.chatMessages).set({ deleted_at: null }).where(eq(schema.chatMessages.id, id));
        await appendRequiredAudit(request, tx, payload.sub, 'CHAT_MESSAGE_RESTORE', 'ChatMessage', id);
        return { messageId: id, already_restored: false };
      });
      return reply.send(result);
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.delete<{ Params: { id: string } }>(
    apiEndpoints.chat.deleteMessage,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const row = await chatRepo.getConversationForMessage((request.params as any).id);
        if (!row) throw AppError.notFound('Message not found');
        const conversation = await getConversationForAccess(row.conversation.id, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(row.conversation.id, payload.sub);
        assertCanWriteToConversation(conversation, moderation);
        const settings = getConversationSettings(conversation);
        const isOwner = row.message.sender_id === payload.sub;
        const isConversationAdmin = await chatRepo.isConversationAdmin(
          row.conversation.id,
          payload.sub,
          payload.role
        );
        const canDelete = canMutateMessageByPolicy({
          policy: settings.delete_policy,
          isOwner,
          isConversationAdmin,
        });
        if (!canDelete) {
          if (settings.delete_policy === 'DISABLED') {
            throw new AppError({
              statusCode: 403,
              code: 'CHAT_DELETE_POLICY_DISABLED',
              message: 'Message deletion is disabled in this conversation',
            });
          }
          throw new AppError({
            statusCode: 403,
            code: 'CHAT_DELETE_POLICY_FORBIDDEN',
            message: 'You cannot delete this message',
          });
        }

        const result = await chatRepo.softDeleteMessage({
          messageId: row.message.id,
          editorId: payload.sub,
        });
        const message = result.message;


        await appendAudit(request, payload.sub, 'CHAT_MESSAGE_DELETE', 'ChatMessage', row.message.id);
        emitChatEvent(fastify, row.conversation.id, 'chat:message:deleted', {
          conversationId: row.conversation.id,
          messageId: row.message.id,
          seq: message.seq,
        });
        return reply.send({ message: { ...message, body_text: null, body_rich: null } });
      } catch (error) {
        logger.error(error, 'Delete message error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: typeof reactionSchema._type }>(
    apiEndpoints.chat.reactToMessage,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const data = reactionSchema.parse(request.body);
        const row = await chatRepo.getConversationForMessage((request.params as any).id);
        if (!row) throw AppError.notFound('Message not found');
        const conversation = await getConversationForAccess(row.conversation.id, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(row.conversation.id, payload.sub);
        assertCanWriteToConversation(conversation, moderation);

        const result = await chatRepo.updateReaction({
          messageId: row.message.id,
          userId: payload.sub,
          emoji: data.emoji,
          op: data.op,
        });

        await appendAudit(
          request,
          payload.sub,
          data.op === 'add' ? 'CHAT_REACTION_ADD' : 'CHAT_REACTION_REMOVE',
          'ChatMessage',
          row.message.id
        );
        emitChatEvent(fastify, row.conversation.id, 'chat:message:updated', {
          conversationId: row.conversation.id,
          messageId: row.message.id,
          patch: { reactions: result.reactions },
        });

        return reply.send(result);
      } catch (error) {
        logger.error(error, 'Reaction update error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    apiEndpoints.chat.pinMessage,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const row = await chatRepo.getConversationForMessage((request.params as any).id);
        if (!row) throw AppError.notFound('Message not found');
        const conversation = await getConversationForAccess(row.conversation.id, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(row.conversation.id, payload.sub);
        assertCanWriteToConversation(conversation, moderation);

        const pin = await chatRepo.pinMessage({
          conversationId: row.conversation.id,
          messageId: row.message.id,
          pinnedBy: payload.sub,
        });
        await appendAudit(request, payload.sub, 'CHAT_PIN_ADD', 'ChatMessage', row.message.id);
        emitChatEvent(fastify, row.conversation.id, 'chat:pin:update', {
          conversationId: row.conversation.id,
          messageId: row.message.id,
          pinned: true,
          pin,
        });
        return reply.send({ pin });
      } catch (error) {
        logger.error(error, 'Pin message error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    apiEndpoints.chat.unpinMessage,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const row = await chatRepo.getConversationForMessage((request.params as any).id);
        if (!row) throw AppError.notFound('Message not found');
        const conversation = await getConversationForAccess(row.conversation.id, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(row.conversation.id, payload.sub);
        assertCanWriteToConversation(conversation, moderation);

        const removed = await chatRepo.unpinMessage(row.conversation.id, row.message.id);
        await appendAudit(request, payload.sub, 'CHAT_PIN_REMOVE', 'ChatMessage', row.message.id);
        emitChatEvent(fastify, row.conversation.id, 'chat:pin:update', {
          conversationId: row.conversation.id,
          messageId: row.message.id,
          pinned: false,
        });
        return reply.send({ success: removed });
      } catch (error) {
        logger.error(error, 'Unpin message error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.chat.listPins,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const conversationId = (request.params as any).id;
        await getConversationForAccess(conversationId, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(conversationId, payload.sub);
        assertNotBanned(moderation);
        const items = await chatRepo.listPins(conversationId);
        return reply.send({ items });
      } catch (error) {
        logger.error(error, 'List pins error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: typeof bookmarkSchema._type }>(
    apiEndpoints.chat.createBookmark,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload, ability } = await authenticate(request);
        const data = bookmarkSchema.parse(request.body);
        const conversationId = (request.params as any).id;
        const conversation = await getConversationForAccess(conversationId, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(conversationId, payload.sub);
        assertCanWriteToConversation(conversation, moderation);

        if (data.type === 'FILE' && data.mediaAssetId) {
          const [media] = await db.select().from(schema.media)
            .where(eq(schema.media.id, data.mediaAssetId)).limit(1);
          assertAttachmentMediaReady(media ? [media] : []);
          if (media && !canReadContentResource({
            userId: payload.sub,
            roleName: payload.role,
            departmentId: payload.department_id,
            departmentIds: payload.department_ids,
          }, media, ability, 'Media')) {
            throw AppError.forbidden('Attachment media is outside your readable scope');
          }
          assertAttachmentAccess({
            requestedMediaIds: [data.mediaAssetId],
            mediaRows: media ? [media] : [],
            senderId: payload.sub,
            senderRole: payload.role,
            senderDepartmentId: payload.department_id,
            senderDepartmentIds: payload.department_ids,
            canOverrideMedia: ability.can('update', 'Media'),
            canManageMedia: ability.can('manage', 'Media'),
          });
        }

        const { bookmark, created } = await chatRepo.createBookmark({
          conversationId,
          type: data.type,
          label: data.label,
          emoji: data.emoji,
          url: data.url,
          mediaAssetId: data.mediaAssetId,
          messageId: data.messageId,
          metadata: data.metadata,
          createdBy: payload.sub,
          shareAuthorizedAt: data.type === 'FILE' ? new Date() : undefined,
        });
        if (created) {
          await appendAudit(request, payload.sub, 'CHAT_BOOKMARK_ADD', 'ChatConversation', conversationId);
          emitChatEvent(fastify, conversationId, 'chat:bookmark:update', {
            conversationId,
            bookmarkId: bookmark.id,
            op: 'add',
          });
        }
        return reply.send({ bookmark });
      } catch (error) {
        logger.error(error, 'Create bookmark error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.chat.listBookmarks,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const conversationId = (request.params as any).id;
        await getConversationForAccess(conversationId, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(conversationId, payload.sub);
        assertNotBanned(moderation);
        const items = await chatRepo.listBookmarks(conversationId);
        return reply.send({ items });
      } catch (error) {
        logger.error(error, 'List bookmarks error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    apiEndpoints.chat.deleteBookmark,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const bookmarkId = (request.params as any).id;
        const bookmark = await chatRepo.getBookmarkById(bookmarkId);
        if (!bookmark) throw AppError.notFound('Bookmark not found');
        const conversation = await getConversationForAccess(
          bookmark.conversation_id,
          payload.sub,
          payload.role
        );
        const moderation = await chatRepo.getModeration(bookmark.conversation_id, payload.sub);
        assertCanWriteToConversation(conversation, moderation);

        const isConversationAdmin = await chatRepo.isConversationAdmin(
          bookmark.conversation_id,
          payload.sub,
          payload.role
        );
        if (bookmark.created_by !== payload.sub && !isConversationAdmin) {
          throw AppError.forbidden('Only creator or chat admin can remove bookmark');
        }

        const deleted = await chatRepo.deleteBookmark(bookmarkId);
        await appendAudit(request, payload.sub, 'CHAT_BOOKMARK_REMOVE', 'ChatConversation', bookmark.conversation_id);
        emitChatEvent(fastify, bookmark.conversation_id, 'chat:bookmark:update', {
          conversationId: bookmark.conversation_id,
          bookmarkId,
          op: 'remove',
        });
        return reply.send({ success: Boolean(deleted) });
      } catch (error) {
        logger.error(error, 'Delete bookmark error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: typeof readSchema._type }>(
    apiEndpoints.chat.markRead,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const data = readSchema.parse(request.body);
        const conversationId = (request.params as any).id;
        await getConversationForAccess(conversationId, payload.sub, payload.role);
        const moderation = await chatRepo.getModeration(conversationId, payload.sub);
        assertNotBanned(moderation);

        const receipt = await chatRepo.markRead(conversationId, payload.sub, data.lastReadSeq);
        return reply.send({ receipt });
      } catch (error) {
        logger.error(error, 'Mark read error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: typeof inviteSchema._type }>(
    apiEndpoints.chat.inviteMembers,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload, ability } = await authenticate(request);
        const data = inviteSchema.parse(request.body);
        await assertDirectoryTargets(payload, ability, data.userIds);
        const conversationId = (request.params as any).id;
        const conversation = await getConversationForAccess(conversationId, payload.sub, payload.role);
        assertConversationWritable(conversation);
        if (conversation.type === 'DM') throw AppError.forbidden('DM does not support invites');

        const member = await chatRepo.getMember(conversationId, payload.sub);
        const isConvAdmin = await chatRepo.isConversationAdmin(conversationId, payload.sub, payload.role);
        if (conversation.invite_policy === 'INVITES_DISABLED' && !ability.can('manage', 'Conversation')) {
          throw AppError.forbidden('Invites are disabled');
        }
        if (conversation.invite_policy === 'ADMINS_ONLY_CAN_INVITE' && !isConvAdmin) {
          throw AppError.forbidden('Only admins can invite members');
        }
        if (conversation.invite_policy === 'ANY_MEMBER_CAN_INVITE' && !member && !isConvAdmin) {
          throw AppError.forbidden('Only members can invite');
        }

        await chatRepo.inviteMembers(conversationId, Array.from(new Set(data.userIds)));
        await chatRepo.ensureSystemAdmins(conversationId);
        await appendAudit(request, payload.sub, 'CHAT_MEMBER_INVITE', 'ChatConversation', conversationId);
        emitChatEvent(fastify, conversationId, 'chat:conversation:updated', {
          conversationId,
          patch: { membersChanged: true },
        });
        try {
          const members = await chatRepo.listMembers(conversationId);
          emitChatInboxChanged(fastify, members.map((member) => member.user_id), conversationId);
        } catch (error) {
          logger.warn(error, 'Members invited but inbox refresh could not be sent');
        }
        return reply.send({ success: true });
      } catch (error) {
        logger.error(error, 'Invite members error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.chat.listMembers,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const conversationId = request.params.id;
        const conversation = await getConversationForAccess(conversationId, payload.sub, payload.role);
        if (conversation.type === 'DM') throw AppError.forbidden('DM membership cannot be managed');
        if (!(await chatRepo.isConversationAdmin(conversationId, payload.sub, payload.role))) {
          throw AppError.forbidden('Only chat admins can view the member roster');
        }
        const items = await db.select({
          user_id: schema.chatMembers.user_id,
          role: schema.chatMembers.role,
          is_system: schema.chatMembers.is_system,
          email: schema.users.email,
          first_name: schema.users.first_name,
          last_name: schema.users.last_name,
          is_active: schema.users.is_active,
        }).from(schema.chatMembers)
          .innerJoin(schema.users, eq(schema.chatMembers.user_id, schema.users.id))
          .where(and(eq(schema.chatMembers.conversation_id, conversationId), isNull(schema.chatMembers.left_at)))
          .orderBy(schema.users.email);
        return reply.send({ items: items.map((item) => ({
          ...item,
          email: item.is_active ? item.email : null,
          first_name: item.is_active ? item.first_name : null,
          last_name: item.is_active ? item.last_name : null,
        })) });
      } catch (error) {
        logger.error(error, 'List conversation members error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: typeof removeMemberSchema._type }>(
    apiEndpoints.chat.removeMember,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const data = removeMemberSchema.parse(request.body);
        const conversationId = (request.params as any).id;
        const conversation = await getConversationForAccess(conversationId, payload.sub, payload.role);
        assertConversationWritable(conversation);
        if (conversation.type !== 'GROUP_CLOSED') {
          throw AppError.forbidden('Membership removal is available only for closed groups');
        }
        const canAdmin = await chatRepo.isConversationAdmin(conversationId, payload.sub, payload.role);
        if (!canAdmin) throw AppError.forbidden('Only chat admins can remove members');
        const targetMember = await chatRepo.getMember(conversationId, data.userId);
        if (!targetMember) throw AppError.notFound('Member not found');
        if (targetMember.is_system) throw AppError.forbidden('System member cannot be removed');
        if (targetMember.role === 'OWNER') throw AppError.forbidden('Conversation owner cannot be removed without ownership transfer');
        if (await chatRepo.hasGlobalConversationManagement(data.userId)) {
          throw AppError.conflict('This user has site-wide Conversation access. Change their role grant to revoke access.');
        }
        await chatRepo.removeMember(conversationId, data.userId);
        await appendAudit(request, payload.sub, 'CHAT_MEMBER_REMOVE', 'ChatConversation', conversationId);
        emitChatEvent(fastify, conversationId, 'chat:conversation:updated', {
          conversationId,
          patch: { membersChanged: true, userId: data.userId },
        });
        evictChatUserFromConversation(fastify, conversationId, data.userId);
        emitChatInboxChanged(fastify, [data.userId], conversationId);
        return reply.send({ success: true });
      } catch (error) {
        logger.error(error, 'Remove member error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: string }; Body: typeof updateConversationSchema._type }>(
    apiEndpoints.chat.updateConversation,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload } = await authenticate(request);
        const data = updateConversationSchema.parse(request.body);
        const conversationId = (request.params as any).id;
        const conversation = await getConversationForAccess(conversationId, payload.sub, payload.role);
        assertConversationWritable(conversation);
        if (conversation.type === 'DM') throw AppError.forbidden('DM metadata cannot be updated');
        const canAdmin = await chatRepo.isConversationAdmin(conversationId, payload.sub, payload.role);
        if (!canAdmin) throw AppError.forbidden('Only chat admins can update conversation');

        const metadata = data.settings
          ? mergeConversationMetadataSettings(conversation.metadata, data.settings)
          : conversation.metadata && typeof conversation.metadata === 'object'
          ? (conversation.metadata as Record<string, unknown>)
          : {};
        const patch = {
          title: data.title,
          topic: data.topic,
          purpose: data.purpose,
          invite_policy: data.invite_policy,
          state: data.state,
          metadata,
        };

        const updated = await chatRepo.updateConversation(conversationId, patch);
        if (!updated) throw AppError.notFound('Conversation not found');
        await appendAudit(request, payload.sub, 'CHAT_CONVERSATION_UPDATE', 'ChatConversation', conversationId);
        emitChatEvent(fastify, conversationId, 'chat:conversation:updated', {
          conversationId,
          patch: data,
        });
        return reply.send({ conversation: updated });
      } catch (error) {
        logger.error(error, 'Update conversation error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    apiEndpoints.chat.archiveConversation,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload, ability } = await authenticate(request);
        const conversationId = (request.params as any).id;
        const conversation = await getConversationForAccess(conversationId, payload.sub, payload.role);
        if (conversation.type === 'DM') throw AppError.forbidden('DM cannot be archived');
        if (!ability.can('manage', 'Conversation')) throw AppError.forbidden('Forbidden');
        const updated = await chatRepo.archiveConversation(conversationId);
        await appendAudit(request, payload.sub, 'CHAT_CONVERSATION_ARCHIVE', 'ChatConversation', conversationId);
        emitChatEvent(fastify, conversationId, 'chat:conversation:updated', {
          conversationId,
          patch: { state: 'ARCHIVED' },
        });
        return reply.send({ conversation: updated });
      } catch (error) {
        logger.error(error, 'Archive conversation error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    apiEndpoints.chat.unarchiveConversation,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload, ability } = await authenticate(request);
        const conversationId = (request.params as any).id;
        const conversation = await getConversationForAccess(conversationId, payload.sub, payload.role);
        if (conversation.type === 'DM') throw AppError.forbidden('DM cannot be unarchived');
        if (!ability.can('manage', 'Conversation')) throw AppError.forbidden('Forbidden');
        const updated = await chatRepo.unarchiveConversation(conversationId);
        await appendAudit(request, payload.sub, 'CHAT_CONVERSATION_UNARCHIVE', 'ChatConversation', conversationId);
        emitChatEvent(fastify, conversationId, 'chat:conversation:updated', {
          conversationId,
          patch: { state: 'ACTIVE' },
        });
        return reply.send({ conversation: updated });
      } catch (error) {
        logger.error(error, 'Unarchive conversation error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    apiEndpoints.chat.hardDeleteConversation,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload, ability } = await authenticate(request);
        if (!ability.can('delete', 'Conversation')) throw AppError.forbidden('Forbidden');
        const conversationId = (request.params as any).id;
        const conversation = await chatRepo.getConversationById(conversationId);
        if (!conversation || conversation.state === 'DELETED') {
          throw AppError.notFound('Conversation not found');
        }

        await chatRepo.hardDeleteConversation(conversationId);

        await appendAudit(request, payload.sub, 'CHAT_CONVERSATION_DELETE', 'ChatConversation', conversationId);
        emitChatEvent(fastify, conversationId, 'chat:conversation:updated', {
          conversationId,
          patch: { state: 'DELETED' },
        });
        return reply.send({ success: true, conversationId });
      } catch (error) {
        logger.error(error, 'Hard delete conversation error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: typeof moderationSchema._type }>(
    apiEndpoints.chat.moderateConversation,
    { preHandler: chatAuthPreHandler, schema: { tags: ['Chat'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      try {
        const { payload, ability } = await authenticate(request);
        const data = moderationSchema.parse(request.body);
        const conversationId = (request.params as any).id;
        const conversation = await getConversationForAccess(conversationId, payload.sub, payload.role);
        assertConversationWritable(conversation);

        if (conversation.type === 'DM') throw AppError.forbidden('Moderation is not supported for DM');
        if (!ability.can('manage', 'Conversation')) throw AppError.forbidden('Forbidden');

        const moderation = await chatRepo.applyModerationAction({
          conversationId,
          userId: data.userId,
          action: data.action,
          until: data.until ? new Date(data.until) : undefined,
          reason: data.reason,
        });

        const auditAction =
          data.action === 'MUTE'
            ? 'CHAT_MODERATION_MUTE'
            : data.action === 'BAN'
            ? 'CHAT_MODERATION_BAN'
            : data.action === 'UNMUTE'
            ? 'CHAT_MODERATION_UNMUTE'
            : 'CHAT_MODERATION_UNBAN';

        await appendAudit(request, payload.sub, auditAction, 'ChatConversation', conversationId);
        emitChatEvent(fastify, conversationId, 'chat:conversation:updated', {
          conversationId,
          patch: {
            moderationChanged: true,
            action: data.action,
            userId: data.userId,
          },
        });
        if (data.action === 'BAN') evictChatUserFromConversation(fastify, conversationId, data.userId);
        emitChatInboxChanged(fastify, [data.userId], conversationId);

        return reply.send({ moderation });
      } catch (error) {
        logger.error(error, 'Moderation update error');
        return respondWithError(reply, error);
      }
    }
  );
}
