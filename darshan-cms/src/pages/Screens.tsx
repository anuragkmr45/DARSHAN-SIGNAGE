import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
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
type HealthFilter = "ALL" | "ONLINE" | "OFFLINE" | "STALE" | "ERROR" | "RECOVERY_REQUIRED";

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
  const canCreateScreen = can("create", "Screen");
  const canDeleteScreen = can("delete", "Screen");
  const canReadGroups = can("read", "ScreenGroup");
  const canCreateGroup = can("create", "ScreenGroup");
  const canUpdateGroup = can("update", "ScreenGroup");
  const canDeleteGroup = can("delete", "ScreenGroup");
  const canReadPairings = can("read", "DevicePairing");
  const canGenerateRecovery = can("create", "DevicePairing");
  const canRecoverScreen = canCreateScreen && canGenerateRecovery;
  const canRevokePairing = can("manage", "DevicePairing") || canDeleteScreen || can("manage", "all");
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("ALL");
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [pairingView, setPairingView] = useState<"active" | "history">("active");
  const [pairingPage, setPairingPage] = useState(1);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [pairingsOpen, setPairingsOpen] = useState(false);
  const [groupPage, setGroupPage] = useState(1);
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

  useEffect(() => {
    if (!canCreateScreen) setIsPairModalOpen(false);
    if (!canCreateGroup) setIsGroupModalOpen(false);
    if (!canUpdateGroup) setSelectedGroupId(null);
    if (!canDeleteScreen) { setDeleteTarget(null); setDeleteBlockers([]); }
    if (!canDeleteGroup) { setGroupDeleteTarget(null); setGroupDeleteBlockers([]); }
    if (!canRevokePairing) { setRevokeTarget(null); setRevokeNote(""); }
  }, [canCreateScreen, canCreateGroup, canUpdateGroup, canDeleteScreen, canDeleteGroup, canRevokePairing]);
  const normalizedSearch = search.trim() || undefined;
  const screensListQueryKey = useMemo(
    () =>
      queryKeys.screensList({
        page,
        limit: PAGE_SIZE,
        q: normalizedSearch,
        health: healthFilter === "ALL" ? undefined : healthFilter,
        includeSummary: true,
        includeMedia: true,
      }),
    [page, normalizedSearch, healthFilter],
  );
  const screenGroupsListQueryKey = useMemo(
    () =>
      queryKeys.screenGroupsList({
        page: groupPage,
        limit: PAGE_SIZE,
        q: normalizedSearch,
        includeSummary: true,
      }),
    [groupPage, normalizedSearch],
  );

  const screensQuery = useQuery({
    queryKey: screensListQueryKey,
    queryFn: () =>
      screensApi.listSummaries({
        page,
        limit: PAGE_SIZE,
        q: normalizedSearch,
        health: healthFilter === "ALL" ? undefined : healthFilter,
        include_media: true,
      }),
  });

  const screenGroupsQuery = useQuery({
    queryKey: screenGroupsListQueryKey,
    queryFn: () =>
      screensApi.listGroupSummaries({
        page: groupPage,
        limit: PAGE_SIZE,
        q: normalizedSearch,
      }),
    enabled: canReadGroups,
  });

  const screensSummaryQuery = useQuery({
    queryKey: queryKeys.screensSummary(),
    queryFn: () => screensApi.getSummary(),
  });

  const pairingsQuery = useQuery({
    queryKey: ["device-pairings", pairingView, pairingPage],
    queryFn: () => devicePairingApi.list({ page: pairingPage, limit: 10, status: pairingView }),
    enabled: canReadPairings,
    refetchInterval: pairingView === "active" ? 3000 : false,
  });
  const pairingsData = pairingsQuery.data;

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
    setGroupPage(1);
  }, [search]);

  const stats = useMemo(() => {
    const summary = screensSummaryQuery.data;
    return {
      total: summary?.total ?? 0,
      online: summary?.online ?? 0,
      recovery: summary?.recovery ?? 0,
      stale: summary?.stale ?? 0,
      offline: summary?.offline ?? 0,
      error: summary?.error ?? 0,
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
  const groupTotalPages = Math.max(
    1,
    Math.ceil((screenGroupsQuery.data?.pagination?.total ?? 0) / (screenGroupsQuery.data?.pagination?.limit ?? PAGE_SIZE)),
  );
  const screenResultCount = screensQuery.data?.pagination?.total ?? screens.length;
  const groupResultCount = screenGroupsQuery.data?.pagination?.total ?? screenGroups.length;

  useEffect(() => {
    if (screensQuery.data && page > totalPages) {
      setPage(totalPages);
    }
  }, [page, screensQuery.data, totalPages]);
  useEffect(() => {
    if (screenGroupsQuery.data && groupPage > groupTotalPages) setGroupPage(groupTotalPages);
  }, [groupPage, groupTotalPages, screenGroupsQuery.data]);

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
        actionLabel={canCreateScreen ? "Pair Device" : undefined}
        actionIcon={canCreateScreen ? <QrCode className="h-4 w-4" /> : undefined}
        onAction={
          canCreateScreen
            ? () => {
                setRecoveryScreenId(null);
                setIsPairModalOpen(true);
              }
            : undefined
        }
      />

      <section aria-label="Screen status summary" className="space-y-2 border-b border-border pb-4 text-sm">
        <p className="text-xs text-muted-foreground">Fleet totals · choose a health state to filter the Screen list</p>
        {!screensSummaryQuery.data && <span role="status" className="text-muted-foreground">{screensSummaryQuery.isError ? "Fleet counts unavailable; filters still work." : "Checking fleet counts…"}</span>}
        {screensSummaryQuery.isError && <Button size="sm" variant="outline" onClick={() => void screensSummaryQuery.refetch()} disabled={screensSummaryQuery.isFetching}>Retry fleet counts</Button>}
        {screensSummaryQuery.data && screensSummaryQuery.isError && <span className="text-muted-foreground">Counts may be out of date.</span>}
        <div role="group" aria-label="Filter Screens by health" className="flex flex-wrap gap-2">
          {([
            ["ALL", "All", "total"],
            ["ONLINE", "Online", "online"],
            ["OFFLINE", "Offline", "offline"],
            ["STALE", "Stale", "stale"],
            ["RECOVERY_REQUIRED", "Needs recovery", "recovery"],
            ["ERROR", "Error", "error"],
          ] as const).map(([filter, label, count]) => (
            <Button
              key={filter}
              type="button"
              size="sm"
              variant={healthFilter === filter ? "secondary" : "ghost"}
              aria-pressed={healthFilter === filter}
              onClick={() => { setHealthFilter(filter); setPage(1); setSelectedScreenId(null); }}
            >
              {label}{screensSummaryQuery.data ? <span className="ml-1 tabular-nums text-muted-foreground">{stats[count]}</span> : null}
            </Button>
          ))}
        </div>
      </section>

      {canReadPairings ? (
        <PairingHealthPanel
          canView={canReadPairings}
          canRevoke={canRevokePairing}
          visibleScreenCount={screensSummaryQuery.data?.total ?? (healthFilter === "ALL" && !normalizedSearch ? screensQuery.data?.pagination?.total : undefined)}
        />
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="w-full lg:max-w-lg">
            <SearchBar
              placeholder={canReadGroups ? "Search screens and groups" : "Search screens"}
              onSearch={setSearch}
              initialValue={search}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {screensQuery.isFetching || screenGroupsQuery.isFetching
              ? "Refreshing screens…"
              : canReadGroups
                ? `${screenResultCount} ${screenResultCount === 1 ? "Screen" : "Screens"}, ${groupResultCount} ${groupResultCount === 1 ? "Group" : "Groups"}`
                : `${screenResultCount} ${screenResultCount === 1 ? "Screen" : "Screens"}`}
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
                search && healthFilter !== "ALL"
                  ? "No Screens match this search and health filter."
                  : search
                    ? "No Screens match this search."
                  : healthFilter !== "ALL" ? "No Screens currently match this health filter." : "Pair a device from the player to add the first Screen."
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
                  const hasUnknownPlayback = (isOffline || health_state === "STALE" || health_state === "ERROR" || health_state === "RECOVERY_REQUIRED")
                    && (playbackSourceLabel === "Idle" || playbackSourceLabel === "Standby");

                  return (
                    <article key={id} role="listitem" className="space-y-3 p-4 hover:bg-muted/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className={`rounded-md p-2 ${
                              isEmergency
                                ? "status-tone-error"
                                : healthRank === 0 || healthRank === 1
                                  ? "status-tone-error"
                                  : isOffline
                                    ? "status-tone-error"
                                    : health_state === "ONLINE"
                                      ? "status-tone-success"
                                      : "status-tone-warning"
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
                        {!isEmergency && !hasUnknownPlayback && (
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
                          <Badge variant="outline" className="status-outline-warning">
                            Recovery pending
                          </Badge>
                        )}
                        {heartbeatIndicator && heartbeatIndicator.label.toLowerCase() !== String(healthBadge).toLowerCase() ? (
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
                        {(canRecoverScreen || canRevokePairing || canDeleteScreen) ? (
                          <>
                            {canRecoverScreen && health_state === "RECOVERY_REQUIRED" ? (
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
                            {((canRecoverScreen && health_state !== "RECOVERY_REQUIRED") || canRevokePairing || canDeleteScreen) ? <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" aria-label={`More actions for ${name}`}>
                                  <MoreHorizontal className="mr-1 h-4 w-4" /> More actions
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                {canRecoverScreen && health_state !== "RECOVERY_REQUIRED" ? (
                                  <DropdownMenuItem onSelect={() => { setRecoveryScreenId(id); setIsPairModalOpen(true); }}>
                                    <QrCode className="mr-2 h-4 w-4" /> Recover pairing
                                  </DropdownMenuItem>
                                ) : null}
                                {canRevokePairing ? <DropdownMenuItem disabled={revokePairing.isPending} onSelect={() => handleRevokeScreenPairing(screen)}>
                                  <ShieldAlert className="mr-2 h-4 w-4" /> Revoke pairing
                                </DropdownMenuItem> : null}
                                {canDeleteScreen ? <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={deleteScreen.isPending} onSelect={() => handleDeleteScreen(screen)}>
                                  <Trash2 className="mr-2 h-4 w-4" /> Delete screen
                                </DropdownMenuItem> : null}
                              </DropdownMenuContent>
                            </DropdownMenu> : null}
                          </>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
              {totalPages > 1 && <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} />}
            </div>
          )}
        </div>
      )}

      <div className="divide-y border-y border-border">
        {(canReadGroups || canCreateGroup) ? (
        <section aria-label="Screen group management" className="py-2">
          <div className="flex items-center justify-between">
            <h2>
              <Button
                variant="ghost"
                onClick={() => setGroupsOpen((open) => !open)}
                aria-expanded={groupsOpen}
                aria-controls="screen-groups-list"
                className="min-h-11 gap-2 px-1 text-left font-semibold"
              >
                <Users className="h-4 w-4 text-primary" />
                Screen Groups
                <span className="text-xs font-normal text-muted-foreground">
                  {!canReadGroups ? "List unavailable" : screenGroupsQuery.isError ? "Unavailable" : screenGroupsQuery.data
                    ? `${screenGroupsQuery.data.pagination.total} ${screenGroupsQuery.data.pagination.total === 1 ? "group" : "groups"}`
                    : "Checking…"}
                </span>
                <ChevronDown className={groupsOpen ? "h-4 w-4 rotate-180 text-muted-foreground" : "h-4 w-4 text-muted-foreground"} />
              </Button>
            </h2>
            {groupsOpen && canCreateGroup ? (
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

          <div id="screen-groups-list" hidden={!groupsOpen} className="space-y-2">
          {!canReadGroups ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Your role cannot view Screen Groups.</p>
          ) : screenGroupsQuery.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 px-2 py-3 text-sm text-destructive">
              Screen Groups are unavailable.
              <Button size="sm" variant="outline" onClick={() => void screenGroupsQuery.refetch()}>Retry groups</Button>
            </div>
          ) : (
          <div className="max-h-72 divide-y overflow-auto">
            {screenGroupsQuery.isLoading ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">Loading Screen Groups…</div>
            ) : screenGroups.length === 0 ? (
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
                      {(canUpdateGroup || canDeleteGroup) ? (
                        <div className="flex items-center gap-2 ml-2">
                          {canUpdateGroup ? <Button
                            size="sm"
                            variant="ghost"
                            onClick={(event) => handleEditGroup(id, event)}
                            aria-label={`Edit Group ${name}`}
                            className="h-8 w-8 p-0"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button> : null}
                          {canDeleteGroup ? <Button
                            size="sm"
                            variant="ghost"
                            onClick={(event) => handleDeleteGroup(id, event)}
                            aria-label={`Delete Group ${name}`}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </>
            )}
          </div>
          )}
          {groupTotalPages > 1 && (
            <PageNavigation currentPage={groupPage} totalPages={groupTotalPages} onPageChange={setGroupPage} />
          )}
          </div>
        </section>
        ) : null}

        {canReadPairings ? (
        <section aria-label="Pairing code history" className="py-2">
          <div className="flex items-center">
            <h2>
              <Button
                variant="ghost"
                onClick={() => setPairingsOpen((open) => !open)}
                aria-expanded={pairingsOpen}
                aria-controls="screen-pairing-codes"
                className="min-h-11 gap-2 px-1 text-left font-semibold"
              >
                <QrCode className="h-4 w-4 text-primary" />
                Pairing codes
                <span className="text-xs font-normal text-muted-foreground">
                  {pairingsQuery.isError ? "Unavailable" : pairingsData
                    ? pairingView === "active"
                      ? String(pairingsData.pagination.total) + " active"
                      : "History"
                    : "Checking…"}
                </span>
                <ChevronDown className={pairingsOpen ? "h-4 w-4 rotate-180 text-muted-foreground" : "h-4 w-4 text-muted-foreground"} />
              </Button>
            </h2>
          </div>

          <div id="screen-pairing-codes" hidden={!pairingsOpen} className="space-y-3 px-1 pb-3">
          <div className="flex gap-2" role="group" aria-label="Pairing record view">
            <Button size="sm" variant={pairingView === "active" ? "default" : "outline"}
              onClick={() => { setPairingView("active"); setPairingPage(1); }}>Active codes</Button>
            <Button size="sm" variant={pairingView === "history" ? "default" : "outline"}
              onClick={() => { setPairingView("history"); setPairingPage(1); }}>History</Button>
          </div>

          {pairingsQuery.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 py-3 text-sm text-destructive">
              Pairing codes are unavailable.
              <Button size="sm" variant="outline" onClick={() => void pairingsQuery.refetch()}>Retry pairing codes</Button>
            </div>
          ) : (
          <div className="max-h-72 divide-y overflow-auto">
            {pairingsQuery.isLoading ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">Loading pairing codes…</div>
            ) : pairings.length === 0 ? (
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
          )}
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
          </div>
        </section>
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

      <CreateGroupModal open={isGroupModalOpen} onOpenChange={setIsGroupModalOpen} canReadGroups={canReadGroups} />

      {selectedGroupId && (
        <UpdateGroupModal
          groupId={selectedGroupId}
          canDelete={canDeleteGroup}
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
              <div className="rounded-md border status-tone-warning p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 status-text-warning" />
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
