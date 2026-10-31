import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/apiClient";
import { queryKeys } from "@/api/queryKeys";
import { refreshUserManagementQueries, shouldRefreshAfterUserManagementError } from "./userManagementRefresh";

describe("user management rejection refresh", () => {
  it.each([403, 404, 409])("refreshes after a stale or conflicting %i response", (status) => {
    expect(shouldRefreshAfterUserManagementError(new ApiError({ status, message: "Rejected" }))).toBe(true);
  });

  it.each([400, 401, 500])("does not retry a non-stale %i response as a permission refresh", (status) => {
    expect(shouldRefreshAfterUserManagementError(new ApiError({ status, message: "Rejected" }))).toBe(false);
  });

  it("invalidates account rows, invitations, options and the actor authorization query", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    await refreshUserManagementQueries(queryClient);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["users"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["invitations"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["authorization"] });
    expect(invalidate).toHaveBeenCalledTimes(3);
    queryClient.clear();
  });

  it("the users prefix also invalidates identity-keyed management options", async () => {
    const queryClient = new QueryClient();
    const optionsKey = queryKeys.userManagementOptions("actor-a");
    queryClient.setQueryData(optionsKey, { roles: [], departments: [], is_global_user_manager: false });

    await refreshUserManagementQueries(queryClient);

    expect(queryClient.getQueryState(optionsKey)?.isInvalidated).toBe(true);
    queryClient.clear();
  });
});
