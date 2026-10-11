import { eq, and, desc, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class PresentationRepository {
    async create(data) {
        const db = getDatabase();
        const result = await db.insert(schema.presentations).values(data).returning();
        return result[0];
    }
    async findById(id) {
        const db = getDatabase();
        const result = await db
            .select()
            .from(schema.presentations)
            .where(eq(schema.presentations.id, id));
        return result[0] || null;
    }
    async list(options) {
        const db = getDatabase();
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;
        const conditions = [];
        if (options.created_by) {
            conditions.push(eq(schema.presentations.created_by, options.created_by));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        let query = db.select().from(schema.presentations);
        if (whereClause) {
            query = query.where(whereClause);
        }
        const [totalRow] = await db
            .select({ count: sql `count(*)` })
            .from(schema.presentations)
            .where(whereClause);
        const items = await query
            .orderBy(desc(schema.presentations.created_at))
            .limit(limit)
            .offset(offset);
        return {
            items,
            total: Number(totalRow?.count || 0),
            page,
            limit,
        };
    }
    async update(id, data) {
        const db = getDatabase();
        const result = await db
            .update(schema.presentations)
            .set({ ...data, updated_at: new Date() })
            .where(eq(schema.presentations.id, id))
            .returning();
        return result[0] || null;
    }
    async delete(id) {
        const db = getDatabase();
        await db.delete(schema.presentations).where(eq(schema.presentations.id, id));
    }
}
export function createPresentationRepository() {
    return new PresentationRepository();
}
