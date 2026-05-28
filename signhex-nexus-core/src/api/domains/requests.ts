import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { PaginatedResponse, PaginationParams, RequestTicket } from "../types";

export interface RequestPayload {
  title: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigned_to?: string;
}

export const requestsApi = {
  create: (payload: RequestPayload) =>
    apiClient.request<RequestTicket>({
      path: endpoints.requests.base,
      method: "POST",
      body: payload,
    }),

  list: (params?: PaginationParams & { status?: string }) =>
    apiClient.request<PaginatedResponse<RequestTicket>>({
      path: endpoints.requests.base,
      method: "GET",
      query: params,
    }),

  update: (id: string, payload: Partial<RequestPayload>) =>
    apiClient.request<RequestTicket>({
      path: endpoints.requests.byId(id),
      method: "PATCH",
      body: payload,
    }),

  listMessages: (id: string, params?: PaginationParams) =>
    apiClient.request<PaginatedResponse<{ id: string; message: string; created_at: string }>>({
      path: endpoints.requests.messages(id),
      method: "GET",
      query: params,
    }),

  sendMessage: (id: string, payload: { message: string; attachments?: string[] }) =>
    apiClient.request<{ id: string }>({
      path: endpoints.requests.messages(id),
      method: "POST",
      body: payload,
    }),
};
