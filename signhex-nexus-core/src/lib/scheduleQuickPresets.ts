import type { ScheduleItem } from "@/api/types";

export type ScheduleQuickPresetId = "today" | "tomorrow" | "this_week" | "this_month";

export interface ScheduleQuickPresetWindow {
  start: Date;
  end: Date;
}

export interface ResolvedScheduleQuickPreset {
  startAt: string;
  endAt: string;
}

const PRESET_BUFFER_MS = 30_000;
const MIN_FREE_SLOT_MS = 60_000;

export function formatLocalDateTime(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function buildQuickPresetWindow(
  preset: ScheduleQuickPresetId,
  now: Date = new Date(),
): ScheduleQuickPresetWindow {
  const reference = new Date(now);
  reference.setSeconds(0, 0);

  const earliest = new Date(reference.getTime() + 60_000);
  const businessStart = new Date(reference);
  businessStart.setHours(9, 0, 0, 0);

  const start = new Date(businessStart);
  if (preset === "tomorrow") {
    start.setDate(start.getDate() + 1);
  } else if (start <= earliest) {
    start.setTime(earliest.getTime());
  }

  const end = new Date(start);
  if (preset === "today" || preset === "tomorrow") {
    end.setHours(18, 0, 0, 0);
  } else if (preset === "this_week") {
    end.setDate(end.getDate() + 7);
    end.setHours(18, 0, 0, 0);
  } else {
    end.setDate(end.getDate() + 30);
    end.setHours(18, 0, 0, 0);
  }

  return { start, end };
}

type BusyInterval = { start: number; end: number };

function mergeBusyIntervals(intervals: BusyInterval[]): BusyInterval[] {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  const merged: BusyInterval[] = [sorted[0]!];

  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
      continue;
    }
    merged.push({ ...interval });
  }

  return merged;
}

export function resolveQuickPresetRange(
  preset: ScheduleQuickPresetId,
  scheduleItems: ScheduleItem[],
  now: Date = new Date(),
): ResolvedScheduleQuickPreset | null {
  const window = buildQuickPresetWindow(preset, now);
  const windowStart = window.start.getTime();
  const windowEnd = window.end.getTime();

  if (windowEnd <= windowStart) {
    return null;
  }

  const busy = mergeBusyIntervals(
    scheduleItems
      .map((item) => {
        const itemStart = Date.parse(item.start_at);
        const itemEnd = Date.parse(item.end_at);
        if (Number.isNaN(itemStart) || Number.isNaN(itemEnd)) {
          return null;
        }

        return {
          start: Math.max(windowStart, itemStart - PRESET_BUFFER_MS),
          end: Math.min(windowEnd, itemEnd + PRESET_BUFFER_MS),
        } satisfies BusyInterval;
      })
      .filter((interval): interval is BusyInterval => Boolean(interval) && interval.end > interval.start),
  );

  let cursor = windowStart;

  for (const interval of busy) {
    if (interval.end <= cursor) {
      continue;
    }

    if (interval.start - cursor >= MIN_FREE_SLOT_MS) {
      return {
        startAt: formatLocalDateTime(new Date(cursor)),
        endAt: formatLocalDateTime(new Date(interval.start)),
      };
    }

    cursor = Math.max(cursor, interval.end);
  }

  if (windowEnd - cursor >= MIN_FREE_SLOT_MS) {
    return {
      startAt: formatLocalDateTime(new Date(cursor)),
      endAt: formatLocalDateTime(new Date(windowEnd)),
    };
  }

  return null;
}
