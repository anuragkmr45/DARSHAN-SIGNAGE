import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { closeTestServer, createTestActor, createTestServer } from '@/test/helpers';
import { getDatabase, schema } from '@/db';

describe('Proof of play export', () => {
  let server: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = (await createTestActor('SUPER_ADMIN')).token;
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('returns CSV headers even when there are no proof-of-play rows', async () => {
    const db = getDatabase();
    await db.delete(schema.proofOfPlay);

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/proof-of-play/export?screen_id=${randomUUID()}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body.trim()).toBe('id,screen_id,media_id,presentation_id,page_number,started_at,ended_at,created_at');
  });

  it('returns the selected page in list and CSV export contracts', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();
    const now = new Date();
    const [record] = await db.insert(schema.proofOfPlay).values({
      screen_id: screenId,
      media_id: mediaId,
      page_number: 4,
      started_at: new Date(now.getTime() - 10_000),
      ended_at: now,
      idempotency_key: randomUUID().replace(/-/g, ''),
    }).returning();

    const list = await server.inject({
      method: 'GET',
      url: `/api/v1/proof-of-play?screen_id=${screenId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).items).toEqual([
      expect.objectContaining({ id: record.id, page_number: 4 }),
    ]);

    const exported = await server.inject({
      method: 'GET',
      url: `/api/v1/proof-of-play/export?screen_id=${screenId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain('presentation_id,page_number,started_at');
    expect(exported.body).toContain(`,${mediaId},,4,`);
  });
});
