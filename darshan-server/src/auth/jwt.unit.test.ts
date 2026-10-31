import { describe, expect, it } from 'vitest';
import { tokenClaimsMatchAccount } from '@/auth/jwt';

describe('stored account versus signed token claims', () => {
  const current = { role_id: 'role-1', role: 'OPERATOR', department_id: 'dept-1' };

  it('accepts matching role identity and department', () => {
    expect(tokenClaimsMatchAccount({ role_id: 'role-1', role: 'OPERATOR', department_id: 'dept-1' }, current)).toBe(true);
    expect(tokenClaimsMatchAccount(
      { role_id: 'role-1', role: 'OPERATOR' }, { ...current, department_id: null }
    )).toBe(true);
  });

  it.each([
    { role_id: 'role-2', role: 'OPERATOR', department_id: 'dept-1' },
    { role_id: 'role-1', role: 'ADMIN', department_id: 'dept-1' },
    { role_id: 'role-1', role: 'OPERATOR', department_id: 'dept-2' },
    { role_id: 'role-1', role: 'OPERATOR' },
  ])('rejects stale or mismatched claims %#', (claims) => {
    expect(tokenClaimsMatchAccount(claims, current)).toBe(false);
  });
});
