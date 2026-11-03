import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { LiveDraftDetail, LiveDraftReview, LiveDraftReviewPayload, LiveFallbackPreparation, LiveFallbackPreview } from "../liveTypes";
import type { ScheduleRequest } from "../types";

export const liveFallbacksApi = {
  prepare: (presentationId: string, retryFailed = false) => apiClient.request<LiveFallbackPreparation>({
    path: endpoints.liveFallbacks.base, method: "POST", body: { presentation_id: presentationId, retry_failed: retryFailed },
  }),
  get: (id: string) => apiClient.request<LiveFallbackPreparation>({ path: endpoints.liveFallbacks.byId(id), method: "GET" }),
  preview: (id: string) => apiClient.request<LiveFallbackPreview>({ path: endpoints.liveFallbacks.preview(id), method: "GET" }),
  getDraft: (id: string) => apiClient.request<LiveDraftDetail>({ path: endpoints.liveDrafts.byId(id), method: "GET" }),
  reviewDraft: (id: string, payload: LiveDraftReviewPayload) => apiClient.request<LiveDraftReview>({
    path: endpoints.liveDrafts.review(id), method: "POST", body: payload,
  }),
  submitDraft: (id: string, payload: { request_id: string; expected_revision: number; expected_live_fingerprint: string; notes?: string }) =>
    apiClient.request<ScheduleRequest>({ path: endpoints.liveDrafts.submit(id), method: "POST", body: payload }),
};
