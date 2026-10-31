import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import { closeTestServer, createTestActor, createTestServer } from '@/test/helpers';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { hashPassword } from '@/auth/password';
import { generateAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';

const siteKey = 'packet-4c2a-site';
const repositoryId = '11111111-1111-4111-8111-111111111111';
const { requestCoordinatedBackupMock, queueManualBackupDeletionMock } = vi.hoisted(() => ({
  requestCoordinatedBackupMock: vi.fn(), queueManualBackupDeletionMock: vi.fn(),
}));

vi.mock('@/config', async () => {
  const actual = await vi.importActual<typeof import('@/config')>('@/config');
  return { ...actual, config: { ...actual.config, BACKUP_REPOSITORY_KIND: 'LOCAL_FILESYSTEM',
    BACKUP_LOCAL_PROTOCOL: 'V2_BROKER', BACKUP_SITE_ID: 'packet-4c2a-site',
    BACKUP_REPOSITORY_ID: '11111111-1111-4111-8111-111111111111',
    BACKUP_RETENTION_DAYS: 30 } };
});
vi.mock('@/jobs', async () => {
  const actual = await vi.importActual<typeof import('@/jobs')>('@/jobs');
  return { ...actual, requestCoordinatedBackup: requestCoordinatedBackupMock,
    queueManualBackupDeletion: queueManualBackupDeletionMock };
});

async function customActor(grants: Array<{ action: string; subject: string; conditions?: Record<string, string> }>) {
  const db = getDatabase(); const roleId = randomUUID(); const userId = randomUUID();
  const email = `backup-${userId}@example.test`; const roleName = `backup-role-${roleId}`;
  await db.insert(schema.roles).values({ id: roleId, name: roleName, permissions: { grants }, is_system: false });
  await db.insert(schema.users).values({ id: userId, email, password_hash: await hashPassword('TestPassword123!'),
    role_id: roleId, is_active: true });
  const access = await generateAccessToken(userId, email, roleId, roleName);
  await createSessionRepository().create({ user_id: userId, access_jti: access.jti, expires_at: access.expiresAt });
  return { roleId, userId, token: access.token };
}

describe('Settings backup Packet 4C2A routes', () => {
  let server: FastifyInstance; let superToken: string; let adminToken: string;
  const roleIds: string[] = []; const userIds: string[] = []; const runIds: string[] = [];
  const captureIds: string[] = []; const publicationIds: string[] = [];

  beforeAll(async () => {
    server = await createTestServer(); superToken = (await createTestActor('SUPER_ADMIN')).token;
    adminToken = (await createTestActor('ADMIN')).token;
    await getDatabase().insert(schema.maintenanceSiteState).values({ site_key: siteKey }).onConflictDoNothing();
  });
  afterAll(async () => {
    const db = getDatabase();
    if (runIds.length) {
      const operations = await db.select({ id: schema.backupRetentionOperations.id }).from(schema.backupRetentionOperations)
        .where(inArray(schema.backupRetentionOperations.backup_run_id, runIds));
      const operationIds = operations.map(({ id }) => id);
      if (operationIds.length) {
        await db.delete(schema.backupRetentionRequestIdempotency)
          .where(inArray(schema.backupRetentionRequestIdempotency.operation_id, operationIds));
        await db.delete(schema.backupRetentionArtifactProgress)
          .where(inArray(schema.backupRetentionArtifactProgress.operation_id, operationIds));
      }
      await db.delete(schema.backupRetentionTombstones).where(inArray(schema.backupRetentionTombstones.backup_run_id, runIds));
      await db.delete(schema.backupRetentionOperations).where(inArray(schema.backupRetentionOperations.backup_run_id, runIds));
      await db.delete(schema.backupArtifactLifecycles).where(inArray(schema.backupArtifactLifecycles.backup_run_id, runIds));
      const client = await getDatabasePool()!.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE backup_execution_outcomes DISABLE TRIGGER backup_execution_outcomes_immutable_trigger');
        await client.query('DELETE FROM backup_execution_outcomes WHERE backup_run_id = ANY($1::uuid[])', [runIds]);
        await client.query('ALTER TABLE backup_execution_outcomes ENABLE TRIGGER backup_execution_outcomes_immutable_trigger');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    if (publicationIds.length) await db.delete(schema.backupPublications).where(inArray(schema.backupPublications.id, publicationIds));
    if (captureIds.length) await db.delete(schema.backupCaptures).where(inArray(schema.backupCaptures.id, captureIds));
    await db.update(schema.maintenanceSiteState).set({ current_capture_id: null }).where(eq(schema.maintenanceSiteState.site_key, siteKey));
    if (runIds.length) await db.delete(schema.backupRuns).where(inArray(schema.backupRuns.id, runIds));
    await db.delete(schema.maintenanceOperations).where(eq(schema.maintenanceOperations.site_key, siteKey));
    await db.delete(schema.maintenanceSiteState).where(eq(schema.maintenanceSiteState.site_key, siteKey));
    if (userIds.length) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    if (roleIds.length) await db.delete(schema.roles).where(inArray(schema.roles.id, roleIds));
    await closeTestServer(server);
  });
  beforeEach(() => {
    requestCoordinatedBackupMock.mockReset();
    queueManualBackupDeletionMock.mockReset().mockResolvedValue('job-id');
  });

  it('does not let ADMIN or wildcard custom roles inherit Backup authority', async () => {
    const wildcard = await customActor([{ action: 'manage', subject: 'all' }]);
    roleIds.push(wildcard.roleId); userIds.push(wildcard.userId);
    for (const token of [adminToken, wildcard.token]) {
      expect((await server.inject({ method: 'GET', url: '/api/v1/settings/backups/history',
        headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
      expect((await server.inject({ method: 'POST', url: '/api/v1/settings/backups/run',
        headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
    }
  });

  it('allows arbitrary custom roles only their explicit unconditional Backup actions', async () => {
    const actor = await customActor([{ action: 'read', subject: 'Backup' }]);
    roleIds.push(actor.roleId); userIds.push(actor.userId);
    expect((await server.inject({ method: 'GET', url: '/api/v1/settings/backups/history',
      headers: { authorization: `Bearer ${actor.token}` } })).statusCode).toBe(200);
    expect((await server.inject({ method: 'POST', url: '/api/v1/settings/backups/run',
      headers: { authorization: `Bearer ${actor.token}` } })).statusCode).toBe(403);
  });

  it('rejects conditional Backup grants at the role contract', async () => {
    const response = await server.inject({ method: 'POST', url: '/api/v1/roles',
      headers: { authorization: `Bearer ${superToken}` }, body: { name: `conditional-${randomUUID()}`,
        permissions: { grants: [{ action: 'read', subject: 'Backup', conditions: { id: 'x' } }] } } });
    expect(response.statusCode).toBe(422);
  });

  it('uses create Backup for run-now with fresh authorization', async () => {
    const run = { id: randomUUID(), status: 'PENDING', trigger_type: 'MANUAL' };
    requestCoordinatedBackupMock.mockResolvedValue({ run, coalesced: false });
    const response = await server.inject({ method: 'POST', url: '/api/v1/settings/backups/run',
      headers: { authorization: `Bearer ${superToken}` } });
    expect(response.statusCode).toBe(201);
    expect(requestCoordinatedBackupMock).toHaveBeenCalledWith({ triggerType: 'MANUAL', triggeredBy: expect.any(String) });
  });

  async function insertVerifiedCopies() {
    const db = getDatabase(); const copies: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const runId = randomUUID(); const attemptId = randomUUID(); const captureId = randomUUID(); const publicationId = randomUUID();
      const capturedAt = new Date(Date.now() - (31 + index) * 86_400_000);
      const startedAt = new Date(capturedAt.getTime() - 60_000); const manifestSha256 = String(index + 1).repeat(64);
      await db.insert(schema.backupRuns).values({ id: runId, trigger_type: 'MANUAL', status: 'COMPLETED',
        repository_kind: 'LOCAL_FILESYSTEM', coordination_key: `packet-4c2a:${runId}`, stage: 'COMPLETED',
        attempt_id: attemptId, attempt_number: 1, repository_id: repositoryId, manifest_sha256: manifestSha256,
        captured_at: capturedAt, completed_at: capturedAt, created_at: capturedAt, updated_at: capturedAt,
        repository_manifest: { site: { id: siteKey }, artifacts: [{ kind: 'DATABASE', name: 'database',
          ciphertextSizeBytes: '42', ciphertextSha256: manifestSha256 }] }, files: [] });
      await db.insert(schema.backupCaptures).values({ id: captureId, site_key: siteKey, generation: index + 1,
        backup_run_id: runId, backup_attempt_id: attemptId, capture_owner: `test-${index}`, status: 'SEALED',
        started_at: startedAt, deadline_at: new Date(startedAt.getTime() + 300_000),
        staging_inventory_digest: 'a'.repeat(64), sealed_at: capturedAt, reopened_at: capturedAt });
      await db.insert(schema.backupPublications).values({ id: publicationId, backup_run_id: runId,
        backup_attempt_id: attemptId, capture_id: captureId, repository_id: repositoryId,
        manifest_sha256: manifestSha256, incomplete_relative_path: `${runId}.incomplete`,
        published_relative_path: runId, status: 'VERIFIED', published_at: capturedAt, verified_at: capturedAt });
      await db.insert(schema.backupExecutionOutcomes).values({ backup_run_id: runId, site_key: siteKey,
        repository_id: repositoryId, outcome: 'SUCCEEDED', completed_at: capturedAt, captured_at: capturedAt,
        verification_provenance: 'PUBLICATION_READ_BACK', publication_id: publicationId,
        verified_good_at: capturedAt, manifest_sha256: manifestSha256 });
      await db.insert(schema.backupArtifactLifecycles).values({ backup_run_id: runId, state: 'AVAILABLE' });
      runIds.push(runId); captureIds.push(captureId); publicationIds.push(publicationId); copies.push(runId);
    }
    return copies;
  }

  it('admits durable deletion, binds a coalesced key, retains history, and returns tombstone replay', async () => {
    const target = (await insertVerifiedCopies())[3];
    const first = await server.inject({ method: 'DELETE', url: `/api/v1/settings/backups/${target}`,
      headers: { authorization: `Bearer ${superToken}` } });
    expect(first.statusCode).toBe(202); expect(first.headers.location).toContain('/settings/backups/operations/');
    expect(first.headers['retry-after']).toBe('5'); const operationId = JSON.parse(first.body).operation_id as string;
    const keyed = await server.inject({ method: 'DELETE', url: `/api/v1/settings/backups/${target}`,
      headers: { authorization: `Bearer ${superToken}`, 'idempotency-key': 'coalesced-key' } });
    expect(keyed.statusCode).toBe(202); expect(JSON.parse(keyed.body).operation_id).toBe(operationId);
    expect(await getDatabase().select().from(schema.backupRetentionRequestIdempotency)
      .where(eq(schema.backupRetentionRequestIdempotency.operation_id, operationId))).toHaveLength(1);
    const history = await server.inject({ method: 'GET', url: '/api/v1/settings/backups/history?limit=2',
      headers: { authorization: `Bearer ${superToken}` } });
    expect(history.statusCode).toBe(200); expect(JSON.parse(history.body)).toMatchObject({ items: expect.any(Array), health: expect.any(Object) });
    expect(await getDatabase().select().from(schema.backupRuns).where(eq(schema.backupRuns.id, target))).toHaveLength(1);
    await getDatabase().update(schema.backupRetentionOperations).set({ status: 'SUCCEEDED', completed_at: new Date() })
      .where(eq(schema.backupRetentionOperations.id, operationId));
    await getDatabase().update(schema.backupArtifactLifecycles).set({ state: 'DELETED' })
      .where(eq(schema.backupArtifactLifecycles.backup_run_id, target));
    await getDatabase().insert(schema.backupRetentionTombstones).values({ backup_run_id: target,
      operation_id: operationId, site_key: siteKey, repository_id: repositoryId, manifest_sha256: '4'.repeat(64),
      disposition: 'DELETED', artifact_summary: {}, reason_code: 'TEST_DELETED' });
    const replay = await server.inject({ method: 'DELETE', url: `/api/v1/settings/backups/${target}`,
      headers: { authorization: `Bearer ${superToken}`, 'idempotency-key': 'coalesced-key' } });
    expect(replay.statusCode).toBe(200);
    expect(JSON.parse(replay.body)).toMatchObject({ disposition: 'DELETED', tombstone: { disposition: 'DELETED' } });
  });

  it('does not skip rows when keyset timestamps share PostgreSQL microseconds', async () => {
    const db = getDatabase();
    const tiedRunIds = [randomUUID(), randomUUID()];
    for (const runId of tiedRunIds) {
      await db.insert(schema.backupRuns).values({
        id: runId,
        trigger_type: 'MANUAL',
        status: 'FAILED',
        repository_kind: 'LEGACY_OFF_HOST',
        coordination_key: `packet-4c2a-cursor:${runId}`,
        stage: 'FAILED',
        attempt_number: 1,
        files: [],
      });
      runIds.push(runId);
    }
    await db.execute(sql`
      UPDATE backup_runs
         SET created_at = '2099-01-01 00:00:00.123456+00'::timestamptz,
             updated_at = '2099-01-01 00:00:00.123456+00'::timestamptz
       WHERE id IN (${tiedRunIds[0]}::uuid, ${tiedRunIds[1]}::uuid)
    `);

    const first = await server.inject({
      method: 'GET',
      url: '/api/v1/settings/backups/history?limit=1',
      headers: { authorization: `Bearer ${superToken}` },
    });
    expect(first.statusCode).toBe(200);
    const firstPage = JSON.parse(first.body) as { items: Array<{ id: string }>; next_cursor: string };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.next_cursor).toBeTruthy();

    const second = await server.inject({
      method: 'GET',
      url: `/api/v1/settings/backups/history?limit=1&cursor=${encodeURIComponent(firstPage.next_cursor)}`,
      headers: { authorization: `Bearer ${superToken}` },
    });
    expect(second.statusCode).toBe(200);
    const secondPage = JSON.parse(second.body) as { items: Array<{ id: string }> };
    expect(secondPage.items).toHaveLength(1);
    expect(new Set([firstPage.items[0].id, secondPage.items[0].id])).toEqual(new Set(tiedRunIds));
  });

  it('requires one explicit artifact and rejects unsupported ranges before opening a source', async () => {
    const missing = await server.inject({ method: 'GET', url: `/api/v1/settings/backups/${randomUUID()}/download`,
      headers: { authorization: `Bearer ${superToken}` } });
    expect(missing.statusCode).toBe(400);
    const range = await server.inject({ method: 'GET',
      url: `/api/v1/settings/backups/${randomUUID()}/download?artifact=DATABASE`,
      headers: { authorization: `Bearer ${superToken}`, range: 'bytes=0-99' } });
    expect(range.statusCode).toBe(416);
    expect(JSON.parse(range.body).error).toMatchObject({ code: 'BACKUP_DOWNLOAD_RANGE_NOT_SUPPORTED' });
  });
});
