import { describe, expect, it } from "vitest";
import type { ScreenSnapshot } from "@/api/types";
import { getSnapshotInsight } from "./StepScreenSelect";

const snapshotAt = (serverTime: string, emergency: unknown = null): ScreenSnapshot => ({
  server_time: serverTime,
  emergency,
  snapshot: {
    schedule: {
      items: [
        {
          id: "first",
          start_at: "2026-09-07T10:00:00.000Z",
          end_at: "2026-09-07T10:05:00.000Z",
          presentation: { name: "First presentation" },
        },
        {
          id: "second",
          start_at: "2026-09-07T10:05:00.000Z",
          end_at: "2026-09-07T10:10:00.000Z",
          presentation: { name: "Second presentation" },
        },
      ],
    },
  },
});

describe("getSnapshotInsight", () => {
  it("uses backend server time and half-open schedule windows", () => {
    const insight = getSnapshotInsight(snapshotAt("2026-09-07T10:05:00.000Z"));

    expect(insight.status).toBe("playing");
    expect(insight.activeItems.map((item) => item.id)).toEqual(["second"]);
    expect(insight.title).toBe("Scheduled playback active");
  });

  it("reports emergency override separately without invalidating the schedule", () => {
    const insight = getSnapshotInsight(
      snapshotAt("2026-09-07T10:02:00.000Z", { id: "emergency-1", active: true }),
    );

    expect(insight.status).toBe("playing");
    expect(insight.title).toBe("Emergency override active");
    expect(insight.description).toBe(
      "Emergency override active; the schedule remains valid and will resume after clear or expiry.",
    );
  });

  it("does not infer current playback from the browser clock when server time is absent", () => {
    const insight = getSnapshotInsight(snapshotAt(""));

    expect(insight.status).toBe("unknown");
    expect(insight.activeItems).toEqual([]);
  });
});
