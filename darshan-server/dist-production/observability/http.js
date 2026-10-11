import { config as appConfig } from '../config/index.js';
import { appendLegacySignhexMetricAliases, getObservabilityRegistry, observeHttpRequest } from './metrics.js';
const REQUEST_START_KEY = Symbol.for('darshan.observability.request_start_ns');
function isLoopbackIp(ip) {
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function hasBearerAccess(request) {
    const configuredToken = appConfig.OBSERVABILITY_METRICS_BEARER_TOKEN;
    if (!configuredToken) {
        return false;
    }
    const header = request.headers.authorization;
    if (!header) {
        return false;
    }
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' && token === configuredToken;
}
function isMetricsRequestAllowed(request) {
    return isLoopbackIp(request.ip) || hasBearerAccess(request);
}
export async function registerObservabilityHttp(fastify) {
    fastify.addHook('onRequest', async (request) => {
        request[REQUEST_START_KEY] = process.hrtime.bigint();
    });
    fastify.addHook('onResponse', async (request, reply) => {
        const start = request[REQUEST_START_KEY];
        if (!start) {
            return;
        }
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
        observeHttpRequest(request, reply, durationSeconds);
    });
    if (!appConfig.OBSERVABILITY_METRICS_ENABLED) {
        return;
    }
    fastify.get('/metrics', async (request, reply) => {
        if (!isMetricsRequestAllowed(request)) {
            reply.code(403).send({ error: 'Forbidden' });
            return;
        }
        const registry = getObservabilityRegistry();
        reply.header('content-type', registry.contentType);
        reply.send(appendLegacySignhexMetricAliases(await registry.metrics()));
    });
}
