export type UserMutationAction = "create" | "update";
export type CanRecord = (action: string, resource: string, record: object) => boolean;

type ManagementDepartmentOption = { id: string };

/**
 * Validate the selected department against the latest minimal management
 * options. Global managers may deliberately leave an account unassigned, but
 * they must not submit an arbitrary or stale department identifier. Scoped
 * managers must use the one department returned by the server.
 */
export function isManagementDepartmentSelectionValid(
  isGlobalUserManager: boolean,
  departmentId: string | null | undefined,
  departments: ManagementDepartmentOption[],
): boolean {
  const selectedDepartmentId = departmentId?.trim() ?? "";
  if (!selectedDepartmentId) return isGlobalUserManager;
  return departments.some((department) => department.id === selectedDepartmentId);
}

/**
 * Create checks the proposed account. Update checks both the record that was
 * opened and the proposed result, matching the server's anti-scope-escape
 * contract. Missing current context fails closed.
 */
export function canSubmitUserMutation(
  canRecord: CanRecord,
  action: UserMutationAction,
  current: object | null,
  proposed: object,
): boolean {
  if (action === "create") return canRecord("create", "User", proposed);
  return current !== null &&
    canRecord("update", "User", current) &&
    canRecord("update", "User", proposed);
}
