import { desc, eq, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class EmergencyTypeRepository {
    async create(data) {
        const db = getDatabase();
        const [row] = await db
            .insert(schema.emergencyTypes)
            .values({
            name: data.name,
            description: data.description ?? null,
            message: data.message,
            severity: data.severity,
            media_id: data.media_id ?? null,
        })
            .returning();
        return row;
    }
    async list(options) {
        const db = getDatabase();
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;
        const [totalRow] = await db
            .select({ count: sql `count(*)` })
            .from(schema.emergencyTypes);
        const items = await db
            .select()
            .from(schema.emergencyTypes)
            .orderBy(desc(schema.emergencyTypes.created_at))
            .limit(limit)
            .offset(offset);
        return { items, total: Number(totalRow?.count || 0), page, limit };
    }
    async findById(id) {
        const db = getDatabase();
        const [row] = await db.select().from(schema.emergencyTypes).where(eq(schema.emergencyTypes.id, id));
        return row || null;
    }
    async update(id, data) {
        const db = getDatabase();
        const [row] = await db
            .update(schema.emergencyTypes)
            .set({
            name: data.name,
            description: typeof data.description === 'undefined' ? undefined : data.description,
            message: data.message,
            severity: data.severity,
            media_id: typeof data.media_id === 'undefined' ? undefined : data.media_id,
            updated_at: new Date(),
        })
            .where(eq(schema.emergencyTypes.id, id))
            .returning();
        return row || null;
    }
    async delete(id) {
        const db = getDatabase();
        await db.delete(schema.emergencyTypes).where(eq(schema.emergencyTypes.id, id));
    }
}
export function createEmergencyTypeRepository() {
    return new EmergencyTypeRepository();
}
