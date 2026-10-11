import Fastify from 'fastify';
import { randomUUID } from 'crypto';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyCookie from '@fastify/cookie';
import { config as appConfig } from '../config/index.js';
import { apiEndpoints } from '../config/apiEndpoints.js';
import { authRoutes } from '../routes/auth.js';
import { userRoutes } from '../routes/users.js';
import { mediaRoutes } from '../routes/media.js';
import { scheduleRoutes } from '../routes/schedules.js';
import { screenRoutes } from '../routes/screens.js';
import { departmentRoutes } from '../routes/departments.js';
import { auditLogRoutes } from '../routes/audit-logs.js';
import { requestRoutes } from '../routes/requests.js';
import { emergencyRoutes } from '../routes/emergency.js';
import { notificationRoutes } from '../routes/notifications.js';
import { presentationRoutes } from '../routes/presentations.js';
import { devicePairingRoutes } from '../routes/device-pairing.js';
import { deviceTelemetryRoutes } from '../routes/device-telemetry.js';
import { apiKeyRoutes } from '../routes/api-keys.js';
import { webhookRoutes } from '../routes/webhooks.js';
import { ssoConfigRoutes } from '../routes/sso-config.js';
import { settingsRoutes } from '../routes/settings.js';
import { conversationRoutes } from '../routes/conversations.js';
import { proofOfPlayRoutes } from '../routes/proof-of-play.js';
import { metricsRoutes } from '../routes/metrics.js';
import { reportsRoutes } from '../routes/reports.js';
import { userInviteRoutes } from '../routes/users-invite.js';
import { userActivateRoutes } from '../routes/users-activate.js';
import { layoutRoutes } from '../routes/layouts.js';
import { screenGroupRoutes } from '../routes/screen-groups.js';
import { scheduleRequestRoutes } from '../routes/schedule-requests.js';
import { scheduleReservationRoutes } from '../routes/schedule-reservations.js';
import { roleRoutes } from '../routes/roles.js';
import { permissionRoutes } from '../routes/permissions.js';
import { observabilityRoutes } from '../routes/observability.js';
import { chatRoutes } from '../routes/chat.js';
import { securityEventRoutes } from '../routes/security-events.js';
import csrfProtectionPlugin from '../middleware/csrf.js';
import { formatErrorResponse } from '../utils/app-error.js';
import { toAppError } from '../utils/errors.js';
import { AppError } from '../utils/app-error.js';
import { syncSystemRolePermissions } from '../rbac/system-roles.js';
import { createSessionRepository } from '../db/repositories/session.js';
import { extractTokenFromHeader, refreshAccessToken, verifyAccessToken } from '../auth/jwt.js';
import { getIdleTimeoutSeconds, getRuntimeLogLevelSetting, preloadSettingsCache, } from '../utils/settings.js';
import { setRuntimeLogLevel } from '../utils/logger.js';
import { getHttpAllowedOrigins, isAllowedOrigin } from '../realtime/socket-server.js';
import { setupDeviceRealtimeGateway } from '../realtime/device-gateway.js';
import { startOutboxDispatcher, stopOutboxDispatcher } from '../services/outbox-dispatcher.js';
import { registerObservabilityHttp } from '../observability/http.js';
import { ensureObservabilityInitialized } from '../observability/metrics.js';
import { loadServerTlsOptions } from './tls.js';
import { collectReadiness } from '../runtime/readiness.js';
const REFRESHED_AUTH_KEY = Symbol.for('darshan.refreshedAuth');
const DEVICE_SCREENSHOT_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
function getAccessTokenFromCookie(request) {
    const cookieToken = request.cookies?.access_token;
    if (typeof cookieToken !== 'string')
        return null;
    const trimmed = cookieToken.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function hydrateAuthorizationHeaderFromCookie(request) {
    if (request.headers.authorization)
        return;
    const cookieToken = getAccessTokenFromCookie(request);
    if (!cookieToken)
        return;
    request.headers.authorization = `Bearer ${cookieToken}`;
}
async function refreshSessionFromRequestToken(request) {
    if (request[REFRESHED_AUTH_KEY]) {
        return;
    }
    if (hasObservabilityMetricsBearerAccess(request)) {
        return;
    }
    const token = extractTokenFromHeader(request.headers.authorization);
    if (!token)
        return;
    const payload = await verifyAccessToken(token);
    const sessionRepo = createSessionRepository();
    const session = await sessionRepo.findByJti(payload.jti);
    if (!session || session.user_id !== payload.sub || session.expires_at.getTime() <= Date.now()) {
        throw AppError.unauthorized('Token has been revoked');
    }
    const expiresInSeconds = getIdleTimeoutSeconds();
    const refreshed = await refreshAccessToken(payload, expiresInSeconds);
    await sessionRepo.extendByJti(payload.jti, refreshed.expiresAt);
    request[REFRESHED_AUTH_KEY] = {
        token: refreshed.token,
        expiresAt: refreshed.expiresAt,
    };
}
function hasObservabilityMetricsBearerAccess(request) {
    const configuredToken = appConfig.OBSERVABILITY_METRICS_BEARER_TOKEN;
    if (!configuredToken) {
        return false;
    }
    const requestPath = request.url.split('?')[0];
    if (requestPath !== '/metrics') {
        return false;
    }
    const header = request.headers.authorization;
    if (!header) {
        return false;
    }
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' && token === configuredToken;
}
function applyCorsHeadersForError(request, reply) {
    const originHeader = request.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (!origin)
        return;
    const allowedOrigins = getHttpAllowedOrigins();
    if (allowedOrigins.length === 0 || !isAllowedOrigin(origin, allowedOrigins))
        return;
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Credentials', 'true');
    const varyHeader = reply.getHeader('vary');
    const varyValue = Array.isArray(varyHeader) ? varyHeader.join(', ') : String(varyHeader ?? '');
    const varyParts = varyValue
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    if (!varyParts.some((part) => part.toLowerCase() === 'origin')) {
        reply.header('Vary', [...varyParts, 'Origin'].join(', '));
    }
}
function redactValue(value) {
    if (typeof value !== 'string')
        return undefined;
    if (value.length <= 8)
        return '[redacted]';
    return `${value.slice(0, 3)}...${value.slice(-3)}`;
}
function summarizeRequestBody(body) {
    if (body === null || body === undefined)
        return { type: 'empty' };
    if (Array.isArray(body))
        return { type: 'array', length: body.length };
    if (typeof body !== 'object')
        return { type: typeof body };
    const obj = body;
    const summary = { type: 'object', keys: Object.keys(obj) };
    if (typeof obj.csr === 'string') {
        summary.csr = {
            length: obj.csr.length,
            prefix: obj.csr.slice(0, 32),
        };
    }
    if ('pairing_code' in obj) {
        summary.pairing_code = redactValue(obj.pairing_code);
    }
    if ('pairingCode' in obj) {
        summary.pairingCode = redactValue(obj.pairingCode);
    }
    return summary;
}
function sanitizeErrorMessage(message) {
    if (!message)
        return '';
    let safe = message;
    safe = safe.replace(/([A-Za-z]:)?[\\/][^\\s'"]+/g, '<path>');
    safe = safe.replace(/(password|secret|token)=\\S+/gi, '$1=<redacted>');
    safe = safe.slice(0, 220);
    return safe;
}
export async function createServer(options = {}) {
    const tlsOptions = loadServerTlsOptions({
        enabled: appConfig.SERVER_TLS_ENABLED,
        certificatePath: appConfig.TLS_CERT_PATH,
        privateKeyPath: appConfig.TLS_KEY_PATH,
    });
    await syncSystemRolePermissions();
    await preloadSettingsCache();
    setRuntimeLogLevel(getRuntimeLogLevelSetting());
    ensureObservabilityInitialized();
    const fastify = Fastify({
        ...(tlsOptions ? { https: tlsOptions } : {}),
        logger: {
            level: getRuntimeLogLevelSetting(),
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                },
            },
        },
        genReqId: (req) => {
            const header = req.headers['x-request-id'];
            if (Array.isArray(header) && header[0])
                return header[0];
            if (typeof header === 'string' && header.length > 0)
                return header;
            return randomUUID();
        },
    });
    fastify.addHook('onRequest', (request, reply, done) => {
        reply.header('x-request-id', request.id);
        done();
    });
    await registerObservabilityHttp(fastify);
    fastify.addHook('onRequest', async (request) => {
        await refreshSessionFromRequestToken(request);
    });
    fastify.addHook('onSend', async (request, reply, payload) => {
        const refreshed = request[REFRESHED_AUTH_KEY];
        if (!refreshed)
            return payload;
        const secure = appConfig.AUTH_COOKIE_SECURE;
        const maxAge = Math.max(Math.floor((refreshed.expiresAt.getTime() - Date.now()) / 1000), 0);
        const accessCookie = [
            `access_token=${refreshed.token}`,
            'Path=/',
            'HttpOnly',
            'SameSite=Lax',
            `Max-Age=${maxAge}`,
            secure ? 'Secure' : '',
        ]
            .filter(Boolean)
            .join('; ');
        reply.header('x-access-token', refreshed.token);
        reply.header('x-access-token-expires-at', refreshed.expiresAt.toISOString());
        reply.header('Set-Cookie', accessCookie);
        return payload;
    });
    fastify.setErrorHandler((error, request, reply) => {
        const isBodyTooLarge = typeof error === 'object' &&
            error !== null &&
            error.code === 'FST_ERR_CTP_BODY_TOO_LARGE';
        const requestPath = request.url.split('?')[0];
        const appError = isBodyTooLarge
            ? requestPath === apiEndpoints.deviceTelemetry.screenshot
                ? AppError.badRequest('Screenshot payload too large for device upload.', {
                    route: apiEndpoints.deviceTelemetry.screenshot,
                    limit_bytes: DEVICE_SCREENSHOT_BODY_LIMIT_BYTES,
                })
                : AppError.badRequest('Request payload too large.')
            : toAppError(error);
        const statusCode = appError.statusCode;
        const logPayload = {
            err: error,
            traceId: request.id,
            method: request.method,
            url: request.url,
            statusCode,
        };
        if (appConfig.NODE_ENV === 'development') {
            logPayload.body = summarizeRequestBody(request.body);
        }
        request.log.error(logPayload, 'Request failed');
        if (error && typeof error === 'object' && 'code' in error) {
            const errCode = error.code;
            const constraint = error.constraint;
            request.log.warn({ code: errCode, constraint }, 'Database or runtime error code detected');
        }
        if (appError.code === 'CA_CERT_MISSING') {
            request.log.warn({ path: appConfig.CA_CERT_PATH }, 'CA certificate missing');
        }
        if (appError.code === 'CA_KEY_MISSING') {
            request.log.warn({ path: appConfig.CA_KEY_PATH }, 'CA private key missing');
        }
        let clientError = appError;
        if (appConfig.NODE_ENV === 'development' && appError.code === 'INTERNAL_ERROR') {
            const message = error instanceof Error ? sanitizeErrorMessage(error.message) : '';
            if (message) {
                clientError = AppError.internal(`Internal error: ${message}`);
            }
        }
        applyCorsHeadersForError(request, reply);
        reply.status(clientError.statusCode).send(formatErrorResponse(clientError, request.id));
    });
    fastify.setNotFoundHandler(() => {
        throw AppError.notFound('Route not found');
    });
    // Security middleware
    await fastify.register(helmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", 'data:', 'https:'],
            },
        },
        frameguard: { action: 'deny' },
        referrerPolicy: { policy: 'no-referrer' },
        crossOriginResourcePolicy: { policy: 'same-site' },
    });
    const allowedOrigins = getHttpAllowedOrigins();
    // Register CORS before auth hooks so browser clients can read auth failures.
    await fastify.register(cors, {
        origin: (origin, cb) => {
            if (!origin)
                return cb(null, true);
            if (allowedOrigins.length === 0)
                return cb(new Error('CORS origin not allowed'), false);
            if (isAllowedOrigin(origin, allowedOrigins))
                return cb(null, true);
            return cb(new Error('CORS origin not allowed'), false);
        },
        credentials: true,
    });
    await fastify.register(fastifyCookie, {
        secret: appConfig.JWT_SECRET,
        hook: 'onRequest',
    });
    fastify.addHook('preHandler', async (request) => {
        hydrateAuthorizationHeaderFromCookie(request);
        await refreshSessionFromRequestToken(request);
    });
    await fastify.register(csrfProtectionPlugin);
    // Rate limiting (can be disabled or tuned via env)
    if (appConfig.RATE_LIMIT_ENABLED) {
        await fastify.register(rateLimit, {
            max: appConfig.RATE_LIMIT_MAX,
            timeWindow: appConfig.RATE_LIMIT_TIME_WINDOW,
        });
    }
    if (appConfig.ENABLE_SWAGGER_UI) {
        await fastify.register(swagger, {
            swagger: {
                info: {
                    title: 'DARSHAN API',
                    description: 'Production-ready digital signage CMS backend',
                    version: '1.0.0',
                },
                host: `localhost:${appConfig.PORT}`,
                schemes: ['http', 'https'],
                consumes: ['application/json'],
                produces: ['application/json'],
                securityDefinitions: {
                    bearerAuth: {
                        type: 'apiKey',
                        name: 'Authorization',
                        in: 'header',
                        description: 'Use: Bearer <JWT>',
                    },
                },
                security: [{ bearerAuth: [] }],
            },
        });
        await fastify.register(swaggerUi, {
            routePrefix: '/docs',
        });
    }
    // Compatibility health endpoint. Production probes use the explicit live and
    // ready endpoints below so a listening process is not mistaken for a ready system.
    fastify.get('/api/v1/health', async () => {
        return { status: 'ok', timestamp: new Date().toISOString() };
    });
    fastify.get('/api/v1/health/live', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
    fastify.get('/api/v1/health/identity', async () => ({
        service: 'backend',
        site: appConfig.SIGNHEX_DEPLOYMENT_ID,
        release_id: appConfig.DARSHAN_RELEASE_ID,
        source_commit: appConfig.DARSHAN_SOURCE_COMMIT,
        compatibility_generation: appConfig.DARSHAN_COMPATIBILITY_GENERATION,
    }));
    fastify.get('/api/v1/health/ready', async (_request, reply) => {
        const report = await collectReadiness();
        if (!report.ready)
            reply.code(503);
        return report;
    });
    // Register routes
    await fastify.register(authRoutes);
    await fastify.register(userRoutes);
    await fastify.register(departmentRoutes);
    await fastify.register(mediaRoutes);
    await fastify.register(scheduleRoutes);
    await fastify.register(screenRoutes);
    await fastify.register(auditLogRoutes);
    await fastify.register(requestRoutes);
    await fastify.register(emergencyRoutes);
    await fastify.register(notificationRoutes);
    await fastify.register(presentationRoutes);
    await fastify.register(devicePairingRoutes);
    await fastify.register(deviceTelemetryRoutes);
    await fastify.register(apiKeyRoutes);
    await fastify.register(webhookRoutes);
    await fastify.register(ssoConfigRoutes);
    await fastify.register(settingsRoutes);
    await fastify.register(conversationRoutes);
    await fastify.register(chatRoutes);
    await fastify.register(proofOfPlayRoutes);
    await fastify.register(metricsRoutes);
    await fastify.register(observabilityRoutes);
    await fastify.register(reportsRoutes);
    await fastify.register(securityEventRoutes);
    await fastify.register(userInviteRoutes);
    await fastify.register(userActivateRoutes);
    await fastify.register(layoutRoutes);
    await fastify.register(screenGroupRoutes);
    await fastify.register(scheduleRequestRoutes);
    await fastify.register(scheduleReservationRoutes);
    await fastify.register(roleRoutes);
    await fastify.register(permissionRoutes);
    setupDeviceRealtimeGateway(fastify);
    if (options.startOutboxDispatcher !== false) {
        startOutboxDispatcher();
    }
    fastify.addHook('onClose', async () => {
        await stopOutboxDispatcher();
    });
    return fastify;
}
