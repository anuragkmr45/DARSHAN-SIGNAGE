import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  builtInInviteRolePredicate,
  canIssueInviteFor,
  isPendingInvite,
  parseInviteStatuses,
} from '@/routes/users-invite';
import type { AppAbility } from '@/rbac';

describe('invite directory status filter', () => {
  it('resolves legacy role-name input only to a marked built-in role', () => {
    const compiled = new PgDialect().sqlToQuery(builtInInviteRolePredicate('OPERATOR'));

    expect(compiled.sql).toContain('"roles"."name" =');
    expect(compiled.sql).toContain('"roles"."is_system" =');
    expect(compiled.params).toEqual(['OPERATOR', true]);
  });

  it('preserves omitted filtering and normalizes valid aliases without duplicates', () => {
    expect(parseInviteStatuses(undefined)).toBeUndefined();
    expect(parseInviteStatuses(' pending, EXPIRED,active,approved,activated '))
      .toEqual(['pending', 'expired', 'activated']);
  });

  it.each(['', 'unknown', 'pending,unknown', 'pending,'])('rejects %j instead of widening the invite list', (input) => {
    expect(() => parseInviteStatuses(input)).toThrow('Invalid invite status filter.');
  });
});

describe('replaceable invitation state', () => {
  const pending = {
    id: 'invite-id', email: 'invitee@example.test', role_id: 'role-id', department_id: null,
    is_active: true, deleted_at: null, role: 'OPERATOR', role_is_system: true,
    ext: { invite_status: 'PENDING', invite_token: 'old-token', invite_expires_at: '2000-01-01T00:00:00.000Z' },
  };

  it('allows pending recovery even with corrupt token metadata and rejects activated, disabled or deleted accounts', () => {
    expect(isPendingInvite(pending)).toBe(true);
    expect(isPendingInvite({ ...pending, ext: { ...pending.ext, invite_status: 'EXPIRED' } })).toBe(true);
    expect(isPendingInvite({ ...pending, ext: { ...pending.ext, invite_status: 'ACTIVATED' } })).toBe(false);
    expect(isPendingInvite({ ...pending, is_active: false })).toBe(false);
    expect(isPendingInvite({ ...pending, deleted_at: new Date() })).toBe(false);
    expect(isPendingInvite({ ...pending, ext: { ...pending.ext, invite_token: '' } })).toBe(true);
    expect(isPendingInvite({ ...pending, ext: { invite_status: 'PENDING' } })).toBe(true);
    expect(isPendingInvite({ ...pending, ext: null })).toBe(false);
  });

  it('evaluates an ID-limited create grant against the existing invitation ID', () => {
    const ability = createMongoAbility([
      { action: 'create', subject: 'User', conditions: { id: pending.id } },
    ]) as AppAbility;
    const sameDepartment = { ...pending, department_id: 'dept-a' };

    expect(canIssueInviteFor(ability, 'dept-a', sameDepartment)).toBe(true);
    expect(canIssueInviteFor(ability, 'dept-a', { ...sameDepartment, id: 'another-invite' })).toBe(false);
    expect(canIssueInviteFor(ability, 'dept-b', sameDepartment)).toBe(false);
  });
});
