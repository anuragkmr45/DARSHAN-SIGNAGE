import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { MetricsOverview } from "../types";

export const metricsApi = {
  getOverview: () =>
    apiClient.request<MetricsOverview>({
      path: endpoints.metrics.overview,
      method: "GET",
    }),
};
