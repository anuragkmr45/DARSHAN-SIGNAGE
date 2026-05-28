import type { Role, RolePermissionGrant, RoleId } from "@/api/types";

const grantKey = (grant: RolePermissionGrant) => `${grant.action}::${grant.subject}`;

export const isSystemAdminRoleName = (roleName: string | null | undefined) =>
  roleName === "ADMIN" || roleName === "SUPER_ADMIN";

export const resolveEffectiveGrants = (roleId: RoleId | undefined, roles: Role[]) => {
  if (!roleId || roles.length === 0) return [] as RolePermissionGrant[];
  const roleMap = new Map<RoleId, Role>();
  roles.forEach((role) => roleMap.set(role.id, role));

  const visited = new Set<RoleId>();
  const stack: RoleId[] = [roleId];
  const grants: RolePermissionGrant[] = [];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);

    const role = roleMap.get(currentId);
    if (!role?.permissions) continue;

    if (Array.isArray(role.permissions.grants)) {
      grants.push(...role.permissions.grants);
    }
    if (Array.isArray(role.permissions.inherits)) {
      role.permissions.inherits.forEach((inheritedId) => {
        if (!visited.has(inheritedId)) stack.push(inheritedId);
      });
    }
  }

  const unique = new Map<string, RolePermissionGrant>();
  grants.forEach((grant) => {
    unique.set(grantKey(grant), grant);
  });

  return Array.from(unique.values());
};

export const canWithGrants = (
  grants: RolePermissionGrant[],
  action: string,
  subject: string,
) => {
  if (!action || !subject) return false;
  return grants.some((grant) => {
    const actionMatch =
      grant.action === action ||
      grant.action === "*" ||
      grant.action === "manage";

    const subjectMatch =
      grant.subject === subject ||
      grant.subject === "*" ||
      grant.subject === "all";

    return actionMatch && subjectMatch;
  });
};
