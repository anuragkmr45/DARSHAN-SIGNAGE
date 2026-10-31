import PgBoss from 'pg-boss';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MaintenanceCoordinatorError } from './errors';
import { GatedPgBossWorker, type GatedPgBossClient } from './pgboss-worker';
import { WorkerAdmissionController } from './worker-admission';

const TEST_URL = process.env.DATABASE_URL!;
const TEST_SCHEMA = 'pgboss_packet2_worker_test';
const TEST_QUEUE = 'packet2:gated-expiration';

async function eventually(assertion: () => Promise<void> | void, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}

describe('maintenance-aware pg-boss worker PostgreSQL integration', () => {
  let pool: Pool;
  let boss: PgBoss;

  beforeAll(async () => {
    expect(new URL(TEST_URL).pathname).toMatch(/_test(?:_|$)/);
    pool = new Pool({ connectionString: TEST_URL });
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    boss = new PgBoss({
      connectionString: TEST_URL,
      schema: TEST_SCHEMA,
      monitorStateIntervalSeconds: 1,
    });
    await boss.start();
    await boss.createQueue(TEST_QUEUE);
  });

  afterAll(async () => {
    await boss?.stop({ graceful: true, timeout: 5_000 });
    await pool?.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool?.end();
  });

  it('keeps a gated delivery unclaimed past expireIn, then processes it exactly once after reopen', async () => {
    let admissionOpen = false;
    const scope = {
      run: vi.fn(async (_input, work: () => Promise<void>) => {
        if (!admissionOpen) {
          throw new MaintenanceCoordinatorError(
            'MAINTENANCE_ADMISSION_CLOSED',
            'capture barrier is active'
          );
        }
        return work();
      }),
    };
    const admission = new WorkerAdmissionController(scope, {
      siteKey: 'packet2-worker-test',
      retryDelayMs: 20,
    });
    const handler = vi.fn(async () => undefined);
    const worker = new GatedPgBossWorker({
      boss: boss as unknown as GatedPgBossClient,
      schema: TEST_SCHEMA,
      queueName: TEST_QUEUE,
      handler,
      admission,
      pollingIntervalMs: 20,
    });

    const jobId = await boss.send(TEST_QUEUE, { test: true }, { expireInSeconds: 1 });
    expect(jobId).toBeTruthy();
    worker.start();

    await eventually(() => expect(scope.run).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const held = await boss.getJobById(TEST_QUEUE, jobId!);
    expect(held?.state).toBe('created');
    expect(handler).not.toHaveBeenCalled();

    admissionOpen = true;
    await eventually(async () => {
      const completed = await boss.getJobById(TEST_QUEUE, jobId!);
      expect(completed?.state).toBe('completed');
    });
    expect(handler).toHaveBeenCalledOnce();

    await worker.stop();
    admission.stop();
  });
});
