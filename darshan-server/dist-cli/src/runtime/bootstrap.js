import { config as appConfig } from '../config/index.js';
import { initializeDatabase } from '../db/index.js';
import { initializeJobs, registerJobHandlers, scheduleRecurringJobs, stopJobs } from '../jobs/index.js';
import { createServer } from '../server/index.js';
import { createLogger } from '../utils/logger.js';
import { validateRuntimeDependencies } from '../utils/runtime-dependencies.js';
import { clearQueuedScreenStateRefreshes } from '../services/screen-state-refresh.js';
import { startWorkerHeartbeat, stopWorkerHeartbeat } from './worker-heartbeat.js';
import { ensureProductionStorage } from '../deployment/production-storage.js';
const logger = createLogger('runtime-bootstrap');
async function ensureBuckets() {
    // Runtime keeps a safe reconciliation fallback for repaired/recreated
    // storage, while fresh-install ownership is bootstrap:production.
    logger.info('Reconciling required runtime buckets');
    await ensureProductionStorage();
}
async function initializeSharedRuntime(role) {
    logger.info({ role }, 'Validating runtime dependencies');
    await validateRuntimeDependencies(role);
    logger.info({ role }, 'Initializing database');
    await initializeDatabase();
    logger.info({ role }, 'Initializing pg-boss client');
    await initializeJobs();
    await ensureBuckets();
}
export async function startRuntime(role) {
    await initializeSharedRuntime(role);
    if (role === 'worker' || role === 'all') {
        logger.info({ role }, 'Registering background job handlers');
        await registerJobHandlers();
        await scheduleRecurringJobs();
        startWorkerHeartbeat();
    }
    if (role === 'api' || role === 'all') {
        logger.info({ role }, 'Creating Fastify server');
        const fastify = await createServer();
        await fastify.listen({ port: appConfig.PORT, host: appConfig.HOST });
        logger.info({ role, host: appConfig.HOST, port: appConfig.PORT, env: appConfig.NODE_ENV }, 'API runtime listening');
        return { role, fastify };
    }
    logger.info({ role }, 'Worker runtime ready');
    return { role };
}
export async function stopRuntime(context) {
    clearQueuedScreenStateRefreshes();
    stopWorkerHeartbeat();
    if (context.fastify) {
        await context.fastify.close();
    }
    await stopJobs();
}
