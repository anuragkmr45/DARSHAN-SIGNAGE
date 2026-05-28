import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type {
  Notification,
  NotificationUnreadCountResponse,
  PaginatedResponse,
  PaginationParams,
} from "../types";

export const notificationsApi = {
  list: (params?: PaginationParams & { read?: boolean }) =>
    apiClient.request<PaginatedResponse<Notification>>({
      path: endpoints.notifications.base,
      method: "GET",
      query: params,
    }),

  getById: (notificationId: string) =>
    apiClient.request<Notification>({
      path: endpoints.notifications.byId(notificationId),
      method: "GET",
    }),

  markRead: (notificationId: string) =>
    apiClient.request<void>({
      path: endpoints.notifications.markRead(notificationId),
      method: "POST",
    }),

  markAllRead: () =>
    apiClient.request<void>({
      path: endpoints.notifications.markAllRead,
      method: "POST",
    }),

  getUnreadCount: () =>
    apiClient.request<NotificationUnreadCountResponse>({
      path: endpoints.notifications.unreadCount,
      method: "GET",
    }),

  remove: (notificationId: string) =>
    apiClient.request<void>({
      path: endpoints.notifications.byId(notificationId),
      method: "DELETE",
    }),
};
