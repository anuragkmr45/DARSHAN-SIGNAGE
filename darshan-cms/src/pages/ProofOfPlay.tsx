import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileBarChart, Filter, Monitor, CheckCircle2 } from "lucide-react";
import { proofOfPlayApi } from "@/api/domains/proofOfPlay";
import { ApiError } from "@/api/apiClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

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

const toStartOfDayIso = (value: string) => (value ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined);
const toEndOfDayIso = (value: string) => (value ? new Date(`${value}T23:59:59.999Z`).toISOString() : undefined);

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const ProofOfPlay = () => {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [screenId, setScreenId] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [status, setStatus] = useState<"ALL" | "COMPLETED" | "INCOMPLETE">("ALL");
  const [isExporting, setIsExporting] = useState(false);

  const filters = useMemo(
    () => ({
      page: 1,
      limit: 50,
      screen_id: screenId.trim() || undefined,
      media_id: mediaId.trim() || undefined,
      start: toStartOfDayIso(dateFrom),
      end: toEndOfDayIso(dateTo),
      status: status === "ALL" ? undefined : status,
    }),
    [dateFrom, dateTo, screenId, mediaId, status],
  );

  const query = useQuery({
    queryKey: ["proof-of-play", filters],
    queryFn: () => proofOfPlayApi.list(filters),
    staleTime: 30_000,
  });

  const items = query.data?.items ?? [];
  const totalPlays = items.length;
  const completedPlays = items.filter((item) => item.status === "COMPLETED").length;
  const uniqueScreens = new Set(items.map((item) => item.screen_id)).size;

  const handleExportCsv = async () => {
    try {
      setIsExporting(true);
      const csv = await proofOfPlayApi.export(filters);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      downloadBlobFile(blob, `proof-of-play-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to export proof-of-play CSV.";
      toast({
        title: "Export failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Proof of Play</h1>
          <p className="text-muted-foreground">Live playback records reported by devices.</p>
        </div>
        <Button onClick={handleExportCsv} disabled={isExporting}>
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? "Exporting..." : "Export CSV"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Plays</CardTitle>
          </CardHeader>
          <CardContent>
            {query.isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{totalPlays}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            {query.isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{completedPlays}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Screens</CardTitle>
          </CardHeader>
          <CardContent>
            {query.isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{uniqueScreens}</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
          <CardDescription>Filter live playback events by date, screen, media, or completion state.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="date-from">Date From</Label>
              <Input id="date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date-to">Date To</Label>
              <Input id="date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="screen-id">Screen ID</Label>
              <Input
                id="screen-id"
                placeholder="Filter by screen id"
                value={screenId}
                onChange={(e) => setScreenId(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="media-id">Media ID</Label>
              <Input
                id="media-id"
                placeholder="Filter by media id"
                value={mediaId}
                onChange={(e) => setMediaId(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="INCOMPLETE">Incomplete</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileBarChart className="h-5 w-5" />
            Playback Logs
          </CardTitle>
          <CardDescription>Most recent proof-of-play events for the active filter set.</CardDescription>
        </CardHeader>
        <CardContent>
          {query.isError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              {query.error instanceof ApiError ? query.error.message : "Unable to load proof-of-play records."}
            </div>
          )}

          {query.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, idx) => (
                <Skeleton key={idx} className="h-10" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No proof-of-play records found.</div>
          ) : (
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Screen</TableHead>
                  <TableHead>Media</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Ended</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4 text-muted-foreground" />
                        {item.screen_id}
                      </div>
                    </TableCell>
                    <TableCell>{item.media_id}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(item.started_at || item.played_at)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDateTime(item.ended_at)}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === "COMPLETED" ? "default" : "secondary"}>
                        {item.status === "COMPLETED" ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Completed
                          </span>
                        ) : (
                          "Incomplete"
                        )}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProofOfPlay;
