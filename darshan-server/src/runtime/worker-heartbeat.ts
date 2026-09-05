import { eq } from 'drizzle-orm';
import { config as appConfig } from '@/config';
import { getDatabase, schema } from '@/db';
import { createLogger } from '@/utils/logger';

const logger = createLogger('worker-heartbeat');
let timer: NodeJS.Timeout | null = null;
const workerProcessStartedAt = new Date();

function identity() {
  return `${appConfig.SIGNHEX_DEPLOYMENT_ID}:${appConfig.SIGNHEX_SERVER_ID}`;
}

export async function recordWorkerHeartbeat(now = new Date()) {
  const id = identity();
  await getDatabase()
    .insert(schema.workerRuntimeHeartbeats)
    .values({
      id,
      deployment_id: appConfig.SIGNHEX_DEPLOYMENT_ID,
      server_id: appConfig.SIGNHEX_SERVER_ID,
      release_id: appConfig.DARSHAN_RELEASE_ID,
      observed_at: now,
      started_at: workerProcessStartedAt,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: schema.workerRuntimeHeartbeats.id,
      set: {
        release_id: appConfig.DARSHAN_RELEASE_ID,
        observed_at: now,
        started_at: workerProcessStartedAt,
        updated_at: now,
      },
    });
}

export function startWorkerHeartbeat() {
  if (timer) return;
  const beat = async () => {
    try {
      await recordWorkerHeartbeat();
    } catch (error) {
      logger.warn(error, 'Worker heartbeat write failed');
    }
  };
  void beat();
  timer = setInterval(() => void beat(), appConfig.WORKER_HEARTBEAT_INTERVAL_MS);
  timer.unref();
}

export function stopWorkerHeartbeat() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export async function getCurrentWorkerHeartbeat() {
  const [heartbeat] = await getDatabase()
    .select()
    .from(schema.workerRuntimeHeartbeats)
    .where(eq(schema.workerRuntimeHeartbeats.id, identity()));
  return heartbeat ?? null;
}
