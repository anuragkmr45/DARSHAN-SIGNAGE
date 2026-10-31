import { FastifyInstance } from 'fastify';
import { Socket } from 'socket.io';
import { verifyAccessToken, type JWTPayload } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';
import { getDatabase, schema } from '@/db';
import { createLogger } from '@/utils/logger';
import {
  recordRealtimeSocketAuth,
  recordRealtimeSocketClientEvent,
  recordRealtimeSocketReject,
  recordRealtimeSocketServerEvent,
} from '@/observability/metrics';
import {
  buildScreenPlaybackStateById,
  buildScreensOverviewPayload,
} from '@/screens/playback';
import { classifySocketAuthRejectReason, resolveSocketAuthToken } from '@/realtime/chat-namespace';
import {
  attachNamespaceSocketObservability,
  authenticatedUserRoom,
  getOrCreateSocketServer,
  getSocketAllowedOrigins,
  getSocketServer,
  emitToCurrentSockets,
  withCurrentSocketSessionLock,
} from '@/realtime/socket-server';
import {
  buildSafeSocketError,
  consumeSocketRateLimit,
  normalizePayloadAndAck,
  screensSubscribePayloadSchema,
  screensSyncPayloadSchema,
  SocketEventRateLimiter,
  validateSocketPayload,
  type SocketAck,
} from '@/realtime/socket-hardening';
import { defineAbilityFor, type AppAbility } from '@/rbac';
import { inArray } from 'drizzle-orm';
import { requireCurrentSocketSession, storeSocketSession } from '@/realtime/socket-session';
import {
  canObserveScreen,
  observableScreenGroupIds,
} from '@/rbac/screen-access';

const logger = createLogger('screens-namespace');
const SCREENS_NAMESPACE = '/screens';
const screensSubscribeRateLimiter = new SocketEventRateLimiter(20, 1);
const screensSyncRateLimiter = new SocketEventRateLimiter(30, 1);
type ScreenRecord = typeof schema.screens.$inferSelect;
type ScreenSocketAuthz = {
  allowedRows: ScreenRecord[];
  allowedIds: Set<string>;
  allowedGroupIds: string[];
  hasUnconditionalScreenRead: boolean;
  hasScreenReadDeny: boolean;
  rowCount: number;
};

function isSessionValidForUser(
  session: { user_id: string; expires_at: Date } | null,
  userId: string
): boolean {
  if (!session) return false;
  if (session.user_id !== userId) return false;
  return session.expires_at.getTime() > Date.now();
}

export function screensAllRoom(): string {
  return 'screens:all';
}

export function screenRoom(screenId: string): string {
  return `screens:${screenId}`;
}

function getSocketUser(socket: Socket): JWTPayload {
  return (socket.data as any).user as JWTPayload;
}

function ruleValueIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}

function hasUnconditionalScreenRead(ability: AppAbility): boolean {
  const rules = ((ability as any).rules || []) as Array<{
    action?: string | string[];
    subject?: string | string[];
    conditions?: unknown;
    inverted?: boolean;
  }>;

  return rules.some((rule) => {
    if (rule.inverted || rule.conditions) return false;
    const actionMatches =
      ruleValueIncludes(rule.action, 'read') ||
      ruleValueIncludes(rule.action, 'update') ||
      ruleValueIncludes(rule.action, 'manage');
    const subjectMatches = ruleValueIncludes(rule.subject, 'Screen') || ruleValueIncludes(rule.subject, 'all');
    return actionMatches && subjectMatches;
  });
}

function hasRelevantScreenReadDeny(ability: AppAbility): boolean {
  const rules = ((ability as any).rules || []) as Array<{
    action?: string | string[];
    subject?: string | string[];
    inverted?: boolean;
  }>;

  return rules.some((rule) => {
    if (!rule.inverted) return false;
    const actionMatches =
      ruleValueIncludes(rule.action, 'read') ||
      ruleValueIncludes(rule.action, 'update') ||
      ruleValueIncludes(rule.action, 'manage');
    const subjectMatches = ruleValueIncludes(rule.subject, 'Screen') || ruleValueIncludes(rule.subject, 'all');
    return actionMatches && subjectMatches;
  });
}

function canUseGlobalScreenRoom(authz: ScreenSocketAuthz): boolean {
  return authz.hasUnconditionalScreenRead && !authz.hasScreenReadDeny && authz.allowedRows.length === authz.rowCount;
}

async function resolveScreenSocketAuthz(
  socket: Socket,
  options: { screenIds?: string[] } = {}
): Promise<ScreenSocketAuthz> {
  const db = getDatabase();
  const user = getSocketUser(socket);
  const ability = await defineAbilityFor(user.role_id, user.sub, user.department_id);
  const rows =
    options.screenIds && options.screenIds.length > 0
      ? await db.select().from(schema.screens).where(inArray(schema.screens.id, options.screenIds as any))
      : await db.select().from(schema.screens);
  const [allowedRows, groupRows] = await Promise.all([
    Promise.resolve(rows.filter((screen) => canObserveScreen(ability, screen))),
    db.select().from(schema.screenGroups),
  ]);

  return {
    allowedRows,
    allowedIds: new Set(allowedRows.map((screen) => screen.id)),
    allowedGroupIds: observableScreenGroupIds(ability, groupRows),
    hasUnconditionalScreenRead: hasUnconditionalScreenRead(ability),
    hasScreenReadDeny: hasRelevantScreenReadDeny(ability),
    rowCount: rows.length,
  };
}

function logScreenSocketReject(
  socket: Socket,
  event: 'screens:subscribe' | 'screens:sync',
  details: { requestedCount: number; rejectedCount: number; reason: string }
) {
  if (details.rejectedCount <= 0) return;
  recordRealtimeSocketReject(SCREENS_NAMESPACE, event, 'unauthorized');
  logger.warn(
    {
      event,
      reason: details.reason,
      socket_id: socket.id,
      requested_count: details.requestedCount,
      rejected_count: details.rejectedCount,
    },
    'Screens realtime authorization rejected screen request'
  );
}

function respondScreenSocketError(
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
    recordRealtimeSocketServerEvent(SCREENS_NAMESPACE, 'screens:error');
    socket.emit('screens:error', response);
  }
}

export async function setupScreensNamespace(fastify: FastifyInstance) {
  if ((fastify as any)._screensNamespaceReady) return;

  const io = getOrCreateSocketServer(fastify);
  const allowlist = getSocketAllowedOrigins();
  const sessionRepo = createSessionRepository();
  const db = getDatabase();
  const nsp = io.of(SCREENS_NAMESPACE);
  attachNamespaceSocketObservability(nsp, SCREENS_NAMESPACE);

  nsp.use(async (socket, next) => {
    try {
      const resolved = resolveSocketAuthToken({
        authToken: typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined,
        authorizationHeader:
          typeof socket.handshake.headers.authorization === 'string'
            ? socket.handshake.headers.authorization
            : undefined,
        cookieHeader:
          typeof socket.handshake.headers.cookie === 'string' ? socket.handshake.headers.cookie : undefined,
        origin:
          typeof socket.handshake.headers.origin === 'string' ? socket.handshake.headers.origin : undefined,
        allowlist,
      });

      if (!resolved.token) {
        const reason = classifySocketAuthRejectReason(resolved.error);
        recordRealtimeSocketAuth(SCREENS_NAMESPACE, 'failure', reason);
        logger.warn({ namespace: SCREENS_NAMESPACE, reason }, 'Screen socket auth failed');
        return next(new Error(resolved.error || 'Unauthorized'));
      }

      const payload = await verifyAccessToken(resolved.token);
      const session = await sessionRepo.findByJti(payload.jti);
      if (!isSessionValidForUser(session, payload.sub)) {
        recordRealtimeSocketAuth(SCREENS_NAMESPACE, 'failure', 'token_revoked');
        logger.warn({ namespace: SCREENS_NAMESPACE, reason: 'token_revoked' }, 'Screen socket auth failed');
        return next(new Error('Token has been revoked'));
      }

      storeSocketSession(socket, resolved.token, payload);
      recordRealtimeSocketAuth(SCREENS_NAMESPACE, 'success', 'authorized');
      return next();
    } catch (error) {
      recordRealtimeSocketAuth(SCREENS_NAMESPACE, 'failure', 'invalid_token');
      logger.warn({ namespace: SCREENS_NAMESPACE, reason: 'invalid_token' }, 'Screen socket auth failed');
      return next(new Error('Unauthorized'));
    }
  });

  nsp.on('connection', (socket: Socket) => {
    const user = (socket.data as any).user;
    if (!user?.sub) {
      socket.disconnect(true);
      return;
    }
    socket.join(authenticatedUserRoom(user.sub));
    socket.on('disconnect', () => {
      screensSubscribeRateLimiter.clear(socket.id);
      screensSyncRateLimiter.clear(socket.id);
    });

    socket.on('screens:subscribe', async (payloadOrAck: unknown, maybeAck?: SocketAck) => {
      recordRealtimeSocketClientEvent(SCREENS_NAMESPACE, 'screens:subscribe');
      const { payload: rawPayload, ack } = normalizePayloadAndAck(payloadOrAck, maybeAck);
      try {
        await requireCurrentSocketSession(socket);
        const parsed = validateSocketPayload({
          socket,
          namespace: '/screens',
          event: 'screens:subscribe',
          payload: rawPayload,
          schema: screensSubscribePayloadSchema,
        });
        if (!parsed.ok) {
          respondScreenSocketError(
            socket,
            ack,
            parsed.reason === 'payload_too_large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_PAYLOAD',
            parsed.reason === 'payload_too_large'
              ? 'screens:subscribe payload too large'
              : 'Invalid screens:subscribe payload'
          );
          return;
        }

        const rateLimit = consumeSocketRateLimit({
          socket,
          namespace: '/screens',
          event: 'screens:subscribe',
          limiter: screensSubscribeRateLimiter,
        });
        if (!rateLimit.allowed) {
          respondScreenSocketError(
            socket,
            ack,
            'RATE_LIMITED',
            'screens:subscribe rate limit exceeded',
            rateLimit.retryAfterSeconds
          );
          return;
        }

        const payload = parsed.data;
        const ids = Array.isArray(payload.screenIds)
          ? Array.from(new Set(payload.screenIds.filter((value) => typeof value === 'string' && value)))
          : [];
        const subscribed = new Set<string>();
        const rejected: string[] = [];
        const includeAll = payload.includeAll === true;

        if (includeAll) {
          const authz = await resolveScreenSocketAuthz(socket);
          for (const screen of authz.allowedRows) {
            socket.join(screenRoom(screen.id));
            subscribed.add(screen.id);
          }
          if (canUseGlobalScreenRoom(authz)) {
            socket.join(screensAllRoom());
          }
        }

        if (ids.length > 0) {
          const rows = await db
            .select()
            .from(schema.screens)
            .where(inArray(schema.screens.id, ids as any));
          const existing = new Set(rows.map((screen) => screen.id));
          const authz = await resolveScreenSocketAuthz(socket, { screenIds: ids });

          for (const id of ids) {
            if (!existing.has(id) || !authz.allowedIds.has(id)) {
              rejected.push(id);
              continue;
            }
            socket.join(screenRoom(id));
            subscribed.add(id);
          }
        }

        logScreenSocketReject(socket, 'screens:subscribe', {
          requestedCount: ids.length,
          rejectedCount: rejected.length,
          reason: 'screen_read_not_allowed_or_missing',
        });

        if (ack) {
          ack({
            subscribed_all: includeAll,
            subscribed: Array.from(subscribed),
            rejected,
          });
        }
      } catch (error) {
        logger.warn({ err: error, socket_id: socket.id }, 'Failed to subscribe screens socket');
        respondScreenSocketError(socket, ack, 'INVALID_PAYLOAD', 'Invalid screens:subscribe payload');
      }
    });

    socket.on('screens:sync', async (payloadOrAck: unknown, maybeAck?: SocketAck) => {
      recordRealtimeSocketClientEvent(SCREENS_NAMESPACE, 'screens:sync');
      const { payload: rawPayload, ack } = normalizePayloadAndAck(payloadOrAck, maybeAck);
      try {
        await requireCurrentSocketSession(socket);
        const parsed = validateSocketPayload({
          socket,
          namespace: '/screens',
          event: 'screens:sync',
          payload: rawPayload,
          schema: screensSyncPayloadSchema,
        });
        if (!parsed.ok) {
          respondScreenSocketError(
            socket,
            ack,
            parsed.reason === 'payload_too_large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_PAYLOAD',
            parsed.reason === 'payload_too_large' ? 'screens:sync payload too large' : 'Invalid screens:sync payload'
          );
          return;
        }

        const rateLimit = consumeSocketRateLimit({
          socket,
          namespace: '/screens',
          event: 'screens:sync',
          limiter: screensSyncRateLimiter,
        });
        if (!rateLimit.allowed) {
          respondScreenSocketError(
            socket,
            ack,
            'RATE_LIMITED',
            'screens:sync rate limit exceeded',
            rateLimit.retryAfterSeconds
          );
          return;
        }

        const payload = parsed.data ?? undefined;
        const ids = Array.isArray(payload?.screenIds)
          ? Array.from(new Set(payload.screenIds.filter((value) => typeof value === 'string' && value)))
          : [];

        const authz = await resolveScreenSocketAuthz(socket, ids.length > 0 ? { screenIds: ids } : {});
        if (ids.length > 0) {
          logScreenSocketReject(socket, 'screens:sync', {
            requestedCount: ids.length,
            rejectedCount: ids.filter((id) => !authz.allowedIds.has(id)).length,
            reason: 'screen_read_not_allowed_or_missing',
          });
        }

        if (ids.length === 0) {
          const overview = await buildScreensOverviewPayload({
            db,
            screenIds: authz.allowedRows.map((screen) => screen.id),
            groupIds: authz.allowedGroupIds,
          });
          await withCurrentSocketSessionLock(socket, () => {
            if (ack) ack(overview);
            else {
              recordRealtimeSocketServerEvent(SCREENS_NAMESPACE, 'screens:sync');
              socket.emit('screens:sync', overview);
            }
          });
          return;
        }

        const screens = (
          await Promise.all(
            ids
              .filter((id) => authz.allowedIds.has(id))
              .map((screenId) => buildScreenPlaybackStateById(screenId, { db }))
          )
        ).filter(Boolean);

        const result = {
          server_time: new Date().toISOString(),
          screens,
        };

        await withCurrentSocketSessionLock(socket, () => {
          if (ack) ack(result);
          else {
            recordRealtimeSocketServerEvent(SCREENS_NAMESPACE, 'screens:sync');
            socket.emit('screens:sync', result);
          }
        });
      } catch (error) {
        logger.warn(error, 'Failed to sync screens state');
        if (ack) {
          ack({
            server_time: new Date().toISOString(),
            screens: [],
          });
        }
      }
    });
  });

  (fastify as any)._screensNamespaceReady = true;
}

function emitScreenState(io: ReturnType<typeof getOrCreateSocketServer>, screen: Record<string, unknown> & { id: string }) {
  void emitToCurrentSockets(io.of(SCREENS_NAMESPACE), [screensAllRoom(), screenRoom(screen.id)],
    'screens:state:update', {
      server_time: new Date().toISOString(),
      screen,
    });
  recordRealtimeSocketServerEvent(SCREENS_NAMESPACE, 'screens:state:update');
}

export function emitScreenStateUpdate(
  fastify: FastifyInstance,
  screen: Record<string, unknown> & { id: string }
) {
  const io = getOrCreateSocketServer(fastify);
  emitScreenState(io, screen);
}

export function emitScreenStateUpdateGlobal(screen: Record<string, unknown> & { id: string }) {
  const io = getSocketServer();
  if (!io) {
    return false;
  }

  emitScreenState(io, screen);
  return true;
}

function emitScreenPreview(io: ReturnType<typeof getOrCreateSocketServer>, payload: {
  screenId: string;
  captured_at: string;
  screenshot_url: string | null;
  stale: boolean;
  storage_object_id?: string | null;
}) {
  void emitToCurrentSockets(io.of(SCREENS_NAMESPACE), [screensAllRoom(), screenRoom(payload.screenId)],
    'screens:preview:update', payload);
  recordRealtimeSocketServerEvent(SCREENS_NAMESPACE, 'screens:preview:update');
}

export function emitScreenPreviewUpdate(
  fastify: FastifyInstance,
  payload: {
    screenId: string;
    captured_at: string;
    screenshot_url: string | null;
    stale: boolean;
    storage_object_id?: string | null;
  }
) {
  const io = getOrCreateSocketServer(fastify);
  emitScreenPreview(io, payload);
}

export function emitScreenPreviewUpdateGlobal(payload: {
  screenId: string;
  captured_at: string;
  screenshot_url: string | null;
  stale: boolean;
  storage_object_id?: string | null;
}) {
  const io = getSocketServer();
  if (!io) {
    return false;
  }

  emitScreenPreview(io, payload);
  return true;
}

export function emitScreensRefreshRequired(
  fastify: FastifyInstance,
  payload: {
    reason: 'PUBLISH' | 'EMERGENCY' | 'GROUP_MEMBERSHIP' | 'TAKE_DOWN' | 'DEFAULT_MEDIA' | 'DISPLAY_SELECTION';
    screen_ids?: string[];
    group_ids?: string[];
    target_all?: boolean;
    transition_version?: string;
  }
) {
  const io = getOrCreateSocketServer(fastify);
  void emitToCurrentSockets(io.of(SCREENS_NAMESPACE),
    [screensAllRoom(), ...(payload.screen_ids || []).map(screenRoom)], 'screens:refresh:required', {
    reason: payload.reason,
    screen_ids: payload.screen_ids || [],
    group_ids: payload.group_ids || [],
    target_all: payload.target_all === true,
    transition_version: payload.transition_version ?? null,
  });
  recordRealtimeSocketServerEvent(SCREENS_NAMESPACE, 'screens:refresh:required');
}

/**
 * Notification only: Schedule Queue must re-read its REST data. No request,
 * screen, or user details are sent over the socket, avoiding a second source
 * of truth and avoiding cross-department data disclosure.
 */
export function emitScheduleRequestsChanged(fastify: FastifyInstance) {
  const io = getOrCreateSocketServer(fastify);
  void emitToCurrentSockets(io.of(SCREENS_NAMESPACE), [screensAllRoom()], 'schedule-requests:changed');
  recordRealtimeSocketServerEvent(SCREENS_NAMESPACE, 'schedule-requests:changed');
}
