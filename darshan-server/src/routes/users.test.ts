import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestServer, testUser, closeTestServer } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';
import { getDatabase, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { generateAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';

async function issueAdminToken() {
  const db = getDatabase();
  const [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'ADMIN')).limit(1);
  if (!adminRole) {
    throw new Error('ADMIN role is required for users route tests');
  }

  const currentPermissions =
    adminRole.permissions && typeof adminRole.permissions === 'object'
      ? (adminRole.permissions as { grants?: Array<{ action: string; subject: string }> })
      : {};
  const mergedGrants = [...(currentPermissions.grants || [])];

  for (const grant of [
    { action: 'create', subject: 'User' },
    { action: 'read', subject: 'User' },
    { action: 'update', subject: 'User' },
    { action: 'delete', subject: 'User' },
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

async function issueSuperAdminToken() {
  const db = getDatabase();
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'SUPER_ADMIN')).limit(1);
  if (!role) throw new Error('SUPER_ADMIN role is required for users route tests');
  const token = await generateAccessToken(testUser.id, testUser.email, role.id, role.name);
  await createSessionRepository().create({
    user_id: testUser.id,
    access_jti: token.jti,
    expires_at: token.expiresAt,
  });
  return token.token;
}

async function getRoleIdByName(name: string) {
  const db = getDatabase();
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
  if (!role) {
    throw new Error(`${name} role is required for users route tests`);
  }
  return role.id;
}

describe('User Routes', () => {
  let server: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await issueAdminToken();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  describe('POST /api/v1/users', () => {
    it('should return 401 without authorization', async () => {
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        payload: {
          email: 'newuser@example.com',
          password: 'Password123!',
          first_name: 'New',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it('should create user with valid admin token', async () => {
      const uniqueEmail = `newuser+${Date.now()}@example.com`;
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: uniqueEmail,
          password: 'Password123!',
          first_name: 'New',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.CREATED);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('id');
      expect(body.email).toBe(uniqueEmail);
      expect(body.role_id).toBe(operatorRoleId);
    });

    it('allows SUPER_ADMIN to create a DEPARTMENT user', async () => {
      const token = await issueSuperAdminToken();
      const departmentRoleId = await getRoleIdByName('DEPARTMENT');
      const db = getDatabase();
      const [department] = await db
        .insert(schema.departments)
        .values({ name: `Super Admin Managed ${Date.now()}` })
        .returning();
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          email: `super-admin-department-${Date.now()}@example.com`,
          password: 'Password123!',
          first_name: 'Department',
          last_name: 'Lead',
          role_id: departmentRoleId,
          department_id: department.id,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.CREATED);
      expect(JSON.parse(response.body)).toMatchObject({
        role: 'DEPARTMENT',
        department_id: department.id,
      });
    });

    it('should return 422 for invalid email', async () => {
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'invalid-email',
          password: 'Password123!',
          first_name: 'New',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNPROCESSABLE_CONTENT);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/users', () => {
    it('should return 401 without authorization', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users',
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it('should list users with valid token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users?page=1&limit=10',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(10);
    });

    it('should filter users by role name in the database query', async () => {
      const operatorEmail = `operator-${Date.now()}@example.com`;
      const adminEmail = `admin-${Date.now()}@example.com`;
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const adminRoleId = await getRoleIdByName('ADMIN');

      await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: operatorEmail,
          password: 'Password123!',
          first_name: 'Operator',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });

      await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: adminEmail,
          password: 'Password123!',
          first_name: 'Admin',
          last_name: 'User',
          role_id: adminRoleId,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users?role=OPERATOR',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.some((user: any) => user.email === operatorEmail)).toBe(true);
      expect(body.items.some((user: any) => user.email === adminEmail)).toBe(false);
      expect(body.items.every((user: any) => user.role === 'OPERATOR')).toBe(true);
    });

  });

  describe('GET /api/v1/users/:id', () => {
    it('should return 401 without authorization', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/users/${testUser.id}`,
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users/00000000-0000-0000-0000-000000000099',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    });

    it('should get user by ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/users/${testUser.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(testUser.id);
    });
  });

  describe('DELETE /api/v1/users/:id', () => {
    it('allows deleting a SUPER_ADMIN when another active SUPER_ADMIN remains', async () => {
      const token = await issueSuperAdminToken();
      const superAdminRoleId = await getRoleIdByName('SUPER_ADMIN');
      const db = getDatabase();
      const [target] = await db
        .insert(schema.users)
        .values({
          email: `protected-super-admin-${Date.now()}@example.com`,
          password_hash: 'not-used',
          first_name: 'Protected',
          last_name: 'Administrator',
          role_id: superAdminRoleId,
          is_active: true,
        })
        .returning();

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/users/${target.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const [deleted] = await db.select().from(schema.users).where(eq(schema.users.id, target.id));
      expect(deleted?.deleted_at).toBeInstanceOf(Date);
      expect(deleted?.is_active).toBe(false);
    });

    it('tombstones the account while preserving linked history and revoking its session', async () => {
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const originalEmail = `delete-linked-${Date.now()}@example.com`;
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: originalEmail,
          password: 'Password123!',
          first_name: 'Participant',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });

      expect(createResponse.statusCode).toBe(HTTP_STATUS.CREATED);
      const createdUser = JSON.parse(createResponse.body) as { id: string };
      const db = getDatabase();
      const [conversation] = await db
        .insert(schema.chatConversations)
        .values({
          type: 'GROUP_CLOSED',
          title: 'Delete Reference Test',
          created_by: testUser.id,
        })
        .returning();

      await db.insert(schema.chatMembers).values({
        conversation_id: conversation.id,
        user_id: createdUser.id,
        role: 'MEMBER',
      });
      const [processingMedia, completedMedia] = await db
        .insert(schema.media)
        .values([
          {
            name: 'Processing document at deletion',
            type: 'DOCUMENT',
            status: 'PROCESSING',
            created_by: createdUser.id,
            owner_scope: 'RESTRICTED',
          },
          {
            name: 'Completed media retained after deletion',
            type: 'IMAGE',
            status: 'READY',
            created_by: createdUser.id,
            owner_scope: 'RESTRICTED',
          },
        ])
        .returning();

      const targetAccess = await generateAccessToken(
        createdUser.id,
        `delete-linked-${Date.now()}@example.com`,
        operatorRoleId,
        'OPERATOR'
      );
      await createSessionRepository().create({
        user_id: createdUser.id,
        access_jti: targetAccess.jti,
        expires_at: targetAccess.expiresAt,
      });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/users/${createdUser.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body.already_deleted).toBe(false);

      const [deletedUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, createdUser.id));
      expect(deletedUser?.deleted_at).toBeInstanceOf(Date);
      expect(deletedUser?.email).toBe(`deleted+${createdUser.id}@deleted.invalid`);
      expect(deletedUser?.first_name).toBe('Participant');
      expect(deletedUser?.last_name).toBe('User');

      const [stoppedProcessingMedia, retainedCompletedMedia] = await Promise.all([
        db.select().from(schema.media).where(eq(schema.media.id, processingMedia.id)).then((rows) => rows[0]),
        db.select().from(schema.media).where(eq(schema.media.id, completedMedia.id)).then((rows) => rows[0]),
      ]);
      expect(stoppedProcessingMedia).toMatchObject({
        status: 'FAILED',
        status_reason: 'USER_DELETED_CLEANUP_PENDING',
        created_by: createdUser.id,
        owner_scope: 'RESTRICTED',
      });
      expect(retainedCompletedMedia).toMatchObject({
        status: 'READY',
        created_by: createdUser.id,
        owner_scope: 'RESTRICTED',
      });

      const [preservedMembership] = await db
        .select()
        .from(schema.chatMembers)
        .where(eq(schema.chatMembers.user_id, createdUser.id));
      expect(preservedMembership?.conversation_id).toBe(conversation.id);

      const revokedResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${targetAccess.token}` },
      });
      expect(revokedResponse.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);

      const secondDelete = await server.inject({
        method: 'DELETE',
        url: `/api/v1/users/${createdUser.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(secondDelete.statusCode).toBe(HTTP_STATUS.OK);
      expect(JSON.parse(secondDelete.body)).toMatchObject({
        id: createdUser.id,
        already_deleted: true,
        aborted_uploads: 0,
        cleaned_uploads: 0,
      });

      const listResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/users?page=1&limit=100',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(listResponse.statusCode).toBe(HTTP_STATUS.OK);
      expect(JSON.parse(listResponse.body).items).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: createdUser.id })])
      );

      const deletedDetail = await server.inject({
        method: 'GET',
        url: `/api/v1/users/${createdUser.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(deletedDetail.statusCode).toBe(HTTP_STATUS.NOT_FOUND);

      const emailReuse = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: originalEmail,
          password: 'Password123!',
          first_name: 'Replacement',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });
      expect(emailReuse.statusCode).toBe(HTTP_STATUS.CREATED);
      expect(JSON.parse(emailReuse.body).email).toBe(originalEmail);

      const deletionAudits = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.entity_id, createdUser.id));
      expect(deletionAudits.filter((entry) => entry.action === 'USER_DELETED')).toHaveLength(1);
    });
  });
});
