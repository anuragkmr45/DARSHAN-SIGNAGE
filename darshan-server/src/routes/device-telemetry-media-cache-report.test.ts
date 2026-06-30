import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

import { createTestServer, closeTestServer, generateTestToken, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';

describe('device media/cache failure reporting', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  async function seedDevice() {
    const db = getDatabase();
    const screenId = randomUUID();
    const serial = `media-cache-${randomUUID()}`;

    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Media Cache Report Screen',
      status: 'ACTIVE',
    });

    await db.insert(schema.deviceCertificates).values({
      screen_id: screenId,
      serial,
      certificate_pem: 'dummy-cert',
      expires_at: new Date(Date.now() + 60_000),
    });

    return { db, screenId, serial };
  }

  it('stores device media/cache failure reports and exposes them to CMS readers', async () => {
    const { db, screenId, serial } = await seedDevice();
    const mediaId = randomUUID();
    const snapshotId = randomUUID();
    const scheduleId = randomUUID();
    const reportedAt = new Date().toISOString();

    const reportResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/device/${screenId}/media-cache-report`,
      headers: {
        'x-device-serial': serial,
      },
      payload: {
        event_type: 'DOWNLOAD_FAILED',
        severity: 'ERROR',
        source: 'SNAPSHOT',
        media_id: mediaId,
        error_code: 'HTTP_503',
        http_status: 503,
        message: 'CDN returned 503',
        cache_key: mediaId,
        url_host: 'cdn.example.test',
        url_path_hash: 'abc123',
        snapshot_id: snapshotId,
        schedule_id: scheduleId,
        playback_mode: 'normal',
        attempt_count: 2,
        metadata: {
          retryable: true,
        },
        reported_at: reportedAt,
      },
    });

    expect(reportResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const created = JSON.parse(reportResponse.body);
    expect(created.success).toBe(true);
    expect(created.id).toBeTruthy();

    const [stored] = await db
      .select()
      .from(schema.mediaCacheReports)
      .where(eq(schema.mediaCacheReports.id, created.id));
    expect(stored?.screen_id).toBe(screenId);
    expect(stored?.media_id).toBe(mediaId);
    expect(stored?.event_type).toBe('DOWNLOAD_FAILED');
    expect(stored?.status).toBe('OPEN');
    expect(stored?.http_status).toBe(503);

    const token = await generateTestToken(testUser.id);
    const cmsResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/screens/${screenId}/media-cache-reports/recent?limit=10`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(cmsResponse.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(cmsResponse.body);
    expect(body.screen_id).toBe(screenId);
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]).toMatchObject({
      id: created.id,
      media_id: mediaId,
      event_type: 'DOWNLOAD_FAILED',
      severity: 'ERROR',
      source: 'SNAPSHOT',
      error_code: 'HTTP_503',
      http_status: 503,
      message: 'CDN returned 503',
    });
  });
});
