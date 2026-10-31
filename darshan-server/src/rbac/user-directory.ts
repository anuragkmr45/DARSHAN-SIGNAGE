import { subject } from '@casl/ability';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { canAuthenticateInviteState } from '@/auth/invite-state';
import { schema } from '@/db';
import { hasGlobalUserManagement, type AppAbility } from '@/rbac';
import { canManageUserTarget } from '@/rbac/policy';

export type DirectoryActor = { userId: string; departmentId?: string | null };
export type DirectoryUser = {
  id: string;
  department_id?: string | null;
  is_active?: boolean | null;
  deleted_at?: Date | null;
  ext?: unknown;
  [key: string]: unknown;
};

const directoryRule = (rule: AppAbility['rules'][number]): boolean => {
  if (rule.inverted) return false;
  const actions = Array.isArray(rule.action) ? rule.action : [rule.action];
  const subjects = Array.isArray(rule.subject) ? rule.subject : [rule.subject];
  return actions.some((action) => action === 'read' || action === 'manage') &&
    subjects.some((item) => item === 'User' || item === 'all');
};

// PostgreSQL UUID comparisons reject malformed string parameters. Treat them as
// unsupported grants so one bad role rule cannot turn a directory into a 500.
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const supportedDirectoryConditions = (conditions: Record<string, unknown> | undefined): boolean =>
  conditions === undefined || (conditions !== null && typeof conditions === 'object' &&
    !Array.isArray(conditions) && Object.entries(conditions).every(([key, value]) =>
      (key === 'id' || key === 'department_id' || key === 'role_id') &&
      typeof value === 'string' && canonicalUuid.test(value)
    ));

/** A record-specific read grant can authorize a directory even if CASL's subject-type check is false. */
export function hasDirectoryReadGrant(ability: AppAbility): boolean {
  return ability.rules.some((rule) => directoryRule(rule) &&
    supportedDirectoryConditions(rule.conditions as Record<string, unknown> | undefined));
}

export function canAccessDirectoryUser(
  actor: DirectoryActor,
  target: DirectoryUser,
  ability: AppAbility
): boolean {
  if (target.deleted_at) return false;
  if (hasGlobalUserManagement(ability)) return true;
  if (target.is_active !== true) return false;
  if (!canAuthenticateInviteState(target.ext)) return false;
  if (!directoryRulesMatchTarget(ability, target)) return false;
  if (!(ability as any).can('read', subject('User', target))) return false;
  if (target.id === actor.userId) return true;
  return Boolean(actor.departmentId && target.department_id === actor.departmentId);
}

/**
 * Ordinary people directories contain usable accounts, not pending invitation
 * records. Global User managers retain visibility through their management
 * directory, and pending accounts remain available in the invitation endpoint.
 */
export function directorySignInEligiblePredicate(): SQL {
  return sql`(
    ${schema.users.ext} IS NULL OR (
      jsonb_typeof(${schema.users.ext}) = 'object' AND (
        NOT (${schema.users.ext} ?| ARRAY['invite_token', 'invite_status', 'invite_expires_at', 'invited_at']) OR (
          ${schema.users.ext}->>'invite_status' = 'ACTIVATED' AND
          ${schema.users.ext}->>'invite_token' IS NULL
        )
      )
    )
  )`;
}

function directoryRulesMatchTarget(ability: AppAbility, target: DirectoryUser): boolean {
  return ability.rules.some((rule) => {
    if (!directoryRule(rule)) return false;
    const conditions = rule.conditions as Record<string, unknown> | undefined;
    if (!supportedDirectoryConditions(conditions)) return false;
    if (!conditions || Object.keys(conditions).length === 0) return true;
    return Object.entries(conditions).every(([key, value]) =>
      (key === 'id' || key === 'department_id' || key === 'role_id') &&
      typeof value === 'string' && target[key] === value
    );
  });
}

/** Translate the supported record grants into the list's SQL predicate before pagination. */
export function directoryReadPredicate(ability: AppAbility): SQL {
  const permitted: SQL[] = [];
  for (const rule of ability.rules) {
    if (!directoryRule(rule)) continue;
    const conditions = rule.conditions as Record<string, unknown> | undefined;
    if (!supportedDirectoryConditions(conditions)) continue;
    if (!conditions || Object.keys(conditions).length === 0) return sql`true`;
    const parts: SQL[] = [];
    for (const [key, value] of Object.entries(conditions)) {
      if (key === 'id') parts.push(eq(schema.users.id, value as string));
      else if (key === 'department_id') parts.push(eq(schema.users.department_id, value as string));
      else if (key === 'role_id') parts.push(eq(schema.users.role_id, value as string));
    }
    if (parts.length > 0) permitted.push(and(...parts)!);
  }
  return permitted.length > 0 ? or(...permitted)! : sql`false`;
}

export function userActionPermissions(
  actor: DirectoryActor,
  target: DirectoryUser & { role?: string | null; role_is_system?: boolean | null },
  ability: AppAbility
) {
  const targetable = !target.deleted_at && (target.is_active === true || hasGlobalUserManagement(ability)) &&
    canManageUserTarget(
      { departmentId: actor.departmentId, globalUserManagement: hasGlobalUserManagement(ability) },
      { roleName: target.role ?? '', isSystem: target.role_is_system === true, departmentId: target.department_id }
    );
  const canUpdate = targetable && (ability as any).can('update', subject('User', target));
  return {
    can_update: canUpdate,
    can_delete: targetable && (ability as any).can('delete', subject('User', target)),
    can_reset_password: canUpdate,
  };
}
