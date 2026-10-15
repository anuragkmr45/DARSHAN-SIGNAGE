import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDatabase, schema } from '@/db';
import { closeTestServer, createTestServer, generateTestToken, testUser } from '@/test/helpers';

describe('presentation document page selection', () => {
  let server: FastifyInstance;
  let token: string;
  const layoutId = randomUUID();
  const presentationId = randomUUID();
  const documentId = randomUUID();
  const imageId = randomUUID();
  const videoId = randomUUID();

  beforeAll(async () => {
    server = await createTestServer();
    token = await generateTestToken(testUser.id, 'ADMIN');
    const db = getDatabase();
    await db.insert(schema.layouts).values({
      id: layoutId,
      name: 'Document page layout',
      aspect_ratio: '16:9',
      spec: { slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1 }] },
      created_by: testUser.id,
    });
    await db.insert(schema.presentations).values({
      id: presentationId,
      name: 'Document page presentation',
      layout_id: layoutId,
      created_by: testUser.id,
    });
    await db.insert(schema.media).values([
      {
        id: documentId,
        name: 'Five page handbook.pdf',
        type: 'DOCUMENT',
        status: 'READY',
        source_content_type: 'application/pdf',
        page_count: 5,
        created_by: testUser.id,
      },
      {
        id: imageId,
        name: 'Poster.png',
        type: 'IMAGE',
        status: 'READY',
        source_content_type: 'image/png',
        created_by: testUser.id,
      },
      {
        id: videoId,
        name: 'Loop fixture.mp4',
        type: 'VIDEO',
        status: 'READY',
        source_content_type: 'video/mp4',
        duration_seconds: 3,
        created_by: testUser.id,
      },
    ]);
    await db.insert(schema.presentationSlotItems).values({
      presentation_id: presentationId,
      slot_id: 'main',
      media_id: documentId,
      order: 0,
      duration_seconds: 10,
      page_number: 1,
    });
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  const replace = (items: unknown[]) => server.inject({
    method: 'PUT',
    url: `/api/v1/presentations/${presentationId}/slots`,
    headers: { authorization: `Bearer ${token}` },
    payload: { items },
  });

  const storedSlots = () => getDatabase()
    .select()
    .from(schema.presentationSlotItems)
    .where(eq(schema.presentationSlotItems.presentation_id, presentationId))
    .orderBy(asc(schema.presentationSlotItems.order));

  it('stores two occurrences of the same document with independent pages', async () => {
    const response = await replace([
      { slot_id: 'main', media_id: documentId, order: 0, duration_seconds: 10, page_number: 2 },
      { slot_id: 'main', media_id: documentId, order: 1, duration_seconds: 20, page_number: 5 },
    ]);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).items).toEqual([
      expect.objectContaining({ media_id: documentId, order: 0, duration_seconds: 10, page_number: 2 }),
      expect.objectContaining({ media_id: documentId, order: 1, duration_seconds: 20, page_number: 5 }),
    ]);
    expect((await storedSlots()).map((item) => [item.order, item.duration_seconds, item.page_number])).toEqual([
      [0, 10, 2],
      [1, 20, 5],
    ]);
  });

  it('rejects one invalid page before replacing any existing rows', async () => {
    const before = await storedSlots();
    const response = await replace([
      { slot_id: 'main', media_id: documentId, order: 0, page_number: 3 },
      { slot_id: 'main', media_id: documentId, order: 1, page_number: 6 },
    ]);

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error).toMatchObject({
      code: 'DOCUMENT_PAGE_OUT_OF_RANGE',
      details: { media_id: documentId, requested_page: 6, page_count: 5 },
    });
    const after = await storedSlots();
    expect(after.map((item) => item.id)).toEqual(before.map((item) => item.id));
    expect(after.map((item) => item.page_number)).toEqual([2, 5]);
  });

  it('rejects page over-posting for non-document media', async () => {
    const response = await replace([
      { slot_id: 'main', media_id: imageId, order: 0, page_number: 1 },
    ]);

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error.code).toBe('DOCUMENT_PAGE_NOT_APPLICABLE');
    expect(await getDatabase()
      .select({ count: schema.presentationSlotItems.id })
      .from(schema.presentationSlotItems)
      .where(and(
        eq(schema.presentationSlotItems.presentation_id, presentationId),
        eq(schema.presentationSlotItems.media_id, imageId)
      ))).toEqual([]);
  });

  it('round-trips video loop flags and normalizes non-video over-posting', async () => {
    const response = await replace([
      { slot_id: 'main', media_id: videoId, order: 0, duration_seconds: 12, loop_enabled: true },
      { slot_id: 'main', media_id: imageId, order: 1, duration_seconds: 5, loop_enabled: true },
    ]);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).items).toEqual([
      expect.objectContaining({ media_id: videoId, order: 0, loop_enabled: true }),
      expect.objectContaining({ media_id: imageId, order: 1, loop_enabled: false }),
    ]);

    const listResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/presentations/${presentationId}/slots`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body).items).toEqual([
      expect.objectContaining({ media_id: videoId, loop_enabled: true }),
      expect.objectContaining({ media_id: imageId, loop_enabled: false }),
    ]);

    const detailResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/presentations/${presentationId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(JSON.parse(detailResponse.body).slots).toEqual([
      expect.objectContaining({ media_id: videoId, loop_enabled: true }),
      expect.objectContaining({ media_id: imageId, loop_enabled: false }),
    ]);
  });

  it('rejects duplicate explicit order in the single-item slot endpoint', async () => {
    await replace([
      { slot_id: 'main', media_id: videoId, order: 0, duration_seconds: 12, loop_enabled: true },
    ]);

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/presentations/${presentationId}/slots`,
      headers: { authorization: `Bearer ${token}` },
      payload: { slot_id: 'main', media_id: videoId, order: 0, duration_seconds: 12, loop_enabled: true },
    });

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error).toMatchObject({
      details: { reason: 'PRESENTATION_SLOT_ORDER_CONFLICT', slot_id: 'main', order: 0 },
    });
  });
});
