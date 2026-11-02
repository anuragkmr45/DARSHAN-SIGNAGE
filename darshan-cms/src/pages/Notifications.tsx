import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { notificationsApi } from "@/api/domains/notifications";
import type { ChatNotificationData, Notification } from "@/api/types";
import { notificationUnreadCountQueryKey } from "@/hooks/notifications/useNotificationUnreadCount";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatChatTime } from "@/lib/chatTime";
import { useAppSelector } from "@/store/hooks";

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
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const queryClient = useQueryClient();
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [page, setPage] = useState(1);

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
  const unreadCount = unreadCountQuery.data?.unread_total ?? pagination?.unread_total ?? 0;
  const totalPages = Math.max(1, Math.ceil((pagination?.total ?? 0) / (pagination?.limit ?? 50)));

  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markRead(notificationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: notificationUnreadCountQueryKey });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: notificationUnreadCountQueryKey });
    },
  });

  const openNotification = async (notification: Notification) => {
    const data = toChatData(notification);
    if (!notification.read) {
      await markReadMutation.mutateAsync(notification.id);
    }
    if (!data) return;

    const target = data.threadRootId
      ? `/chat/${data.conversationId}/thread/${encodeURIComponent(data.threadRootId)}`
      : data.messageId
      ? `/chat/${data.conversationId}?focusMessageId=${encodeURIComponent(data.messageId)}`
      : `/chat/${data.conversationId}`;
    navigate(target);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            Notifications
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => markAllMutation.mutate()} disabled={markAllMutation.isPending} className="w-full sm:w-auto">
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all read
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <Tabs value={readFilter} onValueChange={(value) => { setReadFilter(value as ReadFilter); setPage(1); }}>
            <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto p-1">
              <TabsTrigger value="all" className="shrink-0">All</TabsTrigger>
              <TabsTrigger value="unread" className="shrink-0">Unread ({unreadCount})</TabsTrigger>
              <TabsTrigger value="read" className="shrink-0">Read</TabsTrigger>
            </TabsList>
          </Tabs>

          {notificationsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading notifications...</p>
          ) : notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notifications found.</p>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => {
                const chatData = toChatData(notification);
                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void openNotification(notification)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      notification.read || notification.read_at
                        ? "border-border bg-background"
                        : "border-primary/50 bg-primary/5"
                    }`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold">{notification.title || chatData?.notificationType || "Notification"}</p>
                        <p className="break-words text-xs text-muted-foreground">
                          {chatData?.snippet?.replace(/@([0-9a-fA-F-]{36})/g, (_token, id: string) => id === currentUserId ? "@you" : "@User") || notification.message || notification.body || "Notification"}
                        </p>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {formatChatTime(notification.created_at)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {(pagination?.total ?? 0) > (pagination?.limit ?? 50) && (
            <div className="flex items-center justify-between gap-3 pt-2 text-sm">
              <span>Page {page} of {totalPages} · {pagination?.total ?? 0} notifications</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Supports DM, mention, and thread-reply notifications with chat deep links.
      </p>
    </div>
  );
}
