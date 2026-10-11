import { eq, and, desc, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class RequestRepository {
    async create(data) {
        const db = getDatabase();
        const result = await db.insert(schema.requests).values({
            ...data,
            status: data.status || 'OPEN'
        }).returning();
        return result[0];
    }
    async findById(id) {
        const db = getDatabase();
        const result = await db
            .select()
            .from(schema.requests)
            .where(eq(schema.requests.id, id));
        return result[0] || null;
    }
    async list(options) {
        const db = getDatabase();
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;
        const conditions = [];
        if (options.status) {
            conditions.push(eq(schema.requests.status, options.status));
        }
        if (options.assigned_to) {
            conditions.push(eq(schema.requests.assigned_to, options.assigned_to));
        }
        if (options.created_by) {
            conditions.push(eq(schema.requests.created_by, options.created_by));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        let query = db.select().from(schema.requests);
        if (whereClause) {
            query = query.where(whereClause);
        }
        const [totalRow] = await db
            .select({ count: sql `count(*)` })
            .from(schema.requests)
            .where(whereClause);
        const items = await query
            .orderBy(desc(schema.requests.created_at))
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
            .update(schema.requests)
            .set({ ...data, updated_at: new Date() })
            .where(eq(schema.requests.id, id))
            .returning();
        return result[0] || null;
    }
    async delete(id) {
        const db = getDatabase();
        await db.delete(schema.requests).where(eq(schema.requests.id, id));
    }
}
export function createRequestRepository() {
    return new RequestRepository();
}
