import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Clock3, ExternalLink, ImageOff, LayoutTemplate, MapPin, Monitor, RadioTower } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ScreenDetailsModal } from "@/components/screens/ScreenDetailsModal";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { PageNavigation } from "@/components/common/PageNavigation";
import { screensApi } from "@/api/domains/screens";
import type { ScreenOverviewItem } from "@/api/types";

interface AllScreensDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PAGE_SIZE = 9;

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

const toCssAspectRatio = (value?: string | null) => {
  if (!value) return "16 / 9";
  return value.includes(":") ? value.replace(":", " / ") : value;
};

function ScreenSummaryCard({
  screen,
  onOpenDetails,
}: {
  screen: ScreenOverviewItem;
  onOpenDetails: (screenId: string) => void;
}) {
  const currentMediaName =
    screen.playback?.current_media?.name ||
    screen.playback?.current_media?.filename ||
    (screen.playback?.current_media_id ? `Media ${screen.playback.current_media_id}` : "No active media");
  const currentScheduleName =
    screen.publish?.schedule_name ||
    screen.current_schedule_id ||
    screen.playback?.current_schedule_id ||
    "No active schedule";

  return (
    <Card className="overflow-hidden" data-testid="all-screen-card">
      <div className="relative border-b bg-muted/30">
        <div
          className="flex w-full items-center justify-center overflow-hidden bg-muted/40"
          style={{ aspectRatio: toCssAspectRatio(screen.aspect_ratio) }}
        >
          {screen.preview?.screenshot_url ? (
            <img
              src={screen.preview.screenshot_url}
              alt={`${screen.name} latest preview`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <ImageOff className="h-8 w-8" />
              <span className="text-sm">No preview available yet</span>
            </div>
          )}
        </div>

        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <StatusBadge status={screen.health_state} />
          <Badge variant="secondary">{sourceLabel(screen.playback?.source)}</Badge>
          {!screen.is_active ? <Badge variant="outline">Inactive</Badge> : null}
          {screen.preview?.stale ? <Badge variant="destructive">Preview stale</Badge> : null}
        </div>
      </div>

      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{screen.name}</CardTitle>
            <p className="truncate text-sm text-muted-foreground">{screen.location || "No location"}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenDetails(screen.id)}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Details
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Monitor className="h-4 w-4" />
          <span className="truncate">{currentMediaName}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <LayoutTemplate className="h-4 w-4" />
          <span className="truncate">{currentScheduleName}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock3 className="h-4 w-4" />
          <span>Last heartbeat {formatRelativeTime(screen.last_heartbeat_at)}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <RadioTower className="h-4 w-4" />
          <span>Preview captured {formatRelativeTime(screen.preview?.captured_at)}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarClock className="h-4 w-4" />
          <span>Booked until {formatRelativeTime(screen.booked_until)}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <MapPin className="h-4 w-4" />
          <span>
            {screen.width && screen.height ? `${screen.width}x${screen.height}` : "Unknown resolution"}
            {screen.aspect_ratio ? ` · ${screen.aspect_ratio}` : ""}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function AllScreensDetailsModal({ open, onOpenChange }: AllScreensDetailsModalProps) {
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const overviewQuery = useQuery({
    queryKey: ["dashboard", "all-screens-overview"],
    queryFn: () =>
      screensApi.getOverview(
        { include_media: true, include_preview: true },
        { timeoutMs: 30_000 },
      ),
    enabled: open,
    staleTime: 30_000,
  });

  const screens = useMemo(
    () =>
      [...(overviewQuery.data?.screens ?? [])].sort((a, b) => {
        const aTime = Date.parse(a.last_heartbeat_at || "") || 0;
        const bTime = Date.parse(b.last_heartbeat_at || "") || 0;
        return bTime - aTime;
      }),
    [overviewQuery.data?.screens],
  );

  const selectedScreen = useMemo(
    () => screens.find((screen) => screen.id === selectedScreenId) ?? null,
    [screens, selectedScreenId],
  );

  const totalPages = Math.max(1, Math.ceil(screens.length / PAGE_SIZE));
  const paginatedScreens = useMemo(
    () => screens.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, screens],
  );

  const onlineCount = screens.filter((screen) => screen.health_state === "ONLINE").length;
  const staleOrOfflineCount = screens.filter((screen) =>
    ["OFFLINE", "STALE", "ERROR", "RECOVERY_REQUIRED"].includes(screen.health_state || ""),
  ).length;

  useEffect(() => {
    if (!open) {
      setPage(1);
      return;
    }

    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [open, page, totalPages]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-7xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>All Screens</DialogTitle>
            <DialogDescription>
              Fleet-wide view of every registered screen with live playback context, health state, and latest preview.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Total: {screens.length}</Badge>
            <Badge variant="default">Online: {onlineCount}</Badge>
            <Badge variant="outline">Attention needed: {staleOrOfflineCount}</Badge>
          </div>

          {overviewQuery.isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
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
          ) : overviewQuery.isError ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Unable to load screen overview right now.
              </CardContent>
            </Card>
          ) : screens.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No screens are registered yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, screens.length)} of {screens.length} screens
                </span>
                <Badge variant="outline">Page size: {PAGE_SIZE}</Badge>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {paginatedScreens.map((screen) => (
                  <ScreenSummaryCard
                    key={screen.id}
                    screen={screen}
                    onOpenDetails={setSelectedScreenId}
                  />
                ))}
              </div>
              <PageNavigation
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
                showPageNumbers
                className="flex justify-end"
              />
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
