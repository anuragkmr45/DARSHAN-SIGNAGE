import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Clock3, ExternalLink, MonitorPlay, RadioTower } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import { ScheduleTimelineGraph } from "@/components/screens/ScheduleTimelineGraph";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { ScreenDetailsModal } from "@/components/screens/ScreenDetailsModal";
import { useScreensRealtime } from "@/hooks/screens/useScreensRealtime";
import { patchScreenInScheduleTimeline, shouldRefetchScreenDetail } from "@/hooks/screens/screensRealtimeUtils";

interface ActiveScheduledTimelineModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const getLocalMidnightIso = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
};

const formatRelativeTime = (value?: string | null) => {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return formatDistanceToNow(parsed, { addSuffix: true });
};

const sourceLabel = (source?: string | null) => {
  switch (source) {
    case "HEARTBEAT":
      return "Heartbeat";
    case "SCHEDULE":
      return "Schedule";
    case "EMERGENCY":
      return "Emergency";
    case "DEFAULT":
      return "Default";
    default:
      return source || "Unknown";
  }
};

export function ActiveScheduledTimelineModal({ open, onOpenChange }: ActiveScheduledTimelineModalProps) {
  const queryClient = useQueryClient();
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [windowStart] = useState(() => getLocalMidnightIso());
  const queryKey = useMemo(
    () =>
      queryKeys.screensScheduleTimeline({
        windowStart,
        windowHours: 24,
        onlyActiveNow: true,
      }),
    [windowStart],
  );

  const timelineQuery = useQuery({
    queryKey,
    queryFn: () =>
      screensApi.getScheduleTimeline({
        window_start: windowStart,
        window_hours: 24,
        only_active_now: true,
      }, {
        timeoutMs: 30_000,
      }),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });

  const selectedScreen = useMemo(
    () => timelineQuery.data?.screens.find((screen) => screen.id === selectedScreenId) ?? null,
    [selectedScreenId, timelineQuery.data?.screens],
  );

  const handleRealtimeStateUpdate = useCallback(
    (payload: { screen: Parameters<typeof patchScreenInScheduleTimeline>[1]; server_time?: string }) => {
      queryClient.setQueryData(queryKey, (current: ReturnType<typeof patchScreenInScheduleTimeline>) =>
        patchScreenInScheduleTimeline(current as never, payload.screen, payload.server_time),
      );
    },
    [queryClient, queryKey],
  );

  const handleRealtimeRefresh = useCallback(
    (payload: { reason?: string; screen_ids?: string[] }) => {
      if (
        payload.reason === "PUBLISH" ||
        payload.reason === "EMERGENCY" ||
        shouldRefetchScreenDetail(payload, selectedScreenId)
      ) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [queryClient, queryKey, selectedScreenId],
  );

  useScreensRealtime({
    enabled: open,
    activeScreenId: selectedScreenId,
    onStateUpdate: handleRealtimeStateUpdate,
    onRefreshRequired: handleRealtimeRefresh,
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-7xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Active Scheduled</DialogTitle>
            <DialogDescription>
              24-hour operational timeline for screens that are actively scheduled right now.
            </DialogDescription>
          </DialogHeader>

          {timelineQuery.isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Card key={`timeline-skeleton-${index}`}>
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <Skeleton className="h-9 w-24" />
                    </div>
                    <Skeleton className="h-24 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (timelineQuery.data?.screens.length ?? 0) === 0 ? (
            <Card>
              <CardContent className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <CalendarRange className="h-10 w-10" />
                <div>
                  <p className="font-medium text-foreground">No active scheduled screens</p>
                  <p className="text-sm">
                    This modal only shows screens that are running scheduled items right now.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4" data-testid="active-scheduled-modal-rows">
              {timelineQuery.data?.screens.map((screen) => {
                const currentMediaName =
                  screen.playback?.current_media?.name ||
                  screen.playback?.current_media?.filename ||
                  (screen.playback?.current_media_id ? `Media ${screen.playback.current_media_id}` : null);

                return (
                  <Card key={screen.id} data-testid="active-scheduled-row">
                    <CardContent className="space-y-4 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-lg font-semibold">{screen.name}</h3>
                            <StatusBadge status={screen.health_state} />
                            <Badge variant="secondary">{sourceLabel(screen.playback?.source)}</Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                            <span className="truncate">{screen.location || "No location"}</span>
                            <span className="flex items-center gap-1">
                              <MonitorPlay className="h-4 w-4" />
                              {currentMediaName ? `Playing ${currentMediaName}` : "Current media unknown"}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock3 className="h-4 w-4" />
                              Heartbeat {formatRelativeTime(screen.playback?.heartbeat_received_at)}
                            </span>
                            {screen.health_reason ? (
                              <span className="flex items-center gap-1">
                                <RadioTower className="h-4 w-4" />
                                {screen.health_reason}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Open details for ${screen.name}`}
                          onClick={() => setSelectedScreenId(screen.id)}
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Details
                        </Button>
                      </div>

                      <ScheduleTimelineGraph
                        items={screen.timeline_items.map((item) => ({
                          id: item.id,
                          label: item.presentation_name || item.presentation_id || item.id,
                          start_at: item.start_at,
                          end_at: item.end_at,
                          priority: item.priority,
                          is_current: item.is_current,
                        }))}
                        windowStart={timelineQuery.data.window_start}
                        windowEnd={timelineQuery.data.window_end}
                        currentTime={timelineQuery.data.server_time}
                        emptyLabel="No renderable schedule items in the selected 24-hour window."
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {selectedScreenId ? (
        <ScreenDetailsModal
          screenId={selectedScreenId}
          screenName={selectedScreen?.name}
          open={Boolean(selectedScreenId)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setSelectedScreenId(null);
            }
          }}
        />
      ) : null}
    </>
  );
}
