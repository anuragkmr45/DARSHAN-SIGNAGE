import { eq, desc, and, sql, inArray, asc } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { isReservedSystemRoleName } from '@/rbac/system-roles';
import { AppError } from '@/utils/app-error';

const reservedName = isReservedSystemRoleName;
const immutableRoleError = () => new AppError({ statusCode: 409, code: 'SYSTEM_ROLE_IMMUTABLE', message: 'Built-in role definitions cannot be changed.' });
const reservedNameError = () => new AppError({ statusCode: 409, code: 'RESERVED_ROLE_NAME', message: 'This role name is reserved.' });

type RoleDependency = {
  id: string;
  permissions: unknown;
};

function inheritedRoleIds(permissions: unknown): string[] {
  if (!permissions || typeof permissions !== 'object') return [];
  const inherits = (permissions as { inherits?: unknown }).inherits;
  return Array.isArray(inherits)
    ? inherits.filter((id): id is string => typeof id === 'string')
    : [];
}

/**
 * A role edit changes effective permissions for the edited role and every role
 * that inherits it, directly or transitively. Cycles are tolerated here so a
 * malformed legacy graph cannot prevent session revocation.
 */
export function resolveAffectedRoleIds(roles: RoleDependency[], changedRoleId: string): string[] {
  const affected = new Set([changedRoleId]);
  let added = true;
  while (added) {
    added = false;
    for (const role of roles) {
      if (affected.has(role.id)) continue;
      if (inheritedRoleIds(role.permissions).some((parentId) => affected.has(parentId))) {
        affected.add(role.id);
        added = true;
      }
    }
  }
  return Array.from(affected).sort();
}

export class RoleRepository {
  async create(data: {
    name: string;
    description?: string;
    permissions: any;
    is_system?: boolean;
  }, executor: DbExecutor = getDatabase()) {
    if (!data.is_system && reservedName(data.name)) throw reservedNameError();
    const db = executor;
    const [role] = await db
      .insert(schema.roles)
      .values({
        name: data.name,
        description: data.description,
        permissions: data.permissions,
        is_system: data.is_system ?? false,
      })
      .returning();
    return role;
  }

  async list(options: { page?: number; limit?: number; search?: string } = {}) {
    const db = getDatabase();
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (options.search) {
      conditions.push(sql`LOWER(${schema.roles.name}) LIKE ${'%' + options.search.toLowerCase() + '%'}`);
    }

    let query = db.select().from(schema.roles);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.roles)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const canonicalSystemRoleRank = sql<number>`
      CASE ${schema.roles.name}
        WHEN 'SUPER_ADMIN' THEN 0
        WHEN 'ADMIN' THEN 1
        WHEN 'DEPARTMENT' THEN 2
        WHEN 'OPERATOR' THEN 3
        ELSE 4
      END
    `;
    const items = await query
      .orderBy(canonicalSystemRoleRank, desc(schema.roles.is_system), desc(schema.roles.created_at))
      .limit(limit)
      .offset(offset);
    const total = totalRows.length > 0 ? Number((totalRows[0] as any).count) : 0;

    return { items, total, page, limit };
  }

  async findById(id: string) {
    const db = getDatabase();
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
    return role || null;
  }

  async findByName(name: string) {
    const db = getDatabase();
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, name));
    return role || null;
  }

  /**
   * Role names and grants are embedded in access tokens and live socket
   * authentication state. Lock the complete permission graph, update the role,
   * and revoke sessions for direct and transitive inheritors in one transaction
   * so no committed old effective-role session can authorize a later request.
   */
  async update(
    id: string,
    data: Partial<{ name: string; description?: string; permissions: any; is_system?: boolean }>,
    executor?: DbExecutor
  ) {
    const performUpdate = async (tx: DbExecutor) => {
      const roles = await tx
        .select({ id: schema.roles.id, name: schema.roles.name, is_system: schema.roles.is_system, permissions: schema.roles.permissions })
        .from(schema.roles)
        .orderBy(asc(schema.roles.id))
        .for('update');
      const current = roles.find((role) => role.id === id);
      if (!current) return null;
      if (current.is_system || reservedName(current.name)) throw immutableRoleError();
      if (data.name && reservedName(data.name)) throw reservedNameError();

      const affectedRoleIds = resolveAffectedRoleIds(roles, id);

      const assignedUsers = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(inArray(schema.users.role_id, affectedRoleIds));

      const [role] = await tx
        .update(schema.roles)
        .set({ ...data, updated_at: new Date() })
        .where(eq(schema.roles.id, id))
        .returning();
      if (!role) return null;

      const userIds = assignedUsers.map((user) => user.id);
      if (userIds.length > 0) {
        await tx.delete(schema.sessions).where(inArray(
          schema.sessions.user_id,
          tx.select({ id: schema.users.id }).from(schema.users)
            .where(inArray(schema.users.role_id, affectedRoleIds))
        ));
      }

      return { role, revokedUserIds: userIds };
    };

    if (executor) return performUpdate(executor);
    return getDatabase().transaction(performUpdate);
  }

  async delete(id: string, executor?: DbExecutor) {
    const performDelete = async (tx: DbExecutor) => {
      const roles = await tx
        .select({ id: schema.roles.id, name: schema.roles.name, is_system: schema.roles.is_system, permissions: schema.roles.permissions })
        .from(schema.roles)
        .orderBy(asc(schema.roles.id))
        .for('update');
      const current = roles.find((role) => role.id === id);
      if (!current) return { status: 'NOT_FOUND' as const };
      if (current.is_system || reservedName(current.name)) throw immutableRoleError();

      const inheritorIds = resolveAffectedRoleIds(roles, id).filter((roleId) => roleId !== id);
      if (inheritorIds.length > 0) {
        return { status: 'INHERITED' as const, inheritorIds };
      }

      const [usage] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(schema.users)
        .where(eq(schema.users.role_id, id));
      if (Number(usage?.count ?? 0) > 0) return { status: 'ASSIGNED' as const };

      await tx.delete(schema.roles).where(eq(schema.roles.id, id));
      return { status: 'DELETED' as const };
    };

    if (executor) return performDelete(executor);
    return getDatabase().transaction(performDelete);
  }
}

export function createRoleRepository(): RoleRepository {
  return new RoleRepository();
}
