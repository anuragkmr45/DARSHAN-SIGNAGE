import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { PaginatedResponse, Webhook } from "../types";

export interface CreateWebhookPayload {
  name: string;
  event_types: string[];
  target_url: string;
  headers?: Record<string, string>;
  is_active?: boolean;
}

export const webhooksApi = {
  create: (payload: CreateWebhookPayload) =>
    apiClient.request<Webhook>({
      path: endpoints.webhooks.base,
      method: "POST",
      body: payload,
    }),

  list: () =>
    apiClient
      .request<{ items: Webhook[] } | PaginatedResponse<Webhook>>({
        path: endpoints.webhooks.base,
        method: "GET",
      })
      .then((response) => response.items),

  update: (webhookId: string, payload: Partial<CreateWebhookPayload>) =>
    apiClient.request<Webhook>({
      path: endpoints.webhooks.byId(webhookId),
      method: "PATCH",
      body: payload,
    }),

  remove: (webhookId: string) =>
    apiClient.request<void>({
      path: endpoints.webhooks.byId(webhookId),
      method: "DELETE",
    }),

  test: (webhookId: string) =>
    apiClient.request<{
      success: boolean;
      attempted: string;
      status_code: number;
      sent_at: string;
    }>({
      path: endpoints.webhooks.test(webhookId),
      method: "POST",
    }),
};
