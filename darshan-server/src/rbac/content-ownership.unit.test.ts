import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';
import { PgDialect } from 'drizzle-orm/pg-core';
import { schema } from '@/db';
import type { Action } from '@/rbac';
import {
  canManageContentResource,
  canReadContentResource,
  canReferenceContentResource,
  contentReadCondition,
  contentResponseMetadata,
  ownershipForNewContent,
  type ContentAbility,
} from '@/rbac/content-ownership';

const departmentResource = {
  id: 'resource-1',
  created_by: 'creator-1',
  owner_scope: 'DEPARTMENT',
  owner_department_id: 'department-a',
};

const ability = (...grants: string[]): ContentAbility => createMongoAbility(
  grants.map((grant) => {
    const [action, subject] = grant.split(':') as [Action, string];
    return { action, subject };
  })
) as ContentAbility;

describe('content ownership policy', () => {
  it('snapshots restricted, organization, and department ownership from role and permissions', () => {
    expect(
      ownershipForNewContent(
        { userId: 'root-1', roleName: 'SUPER_ADMIN', departmentId: null },
        ability('manage:all'),
        'Media',
        { name: 'New media' }
      )
    ).toEqual({ owner_scope: 'RESTRICTED', owner_department_id: null });
    expect(
      ownershipForNewContent(
        { userId: 'admin-1', roleName: 'ADMIN', departmentId: null },
        ability('manage:Media'),
        'Media',
        { name: 'New media' }
      )
    ).toEqual({ owner_scope: 'ORGANIZATION', owner_department_id: null });
    expect(
      ownershipForNewContent(
        { userId: 'custom-1', roleName: 'CUSTOM_GLOBAL', departmentId: null },
        ability('manage:Media'),
        'Media',
        { name: 'New media' }
      )
    ).toEqual({ owner_scope: 'ORGANIZATION', owner_department_id: null });
    expect(() => ownershipForNewContent(
      { userId: 'name-only-admin', roleName: 'ADMIN', departmentId: null },
      ability('create:Media'),
      'Media',
      { name: 'Not organization-owned' }
    )).toThrow(/department is required/i);
    expect(() => ownershipForNewContent(
      { userId: 'name-only-root', roleName: 'SUPER_ADMIN', departmentId: null },
      ability('create:Media'),
      'Media',
      { name: 'Not restricted by name alone' }
    )).toThrow(/department is required/i);
    expect(
      ownershipForNewContent(
        { userId: 'operator-1', roleName: 'OPERATOR', departmentId: 'department-a' },
        ability('create:Media'),
        'Media',
        { name: 'New media' }
      )
    ).toEqual({ owner_scope: 'DEPARTMENT', owner_department_id: 'department-a' });
    expect(() =>
      ownershipForNewContent(
        { userId: 'operator-1', roleName: 'OPERATOR', departmentId: null },
        ability('create:Media'),
        'Media',
        { name: 'New media' }
      )
    ).toThrow(/department is required/i);
  });

  it('allows organization reads, same-department reads, and administrator-only restricted reads', () => {
    const operator = { userId: 'operator-1', roleName: 'OPERATOR', departmentId: 'department-a' };
    const reader = ability('read:Media');
    expect(canReadContentResource(operator, departmentResource, reader, 'Media')).toBe(true);
    expect(
      canReadContentResource(operator, {
        ...departmentResource,
        owner_scope: 'ORGANIZATION',
        owner_department_id: null,
      }, reader, 'Media')
    ).toBe(true);
    expect(
      canReadContentResource({ ...operator, departmentId: 'department-b' }, departmentResource, reader, 'Media')
    ).toBe(false);
    expect(
      canReadContentResource(operator, {
        ...departmentResource,
        owner_scope: 'RESTRICTED',
        owner_department_id: null,
      }, reader, 'Media')
    ).toBe(false);
    expect(
      canReadContentResource(
        { userId: 'global-1', roleName: 'CUSTOM_GLOBAL', departmentId: null },
        { ...departmentResource, owner_scope: 'RESTRICTED', owner_department_id: null },
        ability('manage:Media'),
        'Media'
      )
    ).toBe(true);
    expect(canReadContentResource(operator, departmentResource, ability(), 'Media')).toBe(false);
  });

  it('lets creators manage media, same-department permitted users manage schedules, and global managers bypass scope', () => {
    expect(
      canManageContentResource(
        { userId: 'creator-1', roleName: 'OPERATOR', departmentId: 'department-a' },
        departmentResource,
        ability('update:Media'),
        'Media'
      )
    ).toBe(true);
    expect(
      canManageContentResource(
        { userId: 'other-1', roleName: 'DEPARTMENT', departmentId: 'department-a' },
        departmentResource,
        ability('update:Media'),
        'Media'
      )
    ).toBe(false);
    expect(
      canManageContentResource(
        { userId: 'other-1', roleName: 'OPERATOR', departmentId: 'department-a' },
        departmentResource,
        ability('update:Schedule'),
        'Schedule'
      )
    ).toBe(true);
    expect(
      canManageContentResource(
        { userId: 'global-1', roleName: 'CUSTOM_GLOBAL', departmentId: null },
        { ...departmentResource, owner_scope: 'RESTRICTED', owner_department_id: null },
        ability('manage:Media'),
        'Media'
      )
    ).toBe(true);
    expect(
      canManageContentResource(
        { userId: 'creator-1', roleName: 'OPERATOR', departmentId: 'department-b' },
        departmentResource,
        ability('update:Media'),
        'Media'
      )
    ).toBe(false);
    expect(
      canManageContentResource(
        { userId: 'creator-1', roleName: 'OPERATOR', departmentId: 'department-a' },
        departmentResource,
        ability('read:Media'),
        'Media'
      )
    ).toBe(false);
  });

  it('prevents a broadly visible parent from exposing narrower referenced content', () => {
    const organization = { ...departmentResource, owner_scope: 'ORGANIZATION', owner_department_id: null };
    const sameDepartment = departmentResource;
    const otherDepartment = { ...departmentResource, owner_department_id: 'department-b' };
    const restricted = { ...departmentResource, owner_scope: 'RESTRICTED', owner_department_id: null };

    expect(canReferenceContentResource(organization, sameDepartment)).toBe(false);
    expect(canReferenceContentResource(organization, organization)).toBe(true);
    expect(canReferenceContentResource(sameDepartment, organization)).toBe(true);
    expect(canReferenceContentResource(sameDepartment, sameDepartment)).toBe(true);
    expect(canReferenceContentResource(sameDepartment, otherDepartment)).toBe(false);
    expect(canReferenceContentResource(restricted, otherDepartment)).toBe(true);
  });

  it('builds one server-authoritative ownership and permission response contract', () => {
    const ownership = {
      scope: 'DEPARTMENT' as const,
      department_id: 'department-a',
      department_name: 'Department A',
      creator: {
        id: 'creator-1',
        display_name: 'Deleted Creator',
        status: 'DELETED' as const,
      },
    };
    const actor = { userId: 'creator-1', roleName: 'OPERATOR', departmentId: 'department-a' };
    const updateOnly = ability('update:Media');

    expect(contentResponseMetadata(departmentResource, ownership, actor, updateOnly, 'Media')).toEqual({
      created_by: 'creator-1',
      ownership,
      permissions: { can_update: true, can_delete: false },
    });
    expect(contentResponseMetadata(departmentResource, ownership, actor, updateOnly, 'Schedule', false)).toEqual({
      created_by: 'creator-1',
      ownership,
      permissions: { can_update: false, can_delete: false },
    });
  });

  it('does not upgrade conditional management into global ownership or cross-department access', () => {
    const actor = { userId: 'custom-1', roleName: 'CUSTOM', departmentId: 'department-a' };
    const limited = createMongoAbility([{ action: 'manage', subject: 'Media', conditions: { id: 'allowed-media' } }]) as ContentAbility;
    const other = { ...departmentResource, id: 'other-media', owner_scope: 'RESTRICTED', owner_department_id: null };
    expect(() => ownershipForNewContent(actor, limited, 'Media', { id: 'other-media', name: 'Other' }))
      .toThrow(/Forbidden/);
    expect(canReadContentResource(actor, other, limited, 'Media')).toBe(false);
    expect(canManageContentResource(actor, other, limited, 'Media', 'update')).toBe(false);
    expect(() => ownershipForNewContent({ ...actor, departmentId: null }, limited, 'Media', { name: 'Other' }))
      .toThrow(/department is required/i);
  });

  it('checks conditional creation against the proposed ownership and fields', () => {
    const limited = createMongoAbility([
      { action: 'create', subject: 'Media', conditions: { owner_department_id: 'department-a', name: 'Allowed' } },
    ]) as ContentAbility;
    const actor = { userId: 'creator-1', roleName: 'CUSTOM', departmentId: 'department-a' };
    expect(ownershipForNewContent(actor, limited, 'Media', { name: 'Allowed' }))
      .toEqual({ owner_scope: 'DEPARTMENT', owner_department_id: 'department-a' });
    expect(() => ownershipForNewContent(actor, limited, 'Media', { name: 'Denied' })).toThrow(/Forbidden/);
    expect(() => ownershipForNewContent({ ...actor, departmentId: 'department-b' }, limited, 'Media', { name: 'Allowed' }))
      .toThrow(/Forbidden/);
  });

  it('intersects supported conditional read grants with ownership before list pagination', () => {
    const allowedId = '00000000-0000-4000-8000-000000000010';
    const secondId = '00000000-0000-4000-8000-000000000011';
    const actor = { userId: 'reader-1', roleName: 'CUSTOM', departmentId: 'department-a' };
    const limited = createMongoAbility([
      { action: 'read', subject: 'Media', conditions: { id: allowedId } },
      { action: 'read', subject: 'Media', conditions: { id: secondId } },
    ]) as ContentAbility;
    const permitted = { ...departmentResource, id: allowedId };
    expect(canReadContentResource(actor, permitted, limited, 'Media')).toBe(true);
    expect(canReadContentResource(actor, { ...permitted, id: secondId }, limited, 'Media')).toBe(true);
    expect(canReadContentResource(actor, { ...permitted, id: 'other-media' }, limited, 'Media')).toBe(false);
    const query = new PgDialect().sqlToQuery(contentReadCondition(actor, schema.media, limited, 'Media')!);
    expect(query.params).toContain(allowedId);
    expect(query.params).toContain(secondId);
    expect(query.sql).toContain(' or ');
    expect(query.params).toContain('department-a');
    const unsupported = createMongoAbility([
      { action: 'read', subject: 'Media', conditions: { unknown_field: 'value' } },
    ]) as ContentAbility;
    expect(new PgDialect().sqlToQuery(contentReadCondition(actor, schema.media, unsupported, 'Media')!).sql)
      .toContain('false');
  });
});
