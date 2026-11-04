import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StepScheduleDetails } from "./StepScheduleDetails";

function displayedDuration(startAt: string, endAt: string): string {
  const markup = renderToStaticMarkup(createElement(StepScheduleDetails, {
    scheduleName: "QA event", scheduleDescription: "", timezone: "Asia/Kolkata",
    startAt, endAt, priority: 0, onUpdate: () => {},
  }));
  const text = markup.match(/<p[^>]*aria-live="polite"[^>]*>([^<]*)<\/p>/)?.[1];
  if (!text) throw new Error("Schedule duration is missing from the rendered form");
  return text;
}

describe("schedule window duration", () => {
  it("shows the minutes in a partial hour instead of truncating them", () => {
    expect(displayedDuration("2026-11-10T10:00", "2026-11-10T11:30")).toBe("1 hour, 30 minutes");
  });

  it("keeps day, hour and minute portions visible", () => {
    expect(displayedDuration("2026-11-10T10:00", "2026-11-11T12:15")).toBe("1 day, 2 hours, 15 minutes");
  });

  it("labels an invalid or reversed window", () => {
    expect(displayedDuration("2026-11-10T11:30", "2026-11-10T10:00")).toBe("Invalid range");
    expect(displayedDuration("not-a-date", "2026-11-10T10:00")).toBe("Invalid range");
  });
});
