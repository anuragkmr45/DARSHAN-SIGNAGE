import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { createSessionRepository } from '@/db/repositories/session';
import { generateAccessToken } from '@/auth/jwt';
import { closeTestServer, createTestServer, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';
import { reconcileEmergencyTransitions } from '@/services/emergency-transition-outbox';
import { getActiveEmergencyForScreen } from '@/screens/playback';

function emergencyHeaders(adminToken: string, idempotencyKey = randomUUID()) {
  return {
    authorization: `Bearer ${adminToken}`,
    'idempotency-key': idempotencyKey,
  };
}

async function issueAdminToken() {
  const db = getDatabase();
  const [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'ADMIN')).limit(1);
  if (!adminRole) {
    throw new Error('ADMIN role is required for emergency route tests');
  }

  const currentPermissions =
    adminRole.permissions && typeof adminRole.permissions === 'object'
      ? (adminRole.permissions as { grants?: Array<{ action: string; subject: string }> })
      : {};
  const mergedGrants = [...(currentPermissions.grants || [])];
  for (const grant of [{ action: 'update', subject: 'Screen' }]) {
    if (!mergedGrants.some((current) => current.action === grant.action && current.subject === grant.subject)) {
      mergedGrants.push(grant);
    }
  }

  await db
    .update(schema.roles)
    .set({ permissions: { grants: mergedGrants } })
    .where(eq(schema.roles.id, adminRole.id));

  const token = await generateAccessToken(testUser.id, testUser.email, adminRole.id, adminRole.name);
  await createSessionRepository().create({
    user_id: testUser.id,
    access_jti: token.jti,
    expires_at: token.expiresAt,
  });
  return token.token;
}

describe('Emergency routes production contract', () => {
  let server: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await issueAdminToken();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('allows multiple concurrent active emergencies and exposes sorted status details', async () => {
    const db = getDatabase();
    const groupId = randomUUID();
    const screenId = randomUUID();
    const mediaGlobal = randomUUID();
    const mediaGroup = randomUUID();

    await db.insert(schema.screenGroups).values({
      id: groupId,
      name: 'Emergency Status Group',
    });
    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Emergency Status Screen',
      status: 'ACTIVE',
    });
    await db.insert(schema.screenGroupMembers).values({
      group_id: groupId,
      screen_id: screenId,
    });
    await db.insert(schema.media).values([
      {
        id: mediaGlobal,
        name: 'Global Banner',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
      },
      {
        id: mediaGroup,
        name: 'Group Banner',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
      },
    ]);

    const globalResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: emergencyHeaders(adminToken),
      payload: {
        message: 'Global emergency',
        severity: 'LOW',
        media_id: mediaGlobal,
        target_all: true,
        audit_note: 'Global notice',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });
    expect(globalResponse.statusCode).toBe(HTTP_STATUS.CREATED);

    const groupResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: emergencyHeaders(adminToken),
      payload: {
        message: 'Group emergency',
        severity: 'CRITICAL',
        media_id: mediaGroup,
        screen_group_ids: [groupId],
        audit_note: 'Group notice',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });
    expect(groupResponse.statusCode).toBe(HTTP_STATUS.CREATED);

    const statusResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/emergency/status',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(statusResponse.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(statusResponse.body);
    expect(body.active).toBe(true);
    expect(body.active_count).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(body.active_emergencies)).toBe(true);
    expect(body.active_emergencies.length).toBeGreaterThanOrEqual(2);
    expect(body.emergency.scope).toBe('GROUP');
    expect(body.active_emergencies[0]).toEqual(
      expect.objectContaining({
        message: 'Group emergency',
        severity: 'CRITICAL',
        audit_note: 'Group notice',
      })
    );

    const groupSnapshotResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/screen-groups/${groupId}/snapshot?include_urls=true`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(groupSnapshotResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(groupSnapshotResponse.body).emergency).toEqual(
      expect.objectContaining({ message: 'Group emergency', severity: 'CRITICAL', scope: 'GROUP' })
    );

    await reconcileEmergencyTransitions({ maxRows: 100 });

    const refreshCommands = await db
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.screen_id, screenId));
    const pendingRefreshCommands = refreshCommands.filter((command) => command.type === 'REFRESH' && command.status === 'PENDING');
    const emergencyVersions = new Set(
      pendingRefreshCommands.map(
        (command) => (command.payload as { emergency_version?: string } | null)?.emergency_version
      )
    );
    expect(emergencyVersions).toContain(`${JSON.parse(globalResponse.body).id}:1`);
    expect(emergencyVersions).toContain(`${JSON.parse(groupResponse.body).id}:1`);
  });

  it('resolves severity, scope, recency, and UUID ties deterministically', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const groupId = randomUUID();
    const older = new Date('2026-09-07T10:00:00.000Z');
    const newer = new Date('2026-09-07T10:00:01.000Z');
    const [criticalGlobalTieLow, criticalGlobalTieHigh] = [randomUUID(), randomUUID()].sort();
    const ids = {
      lowGlobal: randomUUID(),
      criticalScreen: randomUUID(),
      criticalGroup: randomUUID(),
      criticalGlobalOlder: randomUUID(),
      criticalGlobalTieLow,
      criticalGlobalTieHigh,
    };

    await db.insert(schema.screenGroups).values({ id: groupId, name: 'Emergency Precedence Group' });
    await db.insert(schema.screens).values({ id: screenId, name: 'Emergency Precedence Screen', status: 'ACTIVE' });
    await db.insert(schema.screenGroupMembers).values({ group_id: groupId, screen_id: screenId });

    const inserted = await db.insert(schema.emergencies).values([
      {
        id: ids.lowGlobal,
        message: 'Low global',
        priority: 'LOW',
        target_all: true,
        screen_ids: [],
        screen_group_ids: [],
        triggered_by: testUser.id,
        created_at: older,
      },
      {
        id: ids.criticalScreen,
        message: 'Critical screen',
        priority: 'CRITICAL',
        target_all: false,
        screen_ids: [screenId],
        screen_group_ids: [],
        triggered_by: testUser.id,
        created_at: older,
      },
      {
        id: ids.criticalGroup,
        message: 'Critical group',
        priority: 'CRITICAL',
        target_all: false,
        screen_ids: [],
        screen_group_ids: [groupId],
        triggered_by: testUser.id,
        created_at: older,
      },
      {
        id: ids.criticalGlobalOlder,
        message: 'Critical global older',
        priority: 'CRITICAL',
        target_all: true,
        screen_ids: [],
        screen_group_ids: [],
        triggered_by: testUser.id,
        created_at: older,
      },
      {
        id: ids.criticalGlobalTieLow,
        message: 'Critical global tie low',
        priority: 'CRITICAL',
        target_all: true,
        screen_ids: [],
        screen_group_ids: [],
        triggered_by: testUser.id,
        created_at: newer,
      },
      {
        id: ids.criticalGlobalTieHigh,
        message: 'Critical global tie high',
        priority: 'CRITICAL',
        target_all: true,
        screen_ids: [],
        screen_group_ids: [],
        triggered_by: testUser.id,
        created_at: newer,
      },
    ]).returning();
    const byId = new Map(inserted.map((emergency) => [emergency.id, emergency]));
    const resolve = (selectedIds: string[]) => getActiveEmergencyForScreen(screenId, {
      db,
      groupIds: [groupId],
      activeEmergencies: selectedIds.map((id) => byId.get(id)!),
    });

    expect((await resolve([ids.lowGlobal, ids.criticalScreen]))?.id).toBe(ids.criticalScreen);
    expect((await resolve([ids.criticalScreen, ids.criticalGroup]))?.id).toBe(ids.criticalGroup);
    expect((await resolve([ids.criticalScreen, ids.criticalGroup, ids.criticalGlobalOlder]))?.id)
      .toBe(ids.criticalGlobalOlder);
    expect((await resolve([ids.criticalGlobalOlder, ids.criticalGlobalTieLow]))?.id)
      .toBe(ids.criticalGlobalTieLow);
    expect((await resolve([ids.criticalGlobalTieLow, ids.criticalGlobalTieHigh]))?.id)
      .toBe(ids.criticalGlobalTieHigh);
  });

  it('requires exactly one target scope and persists clear_reason on clear', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();
    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Emergency Clear Screen',
      status: 'ACTIVE',
    });
    await db.insert(schema.media).values({
      id: mediaId,
      name: 'Emergency Clear Media',
      type: 'IMAGE',
      status: 'READY',
      created_by: testUser.id,
    });

    const mixedScopeResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: emergencyHeaders(adminToken),
      payload: {
        message: 'Invalid mixed scope',
        target_all: true,
        screen_ids: [randomUUID()],
      },
    });

    expect(mixedScopeResponse.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);

    const triggerResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: emergencyHeaders(adminToken),
      payload: {
        message: 'Clearable emergency',
        media_id: mediaId,
        screen_ids: [screenId],
        audit_note: 'Need to clear later',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });

    expect(triggerResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const triggered = JSON.parse(triggerResponse.body);

    const clearResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/emergency/${triggered.id}/clear`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        clear_reason: 'Incident resolved',
      },
    });

    expect(clearResponse.statusCode).toBe(HTTP_STATUS.OK);
    const cleared = JSON.parse(clearResponse.body);
    expect(cleared.clear_reason).toBe('Incident resolved');
    expect(cleared.cleared_by).toBe(testUser.id);

    const [stored] = await db.select().from(schema.emergencies).where(eq(schema.emergencies.id, triggered.id)).limit(1);
    expect(stored?.clear_reason).toBe('Incident resolved');

    const repeatedClear = await server.inject({
      method: 'POST',
      url: `/api/v1/emergency/${triggered.id}/clear`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { clear_reason: 'Repeated request must not create another transition' },
    });
    expect(repeatedClear.statusCode).toBe(HTTP_STATUS.OK);
    expect(repeatedClear.headers['idempotent-replay']).toBe('true');

    const transitions = (await db.select().from(schema.emergencyTransitionOutbox))
      .filter((row) => row.emergency_id === triggered.id);
    expect(transitions.map((row) => `${row.transition}:${row.transition_version}`).sort()).toEqual([
      'CLEAR:2',
      'START:1',
    ]);

    await reconcileEmergencyTransitions({ maxRows: 100 });
    const commands = (await db.select().from(schema.deviceCommands).where(eq(schema.deviceCommands.screen_id, screenId)))
      .filter((command) => command.type === 'REFRESH');
    const versions = new Set(
      commands.map((command) => (command.payload as { emergency_version?: string } | null)?.emergency_version)
    );
    expect(versions).toContain(`${triggered.id}:1`);
    expect(versions).toContain(`${triggered.id}:2`);
  });

  it('requires an idempotency key, replays identical requests, and rejects key reuse', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Message Emergency Capable Screen',
      status: 'ACTIVE',
      device_info: {
        player_capabilities: { features: ['message_emergency_v1'] },
      },
    });

    const payload = {
      message: 'Native message emergency',
      severity: 'HIGH',
      screen_ids: [screenId],
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const missingKey = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: { authorization: `Bearer ${adminToken}` },
      payload,
    });
    expect(missingKey.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);

    const key = randomUUID();
    const first = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: emergencyHeaders(adminToken, key),
      payload,
    });
    expect(first.statusCode).toBe(HTTP_STATUS.CREATED);

    const replay = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: emergencyHeaders(adminToken, key),
      payload,
    });
    expect(replay.statusCode).toBe(HTTP_STATUS.OK);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(JSON.parse(replay.body).id).toBe(JSON.parse(first.body).id);

    const mismatch = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: emergencyHeaders(adminToken, key),
      payload: { ...payload, message: 'Different request' },
    });
    expect(mismatch.statusCode).toBe(HTTP_STATUS.CONFLICT);
  });

  it('delivers a large emergency transition across every 100-screen page exactly once', async () => {
    const db = getDatabase();
    const screenIds = Array.from({ length: 205 }, () => randomUUID()).sort();
    await db.insert(schema.screens).values(
      screenIds.map((id, index) => ({
        id,
        name: `Paged Emergency Screen ${index}`,
        status: 'ACTIVE' as const,
      }))
    );

    const emergencyId = randomUUID();
    const [emergency] = await db.insert(schema.emergencies).values({
      id: emergencyId,
      message: 'Paged fleet emergency',
      severity: 'CRITICAL',
      screen_ids: screenIds,
      screen_group_ids: [],
      target_all: false,
      triggered_by: testUser.id,
      transition_version: 1,
      is_active: true,
    }).returning();
    expect(emergency).toBeDefined();

    const [transition] = await db.insert(schema.emergencyTransitionOutbox).values({
      emergency_id: emergencyId,
      transition: 'START',
      transition_version: 1,
      selector: { target_all: false, screen_ids: screenIds, screen_group_ids: [] },
      actor_id: testUser.id,
    }).returning();

    await reconcileEmergencyTransitions({ transitionId: transition!.id });
    await reconcileEmergencyTransitions({ transitionId: transition!.id });

    const commands = (await db.select().from(schema.deviceCommands))
      .filter((command) => screenIds.includes(command.screen_id))
      .filter((command) =>
        command.type === 'REFRESH'
        && (command.payload as { emergency_version?: string } | null)?.emergency_version === `${emergencyId}:1`
      );
    expect(commands).toHaveLength(screenIds.length);
    expect(new Set(commands.map((command) => command.screen_id)).size).toBe(screenIds.length);

    const [storedTransition] = await db
      .select()
      .from(schema.emergencyTransitionOutbox)
      .where(eq(schema.emergencyTransitionOutbox.id, transition!.id))
      .limit(1);
    expect(storedTransition?.status).toBe('COMPLETED');
  });

  it('delivers clear to removed group members and current group members', async () => {
    const db = getDatabase();
    const groupId = randomUUID();
    const originalScreenId = randomUUID();
    const replacementScreenId = randomUUID();
    const mediaId = randomUUID();
    await db.insert(schema.screenGroups).values({ id: groupId, name: 'Mutable Emergency Group' });
    await db.insert(schema.screens).values([
      { id: originalScreenId, name: 'Original Group Screen', status: 'ACTIVE' },
      { id: replacementScreenId, name: 'Replacement Group Screen', status: 'ACTIVE' },
    ]);
    await db.insert(schema.screenGroupMembers).values({ group_id: groupId, screen_id: originalScreenId });
    await db.insert(schema.media).values({
      id: mediaId,
      name: 'Group Membership Emergency Media',
      type: 'IMAGE',
      status: 'READY',
      created_by: testUser.id,
    });

    const trigger = await server.inject({
      method: 'POST',
      url: '/api/v1/emergency/trigger',
      headers: emergencyHeaders(adminToken),
      payload: {
        message: 'Membership-changing emergency',
        media_id: mediaId,
        screen_group_ids: [groupId],
      },
    });
    expect(trigger.statusCode).toBe(HTTP_STATUS.CREATED);
    const emergencyId = JSON.parse(trigger.body).id as string;
    await reconcileEmergencyTransitions({ maxRows: 100 });

    await db.delete(schema.screenGroupMembers).where(eq(schema.screenGroupMembers.screen_id, originalScreenId));
    await db.insert(schema.screenGroupMembers).values({ group_id: groupId, screen_id: replacementScreenId });

    const clear = await server.inject({
      method: 'POST',
      url: `/api/v1/emergency/${emergencyId}/clear`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { clear_reason: 'Membership changed during incident' },
    });
    expect(clear.statusCode).toBe(HTTP_STATUS.OK);
    await reconcileEmergencyTransitions({ maxRows: 100 });

    const clearCommands = (await db
      .select()
      .from(schema.deviceCommands)
      .where(inArray(schema.deviceCommands.screen_id, [originalScreenId, replacementScreenId])))
      .filter((command) =>
        command.type === 'REFRESH'
        && (command.payload as { emergency_version?: string } | null)?.emergency_version === `${emergencyId}:2`
      );
    expect(new Set(clearCommands.map((command) => command.screen_id))).toEqual(
      new Set([originalScreenId, replacementScreenId])
    );
  });
});
