import { createMongoAbility } from "@casl/ability";
import type { AuthorizationRule, ContentOwnership, LayoutItem, MediaAsset, Role, User } from "@/api/types";

type CanFn = (action: string, subject: string) => boolean;
type CanRecordFn = (action: string, subject: string, record: object) => boolean;

/** Subject-wide settings, aggregates, and unfiltered collections have no one record for condition evaluation. */
export const canUseSubjectWidePermission = (
  rules: AuthorizationRule[],
  action: string,
  resource: "OrgSettings" | "BrandingSettings" | "SsoConfig" | "Dashboard" | "Report" | "AuditLog" | "ProofOfPlay" | "Emergency" | "Backup",
) => createMongoAbility(rules.filter((rule) =>
  !rule.conditions || Object.keys(rule.conditions).length === 0,
)).can(action, resource);

export const canStartScreenRecovery = <T extends object & { id: string }>(
  canRecord: CanRecordFn,
  screen: T,
) => canRecord("update", "Screen", screen) && canRecord(
  "create",
  "DevicePairing",
  { device_id: screen.id, screen_id: screen.id },
);

export const canConfirmScreenPairing = (
  canRecord: CanRecordFn,
  proposedScreen: object,
  currentScreen?: object & { id: string } | null,
) => currentScreen
  ? canRecord("update", "Screen", currentScreen) && canRecord("update", "Screen", proposedScreen)
  : canRecord("create", "Screen", proposedScreen);


export type ModuleKey =
  | "dashboard"
  | "media"
  | "layouts"
  | "screens"
  | "schedule"
  | "conversations"
  | "notifications"
  | "operators"
  | "departments"
  | "users"
  | "reports"
  | "settings";

export const canAccessModule = (moduleKey: ModuleKey, _user: User | null | undefined, can: CanFn) => {
  switch (moduleKey) {
    case "dashboard":
      return can("read", "Dashboard");
    case "media":
      return can("read", "Media");
    case "layouts":
      return can("read", "Layout");
    case "screens":
      return can("read", "Screen") || can("read", "ScreenGroup");
    case "schedule":
      return can("read", "Schedule") || can("read", "ScheduleRequest");
    case "conversations":
      return can("read", "Conversation");
    case "notifications":
      return can("read", "Notification");
    case "operators":
      return can("read", "User");
    case "departments":
      return can("read", "Department");
    case "users":
      return can("read", "User");
    case "reports":
      return can("read", "Report") || can("read", "AuditLog");
    case "settings":
      return can("read", "OrgSettings") || can("read", "BrandingSettings") || can("read", "Role") ||
        can("read", "Backup");
    default:
      return false;
  }
};

const MODULE_FALLBACKS: Array<[ModuleKey, string]> = [
  ["dashboard", "/dashboard"], ["screens", "/screens"], ["schedule", "/schedule"],
  ["media", "/media"], ["layouts", "/layouts"], ["conversations", "/chat"],
  ["notifications", "/notifications"], ["operators", "/operators"],
  ["departments", "/departments"], ["users", "/users"], ["reports", "/reports"],
  ["settings", "/settings"],
];

export const getFirstAccessibleModulePath = (user: User | null | undefined, can: CanFn) =>
  MODULE_FALLBACKS.find(([moduleKey]) => canAccessModule(moduleKey, user, can))?.[1] ?? "/dashboard";

export const canManageBrandingSettings = (
  _user: User | null | undefined,
  _role: Role | undefined,
  can: CanFn,
) => {
  return can("manage", "BrandingSettings") || can("update", "BrandingSettings");
};

export const canManageLayoutRecord = (
  _user: User | null | undefined,
  layout: Pick<LayoutItem, "created_by" | "permissions">,
) => layout.permissions?.can_update === true;

export const canDeleteLayoutRecord = (
  _user: User | null | undefined,
  layout: Pick<LayoutItem, "created_by" | "permissions">,
) => layout.permissions?.can_delete === true;

export const canDeleteMediaRecord = (
  _user: User | null | undefined,
  media: Pick<MediaAsset, "created_by" | "permissions">,
) => media.permissions?.can_delete === true;

export const getContentOwnershipLabel = (
  resource: { ownership?: ContentOwnership },
) => {
  if (resource.ownership?.scope === "ORGANIZATION") return "Organization owned";
  if (resource.ownership?.scope === "DEPARTMENT") {
    return resource.ownership.department_name
      ? `${resource.ownership.department_name} owned`
      : "Department owned";
  }
  return resource.ownership ? "Restricted" : null;
};

export const getContentCreatorLabel = (
  resource: { ownership?: ContentOwnership },
) => {
  const creator = resource.ownership?.creator;
  if (!creator || creator.status === "ACTIVE") return null;
  if (creator.status === "UNKNOWN") return "Creator unknown";
  const status = creator.status === "DELETED" ? "Deleted" : "Inactive";
  return `Created by ${creator.display_name} (${status})`;
};
