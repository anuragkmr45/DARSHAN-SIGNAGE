import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';
import { PgDialect } from 'drizzle-orm/pg-core';
import { departmentReadPredicate } from './department-access';
import type { AppAbility } from '@/rbac';

const queryFor = (rules: Parameters<typeof createMongoAbility>[0]) =>
  new PgDialect().sqlToQuery(departmentReadPredicate(createMongoAbility(rules) as AppAbility));

describe('Department read predicate', () => {
  it('restricts both list rows and totals to supported record conditions', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const query = queryFor([{ action: 'read', subject: 'Department', conditions: { id, name: 'North' } }]);
    expect(query.sql).toContain('"id"');
    expect(query.sql).toContain('"name"');
    expect(query.params).toEqual([id, 'North']);
  });

  it('combines distinct matching grants without widening either condition', () => {
    const query = queryFor([
      { action: 'read', subject: 'Department', conditions: { name: 'North' } },
      { action: 'read', subject: 'Department', conditions: { name: 'South' } },
    ]);
    expect(query.sql).toContain(' or ');
    expect(query.params).toEqual(['North', 'South']);
  });

  it('fails closed for unsupported fields and malformed UUIDs', () => {
    expect(queryFor([{ action: 'read', subject: 'Department', conditions: { id: 'bad-id' } }]).sql)
      .toContain('false');
    expect(queryFor([{ action: 'read', subject: 'Department', conditions: { secret: 'anything' } }]).sql)
      .toContain('false');
  });

  it('keeps unconditional read and manage grants unrestricted', () => {
    expect(queryFor([{ action: 'read', subject: 'Department' }]).sql).toContain('true');
    expect(queryFor([{ action: 'manage', subject: 'all' }]).sql).toContain('true');
  });
});
