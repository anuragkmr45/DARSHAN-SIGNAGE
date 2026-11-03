import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subject } from '@casl/ability';

const { findById } = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('@/db/repositories/role', () => ({ createRoleRepository: () => ({ findById }) }));

import { defineAbilityFor } from '@/rbac';
import { PERMISSION_SUBJECTS } from '@/rbac/permissions';
import { SYSTEM_ROLE_DEFAULTS } from '@/rbac/system-roles';

function role(id: string, grants: unknown[], inherits: string[] = []) {
  return { id, name: `CUSTOM_${id}`, permissions: { grants, inherits } };
}

describe('live permissions and current actor conditions', () => {
  beforeEach(() => findById.mockReset());

  it('does not turn a missing department condition into an unconditional grant', async () => {
    findById.mockResolvedValue(role('limited', [{
      action: 'publish', subject: 'LiveBroadcast',
      conditions: { owner_department_id: '$user.department_id' },
    }]));
    const ability = await defineAbilityFor('limited', 'presenter');
    expect(ability.can('publish', 'LiveBroadcast')).toBe(false);
    expect(ability.can('publish', subject('LiveBroadcast', { owner_department_id: 'other' }) as any)).toBe(false);
  });

  it('checks a resolved conditional grant against the actual occurrence record', async () => {
    findById.mockResolvedValue(role('limited', [{
      action: 'publish', subject: 'LiveBroadcast',
      conditions: { owner_department_id: '$user.department_id', presenter_user_id: '$user.id' },
    }]));
    const ability = await defineAbilityFor('limited', 'presenter', 'department-a');
    const occurrence = { owner_department_id: 'department-a', presenter_user_id: 'presenter' };
    expect(ability.can('publish', subject('LiveBroadcast', occurrence) as any)).toBe(true);
    expect(ability.can('publish', subject('LiveBroadcast', { ...occurrence, owner_department_id: 'department-b' }) as any)).toBe(false);
    expect(ability.can('publish', subject('LiveBroadcast', { ...occurrence, presenter_user_id: 'someone-else' }) as any)).toBe(false);
  });

  it('drops unresolved inherited grants while retaining separately granted permissions', async () => {
    const records = {
      child: role('child', [{ action: 'read', subject: 'LiveBroadcast' }], ['parent']),
      parent: role('parent', [{ action: 'manage', subject: 'LiveBroadcast', conditions: { owner_department_id: '$user.department_id' } }]),
    };
    findById.mockImplementation(async (id: keyof typeof records) => records[id]);
    const ability = await defineAbilityFor('child', 'presenter');
    expect(ability.can('read', 'LiveBroadcast')).toBe(true);
    expect(ability.can('manage', 'LiveBroadcast')).toBe(false);
    expect(ability.can('publish', subject('LiveBroadcast', { owner_department_id: 'unassigned' }) as any)).toBe(false);
  });

  it('keeps unrelated unconditional permissions when actor department is absent', async () => {
    findById.mockResolvedValue(role('mixed', [
      { action: 'read', subject: 'Media' },
      { action: 'update', subject: 'Schedule', conditions: { owner_department_id: '$user.department_id' } },
    ]));
    const ability = await defineAbilityFor('mixed', 'presenter');
    expect(ability.can('read', 'Media')).toBe(true);
    expect(ability.can('update', 'Schedule')).toBe(false);
  });

  it('exposes a distinct live permission without granting schedule approval to presenters', () => {
    expect(PERMISSION_SUBJECTS).toContain('LiveBroadcast');
    for (const name of ['DEPARTMENT', 'OPERATOR'] as const) {
      expect(SYSTEM_ROLE_DEFAULTS[name].grants).toContainEqual({ action: 'publish', subject: 'LiveBroadcast' });
      expect(SYSTEM_ROLE_DEFAULTS[name].grants).not.toContainEqual({ action: 'approve', subject: 'LiveBroadcast' });
      expect(SYSTEM_ROLE_DEFAULTS[name].grants).not.toContainEqual({ action: 'approve', subject: 'ScheduleRequest' });
      expect(SYSTEM_ROLE_DEFAULTS[name].grants).not.toContainEqual({ action: 'publish', subject: 'ScheduleRequest' });
    }
  });
});
