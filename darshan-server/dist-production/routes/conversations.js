import { z } from 'zod';
import { extractTokenFromHeader, verifyAccessToken } from '../auth/jwt.js';
import { defineAbilityFor } from '../rbac/index.js';
import { createConversationRepository } from '../db/repositories/conversation.js';
import { createLogger } from '../utils/logger.js';
import { apiEndpoints } from '../config/apiEndpoints.js';
import { HTTP_STATUS } from '../http-status-codes.js';
import { respondWithError } from '../utils/errors.js';
import { AppError } from '../utils/app-error.js';
const logger = createLogger('conversation-routes');
const { CREATED } = HTTP_STATUS;
const startConversationSchema = z.object({
    participant_id: z.string().uuid(),
});
const sendMessageSchema = z.object({
    content: z.string().min(1),
    attachments: z.array(z.any()).optional(),
});
export async function conversationRoutes(fastify) {
    const repo = createConversationRepository();
    fastify.post(apiEndpoints.conversations.start, {
        schema: {
            description: 'Start or get a 1:1 conversation',
            tags: ['Conversations'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token)
                throw AppError.unauthorized('Missing authorization header');
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('read', 'Conversation'))
                throw AppError.forbidden('Forbidden');
            const data = startConversationSchema.parse(request.body);
            const conversation = await repo.getOrCreate(payload.sub, data.participant_id);
            return reply.status(CREATED).send(conversation);
        }
        catch (error) {
            logger.error(error, 'Start conversation error');
            return respondWithError(reply, error);
        }
    });
    fastify.get(apiEndpoints.conversations.list, {
        schema: {
            description: 'List conversations for current user',
            tags: ['Conversations'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token)
                throw AppError.unauthorized('Missing authorization header');
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('read', 'Conversation'))
                throw AppError.forbidden('Forbidden');
            const items = await repo.listForUser(payload.sub);
            return reply.send({ items });
        }
        catch (error) {
            logger.error(error, 'List conversations error');
            return respondWithError(reply, error);
        }
    });
    fastify.get(apiEndpoints.conversations.listMessages, {
        schema: {
            description: 'List messages in a conversation',
            tags: ['Conversations'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token)
                throw AppError.unauthorized('Missing authorization header');
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('read', 'Conversation'))
                throw AppError.forbidden('Forbidden');
            const page = request.query.page ? parseInt(request.query.page) : 1;
            const limit = request.query.limit ? parseInt(request.query.limit) : 50;
            const result = await repo.listMessages(request.params.id, page, limit, payload.sub);
            return reply.send(result);
        }
        catch (error) {
            logger.error(error, 'List messages error');
            return respondWithError(reply, error);
        }
    });
    fastify.post(apiEndpoints.conversations.sendMessage, {
        schema: {
            description: 'Send message in a conversation',
            tags: ['Conversations'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token)
                throw AppError.unauthorized('Missing authorization header');
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('read', 'Conversation'))
                throw AppError.forbidden('Forbidden');
            const data = sendMessageSchema.parse(request.body);
            const message = await repo.addMessage(request.params.id, payload.sub, data.content, data.attachments);
            return reply.status(CREATED).send(message);
        }
        catch (error) {
            logger.error(error, 'Send message error');
            return respondWithError(reply, error);
        }
    });
    fastify.post(apiEndpoints.conversations.markRead, {
        schema: {
            description: 'Mark conversation as read',
            tags: ['Conversations'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token)
                throw AppError.unauthorized('Missing authorization header');
            const payload = await verifyAccessToken(token);
            const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
            if (!ability.can('read', 'Conversation'))
                throw AppError.forbidden('Forbidden');
            const record = await repo.markRead(request.params.id, payload.sub);
            return reply.send(record);
        }
        catch (error) {
            logger.error(error, 'Read conversation error');
            return respondWithError(reply, error);
        }
    });
}
