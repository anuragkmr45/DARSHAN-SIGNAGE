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
