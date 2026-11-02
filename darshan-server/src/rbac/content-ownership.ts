import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { AppError } from '@/utils/app-error';
import { type ActorContext } from '@/rbac/policy';

export const CONTENT_OWNER_SCOPES = ['DEPARTMENT', 'ORGANIZATION', 'RESTRICTED'] as const;
export type ContentOwnerScope = (typeof CONTENT_OWNER_SCOPES)[number];

export type ContentOwnedResource = {
  id: string;
  created_by?: string | null;
  owner_scope?: string | null;
  owner_department_id?: string | null;
};

type OwnershipColumns = {
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

export type ContentAbility = {
  can(action: string, subject: string): boolean;
};

export type ContentSubject = 'Media' | 'Layout' | 'Presentation' | 'Schedule';

export function normalizeContentOwnerScope(value?: string | null): ContentOwnerScope {
  return CONTENT_OWNER_SCOPES.includes(value as ContentOwnerScope)
    ? (value as ContentOwnerScope)
    : 'RESTRICTED';
}

export function ownershipForNewContent(
  actor: ActorContext,
  ability: ContentAbility,
  subject: ContentSubject
): {
  owner_scope: ContentOwnerScope;
  owner_department_id: string | null;
} {
  if (actor.roleName === 'SUPER_ADMIN') {
    return { owner_scope: 'RESTRICTED', owner_department_id: null };
  }
  if (actor.roleName === 'ADMIN' || ability.can('manage', subject)) {
    return { owner_scope: 'ORGANIZATION', owner_department_id: null };
  }
  if (!actor.departmentId) {
    throw AppError.forbidden('A department is required to create department-owned content.');
  }
  return { owner_scope: 'DEPARTMENT', owner_department_id: actor.departmentId };
}

export function canReadContentResource(
  actor: ActorContext,
  resource: ContentOwnedResource,
  ability: ContentAbility,
  subject: ContentSubject
): boolean {
  if (!ability.can('read', subject)) return false;
  if (ability.can('manage', subject)) return true;
  const scope = normalizeContentOwnerScope(resource.owner_scope);
  if (scope === 'ORGANIZATION') return true;
  return scope === 'DEPARTMENT' && Boolean(
    resource.owner_department_id &&
    (actor.departmentIds ?? (actor.departmentId ? [actor.departmentId] : [])).includes(resource.owner_department_id)
  );
}

export function canManageContentResource(
  actor: ActorContext,
  resource: ContentOwnedResource,
  ability: ContentAbility,
  subject: ContentSubject,
  action: 'update' | 'delete' | 'create' | 'approve' | 'publish' = 'update'
): boolean {
  if (!ability.can(action, subject)) return false;
  if (!canAccessContentMutationScope(actor, resource, ability, subject)) return false;
  if (ability.can('manage', subject)) return true;
  if (subject === 'Schedule') return true;
  return Boolean(resource.created_by && resource.created_by === actor.userId);
}

export function canAccessContentMutationScope(
  actor: ActorContext,
  resource: ContentOwnedResource,
  ability: ContentAbility,
  subject: ContentSubject
): boolean {
  if (ability.can('manage', subject)) return true;
  return normalizeContentOwnerScope(resource.owner_scope) === 'DEPARTMENT' && Boolean(
    resource.owner_department_id &&
    (actor.departmentIds ?? (actor.departmentId ? [actor.departmentId] : [])).includes(resource.owner_department_id)
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
  if (ability && subject && !ability.can('read', subject)) return sql`false`;
  if (ability && subject && ability.can('manage', subject)) return undefined;
  const departmentIds = actor.departmentIds ?? (actor.departmentId ? [actor.departmentId] : []);
  if (!departmentIds.length) {
    return eq(columns.owner_scope, 'ORGANIZATION');
  }
  return or(
    eq(columns.owner_scope, 'ORGANIZATION'),
    and(
      eq(columns.owner_scope, 'DEPARTMENT'),
      inArray(columns.owner_department_id, departmentIds)
    )
  );
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

