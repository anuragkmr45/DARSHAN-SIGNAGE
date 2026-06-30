import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type {
  PaginatedResponse,
  PaginationParams,
  Publish,
  Schedule,
  ScheduleItem,
  ScheduleItemPayload,
} from "../types";

export interface SchedulePayload {
  name: string;
  description?: string;
  timezone?: string;
  start_at: string;
  end_at: string;
  is_active?: boolean;
}

export const schedulesApi = {
  create: (payload: SchedulePayload) =>
    apiClient.request<Schedule>({
      path: endpoints.schedules.base,
      method: "POST",
      body: payload,
    }),

  getById: (scheduleId: string) =>
    apiClient.request<Schedule>({
      path: endpoints.schedules.byId(scheduleId),
      method: "GET",
    }),

  update: (scheduleId: string, payload: Partial<SchedulePayload>) =>
    apiClient.request<Schedule>({
      path: endpoints.schedules.byId(scheduleId),
      method: "PATCH",
      body: payload,
    }),

  list: (params?: PaginationParams & { page: number; limit: number; is_active?: boolean }) =>
    apiClient.request<PaginatedResponse<Schedule>>({
      path: endpoints.schedules.base,
      method: "GET",
      query: params,
    }),

  publish: (
    scheduleId: string,
    payload: { screen_ids?: string[]; screen_group_ids?: string[] },
  ) =>
    apiClient.request<Publish>({
      path: endpoints.schedules.publish(scheduleId),
      method: "POST",
      body: payload,
    }),

  getPublish: (publishId: string) =>
    apiClient.request<Publish>({
      path: endpoints.schedules.publishById(publishId),
      method: "GET",
    }),

  takeDownPublish: (publishId: string, payload?: { reason?: string }) =>
    apiClient.request<Publish & { resolved_screen_ids?: string[]; message?: string }>({
      path: endpoints.schedules.takeDownPublish(publishId),
      method: "POST",
      body: payload,
    }),

  listPublishes: (scheduleId: string) =>
    apiClient.request<{ items: Publish[] }>({
      path: endpoints.schedules.publishesForSchedule(scheduleId),
      method: "GET",
    }),

  updateTarget: (
    publishId: string,
    targetId: string,
    payload: { status: string; error?: string | null },
  ) =>
    apiClient.request<Publish>({
      path: endpoints.schedules.publishTarget(publishId, targetId),
      method: "PATCH",
      body: payload,
    }),

  remove: (scheduleId: string) =>
    apiClient.request<void>({
      path: endpoints.schedules.byId(scheduleId),
      method: "DELETE",
    }),

  createItem: (scheduleId: string, payload: ScheduleItemPayload) =>
    apiClient.request<ScheduleItem>({
      path: endpoints.schedules.items(scheduleId),
      method: "POST",
      body: payload,
    }),
};
