import { useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createMongoAbility, subject } from "@casl/ability";
import { authApi } from "@/api/domains/auth";
import { queryKeys } from "@/api/queryKeys";
import { ApiError } from "@/api/apiClient";
import { useAppSelector } from "@/store/hooks";
import { clearLocalAuthState } from "@/store/store";
import { canUseSubjectWidePermission } from "@/lib/access";
import { isDifferentAuthenticatedUser } from "@/lib/authIdentity";

export const useAuthorization = () => {
  const authState = useAppSelector((state) => state.auth);
  const user = authState.user;
  const isAuthed = Boolean(authState.token || user);
  const contextQuery = useQuery({
    queryKey: queryKeys.authorization(user?.id),
    queryFn: authApi.me,
    enabled: isAuthed,
    initialData: user?.authorization ? user : undefined,
    staleTime: 60_000,
    // Cross-tab storage and BroadcastChannel events are the fast path. An
    // unconditional focus refresh is the fail-closed fallback when browsers
    // block both signals or a tab was suspended while the account changed.
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const identityChanged = isDifferentAuthenticatedUser(user?.id, contextQuery.data?.id);
  useEffect(() => {
    if (identityChanged || (contextQuery.error instanceof ApiError && contextQuery.error.status === 401)) {
      clearLocalAuthState();
    }
  }, [contextQuery.error, identityChanged]);

  // Refetched server rules take precedence over the login/persisted snapshot.
  // A failed refresh or different returned identity must not silently fall
  // back to known-stale grants, even for the render before cleanup completes.
  const context = contextQuery.isError || identityChanged
    ? undefined
    : (contextQuery.data?.authorization ?? user?.authorization);
  const rules = useMemo(() => context?.rules ?? [], [context?.rules]);
  const ability = useMemo(() => createMongoAbility(rules), [rules]);

  const can = useCallback(
    (action: string, resource: string) => Boolean(context && (
      resource === "OrgSettings" || resource === "BrandingSettings" || resource === "SsoConfig" ||
      resource === "Dashboard" || resource === "Report" || resource === "AuditLog" || resource === "ProofOfPlay" ||
      resource === "Emergency" || resource === "Backup"
        ? canUseSubjectWidePermission(rules, action, resource)
        : ability.can(action, resource)
    )),
    [ability, context, rules],
  );
  const canRecord = useCallback(
    (action: string, resource: string, record: object) =>
      Boolean(context && ability.can(action, subject(resource, record))),
    [ability, context],
  );

  return {
    can,
    canRecord,
    grants: rules,
    role: undefined,
    isGlobalUserManager: context?.is_global_user_manager === true,
    isLoading: isAuthed && !context && (contextQuery.isLoading || identityChanged),
    isFetching: contextQuery.isFetching,
    isError: isAuthed && (contextQuery.isError || identityChanged),
  };
};
