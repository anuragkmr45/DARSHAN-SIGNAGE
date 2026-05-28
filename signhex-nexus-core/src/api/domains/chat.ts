import { ApiError, apiClient } from "@/api/apiClient";
import { endpoints } from "@/api/endpoints";
import type {
  ChatBookmark,
  ChatBookmarksListResponse,
  ChatConversationResponse,
  ChatResolveResponse,
  ChatShareLinkResponse,
  ChatInvitePolicy,
  ChatConversationSettings,
  ChatListConversationsResponse,
  ChatListMessagesResponse,
  ChatMarkReadResponse,
  ChatModerationResponse,
  ChatNormalizedError,
  ChatPinResponse,
  ChatPinsListResponse,
  ChatReactionsResponse,
  ChatSendMessageResponse,
  ChatThreadResponse,
  ChatUpdateMessageResponse,
  ChatDeleteMessageResponse,
  ChatConversationType,
} from "@/api/types";

export interface ChatCursorParams {
  afterSeq?: number;
  limit?: number;
}

interface ChatCursorRequestParams extends ChatCursorParams {
  signal?: AbortSignal;
}

export interface CreateChatConversationInput {
  type: Exclude<ChatConversationType, "DM">;
  title?: string;
  topic?: string;
  purpose?: string;
  members?: string[];
  invite_policy?: ChatInvitePolicy;
}

export interface SendChatMessageInput {
  conversationId: string;
  text?: string;
  replyTo?: string | null;
  attachmentMediaIds?: string[];
  alsoToChannel?: boolean;
}

export interface UpdateChatConversationInput {
  title?: string | null;
  topic?: string | null;
  purpose?: string | null;
  invite_policy?: ChatInvitePolicy;
  state?: "ACTIVE" | "ARCHIVED" | "DELETED";
  settings?: ChatConversationSettings;
}

export interface ChatModerationInput {
  userId: string;
  action: "MUTE" | "UNMUTE" | "BAN" | "UNBAN";
  until?: string;
  reason?: string;
}

export interface CreateBookmarkInput {
  type: "LINK" | "FILE" | "MESSAGE";
  label: string;
  emoji?: string;
  url?: string;
  mediaAssetId?: string;
  messageId?: string;
}

const DEFAULT_CURSOR_LIMIT = 50;
const MAX_CURSOR_LIMIT = 100;

const normalizeAfterSeq = (afterSeq?: number) => {
  const parsed = Number(afterSeq);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

export const normalizeCursorParams = (params?: ChatCursorParams) => {
  const parsedLimit = Number(params?.limit);
  const normalizedLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.floor(parsedLimit)
    : DEFAULT_CURSOR_LIMIT;

  return {
    afterSeq: normalizeAfterSeq(params?.afterSeq),
    limit: Math.min(MAX_CURSOR_LIMIT, normalizedLimit),
  };
};

export const normalizeChatError = (error: unknown): ChatNormalizedError => {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      httpStatus: error.status,
      traceId: error.traceId,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
    };
  }

  return {
    message: "Request failed. Please try again.",
  };
};

export const chatApi = {
  createDm: (otherUserId: string) =>
    apiClient.request<ChatConversationResponse>({
      path: endpoints.chat.dm,
      method: "POST",
      body: { otherUserId },
    }),

  createConversation: (payload: CreateChatConversationInput) =>
    apiClient.request<ChatConversationResponse>({
      path: endpoints.chat.conversations,
      method: "POST",
      body: payload,
    }),

  listConversations: () =>
    apiClient.request<ChatListConversationsResponse>({
      path: endpoints.chat.conversations,
      method: "GET",
    }),

  resolveConversation: (conversationId: string) =>
    apiClient.request<ChatResolveResponse>({
      path: endpoints.chat.conversationById(conversationId),
      method: "GET",
    }),

  createShareLink: (conversationId: string) =>
    apiClient.request<ChatShareLinkResponse>({
      path: endpoints.chat.shareLink(conversationId),
      method: "POST",
    }),

  listMessages: (conversationId: string, params?: ChatCursorRequestParams) =>
    apiClient.request<ChatListMessagesResponse>({
      path: endpoints.chat.messages(conversationId),
      method: "GET",
      query: normalizeCursorParams(params),
      signal: params?.signal,
    }),

  listThread: (conversationId: string, parentMessageId: string, params?: ChatCursorRequestParams) =>
    apiClient.request<ChatThreadResponse>({
      path: endpoints.chat.thread(conversationId, parentMessageId),
      method: "GET",
      query: normalizeCursorParams(params),
      signal: params?.signal,
    }),

  sendMessage: ({ conversationId, text, replyTo, attachmentMediaIds, alsoToChannel }: SendChatMessageInput) => {
    const normalizedText = typeof text === "string" ? text.trim() : undefined;
    const normalizedAttachmentIds = (attachmentMediaIds ?? []).filter(Boolean);
    const body: {
      text?: string;
      replyTo?: string;
      attachmentMediaIds: string[];
      alsoToChannel?: boolean;
    } = {
      text: normalizedText || undefined,
      replyTo: replyTo ?? undefined,
      attachmentMediaIds: normalizedAttachmentIds,
    };
    if (replyTo && typeof alsoToChannel === "boolean") {
      body.alsoToChannel = alsoToChannel;
    }
    return apiClient.request<ChatSendMessageResponse>({
      path: endpoints.chat.messages(conversationId),
      method: "POST",
      body,
    });
  },

  editMessage: (messageId: string, text: string) =>
    apiClient.request<ChatUpdateMessageResponse>({
      path: endpoints.chat.messageById(messageId),
      method: "PATCH",
      body: { text },
    }),

  deleteMessage: (messageId: string) =>
    apiClient.request<ChatDeleteMessageResponse>({
      path: endpoints.chat.messageById(messageId),
      method: "DELETE",
    }),

  reactToMessage: (messageId: string, payload: { emoji: string; op: "add" | "remove" }) =>
    apiClient.request<ChatReactionsResponse>({
      path: endpoints.chat.reactions(messageId),
      method: "POST",
      body: payload,
    }),

  pinMessage: (messageId: string) =>
    apiClient.request<ChatPinResponse>({
      path: endpoints.chat.pinMessage(messageId),
      method: "POST",
    }),

  unpinMessage: (messageId: string) =>
    apiClient.request<{ success: boolean }>({
      path: endpoints.chat.unpinMessage(messageId),
      method: "POST",
    }),

  listPins: (conversationId: string) =>
    apiClient.request<ChatPinsListResponse>({
      path: endpoints.chat.listPins(conversationId),
      method: "GET",
    }),

  createBookmark: (conversationId: string, payload: CreateBookmarkInput) =>
    apiClient.request<{ bookmark: ChatBookmark }>({
      path: endpoints.chat.createBookmark(conversationId),
      method: "POST",
      body: payload,
    }),

  listBookmarks: (conversationId: string) =>
    apiClient.request<ChatBookmarksListResponse>({
      path: endpoints.chat.listBookmarks(conversationId),
      method: "GET",
    }),

  deleteBookmark: (bookmarkId: string) =>
    apiClient.request<{ success: boolean }>({
      path: endpoints.chat.deleteBookmark(bookmarkId),
      method: "DELETE",
    }),

  markRead: (conversationId: string, lastReadSeq: number) =>
    apiClient.request<ChatMarkReadResponse>({
      path: endpoints.chat.read(conversationId),
      method: "POST",
      body: { lastReadSeq },
    }),

  inviteMembers: (conversationId: string, userIds: string[]) =>
    apiClient.request<{ success: boolean }>({
      path: endpoints.chat.invite(conversationId),
      method: "POST",
      body: { userIds },
    }),

  removeMember: (conversationId: string, userId: string) =>
    apiClient.request<{ success: boolean }>({
      path: endpoints.chat.removeMember(conversationId),
      method: "POST",
      body: { userId },
    }),

  updateConversation: (conversationId: string, payload: UpdateChatConversationInput) =>
    apiClient.request<ChatConversationResponse>({
      path: endpoints.chat.updateConversation(conversationId),
      method: "PATCH",
      body: payload,
    }),

  patchConversationSettings: (conversationId: string, settings: ChatConversationSettings) =>
    apiClient.request<ChatConversationResponse>({
      path: endpoints.chat.updateConversation(conversationId),
      method: "PATCH",
      body: { settings },
    }),

  archiveConversation: (conversationId: string) =>
    apiClient.request<ChatConversationResponse>({
      path: endpoints.chat.archiveConversation(conversationId),
      method: "POST",
    }),

  unarchiveConversation: (conversationId: string) =>
    apiClient.request<ChatConversationResponse>({
      path: endpoints.chat.unarchiveConversation(conversationId),
      method: "POST",
    }),

  deleteConversation: (conversationId: string) =>
    apiClient.request<{ success: boolean; conversationId?: string }>({
      path: endpoints.chat.deleteConversation(conversationId),
      method: "DELETE",
    }),

  moderateConversation: (conversationId: string, payload: ChatModerationInput) =>
    apiClient.request<ChatModerationResponse>({
      path: endpoints.chat.moderateConversation(conversationId),
      method: "POST",
      body: payload,
    }),
};
