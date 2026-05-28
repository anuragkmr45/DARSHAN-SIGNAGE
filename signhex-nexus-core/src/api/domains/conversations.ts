import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { Conversation, ConversationMessage, PaginationParams, PaginatedResponse } from "../types";

export const conversationsApi = {
  start: (participant_id: string) =>
    apiClient.request<Conversation>({
      path: endpoints.conversations.base,
      method: "POST",
      body: { participant_id },
    }),

  list: () =>
    apiClient.request<Conversation[]>({
      path: endpoints.conversations.base,
      method: "GET",
    }),

  listMessages: (conversationId: string, params?: PaginationParams) =>
    apiClient.request<PaginatedResponse<ConversationMessage>>({
      path: endpoints.conversations.messages(conversationId),
      method: "GET",
      query: params,
    }),

  sendMessage: (
    conversationId: string,
    payload: { content: string; attachments?: string[] },
  ) =>
    apiClient.request<ConversationMessage>({
      path: endpoints.conversations.messages(conversationId),
      method: "POST",
      body: payload,
    }),

  markRead: (conversationId: string) =>
    apiClient.request<void>({
      path: endpoints.conversations.markRead(conversationId),
      method: "POST",
    }),
};
