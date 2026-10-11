import { eq, asc } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class PresentationSlotItemRepository {
    async listByPresentation(presentationId) {
        const db = getDatabase();
        return db
            .select()
            .from(schema.presentationSlotItems)
            .where(eq(schema.presentationSlotItems.presentation_id, presentationId))
            .orderBy(asc(schema.presentationSlotItems.slot_id), asc(schema.presentationSlotItems.order));
    }
    async create(data) {
        const db = getDatabase();
        const [item] = await db.insert(schema.presentationSlotItems).values(data).returning();
        return item;
    }
    async findById(id) {
        const db = getDatabase();
        const [item] = await db.select().from(schema.presentationSlotItems).where(eq(schema.presentationSlotItems.id, id));
        return item || null;
    }
    async delete(id) {
        const db = getDatabase();
        await db.delete(schema.presentationSlotItems).where(eq(schema.presentationSlotItems.id, id));
    }
}
export function createPresentationSlotItemRepository() {
    return new PresentationSlotItemRepository();
}
