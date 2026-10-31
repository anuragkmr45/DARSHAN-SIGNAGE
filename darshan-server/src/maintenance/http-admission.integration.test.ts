import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiEndpoints } from '@/config/apiEndpoints';
import { formatErrorResponse } from '@/utils/app-error';
import { toAppError } from '@/utils/errors';
import { MaintenanceCoordinator, type CaptureIdentity } from './coordinator';
import {
  installHttpAdmission,
  MAINTENANCE_ADMISSION_ERROR_MESSAGE,
  type HttpAdmissionRuntime,
} from './http-admission';

const TEST_URL = process.env.DATABASE_URL!;

describe('HTTP maintenance admission PostgreSQL integration', () => {
  let pool: Pool;

  beforeAll(() => {
    expect(new URL(TEST_URL).pathname).toMatch(/_test(?:_|$)/);
    pool = new Pool({ connectionString: TEST_URL, max: 8 });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function buildServer(siteKey: string): Promise<{
    server: FastifyInstance;
    runtime: HttpAdmissionRuntime;
    coordinator: MaintenanceCoordinator;
  }> {
    const server = Fastify();
    server.setErrorHandler((error, request, reply) => {
      const appError = toAppError(error);
      reply.status(appError.statusCode).send(formatErrorResponse(appError, request.id));
    });
    const coordinator = new MaintenanceCoordinator(pool);
    const runtime = await installHttpAdmission(server, {
      pool,
      siteKey,
      coordinator,
      startWatchdog: false,
    });
    return { server, runtime, coordinator };
  }

  async function beginBarrier(siteKey: string, coordinator: MaintenanceCoordinator): Promise<CaptureIdentity> {
    const runId = randomUUID();
    const attemptId = randomUUID();
    await pool.query(
      `INSERT INTO backup_runs
        (id, trigger_type, status, stage, repository_kind, coordination_key,
         attempt_id, attempt_number, lease_expires_at, deadline_at)
       VALUES ($1, 'MANUAL', 'RUNNING', 'PREPARING', 'LOCAL_FILESYSTEM', $2,
         $3, 1, clock_timestamp() + interval '2 minutes', clock_timestamp() + interval '4 hours')`,
      [runId, `http-admission:${siteKey}`, attemptId]
    );
    return coordinator.beginCapture({
      siteKey,
      backupRunId: runId,
      backupAttemptId: attemptId,
      owner: `http-test:${randomUUID()}`,
    });
  }

  async function cleanupSite(siteKey: string): Promise<void> {
    const runs = await pool.query<{ backup_run_id: string }>(
      'SELECT backup_run_id FROM backup_captures WHERE site_key = $1',
      [siteKey]
    );
    await pool.query('DELETE FROM maintenance_operations WHERE site_key = $1', [siteKey]);
    await pool.query(
      'UPDATE maintenance_site_state SET current_capture_id = NULL WHERE site_key = $1',
      [siteKey]
    );
    await pool.query('DELETE FROM backup_captures WHERE site_key = $1', [siteKey]);
    await pool.query('DELETE FROM maintenance_site_state WHERE site_key = $1', [siteKey]);
    for (const run of runs.rows) {
      await pool.query('DELETE FROM backup_runs WHERE id = $1', [run.backup_run_id]);
    }
  }

  it('rejects ordinary and hidden mutations while reads and exact operational controls continue', async () => {
    const siteKey = `http-admission-${randomUUID()}`;
    const { server, coordinator } = await buildServer(siteKey);
    server.post('/api/v1/widgets', async () => ({ admitted: true }));
    server.get('/api/v1/widgets', async () => ({ readable: true }));
    server.post(apiEndpoints.auth.login, async () => ({ auth: true }));
    server.post(apiEndpoints.deviceTelemetry.heartbeat, async () => ({ device: true }));
    server.post(apiEndpoints.settings.backupRun, async () => ({ queued: true }));
    server.post(apiEndpoints.devicePairing.request, async () => ({ paired: true }));
    server.get(apiEndpoints.media.uploadSession, async () => ({ upload: true }));
    await server.ready();

    try {
      await beginBarrier(siteKey, coordinator);

      const ordinary = await server.inject({ method: 'POST', url: '/api/v1/widgets' });
      expect(ordinary.statusCode).toBe(503);
      expect(ordinary.json()).toMatchObject({
        success: false,
        error: {
          code: 'MAINTENANCE_ADMISSION_CLOSED',
          message: MAINTENANCE_ADMISSION_ERROR_MESSAGE,
          details: { retryable: true },
        },
      });
      expect(Number(ordinary.headers['retry-after'])).toBeGreaterThan(0);

      await expect(server.inject({ method: 'GET', url: '/api/v1/widgets' }))
        .resolves.toMatchObject({ statusCode: 200 });
      await expect(server.inject({ method: 'POST', url: apiEndpoints.auth.login }))
        .resolves.toMatchObject({ statusCode: 200 });
      await expect(server.inject({ method: 'POST', url: apiEndpoints.deviceTelemetry.heartbeat }))
        .resolves.toMatchObject({ statusCode: 200 });
      await expect(server.inject({ method: 'POST', url: apiEndpoints.settings.backupRun }))
        .resolves.toMatchObject({ statusCode: 200 });

      const pairing = await server.inject({ method: 'POST', url: apiEndpoints.devicePairing.request });
      expect(pairing.statusCode).toBe(503);
      const hiddenGet = await server.inject({
        method: 'GET',
        url: apiEndpoints.media.uploadSession.replace(':sessionId', randomUUID()),
      });
      expect(hiddenGet.statusCode).toBe(503);
    } finally {
      await server.close();
      await cleanupSite(siteKey);
    }
  });

  it('holds one lexical permit through nested awaited handler work and releases it on throw', async () => {
    const siteKey = `http-scope-${randomUUID()}`;
    const { server, runtime } = await buildServer(siteKey);
    server.post('/api/v1/nested', async () => runtime.scope.run(
      { siteKey, operationKind: 'nested-service-write' },
      async (permit) => {
        const active = await pool.query<{ id: string; status: string }>(
          `SELECT id, status FROM maintenance_operations
           WHERE site_key = $1 AND status = 'ACTIVE'`,
          [siteKey]
        );
        return {
          operationId: permit.operationId,
          activeIds: active.rows.map((row) => row.id),
        };
      }
    ));
    server.post('/api/v1/throws', async () => {
      throw new Error('expected-handler-failure');
    });
    await server.ready();

    try {
      const nested = await server.inject({ method: 'POST', url: '/api/v1/nested' });
      expect(nested.statusCode).toBe(200);
      const nestedBody = nested.json<{ operationId: string; activeIds: string[] }>();
      expect(nestedBody.activeIds).toEqual([nestedBody.operationId]);
      expect((await pool.query(
        `SELECT status FROM maintenance_operations WHERE id = $1`,
        [nestedBody.operationId]
      )).rows[0]).toMatchObject({ status: 'COMPLETED' });

      const failed = await server.inject({ method: 'POST', url: '/api/v1/throws' });
      expect(failed.statusCode).toBe(500);
      const rows = await pool.query<{ status: string }>(
        `SELECT status FROM maintenance_operations
         WHERE site_key = $1 ORDER BY admitted_at`,
        [siteKey]
      );
      expect(rows.rows.map((row) => row.status)).toEqual(['COMPLETED', 'COMPLETED']);
    } finally {
      await server.close();
      await cleanupSite(siteKey);
    }
  });
});
