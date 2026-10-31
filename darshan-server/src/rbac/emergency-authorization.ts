import { subject } from '@casl/ability';
import { canUnconditionally, type AppAbility } from '@/rbac';

export type EmergencyScreenRecord = { id: string; [key: string]: unknown };
export type EmergencyTargetRecord = {
  target_all?: boolean | null;
  screen_ids?: string[] | null;
  screen_group_ids?: string[] | null;
};

export function isGlobalEmergencyController(ability: AppAbility): boolean {
  return canUnconditionally(ability, 'manage', 'Emergency');
}

export function canUpdateEmergencyScreen(
  ability: AppAbility,
  screen: EmergencyScreenRecord
): boolean {
  return (ability as any).can('update', subject('Screen', screen));
}

export function authorizedEmergencyScreenIds(
  ability: AppAbility,
  screens: EmergencyScreenRecord[]
): string[] {
  return screens.filter((screen) => canUpdateEmergencyScreen(ability, screen)).map((screen) => screen.id);
}

export function canAccessEmergencyTarget(
  ability: AppAbility,
  emergency: EmergencyTargetRecord,
  allowedScreenIds: ReadonlySet<string>
): boolean {
  if (isGlobalEmergencyController(ability)) return true;
  const screenIds = emergency.screen_ids ?? [];
  const groupIds = emergency.screen_group_ids ?? [];
  return emergency.target_all !== true &&
    groupIds.length === 0 &&
    screenIds.length > 0 &&
    screenIds.every((screenId) => allowedScreenIds.has(screenId));
}
