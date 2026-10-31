import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability';
import {
  BACKUP_PERMISSION_ACTIONS,
  RolePermissions,
  PermissionAction,
  PermissionSubject,
  RoleRecord,
} from '@/rbac/permissions';
import { AppError } from '@/utils/app-error';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { eq } from 'drizzle-orm';

export type Action = PermissionAction;
export type Subject = PermissionSubject;

export type AppAbility = MongoAbility<[Action, Subject]>;

type UserContext = {
  id: string;
  department_id?: string | null;
};

const resolveConditionValue = (value: string, user: UserContext) => {
  if (value === '$user.id') return user.id;
  if (value === '$user.department_id') return user.department_id ?? undefined;
  if (value.startsWith('$')) return undefined;
  return value;
};

export const resolveConditions = (conditions: Record<string, string> | undefined, user: UserContext): Record<string, string> | null | undefined => {
  if (conditions === undefined) return undefined;
  if (conditions === null || typeof conditions !== 'object' || Array.isArray(conditions)) return null;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(conditions)) {
    if (!key || typeof value !== 'string') return null;
    const resolvedValue = resolveConditionValue(value, user);
    if (resolvedValue === undefined || resolvedValue === null) {
      return null;
    }
    resolved[key] = resolvedValue;
  }
  return resolved;
};

const parsePermissions = (permissions: RolePermissions | null | undefined): RolePermissions => {
  if (!permissions || typeof permissions !== 'object') {
    return { grants: [] };
  }
  const grants = Array.isArray((permissions as any).grants) ? (permissions as any).grants : [];
  const inherits = Array.isArray((permissions as any).inherits) ? (permissions as any).inherits : [];
  return { grants, inherits };
};

const resolveRoleGrants = async (role: RoleRecord, visited: Set<string>, executor: DbExecutor): Promise<any[]> => {
  if (visited.has(role.id)) return [];
  visited.add(role.id);

  const permissions = parsePermissions(role.permissions);
  const grants = [...permissions.grants];

  if (permissions.inherits && permissions.inherits.length > 0) {
    for (const inheritedId of permissions.inherits) {
      const [inheritedRole] = await executor.select().from(schema.roles).where(eq(schema.roles.id, inheritedId));
      if (!inheritedRole) continue;
      const inheritedGrants = await resolveRoleGrants(inheritedRole as any, visited, executor);
      grants.push(...inheritedGrants);
    }
  }

  return grants;
};

export async function defineAbilityFor(roleId: string, userId: string, departmentId?: string, executor: DbExecutor = getDatabase()): Promise<AppAbility> {
  const [role] = await executor.select().from(schema.roles).where(eq(schema.roles.id, roleId));
  if (!role) {
    throw AppError.unauthorized('Authorization context is stale. Please sign in again.');
  }

  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  if (role.is_system && role.name === 'SUPER_ADMIN') {
    can('manage', 'all');
    return build();
  }

  const userContext: UserContext = { id: userId, department_id: departmentId };
  const grants = await resolveRoleGrants(role as any, new Set<string>(), executor);
  const explicitBrandingGrants: Array<{ action: Action; conditions?: Record<string, string> }> = [];
  const explicitBackupGrants: Array<{ action: Action }> = [];

  grants.forEach((grant: any) => {
    if (!grant || !grant.action || !grant.subject) return;
    const conditions = resolveConditions(grant.conditions, userContext);
    if (conditions === null) return;
    if (grant.subject === 'Backup') {
      // Backup is a deliberately non-wildcard global capability. Only a
      // subject-specific, unconditional grant can cross this boundary.
      if (BACKUP_PERMISSION_ACTIONS.includes(grant.action) && (!conditions || Object.keys(conditions).length === 0)) {
        explicitBackupGrants.push({ action: grant.action });
      }
      return;
    }
    if (role.is_system && role.name === 'ADMIN' && grant.subject === 'BrandingSettings') {
      // Branding has no record context at its API boundary. Conditional rules
      // must not override the ADMIN restriction through subject-type checks.
      if (!conditions || Object.keys(conditions).length === 0) {
        explicitBrandingGrants.push({ action: grant.action });
      }
      return;
    }
    if (grant.action === 'manage') {
      can('manage', grant.subject, conditions as any);
      return;
    }
    can(grant.action, grant.subject, conditions as any);
  });

  if (role.is_system && role.name === 'ADMIN') {
    cannot('manage', 'BrandingSettings');
    for (const grant of explicitBrandingGrants) can(grant.action, 'BrandingSettings');
  }

  // `manage all` is common on historical and custom roles, but it must never
  // acquire Backup as new permissions are introduced. The canonical system
  // SUPER_ADMIN returned above is the sole implicit exception.
  cannot('manage', 'Backup');
  for (const grant of explicitBackupGrants) can(grant.action, 'Backup');

  return build();
}

/** Subject-type CASL checks can match conditional grants, so they cannot prove global scope. */
export function hasGlobalUserManagement(ability: AppAbility): boolean {
  return ability.rules.some((rule) =>
    !rule.inverted &&
    (rule.action === 'manage' || (Array.isArray(rule.action) && rule.action.includes('manage'))) &&
    (rule.subject === 'User' || rule.subject === 'all') &&
    (!rule.conditions || Object.keys(rule.conditions).length === 0)
  );
}

/** A subject-wide operation has no record on which to evaluate conditions. */
export function canUnconditionally(ability: AppAbility, action: Action, subject: Subject): boolean {
  const unconditionalRules = ability.rules.filter((rule) =>
    !rule.conditions || Object.keys(rule.conditions).length === 0
  );
  return createMongoAbility<[Action, Subject]>(unconditionalRules).can(action, subject);
}

export function checkAbility(ability: AppAbility, action: Action, subject: Subject): boolean {
  return ability.can(action, subject);
}
