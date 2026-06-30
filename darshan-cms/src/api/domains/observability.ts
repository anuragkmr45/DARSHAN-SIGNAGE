import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type {
  ObservabilityOverview,
  ScreenObservabilitySummary,
} from "../types";

export const observabilityApi = {
  getOverview: () =>
    apiClient.request<ObservabilityOverview>({
      path: endpoints.observability.overview,
      method: "GET",
    }),

  getScreen: (screenId: string) =>
    apiClient.request<ScreenObservabilitySummary>({
      path: endpoints.observability.screen(screenId),
      method: "GET",
    }),
};
