import { config as appConfig } from '@/config';
import { initializeDatabase } from '@/db';
import { initializeJobs, registerJobHandlers, scheduleRecurringJobs, stopJobs } from '@/jobs';
import { createServer } from '@/server';
import { createLogger } from '@/utils/logger';
import { validateRuntimeDependencies } from '@/utils/runtime-dependencies';
import { type ProcessRole } from '@/runtime/process-role';
import { clearQueuedScreenStateRefreshes } from '@/services/screen-state-refresh';
import { startWorkerHeartbeat, stopWorkerHeartbeat } from '@/runtime/worker-heartbeat';
import { ensureProductionStorage } from '@/deployment/production-storage';

const logger = createLogger('runtime-bootstrap');

type FastifyInstance = Awaited<ReturnType<typeof createServer>>;

export interface RuntimeContext {
  role: ProcessRole;
  fastify?: FastifyInstance;
}

async function ensureBuckets() {
  // Runtime keeps a safe reconciliation fallback for repaired/recreated
  // storage, while fresh-install ownership is bootstrap:production.
  logger.info('Reconciling required runtime buckets');
  await ensureProductionStorage();
}

async function initializeSharedRuntime(role: ProcessRole) {
  logger.info({ role }, 'Validating runtime dependencies');
  await validateRuntimeDependencies(role);

  logger.info({ role }, 'Initializing database');
  await initializeDatabase();

  logger.info({ role }, 'Initializing pg-boss client');
  await initializeJobs();

  await ensureBuckets();
}

export async function startRuntime(role: ProcessRole): Promise<RuntimeContext> {
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

export async function stopRuntime(context: RuntimeContext): Promise<void> {
  clearQueuedScreenStateRefreshes();
  stopWorkerHeartbeat();
  if (context.fastify) {
    await context.fastify.close();
  }
  await stopJobs();
}
