import { useMemo } from "react";

export interface ScheduleTimelineGraphItem {
  id: string;
  label: string;
  start_at: string;
  end_at: string;
  priority?: number | null;
  is_current?: boolean;
}

interface TimelineLane {
  lane: number;
  items: ScheduleTimelineGraphItem[];
}

interface PriorityGroup {
  priority: number;
  lanes: TimelineLane[];
}

interface ScheduleTimelineGraphProps {
  items: ScheduleTimelineGraphItem[];
  windowStart: string;
  windowEnd: string;
  currentTime?: string | null;
  emptyLabel?: string;
}

const formatTick = (value: number) =>
  new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const assignPriorityLanes = (items: ScheduleTimelineGraphItem[]): PriorityGroup[] => {
  const grouped = new Map<number, ScheduleTimelineGraphItem[]>();

  for (const item of items) {
    const priority = Number.isFinite(item.priority) ? Number(item.priority) : 0;
    const bucket = grouped.get(priority) ?? [];
    bucket.push(item);
    grouped.set(priority, bucket);
  }

  return Array.from(grouped.entries())
    .sort((left, right) => right[0] - left[0])
    .map(([priority, bucket]) => {
      const sorted = [...bucket].sort(
        (left, right) =>
          Date.parse(left.start_at) - Date.parse(right.start_at) ||
          Date.parse(left.end_at) - Date.parse(right.end_at),
      );
      const lanes: Array<{ lastEnd: number; items: ScheduleTimelineGraphItem[] }> = [];

      for (const item of sorted) {
        const start = Date.parse(item.start_at);
        const end = Date.parse(item.end_at);
        const lane = lanes.find((candidate) => candidate.lastEnd <= start);
        if (lane) {
          lane.items.push(item);
          lane.lastEnd = end;
          continue;
        }

        lanes.push({
          lastEnd: end,
          items: [item],
        });
      }

      return {
        priority,
        lanes: lanes.map((lane, index) => ({
          lane: index,
          items: lane.items,
        })),
      };
    });
};

export function ScheduleTimelineGraph({
  items,
  windowStart,
  windowEnd,
  currentTime,
  emptyLabel = "No schedule items in this window.",
}: ScheduleTimelineGraphProps) {
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  const totalMs = Math.max(endMs - startMs, 1);
  const currentTimeMs = currentTime ? Date.parse(currentTime) : NaN;
  const currentMarkerLeft =
    Number.isNaN(currentTimeMs) || currentTimeMs < startMs || currentTimeMs > endMs
      ? null
      : ((currentTimeMs - startMs) / totalMs) * 100;

  const tickValues = useMemo(() => {
    const step = totalMs / 6;
    return Array.from({ length: 7 }).map((_, index) => startMs + step * index);
  }, [startMs, totalMs]);

  const groups = useMemo(() => assignPriorityLanes(items), [items]);

  if (!items.length || Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3" data-testid="schedule-timeline-graph">
      <div className="relative rounded-xl border bg-muted/20 p-3">
        <div className="absolute inset-x-3 top-3 grid h-[calc(100%-3rem)] grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`grid-${index}`}
              className="border-r border-dashed border-border/50 last:border-r-0"
            />
          ))}
        </div>
        {currentMarkerLeft !== null ? (
          <div
            className="pointer-events-none absolute bottom-10 top-3 z-10 w-px bg-destructive/80"
            style={{ left: `calc(${currentMarkerLeft}% + 0.75rem)` }}
          />
        ) : null}

        <div className="relative z-[1] space-y-3">
          {groups.map((group) => (
            <div key={`priority-${group.priority}`} className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-semibold">Priority {group.priority}</span>
                <span>{group.lanes.length} lane{group.lanes.length === 1 ? "" : "s"}</span>
              </div>
              <div className="space-y-2">
                {group.lanes.map((lane) => (
                  <div
                    key={`priority-${group.priority}-lane-${lane.lane}`}
                    className="relative h-7 overflow-hidden rounded-full border border-border/60 bg-background/90"
                  >
                    {lane.items.map((item) => {
                      const left = ((Date.parse(item.start_at) - startMs) / totalMs) * 100;
                      const width =
                        ((Date.parse(item.end_at) - Date.parse(item.start_at)) / totalMs) * 100;
                      return (
                        <div
                          key={item.id}
                          title={`${item.label} • ${formatTick(Date.parse(item.start_at))} - ${formatTick(
                            Date.parse(item.end_at),
                          )}`}
                          className={`absolute top-[10%] flex h-[80%] items-center overflow-hidden rounded-full border px-2 text-[11px] ${
                            item.is_current
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-primary/50 bg-primary/15 text-foreground"
                          }`}
                          style={{
                            left: `${Math.max(0, left)}%`,
                            width: `${Math.min(100, Math.max(width, 2.5))}%`,
                          }}
                        >
                          <span className="truncate">{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-7 text-[11px] text-muted-foreground">
          {tickValues.map((tick, index) => (
            <span
              key={`tick-${tick}`}
              className={index === 0 ? "text-left" : index === tickValues.length - 1 ? "text-right" : "text-center"}
            >
              {formatTick(tick)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
