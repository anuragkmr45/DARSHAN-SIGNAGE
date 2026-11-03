import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Eye,
  Flame,
  HeartPulse,
  MapPin,
  MoreHorizontal,
  Monitor,
  Pencil,
  Plus,
  QrCode,
  RadioTower,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { screensApi } from "@/api/domains/screens";
import { devicePairingApi } from "@/api/domains/devicePairing";
import type { DevicePairing, ScreenGroup, ScreenOverviewItem } from "@/api/types";
import { PageHeader } from "@/components/common/PageHeader";
import { SearchBar } from "@/components/common/SearchBar";
import { EmptyState } from "@/components/common/EmptyState";
import { PageNavigation } from "@/components/common/PageNavigation";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { queryKeys } from "@/api/queryKeys";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { PairDeviceModal } from "@/components/screens/PairDeviceModal";
import { PairingHealthPanel } from "@/components/screens/PairingHealthPanel";
import { ScreenDetailsModal } from "@/components/screens/ScreenDetailsModal";
import { toast } from "sonner";
import { CreateGroupModal } from "@/components/screens/CreateGroupModal";
import { UpdateGroupModal } from "@/components/screens/UpdateGroupModal";
import { screenDeletionBlockers } from "@/components/screens/screenDeletionBlockers";
import { useScreensRealtime } from "@/hooks/screens/useScreensRealtime";
import {
  getPlaybackTimingLabel,
  getServerClockOffsetMs,
  getServerNowFromOffset,
  isHeartbeatStale,
} from "@/hooks/screens/screensRealtimeUtils";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  formatMaskedScreenId,
  getScreenAuthIndicator,
  getScreenHeartbeatIndicator,
  getScreenIndicatorBadgeClassName,
  getScreenPlaybackHeadline,
  getScreenPlaybackSourceLabel,
} from "@/lib/screens";

const PAGE_SIZE = 9;

const HEALTH_PRIORITY: Record<string, number> = {
  RECOVERY_REQUIRED: 0,
  ERROR: 1,
  STALE: 2,
  OFFLINE: 3,
  ONLINE: 4,
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "N/A";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "N/A";
  return new Date(timestamp).toLocaleString();
};

export default function Screens() {
  const queryClient = useQueryClient();
  const { can } = useAuthorization();
  const canManageScreens = can("manage", "Screen") || can("update", "Screen");
  const [search, setSearch] = useState("");
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [pairingView, setPairingView] = useState<"active" | "history">("active");
  const [pairingPage, setPairingPage] = useState(1);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [recoveryScreenId, setRecoveryScreenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScreenOverviewItem | null>(null);
  const [groupDeleteTarget, setGroupDeleteTarget] = useState<ScreenGroup | null>(null);
  const [deleteBlockers, setDeleteBlockers] = useState<string[]>([]);
  const [groupDeleteBlockers, setGroupDeleteBlockers] = useState<string[]>([]);
  const [revokeTarget, setRevokeTarget] = useState<ScreenOverviewItem | null>(null);
  const [revokeNote, setRevokeNote] = useState("");
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [page, setPage] = useState(1);
  const normalizedSearch = search.trim() || undefined;
  const screensListQueryKey = useMemo(
    () =>
      queryKeys.screensList({
        page,
        limit: PAGE_SIZE,
        q: normalizedSearch,
        includeSummary: true,
        includeMedia: true,
      }),
    [page, normalizedSearch],
  );
  const screenGroupsListQueryKey = useMemo(
    () =>
      queryKeys.screenGroupsList({
        page: 1,
        limit: 100,
        q: normalizedSearch,
        includeSummary: true,
      }),
    [normalizedSearch],
  );

  const screensQuery = useQuery({
    queryKey: screensListQueryKey,
    queryFn: () =>
      screensApi.listSummaries({
        page,
        limit: PAGE_SIZE,
        q: normalizedSearch,
        include_media: true,
      }),
  });

  const screenGroupsQuery = useQuery({
    queryKey: screenGroupsListQueryKey,
    queryFn: () =>
      screensApi.listGroupSummaries({
        page: 1,
        limit: 100,
        q: normalizedSearch,
      }),
  });

  const screensSummaryQuery = useQuery({
    queryKey: queryKeys.screensSummary(),
    queryFn: () => screensApi.getSummary(),
  });

  const { data: pairingsData } = useQuery({
    queryKey: ["device-pairings", pairingView, pairingPage],
    queryFn: () => devicePairingApi.list({ page: pairingPage, limit: 10, status: pairingView }),
    enabled: canManageScreens,
    refetchInterval: pairingView === "active" ? 3000 : false,
  });

  const screens = useMemo(() => screensQuery.data?.items ?? [], [screensQuery.data?.items]);
  const screenGroups = useMemo(() => screenGroupsQuery.data?.items ?? [], [screenGroupsQuery.data?.items]);
  const pairings = useMemo(() => pairingsData?.items ?? [], [pairingsData]);
  const selectedScreen = useMemo(
    () => screens.find((screen) => screen.id === selectedScreenId) ?? null,
    [screens, selectedScreenId],
  );
  const recoveryScreen = useMemo(
    () => screens.find((screen) => screen.id === recoveryScreenId) ?? null,
    [recoveryScreenId, screens],
  );

  useEffect(() => {
    setServerClockOffsetMs(getServerClockOffsetMs(screensQuery.data?.server_time));
  }, [screensQuery.data?.server_time]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const serverNowMs = useMemo(
    () => getServerNowFromOffset(serverClockOffsetMs, clockTick),
    [clockTick, serverClockOffsetMs],
  );

  const { rejectedScreenIds, pendingEmergencyScreenIds } = useScreensRealtime({
    activeScreenId: selectedScreenId,
    enabled: true,
    syncMode: "invalidate",
    listQueryKey: screensListQueryKey,
    groupsQueryKey: screenGroupsListQueryKey,
  });

  const deleteScreen = useSafeMutation({
    mutationFn: (id: string) => screensApi.remove(id),
    onSuccess: () => {
      setDeleteBlockers([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.screens });
      queryClient.invalidateQueries({ queryKey: queryKeys.screensSummary() });
      toast.success("Screen deleted successfully");
    },
    onError: (error) => setDeleteBlockers(screenDeletionBlockers(error)),
  }, "Unable to delete screen.");

  const deleteGroup = useSafeMutation({
    mutationFn: (id: string) => screensApi.removeGroup(id),
    onSuccess: () => {
      setGroupDeleteBlockers([]);
      setGroupDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.screenGroups });
      queryClient.invalidateQueries({ queryKey: ["available-screens"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.screens });
      toast.success("Group deleted successfully");
    },
    onError: (error) => setGroupDeleteBlockers(screenDeletionBlockers(error)),
  }, "Unable to delete group.");

  const revokePairing = useSafeMutation({
    mutationFn: (payload: { deviceId: string; note?: string }) =>
      devicePairingApi.revoke(payload.deviceId, {
        reason: "admin_revoked_stale_pairing",
        note: payload.note,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.screens });
      queryClient.invalidateQueries({ queryKey: queryKeys.screensSummary() });
      queryClient.invalidateQueries({ queryKey: ["device-pairing", "orphans"] });
      queryClient.invalidateQueries({ queryKey: ["device-pairings"] });
      setRevokeTarget(null);
      setRevokeNote("");
      toast.success("Pairing revoked. The player must pair again.");
    },
  }, "Unable to revoke pairing.");

  useEffect(() => {
    setPage(1);
  }, [search]);

  const stats = useMemo(() => {
    const summary = screensSummaryQuery.data;
    return {
      total: summary?.total ?? 0,
      online: summary?.online ?? 0,
      recovery: summary?.recovery ?? 0,
      stale: summary?.stale ?? 0,
      offline: summary?.offline ?? 0,
    };
  }, [screensSummaryQuery.data]);

  const handleDeleteScreen = (screen: ScreenOverviewItem) => {
    setDeleteBlockers([]);
    setDeleteTarget(screen);
  };

  const handleRevokeScreenPairing = (screen: ScreenOverviewItem) => {
    setRevokeTarget(screen);
  };

  const confirmDeleteScreen = () => {
    if (!deleteTarget) return;
    deleteScreen.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null);
      },
    });
  };

  const handleDeleteGroup = (groupId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setGroupDeleteBlockers([]);
    setGroupDeleteTarget(screenGroups.find((group) => group.id === groupId) ?? null);
  };

  const handleEditGroup = (groupId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedGroupId(groupId);
  };

  const totalPages = Math.max(
    1,
    Math.ceil((screensQuery.data?.pagination?.total ?? 0) / (screensQuery.data?.pagination?.limit ?? PAGE_SIZE)),
  );

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const screensErrorMessage =
    screensQuery.error instanceof Error
      ? screensQuery.error.message
      : screenGroupsQuery.error instanceof Error
        ? screenGroupsQuery.error.message
        : "Unable to load screens.";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Screens"
        description="Manage and monitor all display screens across locations"
        actionLabel={canManageScreens ? "Pair Device" : undefined}
        actionIcon={canManageScreens ? <QrCode className="h-4 w-4" /> : undefined}
        onAction={
          canManageScreens
            ? () => {
                setRecoveryScreenId(null);
                setIsPairModalOpen(true);
              }
            : undefined
        }
      />

      <section aria-label="Screen status summary" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border pb-4 text-sm">
        {!screensSummaryQuery.data ? (
          <span role="status" className="text-muted-foreground">{screensSummaryQuery.isError ? "Fleet status unavailable" : "Checking fleet status…"}</span>
        ) : (
          <>
            <span><strong className="font-semibold tabular-nums">{stats.total}</strong> total</span>
            <span className="text-success"><strong className="font-semibold tabular-nums">{stats.online}</strong> online</span>
            <span className={stats.offline > 0 ? "text-destructive" : "text-muted-foreground"}><strong className="font-semibold tabular-nums">{stats.offline}</strong> offline</span>
            <span className={stats.recovery > 0 ? "text-warning" : "text-muted-foreground"}><strong className="font-semibold tabular-nums">{stats.recovery}</strong> need recovery</span>
            <span className={stats.stale > 0 ? "text-warning" : "text-muted-foreground"}><strong className="font-semibold tabular-nums">{stats.stale}</strong> stale</span>
          </>
        )}
      </section>

      {canManageScreens ? (
        <PairingHealthPanel
          canManage={canManageScreens}
          visibleScreenCount={screensQuery.data?.pagination?.total ?? screens.length}
        />
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="w-full lg:max-w-lg">
            <SearchBar
              placeholder="Search screens and groups"
              onSearch={setSearch}
              initialValue={search}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {screensQuery.isFetching || screenGroupsQuery.isFetching
              ? "Refreshing screens…"
              : `${screensQuery.data?.pagination?.total ?? screens.length} screens, ${screenGroupsQuery.data?.pagination?.total ?? screenGroups.length} groups`}
          </div>
      </div>

      {screensQuery.isLoading && !screensQuery.data ? (
        <div className="rounded-md border p-6">
          <LoadingIndicator label="Loading screens..." />
        </div>
      ) : screensQuery.isError && !screensQuery.data ? (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-3 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <p className="font-semibold">Unable to load screens</p>
              <p className="text-sm text-muted-foreground">{screensErrorMessage}</p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void screensQuery.refetch();
              void screenGroupsQuery.refetch();
            }}
            className="w-fit"
          >
            Retry
          </Button>
        </Card>
      ) : (
        <div className="space-y-6">
          {screens.length === 0 ? (
            <EmptyState
              title="No screens found"
              description={
                search
                  ? "No screen cards match the current search."
                  : "Try pairing a device from the player first."
              }
            />
          ) : (
            <div className="space-y-6">
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card" role="list" aria-label="Screens">
                {screens.map((screen) => {
                  const {
                    id,
                    name,
                    location,
                    status,
                    last_heartbeat_at,
                    playback,
                    publish,
                    active_items,
                    upcoming_items,
                    health_state,
                    health_reason,
                    auth_diagnostics,
                    active_pairing,
                  } = screen;
                  const isEmergency = pendingEmergencyScreenIds.includes(id) || playback?.source === "EMERGENCY";
                  const isOffline = health_state === "OFFLINE" || status === "OFFLINE";
                  const hasStaleHeartbeat = isHeartbeatStale(last_heartbeat_at, screensQuery.data?.server_time);
                  const playbackLabel = getScreenPlaybackHeadline(screen);
                  const playbackSourceLabel = getScreenPlaybackSourceLabel(playback?.source, {
                    hasPublish: Boolean(publish),
                  });
                  const authIndicator = getScreenAuthIndicator(auth_diagnostics);
                  const heartbeatIndicator = getScreenHeartbeatIndicator(screen, hasStaleHeartbeat);
                  const timingLabel = getPlaybackTimingLabel(
                    playback?.started_at,
                    playback?.ends_at,
                    serverNowMs,
                  );
                  const playbackSubLabel =
                    timingLabel ||
                    (isEmergency
                      ? "Emergency content is active"
                      : playback?.source === "DEFAULT"
                        ? "Default fallback is active"
                        : isOffline
                          ? "Screen offline"
                          : !publish
                            ? "No active playback right now"
                            : "Awaiting scheduled playback");
                  const healthBadge = health_state || status || "offline";
                  const healthRank = HEALTH_PRIORITY[health_state || ""] ?? 99;

                  return (
                    <article key={id} role="listitem" className="space-y-3 p-4 hover:bg-muted/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className={`rounded-md p-2 ${
                              isEmergency
                                ? "bg-red-500/10 text-red-600"
                                : healthRank === 0 || healthRank === 1
                                  ? "bg-red-500/10 text-red-600"
                                  : isOffline
                                    ? "bg-red-500/10 text-red-600"
                                    : health_state === "ONLINE"
                                      ? "bg-green-500/10 text-green-600"
                                      : "bg-yellow-500/10 text-yellow-600"
                            }`}
                          >
                            {isEmergency ? <Flame className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold truncate">{name}</h3>
                            <p className="text-xs text-muted-foreground font-mono truncate">{formatMaskedScreenId(id)}</p>
                          </div>
                        </div>
                        <StatusBadge status={String(healthBadge).toLowerCase()} />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {isEmergency && <Badge variant="destructive">Emergency</Badge>}
                        {!isEmergency && (
                          <Badge variant="outline">{playbackSourceLabel}</Badge>
                        )}
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
                        {active_pairing?.mode === "RECOVERY" && (
                          <Badge variant="outline" className="border-amber-500 text-amber-700">
                            Recovery pending
                          </Badge>
                        )}
                        {heartbeatIndicator ? (
                          <Badge
                            variant="outline"
                            className={getScreenIndicatorBadgeClassName(heartbeatIndicator.tone)}
                          >
                            <HeartPulse className="mr-1 h-3 w-3" />
                            {heartbeatIndicator.label}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)_auto] lg:items-start">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">{location || "Unassigned"}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <RadioTower className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{playbackLabel}</p>
                            <p className="text-xs">{playbackSubLabel}</p>
                          </div>
                        </div>
                        <div className="text-xs sm:text-right">
                          <span className="block">Last heartbeat: {formatDateTime(last_heartbeat_at)}</span>
                          <span className="block">{active_items?.length ?? 0} active · {upcoming_items?.length ?? 0} upcoming</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedScreenId(id)}
                          className="min-w-24"
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          Details
                        </Button>
                        {canManageScreens ? (
                          <>
                            {health_state === "RECOVERY_REQUIRED" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setRecoveryScreenId(id);
                                  setIsPairModalOpen(true);
                                }}
                                aria-label={`Recover Screen ${name}`}
                              >
                                <QrCode className="mr-1 h-3.5 w-3.5" /> Recover
                              </Button>
                            ) : null}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" aria-label={`More actions for ${name}`}>
                                  <MoreHorizontal className="mr-1 h-4 w-4" /> More actions
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                {health_state !== "RECOVERY_REQUIRED" ? (
                                  <DropdownMenuItem onSelect={() => { setRecoveryScreenId(id); setIsPairModalOpen(true); }}>
                                    <QrCode className="mr-2 h-4 w-4" /> Recover pairing
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem disabled={revokePairing.isPending} onSelect={() => handleRevokeScreenPairing(screen)}>
                                  <ShieldAlert className="mr-2 h-4 w-4" /> Revoke pairing
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={deleteScreen.isPending} onSelect={() => handleDeleteScreen(screen)}>
                                  <Trash2 className="mr-2 h-4 w-4" /> Delete screen
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
              <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Screen Groups</h2>
            </div>
            {canManageScreens ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsGroupModalOpen(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Create Group
              </Button>
            ) : null}
          </div>

          <div className="divide-y rounded-md border max-h-72 overflow-auto">
            {screenGroups.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                {search
                  ? "No screen groups match the current search."
                  : "No groups yet. Create one to organize your screens."}
              </div>
            ) : (
              <>
                {screenGroups.map((group: ScreenGroup) => {
                  const { id, name, description, screen_ids, booked_until, active_items, upcoming_items } = group;

                  return (
                    <div
                      key={id}
                      className="px-3 py-2 flex items-center justify-between hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {description || "No description"}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{screen_ids?.length || 0} screens</span>
                          <span>Active {active_items?.length ?? 0}</span>
                          <span>Upcoming {upcoming_items?.length ?? 0}</span>
                        </div>
                        {booked_until && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Booked until: {formatDateTime(booked_until)}
                          </p>
                        )}
                      </div>
                      {canManageScreens ? (
                        <div className="flex items-center gap-2 ml-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(event) => handleEditGroup(id, event)}
                            aria-label={`Edit Group ${name}`}
                            className="h-8 w-8 p-0"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(event) => handleDeleteGroup(id, event)}
                            aria-label={`Delete Group ${name}`}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </Card>

        {canManageScreens ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Device Pairings</h2>
            </div>
            <Button size="sm" onClick={() => setIsPairModalOpen(true)}>
              <Plus className="h-3 w-3 mr-1" />
              Pair Device
            </Button>
          </div>

          <div className="flex gap-2" role="group" aria-label="Pairing record view">
            <Button size="sm" variant={pairingView === "active" ? "default" : "outline"}
              onClick={() => { setPairingView("active"); setPairingPage(1); }}>Active codes</Button>
            <Button size="sm" variant={pairingView === "history" ? "default" : "outline"}
              onClick={() => { setPairingView("history"); setPairingPage(1); }}>History</Button>
          </div>

          <div className="divide-y rounded-md border max-h-72 overflow-auto">
            {pairings.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                {pairingView === "active" ? "No active pairing codes." : "No pairing history yet."}
              </div>
            ) : (
              <>
                {pairings.map((pair: DevicePairing) => {
                  const { id, pairing_code, status, device_id, expires_at, used_at, created_at } = pair;

                  return (
                    <div key={id} className="px-3 py-2 space-y-1 hover:bg-accent">
                      <div className="flex items-center justify-between">
                        <p className="font-medium font-mono text-sm">{pairing_code || "—"}</p>
                        <Badge
                          variant={
                            status === "USED" ? "default" :
                              status === "EXPIRED" || status === "SUPERSEDED" || status === "REVOKED" ? "destructive" :
                                "secondary"
                          }
                          className="text-[10px]"
                        >
                          {status || "PENDING"}
                        </Badge>
                      </div>
                      {pair.recovery?.mode ? (
                        <p className="text-xs text-muted-foreground">
                          Mode: <span className="font-medium">{pair.recovery.mode}</span>
                        </p>
                      ) : null}
                      {device_id && (
                        <p className="text-xs text-muted-foreground">
                          Device: <span className="font-mono">{device_id}</span>
                        </p>
                      )}
                      <div className="text-[10px] text-muted-foreground space-y-0.5">
                        {created_at && <p>Created: {formatDateTime(created_at)}</p>}
                        {used_at && <p>Used: {formatDateTime(used_at)}</p>}
                        {expires_at && status === "PENDING" && <p>Expires: {formatDateTime(expires_at)}</p>}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
          {(pairingsData?.pagination?.total ?? 0) > 10 && (
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" disabled={pairingPage <= 1}
                onClick={() => setPairingPage((current) => current - 1)}>Previous</Button>
              <span className="text-xs">Page {pairingPage}</span>
              <Button size="sm" variant="outline"
                disabled={pairingPage * 10 >= (pairingsData?.pagination?.total ?? 0)}
                onClick={() => setPairingPage((current) => current + 1)}>Next</Button>
            </div>
          )}
        </Card>
        ) : null}
      </div>

      <PairDeviceModal
        open={isPairModalOpen}
        onOpenChange={(open) => {
          setIsPairModalOpen(open);
          if (!open) {
            setRecoveryScreenId(null);
          }
        }}
        recoveryScreen={recoveryScreen}
      />

      <CreateGroupModal open={isGroupModalOpen} onOpenChange={setIsGroupModalOpen} />

      {selectedGroupId && (
        <UpdateGroupModal
          groupId={selectedGroupId}
          open={Boolean(selectedGroupId)}
          onOpenChange={(open) => !open && setSelectedGroupId(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete screen?"}
        description="Delete is allowed only after current and future references are removed. The server checks again when you confirm."
        confirmLabel="Delete Screen"
        onConfirm={confirmDeleteScreen}
        onCancel={() => {
          if (deleteScreen.isPending) return;
          setDeleteTarget(null);
          setDeleteBlockers([]);
        }}
        isLoading={deleteScreen.isPending}
      >
        {deleteTarget ? (
          <div className="space-y-3">
            {deleteBlockers.length > 0 && (
              <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
                <p className="font-medium">Remove these references, then retry:</p>
                <ul className="list-disc pl-5">{deleteBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
              </div>
            )}
            {((deleteTarget.active_items?.length ?? 0) > 0 ||
              (deleteTarget.upcoming_items?.length ?? 0) > 0 ||
              Boolean(deleteTarget.booked_until)) && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">This screen currently has schedule targeting.</p>
                    <p className="text-muted-foreground">Remove current and upcoming schedule targeting before deleting this screen.</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>Active items: {deleteTarget.active_items?.length ?? 0}</span>
                      <span>Upcoming items: {deleteTarget.upcoming_items?.length ?? 0}</span>
                      <span>
                        Booked until: {deleteTarget.booked_until ? formatDateTime(deleteTarget.booked_until) : "N/A"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="flex items-start gap-2">
                <QrCode className="mt-0.5 h-4 w-4 text-destructive" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Pairing code will be required again.</p>
                  <p className="text-muted-foreground">
                    If this screen is deleted, it can only be added back by pairing the device again with a Pairing Code.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(groupDeleteTarget)}
        title={groupDeleteTarget ? `Delete ${groupDeleteTarget.name}?` : "Delete group?"}
        description="Delete is allowed only after current and future references are removed. The server checks again when you confirm."
        confirmLabel="Delete Group"
        onConfirm={() => groupDeleteTarget && deleteGroup.mutate(groupDeleteTarget.id)}
        onCancel={() => {
          if (deleteGroup.isPending) return;
          setGroupDeleteTarget(null);
          setGroupDeleteBlockers([]);
        }}
        isLoading={deleteGroup.isPending}
      >
        {groupDeleteBlockers.length > 0 && (
          <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
            <p className="font-medium">Remove these references, then retry:</p>
            <ul className="list-disc pl-5">{groupDeleteBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title={revokeTarget ? `Revoke pairing for ${revokeTarget.name}?` : "Revoke pairing?"}
        description="The player will need to pair again. This does not delete the screen."
        confirmLabel="Revoke Pairing"
        onConfirm={() => {
          if (!revokeTarget) return;
          revokePairing.mutate({
            deviceId: revokeTarget.id,
            note: revokeNote.trim() || undefined,
          });
        }}
        onCancel={() => {
          if (revokePairing.isPending) return;
          setRevokeTarget(null);
          setRevokeNote("");
        }}
        isLoading={revokePairing.isPending}
      >
        {revokeTarget ? (
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-sm">
              <p className="text-muted-foreground">Screen</p>
              <p className="font-medium">{revokeTarget.name}</p>
              <p className="break-all font-mono text-xs text-muted-foreground">{revokeTarget.id}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="screen-revoke-note" className="text-sm font-medium">
                Admin note
              </label>
              <Input
                id="screen-revoke-note"
                value={revokeNote}
                onChange={(event) => setRevokeNote(event.target.value)}
                placeholder="Optional note"
                maxLength={500}
              />
            </div>
          </div>
        ) : null}
      </ConfirmDialog>

      {selectedScreenId && (
        <ScreenDetailsModal
          screenId={selectedScreenId}
          screenName={selectedScreen?.name}
          open={Boolean(selectedScreenId)}
          realtimeRejected={rejectedScreenIds.includes(selectedScreenId)}
          pendingEmergency={pendingEmergencyScreenIds.includes(selectedScreenId)}
          onOpenChange={(open) => !open && setSelectedScreenId(null)}
        />
      )}
    </div>
  );
}
