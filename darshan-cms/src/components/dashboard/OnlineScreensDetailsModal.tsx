import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Activity, Clock3, ExternalLink, Monitor, RadioTower } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import type { ScreenOverviewItem, ScreenSnapshot, ScreenStateUpdateEvent, ScreenRefreshRequiredEvent } from "@/api/types";
import { useScreensRealtime } from "@/hooks/screens/useScreensRealtime";
import { ScreenDetailsModal } from "@/components/screens/ScreenDetailsModal";
import { LiveScreenMirror } from "@/components/dashboard/LiveScreenMirror";

interface OnlineScreensDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatRelativeTime = (value?: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return formatDistanceToNow(date, { addSuffix: true });
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

function PreviewCard({
  screen,
  onOpenDetails,
  enabled,
  clockTick,
}: {
  screen: ScreenOverviewItem;
  onOpenDetails: (screenId: string) => void;
  enabled: boolean;
  clockTick: number;
}) {
  const preview = screen.preview;
  const currentMediaName =
    screen.playback?.current_media?.name ||
    screen.playback?.current_media?.filename ||
    (screen.playback?.current_media_id ? `Media ${screen.playback.current_media_id}` : null);
  const snapshotQuery = useQuery({
    queryKey: queryKeys.screenSnapshot(screen.id),
    queryFn: () => screensApi.getSnapshot(screen.id, true),
    enabled,
    staleTime: 30_000,
  });
  const snapshotErrorMessage =
    snapshotQuery.error instanceof Error ? snapshotQuery.error.message : snapshotQuery.error ? "Unable to load live snapshot." : null;

  return (
    <Card data-testid="online-screen-card" className="overflow-hidden">
      <div className="relative bg-muted/40">
        <LiveScreenMirror
          snapshot={snapshotQuery.data}
          fallbackAspectRatio={screen.aspect_ratio}
          fallbackPreviewUrl={preview?.screenshot_url}
          isLoading={snapshotQuery.isLoading}
          errorMessage={snapshotErrorMessage}
          clockTick={clockTick}
          className="w-full"
        />

        <div className="absolute left-3 top-3 flex gap-2">
          <Badge variant="secondary">{sourceLabel(screen.playback?.source)}</Badge>
          {preview?.stale ? <Badge variant="destructive">Stale preview</Badge> : null}
        </div>
      </div>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{screen.name}</CardTitle>
            <p className="truncate text-sm text-muted-foreground">{screen.location || "No location"}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Open details for ${screen.name}`}
            onClick={() => onOpenDetails(screen.id)}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Details
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Monitor className="h-4 w-4" />
          <span className="truncate">
            {currentMediaName ? `Playing ${currentMediaName}` : "No media currently playing"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock3 className="h-4 w-4" />
          <span>Last heartbeat {formatRelativeTime(screen.last_heartbeat_at)}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <RadioTower className="h-4 w-4" />
          <span>Preview captured {formatRelativeTime(preview?.captured_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function OnlineScreensDetailsModal({ open, onOpenChange }: OnlineScreensDetailsModalProps) {
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setInterval(() => {
      setClockTick((current) => current + 1);
    }, 500);

    return () => window.clearInterval(timer);
  }, [open]);

  const overviewQuery = useQuery({
    queryKey: queryKeys.screensOverview({ includeMedia: true, includePreview: true, onlineOnly: true }),
    queryFn: () =>
      screensApi.getOverview(
        { include_media: true, include_preview: true, online_only: true },
        { timeoutMs: 30_000 },
      ),
    enabled: open,
    staleTime: 30_000,
  });

  const selectedScreen = useMemo(
    () => overviewQuery.data?.screens.find((screen) => screen.id === selectedScreenId) ?? null,
    [overviewQuery.data?.screens, selectedScreenId],
  );

  const onlineScreens = useMemo(
    () =>
      (overviewQuery.data?.screens ?? [])
        .filter((screen) => screen.health_state === "ONLINE")
        .sort((a, b) => {
          const aTime = Date.parse(a.last_heartbeat_at || "") || 0;
          const bTime = Date.parse(b.last_heartbeat_at || "") || 0;
          return bTime - aTime;
        }),
    [overviewQuery.data?.screens],
  );

  const handleRealtimeRefresh = useCallback(
    (payload: ScreenRefreshRequiredEvent) => {
      for (const screenId of payload.screen_ids ?? []) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.screenSnapshot(screenId) });
      }
    },
    [queryClient],
  );

  const handleRealtimeStateUpdate = useCallback(
    (payload: ScreenStateUpdateEvent) => {
      const cacheKey = queryKeys.screenSnapshot(payload.screen.id);
      let shouldRefetch = false;

      queryClient.setQueryData(cacheKey, (current: ScreenSnapshot | undefined) => {
        if (!current) return current;

        const nextSnapshotId = payload.screen.publish?.snapshot_id ?? null;
        const currentSnapshotId = current.publish?.snapshot_id ?? null;
        shouldRefetch = Boolean(nextSnapshotId && nextSnapshotId !== currentSnapshotId);

        return {
          ...current,
          server_time: payload.server_time ?? current.server_time,
        };
      });

      if (shouldRefetch) {
        void queryClient.invalidateQueries({ queryKey: cacheKey });
      }
    },
    [queryClient],
  );

  const { isConnected, rejectedScreenIds, pendingEmergencyScreenIds } = useScreensRealtime({
    enabled: open,
    activeScreenId: selectedScreenId,
    includePreview: true,
    onlineOnly: true,
    onRefreshRequired: handleRealtimeRefresh,
    onStateUpdate: handleRealtimeStateUpdate,
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-7xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Online Screens Details</DialogTitle>
            <DialogDescription>
              Live operational view of online screens with mirrored playback and latest captured preview metadata.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={isConnected ? "default" : "secondary"}>
              <Activity className="mr-2 h-3 w-3" />
              {isConnected ? "Realtime connected" : "Realtime reconnecting"}
            </Badge>
            {pendingEmergencyScreenIds.length > 0 ? (
              <Badge variant="outline">Emergency refresh pending: {pendingEmergencyScreenIds.length}</Badge>
            ) : null}
            {rejectedScreenIds.length > 0 ? (
              <Badge variant="destructive">Realtime rejected: {rejectedScreenIds.length}</Badge>
            ) : null}
          </div>

          {overviewQuery.isLoading ? (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3" data-testid="online-screens-grid">
              {Array.from({ length: 3 }).map((_, index) => (
                <Card key={index}>
                  <Skeleton className="aspect-video w-full" />
                  <CardContent className="space-y-3 p-4">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-3/4" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : onlineScreens.length === 0 ? (
            <Card>
              <CardContent className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <Monitor className="h-10 w-10" />
                <div>
                  <p className="font-medium text-foreground">No online screens right now</p>
                  <p className="text-sm">Screens will appear here when their health state is ONLINE.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div
              data-testid="online-screens-grid"
              className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
            >
              {onlineScreens.map((screen) => (
                <PreviewCard
                  key={screen.id}
                  screen={screen}
                  onOpenDetails={setSelectedScreenId}
                  enabled={open}
                  clockTick={clockTick}
                />
              ))}
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
