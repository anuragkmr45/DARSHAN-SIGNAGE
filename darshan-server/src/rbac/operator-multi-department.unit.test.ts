import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';
import { combineUserDepartments, haveSharedDepartment } from '@/db/repositories/user-departments';
import {
  canManageContentResource,
  canReadContentResource,
  ownershipForNewContent,
} from '@/rbac/content-ownership';
import { canAccessDirectoryUser } from '@/rbac/user-directory';

const actor = {
  userId: 'operator-a', roleName: 'OPERATOR', departmentId: 'A', departmentIds: ['A', 'B'],
};
const ability = createMongoAbility([
  ...(['Media', 'Layout', 'Presentation', 'Schedule'] as const).flatMap((subject) => [
    { action: 'read', subject },
    { action: 'create', subject },
    { action: 'update', subject },
  ]),
  { action: 'read', subject: 'User' },
]);

describe('multi-department authorization helpers', () => {
  it('keeps primary first and produces one entry per explicitly assigned department', () => {
    expect(combineUserDepartments('A', ['C', 'B', 'C', 'A'])).toEqual({
      primaryDepartmentId: 'A',
      additionalDepartmentIds: ['B', 'C'],
      departmentIds: ['A', 'B', 'C'],
    });
    expect(haveSharedDepartment(['A', 'B'], ['C', 'B'])).toBe(true);
    expect(haveSharedDepartment(['A', 'B'], ['C'])).toBe(false);
  });

  it('reads assigned department content but never changes the primary owner for new content', () => {
    const inB = { id: 'media-b', created_by: 'peer', owner_scope: 'DEPARTMENT', owner_department_id: 'B' };
    const inC = { ...inB, id: 'media-c', owner_department_id: 'C' };
    for (const subject of ['Media', 'Layout', 'Presentation', 'Schedule'] as const) {
      expect(canReadContentResource(actor, inB, ability, subject)).toBe(true);
      expect(canReadContentResource(actor, inC, ability, subject)).toBe(false);
      expect(ownershipForNewContent(actor, ability, subject)).toEqual({
        owner_scope: 'DEPARTMENT', owner_department_id: 'A',
      });
    }
  });

  it('keeps creator-only media/layout/presentation changes and action-specific schedule changes', () => {
    const inB = { id: 'resource-b', created_by: 'peer', owner_scope: 'DEPARTMENT', owner_department_id: 'B' };
    for (const subject of ['Media', 'Layout', 'Presentation'] as const) {
      expect(canManageContentResource(actor, inB, ability, subject, 'update')).toBe(false);
      expect(canManageContentResource(actor, { ...inB, created_by: actor.userId }, ability, subject, 'update')).toBe(true);
    }
    expect(canManageContentResource(actor, inB, ability, 'Schedule', 'update')).toBe(true);
    expect(canManageContentResource(actor, { ...inB, owner_department_id: 'C' }, ability, 'Schedule', 'update')).toBe(false);
  });

  it('discovers active shared-department people once, not unassigned or deleted people', () => {
    const target = { id: 'peer', department_id: 'C', department_ids: ['C', 'B'], is_active: true };
    expect(canAccessDirectoryUser(actor, target, ability)).toBe(true);
    expect(canAccessDirectoryUser(actor, { ...target, department_ids: ['C'] }, ability)).toBe(false);
    expect(canAccessDirectoryUser(actor, { ...target, deleted_at: new Date() }, ability)).toBe(false);
    expect(canAccessDirectoryUser(actor, { ...target, is_active: false }, ability)).toBe(false);
  });
});
