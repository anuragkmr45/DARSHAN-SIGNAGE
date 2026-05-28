import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { SsoConfig } from "../types";

export interface UpsertSsoPayload
  extends Omit<SsoConfig, "id" | "is_active"> {
  is_active?: boolean;
}

export const ssoApi = {
  upsert: (payload: UpsertSsoPayload) =>
    apiClient.request<SsoConfig>({
      path: endpoints.ssoConfig.base,
      method: "POST",
      body: payload,
    }),

  getActive: () =>
    apiClient
      .request<{ items: SsoConfig[] }>({
        path: endpoints.ssoConfig.base,
        method: "GET",
      })
      .then((response) => response.items[0] ?? null),

  deactivate: (id: string) =>
    apiClient.request<void>({
      path: endpoints.ssoConfig.deactivate(id),
      method: "POST",
    }),
};
