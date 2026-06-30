import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, TrendingUp, Activity, Monitor, AlertTriangle, Bell, Shield, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { reportsApi } from "@/api/domains/reports";
import { proofOfPlayApi } from "@/api/domains/proofOfPlay";
import { auditLogsApi } from "@/api/domains/auditLogs";
import { notificationsApi } from "@/api/domains/notifications";
import { emergencyApi } from "@/api/domains/emergency";
import { ApiError } from "@/api/apiClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuthorization } from "@/hooks/useAuthorization";
import type { AuditLog, ProofOfPlayListResponse } from "@/api/types";
import { PageNavigation } from "@/components/common/PageNavigation";

const AUDIT_LOGS_PAGE_SIZE = 5;

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

function AuditLogCard({ log }: { log: AuditLog }) {
  const actorName = [log.user?.first_name, log.user?.last_name].filter(Boolean).join(" ").trim();
  const actorLabel = actorName || log.user?.email || log.user_id || "system";
  const changesValue =
    log.changes && Object.keys(log.changes).length > 0 ? JSON.stringify(log.changes, null, 2) : "—";

  const detailFields = [
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
    <AccordionItem value={log.id} className="rounded-lg border bg-card px-4">
      <AccordionTrigger className="py-4 hover:no-underline">
        <div className="flex flex-1 flex-wrap items-start justify-between gap-3 pr-4 text-left">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{log.action ?? "ACTION"}</Badge>
              <Badge variant="outline">{formatAuditField(log.resource_type)}</Badge>
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
              <div key={field.label} className="rounded-md border bg-muted/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{field.label}</p>
                <p className={field.mono ? "mt-1 break-all font-mono text-xs" : "mt-1 text-sm"}>
                  {formatAuditField(field.value)}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">User details</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {actorFields.map((field) => (
                <div key={field.label}>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{field.label}</p>
                  <p className={field.mono ? "mt-1 break-all font-mono text-xs" : "mt-1 text-sm"}>
                    {formatAuditField(field.value)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Changes</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-background px-3 py-2 font-mono text-xs">
              {changesValue}
            </pre>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export default function Reports() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [resourceFilter, setResourceFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [auditLogsPage, setAuditLogsPage] = useState(1);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingReportPdf, setIsExportingReportPdf] = useState(false);
  const [isExportingLogsPdf, setIsExportingLogsPdf] = useState(false);
  const debouncedResource = useDebounce(resourceFilter, 400);
  const debouncedAction = useDebounce(actionFilter, 400);
  const { can, isLoading: isAuthzLoading } = useAuthorization();

  const canReadReports = can("read", "Report");
  const canReadAuditLogs = can("read", "AuditLog");

  const summaryQuery = useQuery({
    queryKey: ["reports-summary"],
    queryFn: reportsApi.getSummary,
    enabled: canReadReports,
  });

  const popQuery = useQuery({
    queryKey: ["pop-list"],
    queryFn: () => proofOfPlayApi.list({ limit: 10, page: 1 }),
    enabled: canReadReports,
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

  const notificationsQuery = useQuery({
    queryKey: ["notifications", "latest"],
    queryFn: () => notificationsApi.list({ page: 1, limit: 5 }),
    enabled: canReadReports,
  });

  const emergencyQuery = useQuery({
    queryKey: ["emergency-status"],
    queryFn: emergencyApi.status,
    refetchInterval: 30_000,
    enabled: canReadReports,
  });

  useEffect(() => {
    const err =
      (canReadReports && (summaryQuery.error || popQuery.error || notificationsQuery.error || emergencyQuery.error)) ||
      (canReadAuditLogs && auditLogsQuery.error);
    if (err) {
      const message = err instanceof ApiError ? err.message : "Unable to load reports.";
      toast({ title: "Load failed", description: message, variant: "destructive" });
    }
  }, [
    canReadReports,
    canReadAuditLogs,
    summaryQuery.error,
    popQuery.error,
    auditLogsQuery.error,
    notificationsQuery.error,
    emergencyQuery.error,
    toast,
  ]);

  const summary = summaryQuery.data;
  const popItems = (popQuery.data as ProofOfPlayListResponse | undefined)?.items ?? [];
  const auditLogs = auditLogsQuery.data?.items ?? [];
  const auditLogsTotal = auditLogsQuery.data?.total ?? 0;
  const auditLogsTotalPages = Math.max(
    1,
    Math.ceil(auditLogsTotal / AUDIT_LOGS_PAGE_SIZE),
  );
  const auditLogsRangeStart = auditLogs.length === 0 ? 0 : (auditLogsPage - 1) * AUDIT_LOGS_PAGE_SIZE + 1;
  const auditLogsRangeEnd = auditLogs.length === 0 ? 0 : auditLogsRangeStart + auditLogs.length - 1;
  const notifications = notificationsQuery.data?.items ?? [];
  const emergencyStatus = emergencyQuery.data;

  const showAccessDenied = !isAuthzLoading && !canReadReports && !canReadAuditLogs;

  const auditPlaceholder = useMemo(
    () =>
      Array.from({ length: 5 }).map((_, idx) => (
        <div key={idx} className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-28 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-44" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
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
        resource_type: debouncedResource || undefined,
        action: debouncedAction || undefined,
      });
      downloadBlobFile(blob, `audit-logs-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to export audit logs PDF.";
      toast({ title: "Export failed", description: message, variant: "destructive" });
    } finally {
      setIsExportingLogsPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports & Logs</h1>
          <p className="text-muted-foreground">View KPIs and recent proof-of-play records.</p>
        </div>
        {canReadReports && (
          <div className="flex gap-2">
            <Button onClick={handleExportReportPdf} disabled={isExportingReportPdf}>
              <Download className="mr-2 h-4 w-4" />
              {isExportingReportPdf ? "Exporting..." : "Report PDF"}
            </Button>
          </div>
        )}
      </div>

      {showAccessDenied && (
        <Card>
          <CardHeader>
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>You do not have permission to view reports or audit logs.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {canReadAuditLogs && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Audit Logs
                </CardTitle>
                <CardDescription>Filter by resource or action to reduce noise.</CardDescription>
              </div>
              <Button variant="outline" onClick={handleExportLogsPdf} disabled={isExportingLogsPdf}>
                <Download className="mr-2 h-4 w-4" />
                {isExportingLogsPdf ? "Exporting..." : "Logs PDF"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <Input
                placeholder="Filter by resource type (e.g., screen, schedule)"
                className="max-w-xs"
                value={resourceFilter}
                onChange={(e) => setResourceFilter(e.target.value)}
              />
              <Input
                placeholder="Filter by action (e.g., UPDATE, DELETE)"
                className="max-w-xs"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              />
            </div>
            <div className="space-y-3">
              {auditLogsQuery.isLoading
                ? auditPlaceholder
                : (
                    <Accordion type="single" collapsible className="space-y-3">
                      {auditLogs.map((log) => (
                        <AuditLogCard key={log.id} log={log} />
                      ))}
                    </Accordion>
                  )}
              {!auditLogsQuery.isLoading && auditLogs.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">No logs found.</div>
              )}
            </div>
            {!auditLogsQuery.isLoading && auditLogs.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-sm text-muted-foreground">
                  Showing {auditLogsRangeStart}-{auditLogsRangeEnd} of {auditLogsTotal} logs
                </p>
                <PageNavigation
                  currentPage={auditLogsPage}
                  totalPages={auditLogsTotalPages}
                  onPageChange={setAuditLogsPage}
                  showPageNumbers
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canReadReports && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Latest Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {notificationsQuery.isLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-32" />
                </div>
              )}
              {!notificationsQuery.isLoading && notifications.length === 0 && (
                <p className="text-sm text-muted-foreground">No notifications yet.</p>
              )}
              {notifications.map((n) => (
                <div key={n.id} className="flex items-start justify-between rounded-md border p-3">
                  <div>
                    <p className="font-medium text-sm">{n.title ?? "Notification"}</p>
                    <p className="text-xs text-muted-foreground mt-1">{n.body ?? ""}</p>
                  </div>
                  {!n.read && <Badge variant="secondary">New</Badge>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Emergency Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {emergencyQuery.isLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-lg font-semibold">
                      {emergencyStatus?.active ? "ACTIVE" : "CLEAR"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {emergencyStatus?.active
                        ? `${emergencyStatus.active_count ?? emergencyStatus.active_emergencies?.length ?? 1} active emergency${(emergencyStatus.active_count ?? emergencyStatus.active_emergencies?.length ?? 1) > 1 ? "ies" : ""}`
                        : "No active incident"}
                    </p>
                    {emergencyStatus?.emergency?.message && (
                      <p className="text-xs text-muted-foreground">
                        {emergencyStatus.emergency.severity}: {emergencyStatus.emergency.message}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/schedule")}
                  >
                    Manage
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {canReadReports && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Media</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {summaryQuery.isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <div className="text-2xl font-bold">{summary?.media_total ?? 0}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Open Requests</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {summaryQuery.isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <div className="text-2xl font-bold">{summary?.requests_open ?? 0}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Screens</CardTitle>
                <Monitor className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {summaryQuery.isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <div className="text-2xl font-bold">{summary?.screens_active ?? 0}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed Requests</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {summaryQuery.isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <div className="text-2xl font-bold">{summary?.requests_completed ?? 0}</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Recent Proof-of-Play</CardTitle>
                  <CardDescription>Latest playbacks reported by devices.</CardDescription>
                </div>
                <Button variant="outline" onClick={handleExportCsv} disabled={isExportingCsv}>
                  <Download className="mr-2 h-4 w-4" />
                  {isExportingCsv ? "Exporting..." : "Export CSV"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {popQuery.isLoading ? (
                Array.from({ length: 6 }).map((_, idx) => <Skeleton key={idx} className="h-10" />)
              ) : popItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No proof-of-play events recorded yet.</p>
              ) : (
                popItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0 text-sm"
                  >
                    <div>
                      <div className="font-semibold">Media: {item.media_id}</div>
                      <div className="text-muted-foreground text-xs">
                        Screen: {item.screen_id} · {new Date(item.played_at || item.created_at || "").toLocaleString()}
                      </div>
                    </div>
                    <Badge variant="outline">Played</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
