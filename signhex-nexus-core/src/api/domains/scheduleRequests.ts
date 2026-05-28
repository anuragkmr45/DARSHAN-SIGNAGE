import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type {
  ScheduleRequest,
  ScheduleRequestListParams,
  ScheduleRequestListResponse,
  ScheduleRequestPayload,
  ScheduleRequestPublishResponse,
  ScheduleRequestReviewResponse,
  ScheduleRequestStatusSummary,
} from "../types";

export const scheduleRequestsApi = {
  list: (params?: ScheduleRequestListParams) =>
    apiClient.request<ScheduleRequestListResponse>({
      path: endpoints.scheduleRequests.base,
      method: "GET",
      query: params,
    }),
  statusSummary: (params?: Pick<ScheduleRequestListParams, "q" | "date_field" | "date_from" | "date_to">) =>
    apiClient.request<ScheduleRequestStatusSummary>({
      path: endpoints.scheduleRequests.statusSummary,
      method: "GET",
      query: params,
    }),
  approve: (requestId: string, payload?: { comment?: string }) =>
    apiClient.request<ScheduleRequestReviewResponse>({
      path: endpoints.scheduleRequests.approve(requestId),
      method: "POST",
      body: payload,
    }),
  publish: (requestId: string) =>
    apiClient.request<ScheduleRequestPublishResponse>({
      path: endpoints.scheduleRequests.publish(requestId),
      method: "POST",
    }),
  reject: (requestId: string, payload?: { comment?: string }) =>
    apiClient.request<ScheduleRequestReviewResponse>({
      path: endpoints.scheduleRequests.reject(requestId),
      method: "POST",
      body: payload,
    }),
  cancel: (requestId: string) =>
    apiClient.request<ScheduleRequestReviewResponse>({
      path: endpoints.scheduleRequests.cancel(requestId),
      method: "POST",
    }),
  takeDown: (requestId: string, payload?: { reason?: string }) =>
    apiClient.request<ScheduleRequestReviewResponse>({
      path: endpoints.scheduleRequests.takeDown(requestId),
      method: "POST",
      body: payload,
    }),
  create: (payload: ScheduleRequestPayload) =>
    apiClient.request<ScheduleRequest>({
      path: endpoints.scheduleRequests.base,
      method: "POST",
      body: payload,
    }),
};
