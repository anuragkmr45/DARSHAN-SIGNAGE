import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, Calendar, Clock, Zap, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { queryKeys } from "@/api/queryKeys";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/api/apiClient";
import type { ScheduleRequestListItem } from "@/api/types";
import { useAppSelector } from "@/store/hooks";
import { canManageEmergency } from "@/lib/access";
import { useDebounce } from "@/hooks/use-debounce";

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

const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

const formatRequestId = (id?: string | null) => (id ? `REQ-${id.slice(-12)}` : "REQ-—");

const getDepartmentLabel = (request?: ScheduleRequestListItem) =>
  request?.requested_by_user?.department?.name || request?.requested_by_user?.department_id || "";

const getRequesterLabel = (request?: ScheduleRequestListItem) => {
  const user = request?.requested_by_user;
  if (!user) return "Unknown requester";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  return user.email || user.id;
};

const formatReservationState = (request?: ScheduleRequestListItem) => {
  const state = request?.reservation_summary?.state;
  if (!state) return "No hold";
  return state
    .split("_")
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(" ");
};

const toStartOfDayIso = (value: string) => (value ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined);
const toEndOfDayIso = (value: string) => (value ? new Date(`${value}T23:59:59.999Z`).toISOString() : undefined);

export default function ScheduleQueue() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const currentUser = useAppSelector((state) => state.auth.user);
  const showEmergencyTakeover = canManageEmergency(currentUser);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateField, setDateField] = useState<DateField>("created_at");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [selectedRequest, setSelectedRequest] = useState<ScheduleRequestListItem | null>(null);
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

  const summaryQuery = useQuery({
    queryKey: queryKeys.scheduleRequestSummary(sharedFilters),
    queryFn: () => scheduleRequestsApi.statusSummary(sharedFilters),
    staleTime: 30_000,
  });

  const activeConfig = STATUS_TABS.find((tab) => tab.key === activeTab)!;
  const activePage = pageByStatus[activeTab];

  const { data, isLoading, isFetching, isError, error, refetch: refetchRequests } = useQuery({
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
    keepPreviousData: true,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!isError) return;
    const message = error instanceof ApiError ? error.message : "Unable to load schedule requests.";
    toast({ title: "Load failed", description: message, variant: "destructive" });
  }, [isError, error, toast]);

  useEffect(() => {
    if (!summaryQuery.isError) return;
    const message =
      summaryQuery.error instanceof ApiError
        ? summaryQuery.error.message
        : "Unable to load schedule request summary.";
    toast({ title: "Load failed", description: message, variant: "destructive" });
  }, [summaryQuery.isError, summaryQuery.error, toast]);

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
  }, [sharedFilters, sortDirection]);

  useEffect(() => {
    if (data?.pagination?.total === undefined) return;
    setTabTotals((prev) => ({ ...prev, [activeTab]: data.pagination.total }));
  }, [data?.pagination?.total, activeTab]);

  const requests = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);

  const selectedDeviceId =
    typeof selectedRequest?.screens?.[0]?.id === "string" && selectedRequest.screens[0].id.trim()
      ? selectedRequest.screens[0].id
      : undefined;
  const deviceScheduleQuery = useQuery({
    queryKey: ["device-schedule", selectedDeviceId ?? null],
    queryFn: async () => {
      if (!selectedDeviceId) {
        throw new Error("Select a published request with a paired screen to load the device snapshot.");
      }
      return deviceScheduleApi.getSchedule(selectedDeviceId);
    },
    enabled: activeTab === "published" && Boolean(selectedDeviceId),
    staleTime: 30_000,
  });

  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const clearFilters = () => {
    setSearchQuery("");
    setDateField("created_at");
    setDateFrom("");
    setDateTo("");
    setSortDirection("desc");
  };

  const handlePageChange = (nextPage: number) => {
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
            <Button size="sm" onClick={() => navigate("/schedule/new")}>
              <Plus className="h-4 w-4 mr-2" />
              New Request
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Filters</CardTitle>
            <CardDescription>Filter every tab by search, date field, range, and sort direction.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="relative sm:col-span-2 xl:col-span-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by schedule, request, requester, or notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={dateField} onValueChange={(value) => setDateField(value as DateField)}>
                <SelectTrigger>
                  <SelectValue placeholder="Date field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created_at">Created Date</SelectItem>
                  <SelectItem value="schedule_window">Schedule Window</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Select value={sortDirection} onValueChange={(value) => setSortDirection(value as SortDirection)}>
                <SelectTrigger className="w-full sm:w-[180px]">
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
            </div>
          </CardContent>
        </Card>

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
                  <CardTitle className="text-base">Published Device Schedule</CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    {selectedRequest
                      ? `Snapshot for device ${selectedDeviceId || "unknown"}`
                      : "Select a published request to preview the snapshot fetched from a device."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!selectedRequest || !selectedDeviceId ? (
                    <p className="text-sm text-muted-foreground">
                      Select a published request to load the same schedule that was delivered to the paired device.
                    </p>
                  ) : deviceScheduleQuery.isLoading ? (
                    <div className="flex justify-center py-6">
                      <LoadingIndicator label="Loading published schedule..." />
                    </div>
                  ) : deviceScheduleQuery.isError ? (
                    <p className="text-sm text-destructive">
                      {(deviceScheduleQuery.error as Error)?.message ??
                        "Unable to load the device schedule snapshot."}
                    </p>
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
                                alt={item.media_id}
                                className="h-20 w-28 flex-shrink-0"
                              />
                              <div className="flex-1 space-y-1 text-sm">
                                <p className="font-medium">{item.media_id}</p>
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
                {isLoading ? (
                  <div className="flex justify-center py-12">
                    <LoadingIndicator label="Loading schedule requests..." />
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
                  requests.map((request) => {
                    const scheduleName = request.schedule?.name || "Schedule request";
                    const requesterLabel = getRequesterLabel(request);
                    const departmentLabel = getDepartmentLabel(request);
                    const mediaCount = request.media?.length ?? 0;
                    const presentationCount = request.presentations?.length ?? 0;
                    const screenCount = request.screens?.length ?? 0;
                    const screenGroupCount = request.screen_groups?.length ?? 0;
                    const scheduleItemCount = request.schedule_items?.length ?? 0;
                    const slotCount = request.presentation_slots?.length ?? 0;
                    const totalDurationSeconds = request.presentation_slots?.reduce(
                      (sum, slot) => sum + (slot.duration_seconds || 0),
                      0,
                    );
                    const reservationState = formatReservationState(request);
                    const hasMetadataRow = scheduleItemCount > 0 || slotCount > 0 || totalDurationSeconds > 0;

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
                        onClick={() => setSelectedRequest(request)}
                        className={`p-4 border rounded-lg cursor-pointer transition-all hover:shadow-md ${
                          selectedRequest?.id === request.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:border-primary/50"
                        }`}
                      >
                        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <h3 className="truncate font-semibold text-foreground">{scheduleName}</h3>
                              <Badge variant="outline" className="shrink-0">{reservationState}</Badge>
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
                          <StatusBadge status={displayStatus} />
                        </div>

                        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 2xl:grid-cols-4">
                          {mediaCount > 0 && (
                            <div>
                              <p className="text-muted-foreground">Media</p>
                              <p className="font-medium">{mediaCount} items</p>
                            </div>
                          )}
                          {presentationCount > 0 && (
                            <div>
                              <p className="text-muted-foreground">Presentations</p>
                              <p className="font-medium">{presentationCount}</p>
                            </div>
                          )}
                          {(screenCount > 0 || screenGroupCount > 0) && (
                            <div>
                              <p className="text-muted-foreground">Targets</p>
                              <p className="font-medium">
                                {screenCount} screens{screenGroupCount ? ` · ${screenGroupCount} groups` : ""}
                              </p>
                            </div>
                          )}
                          {request.created_at && (
                            <div>
                              <p className="text-muted-foreground">Created</p>
                              <p className="font-medium text-xs">{formatDateTime(request.created_at)}</p>
                            </div>
                          )}
                        </div>

                        {hasMetadataRow && (
                          <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            {scheduleItemCount > 0 && <span>Schedule items: {scheduleItemCount}</span>}
                            {slotCount > 0 && <span>Slots: {slotCount}</span>}
                            {totalDurationSeconds > 0 && (
                              <span>Total slot duration: {formatDuration(totalDurationSeconds)}</span>
                            )}
                          </div>
                        )}

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
                  })
                )}
              </div>
            </ScrollArea>

            {!isLoading && (
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
