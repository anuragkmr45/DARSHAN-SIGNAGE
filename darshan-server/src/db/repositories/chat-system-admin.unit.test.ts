import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { systemChatAdminPredicate } from '@/db/repositories/chat';

describe('automatic chat system-administrator selection', () => {
  it('requires an active usable account on an exact built-in administrator role', () => {
    const compiled = new PgDialect().sqlToQuery(systemChatAdminPredicate());

    expect(compiled.sql).toContain('"users"."is_active" =');
    expect(compiled.sql).toContain('"users"."deleted_at" is null');
    expect(compiled.sql).toContain('"roles"."is_system" =');
    expect(compiled.sql).toContain('"roles"."name" in');
    expect(compiled.sql).toContain("->>'invite_status' = 'ACTIVATED'");
    expect(compiled.sql).toContain("->>'invite_token' IS NULL");
    expect(compiled.params).toEqual(expect.arrayContaining([true, 'ADMIN', 'SUPER_ADMIN']));
  });
});
