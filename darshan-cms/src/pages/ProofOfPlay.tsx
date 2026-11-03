import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { proofOfPlayApi } from "@/api/domains/proofOfPlay";
import { ApiError } from "@/api/apiClient";
import type { ProofOfPlay } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { PageNavigation } from "@/components/common/PageNavigation";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 50;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localDayBoundary = (value: string, end: boolean) =>
  value ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}`).toISOString() : undefined;
const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
};
const outcomeLabel = (item: ProofOfPlay) =>
  item.status === "COMPLETED" ? "Completed" : item.status === "INCOMPLETE" ? "Incomplete" : "Outcome unknown";
const identityLabel = (name: string | null | undefined, id: string | null | undefined, fallback: string) =>
  name || (id ? fallback : "—");

function downloadBlobFile(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

const ProofOfPlay = () => {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [screenId, setScreenId] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [status, setStatus] = useState<"ALL" | "COMPLETED" | "INCOMPLETE" | "UNKNOWN">("ALL");
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const invalidScreenId = Boolean(screenId.trim() && !uuidPattern.test(screenId.trim()));
  const invalidMediaId = Boolean(mediaId.trim() && !uuidPattern.test(mediaId.trim()));
  const validFilters = !invalidRange && !invalidScreenId && !invalidMediaId;

  const filters = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    screen_id: screenId.trim() || undefined,
    media_id: mediaId.trim() || undefined,
    start: localDayBoundary(dateFrom, false),
    end: localDayBoundary(dateTo, true),
    status: status === "ALL" ? undefined : status,
  }), [page, dateFrom, dateTo, screenId, mediaId, status]);
  const query = useQuery({
    queryKey: ["proof-of-play", filters],
    queryFn: () => proofOfPlayApi.list(filters),
    enabled: validFilters,
    staleTime: 30_000,
  });
  const items = query.data?.items ?? [];
  const total = query.data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const changeDateFrom = (value: string) => { setDateFrom(value); setPage(1); };
  const changeDateTo = (value: string) => { setDateTo(value); setPage(1); };
  const changeScreen = (value: string) => { setScreenId(value); setPage(1); };
  const changeMedia = (value: string) => { setMediaId(value); setPage(1); };
  const changeStatus = (value: typeof status) => { setStatus(value); setPage(1); };
  const exportCsv = async () => {
    if (!validFilters) return;
    try {
      setIsExporting(true);
      const csv = await proofOfPlayApi.export(filters);
      downloadBlobFile(new Blob([csv], { type: "text/csv;charset=utf-8" }), `proof-of-play-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (failure) {
      toast({
        title: "Could not export records",
        description: failure instanceof ApiError ? failure.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return <div className="mx-auto w-full max-w-7xl space-y-5">
    <header className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-tight">Proof of Play</h1><p className="mt-1 text-sm text-muted-foreground">Player-reported playback records.</p></div>
      <Button variant="outline" onClick={() => void exportCsv()} disabled={isExporting || !validFilters}><Download aria-hidden="true" className="mr-2 h-4 w-4" />{isExporting ? "Exporting…" : "Export CSV"}</Button>
    </header>
    <p className="text-sm leading-6 text-muted-foreground">These records show what a player reported. They do not prove what a person saw on the display. Older records without a stored completion flag show “Outcome unknown.” Screen and Media names are current names and may have changed since playback.</p>

    <section aria-label="Filter playback records" className="space-y-4 border-b border-border/70 pb-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="pop-from">Received from</Label><Input id="pop-from" type="date" value={dateFrom} onChange={(event) => changeDateFrom(event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pop-to">Received to</Label><Input id="pop-to" type="date" value={dateTo} onChange={(event) => changeDateTo(event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pop-status">Playback outcome</Label><Select value={status} onValueChange={(value) => changeStatus(value as typeof status)}><SelectTrigger id="pop-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All outcomes</SelectItem><SelectItem value="COMPLETED">Completed</SelectItem><SelectItem value="INCOMPLETE">Incomplete</SelectItem><SelectItem value="UNKNOWN">Outcome unknown</SelectItem></SelectContent></Select></div>
      </div>
      <details className="group text-sm">
        <summary className="cursor-pointer font-medium text-foreground">More filters: Screen and Media IDs</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="pop-screen">Screen ID</Label><Input id="pop-screen" value={screenId} onChange={(event) => changeScreen(event.target.value)} placeholder="Paste a Screen ID" autoComplete="off" /></div>
          <div className="space-y-1.5"><Label htmlFor="pop-media">Media ID</Label><Input id="pop-media" value={mediaId} onChange={(event) => changeMedia(event.target.value)} placeholder="Paste a Media ID" autoComplete="off" /></div>
        </div>
      </details>
      {!validFilters && <p role="alert" className="text-sm text-destructive">{invalidRange ? "The start date must be on or before the end date." : "Screen and Media IDs must be complete UUIDs."}</p>}
    </section>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {query.isLoading ? "Loading records…" : validFilters ? `${total} ${total === 1 ? "record" : "records"} · showing ${items.length} on this page` : "Correct the filters to load records"}
        {query.isFetching && !query.isLoading ? " · Updating" : ""}
      </p>
      <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching || !validFilters}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
    {!validFilters ? null : query.isLoading ? <LoadingIndicator label="Loading proof-of-play records…" /> : query.isError && !query.data ? (
      <EmptyState title="Unable to load proof-of-play records" description={query.error instanceof Error ? query.error.message : "Please try again."} actionLabel="Retry" onAction={() => void query.refetch()} />
    ) : items.length === 0 ? (
      <EmptyState title="No records match these filters" description="Change the dates or outcome to look for another playback report." />
    ) : <>
      <div className="hidden overflow-x-auto rounded-xl border lg:block">
        <Table className="min-w-[780px]"><TableHeader><TableRow><TableHead>Screen</TableHead><TableHead>Media</TableHead><TableHead>Page</TableHead><TableHead>Started</TableHead><TableHead>Ended</TableHead><TableHead>Outcome</TableHead></TableRow></TableHeader><TableBody>
          {items.map((item) => <TableRow key={item.id}>
            <TableCell className="max-w-[11rem]"><span className="font-medium">{identityLabel(item.screen_name, item.screen_id, "Screen unavailable")}</span><span className="block break-all font-mono text-xs text-muted-foreground">{item.screen_id}</span></TableCell>
            <TableCell className="max-w-[11rem]"><span className="font-medium">{identityLabel(item.media_name, item.media_id, "Media unavailable")}</span>{item.media_id && <span className="block break-all font-mono text-xs text-muted-foreground">{item.media_id}</span>}</TableCell>
            <TableCell>{item.page_number ?? "—"}</TableCell>
            <TableCell className="text-sm">{formatDateTime(item.started_at || item.played_at)}</TableCell>
            <TableCell className="text-sm">{formatDateTime(item.ended_at)}</TableCell>
            <TableCell><Badge variant={item.status === "INCOMPLETE" ? "destructive" : "outline"}>{outcomeLabel(item)}</Badge></TableCell>
          </TableRow>)}
        </TableBody></Table>
      </div>
      <div className="space-y-3 lg:hidden">{items.map((item) => <article key={item.id} className="space-y-2 rounded-xl border p-4" aria-label={`Playback record ${item.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">Playback report</h2><Badge variant={item.status === "INCOMPLETE" ? "destructive" : "outline"}>{outcomeLabel(item)}</Badge></div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"><dt className="text-muted-foreground">Screen</dt><dd><span className="font-medium">{identityLabel(item.screen_name, item.screen_id, "Screen unavailable")}</span><span className="block break-all font-mono text-xs text-muted-foreground">{item.screen_id}</span></dd><dt className="text-muted-foreground">Media</dt><dd><span className="font-medium">{identityLabel(item.media_name, item.media_id, "Media unavailable")}</span>{item.media_id && <span className="block break-all font-mono text-xs text-muted-foreground">{item.media_id}</span>}</dd><dt className="text-muted-foreground">Page</dt><dd>{item.page_number ?? "—"}</dd><dt className="text-muted-foreground">Started</dt><dd>{formatDateTime(item.started_at || item.played_at)}</dd><dt className="text-muted-foreground">Ended</dt><dd>{formatDateTime(item.ended_at)}</dd></dl>
      </article>)}</div>
    </>}
    {query.isError && query.data && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><span>Could not refresh records. Showing the last loaded page.</span><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button></div>}
    {validFilters && query.data && total > PAGE_SIZE && <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} className="justify-end" />}
  </div>;
};

export default ProofOfPlay;
