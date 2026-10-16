import type { ContentOwnership, LayoutItem, MediaAsset, Role, RoleName, User } from "@/api/types";

type CanFn = (action: string, subject: string) => boolean;

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

const isAdmin = (role?: string | null) => role === "ADMIN";
const isSuperAdmin = (role?: string | null) => role === "SUPER_ADMIN";
export const isAdminLike = (role?: string | null) => isAdmin(role) || isSuperAdmin(role);

export const canAccessModule = (moduleKey: ModuleKey, user: User | null | undefined, can: CanFn) => {
  const role = user?.role;

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
      return (role === "SUPER_ADMIN" || role === "ADMIN" || role === "DEPARTMENT") && can("read", "User");
    case "departments":
      return isAdminLike(role) && can("read", "Department");
    case "users":
      return can("read", "User");
    case "reports":
      return can("read", "Report") || can("read", "AuditLog");
    case "settings":
      return isAdminLike(role) && can("read", "OrgSettings");
    default:
      return false;
  }
};

export const canManageEmergency = (user: User | null | undefined) => isAdminLike(user?.role);

export const canManageBrandingSettings = (
  user: User | null | undefined,
  role: Role | undefined,
  can: CanFn,
) => {
  if (user?.role === "SUPER_ADMIN") return true;
  if (user?.role === "ADMIN") {
    return Boolean(
      role?.permissions?.grants?.some(
        (grant) =>
          grant.subject === "BrandingSettings" &&
          (grant.action === "manage" || grant.action === "update" || grant.action === "read"),
      ),
    );
  }
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

export const canEditSystemRole = (currentRoleName: RoleName | undefined, targetRoleName: string) => {
  if (currentRoleName === "SUPER_ADMIN") return true;
  if (currentRoleName === "ADMIN") {
    return targetRoleName === "DEPARTMENT" || targetRoleName === "OPERATOR";
  }
  return false;
};

export const canViewRoleInSettings = (currentRoleName: RoleName | undefined, targetRoleName: string) => {
  if (currentRoleName === "SUPER_ADMIN") return true;
  if (currentRoleName === "ADMIN") {
    return targetRoleName === "DEPARTMENT" || targetRoleName === "OPERATOR";
  }
  return false;
};

export const canManageUserTarget = (
  actor: User | null | undefined,
  targetRoleName: string | null | undefined,
  targetDepartmentId?: string | null,
) => {
  if (!actor?.role || !targetRoleName) return false;
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role === "ADMIN") return targetRoleName === "DEPARTMENT" || targetRoleName === "OPERATOR";
  if (actor.role === "DEPARTMENT") {
    return targetRoleName === "OPERATOR" && actor.department_id === targetDepartmentId;
  }
  return false;
};

export const canDeleteUserTarget = (
  actor: User | null | undefined,
  targetRoleName: string | null | undefined,
  targetDepartmentId?: string | null,
) =>
  targetRoleName !== "SUPER_ADMIN" &&
  canManageUserTarget(actor, targetRoleName, targetDepartmentId);

export const canReadUserTarget = (
  actor: User | null | undefined,
  targetRoleName: string | null | undefined,
  targetDepartmentId?: string | null,
) => {
  if (!actor?.role || !targetRoleName) return false;
  if (isAdminLike(actor.role)) return true;
  if (actor.role === "DEPARTMENT") {
    return targetRoleName === "OPERATOR" && actor.department_id === targetDepartmentId;
  }
  if (actor.role === "OPERATOR") {
    return targetRoleName === "OPERATOR";
  }
  return false;
};

export const canManageOperatorsModule = (actor: User | null | undefined) =>
  actor?.role === "SUPER_ADMIN" || actor?.role === "ADMIN" || actor?.role === "DEPARTMENT";
