import { and, eq, desc, asc, sql, type SQL } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';

export class DepartmentRepository {
  async create(data: {
    name: string;
    description?: string;
  }, executor: DbExecutor = getDatabase()) {
    const result = await executor.insert(schema.departments).values(data).returning();
    return result[0];
  }

  async findById(id: string, predicate?: SQL) {
    const db = getDatabase();
    const result = await db
      .select()
      .from(schema.departments)
      .where(predicate ? and(eq(schema.departments.id, id), predicate) : eq(schema.departments.id, id));
    return result[0] || null;
  }

  async list(options: {
    page?: number;
    limit?: number;
    predicate?: SQL;
  }) {
    const db = getDatabase();
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.departments)
      .where(options.predicate);

    const items = await db
      .select()
      .from(schema.departments)
      .where(options.predicate)
      .orderBy(desc(schema.departments.created_at), asc(schema.departments.id))
      .limit(limit)
      .offset(offset);

    return {
      items,
      total: Number(totalRow?.count || 0),
      page,
      limit,
    };
  }

  async update(id: string, data: Partial<typeof schema.departments.$inferInsert>, executor: DbExecutor = getDatabase()) {
    const result = await executor
      .update(schema.departments)
      .set({ ...data, updated_at: new Date() })
      .where(eq(schema.departments.id, id))
      .returning();
    return result[0] || null;
  }

  async getDeleteUsageSummary(id: string, executor: DbExecutor = getDatabase()) {
    const count = async (table: any, column: any) => {
      const [row] = await executor
        .select({ count: sql<number>`count(*)` })
        .from(table)
        .where(eq(column, id));
      return Number(row?.count ?? 0);
    };
    const [users, media, layouts, presentations, schedules] = await Promise.all([
      count(schema.users, schema.users.department_id),
      count(schema.media, schema.media.owner_department_id),
      count(schema.layouts, schema.layouts.owner_department_id),
      count(schema.presentations, schema.presentations.owner_department_id),
      count(schema.schedules, schema.schedules.owner_department_id),
    ]);
    return { users, media, layouts, presentations, schedules };
  }

  // The caller supplies its current authorization transaction. The row lock,
  // record-specific permission check, usage count and delete share one commit.
  async deleteIfUnused(
    id: string,
    executor: DbExecutor,
    authorize: (department: typeof schema.departments.$inferSelect) => void
  ) {
    const [department] = await executor
      .select()
      .from(schema.departments)
      .where(eq(schema.departments.id, id))
      .for('update');
    if (!department) return { status: 'not_found' as const };

    authorize(department);
    const usage = await this.getDeleteUsageSummary(id, executor);
    if (Object.values(usage).some((value) => value > 0)) {
      return { status: 'in_use' as const, usage };
    }

    await executor.delete(schema.departments).where(eq(schema.departments.id, id));
    return { status: 'deleted' as const };
  }
}

export function createDepartmentRepository(): DepartmentRepository {
  return new DepartmentRepository();
}
