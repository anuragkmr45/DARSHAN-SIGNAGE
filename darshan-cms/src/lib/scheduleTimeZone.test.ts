import { describe, expect, it } from "vitest";
import { normalizeScheduleTimeZone } from "./scheduleTimeZone";

describe("schedule timezone names", () => {
  it("uses the familiar India name while preserving other IANA zones and UTC fallback", () => {
    expect(normalizeScheduleTimeZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(normalizeScheduleTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(normalizeScheduleTimeZone("Europe/London")).toBe("Europe/London");
    expect(normalizeScheduleTimeZone(null)).toBe("UTC");
  });
});
