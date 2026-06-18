import type {
  ScreenGroupListSummaryResponse,
  ScreenNowPlayingResponse,
  ScreenPreviewSummary,
  ScreenPreviewUpdateEvent,
  ScreenListSummaryResponse,
  ScreenOverviewItem,
  ScreenRefreshRequiredEvent,
  ScreenScheduleTimelineResponse,
  ScreensOverview,
  ScreensSyncAck,
} from "@/api/types";

export const SCREENS_STALE_HEARTBEAT_MS = 2 * 60 * 1000;
export const SCREENS_REFRESH_DEBOUNCE_MS = 500;

type ScreensListRealtimeFilters = {
  status?: string | null;
  q?: string | null;
};

export const patchScreenInOverview = (
  current: ScreensOverview | undefined,
  screen: ScreenOverviewItem,
  serverTime?: string,
) => {
  if (!current) return current;
  const nextScreens = current.screens.map((item) => (item.id === screen.id ? { ...item, ...screen } : item));
  const hasMatch = nextScreens.some((item) => item.id === screen.id);
  return {
    ...current,
    server_time: serverTime ?? current.server_time,
    screens: hasMatch ? nextScreens : [screen, ...current.screens],
  };
};

export const patchScreenInPaginatedList = (
  current: ScreenListSummaryResponse | undefined,
  screen: ScreenOverviewItem,
  serverTime?: string,
) => {
  if (!current) return current;
  const nextItems = current.items.map((item) => (item.id === screen.id ? { ...item, ...screen } : item));
  return {
    ...current,
    server_time: serverTime ?? current.server_time,
    items: nextItems,
  };
};

export const patchScreenGroupInPaginatedList = (
  current: ScreenGroupListSummaryResponse | undefined,
  groupId: string,
) => {
  if (!current) return current;
  return {
    ...current,
    items: current.items.map((item) => (item.id === groupId ? { ...item } : item)),
  };
};

export const patchScreenNowPlaying = (
  current: ScreenNowPlayingResponse | undefined,
  screen: ScreenOverviewItem,
  serverTime?: string,
) => {
  if (!current || current.screen_id !== screen.id) return current;
  return {
    ...current,
    server_time: serverTime ?? current.server_time,
    status: screen.status ?? current.status,
    health_state: screen.health_state ?? current.health_state,
    health_reason: screen.health_reason ?? current.health_reason,
    auth_diagnostics: screen.auth_diagnostics ?? current.auth_diagnostics,
    active_pairing: screen.active_pairing ?? current.active_pairing,
    last_heartbeat_at: screen.last_heartbeat_at ?? current.last_heartbeat_at,
    current_schedule_id: screen.current_schedule_id ?? current.current_schedule_id,
    current_media_id: screen.current_media_id ?? current.current_media_id,
    current_scene_id: screen.current_scene_id ?? current.current_scene_id,
    active_slots: screen.active_slots ?? current.active_slots,
    active_items: screen.active_items ?? current.active_items,
    upcoming_items: screen.upcoming_items ?? current.upcoming_items,
    booked_until: screen.booked_until ?? current.booked_until,
    publish: screen.publish ?? current.publish,
    playback: screen.playback ?? current.playback,
    emergency: screen.emergency ?? current.emergency,
    preview: screen.preview ?? current.preview,
  };
};

export const getScreensListRealtimeFilters = (
  queryKey?: readonly unknown[] | null,
): ScreensListRealtimeFilters => {
  if (!Array.isArray(queryKey)) {
    return {};
  }

  return {
    status: typeof queryKey[4] === "string" ? queryKey[4] : null,
    q: typeof queryKey[5] === "string" ? queryKey[5] : null,
  };
};

export const shouldInvalidateFilteredScreensList = (
  filters: ScreensListRealtimeFilters,
  screen: ScreenOverviewItem,
) => {
  const normalizedSearch = filters.q?.trim().toLowerCase();
  if (normalizedSearch) {
    return true;
  }

  const normalizedStatus = filters.status?.trim().toLowerCase();
  if (!normalizedStatus || normalizedStatus === "all") {
    return false;
  }
  return true;
};

const mergePreview = (
  current: ScreenPreviewSummary | null | undefined,
  payload: ScreenPreviewUpdateEvent,
): ScreenPreviewSummary => ({
  storage_object_id: payload.storage_object_id ?? current?.storage_object_id ?? null,
  captured_at: payload.captured_at ?? current?.captured_at ?? null,
  screenshot_url: payload.screenshot_url ?? current?.screenshot_url ?? null,
  stale: payload.stale ?? current?.stale ?? false,
});

export const patchScreenPreviewInOverview = (
  current: ScreensOverview | undefined,
  payload: ScreenPreviewUpdateEvent,
) => {
  if (!current) return current;

  return {
    ...current,
    screens: current.screens.map((screen) =>
      screen.id === payload.screenId
        ? {
            ...screen,
            preview: mergePreview(screen.preview, payload),
          }
        : screen,
    ),
  };
};

export const patchScreenPreviewInNowPlaying = (
  current: ScreenNowPlayingResponse | undefined,
  payload: ScreenPreviewUpdateEvent,
) => {
  if (!current || current.screen_id !== payload.screenId) return current;

  return {
    ...current,
    preview: mergePreview(current.preview, payload),
  };
};

export const patchScreenInScheduleTimeline = (
  current: ScreenScheduleTimelineResponse | undefined,
  screen: ScreenOverviewItem,
  serverTime?: string,
) => {
  if (!current) return current;

  return {
    ...current,
    server_time: serverTime ?? current.server_time,
    screens: current.screens.map((row) =>
      row.id === screen.id
        ? {
            ...row,
            name: screen.name ?? row.name,
            location: screen.location ?? row.location,
            health_state: screen.health_state ?? row.health_state,
            health_reason: screen.health_reason ?? row.health_reason,
            playback: screen.playback ?? row.playback,
            publish: screen.publish ?? row.publish,
          }
        : row,
    ),
  };
};

export const applyScreensSyncAck = (
  current: ScreensOverview | undefined,
  ack: ScreensSyncAck,
) => {
  if (!current) {
    return {
      server_time: ack.server_time,
      screens: ack.screens,
      groups: ack.groups ?? [],
      now_playing: [],
    } satisfies ScreensOverview;
  }

  let next = {
    ...current,
    server_time: ack.server_time ?? current.server_time,
    groups: ack.groups ?? current.groups,
  };

  ack.screens.forEach((screen) => {
    next = patchScreenInOverview(next, screen, ack.server_time) ?? next;
  });

  return next;
};

export const shouldRefetchScreenDetail = (
  payload: ScreenRefreshRequiredEvent,
  screenId?: string | null,
) => {
  if (!screenId) return false;
  return Array.isArray(payload.screen_ids) && payload.screen_ids.includes(screenId);
};

export const getServerClockOffsetMs = (serverTime?: string | null, clientNow = Date.now()) => {
  if (!serverTime) return 0;
  const serverTimestamp = Date.parse(serverTime);
  if (Number.isNaN(serverTimestamp)) return 0;
  return serverTimestamp - clientNow;
};

export const getServerNowFromOffset = (offsetMs: number, clientNow = Date.now()) => clientNow + offsetMs;

export const isHeartbeatStale = (
  lastHeartbeatAt?: string | null,
  serverTime?: string | null,
  thresholdMs = SCREENS_STALE_HEARTBEAT_MS,
) => {
  if (!lastHeartbeatAt || !serverTime) return false;
  const lastHeartbeatMs = Date.parse(lastHeartbeatAt);
  const serverMs = Date.parse(serverTime);
  if (Number.isNaN(lastHeartbeatMs) || Number.isNaN(serverMs)) return false;
  return serverMs - lastHeartbeatMs > thresholdMs;
};

export const getPlaybackTimingLabel = (
  startedAt?: string | null,
  endsAt?: string | null,
  serverNowMs?: number,
) => {
  if (!startedAt && !endsAt) return null;
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  const endsMs = endsAt ? Date.parse(endsAt) : NaN;

  if (serverNowMs && !Number.isNaN(endsMs)) {
    const remainingMs = Math.max(0, endsMs - serverNowMs);
    const remainingMinutes = Math.floor(remainingMs / 60_000);
    const remainingSeconds = Math.floor((remainingMs % 60_000) / 1000);
    return `Ends in ${remainingMinutes}m ${remainingSeconds}s`;
  }

  if (!Number.isNaN(startedMs)) {
    return `Started ${new Date(startedMs).toLocaleTimeString()}`;
  }

  return `Ends ${new Date(endsMs).toLocaleTimeString()}`;
};
