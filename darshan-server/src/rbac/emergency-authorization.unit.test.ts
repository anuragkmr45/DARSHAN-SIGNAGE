import { AbilityBuilder, createMongoAbility, subject } from '@casl/ability';
import { describe, expect, it } from 'vitest';
import { canUnconditionally, type AppAbility } from '@/rbac';
import {
  authorizedEmergencyScreenIds,
  canAccessEmergencyTarget,
  canUpdateEmergencyScreen,
  isGlobalEmergencyController,
} from '@/rbac/emergency-authorization';

const buildAbility = (configure: (can: (...args: any[]) => void) => void): AppAbility => {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  configure(can as any);
  return build();
};

describe('emergency authorization', () => {
  it('treats manage Emergency as global authority', () => {
    const ability = buildAbility((can) => can('manage', 'Emergency'));
    expect(isGlobalEmergencyController(ability)).toBe(true);
    expect(canAccessEmergencyTarget(ability, { target_all: true }, new Set())).toBe(true);
  });

  it('does not turn conditional Emergency or EmergencyType grants into global authority', () => {
    const ability = buildAbility((can) => {
      can('manage', 'Emergency', { id: 'one-emergency' });
      can('read', 'EmergencyType', { id: 'one-type' });
    });
    expect(ability.can('manage', 'Emergency')).toBe(true); // Subject-type CASL check is not scope-aware.
    expect(isGlobalEmergencyController(ability)).toBe(false);
    expect(canAccessEmergencyTarget(ability, { target_all: true }, new Set())).toBe(false);
    expect(canUnconditionally(ability, 'read', 'EmergencyType')).toBe(false);
  });

  it('evaluates conditional Screen grants against each concrete screen', () => {
    const ability = buildAbility((can) => can('update', 'Screen', { id: 'screen-a' }));
    const screens = [{ id: 'screen-a' }, { id: 'screen-b' }];
    expect(canUpdateEmergencyScreen(ability, screens[0])).toBe(true);
    expect(canUpdateEmergencyScreen(ability, screens[1])).toBe(false);
    expect(authorizedEmergencyScreenIds(ability, screens)).toEqual(['screen-a']);
    expect((ability as any).can('update', subject('Screen', screens[0]))).toBe(true);
  });

  it('allows delegates only direct emergencies wholly inside their screen set', () => {
    const allowed = new Set(['screen-a', 'screen-b']);
    const ability = buildAbility((can) => can('update', 'Screen', { id: { $in: ['screen-a', 'screen-b'] } }));
    expect(canAccessEmergencyTarget(ability, { screen_ids: ['screen-a', 'screen-b'] }, allowed)).toBe(true);
    expect(canAccessEmergencyTarget(ability, { screen_ids: ['screen-a', 'screen-c'] }, allowed)).toBe(false);
    expect(canAccessEmergencyTarget(ability, { screen_ids: ['screen-a'], screen_group_ids: ['group-a'] }, allowed)).toBe(false);
    expect(canAccessEmergencyTarget(ability, { target_all: true }, allowed)).toBe(false);
    expect(canAccessEmergencyTarget(ability, { screen_ids: [] }, allowed)).toBe(false);
  });
});
