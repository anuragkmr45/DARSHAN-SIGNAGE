import { eq, and, desc, asc, or, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
function resolveDb(executor) {
    return executor ?? getDatabase();
}
export class ScreenRepository {
    async create(data, executor) {
        const db = resolveDb(executor);
        const result = await db.insert(schema.screens).values(data).returning();
        return result[0];
    }
    async findById(id, executor) {
        const db = resolveDb(executor);
        const result = await db.select().from(schema.screens).where(eq(schema.screens.id, id));
        return result[0] || null;
    }
    async list(options) {
        const db = getDatabase();
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;
        const conditions = [];
        if (options.status) {
            conditions.push(eq(schema.screens.status, options.status));
        }
        if (options.q?.trim()) {
            const term = `%${options.q.trim()}%`;
            conditions.push(or(sql `${schema.screens.id}::text ILIKE ${term}`, sql `${schema.screens.name} ILIKE ${term}`, sql `${schema.screens.location} ILIKE ${term}`));
        }
        let query = db.select().from(schema.screens);
        if (conditions.length > 0) {
            query = query.where(and(...conditions));
        }
        const [total] = await db
            .select({ count: sql `count(*)` })
            .from(schema.screens)
            .where(conditions.length > 0 ? and(...conditions) : undefined);
        const items = await query
            .orderBy(desc(schema.screens.created_at))
            .limit(limit)
            .offset(offset);
        return {
            items,
            total: Number(total?.count ?? 0),
            page,
            limit,
        };
    }
    async listAspectRatios(options) {
        const db = getDatabase();
        const conditions = [];
        if (options?.search?.trim()) {
            const term = `%${options.search.trim()}%`;
            conditions.push(or(sql `${schema.screens.name} ILIKE ${term}`, sql `${schema.screens.aspect_ratio} ILIKE ${term}`));
        }
        let query = db
            .select({
            id: schema.screens.id,
            name: schema.screens.name,
            aspect_ratio: schema.screens.aspect_ratio,
            width: schema.screens.width,
            height: schema.screens.height,
        })
            .from(schema.screens);
        if (conditions.length > 0) {
            query = query.where(and(...conditions));
        }
        return query.orderBy(asc(schema.screens.name));
    }
    async update(id, data, executor) {
        const db = resolveDb(executor);
        const result = await db
            .update(schema.screens)
            .set({ ...data, updated_at: new Date() })
            .where(eq(schema.screens.id, id))
            .returning();
        return result[0] || null;
    }
    async delete(id) {
        const db = getDatabase();
        await db.delete(schema.screens).where(eq(schema.screens.id, id));
    }
}
export function createScreenRepository() {
    return new ScreenRepository();
}
