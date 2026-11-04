import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { notificationsApi } from "@/api/domains/notifications";
import type { ChatNotificationData, Notification } from "@/api/types";
import { notificationUnreadCountQueryKey } from "@/hooks/notifications/useNotificationUnreadCount";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatChatTime } from "@/lib/chatTime";
import { useAppSelector } from "@/store/hooks";
import { useToast } from "@/hooks/use-toast";

type ReadFilter = "all" | "unread" | "read";

const toChatData = (notification: Notification): ChatNotificationData | null => {
  const data = notification.data;
  if (!data || typeof data !== "object") return null;
  const typed = data as Record<string, unknown>;
  if (!typed.conversationId || typeof typed.conversationId !== "string") return null;
  return {
    conversationId: typed.conversationId as string,
    messageId: typeof typed.messageId === "string" ? typed.messageId : undefined,
    threadRootId: typeof typed.threadRootId === "string" ? typed.threadRootId : undefined,
    notificationType:
      typed.notificationType === "DM" || typed.notificationType === "MENTION" || typed.notificationType === "THREAD_REPLY"
        ? (typed.notificationType as "DM" | "MENTION" | "THREAD_REPLY")
        : "DM",
    snippet: typeof typed.snippet === "string" ? typed.snippet : undefined,
  };
};

export default function Notifications() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const queryClient = useQueryClient();
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);

  const unreadCountQuery = useQuery({
    queryKey: notificationUnreadCountQueryKey,
    queryFn: () => notificationsApi.getUnreadCount(),
  });

  const notificationsQuery = useQuery({
    queryKey: ["notifications", "list", readFilter, page],
    queryFn: () =>
      notificationsApi.list({
        page,
        limit: 50,
        read: readFilter === "all" ? undefined : readFilter === "read",
      }),
  });

  const notifications = useMemo(() => notificationsQuery.data?.items ?? [], [notificationsQuery.data?.items]);
  const pagination = notificationsQuery.data?.pagination;
  // The list count is computed from notification rows; the separate counter can lag it.
  const unreadCount = pagination?.unread_total ?? unreadCountQuery.data?.unread_total;
  const totalPages = Math.max(1, Math.ceil((pagination?.total ?? 0) / (pagination?.limit ?? 50)));

  useEffect(() => {
    if (pagination && page > totalPages) setPage(totalPages);
  }, [page, pagination, totalPages]);

  const refreshNotifications = () => {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markRead(notificationId),
    onSuccess: refreshNotifications,
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => { setActionError(null); refreshNotifications(); },
    onError: () => setActionError("Could not mark all notifications read. Try again."),
  });

  const markOneRead = (notificationId: string) => {
    setActionError(null);
    markReadMutation.mutate(notificationId, {
      onError: () => setActionError("Could not mark this notification read. Try again."),
    });
  };

  const openConversation = (notification: Notification, data: ChatNotificationData) => {
    if (!notification.read && !notification.read_at) {
      void notificationsApi.markRead(notification.id).then(refreshNotifications).catch(() => {
        toast({ title: "Notification still unread", description: "The conversation will open, but we could not update its read status.", variant: "destructive" });
      });
    }

    const conversationPath = `/chat/${encodeURIComponent(data.conversationId)}`;
    const target = data.threadRootId
      ? `${conversationPath}/thread/${encodeURIComponent(data.threadRootId)}${data.messageId ? `?focusReplyId=${encodeURIComponent(data.messageId)}` : ""}`
      : data.messageId
      ? `${conversationPath}?focusMessageId=${encodeURIComponent(data.messageId)}`
      : conversationPath;
    navigate(target);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BellRing aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground">Messages and activity for your account.</p>
        </div>
        <Button size="sm" variant="outline" className="self-start sm:self-auto"
          onClick={() => { setActionError(null); markAllMutation.mutate(); }}
          disabled={markAllMutation.isPending || unreadCount === 0}>
          <CheckCheck aria-hidden="true" className="mr-2 h-4 w-4" />
          {markAllMutation.isPending ? "Marking read…" : "Mark all read"}
        </Button>
      </header>

      <Tabs value={readFilter} onValueChange={(value) => { setReadFilter(value as ReadFilter); setPage(1); setActionError(null); }}>
        <TabsList className="h-auto max-w-full justify-start gap-1 overflow-x-auto p-1">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread{unreadCount === undefined ? "" : ` (${unreadCount})`}</TabsTrigger>
          <TabsTrigger value="read">Read</TabsTrigger>
        </TabsList>
      </Tabs>

      {actionError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{actionError}</div>}

      {notificationsQuery.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">Loading notifications…</p>
      ) : notificationsQuery.isError && !notificationsQuery.data ? (
        <div role="alert" className="rounded-xl border border-border px-5 py-8 text-center">
          <p className="font-medium">Could not load notifications</p>
          <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => void notificationsQuery.refetch()}>Retry</Button>
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-xl border border-border px-5 py-10 text-center">
          <p className="font-medium">{readFilter === "unread" ? "You're all caught up" : readFilter === "read" ? "No read notifications" : "No notifications yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{readFilter === "unread" ? "New activity will appear here." : "Activity for your account will appear here."}</p>
        </div>
      ) : (
        <div aria-label="Notifications" className="divide-y divide-border/70 rounded-xl border border-border bg-background">
          {notifications.map((notification) => {
            const chatData = toChatData(notification);
            const isRead = Boolean(notification.read || notification.read_at);
            const detail = chatData?.snippet?.replace(/@([0-9a-fA-F-]{36})/g, (_token, id: string) => id === currentUserId ? "@you" : "@User")
              || notification.message || notification.body || "Notification";
            return (
              <article key={notification.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!isRead && <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />}
                    <h2 className="text-sm font-semibold">{notification.title || "Notification"}</h2>
                    <span className="text-xs text-muted-foreground">{isRead ? "Read" : "Unread"}</span>
                  </div>
                  <p className="break-words text-sm text-muted-foreground">{detail}</p>
                  {notification.created_at && <time className="block text-xs text-muted-foreground" dateTime={notification.created_at}>{formatChatTime(notification.created_at)}</time>}
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                  {chatData ? (
                    <Button variant="outline" size="sm" onClick={() => openConversation(notification, chatData)}>Open conversation</Button>
                  ) : !isRead ? (
                    <Button variant="outline" size="sm" onClick={() => markOneRead(notification.id)} disabled={markReadMutation.isPending}>Mark read</Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {notificationsQuery.isError && notificationsQuery.data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <span>Could not refresh notifications. Showing the last loaded list.</span>
          <Button variant="outline" size="sm" onClick={() => void notificationsQuery.refetch()}>Retry</Button>
        </div>
      )}
      {(pagination?.total ?? 0) > (pagination?.limit ?? 50) && (
        <nav aria-label="Notification pages" className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>Page {page} of {totalPages} · {pagination?.total} notifications</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </div>
        </nav>
      )}
    </div>
  );
}
