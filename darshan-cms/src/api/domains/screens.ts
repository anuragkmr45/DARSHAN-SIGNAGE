import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type {
  PaginatedResponse,
  PaginationParams,
  Screen,
  ScreenGroup,
  ScreenStatus,
  NowPlaying,
  ScreenNowPlayingResponse,
  ScreenScheduleTimelineResponse,
  ScreenAvailability,
  ScreenSnapshot,
  ScreenGroupAvailability,
  ScreenGroupNowPlaying,
  ScreensOverview,
  ScreenAspectRatioListResponse,
  ScreenFleetSummary,
  ScreenGroupListSummaryResponse,
  ScreenListSummaryResponse,
  ScreenDeliveryStatus,
  ScreenMediaCacheReportsResponse,
  ScreenDisplayState,
} from "../types";

export const screensApi = {
  // Screens
  list: (params?: PaginationParams & { status?: string }) =>
    apiClient.request<PaginatedResponse<Screen>>({
      path: endpoints.screens.base,
      method: "GET",
      query: params,
    }),

  listSummaries: (
    params?: PaginationParams & {
      status?: string;
      q?: string;
      include_media?: boolean;
      include_preview?: boolean;
    },
  ) =>
    apiClient.request<ScreenListSummaryResponse>({
      path: endpoints.screens.base,
      method: "GET",
      query: {
        ...params,
        include_summary: true,
      },
    }),

  getSummary: () =>
    apiClient.request<ScreenFleetSummary>({
      path: endpoints.screens.summary,
      method: "GET",
    }),

  getById: (screenId: string) =>
    apiClient.request<Screen>({
      path: endpoints.screens.byId(screenId),
      method: "GET",
    }),

  create: (payload: { name: string; location?: string }) =>
    apiClient.request<Screen>({
      path: endpoints.screens.base,
      method: "POST",
      body: payload,
    }),

  update: (id: string, payload: Partial<{ name: string; location?: string; is_active?: boolean }>) =>
    apiClient.request<Screen>({
      path: endpoints.screens.byId(id),
      method: "PATCH",
      body: payload,
    }),

  remove: (id: string) =>
    apiClient.request<void>({
      path: endpoints.screens.byId(id),
      method: "DELETE",
    }),

  getOverview: (
    query?: { include_media?: boolean; include_preview?: boolean; online_only?: boolean },
    options?: { timeoutMs?: number },
  ) =>
    apiClient.request<ScreensOverview>({
      path: endpoints.screens.overview,
      method: "GET",
      query,
      timeoutMs: options?.timeoutMs,
    }),

  getScheduleTimeline: (
    query: {
      window_start: string;
      window_hours?: number;
      only_active_now?: boolean;
    },
    options?: { timeoutMs?: number },
  ) =>
    apiClient.request<ScreenScheduleTimelineResponse>({
      path: endpoints.screens.scheduleTimeline,
      method: "GET",
      query,
      timeoutMs: options?.timeoutMs,
    }),

  getStatus: (screenId: string) =>
    apiClient.request<ScreenStatus>({
      path: endpoints.screens.status(screenId),
      method: "GET",
    }),

  getNowPlaying: (
    screenId: string,
    query?: { include_media?: boolean; include_urls?: boolean; include_preview?: boolean },
  ) =>
    apiClient.request<ScreenNowPlayingResponse>({
      path: endpoints.screens.nowPlaying(screenId),
      method: "GET",
      query,
    }),

  getAvailability: (screenId: string) =>
    apiClient.request<ScreenAvailability>({
      path: endpoints.screens.availability(screenId),
      method: "GET",
    }),

  getSnapshot: (screenId: string, includeUrls = true) =>
    apiClient.request<ScreenSnapshot>({
      path: endpoints.screens.snapshot(screenId),
      method: "GET",
      query: { include_urls: includeUrls },
    }),

  getDeliveryStatus: (screenId: string, limit = 10) =>
    apiClient.request<ScreenDeliveryStatus>({
      path: endpoints.screens.deliveryStatus(screenId),
      method: "GET",
      query: { limit },
    }),

  getMediaCacheReports: (screenId: string, limit = 10) =>
    apiClient.request<ScreenMediaCacheReportsResponse>({
      path: endpoints.screens.mediaCacheReports(screenId),
      method: "GET",
      query: { limit },
    }),

  triggerScreenshot: (screenId: string, payload?: { reason?: string }) =>
    apiClient.request<{ screen_id: string; command_id?: string | null }>({
      path: endpoints.screens.screenshot(screenId),
      method: "POST",
      body: payload ?? {},
    }),

  getDisplayState: (screenId: string) =>
    apiClient.request<ScreenDisplayState>({
      path: endpoints.screens.displayState(screenId),
      method: "GET",
    }),

  setDisplaySelection: (
    screenId: string,
    payload: { mode: "PRIMARY" } | { mode: "PINNED"; display_key: string; expected_profile_revision: number },
  ) =>
    apiClient.request<ScreenDisplayState>({
      path: endpoints.screens.displaySelection(screenId),
      method: "PUT",
      body: payload,
    }),

  getGroupSnapshot: (groupId: string, includeUrls = true) =>
    apiClient.request<ScreenSnapshot>({
      path: endpoints.screenGroups.snapshot(groupId),
      method: "GET",
      query: { include_urls: includeUrls },
    }),

  // Screen Groups
  createGroup: (payload: { name: string; description?: string; screen_ids?: string[] }) =>
    apiClient.request<ScreenGroup>({
      path: endpoints.screens.groups,
      method: "POST",
      body: payload,
    }),

  listGroups: (params?: PaginationParams) =>
    apiClient.request<PaginatedResponse<ScreenGroup>>({
      path: endpoints.screens.groups,
      method: "GET",
      query: params,
    }),

  listGroupSummaries: (
    params?: PaginationParams & {
      q?: string;
    },
  ) =>
    apiClient.request<ScreenGroupListSummaryResponse>({
      path: endpoints.screens.groups,
      method: "GET",
      query: {
        ...params,
        include_summary: true,
      },
    }),

  updateGroup: (groupId: string, payload: Partial<{ name?: string; description?: string; screen_ids?: string[] }>) =>
    apiClient.request<ScreenGroup>({
      path: endpoints.screens.groupById(groupId),
      method: "PATCH",
      body: payload,
    }),

  removeGroup: (groupId: string) =>
    apiClient.request<void>({
      path: endpoints.screens.groupById(groupId),
      method: "DELETE",
    }),

  getGroupAvailability: (groupId: string) =>
    apiClient.request<ScreenGroupAvailability>({
      path: `/screen-groups/${groupId}/availability`,
      method: "GET",
    }),

  getGroupNowPlaying: (groupId: string) =>
    apiClient.request<ScreenGroupNowPlaying>({
      path: `/screen-groups/${groupId}/now-playing`,
      method: "GET",
    }),

  listAspectRatios: (params?: { search?: string; configured_only?: boolean }) =>
    apiClient.request<ScreenAspectRatioListResponse>({
      path: endpoints.screens.aspectRatios,
      method: "GET",
      query: params,
    }),

  listAvailableScreens: (params?: PaginationParams) =>
    apiClient.request<PaginatedResponse<Screen>>({
      path: "/screens",
      method: "GET",
      query: params,
    }),
};
