import { eq, asc, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class ScheduleItemRepository {
    async listBySchedule(scheduleId) {
        const db = getDatabase();
        return db
            .select()
            .from(schema.scheduleItems)
            .where(eq(schema.scheduleItems.schedule_id, scheduleId))
            .orderBy(asc(schema.scheduleItems.start_at));
    }
    async create(data) {
        const db = getDatabase();
        const [item] = await db
            .insert(schema.scheduleItems)
            .values({
            ...data,
            screen_ids: data.screen_ids ?? [],
            screen_group_ids: data.screen_group_ids ?? [],
        })
            .returning();
        await db
            .update(schema.schedules)
            .set({
            revision: sql `${schema.schedules.revision} + 1`,
            updated_at: new Date(),
        })
            .where(eq(schema.schedules.id, data.schedule_id));
        return item;
    }
    async delete(id) {
        const db = getDatabase();
        const [item] = await db.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.id, id));
        await db.delete(schema.scheduleItems).where(eq(schema.scheduleItems.id, id));
        if (item) {
            await db
                .update(schema.schedules)
                .set({
                revision: sql `${schema.schedules.revision} + 1`,
                updated_at: new Date(),
            })
                .where(eq(schema.schedules.id, item.schedule_id));
        }
    }
}
export function createScheduleItemRepository() {
    return new ScheduleItemRepository();
}
