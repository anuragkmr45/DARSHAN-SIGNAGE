import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, formatDistanceToNow } from "date-fns";
import { CalendarRange, Clock3, Layers3, Monitor, Presentation, ScreenShare, Users } from "lucide-react";
import { reportsApi } from "@/api/domains/reports";
import type { ScheduleReportEntry, ScheduleReportGroup } from "@/api/types";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface ScheduleReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type RangePreset = "1" | "7" | "custom";

const clampDays = (value: number) => Math.min(365, Math.max(1, Math.floor(value)));

const formatTimestamp = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "dd MMM yyyy, HH:mm");
};

const formatRelativeTime = (value?: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return formatDistanceToNow(date, { addSuffix: true });
};

function TargetReportSection({
  title,
  icon: Icon,
  reports,
  emptyMessage,
}: {
  title: string;
  icon: typeof Monitor;
  reports: ScheduleReportGroup[];
  emptyMessage: string;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-base font-semibold">{title}</h3>
        <Badge variant="outline">{reports.length}</Badge>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">{emptyMessage}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {reports.map((report) => (
            <Card key={`${report.target_type}-${report.target_id}`}>
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{report.target_name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {report.entries.length} schedule event{report.entries.length === 1 ? "" : "s"} in the selected range
                    </p>
                  </div>
                  <Badge variant="secondary">Latest {formatRelativeTime(report.latest_activity_at)}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[260px] pr-4">
                  <div className="space-y-3">
                    {report.entries.map((entry) => (
                      <ReportEntryCard key={`${entry.publish_id}-${entry.target_id}`} entry={entry} />
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function ReportEntryCard({ entry }: { entry: ScheduleReportEntry }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{entry.schedule_name}</span>
        <Badge variant="outline">{entry.lifecycle_status}</Badge>
        <Badge
          variant={
            entry.target_status === "SUCCESS"
              ? "default"
              : entry.target_status === "FAILED"
                ? "destructive"
                : "secondary"
          }
        >
          Target {entry.target_status}
        </Badge>
      </div>
      <div className="mt-2 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
        <div>
          <span className="font-medium text-foreground">Window:</span>{" "}
          {formatTimestamp(entry.schedule_start_at)} to {formatTimestamp(entry.schedule_end_at)}
        </div>
        <div>
          <span className="font-medium text-foreground">Published:</span>{" "}
          {formatTimestamp(entry.published_at)}
        </div>
        <div>
          <span className="font-medium text-foreground">Taken down:</span>{" "}
          {formatTimestamp(entry.taken_down_at)}
        </div>
        <div>
          <span className="font-medium text-foreground">Publish ID:</span> {entry.publish_id}
        </div>
      </div>
      {entry.target_error ? (
        <div className="mt-2 rounded-md bg-destructive/5 p-2 text-sm text-destructive">
          {entry.target_error}
        </div>
      ) : null}
    </div>
  );
}

export function ScheduleReportModal({ open, onOpenChange }: ScheduleReportModalProps) {
  const [rangePreset, setRangePreset] = useState<RangePreset>("1");
  const [customDays, setCustomDays] = useState("14");

  const days = useMemo(
    () => (rangePreset === "custom" ? clampDays(Number(customDays) || 14) : Number(rangePreset)),
    [customDays, rangePreset],
  );

  const reportQuery = useQuery({
    queryKey: ["dashboard", "schedule-report", days],
    enabled: open,
    staleTime: 60_000,
    queryFn: () => reportsApi.getScheduleActivity({ days }),
  });

  const rangeEnd = useMemo(
    () => (reportQuery.data?.range_end ? new Date(reportQuery.data.range_end) : new Date()),
    [reportQuery.data?.range_end],
  );
  const rangeStart = useMemo(
    () => (reportQuery.data?.range_start ? new Date(reportQuery.data.range_start) : addDays(rangeEnd, -days)),
    [days, rangeEnd, reportQuery.data?.range_start],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-7xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Report</DialogTitle>
          <DialogDescription>
            Schedule activity grouped by screen and screen group for the selected reporting window.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 md:grid-cols-[180px_180px_1fr]">
          <div className="space-y-2">
            <label className="text-sm font-medium">Range</label>
            <Select value={rangePreset} onValueChange={(value) => setRangePreset(value as RangePreset)}>
              <SelectTrigger>
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Past 1 day</SelectItem>
                <SelectItem value="7">Past 1 week</SelectItem>
                <SelectItem value="custom">Custom days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Custom days</label>
            <Input
              type="number"
              min={1}
              max={365}
              value={customDays}
              disabled={rangePreset !== "custom"}
              onChange={(event) => setCustomDays(event.target.value)}
            />
          </div>

          <div className="flex items-end text-sm text-muted-foreground">
            Reporting window: {format(rangeStart, "dd MMM yyyy, HH:mm")} to {format(rangeEnd, "dd MMM yyyy, HH:mm")}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Presentation className="h-4 w-4" />
                Schedules
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {reportQuery.isLoading ? "…" : reportQuery.data?.summary.schedules ?? 0}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Layers3 className="h-4 w-4" />
                Target events
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {reportQuery.isLoading ? "…" : reportQuery.data?.summary.target_events ?? 0}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <ScreenShare className="h-4 w-4" />
                Successful targets
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {reportQuery.isLoading ? "…" : reportQuery.data?.summary.successful_targets ?? 0}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Clock3 className="h-4 w-4" />
                Failed targets
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {reportQuery.isLoading ? "…" : reportQuery.data?.summary.failed_targets ?? 0}
            </CardContent>
          </Card>
        </div>

        {reportQuery.isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="space-y-3 p-4">
                  <Skeleton className="h-5 w-56" />
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : reportQuery.isError ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Unable to build the schedule report right now.
            </CardContent>
          </Card>
        ) : (reportQuery.data?.summary.target_events ?? 0) === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No schedule publish activity matched the selected reporting window.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <TargetReportSection
              title="By Screen"
              icon={Monitor}
              reports={reportQuery.data?.by_screen ?? []}
              emptyMessage="No screen-targeted schedule activity was found for the selected range."
            />
            <TargetReportSection
              title="By Screen Group"
              icon={Users}
              reports={reportQuery.data?.by_group ?? []}
              emptyMessage="No group-targeted schedule activity was found for the selected range."
            />

            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarRange className="h-4 w-4" />
                  Report coverage
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                <div>Current report includes publish lifecycle, target delivery status, schedule window, and takedown timing.</div>
                <div>Next useful report expansions are proof-of-play compliance, publish-to-play latency, target failure reasons, and heartbeat freshness during active windows.</div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
