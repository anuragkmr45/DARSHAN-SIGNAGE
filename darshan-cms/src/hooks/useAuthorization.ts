import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/apiClient";
import { canWithCapabilities, getSelfAuthorization } from "@/api/domains/selfAuthorization";
import { queryKeys } from "@/api/queryKeys";
import { useAppSelector } from "@/store/hooks";

export const useAuthorization = () => {
  const authState = useAppSelector((state) => state.auth);
  const userId = authState.user?.id, generation = apiClient.getSessionGeneration();
  const isAuthed = Boolean(userId && (authState.token || authState.user));
  const authorization = useQuery({
    queryKey: queryKeys.selfAuthorization(userId, generation),
    queryFn: ({ signal }) => getSelfAuthorization(userId!, signal),
    enabled: isAuthed, retry: false, staleTime: 30_000, refetchOnWindowFocus: true,
  });
  const current = isAuthed && !authorization.isError && authorization.data?.user_id === userId ? authorization.data : undefined;
  const capabilities = useMemo(() => current?.capabilities ?? [], [current]);
  const can = useCallback(
    (action: string, subject: string) => canWithCapabilities(capabilities, action, subject),
    [capabilities],
  );
  return {
    can, capabilities, role: current?.role,
    isLoading: authorization.isLoading,
    isFetching: authorization.isFetching,
    isError: authorization.isError,
  };
};
