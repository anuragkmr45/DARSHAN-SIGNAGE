import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { rolesApi } from "@/api/domains/roles";
import { queryKeys } from "@/api/queryKeys";
import { useAppSelector } from "@/store/hooks";
import { canWithGrants, isSystemAdminRoleName, resolveEffectiveGrants } from "@/lib/authorization";

const DEFAULT_ROLE_LIST = { page: 1, limit: 100 };

export const useAuthorization = () => {
  const authState = useAppSelector((state) => state.auth);
  const roleId = authState.user?.role_id;
  const roleName = authState.user?.role;
  const isAuthed = Boolean(authState.token || authState.user);

  const rolesQuery = useQuery({
    queryKey: queryKeys.roles(DEFAULT_ROLE_LIST),
    queryFn: () => rolesApi.list(DEFAULT_ROLE_LIST),
    enabled: isAuthed,
    staleTime: 60_000,
  });

  const roles = useMemo(() => rolesQuery.data?.items ?? [], [rolesQuery.data?.items]);
  const resolvedRoleId = useMemo(() => {
    if (roleId) return roleId;
    if (!roleName) return undefined;
    return roles.find((role) => role.name === roleName)?.id;
  }, [roleId, roleName, roles]);

  const effectiveGrants = useMemo(
    () => resolveEffectiveGrants(resolvedRoleId, roles),
    [resolvedRoleId, roles],
  );

  const can = useCallback(
    (action: string, subject: string) => canWithGrants(effectiveGrants, action, subject),
    [effectiveGrants],
  );

  const isAdminOrSuperAdmin = useMemo(
    () => isSystemAdminRoleName(roleName) || canWithGrants(effectiveGrants, "manage", "all"),
    [effectiveGrants, roleName],
  );

  const currentRole = useMemo(
    () => roles.find((role) => role.id === resolvedRoleId),
    [roles, resolvedRoleId],
  );

  return {
    can,
    isAdminOrSuperAdmin,
    grants: effectiveGrants,
    role: currentRole,
    isLoading: rolesQuery.isLoading,
    isFetching: rolesQuery.isFetching,
    isError: rolesQuery.isError,
  };
};
