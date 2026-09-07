import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { MediaAsset, MediaListParams, MediaType, PaginatedResponse } from "../types";

export interface PresignPayload {
  filename: string;
  display_name?: string;
  content_type: string;
  size: number;
}

export interface PresignResponse {
  upload_url: string;
  media_id: string;
  bucket: string;
  object_key: string;
  expires_in: number;
}

export interface MediaCompletionPayload {
  content_type?: string;
  size?: number;
  width?: number;
  height?: number;
  duration_seconds?: number;
}

export interface UploadSessionCreatePayload extends PresignPayload {
  checksum_sha256: string;
}

export interface UploadSessionPart {
  part_number: number;
  etag: string;
  size?: number | null;
}

export interface UploadSessionResponse {
  session_id: string;
  media_id: string;
  state: "INITIALIZING" | "ACTIVE" | "FINALIZING" | "COMPLETED" | "ABORTED" | "EXPIRED" | "FAILED";
  strategy: "single" | "multipart";
  expires_at: string;
  part_size: number | null;
  part_count: number;
  uploaded_parts: UploadSessionPart[];
  upload_url?: string;
  media: MediaAsset | null;
  failure_reason?: string | null;
}

export interface MediaUploadPolicy {
  max_bytes: number;
  max_mb: number;
  multipart_threshold_bytes: number;
  part_size_bytes: number;
  multipart_concurrency: number;
  allowed_mime_types: string[];
}

export interface UploadPartUrl {
  part_number: number;
  upload_url: string;
  expires_in: number;
}

export interface MediaMetadataPayload {
  name: string;
  type: MediaType;
  source_url?: string;
}

const normalizePaginatedResponse = <T>(
  payload: PaginatedResponse<T> | { items?: T[]; pagination?: { page?: number; limit?: number; total?: number } },
  fallbackPage = 1,
  fallbackLimit = 10,
): PaginatedResponse<T> => {
  if ("page" in payload && "limit" in payload && "total" in payload) {
    return payload;
  }

  return {
    items: payload.items ?? [],
    page: payload.pagination?.page ?? fallbackPage,
    limit: payload.pagination?.limit ?? fallbackLimit,
    total: payload.pagination?.total ?? (payload.items?.length ?? 0),
  };
};

export const mediaApi = {
  getUploadPolicy: () =>
    apiClient.request<MediaUploadPolicy>({
      path: endpoints.media.uploadPolicy,
      method: "GET",
    }),

  // Create a metadata-only media entry (no upload).
  createMetadata: (payload: MediaMetadataPayload) =>
    apiClient.request<MediaAsset>({
      path: endpoints.media.base,
      method: "POST",
      body: payload,
    }),

  presignUpload: (payload: PresignPayload) =>
    apiClient.request<PresignResponse>({
      path: endpoints.media.presignUpload,
      method: "POST",
      body: payload,
    }),

  createUploadSession: (payload: UploadSessionCreatePayload, idempotencyKey: string) =>
    apiClient.request<UploadSessionResponse>({
      path: endpoints.media.uploadSessions,
      method: "POST",
      body: payload,
      headers: { "Idempotency-Key": idempotencyKey },
      timeoutMs: 30_000,
    }),

  getUploadSession: (sessionId: string) =>
    apiClient.request<UploadSessionResponse>({
      path: endpoints.media.uploadSession(sessionId),
      method: "GET",
      timeoutMs: 30_000,
    }),

  presignUploadParts: (sessionId: string, partNumbers: number[]) =>
    apiClient.request<{ session_id: string; parts: UploadPartUrl[] }>({
      path: endpoints.media.uploadSessionParts(sessionId),
      method: "POST",
      body: { part_numbers: partNumbers },
      timeoutMs: 30_000,
    }),

  completeUploadSession: (
    sessionId: string,
    payload: { parts?: Array<{ part_number: number; etag: string }>; width?: number; height?: number; duration_seconds?: number },
  ) =>
    apiClient.request<UploadSessionResponse>({
      path: endpoints.media.uploadSessionComplete(sessionId),
      method: "POST",
      body: payload,
      timeoutMs: 10 * 60_000,
    }),

  abortUploadSession: (sessionId: string) =>
    apiClient.request<{ session_id: string; state: "ABORTED" }>({
      path: endpoints.media.uploadSession(sessionId),
      method: "DELETE",
      timeoutMs: 30_000,
    }),

  complete: (mediaId: string, payload: MediaCompletionPayload) =>
    apiClient.request<MediaAsset>({
      path: endpoints.media.complete(mediaId),
      method: "POST",
      body: payload,
    }),

  list: (params?: MediaListParams) =>
    apiClient
      .request<PaginatedResponse<MediaAsset> | { items?: MediaAsset[]; pagination?: { page?: number; limit?: number; total?: number } }>({
        path: endpoints.media.base,
        method: "GET",
        query: params,
      })
      .then((response) => normalizePaginatedResponse(response, params?.page ?? 1, params?.limit ?? 10)),

  getById: (mediaId: string) =>
    apiClient.request<MediaAsset>({
      path: endpoints.media.byId(mediaId),
      method: "GET",
    }),

  remove: (mediaId: string, options?: { hard?: boolean }) =>
    apiClient.request<{ message?: string } | void>({
      path: endpoints.media.byId(mediaId),
      method: "DELETE",
      query: options?.hard ? { hard: true } : undefined,
    }),
};
