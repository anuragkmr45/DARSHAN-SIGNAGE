import { and, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  inviteInvitedAtExpression,
  inviteStatusPredicate,
  scopedInvitationDirectoryPredicates,
  scopedPeopleDirectoryPredicates,
} from '@/db/repositories/user';
import { CANONICAL_INVITE_EXPIRY_PATTERN, CANONICAL_INVITE_TOKEN_PATTERN } from '@/auth/invite-state';

describe('invitation status SQL predicate', () => {
  const now = '2026-10-27T00:00:00.000Z';
  const compile = (status: 'pending' | 'expired' | 'activated') =>
    new PgDialect().sqlToQuery(inviteStatusPredicate(status, now));

  it('compares canonical UTC expiry text without casting legacy JSON', () => {
    const pending = compile('pending');
    expect(pending.sql).not.toContain('timestamptz');
    expect(pending.sql).toContain("->>'invite_expires_at'");
    expect(pending.params).toEqual(expect.arrayContaining([
      CANONICAL_INVITE_TOKEN_PATTERN, CANONICAL_INVITE_EXPIRY_PATTERN, now,
    ]));
  });

  it('routes missing or noncanonical token expiry into the expired recovery set', () => {
    const expired = compile('expired');
    expect(expired.sql).not.toContain('timestamptz');
    expect(expired.sql.toLowerCase()).toContain('is null');
    expect(expired.sql.toLowerCase()).toContain('not');
    expect(expired.params).toEqual(expect.arrayContaining([
      CANONICAL_INVITE_TOKEN_PATTERN, CANONICAL_INVITE_EXPIRY_PATTERN, now,
    ]));
  });

  it('guards the invited-at timestamp cast with the canonical UTC pattern', () => {
    const compiled = new PgDialect().sqlToQuery(inviteInvitedAtExpression());

    expect(compiled.sql).toContain('CASE WHEN');
    expect(compiled.sql).toContain("->>'invited_at'");
    expect(compiled.sql).toContain('::timestamptz');
    expect(compiled.sql).toContain('created_at');
    expect(compiled.params).toContain(CANONICAL_INVITE_EXPIRY_PATTERN);
  });

  it('keeps pending invitations out of scoped people SQL but inside invitation SQL', () => {
    const visibility = {
      actorUserId: '00000000-0000-4000-8000-000000000001',
      actorDepartmentId: '00000000-0000-4000-8000-000000000002',
      global: false,
      readPredicate: sql`true`,
    };
    const dialect = new PgDialect();
    const people = dialect.sqlToQuery(and(...scopedPeopleDirectoryPredicates(visibility))!);
    const invitations = dialect.sqlToQuery(and(...scopedInvitationDirectoryPredicates(visibility))!);

    expect(people.sql).toContain("->>'invite_status' = 'ACTIVATED'");
    expect(people.sql).toContain("->>'invite_token' IS NULL");
    expect(invitations.sql).not.toContain("->>'invite_status' = 'ACTIVATED'");
    expect(invitations.sql).not.toContain("->>'invite_token' IS NULL");
    expect(people.params).toContain(visibility.actorDepartmentId);
    expect(invitations.params).toContain(visibility.actorDepartmentId);
  });
});
