import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { subject as caslSubject } from '@casl/ability';
import { getDatabase, schema } from '@/db';
import { AppError } from '@/utils/app-error';
import { type ActorContext } from '@/rbac/policy';
import { canUnconditionally, type AppAbility } from '@/rbac';

export const CONTENT_OWNER_SCOPES = ['DEPARTMENT', 'ORGANIZATION', 'RESTRICTED'] as const;
export type ContentOwnerScope = (typeof CONTENT_OWNER_SCOPES)[number];

export type ContentOwnedResource = {
  id: string;
  created_by?: string | null;
  owner_scope?: string | null;
  owner_department_id?: string | null;
};

type OwnershipColumns = {
  id: any;
  name: any;
  created_by: any;
  owner_scope: any;
  owner_department_id: any;
};

export type ContentOwnershipView = {
  scope: ContentOwnerScope;
  department_id: string | null;
  department_name: string | null;
  creator: {
    id: string | null;
    display_name: string;
    status: 'ACTIVE' | 'INACTIVE' | 'DELETED' | 'UNKNOWN';
  };
};

export type ContentAbility = AppAbility;

export type ContentSubject = 'Media' | 'Layout' | 'Presentation' | 'Schedule';

export function normalizeContentOwnerScope(value?: string | null): ContentOwnerScope {
  return CONTENT_OWNER_SCOPES.includes(value as ContentOwnerScope)
    ? (value as ContentOwnerScope)
    : 'RESTRICTED';
}

export function ownershipForNewContent(
  actor: ActorContext,
  ability: ContentAbility,
  subject: ContentSubject,
  proposed: Record<string, unknown>
): {
  owner_scope: ContentOwnerScope;
  owner_department_id: string | null;
} {
  let ownership: { owner_scope: ContentOwnerScope; owner_department_id: string | null };
  if (actor.roleName === 'SUPER_ADMIN' && canUnconditionally(ability, 'manage', 'all')) {
    ownership = { owner_scope: 'RESTRICTED', owner_department_id: null };
  } else if (canUnconditionally(ability, 'manage', subject)) {
    ownership = { owner_scope: 'ORGANIZATION', owner_department_id: null };
  } else if (actor.departmentId) {
    ownership = { owner_scope: 'DEPARTMENT', owner_department_id: actor.departmentId };
  } else {
    throw AppError.forbidden('A department is required to create department-owned content.');
  }
  if (!(ability as any).can('create', caslSubject(subject, {
    ...proposed,
    created_by: actor.userId,
    ...ownership,
  }))) throw AppError.forbidden('Forbidden');
  return ownership;
}

export function canReadContentResource(
  actor: ActorContext,
  resource: ContentOwnedResource,
  ability: ContentAbility,
  subject: ContentSubject
): boolean {
  if (!(ability as any).can('read', caslSubject(subject, { ...resource }))) return false;
  if (canUnconditionally(ability, 'manage', subject)) return true;
  const scope = normalizeContentOwnerScope(resource.owner_scope);
  if (scope === 'ORGANIZATION') return true;
  return scope === 'DEPARTMENT' && Boolean(
    actor.departmentId && resource.owner_department_id === actor.departmentId
  );
}

export function canManageContentResource(
  actor: ActorContext,
  resource: ContentOwnedResource,
  ability: ContentAbility,
  subject: ContentSubject,
  action: 'update' | 'delete' | 'create' | 'approve' | 'publish' = 'update'
): boolean {
  if (!(ability as any).can(action, caslSubject(subject, { ...resource }))) return false;
  if (!canAccessContentMutationScope(actor, resource, ability, subject)) return false;
  if (canUnconditionally(ability, 'manage', subject)) return true;
  if (subject === 'Schedule') return true;
  return Boolean(resource.created_by && resource.created_by === actor.userId);
}

export function canAccessContentMutationScope(
  actor: ActorContext,
  resource: ContentOwnedResource,
  ability: ContentAbility,
  subject: ContentSubject
): boolean {
  if (canUnconditionally(ability, 'manage', subject)) return true;
  return normalizeContentOwnerScope(resource.owner_scope) === 'DEPARTMENT' && Boolean(
    actor.departmentId && resource.owner_department_id === actor.departmentId
  );
}

export function contentResponseMetadata(
  resource: ContentOwnedResource,
  ownership: ContentOwnershipView | null | undefined,
  actor: ActorContext,
  ability: ContentAbility,
  subject: ContentSubject,
  supportsDelete = true
) {
  return {
    created_by: resource.created_by ?? null,
    ownership: ownership ?? null,
    permissions: {
      can_update: canManageContentResource(actor, resource, ability, subject, 'update'),
      can_delete:
        supportsDelete && canManageContentResource(actor, resource, ability, subject, 'delete'),
    },
  };
}

export function canReferenceContentResource(
  parent: ContentOwnedResource,
  child: ContentOwnedResource
): boolean {
  const parentScope = normalizeContentOwnerScope(parent.owner_scope);
  const childScope = normalizeContentOwnerScope(child.owner_scope);
  if (parentScope === 'RESTRICTED') return true;
  if (parentScope === 'ORGANIZATION') return childScope === 'ORGANIZATION';
  return (
    childScope === 'ORGANIZATION' ||
    (childScope === 'DEPARTMENT' && parent.owner_department_id === child.owner_department_id)
  );
}

export function contentReadCondition(
  actor: ActorContext,
  columns: OwnershipColumns,
  ability?: ContentAbility,
  subject?: ContentSubject
): SQL | undefined {
  if (ability && subject && canUnconditionally(ability, 'manage', subject)) return undefined;
  const ownership = actor.departmentId
    ? or(
        eq(columns.owner_scope, 'ORGANIZATION'),
        and(eq(columns.owner_scope, 'DEPARTMENT'), eq(columns.owner_department_id, actor.departmentId))
      )!
    : eq(columns.owner_scope, 'ORGANIZATION');
  if (!ability || !subject) return ownership;
  const permission = contentGrantReadPredicate(ability, subject, columns);
  return and(ownership, permission)!;
}

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Translate only supported equality conditions; unknown conditions fail closed in lists. */
function contentGrantReadPredicate(ability: ContentAbility, subject: ContentSubject, columns: OwnershipColumns): SQL {
  const permitted: SQL[] = [];
  for (const rule of ability.rules) {
    if (rule.inverted) continue;
    const actions = Array.isArray(rule.action) ? rule.action : [rule.action];
    const subjects = Array.isArray(rule.subject) ? rule.subject : [rule.subject];
    if (!actions.some((action) => action === 'read' || action === 'manage') ||
        !subjects.some((item) => item === subject || item === 'all')) continue;
    const conditions = rule.conditions as Record<string, unknown> | undefined;
    if (conditions === undefined) return sql`true`;
    if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) continue;
    if (Object.keys(conditions).length === 0) return sql`true`;
    const parts: SQL[] = [];
    let supported = true;
    for (const [key, value] of Object.entries(conditions)) {
      if (typeof value !== 'string') { supported = false; break; }
      if (key === 'id' || key === 'created_by' || key === 'owner_department_id') {
        if (!canonicalUuid.test(value)) { supported = false; break; }
        parts.push(eq(columns[key], value));
      } else if (key === 'name') {
        parts.push(eq(columns.name, value));
      } else if (key === 'owner_scope' && CONTENT_OWNER_SCOPES.includes(value as ContentOwnerScope)) {
        parts.push(eq(columns.owner_scope, value));
      } else {
        supported = false;
        break;
      }
    }
    if (supported && parts.length > 0) permitted.push(and(...parts)!);
  }
  return permitted.length > 0 ? or(...permitted)! : sql`false`;
}

function creatorDisplayName(user: {
  id: string;
  first_name: string | null;
  last_name: string | null;
}): string {
  const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  return name || `User ${user.id.slice(0, 8)}`;
}

export async function resolveContentOwnershipViews(
  resources: ContentOwnedResource[]
): Promise<Map<string, ContentOwnershipView>> {
  if (resources.length === 0) return new Map();
  const db = getDatabase();
  const creatorIds = Array.from(
    new Set(resources.map((resource) => resource.created_by).filter((id): id is string => Boolean(id)))
  );
  const departmentIds = Array.from(
    new Set(
      resources
        .map((resource) => resource.owner_department_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const [users, departments] = await Promise.all([
    creatorIds.length
      ? db
          .select({
            id: schema.users.id,
            first_name: schema.users.first_name,
            last_name: schema.users.last_name,
            is_active: schema.users.is_active,
            deleted_at: schema.users.deleted_at,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, creatorIds))
      : [],
    departmentIds.length
      ? db
          .select({ id: schema.departments.id, name: schema.departments.name })
          .from(schema.departments)
          .where(inArray(schema.departments.id, departmentIds))
      : [],
  ]);

  const usersById = new Map(users.map((user) => [user.id, user]));
  const departmentsById = new Map(departments.map((department) => [department.id, department.name]));

  return new Map(
    resources.map((resource) => {
      const creator = resource.created_by ? usersById.get(resource.created_by) : null;
      const status = creator
        ? creator.deleted_at
          ? 'DELETED'
          : creator.is_active
            ? 'ACTIVE'
            : 'INACTIVE'
        : 'UNKNOWN';
      return [
        resource.id,
        {
          scope: normalizeContentOwnerScope(resource.owner_scope),
          department_id: resource.owner_department_id ?? null,
          department_name: resource.owner_department_id
            ? departmentsById.get(resource.owner_department_id) ?? null
            : null,
          creator: {
            id: resource.created_by ?? null,
            display_name: creator ? creatorDisplayName(creator) : 'Unknown user',
            status,
          },
        },
      ];
    })
  );
}

