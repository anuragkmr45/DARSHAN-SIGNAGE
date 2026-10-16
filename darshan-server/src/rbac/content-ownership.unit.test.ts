import { describe, expect, it } from 'vitest';
import {
  canManageContentResource,
  canReadContentResource,
  canReferenceContentResource,
  contentResponseMetadata,
  ownershipForNewContent,
} from '@/rbac/content-ownership';

const departmentResource = {
  id: 'resource-1',
  created_by: 'creator-1',
  owner_scope: 'DEPARTMENT',
  owner_department_id: 'department-a',
};

const ability = (...grants: string[]) => ({
  can: (action: string, subject: string) =>
    grants.includes(`${action}:${subject}`) ||
    grants.includes(`manage:${subject}`) ||
    grants.includes('manage:all'),
});

describe('content ownership policy', () => {
  it('snapshots restricted, organization, and department ownership from role and permissions', () => {
    expect(
      ownershipForNewContent(
        { userId: 'root-1', roleName: 'SUPER_ADMIN', departmentId: null },
        ability('manage:all'),
        'Media'
      )
    ).toEqual({ owner_scope: 'RESTRICTED', owner_department_id: null });
    expect(
      ownershipForNewContent(
        { userId: 'admin-1', roleName: 'ADMIN', departmentId: null },
        ability('manage:Media'),
        'Media'
      )
    ).toEqual({ owner_scope: 'ORGANIZATION', owner_department_id: null });
    expect(
      ownershipForNewContent(
        { userId: 'custom-1', roleName: 'CUSTOM_GLOBAL', departmentId: null },
        ability('manage:Media'),
        'Media'
      )
    ).toEqual({ owner_scope: 'ORGANIZATION', owner_department_id: null });
    expect(
      ownershipForNewContent(
        { userId: 'operator-1', roleName: 'OPERATOR', departmentId: 'department-a' },
        ability('create:Media'),
        'Media'
      )
    ).toEqual({ owner_scope: 'DEPARTMENT', owner_department_id: 'department-a' });
    expect(() =>
      ownershipForNewContent(
        { userId: 'operator-1', roleName: 'OPERATOR', departmentId: null },
        ability('create:Media'),
        'Media'
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
    const ability = { can: (action: string, subject: string) => action === 'update' && subject === 'Media' };

    expect(contentResponseMetadata(departmentResource, ownership, actor, ability, 'Media')).toEqual({
      created_by: 'creator-1',
      ownership,
      permissions: { can_update: true, can_delete: false },
    });
    expect(contentResponseMetadata(departmentResource, ownership, actor, ability, 'Schedule', false)).toEqual({
      created_by: 'creator-1',
      ownership,
      permissions: { can_update: false, can_delete: false },
    });
  });
});
