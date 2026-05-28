import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Calendar, Eye, HardDrive, Monitor, Plus, Server, Trash2 } from "lucide-react";
import { KPICard } from "@/components/dashboard/KPICard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToastAction } from "@/components/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { metricsApi } from "@/api/domains/metrics";
import { observabilityApi } from "@/api/domains/observability";
import { ApiError } from "@/api/apiClient";
import { useToast } from "@/hooks/use-toast";
import { useAppSelector } from "@/store/hooks";
import { reportsApi } from "@/api/domains/reports";
import { healthApi } from "@/api/domains/health";
import { mediaApi } from "@/api/domains/media";
import type { MediaAsset } from "@/api/types";
import { MediaPreview } from "@/components/common/MediaPreview";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { mapMediaDeleteError } from "@/lib/mediaDeleteErrors";
import { OnlineScreensDetailsModal } from "@/components/dashboard/OnlineScreensDetailsModal";
import { ActiveScheduledTimelineModal } from "@/components/dashboard/ActiveScheduledTimelineModal";
import { AllScreensDetailsModal } from "@/components/dashboard/AllScreensDetailsModal";
import { ScheduleReportModal } from "@/components/dashboard/ScheduleReportModal";
import { getMachineStatusTone, getServiceStatusTone } from "@/lib/observability";
import { resolveMediaDisplayName } from "@/lib/media";

const formatBytes = (bytes?: number | null) => {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
};

const formatPercent = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
};

const formatMegabytes = (bytes?: number | null) => {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const formatRelativeTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDistanceToNow(date, { addSuffix: true });
};

const normalizeHealthStatus = (status?: string) => (status || "unknown").toLowerCase();

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

export default function Dashboard() {
  const [selectedKPI, setSelectedKPI] = useState<string | null>(null);
  const [previewMedia, setPreviewMedia] = useState<MediaAsset | null>(null);
  const [previewMediaId, setPreviewMediaId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaAsset | null>(null);
  const [scheduleReportOpen, setScheduleReportOpen] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authToken = useAppSelector((state) => state.auth.token);
  const user = useAppSelector((state) => state.auth.user);
  const isAuthenticated = Boolean(authToken || user);

  const {
    data: overview,
    isLoading: isMetricsLoading,
    isError: isMetricsError,
    error: metricsError,
  } = useQuery({
    queryKey: ["metrics-overview"],
    queryFn: metricsApi.getOverview,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const {
    data: apiHealth,
    isLoading: isHealthLoading,
    isError: isHealthError,
    error: healthError,
  } = useQuery({
    queryKey: ["health"],
    queryFn: healthApi.get,
    staleTime: 30_000,
  });

  const {
    data: observabilityOverview,
    isLoading: isObservabilityLoading,
    isError: isObservabilityError,
    error: observabilityError,
  } = useQuery({
    queryKey: ["observability-overview"],
    queryFn: observabilityApi.getOverview,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const {
    data: requestsByDept,
    isLoading: isRequestsLoading,
    isError: isRequestsError,
    error: requestsError,
  } = useQuery({
    queryKey: ["reports-requests-by-department"],
    queryFn: reportsApi.getRequestsByDepartment,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const {
    data: offlineScreens,
    isLoading: isOfflineLoading,
    isError: isOfflineError,
    error: offlineError,
  } = useQuery({
    queryKey: ["reports-offline-screens"],
    queryFn: reportsApi.getOfflineScreens,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const {
    data: storageReport,
    isLoading: isStorageLoading,
    isError: isStorageError,
    error: storageError,
  } = useQuery({
    queryKey: ["reports-storage"],
    queryFn: reportsApi.getStorageReport,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const {
    data: systemHealth,
    isLoading: isSystemHealthLoading,
    isError: isSystemHealthError,
    error: systemHealthError,
  } = useQuery({
    queryKey: ["reports-system-health"],
    queryFn: reportsApi.getSystemHealth,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const {
    data: allMedia,
    isLoading: isMediaLoading,
    isError: isMediaError,
    error: mediaError,
  } = useQuery({
    queryKey: ["dashboard", "media-storage-modal"],
    enabled: isAuthenticated && selectedKPI === "storage",
    staleTime: 60_000,
    queryFn: async () => {
      const limit = 100;
      let page = 1;
      let total = 0;
      const items: MediaAsset[] = [];

      do {
        const response = await mediaApi.list({ page, limit, status: "READY" });
        total = response.total ?? 0;
        items.push(...(response.items ?? []));
        page += 1;
      } while (items.length < total && total > 0);

      return items.filter((item) => item.status === "READY");
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: async (mediaId: string) => {
      const response = await mediaApi.remove(mediaId, { hard: true });
      return response as { message?: string } | void;
    },
    onSuccess: (response) => {
      toast({
        title: "Media deleted",
        description: (response as { message?: string } | undefined)?.message ?? "Media permanently deleted.",
      });
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "media-storage-modal"] });
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      void queryClient.invalidateQueries({ queryKey: ["reports-storage"] });
      void queryClient.invalidateQueries({ queryKey: ["metrics-overview"] });
    },
    onError: (error) => {
      const mapped = mapMediaDeleteError(error);
      if (mapped.dismissDeleteDialog) {
        setDeleteTarget(null);
      }
      if (error instanceof ApiError && error.code === "NOT_FOUND") {
        void queryClient.invalidateQueries({ queryKey: ["dashboard", "media-storage-modal"] });
        void queryClient.invalidateQueries({ queryKey: ["media"] });
      }
      toast({
        title: mapped.title,
        description: mapped.description,
        variant: mapped.variant,
        action:
          mapped.helpRoute && mapped.helpLabel ? (
            <ToastAction altText={mapped.helpLabel} onClick={() => navigate(mapped.helpRoute!)}>
              {mapped.helpLabel}
            </ToastAction>
          ) : undefined,
      });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (media: MediaAsset) => {
      if (media.media_url) {
        return media;
      }

      return mediaApi.getById(media.id);
    },
    onMutate: (media) => {
      setPreviewMediaId(media.id);
    },
    onSuccess: (media) => {
      setPreviewMedia(media);
    },
    onError: (error) => {
      toast({
        title: "Preview unavailable",
        description: getErrorMessage(error, "Unable to load media preview."),
        variant: "destructive",
      });
    },
    onSettled: () => {
      setPreviewMediaId(null);
    },
  });

  const handlePreview = (media: MediaAsset) => {
    if (previewMutation.isPending && previewMediaId === media.id) return;
    previewMutation.mutate(media);
  };

  useEffect(() => {
    if (isMetricsError) {
      const message =
        metricsError instanceof ApiError
          ? metricsError.message
          : "We couldn't load metrics right now.";
      toast({
        title: "Metrics unavailable",
        description: message,
        variant: "destructive",
      });
    }
  }, [isMetricsError, metricsError, toast]);

  useEffect(() => {
    if (isRequestsError) {
      toast({
        title: "Requests unavailable",
        description: getErrorMessage(requestsError, "We couldn't load requests right now."),
        variant: "destructive",
      });
    }
  }, [isRequestsError, requestsError, toast]);

  useEffect(() => {
    if (isOfflineError) {
      toast({
        title: "Offline screens unavailable",
        description: getErrorMessage(offlineError, "We couldn't load offline screens."),
        variant: "destructive",
      });
    }
  }, [isOfflineError, offlineError, toast]);

  useEffect(() => {
    if (isStorageError) {
      toast({
        title: "Storage report unavailable",
        description: getErrorMessage(storageError, "We couldn't load storage usage."),
        variant: "destructive",
      });
    }
  }, [isStorageError, storageError, toast]);

  useEffect(() => {
    if (isSystemHealthError) {
      toast({
        title: "System health unavailable",
        description: getErrorMessage(systemHealthError, "We couldn't load system health."),
        variant: "destructive",
      });
    }
  }, [isSystemHealthError, systemHealthError, toast]);

  useEffect(() => {
    if (isHealthError) {
      toast({
        title: "API health check failed",
        description: getErrorMessage(healthError, "Unable to reach the API health endpoint."),
        variant: "destructive",
      });
    }
  }, [isHealthError, healthError, toast]);

  useEffect(() => {
    if (isObservabilityError) {
      toast({
        title: "Observability overview unavailable",
        description: getErrorMessage(observabilityError, "Unable to load observability summary."),
        variant: "destructive",
      });
    }
  }, [isObservabilityError, observabilityError, toast]);

  useEffect(() => {
    if (isMediaError) {
      toast({
        title: "Media load failed",
        description: getErrorMessage(mediaError, "We couldn't load media details."),
        variant: "destructive",
      });
    }
  }, [isMediaError, mediaError, toast]);

  const totalsMetrics = useMemo(() => overview?.totals ?? {}, [overview]);
  const screensMetrics = useMemo(() => overview?.screens ?? {}, [overview]);
  const storageBytes = overview?.storage?.media_bytes ?? storageReport?.storage?.media_bytes;
  const quotaBytes = storageReport?.storage?.quota_bytes ?? null;
  const quotaPercent =
    storageReport?.storage?.quota_percent ??
    (quotaBytes && storageBytes ? (storageBytes / quotaBytes) * 100 : null);
  const apiHealthStatus = apiHealth?.status ?? overview?.system_health?.status ?? "unknown";
  const apiStatusNormalized = normalizeHealthStatus(apiHealthStatus);
  const isApiHealthy = ["ok", "healthy", "pass", "operational", "up"].includes(apiStatusNormalized);
  const apiHealthClass =
    apiStatusNormalized === "unknown"
      ? "bg-secondary text-secondary-foreground"
      : isApiHealthy
        ? "bg-success text-success-foreground"
        : "bg-destructive text-destructive-foreground";
  const pendingJobs = systemHealth?.transcode_queue?.pending ?? 0;
  const failedTasks = systemHealth?.jobs?.failed_last_24h ?? 0;
  const lastPublishAt = systemHealth?.publishes?.last_published_at;
  const activeOperators = systemHealth?.operators?.active;
  const heartbeats5m = overview?.system_health?.heartbeats?.last_5m ?? screensMetrics.online_last_5m;
  const heartbeats1h = overview?.system_health?.heartbeats?.last_1h;
  const lastHeartbeatAt = overview?.system_health?.last_heartbeat_at;
  const machineSummaries = observabilityOverview?.machines ?? [];
  const observabilityGrafanaLinks = observabilityOverview?.grafana?.links;
  const playerTargetsReachable = observabilityOverview?.fleet.reachable_players;
  const playerTargetsConfigured = observabilityOverview?.fleet.configured_player_targets;

  const kpiData = useMemo(() => {
    const storageTrend =
      quotaPercent !== null && quotaPercent !== undefined
        ? `${formatPercent(quotaPercent)} used`
        : undefined;

    return [
      {
        id: "total-screens",
        title: "Total Screens",
        value: isMetricsLoading ? "…" : String(totalsMetrics.screens ?? screensMetrics.total ?? 0),
        subtitle: "Registered devices",
        icon: Monitor,
      },
      {
        id: "online-screens",
        title: "Online Screens",
        value: isMetricsLoading ? "…" : String(screensMetrics.online_last_5m ?? screensMetrics.online ?? 0),
        subtitle: "Active heartbeat in last 5m",
        icon: Activity,
        variant: "success" as const,
      },
      {
        id: "storage",
        title: "Media Storage",
        value: isMetricsLoading ? "…" : formatBytes(storageBytes),
        subtitle: quotaBytes ? `of ${formatBytes(quotaBytes)}` : "Used capacity",
        icon: HardDrive,
        variant: "warning" as const,
        trend: storageTrend
          ? { value: storageTrend, isPositive: (quotaPercent ?? 0) < 85 }
          : undefined,
      },
      {
        id: "active-scheduled",
        title: "Active Scheduled",
        value: isMetricsLoading
          ? "…"
          : String(overview?.schedules?.active_screens_now ?? overview?.schedules?.active ?? 0),
        subtitle: "Screens running playlists",
        icon: Calendar,
      },
    ];
  }, [
    isMetricsLoading,
    overview?.schedules?.active,
    overview?.schedules?.active_screens_now,
    quotaPercent,
    quotaBytes,
    screensMetrics,
    storageBytes,
    totalsMetrics,
  ]);

  const departmentRequests = useMemo(() => {
    if (Array.isArray(requestsByDept)) return requestsByDept;
    if (requestsByDept && Array.isArray((requestsByDept as { departments?: unknown })?.departments)) {
      return (requestsByDept as { departments: typeof requestsByDept })?.departments ?? [];
    }
    return [];
  }, [requestsByDept]);

  const pendingRequests = useMemo(() => {
    if (!departmentRequests) return [];

    return departmentRequests
      .filter((dept) => (dept?.requests?.length ?? 0) > 0)
      .map((dept) => {
        const sorted = [...dept.requests].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        const latest = sorted[0];
        return {
          id: dept.department_id || dept.department_name || "unknown",
          department: dept.department_name || "Unassigned",
          count: dept.requests.length,
          latestTitle: latest?.title ?? "—",
          status: latest?.status,
          createdAt: latest?.created_at,
        };
      });
  }, [departmentRequests]);

  const alerts = useMemo(() => {
    const items: Array<{
      id: string;
      type: "error" | "warning";
      message: string;
      action: string;
      onClick: () => void;
    }> = [];

    const offlineCount = offlineScreens?.count ?? 0;
    if (offlineCount > 0) {
      items.push({
        id: "offline",
        type: "error",
        message: `${offlineCount} screen${offlineCount === 1 ? "" : "s"} offline for >24 hours`,
        action: "View screens",
        onClick: () => navigate("/screens"),
      });
    }

    if (quotaPercent !== null && quotaPercent !== undefined && quotaPercent >= 80) {
      items.push({
        id: "storage",
        type: "warning",
        message: `Storage at ${formatPercent(quotaPercent)} of quota`,
        action: "Manage storage",
        onClick: () => navigate("/media"),
      });
    }

    if ((observabilityOverview?.alerts.firing ?? 0) > 0) {
      items.push({
        id: "observability-alerts",
        type: observabilityOverview?.alerts.highest_severity === "critical" ? "error" : "warning",
        message: `${observabilityOverview?.alerts.firing ?? 0} observability alert${(observabilityOverview?.alerts.firing ?? 0) === 1 ? "" : "s"} currently firing`,
        action: "Open Grafana",
        onClick: () => {
          if (observabilityGrafanaLinks?.players_fleet) {
            window.open(observabilityGrafanaLinks.players_fleet, "_blank", "noopener,noreferrer");
          }
        },
      });
    }

    return items;
  }, [offlineScreens, observabilityGrafanaLinks?.players_fleet, observabilityOverview?.alerts.firing, observabilityOverview?.alerts.highest_severity, quotaPercent, navigate]);

  const readyMedia = useMemo(() => (allMedia ?? []).filter((item) => item.status === "READY"), [allMedia]);

  const totalMediaSizeBytes = useMemo(
    () =>
      readyMedia.reduce((sum, item) => {
        const nextSize = item.source_size ?? item.size ?? 0;
        return sum + (Number.isFinite(nextSize) ? nextSize : 0);
      }, 0),
    [readyMedia],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Overview of your digital signage network
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setScheduleReportOpen(true)}>
            <Calendar className="mr-2 h-4 w-4" />
            Schedule Report
          </Button>
          <Button variant="default" onClick={() => navigate("/schedule/new")}>
            <Plus className="mr-2 h-4 w-4" />
            New Request
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpiData.map((kpi) => (
          <KPICard
            key={kpi.id}
            title={kpi.title}
            value={kpi.value}
            subtitle={kpi.subtitle}
            icon={kpi.icon}
            trend={kpi.trend}
            variant={kpi.variant}
            onClick={() => setSelectedKPI(kpi.id)}
          />
        ))}
      </div>

      {/* Alerts */}
      {(alerts.length > 0 || isOfflineLoading || isStorageLoading) && (
        <Card className="border-warning/20 bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Alerts & Notices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(isOfflineLoading || isStorageLoading) && alerts.length === 0 ? (
              <div className="flex items-center justify-between p-3 bg-background rounded-lg">
                <span className="text-sm text-muted-foreground">Checking for alerts...</span>
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex flex-col gap-3 rounded-lg bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm">{alert.message}</span>
                  <Button variant="outline" size="sm" onClick={alert.onClick}>
                    {alert.action}
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Observability Overview</CardTitle>
            <CardDescription>Current-state fleet and alert posture from backend summaries</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Fleet totals</p>
                <p className="mt-1 text-lg font-semibold">
                  {isObservabilityLoading ? "Loading..." : String(observabilityOverview?.fleet.total_players ?? "—")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Active {observabilityOverview?.fleet.active_players ?? "—"} · Offline {observabilityOverview?.fleet.offline_players ?? "—"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Player scrape reachability</p>
                <p className="mt-1 text-lg font-semibold">
                  {isObservabilityLoading ? "Loading..." : `${playerTargetsReachable ?? "—"} / ${playerTargetsConfigured ?? "—"}`}
                </p>
                <p className="text-xs text-muted-foreground">Reachable Prometheus player targets</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Alert state</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="outline" className={observabilityOverview ? getMachineStatusTone(observabilityOverview.alerts.status) : "border-slate-400 text-slate-700"}>
                    {isObservabilityLoading ? "Loading..." : observabilityOverview?.alerts.status ?? "unknown"}
                  </Badge>
                  <span className="text-sm font-medium">{observabilityOverview?.alerts.firing ?? 0} firing</span>
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Historical drill-down</p>
                <div className="mt-2 flex gap-2">
                  {observabilityGrafanaLinks?.backend_service ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(observabilityGrafanaLinks.backend_service!, "_blank", "noopener,noreferrer")}
                    >
                      Backend
                    </Button>
                  ) : null}
                  {observabilityGrafanaLinks?.players_fleet ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(observabilityGrafanaLinks.players_fleet!, "_blank", "noopener,noreferrer")}
                    >
                      Players
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pending Requests */}
        <Card>
          <CardHeader>
            <CardTitle>Pending Requests by Department</CardTitle>
            <CardDescription>Requests requiring review or approval</CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Open Requests</TableHead>
                  <TableHead>Latest Request</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isRequestsLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Loading requests...
                    </TableCell>
                  </TableRow>
                )}

                {!isRequestsLoading && pendingRequests.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No pending requests right now.
                    </TableCell>
                  </TableRow>
                )}

                {!isRequestsLoading &&
                  pendingRequests.map((request) => (
                    <TableRow
                      key={request.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate("/requests")}
                    >
                      <TableCell className="font-medium">{request.department}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{request.count}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate">{request.latestTitle}</TableCell>
                      <TableCell>
                        <StatusBadge status={request.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelativeTime(request.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Running Status */}
        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
            <CardDescription>Real-time system metrics</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Transcode Queue</span>
              <Badge
                variant="outline"
                className={
                  pendingJobs > 0 ? "border-warning text-warning" : "border-success text-success"
                }
              >
                {isSystemHealthLoading
                  ? "Loading..."
                  : `${pendingJobs} job${pendingJobs === 1 ? "" : "s"}`}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last Publish</span>
              <span className="text-sm font-medium">
                {isSystemHealthLoading ? "Loading..." : formatRelativeTime(lastPublishAt)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Failed Tasks (24h)</span>
              <Badge
                variant={failedTasks > 0 ? "destructive" : "outline"}
                className={failedTasks > 0 ? "" : "border-success text-success"}
              >
                {isSystemHealthLoading ? "Loading..." : failedTasks}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active Operators</span>
              <span className="text-sm font-medium">
                {isSystemHealthLoading ? "Loading..." : activeOperators ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">API Health</span>
              <Badge
                className={apiHealthClass}
              >
                {isHealthLoading ? "Checking..." : apiHealthStatus}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Heartbeats (5m / 1h)</span>
              <span className="text-sm font-medium">
                {isMetricsLoading
                  ? "Loading..."
                  : `${heartbeats5m ?? 0} / ${heartbeats1h ?? "—"}`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last Heartbeat</span>
              <span className="text-sm font-medium">
                {isMetricsLoading ? "Loading..." : formatRelativeTime(lastHeartbeatAt)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Machine Health
          </CardTitle>
          <CardDescription>VM summaries are native CMS cards. Use Grafana for history and full drill-down.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {machineSummaries.map((machine) => (
              <Card key={machine.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{machine.name}</p>
                    <p className="text-xs text-muted-foreground">{machine.role}</p>
                  </div>
                  <Badge variant="outline" className={getMachineStatusTone(machine.status)}>
                    {machine.status}
                  </Badge>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">CPU</p>
                    <p className="font-medium">{formatPercent(machine.resources.cpu_percent)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Memory</p>
                    <p className="font-medium">{formatPercent(machine.resources.memory_percent)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Disk</p>
                    <p className="font-medium">{formatPercent(machine.resources.disk_percent)}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Scrape targets</span>
                    <span>
                      {machine.scrape_status.reachable_targets}/{machine.scrape_status.expected_targets}
                    </span>
                  </div>
                  {machine.services.map((service) => (
                    <div key={service.id} className="flex items-center justify-between text-sm">
                      <span>{service.label}</span>
                      <span className={getServiceStatusTone(service.status)}>{service.status}</span>
                    </div>
                  ))}
                </div>

                {machine.grafana.dashboard_url ? (
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(machine.grafana.dashboard_url!, "_blank", "noopener,noreferrer")}
                    >
                      Open in Grafana
                    </Button>
                  </div>
                ) : null}
              </Card>
            ))}

            {!isObservabilityLoading && machineSummaries.length === 0 ? (
              <div className="col-span-full rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Machine summaries are unavailable. Check backend observability configuration.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <OnlineScreensDetailsModal
        open={selectedKPI === "online-screens"}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedKPI(null);
          }
        }}
      />

      {selectedKPI === "total-screens" ? (
        <AllScreensDetailsModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setSelectedKPI(null);
            }
          }}
        />
      ) : null}

      {selectedKPI === "active-scheduled" ? (
        <ActiveScheduledTimelineModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setSelectedKPI(null);
            }
          }}
        />
      ) : null}

      <ScheduleReportModal open={scheduleReportOpen} onOpenChange={setScheduleReportOpen} />

      {/* KPI Detail Dialog */}
      <Dialog
        open={
          !!selectedKPI &&
          selectedKPI !== "online-screens" &&
          selectedKPI !== "active-scheduled" &&
          selectedKPI !== "total-screens"
        }
        onOpenChange={() => setSelectedKPI(null)}
      >
        <DialogContent className={selectedKPI === "storage" ? "max-w-5xl" : "max-w-2xl"}>
          <DialogHeader>
            <DialogTitle>
              {kpiData.find(k => k.id === selectedKPI)?.title} Details
            </DialogTitle>
            <DialogDescription>
              Detailed breakdown and metrics
            </DialogDescription>
          </DialogHeader>
          {selectedKPI === "storage" ? (
            <div className="space-y-4 py-2">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Total media</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">
                      {isMediaLoading ? "Loading..." : String(readyMedia.length)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Total size</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">
                      {isMediaLoading ? "Loading..." : formatMegabytes(totalMediaSizeBytes)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="rounded-md border">
                <div className="max-h-[60vh] overflow-y-auto">
                  <Table className="text-xs">
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="h-9 text-[11px]">Name</TableHead>
                        <TableHead className="h-9 text-[11px]">Type</TableHead>
                        <TableHead className="h-9 text-[11px]">Status</TableHead>
                        <TableHead className="h-9 text-[11px]">MIME</TableHead>
                        <TableHead className="h-9 text-[11px]">Resolution</TableHead>
                        <TableHead className="h-9 text-[11px]">Duration</TableHead>
                        <TableHead className="h-9 text-right text-[11px]">Size</TableHead>
                        <TableHead className="h-9 text-right text-[11px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isMediaLoading ? (
                        <TableRow>
                          <TableCell colSpan={8} className="h-10 text-center text-xs text-muted-foreground">
                            Loading media...
                          </TableCell>
                        </TableRow>
                      ) : readyMedia.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="h-10 text-center text-xs text-muted-foreground">
                            No media found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        readyMedia.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="max-w-[280px] py-2 text-xs">
                              <div className="truncate text-xs font-medium">{resolveMediaDisplayName(item)}</div>
                              <div className="truncate text-xs text-muted-foreground">{item.id}</div>
                            </TableCell>
                            <TableCell className="py-2 text-xs">{item.type ?? "—"}</TableCell>
                            <TableCell className="py-2 text-xs">{item.status ?? "—"}</TableCell>
                            <TableCell className="py-2 text-xs">{item.source_content_type ?? item.content_type ?? "—"}</TableCell>
                            <TableCell className="py-2 text-xs">
                              {item.width && item.height ? `${item.width} x ${item.height}` : "—"}
                            </TableCell>
                            <TableCell className="py-2 text-xs">
                              {typeof item.duration_seconds === "number" ? `${item.duration_seconds}s` : "—"}
                            </TableCell>
                            <TableCell className="py-2 text-right text-xs">
                              {formatMegabytes(item.source_size ?? item.size)}
                            </TableCell>
                            <TableCell className="py-2 text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  aria-label={`Preview ${resolveMediaDisplayName(item)}`}
                                  title="Preview media"
                                  onClick={() => handlePreview(item)}
                                  disabled={previewMutation.isPending && previewMediaId === item.id}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="destructive"
                                  aria-label={`Delete ${resolveMediaDisplayName(item)}`}
                                  title="Delete media"
                                  onClick={() => setDeleteTarget(item)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4">
              <p className="text-sm text-muted-foreground">
                Detailed view for {selectedKPI} would be displayed here with tables, charts, and drill-down data.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {previewMedia && (
        <Dialog open={!!previewMedia} onOpenChange={(open) => !open && setPreviewMedia(null)}>
          <DialogContent className="max-w-6xl p-4 sm:w-[95vw]">
            <DialogHeader>
              <DialogTitle>{resolveMediaDisplayName(previewMedia)}</DialogTitle>
              <DialogDescription>
                {previewMedia.source_content_type ?? previewMedia.content_type ?? previewMedia.type ?? "Media preview"}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MediaPreview
                media={previewMedia}
                url={previewMedia.media_url}
                type={previewMedia.source_content_type ?? previewMedia.content_type}
                alt={resolveMediaDisplayName(previewMedia)}
                className="h-full max-h-[75svh] w-full"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-[480px] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Hard delete media</DialogTitle>
              <DialogDescription>
                This permanently removes the media and sends `?hard=true` to the existing delete API.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{resolveMediaDisplayName(deleteTarget)}</div>
              <div className="mt-1 text-muted-foreground">
                {deleteTarget.source_content_type ?? deleteTarget.content_type ?? deleteTarget.type ?? "Unknown type"}
              </div>
              <div className="mt-1 text-muted-foreground">
                Size: {formatMegabytes(deleteTarget.source_size ?? deleteTarget.size)}
              </div>
            </div>
            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={hardDeleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteTarget && hardDeleteMutation.mutate(deleteTarget.id)}
                disabled={hardDeleteMutation.isPending}
              >
                {hardDeleteMutation.isPending ? "Deleting..." : "Hard Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
