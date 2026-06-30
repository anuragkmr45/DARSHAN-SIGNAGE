import { describe, expect, it } from "vitest";
import { buildQuickPresetWindow, resolveQuickPresetRange } from "./scheduleQuickPresets";

describe("scheduleQuickPresets", () => {
  it("builds today's preset inside the current business day", () => {
    const now = new Date(2026, 2, 18, 10, 15, 0, 0);
    const window = buildQuickPresetWindow("today", now);

    expect(window.start.getFullYear()).toBe(2026);
    expect(window.start.getMonth()).toBe(2);
    expect(window.start.getDate()).toBe(18);
    expect(window.start.getHours()).toBe(10);
    expect(window.start.getMinutes()).toBe(16);
    expect(window.end.getHours()).toBe(18);
    expect(window.end.getMinutes()).toBe(0);
  });

  it("returns the first free gap inside a preset window", () => {
    const now = new Date(2026, 2, 18, 10, 15, 0, 0);
    const resolved = resolveQuickPresetRange(
      "today",
      [
        {
          id: "one",
          schedule_id: "sched",
          presentation_id: "pres",
          start_at: "2026-03-18T10:30:00",
          end_at: "2026-03-18T11:00:00",
          priority: 0,
        },
      ],
      now,
    );

    expect(resolved).toEqual({
      startAt: "2026-03-18T10:16",
      endAt: "2026-03-18T10:29",
    });
  });

  it("skips busy intervals until it finds a later free slot", () => {
    const now = new Date(2026, 2, 18, 10, 15, 0, 0);
    const resolved = resolveQuickPresetRange(
      "today",
      [
        {
          id: "one",
          schedule_id: "sched",
          presentation_id: "pres",
          start_at: "2026-03-18T10:10:00",
          end_at: "2026-03-18T12:00:00",
          priority: 0,
        },
        {
          id: "two",
          schedule_id: "sched",
          presentation_id: "pres",
          start_at: "2026-03-18T14:00:00",
          end_at: "2026-03-18T15:00:00",
          priority: 0,
        },
      ],
      now,
    );

    expect(resolved).toEqual({
      startAt: "2026-03-18T12:00",
      endAt: "2026-03-18T13:59",
    });
  });

  it("returns null when no free preset slot remains", () => {
    const now = new Date(2026, 2, 18, 10, 15, 0, 0);
    const resolved = resolveQuickPresetRange(
      "today",
      [
        {
          id: "one",
          schedule_id: "sched",
          presentation_id: "pres",
          start_at: "2026-03-18T09:00:00",
          end_at: "2026-03-18T17:59:59",
          priority: 0,
        },
      ],
      now,
    );

    expect(resolved).toBeNull();
  });
});
