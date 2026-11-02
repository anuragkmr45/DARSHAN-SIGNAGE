import { eq, desc, or, sql } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { countAdditionalDepartmentUsers } from '@/db/repositories/user-departments';

export class DepartmentRepository {
  async create(data: {
    name: string;
    description?: string;
  }) {
    const db = getDatabase();
    const result = await db.insert(schema.departments).values(data).returning();
    return result[0];
  }

  async findById(id: string) {
    const db = getDatabase();
    const result = await db
      .select()
      .from(schema.departments)
      .where(eq(schema.departments.id, id));
    return result[0] || null;
  }

  async list(options: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const db = getDatabase();
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    const escaped = options.search?.trim().replace(/[!%_]/g, '!$&');
    const pattern = escaped ? `%${escaped}%` : null;
    const whereClause = pattern ? or(
      sql`${schema.departments.name} ILIKE ${pattern} ESCAPE '!'`,
      sql`${schema.departments.description} ILIKE ${pattern} ESCAPE '!'`,
      sql`CAST(${schema.departments.id} AS text) ILIKE ${pattern} ESCAPE '!'`,
      sql`EXISTS (
        SELECT 1 FROM ${schema.users}
        JOIN ${schema.roles} ON ${schema.users.role_id} = ${schema.roles.id}
        WHERE ${schema.roles.name} = 'OPERATOR'
          AND ${schema.users.deleted_at} IS NULL
          AND (${schema.users.department_id} = ${schema.departments.id}
            OR EXISTS (SELECT 1 FROM ${schema.userAdditionalDepartments}
              WHERE ${schema.userAdditionalDepartments.user_id} = ${schema.users.id}
                AND ${schema.userAdditionalDepartments.department_id} = ${schema.departments.id}))
          AND (${schema.users.email} ILIKE ${pattern} ESCAPE '!'
            OR ${schema.users.first_name} ILIKE ${pattern} ESCAPE '!'
            OR ${schema.users.last_name} ILIKE ${pattern} ESCAPE '!')
      )`
    ) : undefined;

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.departments)
      .where(whereClause);

    const items = await db
      .select()
      .from(schema.departments)
      .where(whereClause)
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

  async update(id: string, data: Partial<typeof schema.departments.$inferInsert>) {
    const db = getDatabase();
    const result = await db
      .update(schema.departments)
      .set({ ...data, updated_at: new Date() })
      .where(eq(schema.departments.id, id))
      .returning();
    return result[0] || null;
  }

  async getDeleteUsageSummary(id: string) {
    const db = getDatabase();
    const count = async (table: any, column: any) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(table)
        .where(eq(column, id));
      return Number(row?.count ?? 0);
    };
    const [users, additionalUsers, media, layouts, presentations, schedules] = await Promise.all([
      count(schema.users, schema.users.department_id),
      countAdditionalDepartmentUsers(id, db),
      count(schema.media, schema.media.owner_department_id),
      count(schema.layouts, schema.layouts.owner_department_id),
      count(schema.presentations, schema.presentations.owner_department_id),
      count(schema.schedules, schema.schedules.owner_department_id),
    ]);
    return { users, additional_users: additionalUsers, media, layouts, presentations, schedules };
  }

  async delete(id: string) {
    const db = getDatabase();
    await db.delete(schema.departments).where(eq(schema.departments.id, id));
  }
}

export function createDepartmentRepository(): DepartmentRepository {
  return new DepartmentRepository();
}
