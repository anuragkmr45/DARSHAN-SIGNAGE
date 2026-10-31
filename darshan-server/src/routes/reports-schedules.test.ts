import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { closeTestServer, createTestActor, createTestServer, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';

async function issueSuperAdminToken() {
  return (await createTestActor('SUPER_ADMIN')).token;
}

describe('Schedule activity report', () => {
  let server: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await issueSuperAdminToken();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('returns grouped schedule activity for screens and screen groups', async () => {
    const db = getDatabase();
    const scheduleId = randomUUID();
    const snapshotId = randomUUID();
    const publishId = randomUUID();
    const screenId = randomUUID();
    const groupId = randomUUID();

    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Lobby Screen',
      status: 'ACTIVE',
    });

    await db.insert(schema.screenGroups).values({
      id: groupId,
      name: 'Ground Floor Group',
    });

    await db.insert(schema.schedules).values({
      id: scheduleId,
      name: 'Morning Rotation',
      start_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
      end_at: new Date(Date.now() + 2 * 60 * 60 * 1000),
      created_by: testUser.id,
    });

    await db.insert(schema.scheduleSnapshots).values({
      id: snapshotId,
      schedule_id: scheduleId,
      payload: { items: [] },
    });

    await db.insert(schema.publishes).values({
      id: publishId,
      schedule_id: scheduleId,
      snapshot_id: snapshotId,
      published_by: testUser.id,
      status: 'ACTIVE',
      published_at: new Date(Date.now() - 60 * 60 * 1000),
    });

    await db.insert(schema.publishTargets).values([
      {
        id: randomUUID(),
        publish_id: publishId,
        screen_id: screenId,
        status: 'SUCCESS',
      },
      {
        id: randomUUID(),
        publish_id: publishId,
        screen_group_id: groupId,
        status: 'PENDING',
      },
    ]);

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reports/schedules?days=7',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary.schedules).toBeGreaterThan(0);
    expect(body.summary.target_events).toBeGreaterThanOrEqual(2);
    expect(body.by_screen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_id: screenId,
          target_name: 'Lobby Screen',
        }),
      ]),
    );
    expect(body.by_group).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_id: groupId,
          target_name: 'Ground Floor Group',
        }),
      ]),
    );
  });
});
