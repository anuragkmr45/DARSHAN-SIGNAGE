import { eq, and, desc, or, sql, inArray } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class LayoutRepository {
    async create(data) {
        const db = getDatabase();
        const [layout] = await db.insert(schema.layouts).values(data).returning();
        return layout;
    }
    async findById(id) {
        const db = getDatabase();
        const [layout] = await db.select().from(schema.layouts).where(eq(schema.layouts.id, id));
        return layout || null;
    }
    async list(options) {
        const db = getDatabase();
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;
        const conditions = [];
        if (options.search?.trim()) {
            const searchTerm = `%${options.search.trim()}%`;
            conditions.push(or(sql `${schema.layouts.name} ILIKE ${searchTerm}`, sql `${schema.layouts.description} ILIKE ${searchTerm}`, sql `${schema.layouts.spec}::text ILIKE ${searchTerm}`));
        }
        if (options.aspect_ratio) {
            conditions.push(eq(schema.layouts.aspect_ratio, options.aspect_ratio));
        }
        if (options.created_by_ids) {
            if (options.created_by_ids.length === 0) {
                return { items: [], total: 0, page, limit };
            }
            conditions.push(inArray(schema.layouts.created_by, options.created_by_ids));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        let query = db.select().from(schema.layouts);
        if (whereClause) {
            query = query.where(whereClause);
        }
        const [totalRow] = await db
            .select({ count: sql `count(*)` })
            .from(schema.layouts)
            .where(whereClause);
        const items = await query.orderBy(desc(schema.layouts.created_at)).limit(limit).offset(offset);
        return {
            items,
            total: Number(totalRow?.count || 0),
            page,
            limit,
        };
    }
    async update(id, data) {
        const db = getDatabase();
        const [layout] = await db
            .update(schema.layouts)
            .set({ ...data, updated_at: new Date() })
            .where(eq(schema.layouts.id, id))
            .returning();
        return layout || null;
    }
    async delete(id) {
        const db = getDatabase();
        await db.delete(schema.layouts).where(eq(schema.layouts.id, id));
    }
}
export function createLayoutRepository() {
    return new LayoutRepository();
}
