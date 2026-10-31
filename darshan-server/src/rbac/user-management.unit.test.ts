import { createMongoAbility, subject } from '@casl/ability';
import { describe, expect, it } from 'vitest';
import { canUnconditionally, defineAbilityFor, hasGlobalUserManagement, resolveConditions, type AppAbility } from '@/rbac';
import { canManageUserTarget } from '@/rbac/policy';
import { findSystemRoleIdentityConflict, isReservedSystemRoleName, isSystemRoleIdentityConflict } from '@/rbac/system-roles';
import {
  canAccessDirectoryUser,
  directoryReadPredicate,
  directorySignInEligiblePredicate,
  hasDirectoryReadGrant,
  userActionPermissions,
} from '@/rbac/user-directory';
import { updateUserSchema } from '@/schemas/user';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { DbExecutor } from '@/db';

const actorId = '00000000-0000-4000-8000-000000000001';
const departmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roleId = '00000000-0000-4000-8000-000000000003';
const inheritedRoleId = '00000000-0000-4000-8000-000000000004';

type TestRole = {
  id: string;
  name: string;
  is_system?: boolean;
  permissions: { grants: Array<{ action: string; subject: string; conditions?: Record<string, string> }>; inherits?: string[] };
};

function roleExecutor(roles: TestRole[]): DbExecutor {
  return {
    select: () => ({
      from: () => ({
        where: async (condition: Parameters<PgDialect['sqlToQuery']>[0]) => {
          const id = new PgDialect().sqlToQuery(condition).params[0];
          return roles.filter((role) => role.id === id);
        },
      }),
    }),
  } as unknown as DbExecutor;
}

describe('user management boundaries', () => {
  it('reserves built-in role names regardless of casing or surrounding whitespace', () => {
    expect(isReservedSystemRoleName(' SUPER_ADMIN ')).toBe(true);
    expect(isReservedSystemRoleName('admin')).toBe(true);
    expect(isReservedSystemRoleName(' Department ')).toBe(true);
    expect(isReservedSystemRoleName('operator')).toBe(true);
    expect(isReservedSystemRoleName('Custom ADMIN')).toBe(false);
    expect(isReservedSystemRoleName(null)).toBe(false);
  });

  it('detects every noncanonical reserved-name identity without promoting it', async () => {
    const roles = [
      { id: roleId, name: 'ADMIN', is_system: true },
      { id: inheritedRoleId, name: ' admin ', is_system: false },
    ];
    const executor = {
      select: () => ({ from: async () => roles }),
    } as unknown as DbExecutor;
    await expect(findSystemRoleIdentityConflict(executor)).resolves.toEqual(roles[1]);
    expect(roles[1].is_system).toBe(false);
    expect(isSystemRoleIdentityConflict({ ...roles[1], is_system: true })).toBe(true);
    expect(isSystemRoleIdentityConflict(roles[0])).toBe(false);
  });

  it('does not turn unresolved conditions into unrestricted grants', () => {
    expect(resolveConditions({ department_id: '$user.department_id' }, { id: 'actor' })).toBeNull();
    expect(resolveConditions({ department_id: '$user.other' }, { id: 'actor', department_id: 'dept-a' })).toBeNull();
    expect(resolveConditions({ department_id: '$user.department_id' }, { id: 'actor', department_id: 'dept-a' }))
      .toEqual({ department_id: 'dept-a' });
    expect(resolveConditions(undefined, { id: 'actor' })).toBeUndefined();
    expect(resolveConditions(null as any, { id: actorId })).toBeNull();
    expect(resolveConditions(['bad'] as any, { id: actorId })).toBeNull();
    expect(resolveConditions({ id: 123 } as any, { id: actorId })).toBeNull();
  });

  it('distinguishes conditional management from global management', () => {
    const conditional = createMongoAbility([{ action: 'manage', subject: 'User', conditions: { department_id: 'dept-a' } }]) as AppAbility;
    const global = createMongoAbility([{ action: 'manage', subject: 'all' }]) as AppAbility;
    expect(conditional.can('manage', subject('User', { department_id: 'dept-a' }))).toBe(true);
    expect(hasGlobalUserManagement(conditional)).toBe(false);
    expect(hasGlobalUserManagement(global)).toBe(true);
  });

  it('requires record context for conditional Role grants', () => {
    const ability = createMongoAbility([
      { action: 'read', subject: 'Role', conditions: { id: roleId } },
      { action: 'update', subject: 'Role', conditions: { id: roleId } },
    ]) as AppAbility;
    expect(ability.can('read', 'Role')).toBe(true); // CASL subject-type checks ignore record conditions.
    expect(canUnconditionally(ability, 'read', 'Role')).toBe(false);
    expect(ability.can('read', subject('Role', { id: roleId }))).toBe(true);
    expect(ability.can('update', subject('Role', { id: actorId }))).toBe(false);
    expect(canUnconditionally(createMongoAbility([{ action: 'manage', subject: 'all' }]) as AppAbility, 'read', 'Role'))
      .toBe(true);
  });

  it.each([
    'Schedule',
    'ScheduleRequest',
    'Conversation',
    'SsoConfig',
    'Dashboard',
    'Report',
    'AuditLog',
    'ProofOfPlay',
    'Screen',
  ] as const)(
    'does not treat conditional %s management as subject-wide authority', (resource) => {
      const scoped = createMongoAbility([
        { action: 'manage', subject: resource, conditions: { id: roleId } },
      ]) as AppAbility;
      expect(scoped.can('manage', resource)).toBe(true);
      expect(canUnconditionally(scoped, 'manage', resource)).toBe(false);
      expect(canUnconditionally(scoped, 'read', resource)).toBe(false);
      expect(canUnconditionally(scoped, 'update', resource)).toBe(false);
      expect(canUnconditionally(createMongoAbility([{ action: 'manage', subject: resource }]) as AppAbility,
        'manage', resource)).toBe(true);
    }
  );

  it('keeps ADMIN branding blocked unless a valid unconditional explicit action grants it', async () => {
    const administrator = (grants: TestRole['permissions']['grants']) => defineAbilityFor(
      roleId, actorId, undefined, roleExecutor([{
        id: roleId,
        name: 'ADMIN',
        is_system: true,
        permissions: { grants: [{ action: 'manage', subject: 'all' }, ...grants] },
      }])
    );
    const malformed = await administrator([
      { action: 'read', subject: 'BrandingSettings', conditions: { department_id: '$user.department_id' } },
    ]);
    expect(malformed.can('read', 'BrandingSettings')).toBe(false);
    expect(malformed.can('update', 'BrandingSettings')).toBe(false);
    const conditional = await administrator([
      { action: 'read', subject: 'BrandingSettings', conditions: { id: roleId } },
    ]);
    expect(conditional.can('read', 'BrandingSettings')).toBe(false);
    const readOnly = await administrator([{ action: 'read', subject: 'BrandingSettings' }]);
    expect(readOnly.can('read', 'BrandingSettings')).toBe(true);
    expect(readOnly.can('update', 'BrandingSettings')).toBe(false);
  });

  it('keeps Backup outside wildcard roles and grants its four actions independently', async () => {
    const wildcard = await defineAbilityFor(roleId, actorId, undefined, roleExecutor([{
      id: roleId, name: 'ADMIN', is_system: true,
      permissions: { grants: [{ action: 'manage', subject: 'all' }] },
    }]));
    for (const action of ['read', 'create', 'delete', 'download'] as const) {
      expect(canUnconditionally(wildcard, action, 'Backup')).toBe(false);
    }

    const explicit = await defineAbilityFor(roleId, actorId, undefined, roleExecutor([{
      id: roleId, name: 'arbitrary-custom-role', is_system: false,
      permissions: { grants: [
        { action: 'read', subject: 'Backup' },
        { action: 'create', subject: 'Backup' },
        { action: 'delete', subject: 'Backup' },
        { action: 'download', subject: 'Backup' },
      ] },
    }]));
    for (const action of ['read', 'create', 'delete', 'download'] as const) {
      expect(canUnconditionally(explicit, action, 'Backup')).toBe(true);
    }
  });

  it('accepts inherited explicit Backup grants but rejects conditional Backup grants', async () => {
    const inherited = await defineAbilityFor(roleId, actorId, departmentId, roleExecutor([
      { id: roleId, name: 'child', permissions: { grants: [], inherits: [inheritedRoleId] } },
      { id: inheritedRoleId, name: 'parent', permissions: { grants: [
        { action: 'read', subject: 'Backup' },
        { action: 'delete', subject: 'Backup', conditions: { department_id: '$user.department_id' } },
      ] } },
    ]));
    expect(canUnconditionally(inherited, 'read', 'Backup')).toBe(true);
    expect(canUnconditionally(inherited, 'delete', 'Backup')).toBe(false);
  });

  it('gives only canonical system SUPER_ADMIN implicit Backup authority', async () => {
    const canonical = await defineAbilityFor(roleId, actorId, undefined, roleExecutor([{
      id: roleId, name: 'SUPER_ADMIN', is_system: true, permissions: { grants: [] },
    }]));
    const spoofed = await defineAbilityFor(roleId, actorId, undefined, roleExecutor([{
      id: roleId, name: 'SUPER_ADMIN', is_system: false, permissions: { grants: [{ action: 'manage', subject: 'all' }] },
    }]));
    expect(canUnconditionally(canonical, 'download', 'Backup')).toBe(true);
    expect(canUnconditionally(spoofed, 'download', 'Backup')).toBe(false);
  });

  it('does not derive built-in authority or branding exceptions from a non-system role name', async () => {
    const spoofedSuper = await defineAbilityFor(roleId, actorId, undefined, roleExecutor([{
      id: roleId,
      name: 'SUPER_ADMIN',
      is_system: false,
      permissions: { grants: [{ action: 'read', subject: 'Dashboard' }] },
    }]));
    expect(spoofedSuper.can('read', 'Dashboard')).toBe(true);
    expect(spoofedSuper.can('manage', 'all')).toBe(false);

    const spoofedAdmin = await defineAbilityFor(roleId, actorId, undefined, roleExecutor([{
      id: roleId,
      name: 'ADMIN',
      is_system: false,
      permissions: { grants: [{ action: 'read', subject: 'BrandingSettings' }] },
    }]));
    expect(spoofedAdmin.can('read', 'BrandingSettings')).toBe(true);
  });

  it('keeps two distinct inherited record conditions effective', async () => {
    const ability = await defineAbilityFor(roleId, actorId, departmentId, roleExecutor([
      {
        id: roleId,
        name: 'CUSTOM',
        permissions: { grants: [{ action: 'read', subject: 'User', conditions: { id: '$user.id' } }], inherits: [inheritedRoleId] },
      },
      {
        id: inheritedRoleId,
        name: 'PARENT',
        permissions: { grants: [{ action: 'read', subject: 'User', conditions: { department_id: '$user.department_id' } }] },
      },
    ]));

    expect(ability.can('read', subject('User', { id: actorId, department_id: null }))).toBe(true);
    expect(ability.can('read', subject('User', { id: roleId, department_id: departmentId }))).toBe(true);
    expect(ability.can('read', subject('User', { id: roleId, department_id: inheritedRoleId }))).toBe(false);
    expect(hasGlobalUserManagement(ability)).toBe(false);
  });

  it('recognizes inherited unconditional management and drops missing-context grants', async () => {
    const roles: TestRole[] = [
      {
        id: roleId,
        name: 'CUSTOM',
        permissions: { grants: [{ action: 'manage', subject: 'User', conditions: { department_id: '$user.department_id' } }], inherits: [inheritedRoleId] },
      },
      {
        id: inheritedRoleId,
        name: 'PARENT',
        permissions: { grants: [{ action: 'manage', subject: 'all' }] },
      },
    ];
    expect(hasGlobalUserManagement(await defineAbilityFor(roleId, actorId, undefined, roleExecutor(roles)))).toBe(true);
    expect(hasGlobalUserManagement(await defineAbilityFor(roleId, actorId, undefined, roleExecutor([roles[0]])))).toBe(false);
  });

  it('allows scoped managers only the real operator role in their own department', () => {
    const scoped = { departmentId: 'dept-a', globalUserManagement: false };
    expect(canManageUserTarget(scoped, { roleName: 'OPERATOR', isSystem: true, departmentId: 'dept-a' })).toBe(true);
    expect(canManageUserTarget(scoped, { roleName: 'OPERATOR', isSystem: false, departmentId: 'dept-a' })).toBe(false);
    expect(canManageUserTarget(scoped, { roleName: 'CUSTOM', isSystem: false, departmentId: 'dept-a' })).toBe(false);
    expect(canManageUserTarget(scoped, { roleName: 'OPERATOR', isSystem: true, departmentId: 'dept-b' })).toBe(false);
    expect(canManageUserTarget({ ...scoped, globalUserManagement: true }, { roleName: 'CUSTOM', isSystem: false, departmentId: 'dept-b' })).toBe(true);
  });

  it('distinguishes omitted department updates from explicit unassignment', () => {
    expect(updateUserSchema.parse({ first_name: 'No change' }).department_id).toBeUndefined();
    expect(updateUserSchema.parse({ department_id: null }).department_id).toBeNull();
    expect(updateUserSchema.safeParse({ department_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('hides disabled and other-department directory users from scoped readers', () => {
    const ability = createMongoAbility([{ action: 'read', subject: 'User' }]) as AppAbility;
    const actor = { userId: 'actor', departmentId: 'dept-a' };
    expect(canAccessDirectoryUser(actor, { id: 'peer', department_id: 'dept-a', is_active: true }, ability)).toBe(true);
    expect(canAccessDirectoryUser(actor, { id: 'peer', department_id: 'dept-b', is_active: true }, ability)).toBe(false);
    expect(canAccessDirectoryUser(actor, { id: 'peer', department_id: 'dept-a', is_active: false }, ability)).toBe(false);
    expect(canAccessDirectoryUser(actor, { id: 'peer', department_id: 'dept-a', is_active: true, deleted_at: new Date() }, ability)).toBe(false);
    expect(canAccessDirectoryUser(actor, {
      id: 'pending', department_id: 'dept-a', is_active: true,
      ext: { invite_status: 'PENDING', invite_token: 'a'.repeat(32) },
    }, ability)).toBe(false);
    expect(canAccessDirectoryUser(actor, {
      id: 'activated', department_id: 'dept-a', is_active: true,
      ext: { invite_status: 'ACTIVATED', invite_token: null },
    }, ability)).toBe(true);
    const global = createMongoAbility([{ action: 'manage', subject: 'User' }]) as AppAbility;
    expect(canAccessDirectoryUser(actor, {
      id: 'pending', department_id: 'dept-b', is_active: true,
      ext: { invite_status: 'PENDING', invite_token: 'a'.repeat(32) },
    }, global)).toBe(true);
  });

  it('expresses sign-in eligibility in the non-global directory SQL predicate', () => {
    const query = new PgDialect().sqlToQuery(directorySignInEligiblePredicate());
    expect(query.sql).toContain('jsonb_typeof');
    expect(query.sql).toContain("?| ARRAY['invite_token', 'invite_status', 'invite_expires_at', 'invited_at']");
    expect(query.sql).toContain("->>'invite_status' = 'ACTIVATED'");
    expect(query.sql).toContain("->>'invite_token' IS NULL");
  });

  it('keeps distinct record grants in the pre-pagination SQL filter', () => {
    const ability = createMongoAbility([
      { action: 'read', subject: 'User', conditions: { id: actorId } },
      { action: 'read', subject: 'User', conditions: { department_id: departmentId } },
      { action: 'read', subject: 'User', conditions: { email: 'not-supported@example.test' } },
    ]) as AppAbility;
    const query = new PgDialect().sqlToQuery(directoryReadPredicate(ability));
    expect(query.sql).toContain(' or ');
    expect(query.params).toEqual(expect.arrayContaining([actorId, departmentId]));
    expect(query.params).not.toContain('not-supported@example.test');
  });

  it('recognizes supported record-only reads without granting an unsupported condition', () => {
    const byRole = createMongoAbility([
      { action: 'read', subject: 'User', conditions: { role_id: roleId } },
    ]) as AppAbility;
    const unsupported = createMongoAbility([
      { action: 'read', subject: 'User', conditions: { email: 'hidden@example.test' } },
    ]) as AppAbility;
    expect(hasDirectoryReadGrant(byRole)).toBe(true);
    expect(canAccessDirectoryUser(
      { userId: 'actor', departmentId: 'dept-a' },
      { id: 'peer', department_id: 'dept-a', role_id: roleId, is_active: true },
      byRole
    )).toBe(true);
    expect(hasDirectoryReadGrant(unsupported)).toBe(false);
  });

  it('fails closed on malformed UUID directory conditions before building SQL', () => {
    const malformed = createMongoAbility([
      { action: 'read', subject: 'User', conditions: { role_id: 'not-a-uuid' } },
      { action: 'read', subject: 'User', conditions: { department_id: departmentId.toUpperCase() } },
    ]) as AppAbility;
    expect(hasDirectoryReadGrant(malformed)).toBe(false);
    expect(canAccessDirectoryUser(
      { userId: actorId, departmentId },
      { id: actorId, department_id: departmentId, role_id: roleId, is_active: true },
      malformed
    )).toBe(false);
    const query = new PgDialect().sqlToQuery(directoryReadPredicate(malformed));
    expect(query.sql).toContain('false');
    expect(query.params).not.toContain('not-a-uuid');
  });

  it.each([
    { name: 'same-department active operator', department: departmentId, role: 'OPERATOR', system: true, active: true, deleted: false, update: true, remove: true },
    { name: 'other-department operator', department: roleId, role: 'OPERATOR', system: true, active: true, deleted: false, update: false, remove: false },
    { name: 'same-department custom role', department: departmentId, role: 'CUSTOM', system: false, active: true, deleted: false, update: false, remove: false },
    { name: 'same-department non-system operator name', department: departmentId, role: 'OPERATOR', system: false, active: true, deleted: false, update: false, remove: false },
    { name: 'same-department disabled operator', department: departmentId, role: 'OPERATOR', system: true, active: false, deleted: false, update: false, remove: false },
    { name: 'same-department deleted operator', department: departmentId, role: 'OPERATOR', system: true, active: true, deleted: true, update: false, remove: false },
    { name: 'departmentless operator', department: null, role: 'OPERATOR', system: true, active: true, deleted: false, update: false, remove: false },
  ])('applies the scoped account action boundary to $name', ({ department, role, system, active, deleted, update, remove }) => {
    const ability = createMongoAbility([
      { action: 'read', subject: 'User' },
      { action: 'update', subject: 'User' },
      { action: 'delete', subject: 'User' },
    ]) as AppAbility;
    const target = {
      id: roleId,
      department_id: department,
      role,
      role_is_system: system,
      is_active: active,
      deleted_at: deleted ? new Date() : null,
    };
    const actor = { userId: actorId, departmentId };
    expect(userActionPermissions(actor, target, ability)).toEqual({
      can_update: update,
      can_delete: remove,
      can_reset_password: update,
    });
    expect(canAccessDirectoryUser(actor, target, ability)).toBe(active && !deleted && department === departmentId);
  });

  it('keeps action-specific and conditional grants narrower than global management', () => {
    const actor = { userId: actorId, departmentId };
    const target = {
      id: roleId,
      department_id: departmentId,
      role: 'OPERATOR',
      role_is_system: true,
      is_active: true,
      deleted_at: null,
    };
    const updateOnly = createMongoAbility([{ action: 'update', subject: 'User' }]) as AppAbility;
    expect(userActionPermissions(actor, target, updateOnly)).toMatchObject({
      can_update: true,
      can_delete: false,
      can_reset_password: true,
    });

    const conditional = createMongoAbility([
      { action: 'manage', subject: 'User', conditions: { department_id: departmentId } },
    ]) as AppAbility;
    expect(hasGlobalUserManagement(conditional)).toBe(false);
    expect(userActionPermissions(actor, target, conditional).can_update).toBe(true);
    expect(userActionPermissions(actor, { ...target, department_id: null }, conditional).can_update).toBe(false);
    expect(userActionPermissions(actor, { ...target, role: 'ADMIN' }, conditional).can_update).toBe(false);

    const global = createMongoAbility([{ action: 'manage', subject: 'all' }]) as AppAbility;
    expect(userActionPermissions(actor, { ...target, department_id: null, role: 'ADMIN', is_active: false }, global))
      .toMatchObject({ can_update: true, can_delete: true });
  });

});
