import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { config as appConfig } from '@/config';
import { reconcileEmergencyTransitions } from '@/services/emergency-transition-outbox';
import { closeTestServer, createTestActor, createTestServer } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';

type CaptureFixture = {
  captureId: string;
  runId: string;
  attemptId: string;
};

const SITE_KEY = appConfig.BACKUP_SITE_ID ?? 'local';

describe('emergency maintenance capture preemption', () => {
  let server: FastifyInstance;
  let actor: Awaited<ReturnType<typeof createTestActor>>;
  const captures: CaptureFixture[] = [];
  const emergencyIds: string[] = [];

  beforeAll(async () => {
    server = await createTestServer();
    actor = await createTestActor('SUPER_ADMIN');
  });

  afterEach(async () => {
    const pool = getDatabasePool();
    if (!pool) return;
    if (emergencyIds.length > 0) {
      await pool.query(
        `UPDATE emergencies
         SET is_active = false, cleared_at = COALESCE(cleared_at, clock_timestamp()),
             updated_at = clock_timestamp()
         WHERE id = ANY($1::uuid[])`,
        [emergencyIds.splice(0)]
      );
    }
    for (const fixture of captures.splice(0).reverse()) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE maintenance_site_state
           SET current_capture_id = NULL, admission_open = true, updated_at = clock_timestamp()
           WHERE site_key = $1 AND current_capture_id = $2`,
          [SITE_KEY, fixture.captureId]
        );
        await client.query('DELETE FROM backup_captures WHERE id = $1', [fixture.captureId]);
        await client.query('DELETE FROM backup_runs WHERE id = $1', [fixture.runId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  async function createEmergencyScreen(): Promise<string> {
    const id = randomUUID();
    await getDatabase().insert(schema.screens).values({
      id,
      name: `Emergency preemption screen ${id}`,
      status: 'ACTIVE',
      device_info: { player_capabilities: { features: ['message_emergency_v1'] } },
    });
    return id;
  }

  async function createActiveCapture(): Promise<CaptureFixture> {
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database pool is not initialized.');
    const fixture = {
      captureId: randomUUID(),
      runId: randomUUID(),
      attemptId: randomUUID(),
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO backup_runs
          (id, trigger_type, status, stage, repository_kind, coordination_key,
           attempt_id, attempt_number, lease_expires_at, deadline_at)
         VALUES ($1, 'MANUAL', 'RUNNING', 'COPYING', 'LOCAL_FILESYSTEM', $2,
           $3, 1, clock_timestamp() + interval '2 minutes',
           clock_timestamp() + interval '4 hours')`,
        [fixture.runId, `emergency-preemption:${randomUUID()}`, fixture.attemptId]
      );
      await client.query(
        `INSERT INTO maintenance_site_state (site_key)
         VALUES ($1) ON CONFLICT (site_key) DO NOTHING`,
        [SITE_KEY]
      );
      const state = await client.query<{ generation: string; current_capture_id: string | null }>(
        `SELECT generation, current_capture_id FROM maintenance_site_state
         WHERE site_key = $1 FOR UPDATE`,
        [SITE_KEY]
      );
      const generation = Number(state.rows[0]?.generation ?? 0) + 1;
      await client.query(
        `INSERT INTO backup_captures
          (id, site_key, generation, backup_run_id, backup_attempt_id, capture_owner,
           status, started_at, deadline_at, updated_at)
         SELECT $1, $2, $3, $4, $5, 'emergency-route-test', 'COPYING',
                capture_clock.now, capture_clock.now + interval '300 seconds', capture_clock.now
         FROM (SELECT clock_timestamp() AS now) AS capture_clock`,
        [fixture.captureId, SITE_KEY, generation, fixture.runId, fixture.attemptId]
      );
      await client.query(
        `UPDATE maintenance_site_state
         SET admission_open = false, generation = $2, current_capture_id = $3,
             updated_at = clock_timestamp()
         WHERE site_key = $1`,
        [SITE_KEY, generation, fixture.captureId]
      );
      await client.query('COMMIT');
      captures.push(fixture);
      return fixture;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function expectPreempted(fixture: CaptureFixture): Promise<void> {
    const db = getDatabase();
    const [capture] = await db
      .select()
      .from(schema.backupCaptures)
      .where(eq(schema.backupCaptures.id, fixture.captureId));
    const [run] = await db
      .select()
      .from(schema.backupRuns)
      .where(eq(schema.backupRuns.id, fixture.runId));
    const [site] = await db
      .select()
      .from(schema.maintenanceSiteState)
      .where(eq(schema.maintenanceSiteState.site_key, SITE_KEY));
    expect(capture).toMatchObject({ status: 'PREEMPTED', reopened_at: expect.any(Date) });
    expect(run).toMatchObject({
      status: 'RETRY_WAIT',
      stage: 'RETRY_WAIT',
      attempt_id: null,
      queue_job_id: null,
      error_code: 'MAINTENANCE_CAPTURE_PREEMPTED',
    });
    expect(site).toMatchObject({ admission_open: true, current_capture_id: fixture.captureId });
  }

  it('commits an authorized trigger, START outbox row, and capture fencing together', async () => {
    const screenId = await createEmergencyScreen();
    const capture = await createActiveCapture();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: {
        authorization: `Bearer ${actor.token}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        message: 'Authorized preemption trigger',
        severity: 'CRITICAL',
        screen_ids: [screenId],
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.CREATED);
    const emergencyId = JSON.parse(response.body).id as string;
    emergencyIds.push(emergencyId);
    await expectPreempted(capture);
    const [transition] = await getDatabase()
      .select()
      .from(schema.emergencyTransitionOutbox)
      .where(and(
        eq(schema.emergencyTransitionOutbox.emergency_id, emergencyId),
        eq(schema.emergencyTransitionOutbox.transition, 'START')
      ));
    expect(transition).toMatchObject({ transition_version: 1 });
  });

  it('does not preempt for unauthorized, invalid, conflicting, or idempotent trigger no-ops', async () => {
    const screenId = await createEmergencyScreen();
    const key = randomUUID();
    const payload = {
      message: 'Replay-safe preemption trigger',
      severity: 'HIGH' as const,
      screen_ids: [screenId],
    };
    const firstCapture = await createActiveCapture();
    const first = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: { authorization: `Bearer ${actor.token}`, 'idempotency-key': key },
      payload,
    });
    expect(first.statusCode).toBe(HTTP_STATUS.CREATED);
    emergencyIds.push(JSON.parse(first.body).id as string);
    await expectPreempted(firstCapture);

    const untouched = await createActiveCapture();
    const replay = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: { authorization: `Bearer ${actor.token}`, 'idempotency-key': key },
      payload,
    });
    expect(replay.statusCode).toBe(HTTP_STATUS.OK);
    expect(replay.headers['idempotent-replay']).toBe('true');

    const unauthorized = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: { 'idempotency-key': randomUUID() },
      payload,
    });
    expect(unauthorized.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);

    const invalid = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: { authorization: `Bearer ${actor.token}`, 'idempotency-key': randomUUID() },
      payload: { ...payload, target_all: true },
    });
    expect(invalid.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);

    const conflicting = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: { authorization: `Bearer ${actor.token}`, 'idempotency-key': key },
      payload: { ...payload, message: 'Conflicting replay' },
    });
    expect(conflicting.statusCode).toBe(HTTP_STATUS.CONFLICT);

    const [capture] = await getDatabase()
      .select()
      .from(schema.backupCaptures)
      .where(eq(schema.backupCaptures.id, untouched.captureId));
    expect(capture).toMatchObject({ status: 'COPYING', reopened_at: null });
  });

  it('preempts only when an authorized clear performs a real transition', async () => {
    const screenId = await createEmergencyScreen();
    const emergencyId = randomUUID();
    emergencyIds.push(emergencyId);
    await getDatabase().insert(schema.emergencies).values({
      id: emergencyId,
      message: 'Clear transition preemption',
      priority: 'HIGH',
      screen_ids: [screenId],
      screen_group_ids: [],
      target_all: false,
      triggered_by: actor.id,
      is_active: true,
    });
    const capture = await createActiveCapture();

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/emergency/${emergencyId}/clear`,
      headers: { authorization: `Bearer ${actor.token}` },
      payload: { clear_reason: 'Resolved safely' },
    });
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    await expectPreempted(capture);

    const [transition] = await getDatabase()
      .select()
      .from(schema.emergencyTransitionOutbox)
      .where(and(
        eq(schema.emergencyTransitionOutbox.emergency_id, emergencyId),
        eq(schema.emergencyTransitionOutbox.transition, 'CLEAR')
      ));
    expect(transition).toMatchObject({ transition_version: 2 });

    const untouched = await createActiveCapture();
    const replay = await server.inject({
      method: 'POST',
      url: `/api/v1/emergency/${emergencyId}/clear`,
      headers: { authorization: `Bearer ${actor.token}` },
      payload: { clear_reason: 'Repeated clear must be a no-op' },
    });
    expect(replay.statusCode).toBe(HTTP_STATUS.OK);
    expect(replay.headers['idempotent-replay']).toBe('true');
    const [untouchedCapture] = await getDatabase()
      .select()
      .from(schema.backupCaptures)
      .where(eq(schema.backupCaptures.id, untouched.captureId));
    expect(untouchedCapture).toMatchObject({ status: 'COPYING', reopened_at: null });
  });

  it('uses the database clock to atomically expire an emergency and preempt capture', async () => {
    const screenId = await createEmergencyScreen();
    const emergencyId = randomUUID();
    emergencyIds.push(emergencyId);
    await getDatabase().insert(schema.emergencies).values({
      id: emergencyId,
      message: 'Natural expiry preemption',
      priority: 'HIGH',
      screen_ids: [screenId],
      screen_group_ids: [],
      target_all: false,
      triggered_by: actor.id,
      is_active: true,
      expires_at: new Date(Date.now() - 60_000),
    });
    const capture = await createActiveCapture();

    const result = await reconcileEmergencyTransitions({ maxRows: 100 });
    expect(result.expiredCount).toBeGreaterThanOrEqual(1);
    await expectPreempted(capture);

    const [emergency] = await getDatabase()
      .select()
      .from(schema.emergencies)
      .where(eq(schema.emergencies.id, emergencyId));
    expect(emergency).toMatchObject({ is_active: false, transition_version: 2 });
    const [transition] = await getDatabase()
      .select()
      .from(schema.emergencyTransitionOutbox)
      .where(and(
        eq(schema.emergencyTransitionOutbox.emergency_id, emergencyId),
        eq(schema.emergencyTransitionOutbox.transition, 'EXPIRE')
      ));
    expect(transition).toMatchObject({ transition_version: 2 });

    await reconcileEmergencyTransitions({ transitionId: transition!.id });
    const commands = (await getDatabase()
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.screen_id, screenId)))
      .filter((command) =>
        command.type === 'REFRESH'
        && (command.payload as { emergency_version?: string } | null)?.emergency_version === `${emergencyId}:2`
      );
    expect(commands).toHaveLength(1);
  });
});
