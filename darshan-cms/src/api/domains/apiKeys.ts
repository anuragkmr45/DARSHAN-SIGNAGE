import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { ApiKey, PaginatedResponse } from "../types";

export const apiKeysApi = {
  list: () =>
    apiClient
      .request<PaginatedResponse<ApiKey>>({
        path: endpoints.apiKeys.base,
        method: "GET",
      })
      .then((response) => response.items),

  revoke: (apiKeyId: string) =>
    apiClient.request<void>({
      path: endpoints.apiKeys.revoke(apiKeyId),
      method: "POST",
    }),
};
