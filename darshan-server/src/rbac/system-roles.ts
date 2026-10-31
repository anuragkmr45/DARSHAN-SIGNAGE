import { asc, eq, inArray } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { getDatabase, schema, type DbExecutor } from '@/db';
import type { PermissionGrant, RolePermissions } from '@/rbac/permissions';

export const SYSTEM_ROLE_NAMES = ['SUPER_ADMIN', 'ADMIN', 'DEPARTMENT', 'OPERATOR'] as const;
export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

const grant = (action: PermissionGrant['action'], subject: PermissionGrant['subject']): PermissionGrant => ({
  action,
  subject,
});

export const SYSTEM_ROLE_DEFAULTS: Record<SystemRoleName, RolePermissions> = {
  SUPER_ADMIN: {
    grants: [grant('manage', 'all')],
  },
  ADMIN: {
    grants: [grant('manage', 'all')],
  },
  DEPARTMENT: {
    grants: [
      grant('read', 'Dashboard'),
      grant('read', 'Media'),
      grant('create', 'Media'),
      grant('update', 'Media'),
      grant('delete', 'Media'),
      grant('read', 'Layout'),
      grant('create', 'Layout'),
      grant('update', 'Layout'),
      grant('delete', 'Layout'),
      grant('read', 'Presentation'),
      grant('create', 'Presentation'),
      grant('update', 'Presentation'),
      grant('delete', 'Presentation'),
      grant('read', 'Schedule'),
      grant('create', 'Schedule'),
      grant('update', 'Schedule'),
      grant('delete', 'Schedule'),
      grant('read', 'ScheduleItem'),
      grant('create', 'ScheduleItem'),
      grant('update', 'ScheduleItem'),
      grant('delete', 'ScheduleItem'),
      grant('read', 'ScheduleRequest'),
      grant('create', 'ScheduleRequest'),
      grant('update', 'ScheduleRequest'),
      grant('delete', 'ScheduleRequest'),
      grant('read', 'Screen'),
      grant('read', 'ScreenGroup'),
      grant('read', 'Conversation'),
      grant('read', 'Notification'),
      grant('read', 'Role'),
      grant('read', 'User'),
      grant('create', 'User'),
      grant('update', 'User'),
      grant('delete', 'User'),
    ],
  },
  OPERATOR: {
    grants: [
      grant('read', 'Dashboard'),
      grant('read', 'Media'),
      grant('create', 'Media'),
      grant('update', 'Media'),
      grant('delete', 'Media'),
      grant('read', 'Layout'),
      grant('create', 'Layout'),
      grant('update', 'Layout'),
      grant('delete', 'Layout'),
      grant('read', 'Presentation'),
      grant('create', 'Presentation'),
      grant('update', 'Presentation'),
      grant('delete', 'Presentation'),
      grant('read', 'Schedule'),
      grant('create', 'Schedule'),
      grant('update', 'Schedule'),
      grant('delete', 'Schedule'),
      grant('read', 'ScheduleItem'),
      grant('create', 'ScheduleItem'),
      grant('update', 'ScheduleItem'),
      grant('delete', 'ScheduleItem'),
      grant('read', 'ScheduleRequest'),
      grant('create', 'ScheduleRequest'),
      grant('update', 'ScheduleRequest'),
      grant('delete', 'ScheduleRequest'),
      grant('read', 'Screen'),
      grant('read', 'ScreenGroup'),
      grant('read', 'Conversation'),
      grant('read', 'Notification'),
      grant('read', 'Role'),
      grant('read', 'User'),
    ],
  },
};

export const isSystemRoleName = (value: string | null | undefined): value is SystemRoleName =>
  Boolean(value && SYSTEM_ROLE_NAMES.includes(value as SystemRoleName));

export const isReservedSystemRoleName = (value: string | null | undefined): boolean =>
  Boolean(value && isSystemRoleName(value.trim().toUpperCase()));

type SystemRoleIdentity = Pick<typeof schema.roles.$inferSelect, 'id' | 'name' | 'is_system'>;

/**
 * Reserved names identify built-ins only when both their spelling and marker are
 * canonical. Legacy case/space variants are conflicts even when is_system was
 * set, because the rest of RBAC intentionally matches built-ins by exact name.
 */
export const isSystemRoleIdentityConflict = (role: SystemRoleIdentity): boolean => {
  const canonicalName = role.name.trim().toUpperCase();
  return isSystemRoleName(canonicalName) && (!role.is_system || role.name !== canonicalName);
};

/** Maintenance commands must not treat a reserved name or marker alone as built-in identity. */
export async function findSystemRoleIdentityConflict(executor: DbExecutor) {
  const roles = await executor
    .select({ id: schema.roles.id, name: schema.roles.name, is_system: schema.roles.is_system })
    .from(schema.roles);
  return roles.find(isSystemRoleIdentityConflict) ?? null;
}

export async function syncSystemRolePermissions() {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const roles = await tx.select().from(schema.roles).orderBy(asc(schema.roles.id)).for('update');
    const conflictingRole = roles.find(isSystemRoleIdentityConflict);
    if (conflictingRole) {
      throw new Error(`SYSTEM_ROLE_IDENTITY_CONFLICT: role ${conflictingRole.name} (${conflictingRole.id}) does not have a canonical built-in identity; review the database before startup`);
    }
    const affectedRoles = new Set<string>();
    for (const roleName of SYSTEM_ROLE_NAMES) {
      const existingRole = roles.find((role) => role.name === roleName);
      if (!existingRole) continue;
      if (isDeepStrictEqual(existingRole.permissions, SYSTEM_ROLE_DEFAULTS[roleName])) continue;
      await tx.update(schema.roles).set({
        permissions: SYSTEM_ROLE_DEFAULTS[roleName],
        updated_at: new Date(),
      }).where(eq(schema.roles.id, existingRole.id));
      affectedRoles.add(existingRole.id);
    }
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const role of roles) {
        if (affectedRoles.has(role.id)) continue;
        const inherits = (role.permissions as RolePermissions | null)?.inherits;
        if (Array.isArray(inherits) && inherits.some((id) => affectedRoles.has(id))) {
          affectedRoles.add(role.id);
          expanded = true;
        }
      }
    }
    if (affectedRoles.size === 0) return [] as string[];
    const users = await tx.select({ id: schema.users.id }).from(schema.users)
      .where(inArray(schema.users.role_id, Array.from(affectedRoles)));
    const userIds = users.map((user) => user.id);
    if (userIds.length > 0) {
      await tx.delete(schema.sessions).where(inArray(
        schema.sessions.user_id,
        tx.select({ id: schema.users.id }).from(schema.users)
          .where(inArray(schema.users.role_id, Array.from(affectedRoles)))
      ));
    }
    return userIds;
  });
}
