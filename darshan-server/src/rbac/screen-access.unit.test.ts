import { createMongoAbility } from '@casl/ability';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppAbility } from '@/rbac';
import {
  canAccessScreen,
  canAccessScreenGroup,
  canObserveScreen,
  canStartScreenRecovery,
  devicePairingReadCondition,
  hasDevicePairingReadGrant,
  observableScreenGroupIds,
  observableScreenIds,
} from '@/rbac/screen-access';

const abilityFor = (rules: any[]) => createMongoAbility(rules) as AppAbility;
const pairingQueryFor = (rules: any[]) => new PgDialect().sqlToQuery(
  devicePairingReadCondition(abilityFor(rules)),
);

describe('record-specific screen authorization', () => {
  it('limits conditional screen grants to matching records', () => {
    const ability = abilityFor([
      { action: 'read', subject: 'Screen', conditions: { id: 'screen-a' } },
      { action: 'update', subject: 'Screen', conditions: { id: 'screen-b' } },
    ]);

    expect(observableScreenIds(ability, [{ id: 'screen-a' }, { id: 'screen-b' }, { id: 'screen-c' }]))
      .toEqual(['screen-a', 'screen-b']);
    expect(canAccessScreen(ability, 'update', { id: 'screen-a' })).toBe(false);
    expect(canAccessScreen(ability, 'update', { id: 'screen-b' })).toBe(true);
  });

  it('lets an update-only delegate observe only the screen they can manage', () => {
    const ability = abilityFor([
      { action: 'update', subject: 'Screen', conditions: { id: 'screen-a' } },
    ]);

    expect(canObserveScreen(ability, { id: 'screen-a' })).toBe(true);
    expect(canObserveScreen(ability, { id: 'screen-b' })).toBe(false);
  });

  it('evaluates screen-group conditions against each concrete group', () => {
    const ability = abilityFor([
      { action: 'read', subject: 'ScreenGroup', conditions: { id: 'group-a' } },
    ]);

    expect(observableScreenGroupIds(ability, [{ id: 'group-a' }, { id: 'group-b' }]))
      .toEqual(['group-a']);
    expect(canAccessScreenGroup(ability, 'read', { id: 'group-b' })).toBe(false);
  });

  it('does not turn a conditional grant into subject-wide access', () => {
    const ability = abilityFor([
      { action: 'read', subject: 'Screen', conditions: { status: 'ACTIVE' } },
    ]);

    expect(canObserveScreen(ability, { id: 'active', status: 'ACTIVE' })).toBe(true);
    expect(canObserveScreen(ability, { id: 'offline', status: 'OFFLINE' })).toBe(false);
  });

  it('requires matching Screen and DevicePairing grants to start recovery', () => {
    const completeAbility = abilityFor([
      { action: 'update', subject: 'Screen', conditions: { id: 'screen-a' } },
      { action: 'create', subject: 'DevicePairing', conditions: { screen_id: 'screen-a' } },
    ]);
    const pairingOnlyAbility = abilityFor([
      { action: 'create', subject: 'DevicePairing', conditions: { screen_id: 'screen-a' } },
    ]);
    const wrongPairingAbility = abilityFor([
      { action: 'update', subject: 'Screen', conditions: { id: 'screen-a' } },
      { action: 'create', subject: 'DevicePairing', conditions: { screen_id: 'screen-b' } },
    ]);

    expect(canStartScreenRecovery(completeAbility, { id: 'screen-a' })).toBe(true);
    expect(canStartScreenRecovery(completeAbility, { id: 'screen-b' })).toBe(false);
    expect(canStartScreenRecovery(pairingOnlyAbility, { id: 'screen-a' })).toBe(false);
    expect(canStartScreenRecovery(wrongPairingAbility, { id: 'screen-a' })).toBe(false);
  });

  it('maps record-scoped pairing screen IDs to device IDs before pagination', () => {
    const screenId = '11111111-1111-4111-8111-111111111111';
    const query = pairingQueryFor([
      { action: 'read', subject: 'DevicePairing', conditions: { screen_id: screenId } },
    ]);

    expect(query.sql).toContain('"device_id"');
    expect(query.params).toEqual([screenId]);
  });

  it('keeps separate pairing grants and fails closed for unsupported conditions', () => {
    const pairingId = '11111111-1111-4111-8111-111111111111';
    const deviceId = '22222222-2222-4222-8222-222222222222';
    const query = pairingQueryFor([
      { action: 'read', subject: 'DevicePairing', conditions: { id: pairingId } },
      { action: 'manage', subject: 'DevicePairing', conditions: { device_id: deviceId } },
    ]);
    expect(query.sql).toContain(' or ');
    expect(query.params).toEqual([pairingId, deviceId]);
    expect(pairingQueryFor([
      { action: 'read', subject: 'DevicePairing', conditions: { screen_id: 'not-a-uuid' } },
    ]).sql).toContain('false');
    expect(pairingQueryFor([
      { action: 'read', subject: 'DevicePairing', conditions: { secret: 'hidden' } },
    ]).sql).toContain('false');
    expect(hasDevicePairingReadGrant(abilityFor([
      { action: 'read', subject: 'DevicePairing', conditions: { screen_id: deviceId } },
    ]))).toBe(true);
    expect(hasDevicePairingReadGrant(abilityFor([
      { action: 'read', subject: 'DevicePairing', conditions: { secret: 'hidden' } },
    ]))).toBe(false);
    expect(hasDevicePairingReadGrant(abilityFor([]))).toBe(false);
  });

  it('keeps unconditional pairing read and manage-all grants unrestricted', () => {
    expect(pairingQueryFor([{ action: 'read', subject: 'DevicePairing' }]).sql).toContain('true');
    expect(pairingQueryFor([{ action: 'manage', subject: 'all' }]).sql).toContain('true');
  });
});
