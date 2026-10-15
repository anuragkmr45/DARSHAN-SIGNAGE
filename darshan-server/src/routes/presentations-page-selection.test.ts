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
});
