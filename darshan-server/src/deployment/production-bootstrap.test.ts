import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config as appConfig } from '@/config';
import * as schema from '@/db/schema';
import { verifyPassword } from '@/auth/password';
import { BoundedAdvisoryLockError } from './bounded-advisory-lock';
import { adoptProductionBootstrapState, bootstrapProductionDatabase } from './production-bootstrap';

const shouldSkip = appConfig.NODE_ENV === 'production';
const suite = shouldSkip ? describe.skip : describe;

suite('production bootstrap', () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schemaName: string;

  beforeEach(async () => {
    schemaName = `production_bootstrap_test_${randomUUID().replace(/-/g, '')}`;
    adminPool = new Pool({ connectionString: appConfig.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    await adminPool.query(`
      CREATE TABLE "${schemaName}"."roles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL UNIQUE,
        "description" text,
        "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_system" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL UNIQUE,
        "password_hash" text NOT NULL,
        "first_name" varchar(100),
        "last_name" varchar(100),
        "role_id" uuid NOT NULL,
        "department_id" uuid,
        "is_active" boolean NOT NULL DEFAULT true,
        "ext" jsonb,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."departments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "description" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."screens" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE "${schemaName}"."emergency_status" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "is_active" boolean NOT NULL DEFAULT false,
        "triggered_by" uuid,
        "triggered_at" timestamp,
        "cleared_by" uuid,
        "cleared_at" timestamp,
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."production_bootstrap_states" (
        "id" varchar(64) PRIMARY KEY,
        "bootstrap_version" varchar(64) NOT NULL,
        "admin_user_id" uuid NOT NULL,
        "release_id" varchar(128) NOT NULL,
        "completed_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid,
        "action" varchar(100) NOT NULL,
        "entity_type" varchar(100) NOT NULL,
        "entity_id" uuid,
        "ip_address" varchar(45),
        "storage_object_id" uuid,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."system_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "level" varchar(20) NOT NULL,
        "message" text NOT NULL,
        "context" jsonb,
        "storage_object_id" uuid,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);
    scopedPool = new Pool({
      connectionString: appConfig.DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
  });

  afterEach(async () => {
    await scopedPool?.end();
    if (adminPool && schemaName) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    await adminPool?.end();
  });

  function database() {
    return drizzle(scopedPool, { schema });
  }

  it('creates only mandatory production records and preserves them on rerun', async () => {
    const db = database();
    const created = await bootstrapProductionDatabase(db, {
      email: '  Admin@Example.Test ',
      password: 'StrongPassword123!',
      releaseId: 'release-test',
    });
    expect(created).toMatchObject({
      status: 'created',
      code: 'PRODUCTION_BOOTSTRAP_CREATED',
      adminEmail: 'admin@example.test',
    });

    const [admin] = await db.select().from(schema.users);
    expect(admin.email).toBe('admin@example.test');
    expect(await verifyPassword('StrongPassword123!', admin.password_hash)).toBe(true);
    expect((await db.select().from(schema.roles)).map((role) => role.name).sort()).toEqual([
      'ADMIN',
      'DEPARTMENT',
      'OPERATOR',
      'SUPER_ADMIN',
    ]);
    expect(await db.select().from(schema.departments)).toHaveLength(0);
    expect(await db.select().from(schema.emergencyStatus)).toHaveLength(1);
    expect((await db.select().from(schema.auditLogs)).map((entry) => entry.action)).toEqual([
      'PRODUCTION_BOOTSTRAP_CREATED',
    ]);
    const systemLogs = await db.select().from(schema.systemLogs);
    expect(systemLogs).toHaveLength(1);
    expect(JSON.stringify(systemLogs)).toContain('release-test');
    expect(JSON.stringify(systemLogs)).not.toContain('StrongPassword123!');

    const rerun = await bootstrapProductionDatabase(db, { email: 'admin@example.test' });
    expect(rerun).toMatchObject({ status: 'already_initialized', adminEmail: 'admin@example.test' });
    const [unchangedAdmin] = await db.select().from(schema.users);
    expect(await verifyPassword('StrongPassword123!', unchangedAdmin.password_hash)).toBe(true);
  });

  it('serializes concurrent bootstrap requests without resetting credentials', async () => {
    const db = database();
    const results = await Promise.all([
      bootstrapProductionDatabase(db, {
        email: 'admin@example.test',
        password: 'StrongPassword123!',
        releaseId: 'release-concurrent-test',
      }),
      bootstrapProductionDatabase(db, {
        email: 'admin@example.test',
        password: 'DifferentPassword456!',
        releaseId: 'release-concurrent-test',
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['already_initialized', 'created']);
    const [admin] = await db.select().from(schema.users);
    const firstMatches = await verifyPassword('StrongPassword123!', admin.password_hash);
    const secondMatches = await verifyPassword('DifferentPassword456!', admin.password_hash);
    expect(firstMatches || secondMatches).toBe(true);
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });

  it('requires a release identifier before creating bootstrap state', async () => {
    const db = database();
    await expect(bootstrapProductionDatabase(db, {
      email: 'admin@example.test',
      password: 'StrongPassword123!',
    })).rejects.toMatchObject({ code: 'BOOTSTRAP_RELEASE_REQUIRED' });
    await expect(bootstrapProductionDatabase(db, {
      email: 'admin@example.test',
      password: 'StrongPassword123!',
      releaseId: ' release with spaces ',
    })).rejects.toMatchObject({ code: 'BOOTSTRAP_RELEASE_REQUIRED' });
    expect(await db.select().from(schema.users)).toHaveLength(0);
    expect(await db.select().from(schema.roles)).toHaveLength(0);
    expect(await db.select().from(schema.productionBootstrapStates)).toHaveLength(0);
  });

  it('fails fast instead of hanging when another bootstrap owns the advisory lock', async () => {
    const db = database();
    await adminPool.query('SELECT pg_advisory_lock(hashtext($1))', ['darshan:production-bootstrap']);
    try {
      await expect(bootstrapProductionDatabase(db, {
        email: 'admin@example.test',
        password: 'StrongPassword123!',
        lockOptions: { timeoutMs: 50, pollIntervalMs: 10 },
      })).rejects.toBeInstanceOf(BoundedAdvisoryLockError);
      expect(await db.select().from(schema.users)).toHaveLength(0);
    } finally {
      await adminPool.query('SELECT pg_advisory_unlock(hashtext($1))', ['darshan:production-bootstrap']);
    }
  });

  it('fails closed when the database already contains application records', async () => {
    const db = database();
    await db.insert(schema.departments).values({ name: 'Existing data' });
    const result = await bootstrapProductionDatabase(db, {
      email: 'admin@example.test',
      password: 'StrongPassword123!',
    });
    expect(result).toMatchObject({ status: 'conflict', code: 'PRODUCTION_BOOTSTRAP_CONFLICT' });
    expect(await db.select().from(schema.roles)).toHaveLength(0);
  });

  it('records an explicitly approved existing active SUPER_ADMIN without changing credentials', async () => {
    const db = database();
    const [superAdmin] = await db.insert(schema.roles).values({
      name: 'SUPER_ADMIN',
      description: 'Existing role',
      permissions: {},
      is_system: true,
    }).returning({ id: schema.roles.id });
    const [administrator] = await db.insert(schema.users).values({
      email: ' Existing.Admin@Example.Test ',
      password_hash: 'existing-password-hash-must-remain-unchanged',
      role_id: superAdmin.id,
      is_active: true,
    }).returning({ id: schema.users.id, password_hash: schema.users.password_hash });

    const adopted = await adoptProductionBootstrapState(db, {
      email: 'existing.admin@example.test',
      releaseId: 'release-adoption-test',
      ticket: 'CHG-BOOTSTRAP-ADOPT',
    });
    expect(adopted).toMatchObject({
      status: 'created',
      code: 'PRODUCTION_BOOTSTRAP_ADOPTED',
      adminEmail: ' Existing.Admin@Example.Test ',
    });
    const [state] = await db.select().from(schema.productionBootstrapStates);
    expect(state).toMatchObject({
      id: 'production',
      admin_user_id: administrator.id,
      bootstrap_version: 'adopted-v1',
      release_id: 'release-adoption-test',
    });
    const [unchanged] = await db.select().from(schema.users);
    expect(unchanged.password_hash).toBe(administrator.password_hash);
    expect((await db.select().from(schema.auditLogs)).map((entry) => entry.action)).toEqual([
      'PRODUCTION_BOOTSTRAP_ADOPTED',
    ]);
    const systemLogs = await db.select().from(schema.systemLogs);
    expect(JSON.stringify(systemLogs)).toContain('CHG-BOOTSTRAP-ADOPT');
    expect(JSON.stringify(systemLogs)).toContain('release-adoption-test');

    await expect(adoptProductionBootstrapState(db, {
      email: 'existing.admin@example.test',
      releaseId: 'release-adoption-test',
    })).resolves.toMatchObject({ status: 'already_initialized' });
  });

  it('refuses to record an inactive or non-super-admin legacy user as the bootstrap authority', async () => {
    const db = database();
    const [adminRole] = await db.insert(schema.roles).values({
      name: 'ADMIN',
      description: 'Existing role',
      permissions: {},
      is_system: true,
    }).returning({ id: schema.roles.id });
    await db.insert(schema.users).values({
      email: 'legacy.admin@example.test',
      password_hash: 'existing-password-hash',
      role_id: adminRole.id,
      is_active: false,
    });

    await expect(adoptProductionBootstrapState(db, {
      email: 'legacy.admin@example.test',
      releaseId: 'release-adoption-test',
    })).resolves.toMatchObject({
      status: 'conflict',
      code: 'PRODUCTION_BOOTSTRAP_CONFLICT',
      reason: expect.stringContaining('active and hold the SUPER_ADMIN role'),
    });
    expect(await db.select().from(schema.productionBootstrapStates)).toHaveLength(0);
  });

  it('requires a release identifier before adopting existing bootstrap authority', async () => {
    const db = database();
    const [superAdmin] = await db.insert(schema.roles).values({
      name: 'SUPER_ADMIN',
      description: 'Existing role',
      permissions: {},
      is_system: true,
    }).returning({ id: schema.roles.id });
    await db.insert(schema.users).values({
      email: 'legacy.admin@example.test',
      password_hash: 'existing-password-hash-must-remain-unchanged',
      role_id: superAdmin.id,
      is_active: true,
    });

    await expect(adoptProductionBootstrapState(db, {
      email: 'legacy.admin@example.test',
    })).rejects.toMatchObject({ code: 'BOOTSTRAP_RELEASE_REQUIRED' });
    expect(await db.select().from(schema.productionBootstrapStates)).toHaveLength(0);
    expect(await db.select().from(schema.auditLogs)).toHaveLength(0);
    expect(await db.select().from(schema.systemLogs)).toHaveLength(0);
  });
});
