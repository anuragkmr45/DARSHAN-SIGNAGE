import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "@/api/domains/notifications";
import type { NotificationUnreadCountResponse } from "@/api/types";
import { connectNotificationsSocket } from "@/lib/notificationsSocket";
import { useAppSelector } from "@/store/hooks";

type NotificationCountPayload = {
  unread_total?: number;
};

export const notificationUnreadCountQueryKey = ["notifications", "unread-count"] as const;

const toUnreadTotal = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return undefined;
  const total = (payload as NotificationCountPayload).unread_total;
  return typeof total === "number" && Number.isFinite(total) ? total : undefined;
};

export const useNotificationUnreadCount = () => {
  const queryClient = useQueryClient();
  const token = useAppSelector((state) => state.auth.token);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  const query = useQuery({
    queryKey: notificationUnreadCountQueryKey,
    enabled: Boolean(token),
    queryFn: () => notificationsApi.getUnreadCount(),
    staleTime: 15_000,
    refetchInterval: token && !isSocketConnected ? 60_000 : false,
    retry: (failureCount, error) => {
      const status = (error as { status?: number })?.status;
      if (status === 401 || status === 403) return false;
      return failureCount < 2;
    },
  });
  const { refetch } = query;

  useEffect(() => {
    if (!token) {
      setIsSocketConnected(false);
      return;
    }

    const socket = connectNotificationsSocket(token);
    if (!socket) return;

    const syncUnreadCount = () => {
      let didResolveAck = false;
      const timeout = window.setTimeout(() => {
        if (!didResolveAck) {
          void refetch();
        }
      }, 1500);

      socket.emit("notifications:sync", (ack?: NotificationUnreadCountResponse) => {
        didResolveAck = true;
        window.clearTimeout(timeout);
        const unreadTotal = toUnreadTotal(ack);
        if (typeof unreadTotal === "number") {
          queryClient.setQueryData<NotificationUnreadCountResponse>(notificationUnreadCountQueryKey, {
            unread_total: unreadTotal,
          });
          return;
        }
        void refetch();
      });
    };

    const onCount = (payload: NotificationCountPayload) => {
      const unreadTotal = toUnreadTotal(payload);
      if (typeof unreadTotal !== "number") return;
      queryClient.setQueryData<NotificationUnreadCountResponse>(notificationUnreadCountQueryKey, {
        unread_total: unreadTotal,
      });
    };

    const onConnect = () => {
      setIsSocketConnected(true);
      syncUnreadCount();
    };

    const onReconnect = () => {
      setIsSocketConnected(true);
      syncUnreadCount();
    };

    const onDisconnect = () => {
      setIsSocketConnected(false);
    };

    const onConnectError = () => {
      setIsSocketConnected(false);
      void refetch();
    };

    socket.on("connect", onConnect);
    socket.on("reconnect", onReconnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("notifications:count", onCount);

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("reconnect", onReconnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("notifications:count", onCount);
    };
  }, [queryClient, refetch, token]);

  const unreadTotal = useMemo(() => query.data?.unread_total ?? 0, [query.data?.unread_total]);
  const isLoadingInitial = query.isLoading && !query.data;

  return {
    ...query,
    unreadTotal,
    isLoadingInitial,
    isSocketConnected,
  };
};
