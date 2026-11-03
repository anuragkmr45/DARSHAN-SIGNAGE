import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Calendar, Clock, Zap, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { RequestDetailDrawer } from "@/components/schedule/RequestDetailDrawer";
import { EmergencyTakeoverModal } from "@/components/requests/EmergencyTakeoverModal";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { MediaPreview } from "@/components/common/MediaPreview";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { scheduleRequestsApi } from "@/api/domains/scheduleRequests";
import { deviceScheduleApi } from "@/api/domains/deviceSchedule";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import { useToast } from "@/hooks/use-toast";
import type { ScheduleRequestListItem } from "@/api/types";
import { useAppSelector } from "@/store/hooks";
import { getContentCreatorLabel, getContentOwnershipLabel } from "@/lib/access";
import { useDebounce } from "@/hooks/use-debounce";
import { useScreensRealtime } from "@/hooks/screens/useScreensRealtime";
import { useAuthorization } from "@/hooks/useAuthorization";
import { canCreateScheduleFlow } from "@/lib/scheduleAccess";

const PAGE_SIZE = 10;

const STATUS_TABS = [
  { key: "pending", label: "Pending", apiStatus: "PENDING" },
  { key: "approved", label: "Approved", apiStatus: "APPROVED" },
  { key: "rejected", label: "Rejected", apiStatus: "REJECTED" },
  { key: "published", label: "Published", apiStatus: "PUBLISHED" },
  { key: "taken_down", label: "Taken Down", apiStatus: "TAKEN_DOWN" },
  { key: "expired", label: "Expired", apiStatus: "EXPIRED" },
] as const;

type TabKey = (typeof STATUS_TABS)[number]["key"];
type DateField = "created_at" | "schedule_window";
type SortDirection = "asc" | "desc";

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatRequestId = (id?: string | null) => (id ? `REQ-${id.slice(-12)}` : "REQ-—");

const getDepartmentLabel = (request?: ScheduleRequestListItem) =>
  request?.requested_by_user?.department?.name || request?.requested_by_user?.department_id || "";

const getRequesterLabel = (request?: ScheduleRequestListItem) => {
  const user = request?.requested_by_user;
  if (!user) return "Unknown requester";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const label = name || user.email || user.id;
  return user.status === "DELETED" ? `${label} (deleted)` : label;
};

const formatReservationState = (request?: ScheduleRequestListItem) => {
  const state = request?.reservation_summary?.state;
  if (!state) return null;
  return state
    .split("_")
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(" ");
};

// Date inputs and displayed request timestamps use the operator's local timezone.
const toStartOfDayIso = (value: string) => (value ? new Date(`${value}T00:00:00.000`).toISOString() : undefined);
const toEndOfDayIso = (value: string) => (value ? new Date(`${value}T23:59:59.999`).toISOString() : undefined);

export default function ScheduleQueue() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const currentUser = useAppSelector((state) => state.auth.user);
  const { can } = useAuthorization();
  const showEmergencyTakeover = can("manage", "Emergency") || can("update", "Screen");
  const canCreateRequest = canCreateScheduleFlow(can);
  const [searchQuery, setSearchQuery] = useState("");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [dateField, setDateField] = useState<DateField>("created_at");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [selectedRequest, setSelectedRequest] = useState<ScheduleRequestListItem | null>(null);
  const [snapshotSource, setSnapshotSource] = useState("");
  const [groupMemberId, setGroupMemberId] = useState("");
  const lastSnapshotRequestId = useRef<string | null>(null);
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [pageByStatus, setPageByStatus] = useState<Record<TabKey, number>>({
    pending: 1,
    approved: 1,
    rejected: 1,
    published: 1,
    taken_down: 1,
    expired: 1,
  });
  const [tabTotals, setTabTotals] = useState<Partial<Record<TabKey, number>>>({});
  const debouncedSearchQuery = useDebounce(searchQuery, 350);
  const dateFromIso = useMemo(() => toStartOfDayIso(dateFrom), [dateFrom]);
  const dateToIso = useMemo(() => toEndOfDayIso(dateTo), [dateTo]);
  const sharedFilters = useMemo(
    () => ({
      q: debouncedSearchQuery.trim() || undefined,
      date_field: dateField,
      date_from: dateFromIso,
      date_to: dateToIso,
    }),
    [debouncedSearchQuery, dateField, dateFromIso, dateToIso],
  );

  const invalidateScheduleData = useCallback(() => {
    // Publish, take-down, emergency and default-media changes are emitted on
    // the authorized screens namespace. Refresh the schedule views from the
    // API rather than trusting a notification payload as business state.
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["schedule-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["device-schedule"] }),
      queryClient.invalidateQueries({ queryKey: ["schedule-snapshot-group-members"] }),
    ]);
  }, [queryClient]);

  useScreensRealtime({
    enabled: Boolean(currentUser),
    syncMode: "invalidate",
    onRefreshRequired: invalidateScheduleData,
    onScheduleRequestsChanged: invalidateScheduleData,
  });

  const summaryQuery = useQuery({
    queryKey: queryKeys.scheduleRequestSummary(sharedFilters),
    queryFn: () => scheduleRequestsApi.statusSummary(sharedFilters),
    enabled: !invalidDateRange,
    staleTime: 30_000,
  });

  const activeConfig = STATUS_TABS.find((tab) => tab.key === activeTab)!;
  const activePage = pageByStatus[activeTab];

  const { data, isLoading, isFetching, isError, refetch: refetchRequests } = useQuery({
    queryKey: queryKeys.scheduleRequests({
      page: activePage,
      limit: PAGE_SIZE,
      status: activeConfig.apiStatus,
      include: "all",
      q: sharedFilters.q,
      date_field: sharedFilters.date_field,
      date_from: sharedFilters.date_from,
      date_to: sharedFilters.date_to,
      sort_direction: sortDirection,
    }),
    queryFn: () =>
      scheduleRequestsApi.list({
        page: activePage,
        limit: PAGE_SIZE,
        status: activeConfig.apiStatus,
        include: "all",
        q: sharedFilters.q,
        date_field: sharedFilters.date_field,
        date_from: sharedFilters.date_from,
        date_to: sharedFilters.date_to,
        sort_direction: sortDirection,
      }),
    enabled: !invalidDateRange,
    keepPreviousData: true,
    staleTime: 30_000,
  });

  useEffect(() => {
    setSelectedRequest(null);
  }, [activeTab]);

  useEffect(() => {
    setPageByStatus({
      pending: 1,
      approved: 1,
      rejected: 1,
      published: 1,
      taken_down: 1,
      expired: 1,
    });
    setTabTotals({});
    setSelectedRequest(null);
  }, [sharedFilters, sortDirection]);

  useEffect(() => {
    if (data?.pagination?.total === undefined) return;
    setTabTotals((prev) => ({ ...prev, [activeTab]: data.pagination.total }));
  }, [data?.pagination?.total, activeTab]);

  const requests = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);

  useEffect(() => {
    if (!selectedRequest || !data?.items || isFetching) return;
    const current = data.items.find((item) => item.id === selectedRequest.id);
    if (!current) setSelectedRequest(null);
    else if (current !== selectedRequest) setSelectedRequest(current);
  }, [data?.items, isFetching, selectedRequest]);

  const directScreens = selectedRequest?.screens ?? [];
  const targetGroups = selectedRequest?.screen_groups ?? [];
  const canReadGroups = can("read", "ScreenGroup");
  useEffect(() => {
    if (lastSnapshotRequestId.current === (selectedRequest?.id ?? null)) return;
    lastSnapshotRequestId.current = selectedRequest?.id ?? null;
    const screens = selectedRequest?.screens ?? [];
    const groups = selectedRequest?.screen_groups ?? [];
    setSnapshotSource(screens.length === 1 && groups.length === 0
      ? `screen:${screens[0].id}`
      : screens.length === 0 && groups.length === 1 ? `group:${groups[0].id}` : "");
    setGroupMemberId("");
  }, [selectedRequest?.id, selectedRequest?.screens, selectedRequest?.screen_groups]);
  const selectedGroupId = snapshotSource.startsWith("group:") && targetGroups.some((group) => group.id === snapshotSource.slice(6))
    ? snapshotSource.slice(6) : undefined;
  const groupMembersQuery = useQuery({
    queryKey: ["schedule-snapshot-group-members", selectedGroupId],
    queryFn: () => screensApi.getGroupById(selectedGroupId!),
    enabled: activeTab === "published" && Boolean(selectedGroupId) && canReadGroups,
    staleTime: 0,
  });
  const groupScreenIds = groupMembersQuery.data?.screen_ids ?? [];
  const selectedDeviceId = snapshotSource.startsWith("screen:") && directScreens.some((screen) => screen.id === snapshotSource.slice(7))
    ? snapshotSource.slice(7)
    : selectedGroupId && groupScreenIds.length === 1
      ? groupScreenIds[0]
      : selectedGroupId && groupScreenIds.includes(groupMemberId) ? groupMemberId : undefined;
  const deviceScheduleQuery = useQuery({
    queryKey: ["device-schedule", selectedDeviceId ?? null],
    queryFn: async () => {
      if (!selectedDeviceId) {
        throw new Error("Select a published request with a paired screen to load the device snapshot.");
      }
      return deviceScheduleApi.getSchedule(selectedDeviceId);
    },
    enabled: activeTab === "published" && Boolean(selectedDeviceId),
    staleTime: 0,
  });

  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (data?.pagination && activePage > totalPages) {
      setPageByStatus((previous) => ({ ...previous, [activeTab]: totalPages }));
    }
  }, [activePage, activeTab, data?.pagination, totalPages]);

  const clearFilters = () => {
    setSearchQuery("");
    setDateField("created_at");
    setDateFrom("");
    setDateTo("");
    setSortDirection("desc");
    setShowMoreFilters(false);
  };
  const extraFilterCount = Number(dateField !== "created_at") + Number(Boolean(dateFrom))
    + Number(Boolean(dateTo)) + Number(sortDirection !== "desc");

  const handlePageChange = (nextPage: number) => {
    setSelectedRequest(null);
    setPageByStatus((prev) => ({
      ...prev,
      [activeTab]: Math.min(Math.max(nextPage, 1), totalPages),
    }));
  };

  return (
    <div
      className={`flex flex-col gap-4 ${
        selectedRequest ? "xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] xl:items-start" : ""
      }`}
    >
      {/* Left Panel - Request List */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-foreground">Schedule Queue</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage playlists, approvals, and publishing workflow
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {showEmergencyTakeover && (
              <Button variant="outline" size="sm" onClick={() => setIsEmergencyModalOpen(true)}>
                <Zap className="h-4 w-4 mr-2" />
                Emergency Takeover
              </Button>
            )}
            {canCreateRequest ? <Button size="sm" onClick={() => navigate("/schedule/new")}>
              <Plus className="h-4 w-4 mr-2" />
              Create Schedule
            </Button> : null}
          </div>
        </div>

        <section aria-label="Schedule filters" className="space-y-3 border-b pb-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search schedule requests"
                  placeholder="Search by schedule, request, requester, or notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button variant="outline" size="sm" aria-expanded={showMoreFilters} onClick={() => setShowMoreFilters((value) => !value)}>
                Filters{extraFilterCount ? ` (${extraFilterCount} active)` : ""}
              </Button>
            </div>
            {showMoreFilters ? <div id="schedule-more-filters" className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-4">
              <Select value={dateField} onValueChange={(value) => setDateField(value as DateField)}>
                <SelectTrigger aria-label="Filter date field">
                  <SelectValue placeholder="Date field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created_at">Created Date</SelectItem>
                  <SelectItem value="schedule_window">Schedule Window</SelectItem>
                </SelectContent>
              </Select>
              <div className="space-y-1"><Label htmlFor="request-date-from">From</Label><Input id="request-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="request-date-to">To</Label><Input id="request-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
              <Select value={sortDirection} onValueChange={(value) => setSortDirection(value as SortDirection)}>
                <SelectTrigger aria-label="Sort schedule requests">
                  <SelectValue placeholder="Sort direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Newest First</SelectItem>
                  <SelectItem value="asc">Oldest First</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={clearFilters}>
                Clear Filters
              </Button>
            </div> : null}
        </section>

        {invalidDateRange ? <p role="alert" className="text-sm text-destructive">The From date must be on or before the To date.</p> : null}

        {summaryQuery.isError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <span>Could not update status counts. The request list below remains available.</span>
          <Button variant="outline" size="sm" onClick={() => void summaryQuery.refetch()}>Retry counts</Button>
        </div> : null}

        {/* Status Tabs */}
        <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as TabKey)} className="flex-1 flex flex-col">
          <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto p-1">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="shrink-0">
                <span>{tab.label}</span>
                <Badge variant="secondary" className="ml-2 shrink-0">
                  {summaryQuery.data?.counts?.[tab.key] ?? tabTotals[tab.key] ?? "—"}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={activeTab} className="mt-4 min-w-0 flex-1">
            <ScrollArea className="min-w-0">
          <div className="space-y-3 pr-4">
            {activeTab === "published" && (
              <Card>
                <CardHeader className="space-y-1">
                  <CardTitle className="text-base">Backend Screen Schedule</CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    {selectedRequest
                      ? "Select a target Screen to inspect its current backend snapshot. This does not confirm the player received or displayed it."
                      : "Select a published request to inspect a Screen's current backend snapshot."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedRequest && (directScreens.length > 0 || targetGroups.length > 0) ? <div className="space-y-2">
                    <Label htmlFor="schedule-snapshot-target">Target</Label>
                    <Select value={snapshotSource} onValueChange={(value) => { setSnapshotSource(value); setGroupMemberId(""); }}>
                      <SelectTrigger id="schedule-snapshot-target" aria-label="Choose snapshot target"><SelectValue placeholder="Choose a Screen or Screen Group" /></SelectTrigger>
                      <SelectContent>
                        {directScreens.map((screen) => <SelectItem key={`screen:${screen.id}`} value={`screen:${screen.id}`}>Screen: {screen.name}</SelectItem>)}
                        {targetGroups.map((group) => <SelectItem key={`group:${group.id}`} value={`group:${group.id}`}>Group: {group.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {selectedGroupId && !canReadGroups ? <p role="alert" className="text-sm text-muted-foreground">Screen Group access is needed to inspect its current members.</p> : null}
                    {selectedGroupId && canReadGroups && groupMembersQuery.isLoading ? <LoadingIndicator label="Loading current group members..." /> : null}
                    {selectedGroupId && canReadGroups && groupMembersQuery.isError ? <div role="alert" className="space-y-2 text-sm text-destructive">
                      <p>Could not load the group's current members.</p>
                      <Button variant="outline" size="sm" onClick={() => void groupMembersQuery.refetch()}>Retry group members</Button>
                    </div> : null}
                    {selectedGroupId && groupMembersQuery.isSuccess && groupScreenIds.length === 0 ? <p className="text-sm text-muted-foreground">This group currently has no Screens.</p> : null}
                    {selectedGroupId && groupScreenIds.length > 0 ? <>
                      <p className="text-xs text-muted-foreground">Group membership is current and may differ from its membership when published.</p>
                      <Button variant="ghost" size="sm" onClick={() => void groupMembersQuery.refetch()} disabled={groupMembersQuery.isFetching}>Refresh group members</Button>
                      {groupScreenIds.length > 1 ? <Select value={groupMemberId} onValueChange={setGroupMemberId}>
                        <SelectTrigger aria-label="Choose group Screen"><SelectValue placeholder="Choose a group Screen" /></SelectTrigger>
                        <SelectContent>{groupScreenIds.map((id) => <SelectItem key={id} value={id}>Screen ···{id.slice(-8)}</SelectItem>)}</SelectContent>
                      </Select> : null}
                    </> : null}
                  </div> : null}
                  {selectedDeviceId ? <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Current backend snapshot for Screen ···{selectedDeviceId.slice(-8)}. Check Delivery and Proof of Play for player evidence.</span>
                    <Button variant="ghost" size="sm" onClick={() => void deviceScheduleQuery.refetch()} disabled={deviceScheduleQuery.isFetching}>Refresh snapshot</Button>
                  </div> : null}
                  {!selectedRequest || !selectedDeviceId ? (
                    <p className="text-sm text-muted-foreground">
                      {selectedRequest ? "Choose a Screen above to inspect its current backend snapshot." : "Select a published request to inspect a Screen's current backend snapshot."}
                    </p>
                  ) : deviceScheduleQuery.isLoading ? (
                    <div className="flex justify-center py-6">
                      <LoadingIndicator label="Loading published schedule..." />
                    </div>
                  ) : deviceScheduleQuery.isError ? (
                    <div role="alert" className="space-y-2 text-sm text-destructive">
                      <p>{(deviceScheduleQuery.error as Error)?.message ?? "Unable to load the backend screen snapshot."}</p>
                      <Button variant="outline" size="sm" onClick={() => void deviceScheduleQuery.refetch()}>Retry snapshot</Button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {deviceScheduleQuery.data?.generated_at && (
                          <p>Generated: {formatDateTime(deviceScheduleQuery.data.generated_at)}</p>
                        )}
                        {deviceScheduleQuery.data?.fetched_at && (
                          <p>Fetched: {formatDateTime(deviceScheduleQuery.data.fetched_at)}</p>
                        )}
                      </div>
                      {deviceScheduleQuery.data?.schedule?.items?.length ? (
                      <div className="grid gap-3 lg:grid-cols-2">
                          {deviceScheduleQuery.data.schedule.items.map((item) => (
                            <div key={item.id} className="flex gap-3 rounded-lg border border-border/60 p-3 bg-card">
                              <MediaPreview
                                url={item.media_url}
                                type={item.type}
                                alt={item.name ?? "Media preview"}
                                className="h-20 w-28 flex-shrink-0"
                                pdfPage={item.page_number ?? 1}
                              />
                              <div className="flex-1 space-y-1 text-sm">
                                <p className="font-medium">{item.name ?? "Untitled media"}</p>
                                {item.type && (
                                  <p className="text-xs text-muted-foreground">Type: {item.type}</p>
                                )}
                                {item.display_ms && (
                                  <p className="text-xs text-muted-foreground">
                                    Display: {item.display_ms} ms
                                  </p>
                                )}
                                {item.fit && (
                                  <p className="text-xs text-muted-foreground">Fit: {item.fit}</p>
                                )}
                                {typeof item.page_number === "number" && (
                                  <p className="text-xs text-muted-foreground">Page: {item.page_number}</p>
                                )}
                                {typeof item.muted === "boolean" && (
                                  <p className="text-xs text-muted-foreground">
                                    Muted: {item.muted ? "Yes" : "No"}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No schedule items were returned for this device.
                        </p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
                {invalidDateRange ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">Correct the date range to load requests.</p>
                ) : isLoading ? (
                  <div className="flex justify-center py-12">
                    <LoadingIndicator label="Loading schedule requests..." />
                  </div>
                ) : isError && !data ? (
                  <div role="alert" className="space-y-3 py-10 text-center">
                    <p className="font-medium">Could not load schedule requests</p>
                    <p className="text-sm text-muted-foreground">Your filters are unchanged. Try again when the connection returns.</p>
                    <Button variant="outline" size="sm" onClick={() => void refetchRequests()}>Retry</Button>
                  </div>
                ) : requests.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium">No requests found</p>
                    <p className="text-sm mt-2">
                      {searchQuery || dateFrom || dateTo
                        ? "Try adjusting your filters."
                        : "Create a new request to get started"}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y rounded-xl border bg-card">
                  {requests.map((request) => {
                    const scheduleName = request.schedule?.name || "Schedule request";
                    const requesterLabel = getRequesterLabel(request);
                    const departmentLabel = getDepartmentLabel(request);
                    const screenCount = request.screens?.length ?? 0;
                    const screenGroupCount = request.screen_groups?.length ?? 0;
                    const reservationState = formatReservationState(request);

                    const handleCopyId = async (event: React.MouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation();
                      try {
                        await navigator.clipboard.writeText(request.id);
                        toast({ title: "Copied", description: "Request ID copied to clipboard." });
                      } catch (err) {
                        const message = err instanceof Error ? err.message : "Unable to copy request ID.";
                        toast({ title: "Copy failed", description: message, variant: "destructive" });
                      }
                    };

                    const displayStatus =
                      activeConfig.apiStatus === "EXPIRED"
                        ? request.schedule_time_status?.status || request.status
                        : request.status;

                    return (
                      <div
                        key={request.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${scheduleName} request details`}
                        onClick={() => setSelectedRequest(request)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedRequest(request);
                          }
                        }}
                        className={`px-4 py-4 cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                          selectedRequest?.id === request.id
                            ? "bg-primary/5"
                            : "hover:bg-muted/40"
                        }`}
                      >
                        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <h3 className="truncate font-semibold text-foreground">{scheduleName}</h3>
                              {reservationState ? <Badge variant="outline" className="shrink-0">{reservationState}</Badge> : null}
                              {request.schedule && getContentOwnershipLabel(request.schedule) ? (
                                <Badge variant="secondary" className="shrink-0">
                                  {getContentOwnershipLabel(request.schedule)}
                                </Badge>
                              ) : null}
                              {request.schedule && getContentCreatorLabel(request.schedule) ? (
                                <Badge variant="outline" className="shrink-0">
                                  {getContentCreatorLabel(request.schedule)}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                              <span className="break-words">
                                {formatRequestId(request.id)} · {requesterLabel}
                                {departmentLabel ? ` · ${departmentLabel}` : ""}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleCopyId}
                                aria-label="Copy request ID"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          <div className="self-start"><StatusBadge status={displayStatus} /></div>
                        </div>

                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                          {(screenCount > 0 || screenGroupCount > 0) && (
                            <span>{screenCount} {screenCount === 1 ? "screen" : "screens"}{screenGroupCount ? ` · ${screenGroupCount} ${screenGroupCount === 1 ? "group" : "groups"}` : ""}</span>
                          )}
                          {request.created_at && (
                            <span>Created {formatDateTime(request.created_at)}</span>
                          )}
                        </div>

                        {request.schedule?.start_at && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <span>
                              {formatDateTime(request.schedule.start_at)} → {formatDateTime(request.schedule.end_at)}
                            </span>
                          </div>
                        )}
                        {request.schedule_time_status?.status && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Schedule status: {request.schedule_time_status.status}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            </ScrollArea>

            {!isLoading && !invalidDateRange && (
              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Page {activePage} of {totalPages}
                  </span>
                  <span>Total {total} requests</span>
                </div>
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          if (activePage > 1) handlePageChange(activePage - 1);
                        }}
                        className={activePage <= 1 ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink href="#" isActive>
                        {activePage}
                      </PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          if (activePage < totalPages) handlePageChange(activePage + 1);
                        }}
                        className={activePage >= totalPages ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
            {isFetching && !isLoading && (
              <div className="text-xs text-muted-foreground mt-2">Refreshing...</div>
            )}
            {isError && data ? (
              <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-destructive">
                <span>Could not refresh requests. Showing the last loaded list.</span>
                <Button variant="outline" size="sm" onClick={() => void refetchRequests()}>Retry</Button>
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>

      {showEmergencyTakeover && (
        <EmergencyTakeoverModal
          open={isEmergencyModalOpen}
          onOpenChange={setIsEmergencyModalOpen}
          onUpdated={() => {
            void summaryQuery.refetch();
            void refetchRequests();
            void deviceScheduleQuery.refetch();
          }}
        />
      )}

      {/* Right Panel - Detail Drawer */}
      {selectedRequest && (
        <div className="min-w-0 xl:sticky xl:top-20">
          <RequestDetailDrawer request={selectedRequest} onClose={() => setSelectedRequest(null)} />
        </div>
      )}
    </div>
  );
}
