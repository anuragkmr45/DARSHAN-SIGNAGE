import { apiClient, ApiError } from "../apiClient";
import type { DeviceScheduleItem, DeviceScheduleSnapshot } from "../types";

type RawDeviceSnapshotResponse = {
  publish?: {
    snapshot_id?: string;
    published_at?: string;
  } | null;
  snapshot?: {
    schedule?: {
      id?: string;
      items?: Array<{
        id?: string;
        start_at?: string;
        end_at?: string;
        presentation?: {
          id?: string;
          items?: Array<{
            id?: string;
            media_id?: string;
            duration_seconds?: number;
            fit_mode?: string;
            audio_enabled?: boolean;
            media?: {
              id?: string;
              type?: string;
              media_url?: string | null;
            } | null;
          }>;
          slots?: Array<{
            id?: string;
            media_id?: string;
            duration_seconds?: number;
            fit_mode?: string;
            audio_enabled?: boolean;
            media?: {
              id?: string;
              type?: string;
              media_url?: string | null;
            } | null;
          }>;
        } | null;
      }>;
    };
  } | null;
  media_urls?: Record<string, string>;
};

const normalizeDeviceItems = (payload: RawDeviceSnapshotResponse): DeviceScheduleItem[] => {
  const mediaUrls = payload.media_urls ?? {};
  const scheduleItems = payload.snapshot?.schedule?.items ?? [];

  return scheduleItems.flatMap((scheduleItem) => {
    const presentationEntries = [
      ...(scheduleItem.presentation?.items ?? []),
      ...(scheduleItem.presentation?.slots ?? []),
    ];

    return presentationEntries
      .filter((entry) => entry.media_id || entry.media?.id)
      .map((entry, index) => {
        const mediaId = entry.media_id ?? entry.media?.id ?? "";
        const mediaType = (entry.media?.type ?? "unknown").toLowerCase();

        return {
          id: entry.id ?? `${scheduleItem.id ?? "schedule-item"}-${mediaId}-${index}`,
          media_id: mediaId,
          type: mediaType,
          display_ms: entry.duration_seconds ? entry.duration_seconds * 1000 : undefined,
          fit: entry.fit_mode ?? undefined,
          media_url: mediaUrls[mediaId] ?? entry.media?.media_url ?? undefined,
          muted: typeof entry.audio_enabled === "boolean" ? !entry.audio_enabled : undefined,
        } satisfies DeviceScheduleItem;
      });
  });
};

export const deviceScheduleApi = {
  getSchedule: async (deviceId: string) => {
    try {
      const normalizedDeviceId = typeof deviceId === "string" ? deviceId.trim() : "";
      if (!normalizedDeviceId) {
        throw new ApiError({
          status: 400,
          message: "Device id is required to load the published device snapshot.",
        });
      }

      const payload = await apiClient.request<RawDeviceSnapshotResponse>({
        path: `/device/${encodeURIComponent(normalizedDeviceId)}/snapshot`,
        method: "GET",
        query: { include_urls: true },
      });

      return {
        id: payload.publish?.snapshot_id ?? normalizedDeviceId,
        generated_at: payload.publish?.published_at,
        fetched_at: new Date().toISOString(),
        media_urls: payload.media_urls ?? {},
        schedule: {
          id: payload.snapshot?.schedule?.id,
          items: normalizeDeviceItems(payload),
        },
        emergency: payload.emergency,
        default_media: payload.default_media,
      } satisfies DeviceScheduleSnapshot;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError({
        status: 500,
        message: error instanceof Error ? error.message : "Unable to fetch schedule",
      });
    }
  },
};
