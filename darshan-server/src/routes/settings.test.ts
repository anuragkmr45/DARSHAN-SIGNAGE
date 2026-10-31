import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { closeTestServer, createTestServer, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';
import { generateAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';
import {
  DEFAULT_MEDIA_SETTING_KEY,
  DEFAULT_MEDIA_TARGETS_SETTING_KEY,
  DEFAULT_MEDIA_VARIANTS_SETTING_KEY,
  resolveDefaultMediaForScreen,
} from '@/utils/default-media';
import { BRANDING_SETTINGS_KEY } from '@/utils/settings';

async function issueSuperAdminToken() {
  const db = getDatabase();
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'SUPER_ADMIN')).limit(1);
  if (!role) {
    throw new Error('SUPER_ADMIN role is required for settings route tests');
  }

  const token = await generateAccessToken(testUser.id, testUser.email, role.id, role.name);
  await createSessionRepository().create({
    user_id: testUser.id,
    access_jti: token.jti,
    expires_at: token.expiresAt,
  });
  return token.token;
}

describe('Settings routes - dimension-wise default media', () => {
  let server: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await issueSuperAdminToken();
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db
      .delete(schema.settings)
      .where(
        inArray(schema.settings.key, [
          DEFAULT_MEDIA_SETTING_KEY,
          DEFAULT_MEDIA_VARIANTS_SETTING_KEY,
          DEFAULT_MEDIA_TARGETS_SETTING_KEY,
        ])
      );
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('stores and returns default media variants with embedded media details', async () => {
    const db = getDatabase();
    const globalMediaId = randomUUID();
    const landscapeMediaId = randomUUID();
    const portraitMediaId = randomUUID();
    const landscapeRatio = '101:99';
    const portraitRatio = '77:123';

    await db.insert(schema.media).values([
      {
        id: globalMediaId,
        name: 'Global Fallback',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
        width: 1280,
        height: 720,
      },
      {
        id: landscapeMediaId,
        name: 'Landscape Fallback',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
        width: 1920,
        height: 1080,
      },
      {
        id: portraitMediaId,
        name: 'Portrait Fallback',
        type: 'VIDEO',
        status: 'READY',
        created_by: testUser.id,
        width: 1080,
        height: 1920,
        duration_seconds: 15,
      },
    ]);

    const globalResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        media_id: globalMediaId,
      },
    });

    expect(globalResponse.statusCode).toBe(HTTP_STATUS.OK);

    const variantsResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media/variants',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        variants: {
          [landscapeRatio]: landscapeMediaId,
          [portraitRatio]: portraitMediaId,
          '4:3': null,
        },
      },
    });

    expect(variantsResponse.statusCode).toBe(HTTP_STATUS.OK);
    const variantsBody = JSON.parse(variantsResponse.body);
    expect(variantsBody.global_media_id).toBe(globalMediaId);
    expect(variantsBody.global_media?.id).toBe(globalMediaId);
    expect(variantsBody.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aspect_ratio: landscapeRatio,
          media_id: landscapeMediaId,
          media: expect.objectContaining({ id: landscapeMediaId, name: 'Landscape Fallback' }),
        }),
        expect.objectContaining({
          aspect_ratio: portraitRatio,
          media_id: portraitMediaId,
          media: expect.objectContaining({ id: portraitMediaId, name: 'Portrait Fallback' }),
        }),
      ])
    );

    expect(variantsBody.variants).toHaveLength(2);
  });

  it('rejects unknown media ids in default media variants payload', async () => {
    const response = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media/variants',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        variants: {
          '16:9': randomUUID(),
        },
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.message).toBe('Media not found');
  });

  it('rejects deleted media in authoring and never resolves a branding signed URL for it', async () => {
    const db = getDatabase();
    const mediaId = randomUUID();
    await db.insert(schema.media).values({
      id: mediaId,
      name: 'Deleted branding image',
      type: 'IMAGE',
      status: 'READY',
      source_bucket: 'media-source',
      source_object_key: `deleted-branding/${mediaId}.png`,
      created_by: testUser.id,
      deleted_at: new Date(),
      deleted_by: testUser.id,
    });

    const defaultResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { media_id: mediaId },
    });
    expect(defaultResponse.statusCode).toBe(HTTP_STATUS.NOT_FOUND);

    const brandingResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/branding',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        app_name: 'DARSHAN CMS',
        logo_media_id: mediaId,
        icon_media_id: null,
        favicon_media_id: null,
      },
    });
    expect(brandingResponse.statusCode).toBe(HTTP_STATUS.NOT_FOUND);

    await db.insert(schema.settings).values({
      key: BRANDING_SETTINGS_KEY,
      value: {
        app_name: 'DARSHAN CMS',
        logo_media_id: mediaId,
        icon_media_id: null,
        favicon_media_id: null,
      },
    }).onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: {
        app_name: 'DARSHAN CMS',
        logo_media_id: mediaId,
        icon_media_id: null,
        favicon_media_id: null,
      } },
    });
    const readResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/settings/branding',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(readResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(readResponse.body).logo_url).toBeNull();
  });

  it('rejects non-ready defaults and ignores legacy non-ready assignments at playback time', async () => {
    const db = getDatabase();
    const processingMediaId = randomUUID();
    const failedMediaId = randomUUID();
    const readyMediaId = randomUUID();
    const screenId = randomUUID();

    await db.insert(schema.media).values([
      {
        id: processingMediaId,
        name: 'Converting document',
        type: 'DOCUMENT',
        status: 'PROCESSING',
        source_content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: testUser.id,
      },
      {
        id: failedMediaId,
        name: 'Failed document',
        type: 'DOCUMENT',
        status: 'FAILED',
        source_content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        created_by: testUser.id,
      },
      {
        id: readyMediaId,
        name: 'Ready global fallback',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
      },
    ]);
    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Legacy default media screen',
      status: 'ACTIVE',
      aspect_ratio: '16:9',
    });

    const globalResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { media_id: processingMediaId },
    });
    expect(globalResponse.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(JSON.parse(globalResponse.body).error.details).toEqual({
      reason: 'MEDIA_NOT_READY',
      media_ids: [processingMediaId],
    });

    const variantsResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media/variants',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { variants: { '16:9': failedMediaId } },
    });
    expect(variantsResponse.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(JSON.parse(variantsResponse.body).error.details.reason).toBe('MEDIA_NOT_READY');

    const targetsResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media/targets',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        assignments: [{
          target_type: 'SCREEN',
          target_id: screenId,
          media_id: processingMediaId,
          aspect_ratio: '16:9',
        }],
      },
    });
    expect(targetsResponse.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(JSON.parse(targetsResponse.body).error.details.reason).toBe('MEDIA_NOT_READY');

    // Simulate settings written by an older release before READY enforcement.
    await db.insert(schema.settings).values([
      { key: DEFAULT_MEDIA_SETTING_KEY, value: readyMediaId },
      { key: DEFAULT_MEDIA_VARIANTS_SETTING_KEY, value: { '16:9': failedMediaId } },
      {
        key: DEFAULT_MEDIA_TARGETS_SETTING_KEY,
        value: [{
          target_type: 'SCREEN',
          target_id: screenId,
          media_id: processingMediaId,
          aspect_ratio: '16:9',
        }],
      },
    ]);

    await expect(resolveDefaultMediaForScreen({ id: screenId, aspect_ratio: '16:9' }, db)).resolves.toMatchObject({
      source: 'GLOBAL',
      media_id: readyMediaId,
    });
  });

  it('stores target-based default media assignments and resolves them for screens', async () => {
    const db = getDatabase();
    const screenMediaId = randomUUID();
    const groupMediaId = randomUUID();
    const directScreenId = randomUUID();
    const groupScreenId = randomUUID();
    const otherScreenId = randomUUID();
    const groupId = randomUUID();

    await db.delete(schema.settings).where(
      inArray(schema.settings.key, ['default_media_id', 'default_media_variants', 'default_media_targets'])
    );

    await db.insert(schema.media).values([
      {
        id: screenMediaId,
        name: 'Direct screen fallback',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
        width: 1920,
        height: 1080,
      },
      {
        id: groupMediaId,
        name: 'Group fallback',
        type: 'VIDEO',
        status: 'READY',
        created_by: testUser.id,
        width: 1920,
        height: 1080,
      },
    ]);

    await db.insert(schema.screens).values([
      {
        id: directScreenId,
        name: 'Direct screen',
        aspect_ratio: '16:9',
        status: 'ACTIVE',
      },
      {
        id: groupScreenId,
        name: 'Grouped screen',
        aspect_ratio: '16:9',
        status: 'ACTIVE',
      },
      {
        id: otherScreenId,
        name: 'Other screen',
        aspect_ratio: '9:16',
        status: 'ACTIVE',
      },
    ]);

    await db.insert(schema.screenGroups).values({
      id: groupId,
      name: 'Landscape group',
    });
    await db.insert(schema.screenGroupMembers).values({
      group_id: groupId,
      screen_id: groupScreenId,
    });

    const updateResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media/targets',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        assignments: [
          {
            target_type: 'SCREEN',
            target_id: directScreenId,
            media_id: screenMediaId,
            aspect_ratio: '16:9',
          },
          {
            target_type: 'GROUP',
            target_id: groupId,
            media_id: groupMediaId,
            aspect_ratio: '16:9',
          },
        ],
      },
    });

    expect(updateResponse.statusCode).toBe(HTTP_STATUS.OK);
    const updateBody = JSON.parse(updateResponse.body);
    expect(updateBody.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_type: 'SCREEN',
          target_id: directScreenId,
          media_id: screenMediaId,
          media: expect.objectContaining({ id: screenMediaId }),
        }),
        expect.objectContaining({
          target_type: 'GROUP',
          target_id: groupId,
          media_id: groupMediaId,
          media: expect.objectContaining({ id: groupMediaId }),
        }),
      ])
    );

    const directResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/screens/${directScreenId}/default-media`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(directResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(directResponse.body)).toEqual(
      expect.objectContaining({
        source: 'SCREEN',
        aspect_ratio: '16:9',
        media_id: screenMediaId,
        media: expect.objectContaining({ id: screenMediaId }),
      })
    );

    const groupedResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/screens/${groupScreenId}/default-media`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(groupedResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(groupedResponse.body)).toEqual(
      expect.objectContaining({
        source: 'GROUP',
        aspect_ratio: '16:9',
        media_id: groupMediaId,
        media: expect.objectContaining({ id: groupMediaId }),
      })
    );

    const unmatchedResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/screens/${otherScreenId}/default-media`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(unmatchedResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(unmatchedResponse.body)).toEqual(
      expect.objectContaining({
        source: 'NONE',
        aspect_ratio: '9:16',
        media_id: null,
        media: null,
      })
    );
  });

  it('rejects group assignments when the group mixes aspect ratios', async () => {
    const db = getDatabase();
    const mediaId = randomUUID();
    const groupId = randomUUID();

    await db.insert(schema.media).values({
      id: mediaId,
      name: 'Mixed ratio media',
      type: 'IMAGE',
      status: 'READY',
      created_by: testUser.id,
    });

    const screenIds = [randomUUID(), randomUUID()];
    await db.insert(schema.screens).values([
      {
        id: screenIds[0],
        name: 'Landscape member',
        aspect_ratio: '16:9',
        status: 'ACTIVE',
      },
      {
        id: screenIds[1],
        name: 'Portrait member',
        aspect_ratio: '9:16',
        status: 'ACTIVE',
      },
    ]);

    await db.insert(schema.screenGroups).values({
      id: groupId,
      name: 'Mixed group',
    });
    await db.insert(schema.screenGroupMembers).values([
      { group_id: groupId, screen_id: screenIds[0] },
      { group_id: groupId, screen_id: screenIds[1] },
    ]);

    const response = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media/targets',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        assignments: [
          {
            target_type: 'GROUP',
            target_id: groupId,
            media_id: mediaId,
            aspect_ratio: '16:9',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    const body = JSON.parse(response.body);
    expect(body.error.message).toContain('must contain screens with the same aspect ratio');
  });

  it('preserves an omitted group priority and rejects one of two concurrent stale saves', async () => {
    const db = getDatabase();
    const firstMediaId = randomUUID();
    const replacementMediaId = randomUUID();
    const screenId = randomUUID();
    const groupId = randomUUID();

    await db.insert(schema.media).values([
      {
        id: firstMediaId,
        name: 'Priority fallback one',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
      },
      {
        id: replacementMediaId,
        name: 'Priority fallback two',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
      },
    ]);
    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Priority concurrency screen',
      aspect_ratio: '16:9',
      status: 'ACTIVE',
    });
    await db.insert(schema.screenGroups).values({ id: groupId, name: 'Priority concurrency group' });
    await db.insert(schema.screenGroupMembers).values({ group_id: groupId, screen_id: screenId });

    const createResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media/targets',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        assignments: [{
          target_type: 'GROUP',
          target_id: groupId,
          media_id: firstMediaId,
          aspect_ratio: '16:9',
          priority: 20,
        }],
      },
    });
    expect(createResponse.statusCode).toBe(HTTP_STATUS.OK);
    const initialRevision = JSON.parse(createResponse.body).revision as string;

    const replacementResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media/targets',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        expected_revision: initialRevision,
        assignments: [{
          target_type: 'GROUP',
          target_id: groupId,
          media_id: replacementMediaId,
          aspect_ratio: '16:9',
        }],
      },
    });
    expect(replacementResponse.statusCode).toBe(HTTP_STATUS.OK);
    const replacementBody = JSON.parse(replacementResponse.body);
    expect(replacementBody.assignments[0]).toMatchObject({ media_id: replacementMediaId, priority: 20 });

    const concurrentPayload = (priority: number) => ({
      method: 'PUT' as const,
      url: '/api/v1/settings/default-media/targets',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        expected_revision: replacementBody.revision,
        assignments: [{
          target_type: 'GROUP',
          target_id: groupId,
          media_id: replacementMediaId,
          aspect_ratio: '16:9',
          priority,
        }],
      },
    });
    const concurrentResponses = await Promise.all([
      server.inject(concurrentPayload(40)),
      server.inject(concurrentPayload(80)),
    ]);

    expect(concurrentResponses.map((response) => response.statusCode).sort()).toEqual([
      HTTP_STATUS.OK,
      HTTP_STATUS.CONFLICT,
    ]);
    const conflict = concurrentResponses.find((response) => response.statusCode === HTTP_STATUS.CONFLICT);
    expect(JSON.parse(conflict!.body).error.details.reason).toBe('DEFAULT_MEDIA_TARGETS_STALE');
  });

  it('queues immediate refresh commands for all screens when default media settings change', async () => {
    const db = getDatabase();
    const globalMediaId = randomUUID();
    const variantMediaId = randomUUID();
    const targetMediaId = randomUUID();
    const screenOneId = randomUUID();
    const screenTwoId = randomUUID();

    await db.insert(schema.media).values([
      {
        id: globalMediaId,
        name: 'Immediate Global Fallback',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
        width: 1920,
        height: 1080,
      },
      {
        id: variantMediaId,
        name: 'Immediate Variant Fallback',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
        width: 1920,
        height: 1080,
      },
      {
        id: targetMediaId,
        name: 'Immediate Target Fallback',
        type: 'IMAGE',
        status: 'READY',
        created_by: testUser.id,
        width: 1920,
        height: 1080,
      },
    ]);

    await db.insert(schema.screens).values([
      {
        id: screenOneId,
        name: 'Default Media Refresh Screen One',
        status: 'ACTIVE',
        aspect_ratio: '16:9',
      },
      {
        id: screenTwoId,
        name: 'Default Media Refresh Screen Two',
        status: 'ACTIVE',
        aspect_ratio: '16:9',
      },
    ]);

    const globalResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        media_id: globalMediaId,
      },
    });

    expect(globalResponse.statusCode).toBe(HTTP_STATUS.OK);

    const variantsResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media/variants',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        variants: {
          '16:9': variantMediaId,
        },
      },
    });

    expect(variantsResponse.statusCode).toBe(HTTP_STATUS.OK);

    const targetsResponse = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/default-media/targets',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        assignments: [
          {
            target_type: 'SCREEN',
            target_id: screenOneId,
            media_id: targetMediaId,
            aspect_ratio: '16:9',
          },
        ],
      },
    });

    expect(targetsResponse.statusCode).toBe(HTTP_STATUS.OK);

    const commands = await db
      .select()
      .from(schema.deviceCommands)
      .where(inArray(schema.deviceCommands.screen_id, [screenOneId, screenTwoId] as string[]));

    const refreshCommands = commands.filter(
      (command) =>
        command.type === 'REFRESH' &&
        (command.payload as { reason?: string } | null)?.reason === 'DEFAULT_MEDIA'
    );

    expect(refreshCommands).toHaveLength(6);
    expect(refreshCommands.filter((command) => command.screen_id === screenOneId)).toHaveLength(3);
    expect(refreshCommands.filter((command) => command.screen_id === screenTwoId)).toHaveLength(3);
  });
});
