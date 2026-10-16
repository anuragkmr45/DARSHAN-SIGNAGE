import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  closeDatabase,
  getDatabase,
  getDatabasePool,
  initializeDatabase,
  schema,
} from '@/db';
import { createNotificationRepository } from '@/db/repositories/notification';
import { UserRepository } from '@/db/repositories/user';
import { hashPassword } from '@/auth/password';

async function waitForBlockedTransactions(client: PoolClient, minimum: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_locks WHERE NOT granted`
    );
    if (Number(result.rows[0]?.count ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${minimum} blocked PostgreSQL lock(s)`);
}

describe('notification creation versus user deletion', () => {
  let administratorId: string;
  let operatorRoleId: string;

  beforeAll(async () => {
    await initializeDatabase();
    const db = getDatabase();
    const [adminRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, 'ADMIN'))
      .limit(1);
    const [operatorRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, 'OPERATOR'))
      .limit(1);
    if (!adminRole || !operatorRole) {
      throw new Error('ADMIN and OPERATOR roles are required for notification deletion race tests');
    }
    operatorRoleId = operatorRole.id;
    administratorId = randomUUID();
    await db.insert(schema.users).values({
      id: administratorId,
      email: `notification-race-admin-${administratorId}@example.test`,
      password_hash: await hashPassword('Password123!'),
      first_name: 'Notification',
      last_name: 'Race Admin',
      role_id: adminRole.id,
      is_active: true,
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  async function createRecipient(label: string) {
    const id = randomUUID();
    await getDatabase().insert(schema.users).values({
      id,
      email: `${label}-${id}@example.test`,
      password_hash: await hashPassword('Password123!'),
      first_name: label,
      last_name: 'Recipient',
      role_id: operatorRoleId,
      is_active: true,
    });
    return id;
  }

  it('commits an already-authorized notification before deletion and rejects every later notification', async () => {
    const recipientId = await createRecipient('Notification first');
    const marker = `notification-before-delete-${randomUUID()}`;
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `notification_delete_barrier_fn_${suffix}`;
    const triggerName = `notification_delete_barrier_tr_${suffix}`;
    const advisoryKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database pool is not initialized');
    const control = await pool.connect();
    let notificationPromise: ReturnType<ReturnType<typeof createNotificationRepository>['create']> | undefined;
    let deletionPromise: ReturnType<UserRepository['tombstone']> | undefined;

    try {
      await control.query(`
        CREATE FUNCTION "${functionName}"() RETURNS trigger
        LANGUAGE plpgsql AS $function$
        BEGIN
          IF NEW.title = '${marker}' THEN
            PERFORM pg_advisory_xact_lock(${advisoryKey});
          END IF;
          RETURN NEW;
        END;
        $function$;
        CREATE TRIGGER "${triggerName}"
        BEFORE INSERT ON notifications
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
      `);
      await control.query('SELECT pg_advisory_lock($1)', [advisoryKey]);

      notificationPromise = createNotificationRepository().create({
        user_id: recipientId,
        title: marker,
        message: 'Authorized before the deletion transaction',
        type: 'SYSTEM',
      });
      await waitForBlockedTransactions(control, 1);

      deletionPromise = new UserRepository().tombstone(
        recipientId,
        administratorId,
        'invalid-after-delete'
      );
      await waitForBlockedTransactions(control, 2);

      await control.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
      const [notification, deletion] = await Promise.all([notificationPromise, deletionPromise]);
      expect(notification).not.toBeNull();
      expect(deletion?.alreadyDeleted).toBe(false);

      const rejectedAfterDelete = await createNotificationRepository().create({
        user_id: recipientId,
        title: 'after-delete',
        message: 'Must not commit',
        type: 'SYSTEM',
      });
      expect(rejectedAfterDelete).toBeNull();

      const rows = await getDatabase()
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.user_id, recipientId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.title).toBe(marker);
    } finally {
      await control.query('SELECT pg_advisory_unlock($1)', [advisoryKey]).catch(() => undefined);
      await Promise.allSettled([notificationPromise, deletionPromise].filter(Boolean));
      await control.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON notifications`);
      await control.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
      control.release();
    }
  });

  it('returns null and writes no counter when deletion commits first', async () => {
    const recipientId = await createRecipient('Deletion first');
    const deletion = await new UserRepository().tombstone(
      recipientId,
      administratorId,
      'invalid-after-delete'
    );
    expect(deletion?.alreadyDeleted).toBe(false);

    const notification = await createNotificationRepository().create({
      user_id: recipientId,
      title: 'must-not-exist',
      message: 'Deletion already committed',
      type: 'SYSTEM',
    });
    expect(notification).toBeNull();

    const db = getDatabase();
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.user_id, recipientId));
    const counters = await db
      .select()
      .from(schema.userNotificationCounters)
      .where(eq(schema.userNotificationCounters.user_id, recipientId));
    expect(rows).toHaveLength(0);
    expect(counters).toHaveLength(0);
  });
});
