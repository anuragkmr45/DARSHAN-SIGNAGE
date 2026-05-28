import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ArrowDown, PanelLeftClose, PanelLeftOpen, Plus, ShieldAlert, UserPlus } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "@/api/apiClient";
import { mediaApi } from "@/api/domains/media";
import type {
  ChatBookmark,
  ChatConversationListItem,
  ChatConversationSettings,
  ChatEditDeletePolicy,
  ChatMentionPolicy,
  ChatMessage,
  ChatPin,
} from "@/api/types";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { Composer } from "@/components/chat/Composer";
import { ConversationList } from "@/components/chat/ConversationList";
import { ConversationSettingsPanel } from "@/components/chat/ConversationSettingsPanel";
import { CreateConversationModal } from "@/components/chat/CreateConversationModal";
import { InviteMembersModal } from "@/components/chat/InviteMembersModal";
import { MessageList } from "@/components/chat/MessageList";
import { ModerationControls } from "@/components/chat/ModerationControls";
import { ThreadPanel } from "@/components/chat/ThreadPanel";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ChatStatusBanner } from "@/components/chat/ChatStatusBanner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import {
  useArchiveConversation,
  useBookmarks,
  useChatConversationsList,
  useCreateShareLink,
  useChatMessages,
  useChatUserDirectory,
  useCreateBookmark,
  useCreateChatConversation,
  useCreateDm,
  useDeleteChatMessage,
  useDeleteBookmark,
  useDeleteConversation,
  useEditChatMessage,
  useInviteChatMembers,
  useMarkRead,
  useModerateConversation,
  usePinMessage,
  usePins,
  useReactToMessage,
  useResolveConversation,
  useSendChatMessage,
  useUnarchiveConversation,
  useUnpinMessage,
  useUpdateConversationSettings,
} from "@/hooks/chat/useChatQueries";
import { useChatRealtime } from "@/hooks/chat/useChatRealtime";
import { connectChatSocket } from "@/lib/chatSocket";
import { mapChatErrorToUx, type ChatBlockMode } from "@/lib/chatErrors";
import { cn } from "@/lib/utils";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useAppSelector } from "@/store/hooks";
import type { ChatPendingUiMessage } from "@/components/chat/types";

const MESSAGES_LIMIT = 50;
const READ_DEBOUNCE_MS = 900;

const getAttachmentId = (attachment: string | { media_id?: string; mediaId?: string }) =>
  typeof attachment === "string" ? attachment : attachment.media_id || attachment.mediaId;

const conversationTitle = (conversation?: ChatConversationListItem) => {
  if (!conversation) return "";
  if (conversation.type === "DM") return conversation.title || "Direct Message";
  return conversation.title || conversation.topic || conversation.purpose || conversation.id;
};

const extractUntil = (details: unknown, keys: string[]) => {
  if (!details || typeof details !== "object") return undefined;
  const typedDetails = details as Record<string, unknown>;
  for (const key of keys) {
    const value = typedDetails[key];
    if (typeof value === "string") return value;
  }
  return undefined;
};

const asBannerMode = (mode: ChatBlockMode) => {
  if (!mode) return undefined;
  return mode;
};

const DEFAULT_CHAT_SETTINGS: ChatConversationSettings = {
  mention_policy: {
    everyone: "ADMINS_ONLY",
    channel: "ADMINS_ONLY",
    here: "ANY_MEMBER",
  },
  edit_policy: "OWN",
  delete_policy: "OWN",
};

const resolveSettings = (conversation?: ChatConversationListItem): ChatConversationSettings =>
  conversation?.settings || conversation?.metadata?.settings || DEFAULT_CHAT_SETTINGS;

const canPerformByPolicy = (
  policy: ChatEditDeletePolicy,
  isMine: boolean,
  canManage: boolean,
) => {
  if (policy === "DISABLED") return false;
  if (policy === "ADMINS_ONLY") return canManage;
  return isMine || canManage;
};

const specialMentionAllowed = (
  mentionPolicy: ChatMentionPolicy,
  token: "@everyone" | "@channel" | "@here",
  canManage: boolean,
) => {
  const rule = token === "@everyone"
    ? mentionPolicy.everyone
    : token === "@channel"
    ? mentionPolicy.channel
    : mentionPolicy.here;

  if (rule === "ANY_MEMBER") return true;
  if (rule === "ADMINS_ONLY") return canManage;
  return false;
};

const resolveConversationFromRoute = (
  listConversation: ChatConversationListItem | undefined,
  resolvedConversation?: {
    conversation: {
      id: string;
      type: ChatConversationListItem["type"];
      state: ChatConversationListItem["state"];
      title?: string | null;
      topic?: string | null;
      purpose?: string | null;
      invite_policy?: ChatConversationListItem["invite_policy"];
      last_seq?: number;
    };
    viewer: {
      is_member: boolean;
      role: string | null;
    };
  },
) => {
  if (!resolvedConversation) return undefined;

  return {
    ...listConversation,
    ...resolvedConversation.conversation,
    viewer_is_member: resolvedConversation.viewer.is_member,
    viewer_role:
      (resolvedConversation.viewer.role as ChatConversationListItem["viewer_role"]) ??
      listConversation?.viewer_role ??
      null,
  } satisfies ChatConversationListItem;
};

const buildContextualSharePath = (
  basePath: string,
  threadRootId?: string,
  focusMessageId?: string | null,
) => {
  const trimmedBasePath = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  if (threadRootId) {
    return `${trimmedBasePath}/thread/${encodeURIComponent(threadRootId)}`;
  }
  if (focusMessageId) {
    return `${trimmedBasePath}?focusMessageId=${encodeURIComponent(focusMessageId)}`;
  }
  return trimmedBasePath;
};

const buildShareLinkUrl = (
  response: { path: string; url?: string },
  threadRootId?: string,
  focusMessageId?: string | null,
) => {
  const contextualPath = buildContextualSharePath(response.path, threadRootId, focusMessageId);
  if (!response.url) {
    return new URL(contextualPath, window.location.origin).toString();
  }

  if (response.url.endsWith(response.path)) {
    return `${response.url.slice(0, -response.path.length)}${contextualPath}`;
  }

  const absoluteUrl = new URL(response.url);
  return new URL(contextualPath, `${absoluteUrl.origin}/`).toString();
};

export default function Conversations() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams<{ conversationId?: string; threadRootId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const authToken = useAppSelector((state) => state.auth.token);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const currentRole = useAppSelector((state) => state.auth.user?.role);
  const { isAdminOrSuperAdmin } = useAuthorization();
  const usersDirectoryQuery = useChatUserDirectory(Boolean(authToken));

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatStatus, setChatStatus] = useState<{
    code?: string;
    message: string;
    mode?: "READ_ONLY" | "MUTED" | "BANNED";
    until?: string;
  } | null>(null);
  const [pendingUiMessages, setPendingUiMessages] = useState<ChatPendingUiMessage[]>([]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [newMessagesFromSeq, setNewMessagesFromSeq] = useState<number | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isModerationPanelOpen, setIsModerationPanelOpen] = useState(false);
  const [shareLinkFallback, setShareLinkFallback] = useState<string | null>(null);

  const routeConversationId = params.conversationId;
  const threadRootId = params.threadRootId;
  const focusMessageId = searchParams.get("focusMessageId");
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const prevLatestSeqRef = useRef(0);
  const didInitialScrollRef = useRef(false);
  const shareLinkInputRef = useRef<HTMLInputElement | null>(null);

  const conversationsQuery = useChatConversationsList();
  const conversations = useMemo(() => conversationsQuery.data?.items ?? [], [conversationsQuery.data?.items]);
  const listConversation = conversations.find((item) => item.id === routeConversationId);
  const resolveConversationQuery = useResolveConversation(routeConversationId);
  const selectedConversation = useMemo(
    () => resolveConversationFromRoute(listConversation, resolveConversationQuery.data),
    [listConversation, resolveConversationQuery.data],
  );
  const messagesQuery = useChatMessages(selectedConversation?.id, {
    limit: MESSAGES_LIMIT,
  });
  const fetchNewerMessages = messagesQuery.fetchNewer;
  const isFetchingNewerMessages = messagesQuery.isFetchingNewer;
  const pinsQuery = usePins(selectedConversation?.id);
  const bookmarksQuery = useBookmarks(selectedConversation?.id);
  const messages = messagesQuery.items;
  const latestMessageSeq = messagesQuery.latestSeq;

  const sendMessage = useSendChatMessage();
  const editMessage = useEditChatMessage();
  const deleteMessage = useDeleteChatMessage();
  const reactMessage = useReactToMessage();
  const pinMessage = usePinMessage();
  const unpinMessage = useUnpinMessage();
  const createBookmark = useCreateBookmark();
  const deleteBookmark = useDeleteBookmark();
  const markRead = useMarkRead();
  const createDm = useCreateDm();
  const createConversation = useCreateChatConversation();
  const inviteMembers = useInviteChatMembers();
  const updateSettings = useUpdateConversationSettings();
  const archiveConversation = useArchiveConversation();
  const unarchiveConversation = useUnarchiveConversation();
  const deleteConversation = useDeleteConversation();
  const moderateConversation = useModerateConversation();
  const createShareLink = useCreateShareLink();

  const mentionDisplayById = useMemo(() => {
    const users = usersDirectoryQuery.data?.users ?? [];
    return users.reduce<Record<string, string>>((acc, user) => {
      const displayName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email || user.id;
      acc[user.id] = displayName;
      return acc;
    }, {});
  }, [usersDirectoryQuery.data?.users]);

  const handleActiveConversationRejected = useCallback(() => {
    setPendingUiMessages([]);
    setSettingsOpen(false);
    setInviteOpen(false);
    setChatStatus({
      code: "FORBIDDEN",
      message: "Access removed / banned / not a member",
      mode: "BANNED",
    });
    setSearchParams({});
    navigate("/chat");
    toast({
      title: "Access removed",
      description: "Access removed / banned / not a member",
      variant: "destructive",
    });
  }, [navigate, setSearchParams, toast]);

  const activeConversationId = selectedConversation?.id;
  const subscriptionIds = useMemo(() => conversations.slice(0, 10).map((item) => item.id), [conversations]);
  const realtime = useChatRealtime({
    activeConversationId,
    subscribedConversationIds: subscriptionIds,
    onActiveConversationRejected: handleActiveConversationRejected,
  });

  const threadRootMessage = threadRootId
    ? messages.find((message) => message.id === threadRootId || message.thread_root_id === threadRootId)
    : undefined;

  useEffect(() => {
    if (conversations.length === 0) return;
    if (routeConversationId) return;
    navigate(`/chat/${conversations[0].id}`, { replace: true });
  }, [conversations, navigate, routeConversationId]);

  const resolveConversationError =
    resolveConversationQuery.error instanceof ApiError ? resolveConversationQuery.error : null;
  const routeAccessState = useMemo(() => {
    if (!routeConversationId) return null;
    if (resolveConversationQuery.isLoading) {
      return {
        title: "Resolving conversation...",
        description: "Checking access and loading conversation details.",
      };
    }
    if (!resolveConversationError) return null;
    if (resolveConversationError.code === "CHAT_BANNED") {
      return {
        title: "You are banned from this conversation",
        description: resolveConversationError.message,
      };
    }
    if (resolveConversationError.code === "FORBIDDEN") {
      return {
        title: "No access",
        description: "You do not have access to this conversation.",
      };
    }
    if (resolveConversationError.code === "NOT_FOUND" || resolveConversationError.status === 404) {
      return {
        title: "Conversation not found",
        description: "The shared link points to a conversation that no longer exists.",
      };
    }
    return {
      title: "Unable to open conversation",
      description: resolveConversationError.message,
    };
  }, [resolveConversationError, resolveConversationQuery.isLoading, routeConversationId]);

  useEffect(() => {
    if (!messagesQuery.error) return;
    const ux = mapChatErrorToUx(messagesQuery.error);
    const mode = asBannerMode(ux.blockMode);
    if (!mode) return;
    setChatStatus({
      code: ux.code,
      message: ux.message,
      mode,
      until: extractUntil(ux.details, ["muted_until", "banned_until"]),
    });
  }, [messagesQuery.error]);

  useEffect(() => {
    setChatStatus(null);
    setPendingUiMessages([]);
    setShowJumpToLatest(false);
    setNewMessagesFromSeq(null);
    setShareLinkFallback(null);
    prevLatestSeqRef.current = 0;
    didInitialScrollRef.current = false;
  }, [routeConversationId]);

  useEffect(() => {
    if (!routeAccessState) return;
    setSettingsOpen(false);
    setInviteOpen(false);
  }, [routeAccessState]);

  useEffect(() => {
    if (!shareLinkFallback) return;
    requestAnimationFrame(() => {
      shareLinkInputRef.current?.focus();
      shareLinkInputRef.current?.select();
    });
  }, [shareLinkFallback]);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    const onScroll = () => {
      const threshold = 24;
      const atBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - threshold;
      setIsAtBottom(atBottom);
      if (atBottom) {
        setShowJumpToLatest(false);
        setNewMessagesFromSeq(null);
      }
    };

    viewport.addEventListener("scroll", onScroll);
    onScroll();
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [activeConversationId]);

  useEffect(() => {
    if (!latestMessageSeq) return;
    const previousLatest = prevLatestSeqRef.current;
    if (previousLatest > 0 && latestMessageSeq > previousLatest && !isAtBottom) {
      setShowJumpToLatest(true);
      setNewMessagesFromSeq((current) => current ?? previousLatest + 1);
    }
    prevLatestSeqRef.current = latestMessageSeq;
    if (isAtBottom) {
      setShowJumpToLatest(false);
      setNewMessagesFromSeq(null);
    }
  }, [isAtBottom, latestMessageSeq]);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    if (!activeConversationId || !messages.length) return;
    if (focusMessageId) return;
    if (didInitialScrollRef.current) return;
    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    didInitialScrollRef.current = true;
  }, [activeConversationId, focusMessageId, messages.length]);

  const messageMediaIds = useMemo(
    () =>
      Array.from(
        new Set(
          messages.flatMap((message) => {
            const attachments = Array.isArray(message.attachments) ? message.attachments : [];
            return attachments
              .map((attachment) =>
                getAttachmentId(
                  attachment as string | { media_id?: string; mediaId?: string },
                ),
              )
              .filter((id): id is string => Boolean(id));
          }),
        ),
      ),
    [messages],
  );

  const bookmarkFileMediaIds = useMemo(
    () =>
      (bookmarksQuery.data?.items ?? [])
        .map((bookmark) => bookmark.media_asset_id)
        .filter((id): id is string => Boolean(id)),
    [bookmarksQuery.data?.items],
  );
  const pendingAttachmentMediaIds = useMemo(
    () =>
      Array.from(
        new Set(
          pendingUiMessages.flatMap((item) => item.attachmentMediaIds).filter((id): id is string => Boolean(id)),
        ),
      ),
    [pendingUiMessages],
  );

  const allMediaIds = useMemo(
    () => Array.from(new Set([...messageMediaIds, ...bookmarkFileMediaIds, ...pendingAttachmentMediaIds])),
    [bookmarkFileMediaIds, messageMediaIds, pendingAttachmentMediaIds],
  );

  const mediaQueries = useQueries({
    queries: allMediaIds.map((mediaId) => ({
      queryKey: ["media", "chat", mediaId],
      queryFn: () => mediaApi.getById(mediaId),
      enabled: Boolean(activeConversationId),
      staleTime: 60_000,
      retry: 1,
    })),
  });

  const attachmentMediaById = useMemo(() => {
    const map: Record<string, Awaited<ReturnType<typeof mediaApi.getById>>> = {};
    allMediaIds.forEach((mediaId, index) => {
      if (mediaQueries[index]?.data) {
        map[mediaId] = mediaQueries[index].data;
      }
    });
    return map;
  }, [allMediaIds, mediaQueries]);

  const archivedStatus =
    selectedConversation?.state === "ARCHIVED"
      ? { code: "CHAT_ARCHIVED", message: "Conversation is archived and read-only.", mode: "READ_ONLY" as const }
      : null;
  const effectiveStatus = chatStatus ?? archivedStatus;

  const canModerate = Boolean(isAdminOrSuperAdmin || currentRole === "ADMIN" || currentRole === "SUPER_ADMIN");
  const canShowModeration = Boolean(canModerate && selectedConversation?.type !== "DM");
  const canManage =
    canModerate ||
    selectedConversation?.viewer_role === "ADMIN" ||
    selectedConversation?.viewer_role === "OWNER";
  const canInvite =
    selectedConversation?.type === "GROUP_CLOSED" &&
    selectedConversation.invite_policy !== "INVITES_DISABLED" &&
    (selectedConversation.invite_policy === "ANY_MEMBER_CAN_INVITE" ? true : canManage);
  const conversationSettings = resolveSettings(selectedConversation);
  const pinnedMessageIds = useMemo(
    () => new Set((pinsQuery.data?.items ?? []).map((pin) => pin.message_id)),
    [pinsQuery.data?.items],
  );
  const bookmarkedMessageIds = useMemo(
    () =>
      new Set(
        (bookmarksQuery.data?.items ?? [])
          .filter((bookmark) => bookmark.type === "MESSAGE" && Boolean(bookmark.message_id))
          .map((bookmark) => bookmark.message_id as string),
      ),
    [bookmarksQuery.data?.items],
  );
  const composerDisabled = Boolean(
    !selectedConversation ||
      effectiveStatus?.mode === "READ_ONLY" ||
      effectiveStatus?.mode === "MUTED" ||
      effectiveStatus?.mode === "BANNED" ||
      selectedConversation.state === "DELETED",
  );

  useEffect(() => {
    if (!canShowModeration) {
      setIsModerationPanelOpen(false);
    }
  }, [canShowModeration]);

  const emitTyping = (isTyping: boolean) => {
    if (!activeConversationId || !authToken) return;
    const socket = connectChatSocket(authToken);
    socket?.emit("chat:typing", { conversationId: activeConversationId, isTyping });
  };

  const applyChatError = (error: unknown) => {
    const ux = mapChatErrorToUx(error);
    const mode = asBannerMode(ux.blockMode);
    if (mode) {
      setChatStatus({
        code: ux.code,
        message: ux.message,
        mode,
        until: extractUntil(ux.details, ["muted_until", "banned_until"]),
      });
    }

    toast({
      title: ux.toastTitle,
      description: ux.message,
      variant: ux.severity === "error" ? "destructive" : "default",
    });

    return ux;
  };

  const upsertPendingMessage = (message: ChatPendingUiMessage) => {
    setPendingUiMessages((prev) => {
      const exists = prev.some((item) => item.localId === message.localId);
      if (!exists) return [...prev, message];
      return prev.map((item) => (item.localId === message.localId ? message : item));
    });
  };

  const removePendingMessage = (localId: string) => {
    setPendingUiMessages((prev) => prev.filter((item) => item.localId !== localId));
  };

  const sendWithPending = async (
    payload: { text: string; replyTo?: string; attachmentMediaIds: string[]; alsoToChannel?: boolean },
    localId?: string,
  ) => {
    if (!activeConversationId) return;
    const id = localId ?? `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextPending: ChatPendingUiMessage = {
      localId: id,
      conversationId: activeConversationId,
      text: payload.text,
      replyTo: payload.replyTo,
      alsoToChannel: payload.alsoToChannel,
      attachmentMediaIds: payload.attachmentMediaIds,
      createdAt: new Date().toISOString(),
      status: "sending",
    };
    upsertPendingMessage(nextPending);

    try {
      await sendMessage.mutateAsync({
        conversationId: activeConversationId,
        text: payload.text,
        replyTo: payload.replyTo,
        alsoToChannel: payload.alsoToChannel,
        attachmentMediaIds: payload.attachmentMediaIds,
      });
      removePendingMessage(id);
      if (chatStatus?.mode !== "READ_ONLY") {
        setChatStatus(null);
      }
    } catch (error) {
      const ux = applyChatError(error);
      upsertPendingMessage({
        ...nextPending,
        status: "failed",
        errorCode: ux.code,
        errorMessage: ux.message,
      });
      throw error;
    }
  };

  const handleSend = async (payload: { text: string; replyTo?: string; attachmentMediaIds: string[] }) => {
    await sendWithPending(payload);
  };

  const readTimerRef = useRef<number | null>(null);
  const lastMarkedRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!activeConversationId || !latestMessageSeq || !isAtBottom || effectiveStatus?.mode === "BANNED") return;
    const previous = lastMarkedRef.current[activeConversationId] ?? 0;
    if (latestMessageSeq <= previous) return;

    if (readTimerRef.current) window.clearTimeout(readTimerRef.current);
    readTimerRef.current = window.setTimeout(() => {
      void markRead.mutateAsync({ conversationId: activeConversationId, lastReadSeq: latestMessageSeq });
      if (authToken) {
        const socket = connectChatSocket(authToken);
        socket?.emit("chat:read", {
          conversationId: activeConversationId,
          lastReadSeq: latestMessageSeq,
        });
      }
      lastMarkedRef.current[activeConversationId] = latestMessageSeq;
    }, READ_DEBOUNCE_MS);

    return () => {
      if (readTimerRef.current) window.clearTimeout(readTimerRef.current);
    };
  }, [activeConversationId, authToken, effectiveStatus?.mode, isAtBottom, latestMessageSeq, markRead]);

  const jumpToLatest = () => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    setShowJumpToLatest(false);
    setNewMessagesFromSeq(null);
  };

  const canEditMessageByPolicy = (message: ChatMessage) => {
    const isMine = message.sender_id === currentUserId;
    return canPerformByPolicy(conversationSettings.edit_policy, isMine, Boolean(canManage));
  };

  const canDeleteMessageByPolicy = (message: ChatMessage) => {
    const isMine = message.sender_id === currentUserId;
    return canPerformByPolicy(conversationSettings.delete_policy, isMine, Boolean(canManage));
  };

  const handlePinToggle = async (messageId: string, shouldPin: boolean) => {
    if (!selectedConversation?.id) return;
    try {
      if (shouldPin) {
        await pinMessage.mutateAsync({ conversationId: selectedConversation.id, messageId });
      } else {
        await unpinMessage.mutateAsync({ conversationId: selectedConversation.id, messageId });
      }
    } catch (error) {
      applyChatError(error);
    }
  };

  const handleCreateMessageBookmark = async (messageId: string) => {
    if (!selectedConversation?.id) return;
    if (bookmarkedMessageIds.has(messageId)) return;
    const message = messages.find((item) => item.id === messageId);
    const label = (message?.body_text || "Message bookmark").slice(0, 60);
    try {
      await createBookmark.mutateAsync({
        conversationId: selectedConversation.id,
        payload: {
          type: "MESSAGE",
          label,
          messageId,
        },
      });
      toast({ title: "Bookmark added", description: "Message added to bookmarks." });
    } catch (error) {
      applyChatError(error);
    }
  };

  const handleMentionClick = async (userId: string) => {
    if (!userId) return;
    if (userId === currentUserId) return;

    try {
      const response = await createDm.mutateAsync(userId);
      navigate(`/chat/${response.conversation.id}`);
    } catch (error) {
      applyChatError(error);
    }
  };

  const backToChats = () => {
    setSearchParams({});
    navigate("/chat");
  };

  const openShareLink = (link: string) => {
    const parsed = new URL(link, window.location.origin);
    if (parsed.origin === window.location.origin) {
      navigate(`${parsed.pathname}${parsed.search}`);
      return;
    }
    window.location.assign(link);
  };

  const handleShareLink = async () => {
    if (!selectedConversation?.id) return;

    try {
      const response = await createShareLink.mutateAsync(selectedConversation.id);
      const shareUrl = buildShareLinkUrl(response, threadRootId, focusMessageId);

      try {
        await navigator.clipboard.writeText(shareUrl);
        toast({
          title: "Link copied",
          description: "Conversation link copied to clipboard.",
          action: (
            <ToastAction altText="Open shared conversation" onClick={() => openShareLink(shareUrl)}>
              Open
            </ToastAction>
          ),
        });
      } catch {
        setShareLinkFallback(shareUrl);
      }
    } catch (error) {
      applyChatError(error);
    }
  };

  return (
    <div
      className={cn(
        "grid min-h-[calc(100svh-11rem)] gap-4 lg:h-[calc(100svh-11rem)]",
        isSidebarCollapsed ? "lg:grid-cols-[68px,1fr]" : "lg:grid-cols-[320px,1fr]",
      )}
    >
      <div className="min-h-[5rem] lg:min-h-0">
        {isSidebarCollapsed ? (
          <div className="flex h-full flex-col items-center gap-2 rounded-lg border bg-card p-2">
            <Button
              size="icon"
              variant="outline"
              onClick={() => setIsSidebarCollapsed(false)}
              aria-label="Expand chat list"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
            <p className="text-xs text-muted-foreground">{conversations.length} chats</p>
          </div>
        ) : (
          <div className="flex h-full min-h-[20rem] flex-col space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button className="min-w-[10rem] flex-1 sm:flex-none" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New chat
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setIsSidebarCollapsed(true)}
                aria-label="Collapse chat list"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
              {canShowModeration && (
                <Button
                  variant={isModerationPanelOpen ? "default" : "outline"}
                  size="icon"
                  onClick={() => setIsModerationPanelOpen((prev) => !prev)}
                  aria-label={isModerationPanelOpen ? "Hide moderation tools" : "Show moderation tools"}
                >
                  <ShieldAlert className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setInviteOpen(true)}
                disabled={!selectedConversation || !canInvite}
                aria-label="Invite members"
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <ConversationList
                conversations={conversations}
                selectedConversationId={routeConversationId}
                search={search}
                onSearch={setSearch}
                onSelect={(conversationId) => navigate(`/chat/${conversationId}`)}
              />
            </div>
            {canShowModeration && isModerationPanelOpen && (
              <div className="rounded-md border bg-card p-2">
                <ModerationControls
                  conversation={selectedConversation}
                  canModerate={canModerate}
                  onModerate={async (payload) => {
                    if (!selectedConversation?.id) return;
                    try {
                      await moderateConversation.mutateAsync({
                        conversationId: selectedConversation.id,
                        payload,
                      });
                      toast({ title: "Moderation updated", description: `${payload.action} applied.` });
                    } catch (error) {
                      applyChatError(error);
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="relative flex h-full min-h-[24rem] flex-col overflow-hidden rounded-lg border bg-card">
        <ChatHeader
          conversation={selectedConversation}
          onOpenSettings={() => setSettingsOpen(true)}
          onShareLink={selectedConversation ? handleShareLink : undefined}
          isSharingLink={createShareLink.isPending}
        />

        {effectiveStatus?.mode && !routeAccessState && (
          <ChatStatusBanner
            mode={effectiveStatus.mode}
            message={effectiveStatus.message}
            until={effectiveStatus.until}
          />
        )}

        {routeAccessState ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">{routeAccessState.title}</h3>
              <p className="max-w-md text-sm text-muted-foreground">{routeAccessState.description}</p>
            </div>
            {!resolveConversationQuery.isLoading ? (
              <Button variant="outline" onClick={backToChats}>
                Back to chats
              </Button>
            ) : null}
          </div>
        ) : !selectedConversation ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation from the left list.
          </div>
        ) : (
          <>
            <div ref={messageViewportRef} className="min-h-0 flex-1 overflow-y-auto">
              <MessageList
                conversationId={selectedConversation.id}
                messages={messages}
                currentUserId={currentUserId}
                canMutate={!composerDisabled}
                mentionDisplayById={mentionDisplayById}
                pendingMessages={pendingUiMessages.filter((item) => item.conversationId === selectedConversation.id)}
                attachmentMediaById={attachmentMediaById}
                isLoading={messagesQuery.isLoading}
                canFetchNewer={!isFetchingNewerMessages}
                isFetchingNewer={isFetchingNewerMessages}
                isUpToDate={messagesQuery.isUpToDate}
                focusMessageId={focusMessageId}
                newMessagesFromSeq={newMessagesFromSeq}
                onFetchNewer={() => fetchNewerMessages()}
                onMentionClick={handleMentionClick}
                onRetryPendingMessage={(localId) => {
                  const pending = pendingUiMessages.find((item) => item.localId === localId);
                  if (!pending) return;
                  void sendWithPending(
                    {
                      text: pending.text,
                      replyTo: pending.replyTo,
                      alsoToChannel: pending.alsoToChannel,
                      attachmentMediaIds: pending.attachmentMediaIds,
                    },
                    localId,
                  );
                }}
                onDiscardPendingMessage={removePendingMessage}
                onReply={(messageId) => navigate(`/chat/${selectedConversation.id}/thread/${messageId}`)}
                onReact={async (messageId, emoji, op) => {
                  try {
                    await reactMessage.mutateAsync({ conversationId: selectedConversation.id, messageId, emoji, op });
                  } catch (error) {
                    applyChatError(error);
                  }
                }}
                onEdit={async (messageId, text) => {
                  try {
                    await editMessage.mutateAsync({ conversationId: selectedConversation.id, messageId, text });
                  } catch (error) {
                    applyChatError(error);
                  }
                }}
                onDelete={async (messageId) => {
                  try {
                    await deleteMessage.mutateAsync({ conversationId: selectedConversation.id, messageId });
                  } catch (error) {
                    applyChatError(error);
                  }
                }}
                onTogglePin={handlePinToggle}
                onBookmark={handleCreateMessageBookmark}
                isMessagePinned={(messageId) => pinnedMessageIds.has(messageId)}
                isMessageBookmarked={(messageId) => bookmarkedMessageIds.has(messageId)}
                canEditMessage={canEditMessageByPolicy}
                canDeleteMessage={canDeleteMessageByPolicy}
              />
            </div>

            {showJumpToLatest && (
              <Button
                className="absolute bottom-24 right-6 z-10 shadow-md"
                size="sm"
                onClick={jumpToLatest}
                aria-label="Jump to latest message"
              >
                <ArrowDown className="mr-1 h-4 w-4" />
                Jump to latest
              </Button>
            )}

            <TypingIndicator
              userIds={realtime.typingByConversation[selectedConversation.id] ?? []}
              userDisplayById={mentionDisplayById}
            />

            <div className="sticky bottom-0 z-10 border-t bg-card p-3">
              <Composer
                disabled={composerDisabled}
                disabledReason={effectiveStatus?.message}
                isSending={sendMessage.isPending}
                mentionPolicy={conversationSettings.mention_policy}
                isAdminMentionAllowed={Boolean(canManage)}
                onTyping={emitTyping}
                onSend={handleSend}
              />
            </div>
          </>
        )}
      </div>

      <ThreadPanel
        open={Boolean(selectedConversation && threadRootId)}
        onOpenChange={(open) => {
          if (!selectedConversation) return;
          if (!open) navigate(`/chat/${selectedConversation.id}`);
        }}
        conversationId={selectedConversation?.id}
        threadRootId={threadRootId}
        rootMessage={threadRootMessage}
        currentUserId={currentUserId}
        canMutate={!composerDisabled}
        mentionDisplayById={mentionDisplayById}
        onMentionClick={handleMentionClick}
        statusBannerMode={effectiveStatus?.mode}
        statusBannerMessage={effectiveStatus?.message}
        statusBannerUntil={effectiveStatus?.until}
        attachmentMediaById={attachmentMediaById}
        onReplySubmit={async ({ text, replyTo, alsoToChannel }) => {
          await sendWithPending({ text, replyTo, alsoToChannel, attachmentMediaIds: [] });
        }}
      />

      <ConversationSettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        conversation={selectedConversation}
        canManage={Boolean(canManage)}
        canMutateItems={!composerDisabled}
        isSuperAdmin={currentRole === "SUPER_ADMIN"}
        pins={pinsQuery.data?.items ?? []}
        pinsLoading={pinsQuery.isLoading}
        bookmarks={bookmarksQuery.data?.items ?? []}
        bookmarksLoading={bookmarksQuery.isLoading}
        bookmarkMediaById={attachmentMediaById}
        onSave={async (payload) => {
          if (!selectedConversation?.id) return;
          try {
            await updateSettings.mutateAsync({ conversationId: selectedConversation.id, payload });
            toast({ title: "Saved", description: "Conversation settings updated." });
          } catch (error) {
            applyChatError(error);
          }
        }}
        onArchive={async () => {
          if (!selectedConversation?.id) return;
          try {
            await archiveConversation.mutateAsync(selectedConversation.id);
            setChatStatus({ code: "CHAT_ARCHIVED", mode: "READ_ONLY", message: "Conversation is archived and read-only." });
            toast({ title: "Archived", description: "Conversation is now read-only." });
          } catch (error) {
            applyChatError(error);
          }
        }}
        onUnarchive={async () => {
          if (!selectedConversation?.id) return;
          try {
            await unarchiveConversation.mutateAsync(selectedConversation.id);
            setChatStatus(null);
            toast({ title: "Unarchived", description: "Conversation is active again." });
          } catch (error) {
            applyChatError(error);
          }
        }}
        onDelete={async () => {
          if (!selectedConversation?.id) return;
          try {
            await deleteConversation.mutateAsync(selectedConversation.id);
            toast({ title: "Deleted", description: "Conversation removed." });
            navigate("/chat");
          } catch (error) {
            applyChatError(error);
          }
        }}
        onJumpToMessage={(messageId) => {
          if (!selectedConversation?.id) return;
          navigate(`/chat/${selectedConversation.id}?focusMessageId=${encodeURIComponent(messageId)}`);
          setSettingsOpen(false);
        }}
        onUnpinMessage={async (messageId) => {
          if (!selectedConversation?.id) return;
          try {
            await unpinMessage.mutateAsync({ conversationId: selectedConversation.id, messageId });
          } catch (error) {
            applyChatError(error);
          }
        }}
        onCreateBookmark={async (payload) => {
          if (!selectedConversation?.id) return;
          try {
            await createBookmark.mutateAsync({ conversationId: selectedConversation.id, payload });
            toast({ title: "Bookmark added", description: "Bookmark created." });
          } catch (error) {
            applyChatError(error);
          }
        }}
        onDeleteBookmark={async (bookmarkId) => {
          if (!selectedConversation?.id) return;
          try {
            await deleteBookmark.mutateAsync({ bookmarkId, conversationId: selectedConversation.id });
            toast({ title: "Bookmark deleted", description: "Bookmark removed." });
          } catch (error) {
            applyChatError(error);
          }
        }}
      />

      <CreateConversationModal
        open={createOpen}
        currentUserId={currentUserId}
        onOpenChange={setCreateOpen}
        onCreateDm={async (otherUserId) => {
          const response = await createDm.mutateAsync(otherUserId);
          const conversationId = response.conversation.id;
          navigate(`/chat/${conversationId}`);
          toast({ title: "DM ready", description: "Direct message opened." });
        }}
        onCreateConversation={async (payload) => {
          const response = await createConversation.mutateAsync(payload);
          navigate(`/chat/${response.conversation.id}`);
          toast({ title: "Conversation created", description: conversationTitle(response.conversation as ChatConversationListItem) });
        }}
      />

      <InviteMembersModal
        open={inviteOpen}
        conversation={selectedConversation}
        currentUserId={currentUserId}
        canInvite={Boolean(canInvite)}
        onOpenChange={setInviteOpen}
        onInvite={async (userIds) => {
          if (!selectedConversation?.id) return;
          await inviteMembers.mutateAsync({ conversationId: selectedConversation.id, userIds });
          toast({ title: "Invites sent", description: `${userIds.length} member(s) invited.` });
        }}
      />

      <Dialog open={Boolean(shareLinkFallback)} onOpenChange={(open) => !open && setShareLinkFallback(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy conversation link</DialogTitle>
            <DialogDescription>
              Clipboard access is unavailable. Copy this secure chat link manually.
            </DialogDescription>
          </DialogHeader>
          <Input ref={shareLinkInputRef} value={shareLinkFallback ?? ""} readOnly aria-label="Conversation share link" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareLinkFallback(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                if (!shareLinkFallback) return;
                openShareLink(shareLinkFallback);
              }}
            >
              Open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="hidden">
        {realtime.isConnected ? "socket-connected" : "socket-disconnected"}
      </div>
    </div>
  );
}
