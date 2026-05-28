import { useEffect, useMemo, useRef, useState } from "react";
import { InfiniteData, useQueryClient } from "@tanstack/react-query";
import { chatApi } from "@/api/domains/chat";
import type {
  ChatBookmarkUpdateEvent,
  ChatBookmarksListResponse,
  ChatConversationUpdatedEvent,
  ChatListMessagesResponse,
  ChatMessage,
  ChatMessageDeletedEvent,
  ChatMessageNewEvent,
  ChatPinUpdateEvent,
  ChatPinsListResponse,
  ChatSubscribeAck,
  ChatMessageUpdatedEvent,
  ChatThreadResponse,
  ChatTypingEvent,
} from "@/api/types";
import { chatQueryKeys } from "@/hooks/chat/useChatQueries";
import {
  appendMessageInInfiniteData,
  flattenMessagePages,
  getLastSeenSeq,
  patchMessageInInfiniteData,
  normalizeDeletedMessagePatch,
} from "@/hooks/chat/cursorUtils";
import { connectChatSocket } from "@/lib/chatSocket";
import { useAppSelector } from "@/store/hooks";

interface UseChatRealtimeOptions {
  activeConversationId?: string;
  subscribedConversationIds?: string[];
  onActiveConversationRejected?: (conversationId: string) => void;
}

const getLastSeenSeqFromCache = (queryClient: ReturnType<typeof useQueryClient>, conversationId: string) => {
  const entries = queryClient.getQueriesData({
    queryKey: ["chat", "messages", conversationId],
  });

  let maxSeq = 0;
  entries.forEach((entry) => {
    const value = entry[1] as InfiniteData<ChatListMessagesResponse> | undefined;
    const pages = value?.pages ?? [];
    const seq = getLastSeenSeq(flattenMessagePages(pages));
    if (seq > maxSeq) maxSeq = seq;
  });

  return maxSeq;
};

const normalizeRejectedIds = (ack?: Partial<ChatSubscribeAck> | null) => {
  if (!ack || !Array.isArray(ack.rejected)) return [] as string[];
  return ack.rejected
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "conversationId" in entry) {
        const value = (entry as { conversationId?: unknown }).conversationId;
        return typeof value === "string" ? value : undefined;
      }
      return undefined;
    })
    .filter((value): value is string => Boolean(value));
};

const includeInMainTimeline = (message: ChatMessage) => {
  if (!message.reply_to_message_id) return true;
  if (typeof message.also_to_channel === "boolean") return message.also_to_channel;
  if (typeof message.alsoToChannel === "boolean") return message.alsoToChannel;
  return false;
};

export const useChatRealtime = ({
  activeConversationId,
  subscribedConversationIds = [],
  onActiveConversationRejected,
}: UseChatRealtimeOptions) => {
  const queryClient = useQueryClient();
  const authToken = useAppSelector((state) => state.auth.token);
  const selfUserId = useAppSelector((state) => state.auth.user?.id);
  const [isConnected, setIsConnected] = useState(false);
  const [typingMap, setTypingMap] = useState<Record<string, string[]>>({});
  const [rejectedConversationIds, setRejectedConversationIds] = useState<string[]>([]);
  const typingTimeoutRef = useRef<Record<string, number>>({});

  const subscriptionIds = useMemo(() => {
    const ids = new Set<string>();
    subscribedConversationIds.forEach((id) => id && ids.add(id));
    if (activeConversationId) ids.add(activeConversationId);
    return Array.from(ids);
  }, [activeConversationId, subscribedConversationIds]);

  useEffect(() => {
    if (!authToken) return;
    const socket = connectChatSocket(authToken);
    if (!socket) return;

    const subscribe = () => {
      if (subscriptionIds.length === 0) return;
      socket.emit("chat:subscribe", { conversationIds: subscriptionIds }, (ack?: ChatSubscribeAck) => {
        const rejectedIds = normalizeRejectedIds(ack);
        setRejectedConversationIds(rejectedIds);
        if (activeConversationId && rejectedIds.includes(activeConversationId)) {
          onActiveConversationRejected?.(activeConversationId);
        }
      });
    };

    const onConnect = () => {
      setIsConnected(true);
      subscribe();
    };
    const onDisconnect = () => setIsConnected(false);

    const onMessageNew = (payload: ChatMessageNewEvent) => {
      if (includeInMainTimeline(payload.message)) {
        queryClient.setQueriesData(
          { queryKey: ["chat", "messages", payload.conversationId] },
          (current: InfiniteData<ChatListMessagesResponse> | undefined) =>
            appendMessageInInfiniteData(current, payload.message),
        );
      }

      if (payload.message.thread_root_id) {
        queryClient.setQueriesData(
          { queryKey: ["chat", "thread", payload.conversationId, payload.message.thread_root_id] },
          (current: InfiniteData<ChatThreadResponse> | undefined) =>
            appendMessageInInfiniteData(current, payload.message),
        );
      }

      queryClient.setQueryData(
        chatQueryKeys.messagesCursor(payload.conversationId),
        (current: { lastSeenSeq?: number; lastFetchCount?: number } | undefined) => ({
          lastSeenSeq: Math.max(current?.lastSeenSeq ?? 0, payload.message.seq ?? 0),
          lastFetchCount: current?.lastFetchCount ?? 0,
        }),
      );

      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    };

    const onMessageUpdated = (payload: ChatMessageUpdatedEvent) => {
      queryClient.setQueriesData(
        { queryKey: ["chat", "messages", payload.conversationId] },
        (current: InfiniteData<ChatListMessagesResponse> | undefined) =>
          patchMessageInInfiniteData(current, payload.messageId, payload.patch),
      );
      queryClient.setQueriesData(
        { queryKey: ["chat", "thread", payload.conversationId] },
        (current: InfiniteData<ChatThreadResponse> | undefined) =>
          patchMessageInInfiniteData(current, payload.messageId, payload.patch),
      );
    };

    const onMessageDeleted = (payload: ChatMessageDeletedEvent) => {
      const patch = normalizeDeletedMessagePatch();
      queryClient.setQueriesData(
        { queryKey: ["chat", "messages", payload.conversationId] },
        (current: InfiniteData<ChatListMessagesResponse> | undefined) =>
          patchMessageInInfiniteData(current, payload.messageId, patch),
      );
      queryClient.setQueriesData(
        { queryKey: ["chat", "thread", payload.conversationId] },
        (current: InfiniteData<ChatThreadResponse> | undefined) =>
          patchMessageInInfiniteData(current, payload.messageId, patch),
      );
    };

    const onConversationUpdated = (payload: ChatConversationUpdatedEvent) => {
      queryClient.setQueryData(chatQueryKeys.conversations, (current: { items?: unknown[] } | undefined) => {
        if (!current?.items) return current;
        return {
          ...current,
          items: current.items.map((item) => {
            const typedItem = item as { id: string; metadata?: { settings?: unknown } | null };
            if (typedItem.id !== payload.conversationId) return item;
            if (!payload.patch.settings) return { ...item, ...payload.patch };
            return {
              ...item,
              ...payload.patch,
              settings: payload.patch.settings,
              metadata: {
                ...(typedItem.metadata || {}),
                settings: payload.patch.settings,
              },
            };
          }),
        };
      });
    };

    const onPinUpdate = (payload: ChatPinUpdateEvent) => {
      if (!subscriptionIds.includes(payload.conversationId)) return;

      queryClient.setQueryData(chatQueryKeys.pins(payload.conversationId), (current: ChatPinsListResponse | undefined) => {
        const currentItems = current?.items ?? [];
        if (!payload.pinned) {
          return { items: currentItems.filter((item) => item.message_id !== payload.messageId) };
        }
        if (!payload.pin) return current;
        const exists = currentItems.some((item) => item.id === payload.pin?.id);
        if (exists) return current;
        return { items: [payload.pin, ...currentItems] };
      });
    };

    const onBookmarkUpdate = (payload: ChatBookmarkUpdateEvent) => {
      if (!subscriptionIds.includes(payload.conversationId)) return;

      if (payload.op === "remove") {
        queryClient.setQueryData(
          chatQueryKeys.bookmarks(payload.conversationId),
          (current: ChatBookmarksListResponse | undefined) => {
            const currentItems = current?.items ?? [];
            return { items: currentItems.filter((item) => item.id !== payload.bookmarkId) };
          },
        );
        return;
      }

      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.bookmarks(payload.conversationId) });
    };

    const onTyping = (payload: ChatTypingEvent) => {
      if (payload.userId === selfUserId) return;
      const key = `${payload.conversationId}:${payload.userId}`;
      const ttl = (payload.ttlSeconds ?? 4) * 1000;

      setTypingMap((prev) => {
        const currentUsers = new Set(prev[payload.conversationId] ?? []);
        if (payload.isTyping) {
          currentUsers.add(payload.userId);
        } else {
          currentUsers.delete(payload.userId);
        }
        return { ...prev, [payload.conversationId]: Array.from(currentUsers) };
      });

      if (typingTimeoutRef.current[key]) {
        window.clearTimeout(typingTimeoutRef.current[key]);
        delete typingTimeoutRef.current[key];
      }

      if (payload.isTyping) {
        typingTimeoutRef.current[key] = window.setTimeout(() => {
          setTypingMap((prev) => ({
            ...prev,
            [payload.conversationId]: (prev[payload.conversationId] ?? []).filter((id) => id !== payload.userId),
          }));
        }, ttl);
      }
    };

    const onReconnect = () => {
      subscribe();
      if (!activeConversationId) return;

      const lastSeenSeq = getLastSeenSeqFromCache(queryClient, activeConversationId);
      chatApi
        .listMessages(activeConversationId, { afterSeq: lastSeenSeq, limit: 50 })
        .then((response) => {
          queryClient.setQueriesData(
            { queryKey: ["chat", "messages", activeConversationId] },
            (current: InfiniteData<ChatListMessagesResponse> | undefined) => {
              let next = current;
              response.items.forEach((message) => {
                next = appendMessageInInfiniteData(next, message);
              });
              return next;
            },
          );
          queryClient.setQueryData(chatQueryKeys.messagesCursor(activeConversationId), {
            lastSeenSeq: Math.max(lastSeenSeq, ...response.items.map((item) => item.seq)),
            lastFetchCount: response.items.length,
          });
          void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
        })
        .catch(() => {
          void queryClient.invalidateQueries({ queryKey: ["chat", "messages", activeConversationId] });
        });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("reconnect", onReconnect);
    socket.on("chat:message:new", onMessageNew);
    socket.on("chat:message:updated", onMessageUpdated);
    socket.on("chat:message:deleted", onMessageDeleted);
    socket.on("chat:conversation:updated", onConversationUpdated);
    socket.on("chat:pin:update", onPinUpdate);
    socket.on("chat:bookmark:update", onBookmarkUpdate);
    socket.on("chat:typing", onTyping);

    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("reconnect", onReconnect);
      socket.off("chat:message:new", onMessageNew);
      socket.off("chat:message:updated", onMessageUpdated);
      socket.off("chat:message:deleted", onMessageDeleted);
      socket.off("chat:conversation:updated", onConversationUpdated);
      socket.off("chat:pin:update", onPinUpdate);
      socket.off("chat:bookmark:update", onBookmarkUpdate);
      socket.off("chat:typing", onTyping);
    };
  }, [activeConversationId, authToken, onActiveConversationRejected, queryClient, selfUserId, subscriptionIds]);

  return {
    isConnected,
    typingByConversation: typingMap,
    rejectedConversationIds,
  };
};
