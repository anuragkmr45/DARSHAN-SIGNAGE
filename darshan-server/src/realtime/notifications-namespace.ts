import { FastifyInstance } from 'fastify';
import { Socket } from 'socket.io';
import { verifyAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';
import { createNotificationCounterRepository } from '@/db/repositories/notification-counter';
import { createLogger } from '@/utils/logger';
import { resolveSocketAuthToken } from '@/realtime/chat-namespace';
import {
  getOrCreateSocketServer,
  getSocketAllowedOrigins,
} from '@/realtime/socket-server';
import {
  buildSafeSocketError,
  consumeSocketRateLimit,
  normalizePayloadAndAck,
  notificationsSyncPayloadSchema,
  SocketEventRateLimiter,
  validateSocketPayload,
  type SocketAck,
} from '@/realtime/socket-hardening';

const logger = createLogger('notifications-namespace');
const NOTIFICATIONS_NAMESPACE = '/notifications';
const notificationsSyncRateLimiter = new SocketEventRateLimiter(30, 1);

function isSessionValidForUser(
  session: { user_id: string; expires_at: Date } | null,
  userId: string
): boolean {
  if (!session) return false;
  if (session.user_id !== userId) return false;
  return session.expires_at.getTime() > Date.now();
}

export function notificationUserRoom(userId: string): string {
  return `notif:user:${userId}`;
}

function respondNotificationSocketError(
  socket: Socket,
  ack: SocketAck | undefined,
  code: 'INVALID_PAYLOAD' | 'PAYLOAD_TOO_LARGE' | 'RATE_LIMITED',
  message: string,
  retryAfterSeconds?: number
) {
  const response = buildSafeSocketError(code, message, retryAfterSeconds);
  if (ack) {
    ack(response);
  } else {
    socket.emit('notifications:error', response);
  }
}

export async function setupNotificationsNamespace(fastify: FastifyInstance) {
  if ((fastify as any)._notificationsNamespaceReady) return;

  const io = getOrCreateSocketServer(fastify);
  const allowlist = getSocketAllowedOrigins();
  const sessionRepo = createSessionRepository();
  const counterRepo = createNotificationCounterRepository();
  const nsp = io.of(NOTIFICATIONS_NAMESPACE);

  nsp.use(async (socket, next) => {
    try {
      const resolved = resolveSocketAuthToken({
        authToken: typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined,
        authorizationHeader:
          typeof socket.handshake.headers.authorization === 'string'
            ? socket.handshake.headers.authorization
            : undefined,
        cookieHeader:
          typeof socket.handshake.headers.cookie === 'string'
            ? socket.handshake.headers.cookie
            : undefined,
        origin:
          typeof socket.handshake.headers.origin === 'string'
            ? socket.handshake.headers.origin
            : undefined,
        allowlist,
      });

      if (!resolved.token) {
        return next(new Error(resolved.error || 'Unauthorized'));
      }

      const payload = await verifyAccessToken(resolved.token);
      const session = await sessionRepo.findByJti(payload.jti);
      if (!isSessionValidForUser(session, payload.sub)) {
        return next(new Error('Token has been revoked'));
      }

      (socket.data as any).user = payload;
      return next();
    } catch (error) {
      logger.warn(error, 'Notification socket auth failed');
      return next(new Error('Unauthorized'));
    }
  });

  nsp.on('connection', async (socket: Socket) => {
    const user = (socket.data as any).user;
    if (!user?.sub) {
      socket.disconnect(true);
      return;
    }

    const room = notificationUserRoom(user.sub);
    socket.join(room);

    socket.on('disconnect', () => {
      notificationsSyncRateLimiter.clear(socket.id);
    });

    socket.on('notifications:sync', async (payloadOrAck: unknown, maybeAck?: SocketAck) => {
      const { payload: rawPayload, ack } = normalizePayloadAndAck(payloadOrAck, maybeAck);
      try {
        const parsed = validateSocketPayload({
          socket,
          namespace: '/notifications',
          event: 'notifications:sync',
          payload: rawPayload,
          schema: notificationsSyncPayloadSchema,
        });
        if (!parsed.ok) {
          respondNotificationSocketError(
            socket,
            ack,
            parsed.reason === 'payload_too_large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_PAYLOAD',
            parsed.reason === 'payload_too_large'
              ? 'notifications:sync payload too large'
              : 'Invalid notifications:sync payload'
          );
          return;
        }

        const rateLimit = consumeSocketRateLimit({
          socket,
          namespace: '/notifications',
          event: 'notifications:sync',
          limiter: notificationsSyncRateLimiter,
        });
        if (!rateLimit.allowed) {
          respondNotificationSocketError(
            socket,
            ack,
            'RATE_LIMITED',
            'notifications:sync rate limit exceeded',
            rateLimit.retryAfterSeconds
          );
          return;
        }

        const unread_total = await counterRepo.getUnreadTotal(user.sub);
        if (ack) {
          ack({ unread_total });
        } else {
          socket.emit('notifications:count', { unread_total });
        }
      } catch (error) {
        logger.warn(error, 'Failed to sync notification count');
      }
    });

    try {
      const unread_total = await counterRepo.getUnreadTotal(user.sub);
      socket.emit('notifications:count', { unread_total });
    } catch (error) {
      logger.warn(error, 'Failed to emit initial notification count');
    }
  });

  (fastify as any)._notificationsNamespaceReady = true;
}

export function emitNotificationCountEvent(
  fastify: FastifyInstance,
  userId: string,
  unread_total: number
) {
  const io = getOrCreateSocketServer(fastify);
  io.of(NOTIFICATIONS_NAMESPACE)
    .to(notificationUserRoom(userId))
    .emit('notifications:count', { unread_total });
}
