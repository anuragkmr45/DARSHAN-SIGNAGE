import { describe, expect, test } from "vitest";
import type { ScreenNowPlayingResponse, ScreenOverviewItem, ScreensOverview } from "@/api/types";
import {
  applyScreensSyncAck,
  getScreensListRealtimeFilters,
  getServerClockOffsetMs,
  getServerNowFromOffset,
  patchScreenInOverview,
  patchScreenInScheduleTimeline,
  patchScreenNowPlaying,
  patchScreenPreviewInNowPlaying,
  patchScreenPreviewInOverview,
  SCREENS_REFRESH_DEBOUNCE_MS,
  shouldInvalidateFilteredScreensList,
  shouldRefetchScreenDetail,
} from "@/hooks/screens/screensRealtimeUtils";

const baseScreen: ScreenOverviewItem = {
  id: "screen-1",
  name: "Lobby",
  status: "ACTIVE",
  playback: {
    source: "HEARTBEAT",
    current_media_id: "media-1",
  },
};

describe("screens realtime cache helpers", () => {
  test("patchScreenInOverview updates only the matching row", () => {
    const current: ScreensOverview = {
      server_time: "2026-03-10T07:15:00.000Z",
      screens: [
        baseScreen,
        { id: "screen-2", name: "Hallway", status: "OFFLINE" },
      ],
      groups: [],
      now_playing: [],
    };

    const next = patchScreenInOverview(current, {
      ...baseScreen,
      playback: { source: "EMERGENCY", current_media_id: "media-2" },
    }, "2026-03-10T07:15:05.000Z");

    expect(next?.server_time).toBe("2026-03-10T07:15:05.000Z");
    expect(next?.screens[0].playback?.source).toBe("EMERGENCY");
    expect(next?.screens[1].status).toBe("OFFLINE");
  });

  test("patchScreenNowPlaying updates detail only when ids match", () => {
    const current: ScreenNowPlayingResponse = {
      server_time: "2026-03-10T07:15:00.000Z",
      screen_id: "screen-1",
      status: "ACTIVE",
      playback: { source: "HEARTBEAT", current_media_id: "media-1" },
    };

    const next = patchScreenNowPlaying(current, {
      ...baseScreen,
      status: "OFFLINE",
      current_scene_id: "scene-2",
      active_slots: [
        {
          scene_id: "scene-2",
          slot_id: "slot-a",
          item_id: "item-a",
          media_id: "media-3",
          playback_instance_id: "11111111-1111-4111-8111-111111111111",
          started_at: "2026-03-10T07:15:30.000Z",
        },
      ],
      playback: { source: "DEFAULT", current_media_id: "media-3" },
    }, "2026-03-10T07:16:00.000Z");

    expect(next?.status).toBe("OFFLINE");
    expect(next?.playback?.source).toBe("DEFAULT");
    expect(next?.current_scene_id).toBe("scene-2");
    expect(next?.active_slots).toHaveLength(1);
    expect(next?.server_time).toBe("2026-03-10T07:16:00.000Z");
  });

  test("patchScreenPreviewInOverview updates preview data for the matching screen", () => {
    const current: ScreensOverview = {
      server_time: "2026-03-10T07:15:00.000Z",
      screens: [baseScreen],
      groups: [],
      now_playing: [],
    };

    const next = patchScreenPreviewInOverview(current, {
      screenId: "screen-1",
      captured_at: "2026-03-10T07:16:00.000Z",
      screenshot_url: "https://cdn.example.com/screen-1.png",
      stale: false,
      storage_object_id: "storage-1",
    });

    expect(next?.screens[0].preview?.screenshot_url).toBe("https://cdn.example.com/screen-1.png");
    expect(next?.screens[0].preview?.storage_object_id).toBe("storage-1");
  });

  test("patchScreenPreviewInNowPlaying updates preview for the matching detail screen", () => {
    const current: ScreenNowPlayingResponse = {
      screen_id: "screen-1",
      status: "ACTIVE",
      preview: {
        screenshot_url: null,
        stale: true,
      },
    };

    const next = patchScreenPreviewInNowPlaying(current, {
      screenId: "screen-1",
      captured_at: "2026-03-10T07:16:00.000Z",
      screenshot_url: "https://cdn.example.com/screen-1.png",
      stale: false,
      storage_object_id: "storage-1",
    });

    expect(next?.preview?.screenshot_url).toBe("https://cdn.example.com/screen-1.png");
    expect(next?.preview?.stale).toBe(false);
  });

  test("patchScreenInScheduleTimeline patches playback and health for the matching row", () => {
    const current = {
      server_time: "2026-03-10T07:15:00.000Z",
      window_start: "2026-03-10T00:00:00.000Z",
      window_end: "2026-03-11T00:00:00.000Z",
      screens: [
        {
          id: "screen-1",
          name: "Lobby",
          location: "Reception",
          health_state: "ONLINE",
          playback: { source: "SCHEDULE", current_media_id: "media-1" },
          timeline_items: [],
        },
      ],
    };

    const next = patchScreenInScheduleTimeline(
      current,
      {
        ...baseScreen,
        health_state: "STALE",
        health_reason: "Heartbeat is stale.",
        playback: { source: "DEFAULT", current_media_id: "media-9" },
      },
      "2026-03-10T07:16:00.000Z",
    );

    expect(next?.server_time).toBe("2026-03-10T07:16:00.000Z");
    expect(next?.screens[0].health_state).toBe("STALE");
    expect(next?.screens[0].playback?.current_media_id).toBe("media-9");
  });

  test("applyScreensSyncAck merges synced screens and groups", () => {
    const current: ScreensOverview = {
      server_time: "2026-03-10T07:15:00.000Z",
      screens: [baseScreen],
      groups: [{ id: "group-1", name: "North Wing" }],
      now_playing: [],
    };

    const next = applyScreensSyncAck(current, {
      server_time: "2026-03-10T07:17:00.000Z",
      screens: [
        {
          ...baseScreen,
          playback: { source: "SCHEDULE", current_media_id: "media-9" },
        },
      ],
      groups: [{ id: "group-2", name: "South Wing" }],
    });

    expect(next.server_time).toBe("2026-03-10T07:17:00.000Z");
    expect(next.groups[0].id).toBe("group-2");
    expect(next.screens[0].playback?.current_media_id).toBe("media-9");
  });

  test("shouldRefetchScreenDetail only matches affected screens", () => {
    expect(
      shouldRefetchScreenDetail({ reason: "PUBLISH", screen_ids: ["screen-1"] }, "screen-1"),
    ).toBe(true);
    expect(
      shouldRefetchScreenDetail({ reason: "PUBLISH", screen_ids: ["screen-2"] }, "screen-1"),
    ).toBe(false);
  });

  test("server clock helpers derive stable now values", () => {
    const clientNow = Date.parse("2026-03-10T07:14:55.000Z");
    const offset = getServerClockOffsetMs("2026-03-10T07:15:00.000Z", clientNow);
    const serverNow = getServerNowFromOffset(offset, clientNow);

    expect(offset).toBe(5_000);
    expect(serverNow).toBe(Date.parse("2026-03-10T07:15:00.000Z"));
  });

  test("refresh debounce constant remains at 500ms", () => {
    expect(SCREENS_REFRESH_DEBOUNCE_MS).toBe(500);
  });

  test("extracts realtime list filters from the screens list query key", () => {
    expect(
      getScreensListRealtimeFilters(["screens", "list", 2, 20, "ONLINE", "lobby", true, true, false]),
    ).toEqual({
      status: "ONLINE",
      q: "lobby",
    });
  });

  test("invalidates filtered screen lists instead of patching them optimistically", () => {
    expect(shouldInvalidateFilteredScreensList({ q: "lobby" }, baseScreen)).toBe(true);
    expect(
      shouldInvalidateFilteredScreensList({ status: "ONLINE" }, { ...baseScreen, health_state: "OFFLINE" }),
    ).toBe(true);
    expect(
      shouldInvalidateFilteredScreensList({ status: "ONLINE" }, { ...baseScreen, health_state: "ONLINE" }),
    ).toBe(true);
  });
});
