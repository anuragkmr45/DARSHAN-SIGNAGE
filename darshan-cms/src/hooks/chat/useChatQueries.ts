import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  chatApi,
  type ChatCursorParams,
  type CreateChatConversationInput,
  type SendChatMessageInput,
  type ChatModerationInput,
  type UpdateChatConversationInput,
} from "@/api/domains/chat";
import { usersApi } from "@/api/domains/users";
import type {
  ChatBookmarksListResponse,
  ChatConversationListItem,
  ChatListMessagesResponse,
  ChatMessage,
  ChatPinsListResponse,
  ChatThreadResponse,
  User,
} from "@/api/types";
import {
  clampChatCursorLimit,
  flattenMessagePages,
  getFirstSeenSeq,
  getLastSeenSeq,
  appendMessageInInfiniteData,
  appendMessagesInInfiniteData,
  patchMessageInInfiniteData,
  normalizeDeletedMessagePatch,
} from "@/hooks/chat/cursorUtils";

export const chatQueryKeys = {
  conversations: ["chat", "conversations"] as const,
  resolveConversation: (conversationId?: string) => ["chat", "resolve-conversation", conversationId] as const,
  usersDirectory: ["chat", "users-directory"] as const,
  members: (conversationId?: string) => ["chat", "members", conversationId] as const,
  pins: (conversationId?: string) => ["chat", "pins", conversationId] as const,
  bookmarks: (conversationId?: string) => ["chat", "bookmarks", conversationId] as const,
  messages: (conversationId?: string, focusMessageId?: string) => focusMessageId
    ? ["chat", "messages", conversationId, "focus", focusMessageId] as const
    : ["chat", "messages", conversationId] as const,
  messagesCursor: (conversationId?: string) => ["chat", "messages-cursor", conversationId] as const,
  thread: (conversationId?: string, threadRootId?: string, focusReplyId?: string) => focusReplyId
    ? ["chat", "thread", conversationId, threadRootId, "focus", focusReplyId] as const
    : ["chat", "thread", conversationId, threadRootId] as const,
  threadCursor: (conversationId?: string, threadRootId?: string) =>
    ["chat", "thread-cursor", conversationId, threadRootId] as const,
};

const includeInMainTimeline = (
  message: ChatMessage,
  alsoToChannelHint?: boolean,
) => {
  if (!message.reply_to_message_id) return true;
  if (typeof alsoToChannelHint === "boolean") return alsoToChannelHint;
  if (typeof message.also_to_channel === "boolean") return message.also_to_channel;
  if (typeof message.alsoToChannel === "boolean") return message.alsoToChannel;
  return false;
};

export const useChatConversationsList = () =>
  useQuery({
    queryKey: chatQueryKeys.conversations,
    queryFn: chatApi.listConversations,
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

export const useConversationSettings = (conversationId?: string) => {
  const conversationsQuery = useChatConversationsList();
  const conversation = useMemo<ChatConversationListItem | undefined>(
    () => conversationsQuery.data?.items?.find((item) => item.id === conversationId),
    [conversationId, conversationsQuery.data?.items],
  );

  return {
    ...conversationsQuery,
    conversation,
  };
};

export const useResolveConversation = (conversationId?: string) =>
  useQuery({
    queryKey: chatQueryKeys.resolveConversation(conversationId),
    enabled: Boolean(conversationId),
    retry: false,
    queryFn: () => chatApi.resolveConversation(conversationId!),
  });

export const usePins = (conversationId?: string) =>
  useQuery({
    queryKey: chatQueryKeys.pins(conversationId),
    enabled: Boolean(conversationId),
    queryFn: () => chatApi.listPins(conversationId!),
    staleTime: 20_000,
  });

export const useBookmarks = (conversationId?: string) =>
  useQuery({
    queryKey: chatQueryKeys.bookmarks(conversationId),
    enabled: Boolean(conversationId),
    queryFn: () => chatApi.listBookmarks(conversationId!),
    staleTime: 20_000,
  });

export const useChatUserDirectory = (enabled = true) =>
  useQuery({
    queryKey: chatQueryKeys.usersDirectory,
    enabled,
    staleTime: 120_000,
    queryFn: async () => {
      const response = await usersApi.list({ page: 1, limit: 100, is_active: true });
      const users = response.items ?? [];
      const byId = users.reduce<Record<string, User>>((acc, user) => {
        acc[user.id] = user;
        return acc;
      }, {});
      return {
        users,
        byId,
      };
    },
  });

type ChatHistoryCursor = { latest: true } | { beforeSeq: number } | { aroundMessageId: string };
type ChatPage = ChatListMessagesResponse | ChatThreadResponse;
const MAX_CATCH_UP_PAGES = 20;

const useChatHistory = <T extends ChatPage>(options: {
  identity: string;
  enabled: boolean;
  queryKey: readonly unknown[];
  cursorKey: readonly unknown[];
  limit: number;
  initialCursor: ChatHistoryCursor;
  list: (params: ChatCursorParams & { signal?: AbortSignal }) => Promise<T>;
}) => {
  const queryClient = useQueryClient();
  const { identity, enabled, queryKey, cursorKey, limit, initialCursor, list } = options;
  const [newerState, setNewerState] = useState<{ identity: string; fetching: boolean; lastFetchCount: number; upToDate: boolean; error: boolean }>({
    identity: "", fetching: false, lastFetchCount: 0, upToDate: false, error: false,
  });
  const activeCatchUp = useRef<{ identity: string; controller: AbortController; promise: Promise<void> } | null>(null);

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    refetchInterval: 60_000,
    initialPageParam: initialCursor,
    queryFn: ({ pageParam, signal }) => list({ ...pageParam, limit, signal }),
    getNextPageParam: (lastPage): ChatHistoryCursor | undefined => {
      if (!lastPage.hasOlder || !lastPage.items?.length) return undefined;
      return { beforeSeq: getFirstSeenSeq(lastPage.items) };
    },
  });

  const items = useMemo(() => flattenMessagePages(query.data?.pages), [query.data?.pages]);
  const latestSeq = useMemo(() => getLastSeenSeq(items), [items]);
  const currentNewerState = newerState.identity === identity ? newerState : null;
  const lastFetchCount = currentNewerState?.lastFetchCount ?? 0;

  useEffect(() => {
    if (!enabled) return;
    queryClient.setQueryData(cursorKey, { lastSeenSeq: latestSeq, lastFetchCount });
  }, [cursorKey, enabled, lastFetchCount, latestSeq, queryClient]);

  useEffect(() => () => {
    if (activeCatchUp.current?.identity === identity) activeCatchUp.current.controller.abort();
  }, [identity]);

  const fetchNewer = useCallback(async () => {
    if (!enabled || query.isFetching) return;
    if (activeCatchUp.current?.identity === identity) return activeCatchUp.current.promise;
    const controller = new AbortController();
    const promise = (async () => {
      setNewerState({ identity, fetching: true, lastFetchCount: 0, upToDate: false, error: false });
      const cached = queryClient.getQueryData<InfiniteData<T>>(queryKey);
      if (!cached?.pages.length) {
        await query.refetch();
        return;
      }
      let cursor = getLastSeenSeq(flattenMessagePages(cached.pages));
      let fetched = 0;
      let upToDate = false;
      for (let pageIndex = 0; pageIndex < MAX_CATCH_UP_PAGES; pageIndex += 1) {
        const response = await list({ afterSeq: cursor, limit, signal: controller.signal });
        if (controller.signal.aborted) return;
        const nextCursor = getLastSeenSeq(response.items);
        if (response.items.length === 0) {
          upToDate = true;
          break;
        }
        if (nextCursor <= cursor) throw new Error("Chat catch-up did not advance its cursor.");
        queryClient.setQueryData<InfiniteData<T>>(queryKey, (current) =>
          appendMessagesInInfiniteData(current, response.items));
        fetched += response.items.length;
        cursor = nextCursor;
        if (response.items.length < limit) {
          upToDate = true;
          break;
        }
      }
      setNewerState({ identity, fetching: false, lastFetchCount: fetched, upToDate, error: false });
    })();
    activeCatchUp.current = { identity, controller, promise };
    try {
      await promise;
    } catch {
      if (!controller.signal.aborted) {
        setNewerState({ identity, fetching: false, lastFetchCount: 0, upToDate: false, error: true });
      }
    } finally {
      if (activeCatchUp.current?.controller === controller) activeCatchUp.current = null;
      if (!controller.signal.aborted) {
        setNewerState((state) => state.identity === identity ? { ...state, fetching: false } : state);
      }
    }
  }, [enabled, identity, limit, list, query, queryClient, queryKey]);

  return {
    ...query,
    items,
    latestSeq,
    fetchOlder: query.fetchNextPage,
    isFetchingOlder: query.isFetchingNextPage,
    hasOlder: query.hasNextPage,
    olderLoadError: query.isFetchNextPageError,
    fetchNewer,
    isFetchingNewer: currentNewerState?.fetching ?? false,
    newerLoadError: currentNewerState?.error ?? false,
    isUpToDate: Boolean(currentNewerState?.upToDate && query.isSuccess && !query.isFetching),
    lastFetchCount,
  };
};

export const useChatMessages = (conversationId?: string, params?: ChatCursorParams) => {
  const focusMessageId = params?.aroundMessageId;
  const queryKey = useMemo(() => chatQueryKeys.messages(conversationId, focusMessageId), [conversationId, focusMessageId]);
  const cursorKey = useMemo(() => chatQueryKeys.messagesCursor(conversationId), [conversationId]);
  const list = useCallback((cursor: ChatCursorParams & { signal?: AbortSignal }) =>
    chatApi.listMessages(conversationId!, cursor), [conversationId]);
  return useChatHistory({
    identity: `${conversationId ?? ""}:${focusMessageId ?? "latest"}`,
    enabled: Boolean(conversationId),
    queryKey,
    cursorKey,
    limit: clampChatCursorLimit(params?.limit),
    initialCursor: focusMessageId ? { aroundMessageId: focusMessageId } : { latest: true },
    list,
  });
};

export const useChatThread = (conversationId?: string, threadRootId?: string, params?: ChatCursorParams) => {
  const focusReplyId = params?.aroundMessageId;
  const queryKey = useMemo(() => chatQueryKeys.thread(conversationId, threadRootId, focusReplyId), [conversationId, threadRootId, focusReplyId]);
  const cursorKey = useMemo(() => chatQueryKeys.threadCursor(conversationId, threadRootId), [conversationId, threadRootId]);
  const list = useCallback((cursor: ChatCursorParams & { signal?: AbortSignal }) =>
    chatApi.listThread(conversationId!, threadRootId!, cursor), [conversationId, threadRootId]);
  return useChatHistory({
    identity: `${conversationId ?? ""}:${threadRootId ?? ""}:${focusReplyId ?? "latest"}`,
    enabled: Boolean(conversationId && threadRootId),
    queryKey,
    cursorKey,
    limit: clampChatCursorLimit(params?.limit),
    initialCursor: focusReplyId ? { aroundMessageId: focusReplyId } : { latest: true },
    list,
  });
};

const patchMessageCaches = (
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  messageId: string,
  patch: Partial<ChatMessage>,
) => {
  queryClient.setQueriesData(
    { queryKey: ["chat", "messages", conversationId] },
    (current: InfiniteData<ChatListMessagesResponse> | undefined) =>
      patchMessageInInfiniteData(current, messageId, patch),
  );
  queryClient.setQueriesData(
    { queryKey: ["chat", "thread", conversationId] },
    (current: InfiniteData<ChatThreadResponse> | undefined) =>
      patchMessageInInfiniteData(current, messageId, patch),
  );
};

export const useSendChatMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: SendChatMessageInput) => chatApi.sendMessage(payload),
    onSuccess: (response, payload) => {
      const responseAttachments = Array.isArray(response.message.attachments) ? response.message.attachments : [];
      const payloadAttachments = (payload.attachmentMediaIds ?? []).filter(Boolean);
      const message =
        responseAttachments.length === 0 && payloadAttachments.length > 0
          ? { ...response.message, attachments: payloadAttachments }
          : response.message;

      if (includeInMainTimeline(message, payload.alsoToChannel)) {
        queryClient.setQueriesData(
          { queryKey: ["chat", "messages", payload.conversationId] },
          (current: InfiniteData<ChatListMessagesResponse> | undefined) =>
            appendMessageInInfiniteData(current, message),
        );
      }

      if (message.thread_root_id) {
        queryClient.setQueriesData(
          { queryKey: ["chat", "thread", payload.conversationId, message.thread_root_id] },
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
    },
  });
};

export const useEditChatMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, text, conversationId }: { messageId: string; text: string; conversationId: string }) =>
      chatApi.editMessage(messageId, text).then((res) => ({ ...res, conversationId })),
    onSuccess: ({ message, conversationId }) => {
      patchMessageCaches(queryClient, conversationId, message.id, message);
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};

export const useDeleteChatMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, conversationId }: { messageId: string; conversationId: string }) =>
      chatApi.deleteMessage(messageId).then((res) => ({ ...res, conversationId })),
    onSuccess: ({ message, conversationId }) => {
      patchMessageCaches(queryClient, conversationId, message.id, normalizeDeletedMessagePatch(message));
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};

export const useReactToMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      conversationId,
      emoji,
      op,
    }: {
      messageId: string;
      conversationId: string;
      emoji: string;
      op: "add" | "remove";
    }) =>
      chatApi.reactToMessage(messageId, { emoji, op }).then((res) => ({
        ...res,
        messageId,
        conversationId,
      })),
    onSuccess: ({ reactions, messageId, conversationId }) => {
      patchMessageCaches(queryClient, conversationId, messageId, { reactions });
    },
  });
};

export const usePinMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, messageId }: { conversationId: string; messageId: string }) =>
      chatApi.pinMessage(messageId).then((result) => ({ ...result, conversationId })),
    onSuccess: ({ pin, conversationId }) => {
      queryClient.setQueryData(chatQueryKeys.pins(conversationId), (current: ChatPinsListResponse | undefined) => {
        const items = current?.items ?? [];
        if (items.some((item) => item.id === pin.id)) return current;
        return { items: [pin, ...items] };
      });
    },
  });
};

export const useUnpinMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, messageId }: { conversationId: string; messageId: string }) =>
      chatApi.unpinMessage(messageId).then((result) => ({ ...result, conversationId, messageId })),
    onSuccess: ({ conversationId, messageId }) => {
      queryClient.setQueryData(chatQueryKeys.pins(conversationId), (current: ChatPinsListResponse | undefined) => {
        const items = current?.items ?? [];
        return { items: items.filter((item) => item.message_id !== messageId) };
      });
    },
  });
};

export const useCreateBookmark = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      payload,
    }: {
      conversationId: string;
      payload: {
        type: "LINK" | "FILE" | "MESSAGE";
        label: string;
        emoji?: string;
        url?: string;
        mediaAssetId?: string;
        messageId?: string;
      };
    }) => chatApi.createBookmark(conversationId, payload).then((res) => ({ ...res, conversationId })),
    onSuccess: ({ bookmark, conversationId }) => {
      queryClient.setQueryData(chatQueryKeys.bookmarks(conversationId), (current: ChatBookmarksListResponse | undefined) => {
        const items = current?.items ?? [];
        const existingIndex = items.findIndex((item) => item.id === bookmark.id);
        if (existingIndex === -1) {
          return { items: [bookmark, ...items] };
        }
        const nextItems = [...items];
        nextItems[existingIndex] = bookmark;
        return { items: nextItems };
      });
    },
  });
};

export const useDeleteBookmark = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookmarkId, conversationId }: { bookmarkId: string; conversationId: string }) =>
      chatApi.deleteBookmark(bookmarkId).then((res) => ({ ...res, bookmarkId, conversationId })),
    onSuccess: ({ bookmarkId, conversationId }) => {
      queryClient.setQueryData(chatQueryKeys.bookmarks(conversationId), (current: ChatBookmarksListResponse | undefined) => {
        const items = current?.items ?? [];
        return { items: items.filter((item) => item.id !== bookmarkId) };
      });
    },
  });
};

export const useMarkRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, lastReadSeq }: { conversationId: string; lastReadSeq: number }) =>
      chatApi.markRead(conversationId, lastReadSeq),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};

export const useCreateDm = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (otherUserId: string) => chatApi.createDm(otherUserId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};

export const useCreateShareLink = () =>
  useMutation({
    mutationFn: (conversationId: string) => chatApi.createShareLink(conversationId),
  });

export const useCreateChatConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateChatConversationInput) => chatApi.createConversation(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};

export const useInviteChatMembers = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, userIds }: { conversationId: string; userIds: string[] }) =>
      chatApi.inviteMembers(conversationId, userIds),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.members(variables.conversationId) });
    },
  });
};

export const useRemoveChatMember = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, userId }: { conversationId: string; userId: string }) =>
      chatApi.removeMember(conversationId, userId),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.members(variables.conversationId) });
    },
  });
};

export const useChatMembers = (conversationId?: string, enabled = true) =>
  useQuery({
    queryKey: chatQueryKeys.members(conversationId),
    queryFn: () => chatApi.listMembers(conversationId!),
    enabled: enabled && Boolean(conversationId),
    staleTime: 10_000,
    retry: false,
  });

export const useUpdateConversationSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      payload,
    }: {
      conversationId: string;
      payload: UpdateChatConversationInput;
    }) => chatApi.updateConversation(conversationId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};

export const usePatchConversationSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      settings,
    }: {
      conversationId: string;
      settings: {
        mention_policy: {
          everyone: "ANY_MEMBER" | "ADMINS_ONLY" | "DISABLED";
          channel: "ANY_MEMBER" | "ADMINS_ONLY" | "DISABLED";
          here: "ANY_MEMBER" | "ADMINS_ONLY" | "DISABLED";
        };
        edit_policy: "OWN" | "ADMINS_ONLY" | "DISABLED";
        delete_policy: "OWN" | "ADMINS_ONLY" | "DISABLED";
      };
    }) => chatApi.patchConversationSettings(conversationId, settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};

export const useArchiveConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => chatApi.archiveConversation(conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};

export const useUnarchiveConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => chatApi.unarchiveConversation(conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};

export const useDeleteConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => chatApi.deleteConversation(conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};

export const useModerateConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      payload,
    }: {
      conversationId: string;
      payload: ChatModerationInput;
    }) => chatApi.moderateConversation(conversationId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations });
    },
  });
};
