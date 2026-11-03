import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { CreateLiveSessionPayload, LiveSession, LiveSessionListResponse, PaginationParams, UpdateLiveSessionPayload } from "../types";

export const liveSessionsApi = {
  list: (params?: PaginationParams & { search?: string; active_only?: boolean }) =>
    apiClient.request<LiveSessionListResponse>({ path: endpoints.liveSessions.base, method: "GET", query: params }),
  getById: (id: string) => apiClient.request<LiveSession>({ path: endpoints.liveSessions.byId(id), method: "GET" }),
  create: (payload: CreateLiveSessionPayload) =>
    apiClient.request<LiveSession>({ path: endpoints.liveSessions.base, method: "POST", body: payload }),
  update: (id: string, payload: UpdateLiveSessionPayload) =>
    apiClient.request<LiveSession>({ path: endpoints.liveSessions.byId(id), method: "PATCH", body: payload }),
  remove: (id: string, expectedRevision: number) =>
    apiClient.request<{ id: string; revision: number; deleted: true }>({ path: endpoints.liveSessions.byId(id), method: "DELETE",
      body: { expected_revision: expectedRevision } }),
};
