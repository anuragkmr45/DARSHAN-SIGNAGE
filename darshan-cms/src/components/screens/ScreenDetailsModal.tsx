import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Battery,
  CheckCircle2,
  Clock,
  Cpu,
  Edit2,
  Flame,
  HardDrive,
  HeartPulse,
  MapPin,
  Monitor,
  Network,
  RadioTower,
  RefreshCcw,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { ScreenHealthDashboard } from "@/components/screens/ScreenHealthDashboard";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import type { ScreenPlaybackItemSummary } from "@/api/types";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { toast } from "sonner";
import { ApiError } from "@/api/apiClient";
import { getPlaybackTimingLabel, getServerClockOffsetMs, getServerNowFromOffset, isHeartbeatStale } from "@/hooks/screens/screensRealtimeUtils";
import {
  formatMaskedScreenId,
  getScreenAuthIndicator,
  getScreenHeartbeatIndicator,
  getScreenIndicatorBadgeClassName,
  getScreenPlaybackSourceLabel,
  maskCertificateSerial,
} from "@/lib/screens";

interface ScreenDetailsModalProps {
  screenId: string;
  screenName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  realtimeRejected?: boolean;
  pendingEmergency?: boolean;
}

const formatDateTime = (value?: string | null) => {
  if (!value) return "N/A";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "N/A";
  return new Date(timestamp).toLocaleString();
};

const getItemSummaryMediaLabel = (item: ScreenPlaybackItemSummary) => {
  if (!item.media.length) return "No media attached";
  return item.media
    .map((media) => {
      const name = media.name || media.id;
      return media.type ? `${name} (${media.type})` : name;
    })
    .join(", ");
};

const formatNumber = (value?: number | null, digits = 1) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "N/A";

const formatPercent = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "N/A";

const formatMegabytes = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} MB` : "N/A";

const formatGigabytes = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)} GB` : "N/A";

const getRealtimeConnectionLabel = (value?: string) => {
  switch (value) {
    case "WSS_HEALTHY": return "WSS healthy";
    case "REST_FALLBACK": return "REST fallback";
    case "VERSION_MISMATCH": return "Version mismatch";
    case "OFFLINE": return "Offline";
    default: return "Not reported";
  }
};

const getRealtimeConnectionBadgeClass = (value?: string) => {
  if (value === "WSS_HEALTHY") return "border-emerald-500 text-emerald-700";
  if (value === "REST_FALLBACK") return "border-amber-500 text-amber-700";
  return "border-red-500 text-red-700";
};

function TelemetryField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <Label className="text-muted-foreground">{label}</Label>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function getDeliveryBadgeClass(status?: string | null) {
  const normalized = status?.toUpperCase();
  if (normalized === "ACKED_SUCCESS" || normalized === "COMPLETED" || normalized === "DISPATCHED") {
    return "border-emerald-500 text-emerald-700";
  }
  if (["ACKED_FAILURE", "FAILED", "DEAD_LETTER", "EXPIRED", "CANCELLED"].includes(normalized || "")) {
    return "border-red-500 text-red-700";
  }
  if (normalized === "LEASED" || normalized === "SENT" || normalized === "PROCESSING" || normalized === "DISPATCHING") {
    return "border-blue-500 text-blue-700";
  }
  return "border-amber-500 text-amber-700";
}

function getFailureSeverityBadgeClass(severity?: string | null) {
  const normalized = severity?.toUpperCase();
  if (normalized === "CRITICAL" || normalized === "ERROR") {
    return "border-red-500 text-red-700";
  }
  if (normalized === "WARN") {
    return "border-amber-500 text-amber-700";
  }
  return "border-blue-500 text-blue-700";
}

function DeliveryMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded border p-3">
      <Label className="text-muted-foreground">{label}</Label>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

export function ScreenDetailsModal({
  screenId,
  screenName,
  open,
  onOpenChange,
  realtimeRejected = false,
  pendingEmergency = false,
}: ScreenDetailsModalProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", location: "" });
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [pendingSnapshotCapture, setPendingSnapshotCapture] = useState<{
    startedAt: number;
    previousCapturedAt: string | null;
  } | null>(null);

  const screenQuery = useQuery({
    queryKey: ["screen", screenId],
    queryFn: () => screensApi.getById(screenId),
    enabled: open,
  });

  const statusQuery = useQuery({
    queryKey: ["screen-status", screenId],
    queryFn: () => screensApi.getStatus(screenId),
    enabled: open,
  });

  const nowPlayingQuery = useQuery({
    queryKey: queryKeys.screenNowPlaying(screenId, { includeMedia: true, includeUrls: false, includePreview: true }),
    queryFn: () => screensApi.getNowPlaying(screenId, { include_media: true, include_preview: true }),
    enabled: open && !realtimeRejected,
  });

  const availabilityQuery = useQuery({
    queryKey: ["screen-availability", screenId],
    queryFn: () => screensApi.getAvailability(screenId),
    enabled: open,
  });

  const snapshotQuery = useQuery({
    queryKey: queryKeys.screenSnapshot(screenId),
    queryFn: () => screensApi.getSnapshot(screenId, true),
    enabled: open,
  });

  const deliveryStatusUiEnabled = import.meta.env.VITE_REALTIME_DELIVERY_STATUS_UI !== "false";
  const mediaCacheStatusUiEnabled = import.meta.env.VITE_MEDIA_CACHE_STATUS_UI !== "false";
  const deliveryStatusQuery = useQuery({
    queryKey: queryKeys.screenDeliveryStatus(screenId),
    queryFn: () => screensApi.getDeliveryStatus(screenId, 10),
    enabled: open && deliveryStatusUiEnabled,
    refetchInterval: open && deliveryStatusUiEnabled ? 15_000 : false,
  });
  const mediaCacheReportsQuery = useQuery({
    queryKey: queryKeys.screenMediaCacheReports(screenId),
    queryFn: () => screensApi.getMediaCacheReports(screenId, 10),
    enabled: open && deliveryStatusUiEnabled && mediaCacheStatusUiEnabled,
    refetchInterval: open && deliveryStatusUiEnabled && mediaCacheStatusUiEnabled ? 30_000 : false,
  });
  const displayStateQuery = useQuery({
    queryKey: ["screen-display-state", screenId],
    queryFn: () => screensApi.getDisplayState(screenId),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });

  useEffect(() => {
    const interval = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setServerClockOffsetMs(getServerClockOffsetMs(nowPlayingQuery.data?.server_time));
  }, [nowPlayingQuery.data?.server_time]);

  const serverNowMs = useMemo(
    () => getServerNowFromOffset(serverClockOffsetMs, clockTick),
    [clockTick, serverClockOffsetMs],
  );

  const updateScreen = useSafeMutation({
    mutationFn: (payload: { name: string; location?: string }) => screensApi.update(screenId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["screen", screenId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.screens });
      queryClient.invalidateQueries({ queryKey: queryKeys.screensOverview({ includeMedia: true }) });
      queryClient.invalidateQueries({ queryKey: queryKeys.screensOverview({ includeMedia: true, includePreview: true }) });
      setIsEditing(false);
      toast.success("Screen updated successfully");
    },
  }, "Unable to update screen.");

  const triggerScreenshot = useSafeMutation({
    mutationFn: () => screensApi.triggerScreenshot(screenId, { reason: "screen-details-modal" }),
    onSuccess: () => {
      setPendingSnapshotCapture({
        startedAt: Date.now(),
        previousCapturedAt:
          snapshotQuery.data?.preview?.captured_at ?? nowPlayingQuery.data?.preview?.captured_at ?? null,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.screenSnapshot(screenId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.screenNowPlaying(screenId, { includeMedia: true, includeUrls: false, includePreview: true }),
      });
      toast.success("Snapshot requested");
    },
  }, "Unable to trigger screenshot.");

  const updateDisplaySelection = useSafeMutation({
    mutationFn: (payload: { mode: "PRIMARY" } | { mode: "PINNED"; display_key: string; expected_profile_revision: number }) =>
      screensApi.setDisplaySelection(screenId, payload),
    onSuccess: (state) => {
      queryClient.setQueryData(["screen-display-state", screenId], state);
      void queryClient.invalidateQueries({ queryKey: ["screen-display-state", screenId] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.screens });
      toast.success(state.command ? "Display selection queued for the player" : "Display selection saved");
    },
  }, "Unable to update the preferred display.");

  const screen = screenQuery.data;
  const screenStatusDetails = statusQuery.data;
  const nowPlaying = nowPlayingQuery.data;
  const screenStatus = nowPlaying?.status || screen?.status || "UNKNOWN";
  const healthState = nowPlaying?.health_state || "UNKNOWN";
  const healthReason = nowPlaying?.health_reason || null;
  const authDiagnostics = nowPlaying?.auth_diagnostics || null;
  const activePairing = nowPlaying?.active_pairing || null;
  const isOffline = screenStatus === "OFFLINE";
  const hasStaleHeartbeat = isHeartbeatStale(nowPlaying?.last_heartbeat_at, nowPlaying?.server_time);
  const authIndicator = getScreenAuthIndicator(authDiagnostics);
  const heartbeatIndicator = getScreenHeartbeatIndicator(
    { status: screenStatus, health_state: healthState },
    hasStaleHeartbeat,
  );
  const playback = nowPlaying?.playback;
  const currentMedia = playback?.current_media;
  const currentSceneId = playback?.current_scene_id ?? nowPlaying?.current_scene_id ?? null;
  const activeSlots = playback?.active_slots ?? nowPlaying?.active_slots ?? [];
  const timingLabel = getPlaybackTimingLabel(playback?.started_at, playback?.ends_at, serverNowMs);
  const nowPlayingError = nowPlayingQuery.error instanceof ApiError ? nowPlayingQuery.error : null;
  const availability = availabilityQuery.data;
  const snapshot = snapshotQuery.data;
  // Delivery diagnostics may be absent while a backend is being upgraded. Do
  // not let an incomplete optional diagnostics response take down the whole
  // screen-details modal; expose its existing unavailable state instead.
  const deliveryStatus =
    deliveryStatusQuery.data?.commands &&
    Array.isArray(deliveryStatusQuery.data.commands.recent) &&
    deliveryStatusQuery.data?.outbox &&
    Array.isArray(deliveryStatusQuery.data.outbox.recent)
      ? deliveryStatusQuery.data
      : undefined;
  const mediaCacheReports = mediaCacheReportsQuery.data?.reports ?? [];
  const snapshotRefetch = snapshotQuery.refetch;
  const latestPreview = snapshot?.preview ?? nowPlaying?.preview ?? null;
  const activeItemSummaries = nowPlaying?.active_item_summaries ?? [];
  const upcomingItemSummaries = nowPlaying?.upcoming_item_summaries ?? [];
  const isTakingSnapshot = triggerScreenshot.isPending || Boolean(pendingSnapshotCapture);
  const telemetry = screenStatusDetails?.latest_heartbeat?.payload ?? null;
  const displayState = displayStateQuery.data;
  const displayProfile = displayState?.profile ?? null;
  const activeOutput = displayProfile?.output ?? null;
  const latestNowPlayingPreviewCapturedAt = nowPlayingQuery.data?.preview?.captured_at ?? null;

  useEffect(() => {
    if (screen) {
      setEditForm({
        name: screen.name,
        location: screen.location || "",
      });
    }
  }, [screen]);

  useEffect(() => {
    if (!open && pendingSnapshotCapture) {
      setPendingSnapshotCapture(null);
    }
  }, [open, pendingSnapshotCapture]);

  useEffect(() => {
    if (!open || !pendingSnapshotCapture) return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      const snapshotResult = await snapshotRefetch();
      const currentCapturedAt =
        snapshotResult.data?.preview?.captured_at ?? latestNowPlayingPreviewCapturedAt;

      if (currentCapturedAt && currentCapturedAt !== pendingSnapshotCapture.previousCapturedAt) {
        if (!cancelled) {
          setPendingSnapshotCapture(null);
          void queryClient.invalidateQueries({
            queryKey: queryKeys.screensOverview({ includeMedia: true, includePreview: true }),
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.screenNowPlaying(screenId, { includeMedia: true, includeUrls: false, includePreview: true }),
          });
          toast.success("Snapshot updated");
        }
        return;
      }

      if (Date.now() - pendingSnapshotCapture.startedAt > 20_000 && !cancelled) {
        setPendingSnapshotCapture(null);
        toast.error("Snapshot capture is taking longer than expected.");
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    latestNowPlayingPreviewCapturedAt,
    open,
    pendingSnapshotCapture,
    queryClient,
    screenId,
    snapshotRefetch,
  ]);

  const handleSave = () => {
    updateScreen.mutate({
      name: editForm.name.trim(),
      location: editForm.location.trim() || undefined,
    });
  };

  const initialLoading =
    (screenQuery.isLoading || nowPlayingQuery.isLoading || statusQuery.isLoading) && !screen && !nowPlaying;

  if (initialLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </DialogHeader>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const title = screen?.name || screenName || "Screen details";

  const renderUnavailableState = (
    titleText: string,
    description: string,
    retry?: () => void,
  ) => (
    <Card className="p-6 space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">{titleText}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex gap-2">
        {retry && (
          <Button variant="outline" onClick={retry}>
            Retry
          </Button>
        )}
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    </Card>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="flex items-center gap-2">
                {isEditing ? (
                  <Input
                    value={editForm.name}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="w-full max-w-full text-lg font-semibold"
                  />
                ) : (
                  <>
                    <Monitor className="h-5 w-5" />
                    <span className="truncate">{title}</span>
                  </>
                )}
              </DialogTitle>
              <DialogDescription className="break-all font-mono">
                {formatMaskedScreenId(screenId)}
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {isEditing ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={updateScreen.isPending || !editForm.name.trim()}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    {updateScreen.isPending ? "Saving..." : "Save"}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                  disabled={!screen}
                >
                  <Edit2 className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {realtimeRejected ? (
          renderUnavailableState(
            "Live updates unavailable",
            "This screen subscription was rejected. The screen may have been removed or access may have changed.",
            () => nowPlayingQuery.refetch(),
          )
        ) : nowPlayingError?.status === 404 ? (
          renderUnavailableState(
            "Screen not found",
            "The selected screen no longer exists.",
          )
        ) : (
          <Tabs defaultValue="overview" className="mt-4 min-w-0">
            <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto p-1">
              <TabsTrigger value="overview" className="shrink-0">
                Overview
              </TabsTrigger>
              <TabsTrigger value="status" className="shrink-0">
                Status
              </TabsTrigger>
              <TabsTrigger value="observability" className="shrink-0">
                Observability
              </TabsTrigger>
              {deliveryStatusUiEnabled ? (
                <TabsTrigger value="delivery" className="shrink-0">
                  Delivery
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="playing" className="shrink-0">
                Now Playing
              </TabsTrigger>
              <TabsTrigger value="snapshot" className="shrink-0">
                Snapshot
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {(pendingEmergency || playback?.source === "EMERGENCY") && (
                <Card className="border-red-200 bg-red-50 p-4">
                  <div className="flex items-center gap-2 text-red-700">
                    <Flame className="h-4 w-4" />
                    <div>
                      <p className="font-semibold">Emergency content is active</p>
                      <p className="text-sm">This screen is currently showing emergency playback.</p>
                    </div>
                  </div>
                </Card>
              )}

              {nowPlayingError?.status === 500 && nowPlaying ? (
                <Card className="border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-amber-800">
                      <AlertTriangle className="h-4 w-4" />
                      <p className="text-sm">Live playback refresh failed. Showing the last known state.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => nowPlayingQuery.refetch()}>
                      <RefreshCcw className="h-3 w-3 mr-1" />
                      Retry
                    </Button>
                  </div>
                </Card>
              ) : null}

              <Card className="p-4 space-y-3">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Location</Label>
                    {isEditing ? (
                      <Input
                        value={editForm.location}
                        onChange={(event) => setEditForm((prev) => ({ ...prev, location: event.target.value }))}
                        placeholder="Enter location"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        <span>{screen?.location || "Not set"}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Health</Label>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={String(healthState).toLowerCase()} />
                      <Badge variant="outline">{screenStatus}</Badge>
                      <Badge variant="outline">
                        {getScreenPlaybackSourceLabel(playback?.source, {
                          hasPublish: Boolean(nowPlaying?.publish),
                        })}
                      </Badge>
                      {authIndicator ? (
                        <Badge
                          variant="outline"
                          className={getScreenIndicatorBadgeClassName(authIndicator.tone)}
                        >
                          {authIndicator.tone === "ok" ? (
                            <ShieldCheck className="mr-1 h-3 w-3" />
                          ) : (
                            <ShieldAlert className="mr-1 h-3 w-3" />
                          )}
                          {authIndicator.label}
                        </Badge>
                      ) : null}
                      {heartbeatIndicator ? (
                        <Badge
                          variant="outline"
                          className={getScreenIndicatorBadgeClassName(heartbeatIndicator.tone)}
                        >
                          <HeartPulse className="mr-1 h-3 w-3" />
                          {heartbeatIndicator.label}
                        </Badge>
                      ) : null}
                      {activePairing?.mode === "RECOVERY" ? (
                        <Badge variant="outline" className="border-amber-500 text-amber-700">
                          Recovery pending
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Created</Label>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4" />
                      {formatDateTime(screen?.created_at)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Last Updated</Label>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4" />
                      {formatDateTime(screen?.updated_at)}
                    </div>
                  </div>
                </div>
                {authDiagnostics ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Auth diagnostics</Label>
                      <div className="space-y-1 text-sm">
                        <p className="font-medium">{authIndicator?.label || authDiagnostics.state || "Unknown"}</p>
                        {healthReason && healthState !== "ONLINE" ? (
                          <p className="text-muted-foreground">{healthReason}</p>
                        ) : authDiagnostics.reason && authDiagnostics.state !== "VALID" ? (
                          <p className="text-muted-foreground">{authDiagnostics.reason}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <Label className="text-muted-foreground">Certificate</Label>
                      <p>Serial: <span className="font-mono">{maskCertificateSerial(authDiagnostics.latest_certificate_serial)}</span></p>
                      <p>Expires: {formatDateTime(authDiagnostics.latest_certificate_expires_at)}</p>
                      <p>Revoked at: {formatDateTime(authDiagnostics.latest_certificate_revoked_at)}</p>
                    </div>
                  </div>
                ) : null}
              </Card>

              <Card className="p-4 space-y-4" data-testid="screen-display-authority">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">Display authority</h3>
                    <p className="text-sm text-muted-foreground">Choose the output the player should use. Changes are delivered as a device command.</p>
                  </div>
                  <Badge variant="outline" className={displayState?.placement === "VERIFIED" ? "border-emerald-500 text-emerald-700" : "border-amber-500 text-amber-700"}>
                    {displayState?.placement || "UNVERIFIED"}
                  </Badge>
                </div>
                {displayStateQuery.isLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : !displayProfile ? (
                  <p className="text-sm text-muted-foreground">This player has not reported Display Profile V1 yet. Primary output remains the safe default.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
                      <TelemetryField label="Preferred output" value={displayState.desired_selection.mode === "PRIMARY" ? "Primary" : displayState.desired_selection.preferred_key || "Unavailable"} />
                      <TelemetryField label="Active output" value={activeOutput?.label || activeOutput?.key || "None"} />
                      <TelemetryField label="Output geometry" value={activeOutput ? `${activeOutput.bounds_dip.width} × ${activeOutput.bounds_dip.height} DIP · ${activeOutput.aspect.exact_key} · ${activeOutput.orientation}` : "None"} />
                      <TelemetryField label="Renderer viewport" value={displayProfile.viewport ? `${displayProfile.viewport.width_css_px} × ${displayProfile.viewport.height_css_px} CSS px · ${displayProfile.viewport.density}${displayProfile.viewport.conformant ? "" : " · UNFIT"}` : "Not reported"} />
                    </div>
                    {displayProfile.selection.fallback_used || displayState.placement !== "VERIFIED" ? (
                      <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                        {displayProfile.selection.fallback_reason || "Placement is not verified"}. The player may currently be using its primary output.
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Label htmlFor="preferred-display" className="shrink-0">Preferred output</Label>
                      <select
                        id="preferred-display"
                        aria-label="Preferred display output"
                        className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                        value={displayState.desired_selection.mode === "PRIMARY" ? "__PRIMARY__" : displayState.desired_selection.preferred_key || "__PRIMARY__"}
                        disabled={updateDisplaySelection.isPending}
                        onChange={(event) => {
                          const value = event.target.value;
                          updateDisplaySelection.mutate(value === "__PRIMARY__"
                            ? { mode: "PRIMARY" }
                            : { mode: "PINNED", display_key: value, expected_profile_revision: displayState.profile_revision });
                        }}
                      >
                        <option value="__PRIMARY__">Primary output</option>
                        {displayProfile.inventory.map((output) => (
                          <option key={output.key} value={output.key} disabled={output.identity_confidence === "SESSION"}>
                            {(output.label || output.key)} — {output.bounds_dip.width}×{output.bounds_dip.height} DIP · {output.identity_confidence}{output.identity_confidence === "SESSION" ? " (ambiguous)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-xs text-muted-foreground">Scale {activeOutput?.scale_factor ?? "N/A"}; rotation {activeOutput?.rotation_degrees ?? "N/A"}°; observed {formatDateTime(displayState.observed_at)}.</p>
                  </>
                )}
              </Card>

              {availability && (
                <Card className="p-4">
                  <h3 className="font-semibold mb-2">Availability</h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-sm">
                    <div>
                      <Label className="text-muted-foreground">Current state</Label>
                      <p className="font-medium">
                        {availability.is_available_now ? "Available now" : "Booked right now"}
                      </p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Booked until</Label>
                      <p>{formatDateTime(availability.booked_until)}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Published schedule</Label>
                      <p>{availability.publish?.schedule_name || "No active published schedule"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Current items</Label>
                      <p>{availability.current_item_summaries?.length ?? availability.current_items?.length ?? 0}</p>
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-muted-foreground">Next item</Label>
                      {availability.next_item_summary ? (
                        <div className="mt-1 rounded border p-3">
                          <p className="font-medium">
                            {availability.next_item_summary.presentation_name || "Scheduled presentation"}
                          </p>
                          <p className="text-muted-foreground">
                            {formatDateTime(availability.next_item_summary.start_at)} to{" "}
                            {formatDateTime(availability.next_item_summary.end_at)}
                          </p>
                          <p className="text-muted-foreground">
                            {getItemSummaryMediaLabel(availability.next_item_summary)}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-1 text-muted-foreground">No upcoming booking</p>
                      )}
                    </div>
                  </div>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="status">
              {nowPlaying ? (
                <div className="space-y-4">
                  <Card className="p-4 space-y-3">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <Label className="text-muted-foreground">Live state</Label>
                        <p className="text-lg font-semibold">{screenStatus}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Health state</Label>
                        <p className="text-lg font-semibold">{healthState}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Playback source</Label>
                        <p className="text-lg font-semibold">
                          {getScreenPlaybackSourceLabel(playback?.source, {
                            hasPublish: Boolean(nowPlaying?.publish),
                          })}
                        </p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Last heartbeat</Label>
                        <p className="text-sm">{formatDateTime(nowPlaying.last_heartbeat_at)}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Booked until</Label>
                        <p className="text-sm">{formatDateTime(nowPlaying.booked_until)}</p>
                      </div>
                      {playback?.heartbeat_received_at && (
                        <div>
                          <Label className="text-muted-foreground">Heartbeat received</Label>
                          <p className="text-sm">{formatDateTime(playback.heartbeat_received_at)}</p>
                        </div>
                      )}
                      {playback?.last_proof_of_play_at && (
                        <div>
                          <Label className="text-muted-foreground">Last proof-of-play</Label>
                          <p className="text-sm">{formatDateTime(playback.last_proof_of_play_at)}</p>
                        </div>
                      )}
                      {activePairing?.mode && (
                        <div>
                          <Label className="text-muted-foreground">Active pairing</Label>
                          <p className="text-sm">{activePairing.mode}</p>
                        </div>
                      )}
                    </div>
                  </Card>

                  <Card className="p-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold">Latest Device Telemetry</h3>
                    </div>
                    {telemetry ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <TelemetryField label="CPU usage" value={formatPercent(telemetry.cpu_usage)} />
                          <TelemetryField label="CPU temp" value={telemetry.cpu_temp_c !== undefined ? `${formatNumber(telemetry.cpu_temp_c)} °C` : telemetry.temperature !== undefined ? `${formatNumber(telemetry.temperature)} °C` : "N/A"} />
                          <TelemetryField label="CPU cores" value={telemetry.cpu_cores ? String(telemetry.cpu_cores) : "N/A"} />
                          <TelemetryField label="Load avg" value={[telemetry.cpu_load_1m, telemetry.cpu_load_5m, telemetry.cpu_load_15m].some((value) => typeof value === "number") ? `${formatNumber(telemetry.cpu_load_1m, 2)} / ${formatNumber(telemetry.cpu_load_5m, 2)} / ${formatNumber(telemetry.cpu_load_15m, 2)}` : "N/A"} />
                        </div>

                        <Card className="border-dashed p-3" data-testid="screen-realtime-diagnostics">
                          <div className="mb-2 flex items-center gap-2">
                            <RadioTower className="h-4 w-4 text-primary" />
                            <h4 className="font-medium">Realtime delivery</h4>
                            <Badge
                              variant="outline"
                              className={getRealtimeConnectionBadgeClass(telemetry.realtime_diagnostics?.connection_state)}
                            >
                              {getRealtimeConnectionLabel(telemetry.realtime_diagnostics?.connection_state)}
                            </Badge>
                          </div>
                          {telemetry.realtime_diagnostics ? (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                              <TelemetryField label="Release" value={telemetry.realtime_diagnostics.release_id || "Not reported"} />
                              <TelemetryField label="Backend release" value={telemetry.realtime_diagnostics.server_release_id || "Not reported"} />
                              <TelemetryField label="Source commit" value={telemetry.realtime_diagnostics.source_commit || "Not reported"} />
                              <TelemetryField label="HELLO acknowledged" value={formatDateTime(telemetry.realtime_diagnostics.last_hello_ack_at)} />
                              <TelemetryField label="Last reconciliation" value={formatDateTime(telemetry.realtime_diagnostics.last_reconciliation_at)} />
                              <TelemetryField label="Last fallback fetch" value={formatDateTime(telemetry.realtime_diagnostics.last_fallback_fetch_at)} />
                              <TelemetryField label="State version" value={`${telemetry.realtime_diagnostics.applied_state_version ?? "?"} applied / ${telemetry.realtime_diagnostics.observed_state_version ?? "?"} observed`} />
                              <TelemetryField label="Reconnects" value={String(telemetry.realtime_diagnostics.reconnect_count ?? 0)} />
                              <TelemetryField label="Reconciliation failures" value={String(telemetry.realtime_diagnostics.reconciliation_failure_count ?? 0)} />
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">This player has not reported realtime delivery diagnostics yet.</p>
                          )}
                        </Card>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <TelemetryField label="RAM usage" value={formatPercent(telemetry.memory_usage)} />
                          <TelemetryField label="RAM total" value={formatMegabytes(telemetry.memory_total_mb)} />
                          <TelemetryField label="RAM used" value={formatMegabytes(telemetry.memory_used_mb)} />
                          <TelemetryField label="RAM free" value={formatMegabytes(telemetry.memory_free_mb)} />
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <TelemetryField label="Disk usage" value={formatPercent(telemetry.disk_usage_percent)} />
                          <TelemetryField label="Disk total" value={formatGigabytes(telemetry.disk_total_gb)} />
                          <TelemetryField label="Disk used" value={formatGigabytes(telemetry.disk_used_gb)} />
                          <TelemetryField label="Disk free" value={formatGigabytes(telemetry.disk_free_gb)} />
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <TelemetryField label="GPU usage" value={formatPercent(telemetry.gpu_usage)} />
                          <TelemetryField label="GPU temp" value={telemetry.gpu_temp_c !== undefined ? `${formatNumber(telemetry.gpu_temp_c)} °C` : "N/A"} />
                          <TelemetryField label="Battery" value={telemetry.battery_percent !== undefined ? `${formatNumber(telemetry.battery_percent)}%` : "N/A"} />
                          <TelemetryField label="Power source" value={telemetry.power_source || "N/A"} />
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <TelemetryField label="Charging" value={typeof telemetry.is_charging === "boolean" ? (telemetry.is_charging ? "Yes" : "No") : "N/A"} />
                          <TelemetryField label="Hostname" value={telemetry.hostname || "N/A"} />
                          <TelemetryField label="OS version" value={telemetry.os_version || "N/A"} />
                          <TelemetryField label="Player uptime" value={telemetry.player_uptime_seconds !== undefined ? `${telemetry.player_uptime_seconds}s` : telemetry.uptime !== undefined ? `${telemetry.uptime}s` : "N/A"} />
                        </div>

                        <Card className="border-dashed p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <Network className="h-4 w-4 text-primary" />
                            <h4 className="font-medium">Network</h4>
                          </div>
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <TelemetryField label="Interface" value={telemetry.network_interface || "N/A"} />
                            <TelemetryField label="IP address" value={telemetry.network_ip || "N/A"} />
                            <TelemetryField label="RTT" value={telemetry.network_rtt_ms !== undefined ? `${formatNumber(telemetry.network_rtt_ms)} ms` : "N/A"} />
                            <TelemetryField label="Packet loss" value={formatPercent(telemetry.network_packet_loss_percent)} />
                          </div>
                        </Card>

                        <Card className="border-dashed p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <Monitor className="h-4 w-4 text-primary" />
                            <h4 className="font-medium">Displays</h4>
                          </div>
                          <p className="mb-3 text-sm text-muted-foreground">
                            Reported displays: {telemetry.display_count ?? telemetry.displays?.length ?? 0}
                          </p>
                          {telemetry.displays?.length ? (
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              {telemetry.displays.map((display, index) => (
                                <div key={display.id || `${display.width}x${display.height}-${index}`} className="rounded border p-3 text-sm">
                                  <p className="font-medium">{display.model || display.id || `Display ${index + 1}`}</p>
                                  <p className="text-muted-foreground">{display.width} x {display.height}</p>
                                  <p className="text-muted-foreground">
                                    {display.orientation || "unknown"}{display.refresh_rate_hz ? ` · ${display.refresh_rate_hz} Hz` : ""}
                                  </p>
                                  <p className="text-muted-foreground">
                                    {typeof display.connected === "boolean" ? (display.connected ? "Connected" : "Disconnected") : "Connection unknown"}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">No display inventory reported yet.</p>
                          )}
                        </Card>

                        {telemetry.metrics && Object.keys(telemetry.metrics).length > 0 ? (
                          <Card className="border-dashed p-3">
                            <div className="mb-2 flex items-center gap-2">
                              <Battery className="h-4 w-4 text-primary" />
                              <h4 className="font-medium">Additional Metrics</h4>
                            </div>
                            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
                              {JSON.stringify(telemetry.metrics, null, 2)}
                            </pre>
                          </Card>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No heartbeat telemetry payload has been reported for this screen yet.</p>
                    )}
                  </Card>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">No status data available</p>
              )}
            </TabsContent>

            <TabsContent value="observability">
              <ScreenHealthDashboard screenId={screenId} screenName={screenName || screen?.name || "Screen"} />
            </TabsContent>

            {deliveryStatusUiEnabled ? (
              <TabsContent value="delivery" className="space-y-4">
                {deliveryStatusQuery.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-48 w-full" />
                  </div>
                ) : deliveryStatusQuery.error ? (
                  <Card className="border-amber-200 bg-amber-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 text-amber-800">
                        <AlertTriangle className="h-4 w-4" />
                        <p className="text-sm">Delivery status is unavailable.</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => deliveryStatusQuery.refetch()}>
                        <RefreshCcw className="h-3 w-3 mr-1" />
                        Retry
                      </Button>
                    </div>
                  </Card>
                ) : deliveryStatus ? (
                  <>
                    <Card className="p-4 space-y-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <Send className="h-4 w-4 text-primary" />
                            <h3 className="font-semibold">Command delivery</h3>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Desired state v{deliveryStatus.desired_state?.state_version ?? "N/A"} · Command v{deliveryStatus.desired_state?.command_version ?? "N/A"}
                          </p>
                        </div>
                        <Badge variant="outline" className={getDeliveryBadgeClass(deliveryStatus.commands.recent[0]?.lifecycle_status)}>
                          {deliveryStatus.commands.recent[0]?.lifecycle_status || "NO_COMMANDS"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <DeliveryMetric label="Pending" value={deliveryStatus.commands.pending} />
                        <DeliveryMetric label="Leased" value={deliveryStatus.commands.leased} />
                        <DeliveryMetric label="Succeeded" value={deliveryStatus.commands.succeeded} />
                        <DeliveryMetric label="Failed" value={deliveryStatus.commands.failed + deliveryStatus.commands.dead_letter + deliveryStatus.commands.expired} />
                      </div>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-sm">
                        <div>
                          <Label className="text-muted-foreground">Snapshot</Label>
                          <p className="font-mono text-xs">{deliveryStatus.desired_state?.snapshot_id || "N/A"}</p>
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Default media version</Label>
                          <p className="font-mono text-xs">{deliveryStatus.desired_state?.default_media_version || "N/A"}</p>
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Emergency version</Label>
                          <p className="font-mono text-xs">{deliveryStatus.desired_state?.emergency_version || "N/A"}</p>
                        </div>
                      </div>
                    </Card>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <Card className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-semibold">Publish delivery</h3>
                          <Badge variant="outline" className={getDeliveryBadgeClass(deliveryStatus.publish?.delivery.latest_lifecycle_status)}>
                            {deliveryStatus.publish?.delivery.latest_lifecycle_status || "NO_PUBLISH_COMMAND"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <Label className="text-muted-foreground">Published</Label>
                            <p>{formatDateTime(deliveryStatus.publish?.published_at)}</p>
                          </div>
                          <div>
                            <Label className="text-muted-foreground">Recent commands</Label>
                            <p>{deliveryStatus.publish?.delivery.total_recent ?? 0}</p>
                          </div>
                          <div className="col-span-2">
                            <Label className="text-muted-foreground">Snapshot</Label>
                            <p className="font-mono text-xs">{deliveryStatus.publish?.snapshot_id || "N/A"}</p>
                          </div>
                        </div>
                      </Card>

                      <Card className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-semibold">Emergency delivery</h3>
                          <Badge variant="outline" className={getDeliveryBadgeClass(deliveryStatus.emergency?.delivery.latest_lifecycle_status)}>
                            {deliveryStatus.emergency?.active ? deliveryStatus.emergency.delivery.latest_lifecycle_status || "ACTIVE" : "INACTIVE"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <Label className="text-muted-foreground">State</Label>
                            <p>{deliveryStatus.emergency?.active ? "Active" : "Inactive"}</p>
                          </div>
                          <div>
                            <Label className="text-muted-foreground">Recent commands</Label>
                            <p>{deliveryStatus.emergency?.delivery.total_recent ?? 0}</p>
                          </div>
                          <div>
                            <Label className="text-muted-foreground">Failures</Label>
                            <p>{deliveryStatus.emergency?.delivery.failed ?? 0}</p>
                          </div>
                          <div>
                            <Label className="text-muted-foreground">Created</Label>
                            <p>{formatDateTime(deliveryStatus.emergency?.created_at)}</p>
                          </div>
                        </div>
                      </Card>
                    </div>

                    <Card className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold">Recent commands</h3>
                        <Button variant="outline" size="sm" onClick={() => deliveryStatusQuery.refetch()}>
                          <RefreshCcw className="h-3 w-3 mr-1" />
                          Refresh
                        </Button>
                      </div>
                      {deliveryStatus.commands.recent.length ? (
                        <div className="space-y-2">
                          {deliveryStatus.commands.recent.map((command) => (
                            <div key={command.id} className="rounded border p-3 text-sm">
                              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline">{command.type}</Badge>
                                    <Badge variant="outline" className={getDeliveryBadgeClass(command.lifecycle_status)}>
                                      {command.lifecycle_status}
                                    </Badge>
                                    {command.priority ? <Badge variant="outline">P{command.priority}</Badge> : null}
                                  </div>
                                  <p className="mt-2 font-mono text-xs text-muted-foreground break-all">{command.id}</p>
                                  {command.last_error ? (
                                    <p className="mt-1 flex items-center gap-1 text-red-700">
                                      <XCircle className="h-3 w-3" />
                                      {command.last_error}
                                    </p>
                                  ) : command.lifecycle_status === "ACKED_SUCCESS" ? (
                                    <p className="mt-1 flex items-center gap-1 text-emerald-700">
                                      <CheckCircle2 className="h-3 w-3" />
                                      ACK received
                                    </p>
                                  ) : null}
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground md:text-right">
                                  <span>Attempts</span>
                                  <span>{command.attempt_count ?? 0}/{command.max_attempts ?? "N/A"}</span>
                                  <span>Created</span>
                                  <span>{formatDateTime(command.created_at)}</span>
                                  <span>ACK</span>
                                  <span>{formatDateTime(command.acknowledged_at)}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No recent commands.</p>
                      )}
                    </Card>

                    {mediaCacheStatusUiEnabled ? (
                      <Card className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <HardDrive className="h-4 w-4 text-primary" />
                            <h3 className="font-semibold">Media/cache failures</h3>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => mediaCacheReportsQuery.refetch()}>
                            <RefreshCcw className="h-3 w-3 mr-1" />
                            Refresh
                          </Button>
                        </div>
                        {mediaCacheReportsQuery.isLoading ? (
                          <div className="space-y-2">
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                          </div>
                        ) : mediaCacheReportsQuery.error ? (
                          <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                            <AlertTriangle className="h-4 w-4" />
                            Media/cache status is unavailable.
                          </div>
                        ) : mediaCacheReports.length ? (
                          <div className="space-y-2">
                            {mediaCacheReports.map((report) => (
                              <div key={report.id} className="rounded border p-3 text-sm">
                                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant="outline" className={getFailureSeverityBadgeClass(report.severity)}>
                                        {report.severity}
                                      </Badge>
                                      <Badge variant="outline">{report.event_type}</Badge>
                                      {report.source ? <Badge variant="outline">{report.source}</Badge> : null}
                                    </div>
                                    {report.message ? (
                                      <p className="mt-2 text-red-700">{report.message}</p>
                                    ) : null}
                                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                      {report.media_id || report.cache_key || "No media id"}
                                    </p>
                                    {report.url_host ? (
                                      <p className="mt-1 text-xs text-muted-foreground">Host: {report.url_host}</p>
                                    ) : null}
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground md:text-right">
                                    <span>Status</span>
                                    <span>{report.status}</span>
                                    <span>HTTP</span>
                                    <span>{report.http_status ?? "N/A"}</span>
                                    <span>Reported</span>
                                    <span>{formatDateTime(report.reported_at)}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No media/cache failures reported.</p>
                        )}
                      </Card>
                    ) : null}

                    <Card className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold">Notification outbox</h3>
                        <Badge variant="outline" className={deliveryStatus.outbox.failed > 0 ? "border-red-500 text-red-700" : "border-emerald-500 text-emerald-700"}>
                          {deliveryStatus.outbox.failed > 0 ? `${deliveryStatus.outbox.failed} failed` : `${deliveryStatus.outbox.dispatched} dispatched`}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <DeliveryMetric label="Pending" value={deliveryStatus.outbox.pending} />
                        <DeliveryMetric label="Dispatching" value={deliveryStatus.outbox.dispatching} />
                        <DeliveryMetric label="Dispatched" value={deliveryStatus.outbox.dispatched} />
                        <DeliveryMetric label="Failed" value={deliveryStatus.outbox.failed} />
                      </div>
                    </Card>
                  </>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No delivery status available</p>
                )}
              </TabsContent>
            ) : null}

            <TabsContent value="playing" className="space-y-4">
              {nowPlaying ? (
                <>
                  <Card className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <RadioTower className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold">Live playback</h3>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <Label className="text-muted-foreground">
                          {activeSlots.length > 1 ? "Current media (primary slot)" : "Current media"}
                        </Label>
                        <p className="text-lg font-semibold">
                          {currentMedia?.name || playback?.current_media_id || "No media playing"}
                        </p>
                        {playback?.current_media_id && (
                          <p className="text-xs font-mono text-muted-foreground">
                            {playback.current_media_id}
                          </p>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <Label className="text-muted-foreground">Timing</Label>
                          <p className="text-sm">{timingLabel || "No active playback window"}</p>
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Current schedule</Label>
                          <p className="text-sm">
                            {nowPlaying.current_schedule?.name || "No schedule currently active"}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <Label className="text-muted-foreground">Current scene</Label>
                          <p className="text-sm font-mono">{currentSceneId || "No active scene reported"}</p>
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Active slots</Label>
                          <p className="text-sm">
                            {activeSlots.length > 0
                              ? `${activeSlots.length} slot${activeSlots.length === 1 ? "" : "s"} reporting playback`
                              : "No slot-level playback reported"}
                          </p>
                        </div>
                      </div>
                      {activeSlots.length > 0 && (
                        <div className="space-y-2">
                          <Label className="text-muted-foreground">Slot playback</Label>
                          <div className="space-y-2">
                            {activeSlots.map((slot) => (
                              <div key={slot.playback_instance_id} className="rounded border p-3 text-sm space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline">{slot.slot_id}</Badge>
                                  <span className="font-medium">{slot.media_id || "No media id reported"}</span>
                                </div>
                                <p className="text-muted-foreground">
                                  Item {slot.item_id}
                                  {slot.schedule_id ? ` • Schedule ${slot.schedule_id}` : ""}
                                </p>
                                <p className="text-muted-foreground">Started {formatDateTime(slot.started_at)}</p>
                                <p className="text-xs font-mono text-muted-foreground">
                                  {slot.playback_instance_id}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>

                  {currentMedia && (
                    <Card className="p-4 space-y-2">
                      <h3 className="font-semibold">Media details</h3>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-sm">
                        <div>
                          <Label className="text-muted-foreground">Type</Label>
                          <p>{currentMedia.type || "Unknown"}</p>
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Content type</Label>
                          <p>{currentMedia.source_content_type || currentMedia.content_type || "Unknown"}</p>
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Resolution</Label>
                          <p>
                            {currentMedia.width && currentMedia.height
                              ? `${currentMedia.width} x ${currentMedia.height}`
                              : "N/A"}
                          </p>
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Duration</Label>
                          <p>
                            {typeof currentMedia.duration_seconds === "number"
                              ? `${currentMedia.duration_seconds}s`
                              : "N/A"}
                          </p>
                        </div>
                      </div>
                    </Card>
                  )}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Card className="p-4">
                      <h3 className="font-semibold mb-2">Active items</h3>
                      {activeItemSummaries.length ? (
                        <div className="space-y-2">
                          {activeItemSummaries.map((item) => (
                            <div key={item.item_id} className="rounded border p-3 text-sm space-y-1">
                              <p className="font-medium">{item.presentation_name || "Scheduled presentation"}</p>
                              {item.layout_name ? (
                                <p className="text-muted-foreground">Layout: {item.layout_name}</p>
                              ) : null}
                              <p className="text-muted-foreground">
                                {formatDateTime(item.start_at)} to {formatDateTime(item.end_at)}
                              </p>
                              <p className="text-muted-foreground">{getItemSummaryMediaLabel(item)}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No active items</p>
                      )}
                    </Card>

                    <Card className="p-4">
                      <h3 className="font-semibold mb-2">Upcoming items</h3>
                      {upcomingItemSummaries.length ? (
                        <div className="space-y-2">
                          {upcomingItemSummaries.map((item) => (
                            <div key={item.item_id} className="rounded border p-3 text-sm space-y-1">
                              <p className="font-medium">{item.presentation_name || "Scheduled presentation"}</p>
                              {item.layout_name ? (
                                <p className="text-muted-foreground">Layout: {item.layout_name}</p>
                              ) : null}
                              <p className="text-muted-foreground">
                                {formatDateTime(item.start_at)} to {formatDateTime(item.end_at)}
                              </p>
                              <p className="text-muted-foreground">{getItemSummaryMediaLabel(item)}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No upcoming items</p>
                      )}
                    </Card>
                  </div>
                </>
              ) : (
                <p className="text-center text-muted-foreground py-8">No content currently playing</p>
              )}
            </TabsContent>

            <TabsContent value="snapshot">
              {snapshot ? (
                <Card className="p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-muted-foreground">Latest preview</Label>
                      <p className="text-sm">{formatDateTime(latestPreview?.captured_at)}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => triggerScreenshot.mutate()}
                      disabled={isTakingSnapshot}
                    >
                      <RefreshCcw className={`h-3 w-3 mr-1 ${isTakingSnapshot ? "animate-spin" : ""}`} />
                      {isTakingSnapshot ? "Capturing..." : "Take Snapshot"}
                    </Button>
                  </div>

                  {latestPreview?.screenshot_url ? (
                    <div className="space-y-2">
                      <img
                        src={latestPreview.screenshot_url}
                        alt="Latest captured screen preview"
                        className="w-full rounded-md border bg-black object-contain max-h-[360px]"
                      />
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>Captured: {formatDateTime(latestPreview.captured_at)}</span>
                        <span>{latestPreview.stale ? "Preview is stale" : "Preview is fresh"}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No captured preview available yet.
                    </p>
                  )}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-sm">
                    <div>
                      <Label className="text-muted-foreground">Playback source</Label>
                      <p>
                        {getScreenPlaybackSourceLabel(playback?.source, {
                          hasPublish: Boolean(snapshot.publish),
                        })}
                      </p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Published at</Label>
                      <p>{formatDateTime(snapshot.publish?.published_at)}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Schedule</Label>
                      <p>{snapshot.snapshot?.schedule?.name || nowPlaying?.current_schedule?.name || "None"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Snapshot items</Label>
                      <p>{snapshot.snapshot?.schedule?.items?.length ?? 0}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Emergency</Label>
                      <p>{snapshot.emergency ? "Active" : "Not active"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Default media</Label>
                      <p>{snapshot.default_media ? "Configured" : "Not configured"}</p>
                    </div>
                  </div>

                  {playback?.current_media && (
                    <div>
                      <Label className="text-muted-foreground">Current Media</Label>
                      <p className="font-semibold">
                        {playback.current_media.name || playback.current_media.filename || "Unknown media"}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground">{playback.current_media.id}</p>
                      {playback.current_media.media_url && (
                        <a
                          href={playback.current_media.media_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View Media
                        </a>
                      )}
                    </div>
                  )}
                </Card>
              ) : (
                <p className="text-center text-muted-foreground py-8">No snapshot data available</p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
