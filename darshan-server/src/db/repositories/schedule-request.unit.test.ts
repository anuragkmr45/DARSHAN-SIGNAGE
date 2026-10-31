import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';
import { PgDialect } from 'drizzle-orm/pg-core';
import { requestReadCondition } from './schedule-request';
import type { ContentAbility } from '@/rbac/content-ownership';

const queryFor = (rules: Parameters<typeof createMongoAbility>[0]) => {
  const ability = createMongoAbility(rules) as ContentAbility;
  return new PgDialect().sqlToQuery(requestReadCondition(ability));
};

describe('ScheduleRequest read predicate', () => {
  it('limits list rows and totals to supported matching request fields', () => {
    const scheduleId = '11111111-1111-4111-8111-111111111111';
    const query = queryFor([
      { action: 'read', subject: 'ScheduleRequest', conditions: { schedule_id: scheduleId, status: 'PENDING' } },
    ]);
    expect(query.sql).toContain('schedule_id');
    expect(query.sql).toContain('status');
    expect(query.params).toEqual([scheduleId, 'PENDING']);
  });

  it('fails closed for unsupported or invalid conditional grants', () => {
    expect(queryFor([{ action: 'read', subject: 'ScheduleRequest', conditions: { schedule_id: 'invalid' } }]).sql)
      .toContain('false');
    expect(queryFor([{ action: 'read', subject: 'ScheduleRequest', conditions: { payload: 'anything' } }]).sql)
      .toContain('false');
  });

  it('allows an unconditional read grant without a request filter', () => {
    expect(queryFor([{ action: 'read', subject: 'ScheduleRequest' }]).sql).toContain('true');
  });
});
