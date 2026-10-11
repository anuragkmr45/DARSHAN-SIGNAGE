import { z } from 'zod';
import { createNotificationRepository } from '../db/repositories/notification.js';
import { createNotificationCounterRepository } from '../db/repositories/notification-counter.js';
import { chatAuthPreHandler, getRequestAuthContext } from '../auth/request-auth.js';
import { createLogger } from '../utils/logger.js';
import { apiEndpoints } from '../config/apiEndpoints.js';
import { HTTP_STATUS } from '../http-status-codes.js';
import { respondWithError } from '../utils/errors.js';
import { AppError } from '../utils/app-error.js';
import { emitNotificationCountEvent, setupNotificationsNamespace, } from '../realtime/notifications-namespace.js';
const logger = createLogger('notification-routes');
const { NO_CONTENT } = HTTP_STATUS;
const listNotificationsQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    read: z.enum(['true', 'false']).optional(),
});
function authenticate(request) {
    return getRequestAuthContext(request);
}
export async function notificationRoutes(fastify) {
    await setupNotificationsNamespace(fastify);
    const notifRepo = createNotificationRepository();
    const counterRepo = createNotificationCounterRepository();
    // List notifications for current user
    fastify.get(apiEndpoints.notifications.list, {
        preHandler: chatAuthPreHandler,
        schema: {
            description: 'List notifications for current user',
            tags: ['Notifications'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const { payload } = await authenticate(request);
            const query = listNotificationsQuerySchema.parse(request.query);
            const result = await notifRepo.listByUser(payload.sub, {
                page: query.page,
                limit: query.limit,
                read: query.read === 'true' ? true : query.read === 'false' ? false : undefined,
            });
            return reply.send({
                items: result.items.map((n) => ({
                    id: n.id,
                    title: n.title,
                    message: n.message,
                    type: n.type ?? null,
                    data: n.data ?? null,
                    read: n.is_read,
                    read_at: null,
                    created_at: n.created_at.toISOString(),
                })),
                pagination: {
                    page: result.page,
                    limit: result.limit,
                    total: result.total,
                    unread_total: result.unread_total ?? undefined,
                },
            });
        }
        catch (error) {
            logger.error(error, 'List notifications error');
            return respondWithError(reply, error);
        }
    });
    fastify.get(apiEndpoints.notifications.unreadCount, {
        preHandler: chatAuthPreHandler,
        schema: {
            description: 'Unread notification count for current user',
            tags: ['Notifications'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const { payload } = await authenticate(request);
            const unread_total = await counterRepo.getUnreadTotal(payload.sub);
            reply.header('Cache-Control', 'no-store');
            return reply.send({ unread_total });
        }
        catch (error) {
            logger.error(error, 'Get unread notification count error');
            return respondWithError(reply, error);
        }
    });
    // Get notification by ID
    fastify.get(apiEndpoints.notifications.get, {
        preHandler: chatAuthPreHandler,
        schema: {
            description: 'Get notification by ID',
            tags: ['Notifications'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const { payload } = await authenticate(request);
            const notification = await notifRepo.findById(request.params.id);
            if (!notification) {
                throw AppError.notFound('Notification not found');
            }
            // Check ownership
            if (notification.user_id !== payload.sub) {
                throw AppError.forbidden('Forbidden');
            }
            return reply.send({
                id: notification.id,
                title: notification.title,
                message: notification.message,
                type: notification.type ?? null,
                data: notification.data ?? null,
                read: notification.is_read,
                read_at: null,
                created_at: notification.created_at.toISOString(),
            });
        }
        catch (error) {
            logger.error(error, 'Get notification error');
            return respondWithError(reply, error);
        }
    });
    // Mark notification as read
    fastify.post(apiEndpoints.notifications.markRead, {
        preHandler: chatAuthPreHandler,
        schema: {
            description: 'Mark notification as read',
            tags: ['Notifications'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const { payload } = await authenticate(request);
            const notification = await notifRepo.findById(request.params.id);
            if (!notification) {
                throw AppError.notFound('Notification not found');
            }
            // Check ownership
            if (notification.user_id !== payload.sub) {
                throw AppError.forbidden('Forbidden');
            }
            const { notification: updated, changed } = await notifRepo.markAsReadIfUnread(request.params.id);
            if (!updated) {
                throw AppError.notFound('Notification not found');
            }
            if (changed) {
                const unread_total = await counterRepo.decrement(payload.sub, 1);
                emitNotificationCountEvent(fastify, payload.sub, unread_total);
            }
            return reply.send({
                id: updated.id,
                title: updated.title,
                message: updated.message,
                type: updated.type ?? null,
                data: updated.data ?? null,
                read: updated.is_read,
                read_at: null,
                created_at: updated.created_at.toISOString(),
            });
        }
        catch (error) {
            logger.error(error, 'Mark notification as read error');
            return respondWithError(reply, error);
        }
    });
    // Mark all notifications as read
    fastify.post(apiEndpoints.notifications.markAllRead, {
        preHandler: chatAuthPreHandler,
        schema: {
            description: 'Mark all notifications as read',
            tags: ['Notifications'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const { payload } = await authenticate(request);
            await notifRepo.markAllAsRead(payload.sub);
            await counterRepo.set(payload.sub, 0);
            emitNotificationCountEvent(fastify, payload.sub, 0);
            return reply.send({ success: true });
        }
        catch (error) {
            logger.error(error, 'Mark all notifications as read error');
            return respondWithError(reply, error);
        }
    });
    // Delete notification
    fastify.delete(apiEndpoints.notifications.delete, {
        preHandler: chatAuthPreHandler,
        schema: {
            description: 'Delete notification',
            tags: ['Notifications'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const { payload } = await authenticate(request);
            const notification = await notifRepo.findById(request.params.id);
            if (!notification) {
                throw AppError.notFound('Notification not found');
            }
            // Check ownership
            if (notification.user_id !== payload.sub) {
                throw AppError.forbidden('Forbidden');
            }
            const deleted = await notifRepo.delete(request.params.id);
            if (deleted?.is_read === false) {
                const unread_total = await counterRepo.decrement(payload.sub, 1);
                emitNotificationCountEvent(fastify, payload.sub, unread_total);
            }
            return reply.status(NO_CONTENT).send();
        }
        catch (error) {
            logger.error(error, 'Delete notification error');
            return respondWithError(reply, error);
        }
    });
}
