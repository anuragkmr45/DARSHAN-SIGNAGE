import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config as appConfig } from '@/config';
import { verifyPassword } from '@/auth/password';
import * as schema from '@/db/schema';
import {
  cleanupExpiredSessions,
  createAdministrator,
  deactivateAdministrator,
  recoverAdministrator,
} from './admin-recovery';

const suite = appConfig.NODE_ENV === 'production' ? describe.skip : describe;

suite('administrator recovery and maintenance', () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schemaName: string;

  beforeEach(async () => {
    schemaName = `admin_recovery_test_${randomUUID().replace(/-/g, '')}`;
    adminPool = new Pool({ connectionString: appConfig.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    await adminPool.query(`
      CREATE TABLE "${schemaName}"."roles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" varchar(100) NOT NULL UNIQUE,
        "description" text, "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_system" boolean NOT NULL DEFAULT false, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "email" varchar(255) NOT NULL UNIQUE,
        "password_hash" text NOT NULL, "first_name" varchar(100), "last_name" varchar(100),
        "role_id" uuid NOT NULL, "department_id" uuid, "is_active" boolean NOT NULL DEFAULT true,
        "ext" jsonb, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL,
        "access_jti" varchar(255) NOT NULL UNIQUE, "expires_at" timestamp NOT NULL, "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid, "action" varchar(100) NOT NULL,
        "entity_type" varchar(100) NOT NULL, "entity_id" uuid, "ip_address" varchar(45),
        "storage_object_id" uuid, "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."system_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "level" varchar(20) NOT NULL,
        "message" text NOT NULL, "context" jsonb, "storage_object_id" uuid, "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);
    scopedPool = new Pool({ connectionString: appConfig.DATABASE_URL, options: `-c search_path=${schemaName}` });
  });

  afterEach(async () => {
    await scopedPool?.end();
    if (adminPool && schemaName) await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool?.end();
  });

  function database() {
    return drizzle(scopedPool, { schema });
  }

  async function seedRoles() {
    const db = database();
    await db.insert(schema.roles).values([
      { name: 'ADMIN', permissions: {}, is_system: true },
      { name: 'SUPER_ADMIN', permissions: {}, is_system: true },
    ]);
  }

  it('creates a role-linked account, avoids normalized-email duplicates, and audits password recovery', async () => {
    const db = database();
    await seedRoles();
    const created = await createAdministrator(db, {
      email: ' Operator@Example.Test ',
      password: 'OriginalPassword123!',
      ticket: 'CHG-100',
      firstName: 'Operator',
    });
    expect(created).toMatchObject({ status: 'created', account: { email: 'operator@example.test', roleName: 'ADMIN' } });

    const duplicate = await createAdministrator(db, {
      email: 'OPERATOR@example.test',
      password: 'AnotherPassword123!',
      ticket: 'CHG-101',
    });
    expect(duplicate).toMatchObject({ status: 'conflict' });

    const [account] = await db.select().from(schema.users);
    await db.insert(schema.sessions).values({
      user_id: account.id,
      access_jti: 'active-before-recovery',
      expires_at: new Date(Date.now() + 60_000),
    });
    const recovered = await recoverAdministrator(db, {
      email: account.email,
      password: 'RecoveredPassword123!',
      ticket: 'INC-200',
    });
    expect(recovered).toMatchObject({ status: 'recovered', account: { id: account.id, isActive: true } });
    const [updated] = await db.select().from(schema.users);
    expect(await verifyPassword('RecoveredPassword123!', updated.password_hash)).toBe(true);
    expect(await db.select().from(schema.sessions)).toHaveLength(0);
    expect((await db.select().from(schema.auditLogs)).map((entry) => entry.action).sort()).toEqual([
      'ADMIN_ACCOUNT_CREATED',
      'ADMIN_PASSWORD_RECOVERED',
    ]);
    expect(JSON.stringify(await db.select().from(schema.systemLogs))).not.toContain('RecoveredPassword123!');
  });

  it('does not reactivate or grant SUPER_ADMIN unless those flags are explicit', async () => {
    const db = database();
    await seedRoles();
    const [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'ADMIN'));
    const [superRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'SUPER_ADMIN'));
    const [inactiveAdmin] = await db
      .insert(schema.users)
      .values({
        email: 'inactive-admin@example.test',
        password_hash: 'old-hash',
        role_id: adminRole.id,
        is_active: false,
      })
      .returning();

    const ordinaryRecovery = await recoverAdministrator(db, {
      email: 'INACTIVE-ADMIN@example.test',
      password: 'OrdinaryRecoveryPassword123!',
      ticket: 'INC-250',
    });
    expect(ordinaryRecovery).toMatchObject({
      status: 'recovered',
      account: { id: inactiveAdmin.id, isActive: false, roleName: 'ADMIN' },
    });
    const [ordinaryRecovered] = await db.select().from(schema.users).where(eq(schema.users.id, inactiveAdmin.id));
    expect(ordinaryRecovered.is_active).toBe(false);
    expect(ordinaryRecovered.role_id).toBe(adminRole.id);
    expect(await verifyPassword('OrdinaryRecoveryPassword123!', ordinaryRecovered.password_hash)).toBe(true);

    const privilegedRecovery = await recoverAdministrator(db, {
      email: 'inactive-admin@example.test',
      password: 'PrivilegedRecoveryPassword123!',
      ticket: 'INC-251',
      reactivate: true,
      grantSuperAdmin: true,
    });
    expect(privilegedRecovery).toMatchObject({
      status: 'recovered',
      account: { id: inactiveAdmin.id, isActive: true, roleName: 'SUPER_ADMIN' },
    });
    const [privilegedRecovered] = await db.select().from(schema.users).where(eq(schema.users.id, inactiveAdmin.id));
    expect(privilegedRecovered.is_active).toBe(true);
    expect(privilegedRecovered.role_id).toBe(superRole.id);
    expect(await verifyPassword('PrivilegedRecoveryPassword123!', privilegedRecovered.password_hash)).toBe(true);
  });

  it('rejects multiline change tickets before writing recovery audit state', async () => {
    const db = database();
    await seedRoles();
    const [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'ADMIN'));
    const [admin] = await db.insert(schema.users).values({
      email: 'ticket-check@example.test',
      password_hash: 'old-hash',
      role_id: adminRole.id,
      is_active: true,
    }).returning();

    await expect(recoverAdministrator(db, {
      email: admin.email,
      password: 'RecoveredPassword123!',
      ticket: 'INC-400\nspoofed-log-line',
    })).rejects.toThrow('single line');
    expect(await db.select().from(schema.auditLogs)).toHaveLength(0);
    expect(await db.select().from(schema.systemLogs)).toHaveLength(0);
  });

  it('refuses last-super-admin deactivation, revokes sessions on a permitted deactivation, and removes only expired sessions', async () => {
    const db = database();
    await seedRoles();
    const [superRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'SUPER_ADMIN'));
    const [first] = await db
      .insert(schema.users)
      .values({ email: 'first@example.test', password_hash: 'hash', role_id: superRole.id, is_active: true })
      .returning();
    const lastSuperAdmin = await deactivateAdministrator(db, { email: first.email, ticket: 'INC-300' });
    expect(lastSuperAdmin).toMatchObject({ status: 'conflict' });

    const second = await createAdministrator(db, {
      email: 'second@example.test',
      password: 'SecondAdminPassword123!',
      ticket: 'CHG-301',
      roleName: 'SUPER_ADMIN',
    });
    expect(second).toMatchObject({ status: 'created' });
    await db.insert(schema.sessions).values([
      { user_id: first.id, access_jti: 'first-active', expires_at: new Date(Date.now() + 60_000) },
      { user_id: second.account.id, access_jti: 'second-expired', expires_at: new Date(Date.now() - 60_000) },
      { user_id: second.account.id, access_jti: 'second-active', expires_at: new Date(Date.now() + 60_000) },
    ]);
    const deactivated = await deactivateAdministrator(db, { email: first.email, ticket: 'INC-302' });
    expect(deactivated).toMatchObject({ status: 'deactivated', account: { id: first.id, isActive: false } });
    const sessionsAfterDeactivate = await db.select().from(schema.sessions);
    expect(sessionsAfterDeactivate.map((session) => session.access_jti).sort()).toEqual(['second-active', 'second-expired']);

    expect(await cleanupExpiredSessions(db)).toEqual({ deleted: 1 });
    expect((await db.select().from(schema.sessions)).map((session) => session.access_jti)).toEqual(['second-active']);
  });
});
