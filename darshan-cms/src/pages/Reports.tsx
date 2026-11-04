import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reportsApi } from "@/api/domains/reports";
import { proofOfPlayApi } from "@/api/domains/proofOfPlay";
import { auditLogsApi } from "@/api/domains/auditLogs";
import { ApiError } from "@/api/apiClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuthorization } from "@/hooks/useAuthorization";
import type { AuditLog } from "@/api/types";
import { PageNavigation } from "@/components/common/PageNavigation";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { formatAuditAction, formatAuditResource } from "@/lib/auditPresentation";

const AUDIT_LOGS_PAGE_SIZE = 5;

const formatDuration = (seconds?: number | null) => {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds > 0 && seconds < 30) return "<1m";
  const wholeMinutes = Math.round(seconds / 60);
  const days = Math.floor(wholeMinutes / 1440);
  const hours = Math.floor((wholeMinutes % 1440) / 60);
  const minutes = wholeMinutes % 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ");
};

const downloadBlobFile = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

const formatAuditField = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const formatAuditTimestamp = (value?: string) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
};
const errorMessage = (failure: unknown) => failure instanceof ApiError ? failure.message : "Please try again.";

function AuditLogCard({ log }: { log: AuditLog }) {
  const actorName = [log.user?.first_name, log.user?.last_name].filter(Boolean).join(" ").trim();
  const actorLabel = actorName || log.user?.email || log.user_id || "system";
  const actionLabel = formatAuditAction(log.action, log.resource_type);
  const resourceLabel = formatAuditResource(log.resource_type);
  const showResourceLabel = !actionLabel.toLowerCase().startsWith(resourceLabel.toLowerCase());
  const changesValue =
    log.changes && Object.keys(log.changes).length > 0 ? JSON.stringify(log.changes, null, 2) : "—";

  const detailFields = [
    { label: "Action code", value: log.action, mono: true },
    { label: "Log ID", value: log.id, mono: true },
    { label: "Resource type", value: log.resource_type },
    { label: "Resource ID", value: log.resource_id, mono: true },
    { label: "User ID", value: log.user_id, mono: true },
    { label: "IP address", value: log.ip_address },
    { label: "User agent", value: log.user_agent },
    { label: "Storage object ID", value: log.storage_object_id, mono: true },
    { label: "Created", value: formatAuditTimestamp(log.created_at) },
  ];

  const actorFields = [
    { label: "Name", value: actorName || "—" },
    { label: "Email", value: log.user?.email },
    { label: "Role ID", value: log.user?.role_id, mono: true },
    { label: "Department ID", value: log.user?.department_id, mono: true },
    { label: "Active", value: log.user?.is_active },
  ];

  return (
    <AccordionItem value={log.id} className="border-b px-1">
      <AccordionTrigger className="py-4 hover:no-underline">
        <div className="flex flex-1 flex-wrap items-start justify-between gap-3 pr-4 text-left">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{actionLabel}</p>
              {showResourceLabel && <Badge variant="outline">{resourceLabel}</Badge>}
            </div>
            <div>
              <p className="font-medium">{actorLabel}</p>
              <p className="text-xs text-muted-foreground">
                {log.user?.email ?? log.user_id ?? "system"}
              </p>
            </div>
          </div>
          <div className="space-y-1 text-left sm:text-right">
            <p className="text-sm font-medium">{formatAuditTimestamp(log.created_at)}</p>
            <p className="text-xs text-muted-foreground">
              {formatAuditField(log.ip_address)}
            </p>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {detailFields.map((field) => (
              <div key={field.label} className="min-w-0">
                <p className="text-xs text-muted-foreground">{field.label}</p>
                <p className={field.mono ? "mt-1 break-all font-mono text-xs" : "mt-1 text-sm"}>
                  {formatAuditField(field.value)}
                </p>
              </div>
            ))}
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-medium">User details</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {actorFields.map((field) => (
                <div key={field.label}>
                  <p className="text-xs text-muted-foreground">{field.label}</p>
                  <p className={field.mono ? "mt-1 break-all font-mono text-xs" : "mt-1 text-sm"}>
                    {formatAuditField(field.value)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-medium">Recorded changes</p>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">
              {changesValue}
            </pre>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export default function Reports() {
  const { toast } = useToast();
  const [view, setView] = useState<"availability" | "audit">("availability");
  const [resourceFilter, setResourceFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [auditLogsPage, setAuditLogsPage] = useState(1);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingReportPdf, setIsExportingReportPdf] = useState(false);
  const [isExportingLogsPdf, setIsExportingLogsPdf] = useState(false);
  const [availabilityDays, setAvailabilityDays] = useState(7);
  const debouncedResource = useDebounce(resourceFilter, 400);
  const debouncedAction = useDebounce(actionFilter, 400);
  const { can, isLoading: isAuthzLoading } = useAuthorization();

  const canReadReports = can("read", "Report");
  const canReadAuditLogs = can("read", "AuditLog");
  const canReadProofOfPlay = can("read", "ProofOfPlay");
  const activeView = view === "availability" && !canReadReports ? "audit" : view === "audit" && !canReadAuditLogs ? "availability" : view;

  const availabilityQuery = useQuery({
    queryKey: ["reports-availability", availabilityDays],
    queryFn: () => reportsApi.getAvailability(availabilityDays),
    enabled: canReadReports,
  });

  const popQuery = useQuery({
    queryKey: ["reports-recent-proof-of-play"],
    queryFn: () => proofOfPlayApi.list({ limit: 5, page: 1 }),
    enabled: canReadReports && canReadProofOfPlay,
  });

  const auditLogsQuery = useQuery({
    queryKey: ["audit-logs", auditLogsPage, AUDIT_LOGS_PAGE_SIZE, debouncedResource, debouncedAction],
    queryFn: () =>
      auditLogsApi.list({
        page: auditLogsPage,
        limit: AUDIT_LOGS_PAGE_SIZE,
        resource_type: debouncedResource || undefined,
        action: debouncedAction || undefined,
      }),
    placeholderData: keepPreviousData,
    enabled: canReadAuditLogs,
  });

  const availability = availabilityQuery.data;
  const popItems = popQuery.data?.items ?? [];
  const auditLogs = auditLogsQuery.data?.items ?? [];
  const auditLogsTotal = auditLogsQuery.data?.total ?? 0;
  const auditLogsTotalPages = Math.max(
    1,
    Math.ceil(auditLogsTotal / AUDIT_LOGS_PAGE_SIZE),
  );
  const auditLogsRangeStart = auditLogs.length === 0 ? 0 : (auditLogsPage - 1) * AUDIT_LOGS_PAGE_SIZE + 1;
  const auditLogsRangeEnd = auditLogs.length === 0 ? 0 : auditLogsRangeStart + auditLogs.length - 1;
  const showAccessDenied = !isAuthzLoading && !canReadReports && !canReadAuditLogs;

  const auditPlaceholder = useMemo(
    () =>
      Array.from({ length: 5 }).map((_, idx) => (
        <div key={idx} className="space-y-2 border-b py-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-52" />
        </div>
      )),
    [],
  );

  useEffect(() => {
    setAuditLogsPage(1);
  }, [resourceFilter, actionFilter]);

  useEffect(() => {
    if (!auditLogsQuery.data) return;
    if (auditLogsPage > auditLogsTotalPages) {
      setAuditLogsPage(auditLogsTotalPages);
    }
  }, [auditLogsPage, auditLogsTotalPages, auditLogsQuery.data]);

  const handleExportCsv = async () => {
    try {
      setIsExportingCsv(true);
      const csv = await proofOfPlayApi.export();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      downloadBlobFile(blob, `proof-of-play-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to export proof-of-play CSV.";
      toast({ title: "Export failed", description: message, variant: "destructive" });
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handleExportReportPdf = async () => {
    try {
      setIsExportingReportPdf(true);
      const blob = await reportsApi.exportPdf();
      downloadBlobFile(blob, `reports-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to export reports PDF.";
      toast({ title: "Export failed", description: message, variant: "destructive" });
    } finally {
      setIsExportingReportPdf(false);
    }
  };

  const handleExportLogsPdf = async () => {
    try {
      setIsExportingLogsPdf(true);
      const blob = await auditLogsApi.exportPdf({
        resource_type: resourceFilter.trim() || undefined,
        action: actionFilter.trim() || undefined,
      });
      downloadBlobFile(blob, `audit-logs-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to export audit logs PDF.";
      toast({ title: "Export failed", description: message, variant: "destructive" });
    } finally {
      setIsExportingLogsPdf(false);
    }
  };

  if (isAuthzLoading) return <LoadingIndicator label="Checking report access…" />;
  if (showAccessDenied) return <EmptyState title="Access restricted" description="You do not have permission to view reports or audit logs." />;

  return <div className="mx-auto w-full max-w-7xl space-y-5">
    <header className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-tight">Reports & Logs</h1><p className="mt-1 text-sm text-muted-foreground">Review player availability and recorded activity.</p></div>
      {canReadReports && <div><Button variant="outline" size="sm" onClick={() => void handleExportReportPdf()} disabled={isExportingReportPdf}><Download aria-hidden="true" className="mr-2 h-4 w-4" />{isExportingReportPdf ? "Exporting…" : "Export snapshot PDF"}</Button><p className="mt-1 text-xs text-muted-foreground">Current snapshot; independent of the period below.</p></div>}
    </header>
    <Tabs value={activeView} onValueChange={(value) => setView(value as "availability" | "audit")}>
      <TabsList aria-label="Reports sections" className="h-auto w-full justify-start sm:w-auto">
        {canReadReports && <TabsTrigger value="availability">Availability</TabsTrigger>}
        {canReadAuditLogs && <TabsTrigger value="audit">Audit Logs</TabsTrigger>}
      </TabsList>

      {canReadReports && <TabsContent value="availability" className="mt-5 space-y-8">
        <section aria-labelledby="availability-heading" className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="availability-heading" className="text-lg font-semibold">Player availability</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Estimated from server-received heartbeats. A gap after 90 seconds counts as offline; time when the server could not receive heartbeats stays unknown.</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1"><Label htmlFor="availability-period">Period</Label><select id="availability-period" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={availabilityDays} onChange={(event) => setAvailabilityDays(Number(event.target.value))}>
                <option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
              </select></div>
              <Button variant="outline" size="sm" onClick={() => { void availabilityQuery.refetch(); if (canReadProofOfPlay) void popQuery.refetch(); }} disabled={availabilityQuery.isFetching}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh</Button>
            </div>
          </div>
          {availabilityQuery.isLoading ? <LoadingIndicator label="Loading availability…" /> : availabilityQuery.isError && !availability ? <EmptyState title="Could not load availability" description={errorMessage(availabilityQuery.error)} actionLabel="Retry" onAction={() => void availabilityQuery.refetch()} /> : availability && <>
            <div className="grid gap-4 border-y border-border/70 py-4 sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Uptime of known time</p><p className="mt-1 text-2xl font-semibold">{availability.summary.uptime_percent === null ? "No known time" : `${availability.summary.uptime_percent}%`}</p></div>
              <div><p className="text-xs text-muted-foreground">Estimated outage</p><p className="mt-1 text-2xl font-semibold">{formatDuration(availability.summary.estimated_offline_seconds)}</p></div>
              <div><p className="text-xs text-muted-foreground">Unknown time</p><p className="mt-1 text-2xl font-semibold">{formatDuration(availability.summary.unknown_seconds)}</p></div>
            </div>
            <p className="text-xs text-muted-foreground">Fleet totals add time across screens. Unknown time is excluded from uptime percentage. Reporting timezone: {availability.range.timezone}.</p>
            {availabilityQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">Could not refresh availability. Showing the last loaded result. <Button variant="outline" size="sm" onClick={() => void availabilityQuery.refetch()}>Retry</Button></div>}
            {availabilityQuery.isFetching && !availabilityQuery.isLoading && <p className="text-xs text-muted-foreground" aria-live="polite">Updating availability…</p>}
            {availability.screens.length === 0 ? <EmptyState title="No registered screens" description="Availability will appear after screens are registered and begin reporting." /> : <>
              <div className="hidden overflow-x-auto border-y lg:block"><table className="w-full min-w-[780px] text-sm"><thead><tr className="text-left text-muted-foreground"><th className="px-3 py-3 font-medium">Screen</th><th className="px-3 py-3 font-medium">Uptime</th><th className="px-3 py-3 font-medium">Estimated outage</th><th className="px-3 py-3 font-medium">Unknown</th><th className="px-3 py-3 font-medium">Last heartbeat</th></tr></thead><tbody>{availability.screens.map((screen) => <tr key={screen.screen_id} className="border-t"><td className="px-3 py-3 font-medium">{screen.screen_name}</td><td className="px-3 py-3">{screen.never_seen ? "Never seen" : screen.uptime_percent === null ? "No known time" : `${screen.uptime_percent}%`}</td><td className="px-3 py-3">{screen.never_seen ? "—" : formatDuration(screen.estimated_offline_seconds)}</td><td className="px-3 py-3">{formatDuration(screen.unknown_seconds)}</td><td className="px-3 py-3">{screen.last_heartbeat_at ? formatAuditTimestamp(screen.last_heartbeat_at) : "Never seen"}</td></tr>)}</tbody></table></div>
              <div className="space-y-0 border-y lg:hidden">{availability.screens.map((screen) => <article key={screen.screen_id} className="space-y-2 border-b py-4 last:border-0"><h3 className="font-medium">{screen.screen_name}</h3><dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm"><dt className="text-muted-foreground">Uptime</dt><dd>{screen.never_seen ? "Never seen" : screen.uptime_percent === null ? "No known time" : `${screen.uptime_percent}%`}</dd><dt className="text-muted-foreground">Outage</dt><dd>{screen.never_seen ? "—" : formatDuration(screen.estimated_offline_seconds)}</dd><dt className="text-muted-foreground">Unknown</dt><dd>{formatDuration(screen.unknown_seconds)}</dd><dt className="text-muted-foreground">Last heartbeat</dt><dd>{screen.last_heartbeat_at ? formatAuditTimestamp(screen.last_heartbeat_at) : "Never seen"}</dd></dl></article>)}</div>
            </>}
          </>}
        </section>

        {canReadProofOfPlay && <section aria-labelledby="recent-playback-heading" className="space-y-3 border-t border-border/70 pt-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="recent-playback-heading" className="text-lg font-semibold">Recent playback reports</h2><p className="mt-1 text-sm text-muted-foreground">Player reports do not prove what appeared on the physical display.</p></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><Link to="/proof-of-play">View all</Link></Button><Button variant="outline" size="sm" onClick={() => void handleExportCsv()} disabled={isExportingCsv}><Download aria-hidden="true" className="mr-2 h-4 w-4" />{isExportingCsv ? "Exporting…" : "Export CSV"}</Button></div></div>
          {popQuery.isLoading ? <LoadingIndicator label="Loading playback reports…" /> : popQuery.isError && !popQuery.data ? <EmptyState title="Could not load playback reports" description={errorMessage(popQuery.error)} actionLabel="Retry" onAction={() => void popQuery.refetch()} /> : popItems.length === 0 ? <p className="py-5 text-sm text-muted-foreground">No playback reports recorded yet.</p> : <div className="divide-y border-y">{popItems.map((item) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"><div><p className="font-medium">{item.media_name || (item.media_id ? "Media unavailable" : "Media unspecified")} <span className="font-normal text-muted-foreground">on {item.screen_name || "Screen unavailable"}</span></p><p className="mt-1 text-xs text-muted-foreground">{formatAuditTimestamp(item.started_at || item.played_at)}{item.page_number ? ` · Page ${item.page_number}` : ""}</p></div><Badge variant={item.status === "INCOMPLETE" ? "destructive" : "outline"}>{item.status === "COMPLETED" ? "Completed" : item.status === "INCOMPLETE" ? "Incomplete" : "Outcome unknown"}</Badge></div>)}</div>}
          {popQuery.isError && popQuery.data && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">Could not refresh playback reports. Showing the last loaded records. <Button variant="outline" size="sm" onClick={() => void popQuery.refetch()}>Retry</Button></div>}
        </section>}
      </TabsContent>}

      {canReadAuditLogs && <TabsContent value="audit" className="mt-5 space-y-5">
        <section aria-labelledby="audit-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="audit-heading" className="text-lg font-semibold">Audit Logs</h2><p className="mt-1 text-sm text-muted-foreground">Review who changed a resource and when.</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void auditLogsQuery.refetch()} disabled={auditLogsQuery.isFetching}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh</Button><Button variant="outline" size="sm" onClick={() => void handleExportLogsPdf()} disabled={isExportingLogsPdf}><Download aria-hidden="true" className="mr-2 h-4 w-4" />{isExportingLogsPdf ? "Exporting…" : "Logs PDF"}</Button></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="audit-resource">Resource type</Label><Input id="audit-resource" placeholder="e.g. Screen" value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)} /></div><div className="space-y-1"><Label htmlFor="audit-action">Action code (exact match)</Label><Input id="audit-action" placeholder="e.g. SCREEN_UPDATE" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} /></div></div>
          <p className="text-sm text-muted-foreground" aria-live="polite">{auditLogsQuery.isLoading ? "Loading logs…" : `${auditLogsTotal} ${auditLogsTotal === 1 ? "log" : "logs"}`}{auditLogsQuery.isFetching && !auditLogsQuery.isLoading ? " · Updating" : ""}</p>
          {auditLogsQuery.isLoading ? <div className="space-y-3">{auditPlaceholder}</div> : auditLogsQuery.isError && !auditLogsQuery.data ? <EmptyState title="Could not load audit logs" description={errorMessage(auditLogsQuery.error)} actionLabel="Retry" onAction={() => void auditLogsQuery.refetch()} /> : auditLogs.length === 0 ? <EmptyState title="No logs match these filters" description="Try another resource or action." /> : <Accordion type="single" collapsible className="border-t">{auditLogs.map((log) => <AuditLogCard key={log.id} log={log} />)}</Accordion>}
          {auditLogsQuery.isError && auditLogsQuery.data && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">Could not refresh audit logs. Showing the last loaded page. <Button variant="outline" size="sm" onClick={() => void auditLogsQuery.refetch()}>Retry</Button></div>}
          {auditLogs.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Showing {auditLogsRangeStart}–{auditLogsRangeEnd} of {auditLogsTotal}</p><PageNavigation currentPage={auditLogsPage} totalPages={auditLogsTotalPages} onPageChange={setAuditLogsPage} showPageNumbers /></div>}
        </section>
      </TabsContent>}
    </Tabs>
  </div>;
}
