import type { InfiniteData } from "@tanstack/react-query";
import type {
  ChatListMessagesResponse,
  ChatMessage,
  ChatThreadResponse,
} from "@/api/types";

export const DEFAULT_CURSOR_LIMIT = 50;
export const MAX_CURSOR_LIMIT = 100;

const toTime = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const compareChatMessages = (a: ChatMessage, b: ChatMessage) => {
  if (a.seq !== b.seq) return a.seq - b.seq;

  const aTime = toTime(a.created_at);
  const bTime = toTime(b.created_at);
  if (aTime !== bTime) return aTime - bTime;

  return a.id.localeCompare(b.id);
};

export const clampChatCursorLimit = (limit?: number) => {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CURSOR_LIMIT;
  return Math.min(MAX_CURSOR_LIMIT, Math.floor(parsed));
};

export const normalizeAfterSeq = (afterSeq?: number) => {
  const parsed = Number(afterSeq);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

export const mergeChatMessages = (existing: ChatMessage[], incoming: ChatMessage[]) => {
  const byId = new Map<string, ChatMessage>();

  existing.forEach((message) => {
    byId.set(message.id, message);
  });

  incoming.forEach((message) => {
    const previous = byId.get(message.id);
    const nextMessage =
      previous &&
      !message.deleted_at &&
      Array.isArray(previous.attachments) &&
      previous.attachments.length > 0 &&
      (!Array.isArray(message.attachments) || message.attachments.length === 0)
        ? { ...message, attachments: previous.attachments }
        : message;
    byId.set(message.id, nextMessage);
  });

  return Array.from(byId.values()).sort(compareChatMessages);
};

export const flattenMessagePages = (pages?: Array<{ items: ChatMessage[] }>) => {
  const all = (pages ?? []).flatMap((page) => page.items ?? []);
  return mergeChatMessages([], all);
};

export const getLastSeenSeq = (messages: ChatMessage[]) => {
  if (messages.length === 0) return 0;
  return messages.reduce((max, message) => (message.seq > max ? message.seq : max), 0);
};

const patchMessageList = (
  list: ChatMessage[],
  messageId: string,
  patch: Partial<ChatMessage>,
) => list.map((item) => (item.id === messageId ? { ...item, ...patch } : item));

export const patchMessageInInfiniteData = (
  data: InfiniteData<ChatListMessagesResponse> | InfiniteData<ChatThreadResponse> | undefined,
  messageId: string,
  patch: Partial<ChatMessage>,
) => {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: patchMessageList(page.items ?? [], messageId, patch),
    })),
  };
};

export const appendMessageInInfiniteData = <T extends { items: ChatMessage[] }>(
  data: InfiniteData<T> | undefined,
  message: ChatMessage,
): InfiniteData<T> | undefined => {
  if (!data) return data;

  const existing = flattenMessagePages(data.pages as Array<{ items: ChatMessage[] }>);
  const merged = mergeChatMessages(existing, [message]);

  const sourcePage = data.pages[data.pages.length - 1] ?? data.pages[0];
  if (!sourcePage) return data;

  return {
    ...data,
    pages: [{ ...sourcePage, items: merged }],
    pageParams: [data.pageParams[0] ?? 0],
  };
};

export const tombstonePatch = (deletedAt?: string): Partial<ChatMessage> => ({
  deleted_at: deletedAt ?? new Date().toISOString(),
  body_text: null,
  body_rich: null,
  attachments: [],
  reactions: [],
});

export const normalizeDeletedMessagePatch = (message?: Partial<ChatMessage>): Partial<ChatMessage> => ({
  ...(message ?? {}),
  ...tombstonePatch(message?.deleted_at ?? undefined),
});
