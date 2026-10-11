import { eq, asc } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class PresentationItemRepository {
    async listByPresentation(presentationId) {
        const db = getDatabase();
        return db
            .select()
            .from(schema.presentationItems)
            .where(eq(schema.presentationItems.presentation_id, presentationId))
            .orderBy(asc(schema.presentationItems.order));
    }
    async create(data) {
        const db = getDatabase();
        const [item] = await db.insert(schema.presentationItems).values(data).returning();
        return item;
    }
    async findById(id) {
        const db = getDatabase();
        const [item] = await db.select().from(schema.presentationItems).where(eq(schema.presentationItems.id, id));
        return item || null;
    }
    async delete(id) {
        const db = getDatabase();
        await db.delete(schema.presentationItems).where(eq(schema.presentationItems.id, id));
    }
}
export function createPresentationItemRepository() {
    return new PresentationItemRepository();
}
