import { Server as SocketIOServer } from 'socket.io';
import { config as appConfig } from '../config/index.js';
import { recordRealtimeSocketConnect, recordRealtimeSocketDisconnect, setWebsocketConnections, } from '../observability/metrics.js';
const DEFAULT_ORIGIN = 'http://localhost:8080';
const DEVELOPMENT_LOCAL_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SOCKET_SERVER_KEY = Symbol.for('darshan.socket.io.server');
const SOCKET_OBSERVABILITY_KEY = Symbol.for('darshan.socket.io.observability');
const NAMESPACE_OBSERVABILITY_KEY = Symbol.for('darshan.socket.io.namespace.observability');
let socketServer = null;
function attachSocketObservability(io) {
    const instrumented = io;
    if (instrumented[SOCKET_OBSERVABILITY_KEY]) {
        return;
    }
    instrumented[SOCKET_OBSERVABILITY_KEY] = true;
    setWebsocketConnections(io.engine.clientsCount);
    io.on('connection', (socket) => {
        setWebsocketConnections(io.engine.clientsCount);
        socket.on('disconnect', () => {
            setWebsocketConnections(io.engine.clientsCount);
        });
    });
}
export function attachNamespaceSocketObservability(namespace, namespaceName) {
    const instrumented = namespace;
    if (instrumented[NAMESPACE_OBSERVABILITY_KEY]) {
        return;
    }
    instrumented[NAMESPACE_OBSERVABILITY_KEY] = true;
    namespace.on('connection', (socket) => {
        recordRealtimeSocketConnect(namespaceName);
        socket.on('disconnect', (reason) => {
            recordRealtimeSocketDisconnect(namespaceName, reason);
        });
    });
}
export function parseAllowedOrigins(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function dedupeOrigins(origins) {
    return Array.from(new Set(origins.filter(Boolean)));
}
function getConfiguredHttpOrigins() {
    return dedupeOrigins([
        appConfig.APP_PUBLIC_BASE_URL || '',
        ...parseAllowedOrigins(appConfig.CORS_ORIGINS || ''),
    ]);
}
export function getHttpAllowedOrigins() {
    const configured = getConfiguredHttpOrigins();
    if (appConfig.NODE_ENV === 'production') {
        return configured;
    }
    return dedupeOrigins([DEFAULT_ORIGIN, ...configured]);
}
export function getSocketAllowedOrigins() {
    const fromSocketEnv = parseAllowedOrigins(appConfig.SOCKET_ALLOWED_ORIGINS || '');
    if (fromSocketEnv.length > 0) {
        return dedupeOrigins(fromSocketEnv);
    }
    const fromHttpOrigins = getConfiguredHttpOrigins();
    if (appConfig.NODE_ENV === 'production') {
        return fromHttpOrigins;
    }
    return dedupeOrigins([DEFAULT_ORIGIN, ...fromHttpOrigins]);
}
function getSocketTransports() {
    const transports = new Set([appConfig.REALTIME_SOCKET_TRANSPORT]);
    if (appConfig.REALTIME_SOCKET_ALLOW_POLLING) {
        transports.add('polling');
    }
    else {
        transports.delete('polling');
    }
    if (transports.size === 0) {
        transports.add('websocket');
    }
    return Array.from(transports);
}
function isDevelopmentLocalOrigin(origin) {
    if (appConfig.NODE_ENV === 'production') {
        return false;
    }
    try {
        const parsed = new URL(origin);
        return DEVELOPMENT_LOCAL_ORIGIN_HOSTS.has(parsed.hostname);
    }
    catch {
        return false;
    }
}
export function isAllowedOrigin(origin, allowlist = getSocketAllowedOrigins()) {
    if (!origin)
        return false;
    return allowlist.includes(origin) || isDevelopmentLocalOrigin(origin);
}
export function getSocketServerOptions() {
    const allowlist = getSocketAllowedOrigins();
    return {
        path: appConfig.REALTIME_WS_PATH,
        transports: getSocketTransports(),
        pingInterval: appConfig.REALTIME_WS_PING_INTERVAL_MS,
        pingTimeout: appConfig.REALTIME_WS_IDLE_TIMEOUT_MS,
        maxHttpBufferSize: appConfig.WS_NOTIFICATION_MAX_BYTES,
        cors: {
            origin: (origin, cb) => {
                if (!origin)
                    return cb(null, true);
                if (isAllowedOrigin(origin, allowlist))
                    return cb(null, true);
                return cb(new Error('CORS origin not allowed'), false);
            },
            credentials: true,
        },
    };
}
export function getOrCreateSocketServer(fastify) {
    const httpServer = fastify.server;
    const existingOnServer = httpServer[SOCKET_SERVER_KEY];
    if (existingOnServer) {
        fastify.io = existingOnServer;
        socketServer = existingOnServer;
        attachSocketObservability(existingOnServer);
        return existingOnServer;
    }
    const existing = fastify.io;
    if (existing) {
        socketServer = existing;
        attachSocketObservability(existing);
        return existing;
    }
    const io = new SocketIOServer(fastify.server, getSocketServerOptions());
    fastify.io = io;
    httpServer[SOCKET_SERVER_KEY] = io;
    socketServer = io;
    attachSocketObservability(io);
    return io;
}
export function getSocketServer() {
    return socketServer;
}
