import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { HealthStatus } from "../types";

export const healthApi = {
  get: () =>
    apiClient.request<HealthStatus>({
      path: endpoints.health.base,
      method: "GET",
    }),
};
