import { eq, desc, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class DepartmentRepository {
    async create(data) {
        const db = getDatabase();
        const result = await db.insert(schema.departments).values(data).returning();
        return result[0];
    }
    async findById(id) {
        const db = getDatabase();
        const result = await db
            .select()
            .from(schema.departments)
            .where(eq(schema.departments.id, id));
        return result[0] || null;
    }
    async list(options) {
        const db = getDatabase();
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;
        const [totalRow] = await db
            .select({ count: sql `count(*)` })
            .from(schema.departments);
        const items = await db
            .select()
            .from(schema.departments)
            .orderBy(desc(schema.departments.created_at))
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
            .update(schema.departments)
            .set({ ...data, updated_at: new Date() })
            .where(eq(schema.departments.id, id))
            .returning();
        return result[0] || null;
    }
    async delete(id) {
        const db = getDatabase();
        await db.delete(schema.departments).where(eq(schema.departments.id, id));
    }
}
export function createDepartmentRepository() {
    return new DepartmentRepository();
}
