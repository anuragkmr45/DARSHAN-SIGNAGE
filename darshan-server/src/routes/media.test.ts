import { createHash, randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer } from '@/server';
import { generateAccessToken } from '@/auth/jwt';
import { closeDatabase, getDatabase, initializeDatabase, schema } from '@/db';
import { createSessionRepository } from '@/db/repositories/session';
import { hashPassword } from '@/auth/password';
import { HTTP_STATUS } from '@/http-status-codes';
import { SYSTEM_ROLE_DEFAULTS } from '@/rbac/system-roles';
import { createBucketIfNotExists, deleteObject, getObject, initializeS3, putObject } from '@/s3';

type RolePermissions = {
  grants: Array<{ action: string; subject: string }>;
};

describe('Media Routes - delete ownership and usage protection', () => {
  let server: FastifyInstance;
  let ownerToken: string;
  let otherUserToken: string;
  let adminToken: string;
  let superAdminToken: string;
  let operatorToken: string;
  let ownerUserId: string;
  let otherUserId: string;
  let adminUserId: string;
  let superAdminUserId: string;
  let operatorUserId: string;
  let departmentId: string;

  beforeAll(async () => {
    await initializeDatabase();
    server = await createServer();

    const db = getDatabase();
    const ensureRole = async (name: string, permissions: RolePermissions) => {
      const [existing] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, name))
        .limit(1);

      if (existing) {
        const currentPermissions =
          existing.permissions && typeof existing.permissions === 'object'
            ? (existing.permissions as RolePermissions)
            : { grants: [] };
        const mergedGrants = [...currentPermissions.grants];
        for (const grant of permissions.grants) {
          if (
            !mergedGrants.some(
              (current) =>
                current.action === grant.action && current.subject === grant.subject
            )
          ) {
            mergedGrants.push(grant);
          }
        }

        const [updated] = await db
          .update(schema.roles)
          .set({ permissions: { grants: mergedGrants } })
          .where(eq(schema.roles.id, existing.id))
          .returning();
        return updated ?? existing;
      }

      const [created] = await db
        .insert(schema.roles)
        .values({
          id: randomUUID(),
          name,
          permissions,
          is_system: true,
        })
        .returning();
      return created;
    };

    const mediaUserRole = await ensureRole(`MEDIA_DELETE_USER_${randomUUID()}`, {
      grants: [
        { action: 'read', subject: 'Media' },
        { action: 'delete', subject: 'Media' },
      ],
    });
    const adminRole = await ensureRole('ADMIN', SYSTEM_ROLE_DEFAULTS.ADMIN);
    const operatorRole = await ensureRole('OPERATOR', {
      grants: [
        { action: 'read', subject: 'Media' },
      ],
    });
    const superAdminRole = await ensureRole('SUPER_ADMIN', { grants: [] });

    departmentId = randomUUID();
    await db.insert(schema.departments).values({
      id: departmentId,
      name: `Media route test ${departmentId}`,
    });

    const createUser = async (params: {
      email: string;
      firstName: string;
      lastName: string;
      roleId: string;
      departmentId?: string;
    }) => {
      const id = randomUUID();
      await db.insert(schema.users).values({
        id,
        email: params.email,
        password_hash: await hashPassword('Password123!'),
        first_name: params.firstName,
        last_name: params.lastName,
        role_id: params.roleId,
        department_id: params.departmentId,
        is_active: true,
      });
      return id;
    };

    ownerUserId = await createUser({
      email: `media-owner-${Date.now()}@example.com`,
      firstName: 'Priya',
      lastName: 'Sharma',
      roleId: mediaUserRole.id,
      departmentId,
    });
    otherUserId = await createUser({
      email: `media-other-${Date.now()}@example.com`,
      firstName: 'Amit',
      lastName: 'Khan',
      roleId: mediaUserRole.id,
      departmentId,
    });
    adminUserId = await createUser({
      email: `media-admin-${Date.now()}@example.com`,
      firstName: 'Admin',
      lastName: 'User',
      roleId: adminRole.id,
    });
    superAdminUserId = await createUser({
      email: `media-super-${Date.now()}@example.com`,
      firstName: 'Super',
      lastName: 'Admin',
      roleId: superAdminRole.id,
    });
    operatorUserId = await createUser({
      email: `media-operator-${Date.now()}@example.com`,
      firstName: 'Operator',
      lastName: 'User',
      roleId: operatorRole.id,
      departmentId,
    });

    const issueToken = async (
      userId: string,
      email: string,
      roleId: string,
      roleName: string,
      userDepartmentId?: string
    ) => {
      const token = await generateAccessToken(userId, email, roleId, roleName, userDepartmentId);
      await createSessionRepository().create({
        user_id: userId,
        access_jti: token.jti,
        expires_at: token.expiresAt,
      });
      return token.token;
    };

    ownerToken = await issueToken(
      ownerUserId,
      `owner-${ownerUserId}@example.com`,
      mediaUserRole.id,
      mediaUserRole.name,
      departmentId
    );
    otherUserToken = await issueToken(
      otherUserId,
      `other-${otherUserId}@example.com`,
      mediaUserRole.id,
      mediaUserRole.name,
      departmentId
    );
    adminToken = await issueToken(
      adminUserId,
      `admin-${adminUserId}@example.com`,
      adminRole.id,
      adminRole.name
    );
    superAdminToken = await issueToken(
      superAdminUserId,
      `super-${superAdminUserId}@example.com`,
      superAdminRole.id,
      superAdminRole.name
    );
    operatorToken = await issueToken(
      operatorUserId,
      `operator-${operatorUserId}@example.com`,
      operatorRole.id,
      operatorRole.name,
      departmentId
    );
  });

  afterAll(async () => {
    await server.close();
    await closeDatabase();
  });

  const insertMedia = async (createdBy: string) => {
    const db = getDatabase();
    const [media] = await db
      .insert(schema.media)
      .values({
        id: randomUUID(),
        name: `media-${Date.now()}`,
        type: 'IMAGE',
        status: 'READY',
        created_by: createdBy,
        owner_scope: createdBy === adminUserId ? 'ORGANIZATION' : 'DEPARTMENT',
        owner_department_id: createdBy === adminUserId ? null : departmentId,
      })
      .returning();
    return media;
  };

  it('returns 401 without authorization', async () => {
    const media = await insertMedia(ownerUserId);
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/media/${media.id}`,
    });

    expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('soft deletes uploader owned media', async () => {
    const media = await insertMedia(ownerUserId);
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/media/${media.id}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body);
    expect(body.id).toBe(media.id);
    expect(body.message).toContain('Media deleted and retained');

    const db = getDatabase();
    const [updated] = await db
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, media.id));
    expect(updated).toBeTruthy();
    expect(updated?.status).toBe('READY');
    expect(updated?.deleted_at).toBeTruthy();
    const hidden = await server.inject({ method: 'GET', url: `/api/v1/media/${media.id}`, headers: { authorization: `Bearer ${ownerToken}` } });
    expect(hidden.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    const restored = await server.inject({ method: 'POST', url: `/api/v1/media/${media.id}/restore`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(restored.statusCode).toBe(HTTP_STATUS.OK);
    const [visible] = await db.select().from(schema.media).where(eq(schema.media.id, media.id));
    expect(visible?.deleted_at).toBeNull();
  });

  it('retains object bytes, hides deleted media, and restores only while its object exists', async () => {
    initializeS3();
    await createBucketIfNotExists('media-source');
    const media = await insertMedia(ownerUserId);
    const key = `${media.id}/retained.png`;
    const bytes = Buffer.from('retained-media-object-contents');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await putObject('media-source', key, bytes, 'image/png');
    const db = getDatabase();
    const [object] = await db.insert(schema.storageObjects).values({
      bucket: 'media-source', object_key: key, content_type: 'image/png', size: bytes.length, sha256: checksum,
    }).returning();
    await db.update(schema.media).set({
      source_object_id: object.id, source_bucket: 'media-source', source_object_key: key,
      source_content_type: 'image/png', source_size: bytes.length,
    }).where(eq(schema.media.id, media.id));

    const ownerHeaders = { authorization: `Bearer ${ownerToken}` };
    const adminHeaders = { authorization: `Bearer ${adminToken}` };
    expect((await server.inject({ method: 'DELETE', url: `/api/v1/media/${media.id}`, headers: ownerHeaders })).statusCode).toBe(200);
    expect((await server.inject({ method: 'DELETE', url: `/api/v1/media/${media.id}`, headers: ownerHeaders })).json().already_deleted).toBe(true);
    const list = await server.inject({ method: 'GET', url: '/api/v1/media?limit=100', headers: ownerHeaders });
    expect(list.json().items.some((item: { id: string }) => item.id === media.id)).toBe(false);
    const denied = await server.inject({ method: 'GET', url: '/api/v1/media/deleted', headers: ownerHeaders });
    expect(denied.statusCode).toBe(403);
    const deletedList = await server.inject({ method: 'GET', url: '/api/v1/media/deleted', headers: adminHeaders });
    expect(deletedList.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ id: media.id })]));
    expect(createHash('sha256').update(await getObject('media-source', key)).digest('hex')).toBe(checksum);

    expect((await server.inject({ method: 'POST', url: `/api/v1/media/${media.id}/restore`, headers: adminHeaders })).statusCode).toBe(200);
    expect((await server.inject({ method: 'POST', url: `/api/v1/media/${media.id}/restore`, headers: adminHeaders })).json().already_restored).toBe(true);
    expect(createHash('sha256').update(await getObject('media-source', key)).digest('hex')).toBe(checksum);

    expect((await server.inject({ method: 'DELETE', url: `/api/v1/media/${media.id}`, headers: ownerHeaders })).statusCode).toBe(200);
    await deleteObject('media-source', key);
    const failedRestore = await server.inject({ method: 'POST', url: `/api/v1/media/${media.id}/restore`, headers: adminHeaders });
    expect(failedRestore.statusCode).toBe(409);
    expect(failedRestore.json().error.code).toBe('MEDIA_RESTORE_OBJECT_MISSING');
    const [stillDeleted] = await db.select().from(schema.media).where(eq(schema.media.id, media.id));
    expect(stillDeleted.deleted_at).toBeTruthy();
  });

  it('rejects permanent deletion', async () => {
    const media = await insertMedia(ownerUserId);
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/media/${media.id}?hard=true`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('MEDIA_HARD_DELETE_DISABLED');

    const db = getDatabase();
    const [deleted] = await db
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, media.id));
    expect(deleted).toBeTruthy();
  });

  it('blocks non-owner delete and exposes uploader identity', async () => {
    const media = await insertMedia(ownerUserId);
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/media/${media.id}`,
      headers: {
        authorization: `Bearer ${otherUserToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('MEDIA_DELETE_FORBIDDEN_OWNER');
    expect(body.error.message).toContain('Priya Sharma');
    expect(body.error.details.owner_user_id).toBe(ownerUserId);
    expect(body.error.details.owner_display_name).toBe('Priya Sharma');
  });

  it('shows admin uploaded media to operators in list and detail responses', async () => {
    const media = await insertMedia(adminUserId);

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/media',
      headers: {
        authorization: `Bearer ${operatorToken}`,
      },
    });

    expect(listResponse.statusCode).toBe(HTTP_STATUS.OK);
    const listBody = JSON.parse(listResponse.body);
    expect(listBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: media.id,
        }),
      ])
    );

    const getResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/media/${media.id}`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
      },
    });

    expect(getResponse.statusCode).toBe(HTTP_STATUS.OK);
    const getBody = JSON.parse(getResponse.body);
    expect(getBody.id).toBe(media.id);
  });

  it('allows ADMIN to delete another user media', async () => {
    const media = await insertMedia(ownerUserId);
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/media/${media.id}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const db = getDatabase();
    const [deleted] = await db
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, media.id));
    expect(deleted?.deleted_at).toBeTruthy();
  });

  it('allows SUPER_ADMIN to delete another user media', async () => {
    const media = await insertMedia(ownerUserId);
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/media/${media.id}`,
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const db = getDatabase();
    const [deleted] = await db
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, media.id));
    expect(deleted?.deleted_at).toBeTruthy();
  });

  it('returns 409 when media is referenced by chat attachments', async () => {
    const db = getDatabase();
    const media = await insertMedia(ownerUserId);
    const conversationId = randomUUID();
    const messageId = randomUUID();

    await db.insert(schema.chatConversations).values({
      id: conversationId,
      type: 'GROUP_CLOSED',
      title: 'Referenced media conversation',
      created_by: ownerUserId,
      state: 'ACTIVE',
      invite_policy: 'ANY_MEMBER_CAN_INVITE',
      last_seq: 1,
      metadata: {},
    });
    await db.insert(schema.chatMessages).values({
      id: messageId,
      conversation_id: conversationId,
      seq: 1,
      sender_id: ownerUserId,
      body_text: 'Message with attachment',
    });
    await db.insert(schema.chatAttachments).values({
      id: randomUUID(),
      message_id: messageId,
      media_asset_id: media.id,
      kind: 'IMAGE',
      ord: 0,
    });

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/media/${media.id}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.CONFLICT);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('MEDIA_IN_USE');
    expect(body.error.message).toBe(
      'Media cannot be deleted because it is still used by chat messages.'
    );
    expect(body.error.details.references).toContain('chat_attachments');
  });

  it('returns 409 when media is referenced by a non-chat surface', async () => {
    const db = getDatabase();
    const media = await insertMedia(ownerUserId);
    const presentationId = randomUUID();

    await db.insert(schema.presentations).values({
      id: presentationId,
      name: `presentation-${Date.now()}`,
      created_by: ownerUserId,
      owner_scope: 'DEPARTMENT',
      owner_department_id: departmentId,
    });
    await db.insert(schema.presentationItems).values({
      id: randomUUID(),
      presentation_id: presentationId,
      media_id: media.id,
      order: 0,
    });

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/media/${media.id}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.CONFLICT);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('MEDIA_IN_USE');
    expect(body.error.message).toBe(
      'Media cannot be deleted because it is still used in presentations.'
    );
    expect(body.error.details.references).toContain('presentations');
  });

  it('returns 404 for missing media', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/media/${randomUUID()}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('filters broken READY media out of READY list responses', async () => {
    const media = await insertMedia(ownerUserId);

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/media?page=1&limit=20&status=READY`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body);
    const listed = body.items.find((item: { id: string }) => item.id === media.id);
    expect(listed).toBeUndefined();
  });

  it('treats an empty type query as no type filter and returns all matching media', async () => {
    const db = getDatabase();
    const imageId = randomUUID();
    const videoId = randomUUID();

    await db.insert(schema.media).values([
      {
        id: imageId,
        name: `image-${Date.now()}`,
        type: 'IMAGE',
        status: 'READY',
        created_by: ownerUserId,
        owner_scope: 'DEPARTMENT',
        owner_department_id: departmentId,
        source_bucket: 'media-source',
        source_object_key: `images/${imageId}.png`,
      },
      {
        id: videoId,
        name: `video-${Date.now()}`,
        type: 'VIDEO',
        status: 'READY',
        created_by: ownerUserId,
        owner_scope: 'DEPARTMENT',
        owner_department_id: departmentId,
        source_bucket: 'media-source',
        source_object_key: `videos/${videoId}.mp4`,
      },
    ]);
    initializeS3();
    await createBucketIfNotExists('media-source');
    await putObject('media-source', `images/${imageId}.png`, Buffer.from('image-fixture'), 'image/png');
    await putObject('media-source', `videos/${videoId}.mp4`, Buffer.from('video-fixture'), 'video/mp4');

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/media?page=1&limit=100&status=READY&type=`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body);
    const returnedIds = new Set(body.items.map((item: { id: string }) => item.id));
    expect(returnedIds.has(imageId)).toBe(true);
    expect(returnedIds.has(videoId)).toBe(true);
  });

  it('downgrades READY to FAILED in unfiltered list response when media object is missing', async () => {
    const media = await insertMedia(ownerUserId);

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/media?page=1&limit=20`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body);
    const listed = body.items.find((item: { id: string }) => item.id === media.id);
    expect(listed).toBeTruthy();
    expect(listed.status).toBe('FAILED');
    expect(listed.status_reason).toBe('MEDIA_OBJECT_MISSING');
    expect(listed.media_url).toBeNull();
  });

  it('downgrades READY to FAILED in get response when media object is missing', async () => {
    const media = await insertMedia(ownerUserId);

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/media/${media.id}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body);
    expect(body.id).toBe(media.id);
    expect(body.status).toBe('FAILED');
    expect(body.status_reason).toBe('MEDIA_OBJECT_MISSING');
    expect(body.media_url).toBeNull();
  });

  it('pages deleted media beyond the first 100 records', async () => {
    const db = getDatabase();
    const ids = Array.from({ length: 101 }, () => randomUUID());
    await db.insert(schema.media).values(ids.map((id) => ({
      id, name: `deleted-${id}`, type: 'IMAGE' as const, status: 'READY' as const,
      created_by: ownerUserId, deleted_at: new Date(), deleted_by: ownerUserId,
    })));
    const headers = { authorization: `Bearer ${adminToken}` };
    const first = await server.inject({ method: 'GET', url: '/api/v1/media/deleted?page=1', headers });
    const second = await server.inject({ method: 'GET', url: '/api/v1/media/deleted?page=2', headers });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(100);
    expect(second.statusCode).toBe(200);
    expect(second.json().items.length).toBeGreaterThan(0);
    const invalid = await server.inject({ method: 'GET', url: '/api/v1/media/deleted?page=0', headers });
    expect(invalid.statusCode).toBe(400);
  });
});
