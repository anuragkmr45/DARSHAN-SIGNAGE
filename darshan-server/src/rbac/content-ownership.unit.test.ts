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

describe('content ownership policy', () => {
  it('snapshots organization ownership for administrators and department ownership for scoped users', () => {
    expect(
      ownershipForNewContent({ userId: 'admin-1', roleName: 'ADMIN', departmentId: null })
    ).toEqual({ owner_scope: 'ORGANIZATION', owner_department_id: null });
    expect(
      ownershipForNewContent({ userId: 'operator-1', roleName: 'OPERATOR', departmentId: 'department-a' })
    ).toEqual({ owner_scope: 'DEPARTMENT', owner_department_id: 'department-a' });
    expect(() =>
      ownershipForNewContent({ userId: 'operator-1', roleName: 'OPERATOR', departmentId: null })
    ).toThrow(/department is required/i);
  });

  it('allows organization reads, same-department reads, and administrator-only restricted reads', () => {
    const operator = { userId: 'operator-1', roleName: 'OPERATOR', departmentId: 'department-a' };
    expect(canReadContentResource(operator, departmentResource)).toBe(true);
    expect(
      canReadContentResource(operator, {
        ...departmentResource,
        owner_scope: 'ORGANIZATION',
        owner_department_id: null,
      })
    ).toBe(true);
    expect(
      canReadContentResource({ ...operator, departmentId: 'department-b' }, departmentResource)
    ).toBe(false);
    expect(
      canReadContentResource(operator, {
        ...departmentResource,
        owner_scope: 'RESTRICTED',
        owner_department_id: null,
      })
    ).toBe(false);
    expect(
      canReadContentResource(
        { userId: 'admin-1', roleName: 'ADMIN', departmentId: null },
        { ...departmentResource, owner_scope: 'RESTRICTED', owner_department_id: null }
      )
    ).toBe(true);
  });

  it('lets department leads manage department content while operators and custom roles manage only their own', () => {
    expect(
      canManageContentResource(
        { userId: 'lead-1', roleName: 'DEPARTMENT', departmentId: 'department-a' },
        departmentResource
      )
    ).toBe(true);
    expect(
      canManageContentResource(
        { userId: 'creator-1', roleName: 'OPERATOR', departmentId: 'department-a' },
        departmentResource
      )
    ).toBe(true);
    expect(
      canManageContentResource(
        { userId: 'other-1', roleName: 'OPERATOR', departmentId: 'department-a' },
        departmentResource
      )
    ).toBe(false);
    expect(
      canManageContentResource(
        { userId: 'creator-1', roleName: 'CUSTOM_EDITOR', departmentId: 'department-a' },
        departmentResource
      )
    ).toBe(true);
    expect(
      canManageContentResource(
        { userId: 'creator-1', roleName: 'OPERATOR', departmentId: 'department-b' },
        departmentResource
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
