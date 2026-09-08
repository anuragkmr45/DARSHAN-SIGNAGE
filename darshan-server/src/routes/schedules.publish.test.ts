import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { closeTestServer, createTestServer, testUser } from '@/test/helpers';
import { createSessionRepository } from '@/db/repositories/session';
import { generateAccessToken } from '@/auth/jwt';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';
import { getNativeCompatibilityIssues } from '@/services/native-media-renditions';

async function issueAdminToken() {
  const db = getDatabase();
  const [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'SUPER_ADMIN')).limit(1);
  if (!adminRole) {
    throw new Error('SUPER_ADMIN role is required for schedule publish tests');
  }

  const currentPermissions =
    adminRole.permissions && typeof adminRole.permissions === 'object'
      ? (adminRole.permissions as { grants?: Array<{ action: string; subject: string }> })
      : {};
  const mergedGrants = [...(currentPermissions.grants || [])];
  for (const grant of [
    { action: 'update', subject: 'Schedule' },
    { action: 'read', subject: 'Screen' },
  ]) {
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

describe('Schedule publish codec validation', () => {
  let server: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await issueAdminToken();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('blocks publish when a target screen does not support the required media codec', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();
    const presentationId = randomUUID();
    const scheduleId = randomUUID();
    const scheduleItemId = randomUUID();
    const now = new Date();
    const startAt = new Date(now.getTime() + 5 * 60 * 1000);
    const endAt = new Date(now.getTime() + 30 * 60 * 1000);

    await db.insert(schema.screens).values({
      id: screenId,
      name: 'VP9 Only Screen',
      status: 'OFFLINE',
      device_info: {
        codecs: ['vp9'],
      },
    });

    await db.insert(schema.media).values({
      id: mediaId,
      name: 'H264 Video',
      type: 'VIDEO',
      status: 'READY',
      created_by: testUser.id,
      source_content_type: 'video/mp4',
    });

    await db.insert(schema.presentations).values({
      id: presentationId,
      name: 'Publish Validation Presentation',
      created_by: testUser.id,
    });

    await db.insert(schema.presentationItems).values({
      id: randomUUID(),
      presentation_id: presentationId,
      media_id: mediaId,
      order: 0,
      duration_seconds: 15,
    });

    await db.insert(schema.schedules).values({
      id: scheduleId,
      name: 'Codec Validation Schedule',
      start_at: startAt,
      end_at: endAt,
      is_active: true,
      created_by: testUser.id,
    });

    await db.insert(schema.scheduleItems).values({
      id: scheduleItemId,
      schedule_id: scheduleId,
      presentation_id: presentationId,
      start_at: startAt,
      end_at: endAt,
      priority: 0,
      screen_ids: [screenId],
      screen_group_ids: [],
    });

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/schedules/${scheduleId}/publish`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        screen_ids: [screenId],
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.CONFLICT);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('required media codec');
    expect(body.error.details?.reason).toBe('UNSUPPORTED_SCREEN_CODEC');
    expect(body.error.details?.unsupported_targets?.[0]?.screen_id).toBe(screenId);
    expect(body.error.details?.unsupported_targets?.[0]?.media_id).toBe(mediaId);
    expect(body.error.details?.unsupported_targets?.[0]?.required_codecs).toContain('h264');
  });

  it('creates and selects a checksummed native rendition only when the enrolled capability supports it', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();
    const objectId = randomUUID();
    const presentationId = randomUUID();
    const scheduleId = randomUUID();
    const now = new Date();
    const startAt = new Date(now.getTime() + 5 * 60 * 1000);
    const endAt = new Date(now.getTime() + 30 * 60 * 1000);
    await db.insert(schema.screens).values({ id: screenId, name: 'Native PNG screen', status: 'OFFLINE' });
    await db.insert(schema.deviceInstallations).values({
      screen_id: screenId, installation_id: randomUUID(), installation_epoch: 1, client_kind: 'NATIVE_PLAYER', platform: 'ANDROID', runtime_profile: 'CLOUD_HANDHELD', status: 'ACTIVE',
      capability_manifest: {
        schema_version: 1, platform: 'ANDROID', os_version: '15', app_version: '1', build_number: '1', runtime_profile: 'CLOUD_HANDHELD',
        display: { width: 1080, height: 1920, density: 3, orientation: 'PORTRAIT' },
        media: { image_mime_types: ['image/png'], video_codecs: ['h264'], video_containers: ['mp4'], max_concurrent_videos: 1, document_page_images: true },
        webpage: { interactive: true, server_capture_fallback: true }, storage: { cache_limit_bytes: 1_000_000, range_downloads: true, atomic_rename: true },
        security: { key_algorithm: 'ES256', hardware_backed_key: false, attestation: 'NONE' }, kiosk: { requested_state: 'STANDARD', enforced_state: 'STANDARD', provider: 'NONE' }, screenshots: { supported: false }, push: { supported: false }, interaction_protocol_version: 0,
      },
    });
    await db.insert(schema.storageObjects).values({ id: objectId, bucket: 'media-ready', object_key: `${mediaId}/ready.png`, content_type: 'image/png', size: 100, sha256: 'a'.repeat(64) });
    await db.insert(schema.media).values({ id: mediaId, name: 'Native ready PNG', type: 'IMAGE', status: 'READY', created_by: testUser.id, ready_object_id: objectId, source_content_type: 'image/png' });
    await db.insert(schema.presentations).values({ id: presentationId, name: 'Native rendition presentation', created_by: testUser.id });
    await db.insert(schema.presentationItems).values({ id: randomUUID(), presentation_id: presentationId, media_id: mediaId, order: 0, duration_seconds: 10 });
    await db.insert(schema.schedules).values({ id: scheduleId, name: 'Native rendition schedule', start_at: startAt, end_at: endAt, is_active: true, created_by: testUser.id });
    await db.insert(schema.scheduleItems).values({ id: randomUUID(), schedule_id: scheduleId, presentation_id: presentationId, start_at: startAt, end_at: endAt, priority: 0, screen_ids: [screenId], screen_group_ids: [] });

    const response = await server.inject({ method: 'POST', url: `/api/v1/schedules/${scheduleId}/publish`, headers: { authorization: `Bearer ${adminToken}` }, payload: { screen_ids: [screenId] } });
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const renditions = await db.select().from(schema.mediaRenditions).where(eq(schema.mediaRenditions.media_id, mediaId));
    expect(renditions).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'IMAGE_DISPLAY', state: 'READY', sha256: 'a'.repeat(64) })]));

    const snapshotResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${screenId}/snapshot?include_urls=true`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(snapshotResponse.statusCode).toBe(HTTP_STATUS.OK);
    const snapshotBody = JSON.parse(snapshotResponse.body);
    expect(snapshotBody.snapshot).toBeTruthy(); // Electron-compatible representation remains present.
    expect(snapshotBody.native_snapshot).toMatchObject({
      schema_version: 2,
      desired_state_version: '1',
      snapshot_id: expect.any(String),
      emergency: null,
      default_content: null,
      scenes: [expect.objectContaining({
        presentation_id: presentationId,
        schedule_id: scheduleId,
        layout_aspect_ratio: null,
        slots: [expect.objectContaining({
          slot_id: 'full-screen',
          bounds: { x: 0, y: 0, w: 1, h: 1, z_index: 0 },
          items: [expect.objectContaining({ asset_id: mediaId, duration_ms: 10_000 })],
        })],
      })],
      assets: [expect.objectContaining({
        asset_id: mediaId,
        required: true,
        rendition_candidates: [expect.objectContaining({
          media_id: mediaId,
          role: 'IMAGE_DISPLAY',
          sha256: 'a'.repeat(64),
          download_url: expect.stringContaining('/media-ready/'),
        })],
      })],
    });
  });

  it('publishes a native document only when its complete page manifest is checksummed and gives the player per-page signed URLs', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();
    const objectId = randomUUID();
    const renditionId = randomUUID();
    const presentationId = randomUUID();
    const scheduleId = randomUUID();
    const now = new Date();
    const startAt = new Date(now.getTime() + 5 * 60 * 1000);
    const endAt = new Date(now.getTime() + 30 * 60 * 1000);
    const pdfSha = 'a'.repeat(64);
    const firstSha = 'b'.repeat(64);
    const secondSha = 'c'.repeat(64);
    await db.insert(schema.screens).values({ id: screenId, name: 'Native document screen', status: 'OFFLINE' });
    await db.insert(schema.deviceInstallations).values({
      screen_id: screenId, installation_id: randomUUID(), installation_epoch: 1, client_kind: 'NATIVE_PLAYER', platform: 'ANDROID', runtime_profile: 'CLOUD_HANDHELD', status: 'ACTIVE',
      capability_manifest: {
        schema_version: 1, platform: 'ANDROID', os_version: '15', app_version: '1', build_number: '1', runtime_profile: 'CLOUD_HANDHELD',
        display: { width: 1920, height: 1080, density: 1, orientation: 'LANDSCAPE' }, media: { image_mime_types: ['image/jpeg'], video_codecs: ['h264'], video_containers: ['mp4'], max_concurrent_videos: 1, document_page_images: true },
        webpage: { interactive: false, server_capture_fallback: true }, storage: { cache_limit_bytes: 1_000_000, range_downloads: true, atomic_rename: true }, security: { key_algorithm: 'ES256', hardware_backed_key: false, attestation: 'NONE' }, kiosk: { requested_state: 'STANDARD', enforced_state: 'STANDARD', provider: 'NONE' }, screenshots: { supported: false }, push: { supported: false }, interaction_protocol_version: 0,
      },
    });
    await db.insert(schema.storageObjects).values({ id: objectId, bucket: 'media-ready', object_key: `${mediaId}/ready.pdf`, content_type: 'application/pdf', size: 100, sha256: pdfSha });
    await db.insert(schema.media).values({ id: mediaId, name: 'Two page document', type: 'DOCUMENT', status: 'READY', created_by: testUser.id, ready_object_id: objectId, source_content_type: 'application/pdf' });
    await db.insert(schema.mediaRenditions).values({
      id: renditionId, media_id: mediaId, source_revision: pdfSha, role: 'DOCUMENT_PAGE_MANIFEST', state: 'READY', mime_type: 'image/jpeg', container: null, codecs: [], width: null, height: null, size_bytes: 11, sha256: firstSha, bucket: 'media-ready', object_key: `${mediaId}/document-pages/${pdfSha}/page-0001.jpg`, required_capabilities: { document_page_images: true },
      page_manifest: { schema_version: 1, page_duration_ms: 10_000, pages: [
        { index: 1, bucket: 'media-ready', object_key: `${mediaId}/document-pages/${pdfSha}/page-0001.jpg`, mime_type: 'image/jpeg', size_bytes: 11, sha256: firstSha },
        { index: 2, bucket: 'media-ready', object_key: `${mediaId}/document-pages/${pdfSha}/page-0002.jpg`, mime_type: 'image/jpeg', size_bytes: 12, sha256: secondSha },
      ] },
    });
    await db.insert(schema.presentations).values({ id: presentationId, name: 'Document presentation', created_by: testUser.id });
    await db.insert(schema.presentationItems).values({ id: randomUUID(), presentation_id: presentationId, media_id: mediaId, order: 0, duration_seconds: 20 });
    await db.insert(schema.schedules).values({ id: scheduleId, name: 'Document schedule', start_at: startAt, end_at: endAt, is_active: true, created_by: testUser.id });
    await db.insert(schema.scheduleItems).values({ id: randomUUID(), schedule_id: scheduleId, presentation_id: presentationId, start_at: startAt, end_at: endAt, priority: 0, screen_ids: [screenId], screen_group_ids: [] });

    expect((await server.inject({ method: 'POST', url: `/api/v1/schedules/${scheduleId}/publish`, headers: { authorization: `Bearer ${adminToken}` }, payload: { screen_ids: [screenId] } })).statusCode).toBe(HTTP_STATUS.OK);
    const response = await server.inject({ method: 'GET', url: `/api/v1/device/${screenId}/snapshot`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const candidate = JSON.parse(response.body).native_snapshot.assets[0].rendition_candidates[0];
    expect(candidate).toMatchObject({ id: renditionId, role: 'DOCUMENT_PAGE_MANIFEST', sha256: firstSha, page_manifest: { schema_version: 1, pages: [
      { index: 1, sha256: firstSha, download_url: expect.stringContaining('/media-ready/') },
      { index: 2, sha256: secondSha, download_url: expect.stringContaining('/media-ready/') },
    ] } });
  });

  it('builds a self-contained native emergency message generation without a schedule', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const emergencyId = randomUUID();
    await db.insert(schema.screens).values({ id: screenId, name: 'Native emergency message screen', status: 'OFFLINE' });
    await db.insert(schema.deviceInstallations).values({
      screen_id: screenId, installation_id: randomUUID(), installation_epoch: 1, client_kind: 'NATIVE_PLAYER', platform: 'ANDROID', runtime_profile: 'CLOUD_HANDHELD', status: 'ACTIVE',
      capability_manifest: {
        schema_version: 1, platform: 'ANDROID', os_version: '15', app_version: '1', build_number: '1', runtime_profile: 'CLOUD_HANDHELD',
        display: { width: 1080, height: 1920, density: 3, orientation: 'PORTRAIT' },
        media: { image_mime_types: ['image/png'], video_codecs: ['h264'], video_containers: ['mp4'], max_concurrent_videos: 1, document_page_images: true },
        webpage: { interactive: true, server_capture_fallback: true }, storage: { cache_limit_bytes: 1_000_000, range_downloads: true, atomic_rename: true },
        security: { key_algorithm: 'ES256', hardware_backed_key: false, attestation: 'NONE' }, kiosk: { requested_state: 'STANDARD', enforced_state: 'STANDARD', provider: 'NONE' }, screenshots: { supported: false }, push: { supported: false }, interaction_protocol_version: 0,
      },
    });
    await db.insert(schema.emergencies).values({
      id: emergencyId, message: 'Evacuate immediately', priority: 'CRITICAL', media_id: null,
      screen_ids: [screenId], screen_group_ids: [], target_all: false, is_active: true, triggered_by: testUser.id,
    });

    const response = await server.inject({ method: 'GET', url: `/api/v1/device/${screenId}/snapshot`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(response.body).native_snapshot).toMatchObject({
      schema_version: 2,
      snapshot_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      emergency: { id: emergencyId, asset_id: null, message: 'Evacuate immediately' },
      default_content: null,
      scenes: [],
      assets: [],
    });
  });

  it('builds a verified native default-media generation when no schedule is published', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();
    const objectId = randomUUID();
    const renditionId = randomUUID();
    const [previousSetting] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'default_media_targets')).limit(1);
    await db.insert(schema.screens).values({ id: screenId, name: 'Native default media screen', status: 'OFFLINE', aspect_ratio: '16:9' });
    await db.insert(schema.deviceInstallations).values({
      screen_id: screenId, installation_id: randomUUID(), installation_epoch: 1, client_kind: 'NATIVE_PLAYER', platform: 'ANDROID', runtime_profile: 'CLOUD_HANDHELD', status: 'ACTIVE',
      capability_manifest: {
        schema_version: 1, platform: 'ANDROID', os_version: '15', app_version: '1', build_number: '1', runtime_profile: 'CLOUD_HANDHELD',
        display: { width: 1920, height: 1080, density: 1, orientation: 'LANDSCAPE' },
        media: { image_mime_types: ['image/png'], video_codecs: ['h264'], video_containers: ['mp4'], max_concurrent_videos: 1, document_page_images: true },
        webpage: { interactive: true, server_capture_fallback: true }, storage: { cache_limit_bytes: 1_000_000, range_downloads: true, atomic_rename: true },
        security: { key_algorithm: 'ES256', hardware_backed_key: false, attestation: 'NONE' }, kiosk: { requested_state: 'STANDARD', enforced_state: 'STANDARD', provider: 'NONE' }, screenshots: { supported: false }, push: { supported: false }, interaction_protocol_version: 0,
      },
    });
    await db.insert(schema.storageObjects).values({ id: objectId, bucket: 'media-ready', object_key: `${mediaId}/default.png`, content_type: 'image/png', size: 12, sha256: 'd'.repeat(64) });
    await db.insert(schema.media).values({ id: mediaId, name: 'Native default media', type: 'IMAGE', status: 'READY', created_by: testUser.id, ready_object_id: objectId, source_content_type: 'image/png' });
    await db.insert(schema.mediaRenditions).values({ id: renditionId, media_id: mediaId, source_revision: 'default-v1', role: 'IMAGE_DISPLAY', state: 'READY', mime_type: 'image/png', container: null, codecs: [], width: 1920, height: 1080, size_bytes: 12, sha256: 'd'.repeat(64), bucket: 'media-ready', object_key: `${mediaId}/default.png`, required_capabilities: {} });
    const previousAssignments = Array.isArray(previousSetting?.value) ? previousSetting.value : [];
    await db.insert(schema.settings).values({ key: 'default_media_targets', value: [...previousAssignments, { target_type: 'SCREEN', target_id: screenId, media_id: mediaId, aspect_ratio: '16:9' }] }).onConflictDoUpdate({ target: schema.settings.key, set: { value: [...previousAssignments, { target_type: 'SCREEN', target_id: screenId, media_id: mediaId, aspect_ratio: '16:9' }], updated_at: new Date() } });
    try {
      const response = await server.inject({ method: 'GET', url: `/api/v1/device/${screenId}/snapshot`, headers: { authorization: `Bearer ${adminToken}` } });
      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(JSON.parse(response.body).native_snapshot).toMatchObject({
        schema_version: 2,
        emergency: null,
        default_content: { asset_id: mediaId },
        scenes: [],
        assets: [{ asset_id: mediaId, required: true, rendition_candidates: [{ id: renditionId, sha256: 'd'.repeat(64) }] }],
      });
    } finally {
      if (previousSetting) {
        await db.update(schema.settings).set({ value: previousSetting.value, updated_at: new Date() }).where(eq(schema.settings.key, 'default_media_targets'));
      } else {
        await db.delete(schema.settings).where(eq(schema.settings.key, 'default_media_targets'));
      }
    }
  });

  it('registers an immutable webpage capture as a native image rendition', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();
    const objectId = randomUUID();
    await db.insert(schema.screens).values({ id: screenId, name: 'Native webpage capture screen', status: 'OFFLINE' });
    await db.insert(schema.deviceInstallations).values({
      screen_id: screenId, installation_id: randomUUID(), installation_epoch: 1, client_kind: 'NATIVE_PLAYER', platform: 'ANDROID', runtime_profile: 'CLOUD_HANDHELD', status: 'ACTIVE',
      capability_manifest: {
        schema_version: 1, platform: 'ANDROID', os_version: '15', app_version: '1', build_number: '1', runtime_profile: 'CLOUD_HANDHELD',
        display: { width: 1920, height: 1080, density: 1, orientation: 'LANDSCAPE' }, media: { image_mime_types: ['image/png'], video_codecs: ['h264'], video_containers: ['mp4'], max_concurrent_videos: 1, document_page_images: true },
        webpage: { interactive: false, server_capture_fallback: true }, storage: { cache_limit_bytes: 1_000_000, range_downloads: true, atomic_rename: true }, security: { key_algorithm: 'ES256', hardware_backed_key: false, attestation: 'NONE' }, kiosk: { requested_state: 'STANDARD', enforced_state: 'STANDARD', provider: 'NONE' }, screenshots: { supported: false }, push: { supported: false }, interaction_protocol_version: 0,
      },
    });
    await db.insert(schema.storageObjects).values({ id: objectId, bucket: 'media-ready', object_key: `${mediaId}/webpage-fallback.png`, content_type: 'image/png', size: 12, sha256: 'e'.repeat(64) });
    await db.insert(schema.media).values({ id: mediaId, name: 'Captured webpage', type: 'WEBPAGE', status: 'READY', created_by: testUser.id, ready_object_id: objectId, source_content_type: 'image/png' });
    await expect(getNativeCompatibilityIssues({ screenIds: [screenId], mediaIds: [mediaId], concurrentVideoCount: 0, db })).resolves.toEqual([]);
    const [rendition] = await db.select().from(schema.mediaRenditions).where(eq(schema.mediaRenditions.media_id, mediaId));
    expect(rendition).toMatchObject({ role: 'WEBPAGE_CAPTURE', mime_type: 'image/png', sha256: 'e'.repeat(64) });
  });

  it('preserves layout slot bounds and independent slot playlists in a native snapshot', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const layoutId = randomUUID();
    const presentationId = randomUUID();
    const scheduleId = randomUUID();
    const mediaIds = [randomUUID(), randomUUID(), randomUUID()];
    const now = new Date();
    const startAt = new Date(now.getTime() + 5 * 60 * 1000);
    const endAt = new Date(now.getTime() + 30 * 60 * 1000);
    await db.insert(schema.screens).values({ id: screenId, name: 'Native layout screen', status: 'OFFLINE' });
    await db.insert(schema.deviceInstallations).values({
      screen_id: screenId, installation_id: randomUUID(), installation_epoch: 1, client_kind: 'NATIVE_PLAYER', platform: 'ANDROID', runtime_profile: 'CLOUD_HANDHELD', status: 'ACTIVE',
      capability_manifest: {
        schema_version: 1, platform: 'ANDROID', os_version: '15', app_version: '1', build_number: '1', runtime_profile: 'CLOUD_HANDHELD',
        display: { width: 1920, height: 1080, density: 1, orientation: 'LANDSCAPE' }, media: { image_mime_types: ['image/png'], video_codecs: ['h264'], video_containers: ['mp4'], max_concurrent_videos: 1, document_page_images: true },
        webpage: { interactive: true, server_capture_fallback: true }, storage: { cache_limit_bytes: 1_000_000, range_downloads: true, atomic_rename: true }, security: { key_algorithm: 'ES256', hardware_backed_key: false, attestation: 'NONE' }, kiosk: { requested_state: 'STANDARD', enforced_state: 'STANDARD', provider: 'NONE' }, screenshots: { supported: false }, push: { supported: false }, interaction_protocol_version: 0,
      },
    });
    await db.insert(schema.layouts).values({
      id: layoutId, name: 'Native split layout', aspect_ratio: '16:9', created_by: testUser.id,
      spec: { slots: [{ id: 'hero', x: 0, y: 0, w: 0.75, h: 1, z: 1 }, { id: 'sidebar', x: 0.75, y: 0, w: 0.25, h: 1, z: 2 }] },
    });
    for (const [index, mediaId] of mediaIds.entries()) {
      const objectId = randomUUID();
      await db.insert(schema.storageObjects).values({ id: objectId, bucket: 'media-ready', object_key: `${mediaId}/ready.png`, content_type: 'image/png', size: 100 + index, sha256: String(index + 1).repeat(64) });
      await db.insert(schema.media).values({ id: mediaId, name: `Native layout media ${index}`, type: 'IMAGE', status: 'READY', created_by: testUser.id, ready_object_id: objectId, source_content_type: 'image/png' });
    }
    await db.insert(schema.presentations).values({ id: presentationId, name: 'Native layout presentation', layout_id: layoutId, created_by: testUser.id });
    await db.insert(schema.presentationSlotItems).values([
      { id: randomUUID(), presentation_id: presentationId, slot_id: 'hero', media_id: mediaIds[0]!, order: 0, duration_seconds: 5, fit_mode: 'CONTAIN', audio_enabled: false, loop_enabled: false },
      { id: randomUUID(), presentation_id: presentationId, slot_id: 'hero', media_id: mediaIds[1]!, order: 1, duration_seconds: 7, fit_mode: 'COVER', audio_enabled: false, loop_enabled: true },
      { id: randomUUID(), presentation_id: presentationId, slot_id: 'sidebar', media_id: mediaIds[2]!, order: 0, duration_seconds: 11, fit_mode: 'STRETCH', audio_enabled: false, loop_enabled: false },
    ]);
    await db.insert(schema.schedules).values({ id: scheduleId, name: 'Native layout schedule', start_at: startAt, end_at: endAt, is_active: true, created_by: testUser.id });
    await db.insert(schema.scheduleItems).values({ id: randomUUID(), schedule_id: scheduleId, presentation_id: presentationId, start_at: startAt, end_at: endAt, priority: 0, screen_ids: [screenId], screen_group_ids: [] });

    expect((await server.inject({ method: 'POST', url: `/api/v1/schedules/${scheduleId}/publish`, headers: { authorization: `Bearer ${adminToken}` }, payload: { screen_ids: [screenId] } })).statusCode).toBe(HTTP_STATUS.OK);
    const response = await server.inject({ method: 'GET', url: `/api/v1/device/${screenId}/snapshot`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const scene = JSON.parse(response.body).native_snapshot.scenes[0];
    expect(scene).toMatchObject({
      presentation_id: presentationId, layout_aspect_ratio: '16:9',
      slots: [
        { slot_id: 'hero', bounds: { x: 0, y: 0, w: 0.75, h: 1, z_index: 1 }, items: [{ asset_id: mediaIds[0], duration_ms: 5_000 }, { asset_id: mediaIds[1], duration_ms: 7_000 }] },
        { slot_id: 'sidebar', bounds: { x: 0.75, y: 0, w: 0.25, h: 1, z_index: 2 }, items: [{ asset_id: mediaIds[2], duration_ms: 11_000 }] },
      ],
    });
  });

  it('blocks an enrolled native screen when no compatible checksummed rendition exists', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();
    const objectId = randomUUID();
    const presentationId = randomUUID();
    const scheduleId = randomUUID();
    const now = new Date();
    const startAt = new Date(now.getTime() + 5 * 60 * 1000);
    const endAt = new Date(now.getTime() + 30 * 60 * 1000);
    await db.insert(schema.screens).values({ id: screenId, name: 'Native JPEG-only screen', status: 'OFFLINE' });
    await db.insert(schema.deviceInstallations).values({
      screen_id: screenId, installation_id: randomUUID(), installation_epoch: 1, client_kind: 'NATIVE_PLAYER', platform: 'ANDROID', runtime_profile: 'CLOUD_HANDHELD', status: 'ACTIVE',
      capability_manifest: {
        schema_version: 1, platform: 'ANDROID', os_version: '15', app_version: '1', build_number: '1', runtime_profile: 'CLOUD_HANDHELD',
        display: { width: 1080, height: 1920, density: 3, orientation: 'PORTRAIT' }, media: { image_mime_types: ['image/jpeg'], video_codecs: [], video_containers: [], max_concurrent_videos: 1, document_page_images: true },
        webpage: { interactive: true, server_capture_fallback: true }, storage: { cache_limit_bytes: 1_000_000, range_downloads: true, atomic_rename: true }, security: { key_algorithm: 'ES256', hardware_backed_key: false, attestation: 'NONE' }, kiosk: { requested_state: 'STANDARD', enforced_state: 'STANDARD', provider: 'NONE' }, screenshots: { supported: false }, push: { supported: false }, interaction_protocol_version: 0,
      },
    });
    await db.insert(schema.storageObjects).values({ id: objectId, bucket: 'media-ready', object_key: `${mediaId}/ready.png`, content_type: 'image/png', size: 100, sha256: 'b'.repeat(64) });
    await db.insert(schema.media).values({ id: mediaId, name: 'PNG needs JPEG rendition', type: 'IMAGE', status: 'READY', created_by: testUser.id, ready_object_id: objectId, source_content_type: 'image/png' });
    await db.insert(schema.presentations).values({ id: presentationId, name: 'Incompatible native presentation', created_by: testUser.id });
    await db.insert(schema.presentationItems).values({ id: randomUUID(), presentation_id: presentationId, media_id: mediaId, order: 0, duration_seconds: 10 });
    await db.insert(schema.schedules).values({ id: scheduleId, name: 'Incompatible native schedule', start_at: startAt, end_at: endAt, is_active: true, created_by: testUser.id });
    await db.insert(schema.scheduleItems).values({ id: randomUUID(), schedule_id: scheduleId, presentation_id: presentationId, start_at: startAt, end_at: endAt, priority: 0, screen_ids: [screenId], screen_group_ids: [] });

    const response = await server.inject({ method: 'POST', url: `/api/v1/schedules/${scheduleId}/publish`, headers: { authorization: `Bearer ${adminToken}` }, payload: { screen_ids: [screenId] } });
    expect(response.statusCode).toBe(HTTP_STATUS.CONFLICT);
    const body = JSON.parse(response.body);
    expect(body.error.details.reason).toBe('UNSUPPORTED_NATIVE_MEDIA_CAPABILITY');
    expect(body.error.details.unsupported_targets).toEqual(expect.arrayContaining([expect.objectContaining({ screen_id: screenId, media_id: mediaId, reason: 'UNSUPPORTED_MEDIA_CAPABILITY' })]));
  });

  it('blocks publish when a presentation references non-ready media', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();
    const presentationId = randomUUID();
    const scheduleId = randomUUID();
    const now = new Date();
    const startAt = new Date(now.getTime() + 5 * 60 * 1000);
    const endAt = new Date(now.getTime() + 30 * 60 * 1000);

    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Non Ready Media Screen',
      status: 'OFFLINE',
    });

    await db.insert(schema.media).values({
      id: mediaId,
      name: 'Processing Video',
      type: 'VIDEO',
      status: 'PROCESSING',
      created_by: testUser.id,
      source_content_type: 'video/mp4',
    });

    await db.insert(schema.presentations).values({
      id: presentationId,
      name: 'Non Ready Media Presentation',
      created_by: testUser.id,
    });

    await db.insert(schema.presentationItems).values({
      id: randomUUID(),
      presentation_id: presentationId,
      media_id: mediaId,
      order: 0,
      duration_seconds: 10,
    });

    await db.insert(schema.schedules).values({
      id: scheduleId,
      name: 'Non Ready Publish Schedule',
      timezone: 'UTC',
      start_at: startAt,
      end_at: endAt,
      is_active: true,
      created_by: testUser.id,
    } as any);

    await db.insert(schema.scheduleItems).values({
      id: randomUUID(),
      schedule_id: scheduleId,
      presentation_id: presentationId,
      start_at: startAt,
      end_at: endAt,
      priority: 0,
      screen_ids: [screenId],
      screen_group_ids: [],
    });

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/schedules/${scheduleId}/publish`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        screen_ids: [screenId],
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.details?.reason).toBe('INVALID_PRESENTATION_ASSETS');
    expect(body.error.details?.invalid_references?.[0]?.issue).toBe('MEDIA_NOT_READY');
  });

  it('requires a hash-matched operator acknowledgement before publishing across incompatible display aspects', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();
    const layoutId = randomUUID();
    const presentationId = randomUUID();
    const scheduleId = randomUUID();
    const now = new Date();
    const startAt = new Date(now.getTime() + 5 * 60 * 1000);
    const endAt = new Date(now.getTime() + 30 * 60 * 1000);

    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Portrait display aspect guard',
      status: 'OFFLINE',
      aspect_ratio: '9:16',
      width: 1080,
      height: 1920,
    });
    await db.insert(schema.layouts).values({
      id: layoutId,
      name: 'Landscape publish layout',
      aspect_ratio: '16:9',
      spec: { slots: [{ id: 'hero', x: 0, y: 0, w: 1, h: 1 }] },
      created_by: testUser.id,
    });
    await db.insert(schema.media).values({
      id: mediaId,
      name: 'Ready aspect guard media',
      type: 'IMAGE',
      status: 'READY',
      created_by: testUser.id,
      width: 1920,
      height: 1080,
    });
    await db.insert(schema.presentations).values({
      id: presentationId,
      name: 'Landscape aspect guard presentation',
      layout_id: layoutId,
      created_by: testUser.id,
    });
    await db.insert(schema.presentationItems).values({
      id: randomUUID(),
      presentation_id: presentationId,
      media_id: mediaId,
      order: 0,
      duration_seconds: 15,
    });
    await db.insert(schema.schedules).values({
      id: scheduleId,
      name: 'Aspect guard schedule',
      start_at: startAt,
      end_at: endAt,
      is_active: true,
      created_by: testUser.id,
    });
    await db.insert(schema.scheduleItems).values({
      id: randomUUID(),
      schedule_id: scheduleId,
      presentation_id: presentationId,
      start_at: startAt,
      end_at: endAt,
      priority: 0,
      screen_ids: [screenId],
      screen_group_ids: [],
    });

    const preflightResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/schedules/display-preflight',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { schedule_id: scheduleId, screen_ids: [screenId] },
    });
    expect(preflightResponse.statusCode).toBe(HTTP_STATUS.OK);
    const preflight = JSON.parse(preflightResponse.body);
    expect(preflight.compatible).toBe(false);
    expect(preflight.issues).toEqual([
      expect.objectContaining({
        screen_id: screenId,
        presentation_id: presentationId,
        layout_aspect_ratio: '16:9',
        usable_area_fraction: 0.31640625,
      }),
    ]);
    expect(preflight.issue_hash).toMatch(/^[a-f0-9]{64}$/);

    const blockedResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/schedules/${scheduleId}/publish`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { screen_ids: [screenId] },
    });
    expect(blockedResponse.statusCode).toBe(HTTP_STATUS.CONFLICT);
    const blocked = JSON.parse(blockedResponse.body);
    expect(blocked.error.code).toBe('DISPLAY_ASPECT_MISMATCH');
    expect(blocked.error.details.issue_hash).toBe(preflight.issue_hash);

    const acceptedResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/schedules/${scheduleId}/publish`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        screen_ids: [screenId],
        aspect_override: {
          acknowledged: true,
          issue_hash: preflight.issue_hash,
          reason: 'Portrait letterboxing approved for the lobby display.',
        },
      },
    });
    expect(acceptedResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(acceptedResponse.body)).toEqual(
      expect.objectContaining({ schedule_id: scheduleId, resolved_screen_ids: [screenId] }),
    );
  });
});
