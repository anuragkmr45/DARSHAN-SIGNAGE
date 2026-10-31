import { subject } from '@casl/ability';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@/db';
import type { AppAbility, Action } from '@/rbac';

export type ScreenAccessRecord = { id?: string; [key: string]: unknown };
export type ScreenGroupAccessRecord = { id?: string; [key: string]: unknown };

export function canAccessScreen(
  ability: AppAbility,
  action: Action,
  screen: ScreenAccessRecord
): boolean {
  return (ability as any).can(action, subject('Screen', screen));
}

/**
 * Operators who can update a selected screen must be able to see the record
 * needed to perform that update, even when a custom role omitted a separate
 * read grant. This does not grant access to any other screen.
 */
export function canObserveScreen(ability: AppAbility, screen: ScreenAccessRecord): boolean {
  return canAccessScreen(ability, 'read', screen) || canAccessScreen(ability, 'update', screen);
}

/**
 * Starting credential recovery invalidates any older active recovery code, so
 * it requires authority over both the concrete Screen and its pairing record.
 */
export function canStartScreenRecovery(
  ability: AppAbility,
  screen: ScreenAccessRecord & { id: string }
): boolean {
  return canAccessScreen(ability, 'update', screen) && (ability as any).can(
    'create',
    subject('DevicePairing', { device_id: screen.id, screen_id: screen.id })
  );
}

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isDevicePairingReadRule = (rule: AppAbility['rules'][number]) => {
  if (rule.inverted) return false;
  const actions = Array.isArray(rule.action) ? rule.action : [rule.action];
  const subjects = Array.isArray(rule.subject) ? rule.subject : [rule.subject];
  return actions.some((action) => action === 'read' || action === 'manage') &&
    subjects.some((item) => item === 'DevicePairing' || item === 'all');
};

const supportedDevicePairingConditions = (conditions: Record<string, unknown> | undefined) => {
  if (conditions === undefined) return true;
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) return false;
  return Object.entries(conditions).every(([key, value]) => {
    if (typeof value !== 'string') return false;
    if (key === 'id' || key === 'device_id' || key === 'screen_id') return canonicalUuid.test(value);
    return key === 'pairing_code' || key === 'aspect_ratio' || key === 'orientation' || key === 'model';
  });
};

export function hasDevicePairingReadGrant(ability: AppAbility): boolean {
  return ability.rules.some((rule) => isDevicePairingReadRule(rule) &&
    supportedDevicePairingConditions(rule.conditions as Record<string, unknown> | undefined));
}

/**
 * Translate supported DevicePairing equality conditions into SQL so rows and
 * totals are scoped before pagination. `screen_id` is the policy-facing alias
 * for the stored `device_id` used by recovery and revoke checks.
 */
export function devicePairingReadCondition(ability: AppAbility): SQL {
  const permitted: SQL[] = [];

  for (const rule of ability.rules) {
    if (!isDevicePairingReadRule(rule)) continue;

    const conditions = rule.conditions as Record<string, unknown> | undefined;
    if (conditions === undefined || Object.keys(conditions).length === 0) return sql`true`;
    if (!supportedDevicePairingConditions(conditions)) continue;

    const parts: SQL[] = [];
    let supported = true;
    for (const [key, value] of Object.entries(conditions)) {
      if (typeof value !== 'string') {
        supported = false;
        break;
      }
      if (key === 'id') {
        if (!canonicalUuid.test(value)) {
          supported = false;
          break;
        }
        parts.push(eq(schema.devicePairings.id, value));
      } else if (key === 'device_id' || key === 'screen_id') {
        if (!canonicalUuid.test(value)) {
          supported = false;
          break;
        }
        parts.push(eq(schema.devicePairings.device_id, value));
      } else if (key === 'pairing_code' || key === 'aspect_ratio' || key === 'orientation' || key === 'model') {
        parts.push(eq(schema.devicePairings[key], value));
      } else {
        supported = false;
        break;
      }
    }
    if (supported && parts.length > 0) permitted.push(and(...parts)!);
  }

  return permitted.length > 0 ? or(...permitted)! : sql`false`;
}

export function observableScreenIds(
  ability: AppAbility,
  screens: Array<ScreenAccessRecord & { id: string }>
): string[] {
  return screens.filter((screen) => canObserveScreen(ability, screen)).map((screen) => screen.id);
}

export function canAccessScreenGroup(
  ability: AppAbility,
  action: Action,
  group: ScreenGroupAccessRecord
): boolean {
  return (ability as any).can(action, subject('ScreenGroup', group));
}

export function canObserveScreenGroup(
  ability: AppAbility,
  group: ScreenGroupAccessRecord
): boolean {
  return canAccessScreenGroup(ability, 'read', group) || canAccessScreenGroup(ability, 'update', group);
}

export function observableScreenGroupIds(
  ability: AppAbility,
  groups: Array<ScreenGroupAccessRecord & { id: string }>
): string[] {
  return groups.filter((group) => canObserveScreenGroup(ability, group)).map((group) => group.id);
}
