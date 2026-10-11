import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class AuditLogRepository {
    async create(data) {
        const db = getDatabase();
        const result = await db.insert(schema.auditLogs).values({
            ...data,
            entity_type: data.resource_type,
        }).returning();
        return result[0];
    }
    async list(options) {
        const db = getDatabase();
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;
        const conditions = this.buildConditions(options);
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        let query = db.select().from(schema.auditLogs);
        if (whereClause) {
            query = query.where(whereClause);
        }
        const [totalRow] = await db
            .select({ count: sql `count(*)` })
            .from(schema.auditLogs)
            .where(whereClause);
        const items = await query
            .orderBy(desc(schema.auditLogs.created_at))
            .limit(limit)
            .offset(offset);
        return {
            items,
            total: Number(totalRow?.count || 0),
            page,
            limit,
        };
    }
    async findById(id) {
        const db = getDatabase();
        const result = await db
            .select()
            .from(schema.auditLogs)
            .where(eq(schema.auditLogs.id, id));
        return result[0] || null;
    }
    async listAll(options) {
        const db = getDatabase();
        const conditions = this.buildConditions(options);
        return db
            .select()
            .from(schema.auditLogs)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(schema.auditLogs.created_at));
    }
    buildConditions(options) {
        const conditions = [];
        if (options.user_id) {
            conditions.push(eq(schema.auditLogs.user_id, options.user_id));
        }
        if (options.resource_type) {
            conditions.push(eq(schema.auditLogs.entity_type, options.resource_type));
        }
        if (options.action) {
            conditions.push(eq(schema.auditLogs.action, options.action));
        }
        if (options.startDate) {
            conditions.push(gte(schema.auditLogs.created_at, options.startDate));
        }
        if (options.endDate) {
            conditions.push(lte(schema.auditLogs.created_at, options.endDate));
        }
        return conditions;
    }
}
export function createAuditLogRepository() {
    return new AuditLogRepository();
}
