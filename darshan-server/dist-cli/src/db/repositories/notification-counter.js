import { and, eq, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class NotificationCounterRepository {
    async getUnreadTotal(userId) {
        const db = getDatabase();
        const [counter] = await db
            .select({ unread_total: schema.userNotificationCounters.unread_total })
            .from(schema.userNotificationCounters)
            .where(eq(schema.userNotificationCounters.user_id, userId))
            .limit(1);
        if (counter)
            return Number(counter.unread_total || 0);
        return this.reconcile(userId);
    }
    async increment(userId, by = 1) {
        const step = Math.max(0, Math.trunc(by));
        if (step === 0)
            return this.getUnreadTotal(userId);
        const db = getDatabase();
        const [row] = await db
            .insert(schema.userNotificationCounters)
            .values({
            user_id: userId,
            unread_total: step,
            updated_at: new Date(),
        })
            .onConflictDoUpdate({
            target: schema.userNotificationCounters.user_id,
            set: {
                unread_total: sql `GREATEST(${schema.userNotificationCounters.unread_total} + ${step}, 0)`,
                updated_at: new Date(),
            },
        })
            .returning({ unread_total: schema.userNotificationCounters.unread_total });
        return Number(row?.unread_total || 0);
    }
    async decrement(userId, by = 1) {
        const step = Math.max(0, Math.trunc(by));
        if (step === 0)
            return this.getUnreadTotal(userId);
        const db = getDatabase();
        const [row] = await db
            .insert(schema.userNotificationCounters)
            .values({
            user_id: userId,
            unread_total: 0,
            updated_at: new Date(),
        })
            .onConflictDoUpdate({
            target: schema.userNotificationCounters.user_id,
            set: {
                unread_total: sql `GREATEST(${schema.userNotificationCounters.unread_total} - ${step}, 0)`,
                updated_at: new Date(),
            },
        })
            .returning({ unread_total: schema.userNotificationCounters.unread_total });
        return Number(row?.unread_total || 0);
    }
    async set(userId, value) {
        const target = Math.max(0, Math.trunc(value));
        const db = getDatabase();
        const [row] = await db
            .insert(schema.userNotificationCounters)
            .values({
            user_id: userId,
            unread_total: target,
            updated_at: new Date(),
        })
            .onConflictDoUpdate({
            target: schema.userNotificationCounters.user_id,
            set: {
                unread_total: target,
                updated_at: new Date(),
            },
        })
            .returning({ unread_total: schema.userNotificationCounters.unread_total });
        return Number(row?.unread_total || 0);
    }
    async reconcile(userId) {
        const db = getDatabase();
        return db.transaction(async (tx) => {
            const [unreadRow] = await tx
                .select({ count: sql `count(*)` })
                .from(schema.notifications)
                .where(and(eq(schema.notifications.user_id, userId), eq(schema.notifications.is_read, false)));
            const unread = Number(unreadRow?.count || 0);
            const [counterRow] = await tx
                .insert(schema.userNotificationCounters)
                .values({
                user_id: userId,
                unread_total: unread,
                updated_at: new Date(),
            })
                .onConflictDoUpdate({
                target: schema.userNotificationCounters.user_id,
                set: {
                    unread_total: unread,
                    updated_at: new Date(),
                },
            })
                .returning({ unread_total: schema.userNotificationCounters.unread_total });
            return Number(counterRow?.unread_total || 0);
        });
    }
    async reconcileAllUserCounters() {
        const db = getDatabase();
        const users = await db.select({ id: schema.users.id }).from(schema.users);
        const results = [];
        for (const user of users) {
            const unread_total = await this.reconcile(user.id);
            results.push({ userId: user.id, unread_total });
        }
        return results;
    }
}
export function createNotificationCounterRepository() {
    return new NotificationCounterRepository();
}
