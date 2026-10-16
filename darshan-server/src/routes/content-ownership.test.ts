import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateAccessToken } from '@/auth/jwt';
import { hashPassword } from '@/auth/password';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { createSessionRepository } from '@/db/repositories/session';
import { closeTestServer, createTestServer, generateTestToken, testRoles, testUser } from '@/test/helpers';

type ResourceKind = 'media' | 'layouts' | 'presentations' | 'schedules';
type ResourceIds = Record<ResourceKind, string>;

async function waitForDatabaseCondition(
  check: () => Promise<boolean>,
  description: string,
  timeoutMs = 5000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

describe('content ownership routes', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let ownerToken: string;
  let peerToken: string;
  let outsiderToken: string;
  let leadToken: string;
  let customReadToken: string;
  let customEditorToken: string;
  let noDepartmentToken: string;
  let noScheduleToken: string;
  let departmentA: string;
  let departmentB: string;
  let ownerId: string;
  let peerId: string;
  let outsiderId: string;
  let customReadId: string;
  let customEditorId: string;
  let departmentResources: ResourceIds;
  let organizationResources: ResourceIds;
  let restrictedResources: ResourceIds;
  let otherDepartmentResources: ResourceIds;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const listUrl = (kind: ResourceKind) => `/api/v1/${kind}?page=1&limit=100`;
  const detailUrl = (kind: ResourceKind, id: string) => `/api/v1/${kind}/${id}`;

  async function issueToken(
    userId: string,
    email: string,
    roleId: string,
    roleName: string,
    departmentId?: string
  ) {
    const issued = await generateAccessToken(userId, email, roleId, roleName, departmentId);
    await createSessionRepository().create({
      user_id: userId,
      access_jti: issued.jti,
      expires_at: issued.expiresAt,
    });
    return issued.token;
  }

  async function createUser(roleId: string, departmentId: string | null, label: string) {
    const db = getDatabase();
    const id = randomUUID();
    const email = `${label}-${id}@example.test`;
    await db.insert(schema.users).values({
      id,
      email,
      password_hash: await hashPassword('Password123!'),
      first_name: label,
      last_name: 'Ownership',
      role_id: roleId,
      department_id: departmentId,
      is_active: true,
    });
    return { id, email };
  }

  async function insertResourceSet(
    label: string,
    createdBy: string,
    ownerScope: 'DEPARTMENT' | 'ORGANIZATION' | 'RESTRICTED',
    ownerDepartmentId: string | null
  ): Promise<ResourceIds> {
    const db = getDatabase();
    const mediaId = randomUUID();
    const layoutId = randomUUID();
    const presentationId = randomUUID();
    const scheduleId = randomUUID();
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    await db.insert(schema.media).values({
      id: mediaId,
      name: `${label} media`,
      type: 'IMAGE',
      status: 'PENDING',
      created_by: createdBy,
      owner_scope: ownerScope,
      owner_department_id: ownerDepartmentId,
    });
    await db.insert(schema.layouts).values({
      id: layoutId,
      name: `${label} layout`,
      aspect_ratio: '16:9',
      spec: { slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1 }] },
      created_by: createdBy,
      owner_scope: ownerScope,
      owner_department_id: ownerDepartmentId,
    });
    await db.insert(schema.presentations).values({
      id: presentationId,
      name: `${label} presentation`,
      created_by: createdBy,
      owner_scope: ownerScope,
      owner_department_id: ownerDepartmentId,
    });
    await db.insert(schema.schedules).values({
      id: scheduleId,
      name: `${label} schedule`,
      start_at: start,
      end_at: end,
      created_by: createdBy,
      owner_scope: ownerScope,
      owner_department_id: ownerDepartmentId,
    });
    return {
      media: mediaId,
      layouts: layoutId,
      presentations: presentationId,
      schedules: scheduleId,
    };
  }

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await generateTestToken(testUser.id, 'ADMIN');
    const db = getDatabase();

    departmentA = randomUUID();
    departmentB = randomUUID();
    await db.insert(schema.departments).values([
      { id: departmentA, name: `Ownership A ${departmentA}` },
      { id: departmentB, name: `Ownership B ${departmentB}` },
    ]);

    const owner = await createUser(testRoles.OPERATOR.id, departmentA, 'Owner');
    const peer = await createUser(testRoles.OPERATOR.id, departmentA, 'Peer');
    const outsider = await createUser(testRoles.OPERATOR.id, departmentB, 'Outsider');
    const lead = await createUser(testRoles.DEPARTMENT.id, departmentA, 'Lead');
    const customReadRoleId = randomUUID();
    const customEditorRoleId = randomUUID();
    const noScheduleRoleId = randomUUID();
    await db.insert(schema.roles).values([
      {
        id: customReadRoleId,
        name: `OWNERSHIP_READ_ONLY_${customReadRoleId}`,
        permissions: {
          grants: ['Media', 'Layout', 'Presentation', 'Schedule', 'ScheduleRequest'].map((subject) => ({
            action: 'read',
            subject,
          })),
        },
        is_system: false,
      },
      {
        id: customEditorRoleId,
        name: `OWNERSHIP_EDITOR_${customEditorRoleId}`,
        permissions: {
          grants: ['Media', 'Layout', 'Presentation', 'Schedule', 'ScheduleRequest'].flatMap((subject) =>
            ['read', 'create', 'update', 'delete'].map((action) => ({ action, subject }))
          ),
        },
        is_system: false,
      },
      {
        id: noScheduleRoleId,
        name: `OWNERSHIP_NO_SCHEDULE_${noScheduleRoleId}`,
        permissions: { grants: [{ action: 'read', subject: 'Dashboard' }] },
        is_system: false,
      },
    ]);
    const customRead = await createUser(customReadRoleId, departmentA, 'CustomRead');
    const customEditor = await createUser(customEditorRoleId, departmentA, 'CustomEditor');
    const noDepartment = await createUser(customEditorRoleId, null, 'NoDepartment');
    const noSchedule = await createUser(noScheduleRoleId, departmentA, 'NoSchedule');
    ownerId = owner.id;
    peerId = peer.id;
    outsiderId = outsider.id;
    customReadId = customRead.id;
    customEditorId = customEditor.id;
    ownerToken = await issueToken(owner.id, owner.email, testRoles.OPERATOR.id, 'OPERATOR', departmentA);
    peerToken = await issueToken(peer.id, peer.email, testRoles.OPERATOR.id, 'OPERATOR', departmentA);
    outsiderToken = await issueToken(outsider.id, outsider.email, testRoles.OPERATOR.id, 'OPERATOR', departmentB);
    leadToken = await issueToken(lead.id, lead.email, testRoles.DEPARTMENT.id, 'DEPARTMENT', departmentA);
    customReadToken = await issueToken(
      customRead.id,
      customRead.email,
      customReadRoleId,
      `OWNERSHIP_READ_ONLY_${customReadRoleId}`,
      departmentA
    );
    customEditorToken = await issueToken(
      customEditor.id,
      customEditor.email,
      customEditorRoleId,
      `OWNERSHIP_EDITOR_${customEditorRoleId}`,
      departmentA
    );
    noDepartmentToken = await issueToken(
      noDepartment.id,
      noDepartment.email,
      customEditorRoleId,
      `OWNERSHIP_EDITOR_${customEditorRoleId}`
    );
    noScheduleToken = await issueToken(
      noSchedule.id,
      noSchedule.email,
      noScheduleRoleId,
      `OWNERSHIP_NO_SCHEDULE_${noScheduleRoleId}`,
      departmentA
    );

    departmentResources = await insertResourceSet('Department A', ownerId, 'DEPARTMENT', departmentA);
    organizationResources = await insertResourceSet('Organization', testUser.id, 'ORGANIZATION', null);
    restrictedResources = await insertResourceSet('Restricted', ownerId, 'RESTRICTED', null);
    otherDepartmentResources = await insertResourceSet('Department B', outsiderId, 'DEPARTMENT', departmentB);
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('enforces organization, department, and restricted visibility in lists and details', async () => {
    for (const kind of ['media', 'layouts', 'presentations', 'schedules'] as const) {
      const peerList = await server.inject({ method: 'GET', url: listUrl(kind), headers: auth(peerToken) });
      expect(peerList.statusCode).toBe(200);
      const peerIds = new Set(JSON.parse(peerList.body).items.map((item: { id: string }) => item.id));
      expect(peerIds.has(departmentResources[kind])).toBe(true);
      expect(peerIds.has(organizationResources[kind])).toBe(true);
      expect(peerIds.has(restrictedResources[kind])).toBe(false);
      expect(peerIds.has(otherDepartmentResources[kind])).toBe(false);

      const outsiderDetail = await server.inject({
        method: 'GET',
        url: detailUrl(kind, departmentResources[kind]),
        headers: auth(outsiderToken),
      });
      expect(outsiderDetail.statusCode).toBe(403);

      const restrictedForPeer = await server.inject({
        method: 'GET',
        url: detailUrl(kind, restrictedResources[kind]),
        headers: auth(peerToken),
      });
      expect(restrictedForPeer.statusCode).toBe(403);

      const restrictedForAdmin = await server.inject({
        method: 'GET',
        url: detailUrl(kind, restrictedResources[kind]),
        headers: auth(adminToken),
      });
      expect(restrictedForAdmin.statusCode).toBe(200);
    }
  });

  it('exposes server-derived permissions for creator, peer, department lead, and admin', async () => {
    for (const kind of ['media', 'layouts', 'presentations', 'schedules'] as const) {
      const ownerResponse = await server.inject({
        method: 'GET',
        url: detailUrl(kind, departmentResources[kind]),
        headers: auth(ownerToken),
      });
      expect(ownerResponse.statusCode).toBe(200);
      expect(JSON.parse(ownerResponse.body).permissions.can_update).toBe(true);

      const peerResponse = await server.inject({
        method: 'GET',
        url: detailUrl(kind, departmentResources[kind]),
        headers: auth(peerToken),
      });
      expect(peerResponse.statusCode).toBe(200);
      expect(JSON.parse(peerResponse.body).permissions.can_update).toBe(false);

      const leadResponse = await server.inject({
        method: 'GET',
        url: detailUrl(kind, departmentResources[kind]),
        headers: auth(leadToken),
      });
      expect(leadResponse.statusCode).toBe(200);
      expect(JSON.parse(leadResponse.body).permissions.can_update).toBe(true);

      const adminResponse = await server.inject({
        method: 'GET',
        url: detailUrl(kind, departmentResources[kind]),
        headers: auth(adminToken),
      });
      expect(adminResponse.statusCode).toBe(200);
      expect(JSON.parse(adminResponse.body).permissions.can_update).toBe(true);
    }
  });

  it('keeps a read-only custom role readable but non-mutating across every owned resource', async () => {
    for (const kind of ['media', 'layouts', 'presentations', 'schedules'] as const) {
      const detail = await server.inject({
        method: 'GET',
        url: detailUrl(kind, departmentResources[kind]),
        headers: auth(customReadToken),
      });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.body).permissions).toEqual({ can_update: false, can_delete: false });
    }

    const deniedMutations = [
      server.inject({
        method: 'DELETE',
        url: `${detailUrl('media', departmentResources.media)}?hard=true`,
        headers: auth(customReadToken),
      }),
      server.inject({
        method: 'PATCH',
        url: detailUrl('layouts', departmentResources.layouts),
        headers: auth(customReadToken),
        payload: { name: 'Read-only layout mutation' },
      }),
      server.inject({
        method: 'PATCH',
        url: detailUrl('presentations', departmentResources.presentations),
        headers: auth(customReadToken),
        payload: { name: 'Read-only presentation mutation' },
      }),
      server.inject({
        method: 'PATCH',
        url: detailUrl('schedules', departmentResources.schedules),
        headers: auth(customReadToken),
        payload: { name: 'Read-only schedule mutation' },
      }),
    ];
    for (const response of await Promise.all(deniedMutations)) {
      expect(response.statusCode).toBe(403);
    }
  });

  it('returns pagination totals only for rows visible to the actor', async () => {
    for (const kind of ['media', 'layouts', 'presentations', 'schedules'] as const) {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/${kind}?page=1&limit=100`,
        headers: auth(customReadToken),
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.pagination.total).toBe(body.items.length);
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      expect(body.items.length).toBeLessThanOrEqual(100);
      expect(body.items.map((item: { id: string }) => item.id)).not.toContain(otherDepartmentResources[kind]);
      expect(body.items.map((item: { id: string }) => item.id)).not.toContain(restrictedResources[kind]);
    }
  });

  it('requires explicit abilities for publish reads and schedule-request cancellation', async () => {
    const db = getDatabase();
    const snapshotId = randomUUID();
    const publishId = randomUUID();
    const requestId = randomUUID();
    await db.insert(schema.scheduleSnapshots).values({
      id: snapshotId,
      schedule_id: departmentResources.schedules,
      payload: {},
    });
    await db.insert(schema.publishes).values({
      id: publishId,
      schedule_id: departmentResources.schedules,
      snapshot_id: snapshotId,
      published_by: testUser.id,
    });
    await db.insert(schema.scheduleRequests).values({
      id: requestId,
      schedule_id: departmentResources.schedules,
      schedule_payload: {},
      requested_by: customReadId,
    });

    const historyDenied = await server.inject({
      method: 'GET',
      url: `/api/v1/schedules/${departmentResources.schedules}/publishes`,
      headers: auth(noScheduleToken),
    });
    expect(historyDenied.statusCode).toBe(403);

    const statusDenied = await server.inject({
      method: 'GET',
      url: `/api/v1/publishes/${publishId}`,
      headers: auth(noScheduleToken),
    });
    expect(statusDenied.statusCode).toBe(403);

    const cancellationDenied = await server.inject({
      method: 'POST',
      url: `/api/v1/schedule-requests/${requestId}/cancel`,
      headers: auth(customReadToken),
    });
    expect(cancellationDenied.statusCode).toBe(403);
    const [unchanged] = await db
      .select()
      .from(schema.scheduleRequests)
      .where(eq(schema.scheduleRequests.id, requestId));
    expect(unchanged.status).toBe('PENDING');
  });

  it('allows a custom creator to manage only its own department content', async () => {
    const start = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const creates = [
      {
        kind: 'media' as const,
        payload: { name: 'custom-editor-image.png', type: 'IMAGE' },
      },
      {
        kind: 'layouts' as const,
        payload: {
          name: 'Custom editor layout',
          aspect_ratio: '16:9',
          spec: { slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1 }] },
        },
      },
      {
        kind: 'presentations' as const,
        payload: { name: 'Custom editor presentation' },
      },
      {
        kind: 'schedules' as const,
        payload: { name: 'Custom editor schedule', start_at: start.toISOString(), end_at: end.toISOString() },
      },
    ];

    const created: Partial<Record<ResourceKind, string>> = {};
    for (const target of creates) {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/${target.kind}`,
        headers: auth(customEditorToken),
        payload: target.payload,
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        created_by: customEditorId,
        ownership: { scope: 'DEPARTMENT', department_id: departmentA },
        permissions: { can_update: true },
      });
      created[target.kind] = body.id;
    }

    for (const kind of ['layouts', 'presentations', 'schedules'] as const) {
      const ownUpdate = await server.inject({
        method: 'PATCH',
        url: detailUrl(kind, created[kind]!),
        headers: auth(customEditorToken),
        payload: { name: `Custom editor updated ${kind}` },
      });
      expect(ownUpdate.statusCode).toBe(200);

      const peerUpdate = await server.inject({
        method: 'PATCH',
        url: detailUrl(kind, departmentResources[kind]),
        headers: auth(customEditorToken),
        payload: { name: `Custom editor attempted peer ${kind}` },
      });
      expect(peerUpdate.statusCode).toBe(403);
    }
  });

  it('denies content creation to a custom role without a department', async () => {
    const start = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const attempts = [
      { url: '/api/v1/media', payload: { name: 'no-department.png', type: 'IMAGE' } },
      {
        url: '/api/v1/layouts',
        payload: {
          name: 'No-department layout',
          aspect_ratio: '16:9',
          spec: { slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1 }] },
        },
      },
      { url: '/api/v1/presentations', payload: { name: 'No-department presentation' } },
      {
        url: '/api/v1/schedules',
        payload: { name: 'No-department schedule', start_at: start.toISOString(), end_at: end.toISOString() },
      },
    ];

    for (const attempt of attempts) {
      const response = await server.inject({
        method: 'POST',
        url: attempt.url,
        headers: auth(noDepartmentToken),
        payload: attempt.payload,
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('allows only an owner, department lead, or administrator to update department content', async () => {
    const targets = [
      { kind: 'layouts' as const, payload: { name: 'Owner updated layout' } },
      { kind: 'presentations' as const, payload: { name: 'Owner updated presentation' } },
      { kind: 'schedules' as const, payload: { name: 'Owner updated schedule' } },
    ];

    for (const target of targets) {
      const url = detailUrl(target.kind, departmentResources[target.kind]);
      const denied = await server.inject({ method: 'PATCH', url, headers: auth(peerToken), payload: target.payload });
      expect(denied.statusCode).toBe(403);

      const ownerUpdate = await server.inject({ method: 'PATCH', url, headers: auth(ownerToken), payload: target.payload });
      expect(ownerUpdate.statusCode).toBe(200);

      const leadUpdate = await server.inject({
        method: 'PATCH',
        url,
        headers: auth(leadToken),
        payload: { name: `Lead updated ${target.kind}` },
      });
      expect(leadUpdate.statusCode).toBe(200);

      const adminUpdate = await server.inject({
        method: 'PATCH',
        url,
        headers: auth(adminToken),
        payload: { name: `Admin updated ${target.kind}` },
      });
      expect(adminUpdate.statusCode).toBe(200);
    }
  });

  it('prevents a broad owner from embedding narrower content while allowing the inverse', async () => {
    const allowed = await server.inject({
      method: 'POST',
      url: '/api/v1/presentations',
      headers: auth(ownerToken),
      payload: { name: 'Department presentation using organization layout', layout_id: organizationResources.layouts },
    });
    expect(allowed.statusCode).toBe(201);

    const denied = await server.inject({
      method: 'POST',
      url: '/api/v1/presentations',
      headers: auth(adminToken),
      payload: { name: 'Organization presentation using department layout', layout_id: departmentResources.layouts },
    });
    expect(denied.statusCode).toBe(400);
    expect(JSON.parse(denied.body).error.message).toContain('narrower ownership');
  });

  it('rejects a legacy presentation with incompatible descendants before adding a schedule item', async () => {
    const db = getDatabase();
    const corruptPresentationId = randomUUID();
    await db.insert(schema.presentations).values({
      id: corruptPresentationId,
      name: 'Legacy organization presentation with department child',
      layout_id: departmentResources.layouts,
      created_by: testUser.id,
      owner_scope: 'ORGANIZATION',
      owner_department_id: null,
    });
    await db
      .update(schema.media)
      .set({ status: 'READY' })
      .where(eq(schema.media.id, departmentResources.media));
    await db.insert(schema.presentationItems).values({
      id: randomUUID(),
      presentation_id: corruptPresentationId,
      media_id: departmentResources.media,
      order: 0,
      duration_seconds: 10,
    });
    const [schedule] = await db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.id, organizationResources.schedules));
    const startAt = new Date(schedule.start_at.getTime() + 10 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 10 * 60 * 1000);

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/schedules/${schedule.id}/items`,
      headers: auth(adminToken),
      payload: {
        presentation_id: corruptPresentationId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        screen_ids: [],
        screen_group_ids: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.details).toMatchObject({
      reason: 'INCOMPATIBLE_CONTENT_OWNERSHIP',
    });
    const stored = await db
      .select()
      .from(schema.scheduleItems)
      .where(
        and(
          eq(schema.scheduleItems.schedule_id, schedule.id),
          eq(schema.scheduleItems.presentation_id, corruptPresentationId)
        )
      );
    expect(stored).toHaveLength(0);
  });

  it('rejects a schedule-request expansion instead of returning a partial incompatible tree', async () => {
    const db = getDatabase();
    const corruptPresentationId = randomUUID();
    const corruptItemId = randomUUID();
    const corruptRequestId = randomUUID();
    const [organizationSchedule] = await db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.id, organizationResources.schedules));
    await db.insert(schema.presentations).values({
      id: corruptPresentationId,
      name: 'Corrupt request expansion presentation',
      layout_id: departmentResources.layouts,
      created_by: testUser.id,
      owner_scope: 'ORGANIZATION',
      owner_department_id: null,
    });
    await db.insert(schema.scheduleItems).values({
      id: corruptItemId,
      schedule_id: organizationResources.schedules,
      presentation_id: corruptPresentationId,
      start_at: new Date(organizationSchedule.start_at.getTime() + 10 * 60 * 1000),
      end_at: new Date(organizationSchedule.start_at.getTime() + 20 * 60 * 1000),
      priority: 0,
      screen_ids: [],
      screen_group_ids: [],
    });
    await db.insert(schema.scheduleRequests).values({
      id: corruptRequestId,
      schedule_id: organizationResources.schedules,
      schedule_payload: {},
      requested_by: testUser.id,
    });

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/schedule-requests/${corruptRequestId}?include=all`,
      headers: auth(outsiderToken),
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.message).toContain('layout outside your ownership scope');
  });

  it('returns ownership and server permissions on every expanded nested content resource', async () => {
    const db = getDatabase();
    const now = Date.now();
    await db
      .update(schema.media)
      .set({ status: 'READY' })
      .where(eq(schema.media.id, departmentResources.media));
    await db
      .update(schema.presentations)
      .set({ layout_id: departmentResources.layouts })
      .where(eq(schema.presentations.id, departmentResources.presentations));
    await db.insert(schema.presentationItems).values({
      id: randomUUID(),
      presentation_id: departmentResources.presentations,
      media_id: departmentResources.media,
      order: 0,
      duration_seconds: 10,
    });
    await db.insert(schema.presentationSlotItems).values({
      id: randomUUID(),
      presentation_id: departmentResources.presentations,
      slot_id: 'main',
      media_id: departmentResources.media,
      order: 0,
      duration_seconds: 10,
    });
    await db.insert(schema.scheduleItems).values({
      id: randomUUID(),
      schedule_id: departmentResources.schedules,
      presentation_id: departmentResources.presentations,
      start_at: new Date(now + 3 * 60 * 60 * 1000),
      end_at: new Date(now + 4 * 60 * 60 * 1000),
      priority: 0,
      screen_ids: [],
      screen_group_ids: [],
    });

    const expectedMetadata = {
      created_by: ownerId,
      ownership: {
        scope: 'DEPARTMENT',
        department_id: departmentA,
        creator: { id: ownerId, status: 'ACTIVE' },
      },
      permissions: { can_update: false, can_delete: false },
    };

    const presentationDetail = await server.inject({
      method: 'GET',
      url: detailUrl('presentations', departmentResources.presentations),
      headers: auth(peerToken),
    });
    expect(presentationDetail.statusCode).toBe(200);
    const detail = JSON.parse(presentationDetail.body);
    expect(detail.layout).toMatchObject(expectedMetadata);
    expect(detail.slots[0].media).toMatchObject(expectedMetadata);

    const presentationItems = await server.inject({
      method: 'GET',
      url: `/api/v1/presentations/${departmentResources.presentations}/items`,
      headers: auth(peerToken),
    });
    expect(presentationItems.statusCode).toBe(200);
    expect(JSON.parse(presentationItems.body).items[0].media).toMatchObject(expectedMetadata);

    const presentationSlots = await server.inject({
      method: 'GET',
      url: `/api/v1/presentations/${departmentResources.presentations}/slots`,
      headers: auth(peerToken),
    });
    expect(presentationSlots.statusCode).toBe(200);
    expect(JSON.parse(presentationSlots.body).items[0].media).toMatchObject(expectedMetadata);

    const scheduleItems = await server.inject({
      method: 'GET',
      url: `/api/v1/schedules/${departmentResources.schedules}/items`,
      headers: auth(peerToken),
    });
    expect(scheduleItems.statusCode).toBe(200);
    const nestedPresentation = JSON.parse(scheduleItems.body).items[0].presentation;
    expect(nestedPresentation).toMatchObject(expectedMetadata);
    expect(nestedPresentation.layout).toMatchObject(expectedMetadata);
    expect(nestedPresentation.items[0].media).toMatchObject(expectedMetadata);
    expect(nestedPresentation.slots[0].media).toMatchObject(expectedMetadata);
  });

  it('rejects a stale layout write when department transfer commits first', async () => {
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database pool is required for transaction-order coverage');
    const user = await createUser(testRoles.OPERATOR.id, departmentA, 'TransferFirstWriter');
    const token = await issueToken(user.id, user.email, testRoles.OPERATOR.id, 'OPERATOR', departmentA);
    const resources = await insertResourceSet('Transfer first guarded', user.id, 'DEPARTMENT', departmentA);
    const blocker = await pool.connect();
    const observer = await pool.connect();

    try {
      await blocker.query('BEGIN');
      const blockerPid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      await blocker.query('UPDATE users SET department_id = $2, updated_at = NOW() WHERE id = $1', [user.id, departmentB]);
      await blocker.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);

      const writePromise = server.inject({
        method: 'PATCH',
        url: detailUrl('layouts', resources.layouts),
        headers: auth(token),
        payload: { name: 'Must not commit after transfer' },
      });

      await waitForDatabaseCondition(async () => {
        const result = await observer.query(
          'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) LIMIT 1',
          [blockerPid]
        );
        return result.rowCount === 1;
      }, 'the stale layout write to wait on the transfer transaction');

      await blocker.query('COMMIT');
      const response = await writePromise;
      expect(response.statusCode).toBe(401);

      const [layout] = await getDatabase()
        .select()
        .from(schema.layouts)
        .where(eq(schema.layouts.id, resources.layouts));
      expect(layout).toMatchObject({
        name: 'Transfer first guarded layout',
        created_by: user.id,
        owner_scope: 'DEPARTMENT',
        owner_department_id: departmentA,
      });
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
      observer.release();
    }
  }, 15000);

  it('allows a guarded layout write to commit before a waiting department transfer', async () => {
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database pool is required for transaction-order coverage');
    const user = await createUser(testRoles.OPERATOR.id, departmentA, 'WriteFirstWriter');
    const token = await issueToken(user.id, user.email, testRoles.OPERATOR.id, 'OPERATOR', departmentA);
    const resources = await insertResourceSet('Write first guarded', user.id, 'DEPARTMENT', departmentA);
    const layoutBlocker = await pool.connect();
    const transfer = await pool.connect();
    const observer = await pool.connect();

    try {
      await layoutBlocker.query('BEGIN');
      const layoutBlockerPid = Number(
        (await layoutBlocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      );
      await layoutBlocker.query('SELECT id FROM layouts WHERE id = $1 FOR UPDATE', [resources.layouts]);

      const writePromise = server.inject({
        method: 'PATCH',
        url: detailUrl('layouts', resources.layouts),
        headers: auth(token),
        payload: { name: 'Committed before transfer' },
      });

      await waitForDatabaseCondition(async () => {
        const result = await observer.query(
          'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) LIMIT 1',
          [layoutBlockerPid]
        );
        return result.rowCount === 1;
      }, 'the guarded layout write to hold the user lock while waiting on the layout');

      await transfer.query('BEGIN');
      const transferPid = Number((await transfer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      const transferUpdate = transfer.query(
        'UPDATE users SET department_id = $2, updated_at = NOW() WHERE id = $1',
        [user.id, departmentB]
      );

      await waitForDatabaseCondition(async () => {
        const result = await observer.query(
          'SELECT cardinality(pg_blocking_pids($1)) AS blockers',
          [transferPid]
        );
        return Number(result.rows[0]?.blockers ?? 0) > 0;
      }, 'the transfer to wait on the guarded writer user lock');

      await layoutBlocker.query('COMMIT');
      const response = await writePromise;
      expect(response.statusCode).toBe(200);

      await transferUpdate;
      await transfer.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      await transfer.query('COMMIT');

      const [layout] = await getDatabase()
        .select()
        .from(schema.layouts)
        .where(eq(schema.layouts.id, resources.layouts));
      expect(layout).toMatchObject({
        name: 'Committed before transfer',
        created_by: user.id,
        owner_scope: 'DEPARTMENT',
        owner_department_id: departmentA,
      });
      const revoked = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: auth(token),
      });
      expect(revoked.statusCode).toBe(401);
    } finally {
      await layoutBlocker.query('ROLLBACK').catch(() => undefined);
      await transfer.query('ROLLBACK').catch(() => undefined);
      layoutBlocker.release();
      transfer.release();
      observer.release();
    }
  }, 15000);

  it('keeps ownership stable when the creator moves departments and is later deleted', async () => {
    const db = getDatabase();
    const scheduleRequestId = randomUUID();
    await db.insert(schema.scheduleRequests).values({
      id: scheduleRequestId,
      schedule_id: departmentResources.schedules,
      schedule_payload: {},
      notes: 'Retained department request',
      requested_by: ownerId,
    });

    const moved = await server.inject({
      method: 'PATCH',
      url: `/api/v1/users/${ownerId}`,
      headers: auth(adminToken),
      payload: { department_id: departmentB },
    });
    expect(moved.statusCode).toBe(200);

    const revokedOldToken = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: auth(ownerToken),
    });
    expect(revokedOldToken.statusCode).toBe(401);

    const [movedOwner] = await getDatabase().select().from(schema.users).where(eq(schema.users.id, ownerId));
    const movedToken = await issueToken(
      ownerId,
      movedOwner.email,
      testRoles.OPERATOR.id,
      'OPERATOR',
      departmentB
    );
    const noLongerVisible = await server.inject({
      method: 'GET',
      url: detailUrl('layouts', departmentResources.layouts),
      headers: auth(movedToken),
    });
    expect(noLongerVisible.statusCode).toBe(403);

    const movedRequesterDenied = await server.inject({
      method: 'GET',
      url: `/api/v1/schedule-requests/${scheduleRequestId}?include=schedule,users`,
      headers: auth(movedToken),
    });
    expect(movedRequesterDenied.statusCode).toBe(403);

    const beforeDelete = await server.inject({
      method: 'GET',
      url: detailUrl('layouts', departmentResources.layouts),
      headers: auth(peerToken),
    });
    expect(beforeDelete.statusCode).toBe(200);
    expect(JSON.parse(beforeDelete.body).ownership).toMatchObject({
      scope: 'DEPARTMENT',
      department_id: departmentA,
      creator: { id: ownerId, status: 'ACTIVE' },
    });

    const deleted = await server.inject({
      method: 'DELETE',
      url: `/api/v1/users/${ownerId}`,
      headers: auth(adminToken),
    });
    expect(deleted.statusCode).toBe(200);

    const afterDelete = await server.inject({
      method: 'GET',
      url: detailUrl('layouts', departmentResources.layouts),
      headers: auth(peerToken),
    });
    expect(afterDelete.statusCode).toBe(200);
    expect(JSON.parse(afterDelete.body).ownership).toMatchObject({
      scope: 'DEPARTMENT',
      department_id: departmentA,
      creator: { id: ownerId, display_name: 'Owner Ownership', status: 'DELETED' },
    });

    const retainedRequest = await server.inject({
      method: 'GET',
      url: `/api/v1/schedule-requests/${scheduleRequestId}?include=schedule,users`,
      headers: auth(leadToken),
    });
    expect(retainedRequest.statusCode).toBe(200);
    expect(JSON.parse(retainedRequest.body)).toMatchObject({
      id: scheduleRequestId,
      requested_by_user: {
        id: ownerId,
        email: null,
        status: 'DELETED',
      },
      schedule: {
        id: departmentResources.schedules,
        ownership: { scope: 'DEPARTMENT', department_id: departmentA },
        permissions: { can_update: true },
      },
    });

    const tombstoneEmailSearch = await server.inject({
      method: 'GET',
      url: `/api/v1/schedule-requests?q=${encodeURIComponent(`deleted+${ownerId}@deleted.invalid`)}`,
      headers: auth(leadToken),
    });
    expect(tombstoneEmailSearch.statusCode).toBe(200);
    expect(JSON.parse(tombstoneEmailSearch.body).pagination.total).toBe(0);

    const retainedNameSearch = await server.inject({
      method: 'GET',
      url: `/api/v1/schedule-requests?q=${encodeURIComponent('Owner Ownership')}`,
      headers: auth(leadToken),
    });
    expect(retainedNameSearch.statusCode).toBe(200);
    expect(JSON.parse(retainedNameSearch.body).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: scheduleRequestId })])
    );

    const cancelledByOwningLead = await server.inject({
      method: 'POST',
      url: `/api/v1/schedule-requests/${scheduleRequestId}/cancel`,
      headers: auth(leadToken),
    });
    expect(cancelledByOwningLead.statusCode).toBe(200);
    expect(JSON.parse(cancelledByOwningLead.body).status).toBe('CANCELLED');

    const [storedLayout] = await db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.id, departmentResources.layouts));
    expect(storedLayout).toMatchObject({
      created_by: ownerId,
      owner_scope: 'DEPARTMENT',
      owner_department_id: departmentA,
    });
  });

  it('enforces delete ownership for media, layouts, and presentations', async () => {
    const deleteSet = await insertResourceSet('Delete matrix', peerId, 'DEPARTMENT', departmentA);
    const methods = [
      { kind: 'media' as const, suffix: '?hard=true', success: 200 },
      { kind: 'layouts' as const, suffix: '', success: 204 },
      { kind: 'presentations' as const, suffix: '', success: 204 },
    ];

    for (const entry of methods) {
      const url = `${detailUrl(entry.kind, deleteSet[entry.kind])}${entry.suffix}`;
      const denied = await server.inject({ method: 'DELETE', url, headers: auth(outsiderToken) });
      expect(denied.statusCode).toBe(403);
      const deleted = await server.inject({ method: 'DELETE', url, headers: auth(peerToken) });
      expect(deleted.statusCode).toBe(entry.success);
    }
  });
});
