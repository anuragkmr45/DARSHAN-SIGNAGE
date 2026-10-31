import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';
import { PgDialect } from 'drizzle-orm/pg-core';
import { schema } from '@/db';
import type { AppAbility } from '@/rbac';
import { integrationReadCondition, type IntegrationSubject } from './integration-access';

const compile = (subject: IntegrationSubject, rules: Parameters<typeof createMongoAbility>[0]) => {
  const columns = subject === 'ApiKey' ? schema.apiKeys : schema.webhookSubscriptions;
  return new PgDialect().sqlToQuery(
    integrationReadCondition(createMongoAbility(rules) as AppAbility, subject, columns)
  );
};

describe('integration record read conditions', () => {
  it('filters API keys by supported record fields before pagination', () => {
    const creator = '11111111-1111-4111-8111-111111111111';
    const query = compile('ApiKey', [
      { action: 'read', subject: 'ApiKey', conditions: { name: 'Player automation', created_by: creator } },
    ]);
    expect(query.sql).toContain('"name"');
    expect(query.sql).toContain('"created_by"');
    expect(query.params).toEqual(['Player automation', creator]);
  });

  it('supports separate webhook URL/name grants without merging their conditions', () => {
    const query = compile('Webhook', [
      { action: 'read', subject: 'Webhook', conditions: { name: 'Operations' } },
      { action: 'read', subject: 'Webhook', conditions: { target_url: 'https://hooks.example.test/events' } },
    ]);
    expect(query.sql).toContain(' or ');
    expect(query.params).toEqual(['Operations', 'https://hooks.example.test/events']);
  });

  it('fails closed for unsupported fields, wrong-subject URL and malformed UUIDs', () => {
    expect(compile('ApiKey', [
      { action: 'read', subject: 'ApiKey', conditions: { target_url: 'https://not-an-api-key-field.test' } },
    ]).sql).toContain('false');
    expect(compile('Webhook', [
      { action: 'read', subject: 'Webhook', conditions: { id: 'bad-id' } },
    ]).sql).toContain('false');
    expect(compile('Webhook', [
      { action: 'read', subject: 'Webhook', conditions: { secret: 'must-not-be-queryable' } },
    ]).sql).toContain('false');
  });

  it('keeps only unconditional read or manage grants unrestricted', () => {
    expect(compile('ApiKey', [{ action: 'read', subject: 'ApiKey' }]).sql).toContain('true');
    expect(compile('Webhook', [{ action: 'manage', subject: 'all' }]).sql).toContain('true');
  });
});
