import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createServer } from '@/server';
import { initializeDatabase, closeDatabase, getDatabase, schema } from '@/db';
import { generateAccessToken } from '@/auth/jwt';
import { hashPassword } from '@/auth/password';
import { createSessionRepository } from '@/db/repositories/session';
import { SYSTEM_ROLE_DEFAULTS } from '@/rbac/system-roles';
import { randomUUID } from 'node:crypto';

export async function createTestServer(): Promise<FastifyInstance> {
  await initializeDatabase();
  await seedTestData();
  // Tests invoke background work explicitly. Keeping the production dispatcher
  // off here prevents it from consuming fixtures between assertion steps.
  const server = await createServer({ startOutboxDispatcher: false });
  server.addHook('onClose', async () => {
    await closeDatabase();
  });
  return server;
}

export async function generateTestToken(userId: string, role: keyof typeof testRoles = 'ADMIN') {
  const roleRecord = testRoles[role];
  const [storedUser] = await getDatabase()
    .select({ role_id: schema.users.role_id, email: schema.users.email, department_id: schema.users.department_id })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!storedUser || storedUser.role_id !== roleRecord.id) {
    throw new Error(`Test token role ${role} does not match the stored user role`);
  }
  const result = await generateAccessToken(userId, storedUser.email, roleRecord.id, roleRecord.name, storedUser.department_id);
  const sessionRepo = createSessionRepository();
  await sessionRepo.create({
    user_id: userId,
    access_jti: result.jti,
    expires_at: result.expiresAt,
  });
  return result.token;
}

/** A real actor fixture: database role, JWT role and session always agree. */
export async function createTestActor(role: keyof typeof testRoles) {
  const db = getDatabase();
  const id = randomUUID();
  const email = `actor-${id}@example.test`;
  await db.insert(schema.users).values({
    id,
    email,
    password_hash: await hashPassword('TestPassword123!'),
    role_id: testRoles[role].id,
    is_active: true,
  });
  const access = await generateAccessToken(id, email, testRoles[role].id, role);
  await createSessionRepository().create({ user_id: id, access_jti: access.jti, expires_at: access.expiresAt });
  return { id, email, token: access.token };
}

export async function cleanupDatabase() {
  // const db = getDatabase();
  // Clean up test data
  // This should be implemented based on your database schema
}

export async function seedTestData() {
  const db = getDatabase();

  await db
    .insert(schema.roles)
    .values([
      {
        id: testRoles.SUPER_ADMIN.id,
        name: testRoles.SUPER_ADMIN.name,
        permissions: SYSTEM_ROLE_DEFAULTS.SUPER_ADMIN,
        is_system: true,
      },
      {
        id: testRoles.ADMIN.id,
        name: testRoles.ADMIN.name,
        permissions: SYSTEM_ROLE_DEFAULTS.ADMIN,
        is_system: true,
      },
      {
        id: testRoles.OPERATOR.id,
        name: testRoles.OPERATOR.name,
        permissions: SYSTEM_ROLE_DEFAULTS.OPERATOR,
        is_system: true,
      },
      {
        id: testRoles.DEPARTMENT.id,
        name: testRoles.DEPARTMENT.name,
        permissions: SYSTEM_ROLE_DEFAULTS.DEPARTMENT,
        is_system: true,
      },
    ])
    .onConflictDoNothing();

  const passwordHash = await hashPassword(testUser.password);
  await db
    .insert(schema.users)
    .values({
      id: testUser.id,
      email: testUser.email,
      password_hash: passwordHash,
      first_name: testUser.first_name,
      last_name: testUser.last_name,
      role_id: testUser.role_id,
      department_id: null,
      is_active: true,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        email: testUser.email,
        password_hash: passwordHash,
        first_name: testUser.first_name,
        last_name: testUser.last_name,
        role_id: testUser.role_id,
        department_id: null,
        is_active: true,
      },
    });
}

export async function closeTestServer(server: FastifyInstance) {
  const db = getDatabase();
  await db
    .update(schema.emergencies)
    .set({
      is_active: false,
      cleared_at: new Date(),
      clear_reason: 'test-server-cleanup',
      updated_at: new Date(),
    })
    .where(eq(schema.emergencies.triggered_by, testUser.id));
  await server.close();
  await closeDatabase();
}

export const testUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'test@example.com',
  password: 'TestPassword123!',
  first_name: 'Test',
  last_name: 'User',
  role_id: '00000000-0000-0000-0000-000000000010',
  role: 'ADMIN' as const,
};

export const testRoles = {
  SUPER_ADMIN: {
    id: '00000000-0000-0000-0000-000000000009',
    name: 'SUPER_ADMIN',
  },
  ADMIN: {
    id: '00000000-0000-0000-0000-000000000010',
    name: 'ADMIN',
  },
  OPERATOR: {
    id: '00000000-0000-0000-0000-000000000011',
    name: 'OPERATOR',
  },
  DEPARTMENT: {
    id: '00000000-0000-0000-0000-000000000012',
    name: 'DEPARTMENT',
  },
};

export const testMedia = {
  id: 'test-media-1',
  name: 'Test Video',
  type: 'VIDEO' as const,
};

export const testScreen = {
  id: 'test-screen-1',
  name: 'Test Screen',
  location: 'Test Location',
};

export const testSchedule = {
  id: 'test-schedule-1',
  name: 'Test Schedule',
  description: 'Test schedule description',
};
