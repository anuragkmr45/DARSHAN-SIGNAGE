import { describe, expect, it } from 'vitest';
import { isCsrfExemptPath } from '@/middleware/csrf';

describe('public CSRF route exceptions', () => {
  it('permits token-based invitation activation but not account-management writes', () => {
    expect(isCsrfExemptPath('/api/v1/users/activate')).toBe(true);
    expect(isCsrfExemptPath('/api/v1/users/invite')).toBe(false);
    expect(isCsrfExemptPath('/api/v1/users')).toBe(false);
    expect(isCsrfExemptPath('/api/v1/users/activate/other')).toBe(false);
    expect(isCsrfExemptPath(undefined)).toBe(false);
  });
});
