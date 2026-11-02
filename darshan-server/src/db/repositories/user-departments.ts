import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { AppError } from '@/utils/app-error';

export type UserDepartments = {
  primaryDepartmentId: string | null;
  additionalDepartmentIds: string[];
  departmentIds: string[];
};

export type UserDepartmentView = { id: string; name: string; is_primary: boolean };

function membershipError(message: string): AppError {
  return new AppError({
    statusCode: 422,
    code: 'INVALID_DEPARTMENT_MEMBERSHIP',
    message,
  });
}

export function combineUserDepartments(
  primaryDepartmentId: string | null | undefined,
  additionalDepartmentIds: readonly string[] = []
): UserDepartments {
  const primary = primaryDepartmentId ?? null;
  const additional = Array.from(new Set(additionalDepartmentIds.filter((id) => id !== primary))).sort();
  return {
    primaryDepartmentId: primary,
    additionalDepartmentIds: additional,
    departmentIds: primary ? [primary, ...additional] : additional,
  };
}

export function haveSharedDepartment(a: readonly string[], b: readonly string[]): boolean {
  const ids = new Set(a);
  return b.some((id) => ids.has(id));
}

export async function getUserDepartments(
  userId: string,
  executor: DbExecutor = getDatabase()
): Promise<UserDepartments | null> {
  const [user] = await executor
    .select({ department_id: schema.users.department_id })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) return null;
  const additional = await executor
    .select({ department_id: schema.userAdditionalDepartments.department_id })
    .from(schema.userAdditionalDepartments)
    .where(eq(schema.userAdditionalDepartments.user_id, userId));
  return combineUserDepartments(user.department_id, additional.map((row) => row.department_id));
}

export async function getUserDepartmentsBatch(
  userIds: readonly string[],
  executor: DbExecutor = getDatabase()
): Promise<Map<string, UserDepartments>> {
  const ids = Array.from(new Set(userIds));
  if (ids.length === 0) return new Map();
  const users = await executor.select({ id: schema.users.id, department_id: schema.users.department_id })
    .from(schema.users).where(inArray(schema.users.id, ids));
  const additional = await executor.select({ user_id: schema.userAdditionalDepartments.user_id,
    department_id: schema.userAdditionalDepartments.department_id })
    .from(schema.userAdditionalDepartments)
    .where(inArray(schema.userAdditionalDepartments.user_id, ids));
  const additionalByUser = new Map<string, string[]>();
  for (const row of additional) {
    const current = additionalByUser.get(row.user_id) ?? [];
    current.push(row.department_id);
    additionalByUser.set(row.user_id, current);
  }
  return new Map(users.map((user) => [
    user.id,
    combineUserDepartments(user.department_id, additionalByUser.get(user.id) ?? []),
  ]));
}

export async function getDepartmentViewsBatch(
  memberships: ReadonlyMap<string, UserDepartments>,
  executor: DbExecutor = getDatabase()
): Promise<Map<string, UserDepartmentView[]>> {
  const ids = Array.from(new Set(Array.from(memberships.values()).flatMap((item) => item.departmentIds)));
  const departments = ids.length
    ? await executor.select({ id: schema.departments.id, name: schema.departments.name })
      .from(schema.departments).where(inArray(schema.departments.id, ids))
    : [];
  const names = new Map(departments.map((item) => [item.id, item.name]));
  return new Map(Array.from(memberships.entries()).map(([userId, membership]) => [
    userId,
    membership.departmentIds.map((id) => ({
      id,
      name: names.get(id) ?? id,
      is_primary: id === membership.primaryDepartmentId,
    })),
  ]));
}

export async function getUserDepartmentMetadataBatch(
  userIds: readonly string[],
  executor: DbExecutor = getDatabase()
): Promise<Map<string, {
  department_ids: string[];
  additional_department_ids: string[];
  departments: UserDepartmentView[];
}>> {
  const memberships = await getUserDepartmentsBatch(userIds, executor);
  const views = await getDepartmentViewsBatch(memberships, executor);
  return new Map(Array.from(memberships.entries()).map(([userId, membership]) => [
    userId,
    {
      department_ids: membership.departmentIds,
      additional_department_ids: membership.additionalDepartmentIds,
      departments: views.get(userId) ?? [],
    },
  ]));
}

/** Caller holds the target user row lock and invokes this inside its transaction. */
export async function replaceAdditionalDepartments(
  executor: DbExecutor,
  input: {
    userId: string;
    primaryDepartmentId: string | null;
    roleName: string;
    additionalDepartmentIds: readonly string[];
    assignedBy?: string;
  }
): Promise<void> {
  const ids = [...input.additionalDepartmentIds];
  if (ids.length !== new Set(ids).size) throw membershipError('Additional departments contain duplicates.');
  if (ids.length && !input.primaryDepartmentId) {
    throw membershipError('A primary department is required before assigning additional departments.');
  }
  if (ids.length && input.roleName !== 'OPERATOR') {
    throw membershipError('Additional departments are available only to operators.');
  }
  if (ids.includes(input.primaryDepartmentId ?? '')) {
    throw membershipError('The primary department cannot also be additional.');
  }

  // Key-share locks order assignment against deletion. The FK is the final
  // authority if a concurrent delete wins before these locks are acquired.
  if (ids.length) {
    const found = await executor.select({ id: schema.departments.id })
      .from(schema.departments)
      .where(inArray(schema.departments.id, [...ids].sort()))
      .orderBy(schema.departments.id)
      .for('key share');
    if (found.length !== ids.length) throw membershipError('One or more additional departments do not exist.');
  }

  const current = await executor.select({ department_id: schema.userAdditionalDepartments.department_id })
    .from(schema.userAdditionalDepartments)
    .where(eq(schema.userAdditionalDepartments.user_id, input.userId));
  const currentIds = new Set(current.map((row) => row.department_id));
  const nextIds = new Set(ids);
  const removed = Array.from(currentIds).filter((id) => !nextIds.has(id));
  const added = ids.filter((id) => !currentIds.has(id));
  if (removed.length) {
    await executor.delete(schema.userAdditionalDepartments)
      .where(and(
        eq(schema.userAdditionalDepartments.user_id, input.userId),
        inArray(schema.userAdditionalDepartments.department_id, removed)
      ));
  }
  if (added.length) {
    await executor.insert(schema.userAdditionalDepartments).values(added.map((departmentId) => ({
      user_id: input.userId,
      department_id: departmentId,
      assigned_by: input.assignedBy ?? null,
    })));
  }
}

export async function assertPrimaryDepartmentExists(
  primaryDepartmentId: string | null | undefined,
  executor: DbExecutor = getDatabase()
): Promise<void> {
  if (!primaryDepartmentId) return;
  const [department] = await executor.select({ id: schema.departments.id })
    .from(schema.departments)
    .where(eq(schema.departments.id, primaryDepartmentId))
    .for('key share');
  if (!department) throw membershipError('The primary department does not exist.');
}

export function userInDepartmentCondition(departmentId: string) {
  return sql<boolean>`(${schema.users.department_id} = ${departmentId} OR EXISTS (
    SELECT 1 FROM ${schema.userAdditionalDepartments}
    WHERE ${schema.userAdditionalDepartments.user_id} = ${schema.users.id}
      AND ${schema.userAdditionalDepartments.department_id} = ${departmentId}
  ))`;
}

export function userInAnyDepartmentCondition(departmentIds: readonly string[]) {
  if (!departmentIds.length) return sql<boolean>`false`;
  return sql<boolean>`(${inArray(schema.users.department_id, [...departmentIds])} OR EXISTS (
    SELECT 1 FROM ${schema.userAdditionalDepartments}
    WHERE ${schema.userAdditionalDepartments.user_id} = ${schema.users.id}
      AND ${inArray(schema.userAdditionalDepartments.department_id, [...departmentIds])}
  ))`;
}

export async function countAdditionalDepartmentUsers(
  departmentId: string,
  executor: DbExecutor = getDatabase()
): Promise<number> {
  const [row] = await executor.select({ count: sql<number>`count(*)` })
    .from(schema.userAdditionalDepartments)
    .where(eq(schema.userAdditionalDepartments.department_id, departmentId));
  return Number(row?.count ?? 0);
}
