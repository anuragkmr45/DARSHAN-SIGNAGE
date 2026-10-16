import { describe, expect, it } from 'vitest';
import { resolveAffectedRoleIds } from '@/db/repositories/role';

describe('role inheritance impact', () => {
  it('includes direct and transitive inheritors but not unrelated roles', () => {
    expect(
      resolveAffectedRoleIds(
        [
          { id: 'base', permissions: { grants: [] } },
          { id: 'child', permissions: { inherits: ['base'], grants: [] } },
          { id: 'grandchild', permissions: { inherits: ['child'], grants: [] } },
          { id: 'unrelated', permissions: { grants: [] } },
        ],
        'base'
      )
    ).toEqual(['base', 'child', 'grandchild']);
  });

  it('terminates safely for a cyclic legacy graph', () => {
    expect(
      resolveAffectedRoleIds(
        [
          { id: 'a', permissions: { inherits: ['b'], grants: [] } },
          { id: 'b', permissions: { inherits: ['a'], grants: [] } },
        ],
        'a'
      )
    ).toEqual(['a', 'b']);
  });
});
