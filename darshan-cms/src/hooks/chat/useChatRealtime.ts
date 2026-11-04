import { useEffect, useMemo, useRef, useState } from "react";
import { InfiniteData, useQueryClient } from "@tanstack/react-query";
import { chatApi, normalizeChatError } from "@/api/domains/chat";
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
  appendMessagesInInfiniteData,
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

export const getLastSeenSeqFromCache = (queryClient: ReturnType<typeof useQueryClient>, conversationId: string) => {
  // The ordinary timeline owns reconnect continuity. A focused deep-link
  // cache can contain a later isolated message while that timeline has a gap.
  const timeline = queryClient.getQueryData<InfiniteData<ChatListMessagesResponse>>(chatQueryKeys.messages(conversationId));
  if (timeline) return getLastSeenSeq(flattenMessagePages(timeline.pages));
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

export const clearChatTypingTimeouts = (timeouts: Record<string, number>) => {
  Object.values(timeouts).forEach((timeoutId) => {
    window.clearTimeout(timeoutId);
  });
  Object.keys(timeouts).forEach((key) => {
    delete timeouts[key];
  });
};

export const useChatRealtime = ({
  activeConversationId,
  subscribedConversationIds = [],
  onActiveConversationRejected,
}: UseChatRealtimeOptions) => {
  const queryClient = useQueryClient();
  const authToken = useAppSelector((state) => state.auth.token);
  const user = useAppSelector((state) => state.auth.user);
  const isAuthenticated = Boolean(authToken || user);
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
    if (!isAuthenticated) return;
    const socket = connectChatSocket(authToken);
    if (!socket) return;
    const typingTimeouts = typingTimeoutRef.current;
    let disposed = false;
    const activeSyncs = new Map<string, Promise<void>>();

    const syncMainFrom = (conversationId: string, startSeq: number) => {
      const existing = activeSyncs.get(conversationId);
      if (existing) return existing;
      const run = (async () => {
        let cursor = startSeq;
        let fetched = 0;
        let reachedHead = false;
        for (let pageIndex = 0; pageIndex < 20 && !disposed; pageIndex += 1) {
          const response = await chatApi.listMessages(conversationId, { afterSeq: cursor, limit: 50 });
          if (disposed) return;
          if (response.items.length === 0) {
            reachedHead = true;
            break;
          }
          const nextSeq = getLastSeenSeq(response.items);
          if (nextSeq <= cursor) throw new Error("Chat reconnect cursor did not advance.");
          queryClient.setQueriesData(
            { queryKey: ["chat", "messages", conversationId] },
            (current: InfiniteData<ChatListMessagesResponse> | undefined) =>
              appendMessagesInInfiniteData(current, response.items),
          );
          fetched += response.items.length;
          cursor = nextSeq;
          if (response.items.length < 50) {
            reachedHead = true;
            break;
          }
        }
        if (disposed) return;
        queryClient.setQueryData(chatQueryKeys.messagesCursor(conversationId), {
          lastSeenSeq: cursor,
          lastFetchCount: fetched,
        });
        if (!reachedHead) void queryClient.invalidateQueries({ queryKey: chatQueryKeys.messages(conversationId) });
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
      })();
      activeSyncs.set(conversationId, run);
      void run.finally(() => {
        if (activeSyncs.get(conversationId) === run) activeSyncs.delete(conversationId);
      }).catch(() => {});
      return run;
    };

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
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
      if (activeConversationId) {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.resolveConversation(activeConversationId) });
        // Socket.IO reports a recovered connection through `connect`; do not
        // rely on a separate manager-level `reconnect` event reaching Socket.
        const hasHistory = queryClient.getQueriesData({ queryKey: ["chat", "messages", activeConversationId] })
          .some(([, value]) => Boolean(value));
        if (hasHistory) {
          void syncMainFrom(activeConversationId, getLastSeenSeqFromCache(queryClient, activeConversationId)).catch(() => {
            if (!disposed) void queryClient.invalidateQueries({ queryKey: chatQueryKeys.messages(activeConversationId) });
          });
        }
        void queryClient.invalidateQueries({ queryKey: ["chat", "thread", activeConversationId] });
      }
      subscribe();
    };
    const onDisconnect = () => setIsConnected(false);

    const onMessageNew = (payload: ChatMessageNewEvent) => {
      // The socket announces a committed sequence. REST supplies the complete
      // message, including attachment rows that are absent from the event.
      const inMainTimeline = includeInMainTimeline(payload.message);
      const rootId = payload.message.thread_root_id;
      const priorMainSeq = inMainTimeline ? getLastSeenSeqFromCache(queryClient, payload.conversationId) : 0;
      const hasMainCache = Boolean(queryClient.getQueryData(chatQueryKeys.messages(payload.conversationId)));
      if (inMainTimeline && hasMainCache && payload.message.seq > priorMainSeq + 1) {
        void syncMainFrom(payload.conversationId, priorMainSeq).catch(() => {
          if (!disposed) void queryClient.invalidateQueries({ queryKey: chatQueryKeys.messages(payload.conversationId) });
        });
      }
      const afterSeq = Math.max(0, (payload.message.seq ?? 1) - 1);
      const loadMessage = inMainTimeline
        ? chatApi.listMessages(payload.conversationId, { afterSeq, limit: 1 })
        : rootId
          ? chatApi.listThread(payload.conversationId, rootId, { afterSeq, limit: 1 })
          : null;
      if (!loadMessage) return;
      void loadMessage.then((response) => {
        if (disposed) return;
        const message = response.items.find((item) => item.id === payload.message.id);
        if (!message) throw new Error('Announced chat message is not available through REST');
        if (inMainTimeline) {
          queryClient.setQueriesData(
            { queryKey: ["chat", "messages", payload.conversationId] },
            (current: InfiniteData<ChatListMessagesResponse> | undefined) =>
              appendMessageInInfiniteData(current, message),
          );
        }
        if (rootId) {
          queryClient.setQueriesData(
            { queryKey: ["chat", "thread", payload.conversationId, rootId] },
            (current: InfiniteData<ChatThreadResponse> | undefined) =>
              appendMessageInInfiniteData(current, message),
          );
        }
        queryClient.setQueryData(
          chatQueryKeys.messagesCursor(payload.conversationId),
          (current: { lastSeenSeq?: number; lastFetchCount?: number } | undefined) => ({
            lastSeenSeq: Math.max(current?.lastSeenSeq ?? 0, message.seq ?? 0),
            lastFetchCount: current?.lastFetchCount ?? 0,
          }),
        );
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
      }).catch(() => {
        if (disposed) return;
        void queryClient.invalidateQueries({ queryKey: ["chat", "messages", payload.conversationId] });
        if (rootId) void queryClient.invalidateQueries({ queryKey: ["chat", "thread", payload.conversationId, rootId] });
      });
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
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
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
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    };

    const onConversationUpdated = (payload: ChatConversationUpdatedEvent) => {
      if (payload.patch.membersChanged) {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.members(payload.conversationId) });
      }
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
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    };

    const onInboxChanged = (payload?: { conversationId?: string }) => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations }).then(() => subscribe());
      if (!activeConversationId || payload?.conversationId !== activeConversationId) return;
      void chatApi.resolveConversation(activeConversationId).catch((error) => {
        const status = normalizeChatError(error).httpStatus;
        if (status === 403 || status === 404) onActiveConversationRejected?.(activeConversationId);
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
      void syncMainFrom(activeConversationId, lastSeenSeq).catch(() => {
        if (!disposed) void queryClient.invalidateQueries({ queryKey: chatQueryKeys.messages(activeConversationId) });
      });
      void queryClient.invalidateQueries({ queryKey: ["chat", "thread", activeConversationId] });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("reconnect", onReconnect);
    socket.on("chat:message:new", onMessageNew);
    socket.on("chat:message:updated", onMessageUpdated);
    socket.on("chat:message:deleted", onMessageDeleted);
    socket.on("chat:conversation:updated", onConversationUpdated);
    socket.on("chat:inbox:changed", onInboxChanged);
    socket.on("chat:pin:update", onPinUpdate);
    socket.on("chat:bookmark:update", onBookmarkUpdate);
    socket.on("chat:typing", onTyping);

    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      disposed = true;
      clearChatTypingTimeouts(typingTimeouts);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("reconnect", onReconnect);
      socket.off("chat:message:new", onMessageNew);
      socket.off("chat:message:updated", onMessageUpdated);
      socket.off("chat:message:deleted", onMessageDeleted);
      socket.off("chat:conversation:updated", onConversationUpdated);
      socket.off("chat:inbox:changed", onInboxChanged);
      socket.off("chat:pin:update", onPinUpdate);
      socket.off("chat:bookmark:update", onBookmarkUpdate);
      socket.off("chat:typing", onTyping);
    };
  }, [activeConversationId, authToken, isAuthenticated, onActiveConversationRejected, queryClient, selfUserId, subscriptionIds]);

  return {
    isConnected,
    typingByConversation: typingMap,
    rejectedConversationIds,
  };
};
