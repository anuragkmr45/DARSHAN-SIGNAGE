import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { ApiKey, PaginatedResponse } from "../types";

export interface CreateApiKeyPayload {
  name: string;
  scopes?: string[];
  roles?: string[];
  expires_at?: string | null;
}

export const apiKeysApi = {
  create: (payload: CreateApiKeyPayload) =>
    apiClient.request<ApiKey>({
      path: endpoints.apiKeys.base,
      method: "POST",
      body: payload,
    }),

  list: () =>
    apiClient
      .request<PaginatedResponse<ApiKey>>({
        path: endpoints.apiKeys.base,
        method: "GET",
      })
      .then((response) => response.items),

  rotate: (apiKeyId: string) =>
    apiClient.request<ApiKey>({
      path: endpoints.apiKeys.rotate(apiKeyId),
      method: "POST",
    }),

  revoke: (apiKeyId: string) =>
    apiClient.request<void>({
      path: endpoints.apiKeys.revoke(apiKeyId),
      method: "POST",
    }),
};
