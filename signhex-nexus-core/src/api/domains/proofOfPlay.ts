import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { ProofOfPlay, ProofOfPlayFilters, ProofOfPlayListResponse } from "../types";

const normalizeProofOfPlay = (item: Record<string, unknown>): ProofOfPlay => {
  const startedAt = typeof item.started_at === "string" ? item.started_at : null;
  const endedAt = typeof item.ended_at === "string" ? item.ended_at : null;
  const createdAt = typeof item.created_at === "string" ? item.created_at : undefined;

  return {
    id: String(item.id ?? ""),
    screen_id: String(item.screen_id ?? ""),
    media_id: String(item.media_id ?? ""),
    schedule_id: typeof item.schedule_id === "string" ? item.schedule_id : undefined,
    presentation_id: typeof item.presentation_id === "string" ? item.presentation_id : undefined,
    status: endedAt ? "COMPLETED" : "INCOMPLETE",
    played_at: startedAt || createdAt || new Date(0).toISOString(),
    started_at: startedAt,
    ended_at: endedAt,
    created_at: createdAt,
    url: typeof item.url === "string" ? item.url : null,
  };
};

export const proofOfPlayApi = {
  list: async (filters?: ProofOfPlayFilters) => {
    const response = await apiClient.request<{
      items: Record<string, unknown>[];
      pagination: ProofOfPlayListResponse["pagination"];
    }>({
      path: endpoints.proofOfPlay.base,
      method: "GET",
      query: filters,
    });

    return {
      items: response.items.map(normalizeProofOfPlay),
      pagination: response.pagination,
    } satisfies ProofOfPlayListResponse;
  },

  export: (filters?: ProofOfPlayFilters) =>
    apiClient.request<string>({
      path: endpoints.proofOfPlay.export,
      method: "GET",
      query: filters,
      headers: { Accept: "text/csv" },
      responseType: "text",
    }),
};
