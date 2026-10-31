export type ActorContext = {
  userId: string;
  roleName: string;
  departmentId?: string | null;
};

export const isSameDepartment = (actorDepartmentId?: string | null, targetDepartmentId?: string | null) =>
  Boolean(actorDepartmentId && targetDepartmentId && actorDepartmentId === targetDepartmentId);

/** Account targeting is independent of the actor's display role name. */
export function canManageUserTarget(
  actor: { departmentId?: string | null; globalUserManagement: boolean },
  target: { roleName: string; isSystem: boolean; departmentId?: string | null }
): boolean {
  if (!target.roleName) return false;
  if (actor.globalUserManagement) return true;
  return target.isSystem && target.roleName === 'OPERATOR' &&
    isSameDepartment(actor.departmentId, target.departmentId);
}
