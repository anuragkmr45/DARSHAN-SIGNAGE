import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/apiClient";
import { queryKeys } from "@/api/queryKeys";

export const shouldRefreshAfterUserManagementError = (error: unknown): boolean =>
  error instanceof ApiError && [403, 404, 409].includes(error.status);

/** Refresh both visible targets and the actor's server-resolved permissions. */
export async function refreshUserManagementQueries(queryClient: QueryClient): Promise<void> {
  // A successful server mutation must not be reported as failed merely because
  // one follow-up refresh encounters a transient error or a revoked session.
  await Promise.allSettled([
    queryClient.invalidateQueries({ queryKey: queryKeys.users }),
    queryClient.invalidateQueries({ queryKey: ["invitations"] }),
    queryClient.invalidateQueries({ queryKey: ["authorization"] }),
  ]);
}
