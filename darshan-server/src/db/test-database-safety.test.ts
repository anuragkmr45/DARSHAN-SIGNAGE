import { describe, expect, it } from 'vitest';
import {
  assertDedicatedTestDatabase,
  assertTestRuntimeDatabase,
  parseDatabaseName,
  TestDatabaseSafetyError,
} from './test-database-safety';

describe('test database safety', () => {
  it('accepts dedicated test database URLs without exposing credentials', () => {
    expect(parseDatabaseName('postgresql://user:secret@db.example.test:5432/darshan_test')).toBe('darshan_test');
    expect(assertDedicatedTestDatabase('postgres://user:secret@db.example.test/darshan_ci_test_123')).toBe('darshan_ci_test_123');
  });

  it('rejects shared runtime databases before tests can mutate them', () => {
    expect(() => assertDedicatedTestDatabase('postgresql://user:secret@localhost:5432/darshan')).toThrow(TestDatabaseSafetyError);
    expect(() => assertDedicatedTestDatabase('postgresql://user:secret@localhost:5432/darshan')).toThrow(/darshan_test/);
    expect(() => assertDedicatedTestDatabase('https://example.test/darshan_test')).toThrow(/postgres/);
  });

  it('only enforces the dedicated database rule in test runtime', () => {
    expect(() => assertTestRuntimeDatabase('development', 'postgresql://postgres:postgres@localhost:5432/darshan')).not.toThrow();
    expect(() => assertTestRuntimeDatabase('test', 'postgresql://postgres:postgres@localhost:5432/darshan')).toThrow(TestDatabaseSafetyError);
  });
});
