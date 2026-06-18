import { describe, expect, it } from "vitest";
import type { ScreenSnapshot } from "@/api/types";
import { buildLiveMirrorState } from "@/lib/screenLiveMirror";

const baseSnapshot: ScreenSnapshot = {
  server_time: "2026-03-24T12:00:00.000Z",
  media_urls: {
    "hero-1": "https://cdn.example.com/hero-1.png",
    "hero-2": "https://cdn.example.com/hero-2.mp4",
    "sidebar-1": "https://cdn.example.com/sidebar-1.pdf",
    "default-1": "https://cdn.example.com/default-1.webp",
  },
  snapshot: {
    schedule: {
      id: "schedule-1",
      items: [
        {
          id: "item-1",
          presentation_id: "presentation-1",
          start_at: "2026-03-24T11:59:00.000Z",
          end_at: "2026-03-24T12:10:00.000Z",
          priority: 2,
          presentation: {
            id: "presentation-1",
            name: "Main presentation",
            layout: {
              id: "layout-1",
              name: "Main layout",
              aspect_ratio: "16:9",
              spec: {
                slots: [
                  { id: "hero", x: 0, y: 0, w: 0.75, h: 1 },
                  { id: "sidebar", x: 0.75, y: 0, w: 0.25, h: 1 },
                ],
              },
            },
            slots: [
              {
                id: "slot-hero-1",
                slot_id: "hero",
                media_id: "hero-1",
                order: 0,
                duration_seconds: 10,
                fit_mode: "cover",
                loop_enabled: false,
                audio_enabled: false,
                media: {
                  id: "hero-1",
                  type: "IMAGE",
                  name: "Hero image",
                  source_content_type: "image/png",
                },
              },
              {
                id: "slot-hero-2",
                slot_id: "hero",
                media_id: "hero-2",
                order: 1,
                duration_seconds: 10,
                fit_mode: "contain",
                loop_enabled: true,
                audio_enabled: true,
                media: {
                  id: "hero-2",
                  type: "VIDEO",
                  name: "Hero video",
                  source_content_type: "video/mp4",
                },
              },
              {
                id: "slot-sidebar-1",
                slot_id: "sidebar",
                media_id: "sidebar-1",
                order: 0,
                duration_seconds: 30,
                fit_mode: "contain",
                loop_enabled: false,
                audio_enabled: false,
                media: {
                  id: "sidebar-1",
                  type: "DOCUMENT",
                  name: "Sidebar PDF",
                  source_content_type: "application/pdf",
                },
              },
            ],
          },
        },
      ],
    },
  },
  default_media: {
    id: "default-1",
    media_id: "default-1",
    type: "IMAGE",
    name: "Default image",
    source_content_type: "image/webp",
  },
};

describe("screenLiveMirror", () => {
  it("renders the active schedule layout and rotates slot media by elapsed time", () => {
    const earlyState = buildLiveMirrorState(baseSnapshot, Date.parse("2026-03-24T12:00:05.000Z"), "16:9");
    expect(earlyState.source).toBe("schedule");
    expect(earlyState.slots).toHaveLength(2);
    expect(earlyState.slots.find((slot) => slot.id === "hero")?.media?.id).toBe("hero-1");
    expect(earlyState.slots.find((slot) => slot.id === "sidebar")?.media?.kind).toBe("pdf");

    const laterState = buildLiveMirrorState(baseSnapshot, Date.parse("2026-03-24T12:00:15.000Z"), "16:9");
    const heroMedia = laterState.slots.find((slot) => slot.id === "hero")?.media;
    expect(heroMedia?.id).toBe("hero-2");
    expect(heroMedia?.kind).toBe("video");
    expect(heroMedia?.loop).toBe(true);
  });

  it("prefers emergency content over scheduled layout content", () => {
    const state = buildLiveMirrorState(
      {
        ...baseSnapshot,
        emergency: {
          media_id: "emergency-1",
          media_url: "https://cdn.example.com/emergency.mp4",
          message: "Emergency",
        },
      },
      Date.parse("2026-03-24T12:00:05.000Z"),
      "16:9",
    );

    expect(state.source).toBe("emergency");
    expect(state.slots[0]?.media?.kind).toBe("video");
  });

  it("falls back to default media when no schedule window is active", () => {
    const state = buildLiveMirrorState(
      {
        ...baseSnapshot,
        snapshot: {
          schedule: {
            id: "schedule-1",
            items: [
              {
                ...baseSnapshot.snapshot!.schedule!.items![0],
                start_at: "2026-03-24T12:30:00.000Z",
                end_at: "2026-03-24T12:40:00.000Z",
              },
            ],
          },
        },
      },
      Date.parse("2026-03-24T12:00:05.000Z"),
      "16:9",
    );

    expect(state.source).toBe("default");
    expect(state.slots[0]?.media?.id).toBe("default-1");
  });
});
