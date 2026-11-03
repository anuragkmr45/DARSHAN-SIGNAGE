import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { liveSessionsApi } from "@/api/domains/liveSessions";
import type { LiveSession } from "@/api/types";
import { queryKeys } from "@/api/queryKeys";
import { PageHeader } from "@/components/common/PageHeader";
import { SearchBar } from "@/components/common/SearchBar";
import { PageNavigation } from "@/components/common/PageNavigation";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { LiveSourceCard } from "@/components/live/LiveSourceCard";
import { LiveSourceErrorNotice, LiveSourceForm } from "@/components/live/LiveSourceForm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { useAppSelector } from "@/store/hooks";
import { liveSourceCreatePayload, liveSourceUpdatePayload, liveSourceError, loadLivePresenters,
  type LiveSourceError, type LiveSourceValues } from "@/lib/liveSources";

type Selection = { id: string; mode: "view" | "edit" | "delete" } | { mode: "create" };
const PAGE_SIZE = 9;

function DeleteLiveSource({ source: initial, pending, allowed, onDelete, onClose, onReload }: {
  source: LiveSession; pending: boolean; allowed: boolean; onDelete: (source: LiveSession) => Promise<void>;
  onClose: (refresh?: boolean) => void; onReload: () => Promise<void>;
}) {
  const [source] = useState(initial), [error, setError] = useState<LiveSourceError | null>(null), [reloading, setReloading] = useState(false);
  const remove = async () => { try { await onDelete(source); } catch (failure) { setError(liveSourceError(failure, "delete")); } };
  const reload = async () => { setReloading(true); try { await onReload(); } catch (failure) { setError(liveSourceError(failure, "load")); } finally { setReloading(false); } };
  return <div className="space-y-4"><p className="break-words text-sm">Delete “{source.name}” from the source library?</p>
    <p className="text-sm text-muted-foreground">Remove editable and current/future schedule references first. Historical published policies are retained.</p>
    {!allowed && <p className="text-sm text-destructive">Your current access does not allow deleting this source.</p>}
    {error && <LiveSourceErrorNotice error={error} />}
    {error && !error.uncertain && <Button variant="outline" onClick={() => void reload()} disabled={pending || reloading}>{reloading ? "Reloading…" : "Reload latest source"}</Button>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => onClose(Boolean(error?.uncertain))} disabled={pending}>{error?.uncertain ? "Close and refresh list" : "Cancel"}</Button>
      <Button variant="destructive" onClick={() => void remove()} disabled={!allowed || pending || reloading || Boolean(error?.stale || error?.uncertain || error?.blockers.length)}>
        {pending ? "Deleting…" : "Delete live source"}</Button></div>
  </div>;
}

export default function LiveBroadcasts() {
  const { can } = useAuthorization(), actor = useAppSelector(state => state.auth.user), { toast } = useToast();
  const queryClient = useQueryClient();
  const canRead = can("read", "LiveBroadcast"), canCreate = can("create", "LiveBroadcast"), canUpdate = can("update", "LiveBroadcast"), canDelete = can("delete", "LiveBroadcast");
  const canReadDirectory = can("read", "User");
  const [search, setSearch] = useState(""), [page, setPage] = useState(1), [activeOnly, setActiveOnly] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null), [formVersion, setFormVersion] = useState(0);
  const params = { actorId: actor?.id, page, limit: PAGE_SIZE, search, activeOnly };
  const list = useQuery({ queryKey: queryKeys.liveSessionsList(params),
    queryFn: () => liveSessionsApi.list({ page, limit: PAGE_SIZE, search: search || undefined, active_only: activeOnly || undefined }),
    enabled: canRead, retry: false, staleTime: 0, refetchOnWindowFocus: true, placeholderData: previous => previous });
  const selectedId = selection && "id" in selection ? selection.id : undefined;
  const detail = useQuery({ queryKey: queryKeys.liveSession(selectedId, actor?.id), queryFn: () => liveSessionsApi.getById(selectedId!),
    enabled: Boolean(selectedId && canRead), retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const presenters = useQuery({ queryKey: queryKeys.livePresenters(actor?.id), queryFn: loadLivePresenters,
    enabled: Boolean(selection && selection.mode !== "view" && selection.mode !== "delete" && canReadDirectory),
    retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const sources = useMemo(() => list.data?.items ?? [], [list.data]);
  const totalPages = Math.max(1, list.data?.pagination.pages ?? 1);
  useEffect(() => { if (list.data && !list.isPlaceholderData && page > totalPages) setPage(totalPages); }, [list.data, list.isPlaceholderData, page, totalPages]);
  const handleSearch = useCallback((value: string) => { setSearch(value); setPage(1); }, []);
  const refresh = () => { if (canRead) void list.refetch(); };
  const close = (refreshList = false) => { setSelection(null); if (refreshList) refresh(); };
  const saved = (source: LiveSession) => {
    queryClient.setQueryData(queryKeys.liveSession(source.id, actor?.id), source);
    void queryClient.invalidateQueries({ queryKey: queryKeys.liveSessions });
    setSelection(null); toast({ title: "Live source saved", description: source.name });
  };
  const save = useMutation({ retry: false, mutationFn: ({ values, baseline }: { values: LiveSourceValues; baseline: LiveSession | null }) =>
    baseline ? liveSessionsApi.update(baseline.id, liveSourceUpdatePayload(baseline, values)) : liveSessionsApi.create(liveSourceCreatePayload(values)), onSuccess: saved });
  const remove = useMutation({ retry: false, mutationFn: (source: LiveSession) => liveSessionsApi.remove(source.id, source.revision), onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.liveSessions }); setSelection(null); toast({ title: "Live source deleted" });
  } });
  const pending = save.isPending || remove.isPending;
  const open = (value: Selection) => {
    // Opening a new dialog starts from an authoritative read, rather than
    // briefly mounting an editable form from a previous dialog's cached row.
    if ("id" in value) queryClient.removeQueries({ queryKey: queryKeys.liveSession(value.id, actor?.id), exact: true });
    setFormVersion(0); setSelection(value);
  };
  const reload = async () => { const result = await detail.refetch(); if (result.isError) throw result.error; setFormVersion(value => value + 1); };
  const source = detail.data;
  const editable = selection?.mode === "create" ? canCreate : selection?.mode === "edit" && canUpdate && source?.permissions?.can_update === true;
  return <div className="space-y-6"><PageHeader title="Live broadcasts" description="Prepare reusable live sources, presenters and audio permissions for scheduled broadcasts."
    actionLabel={canCreate ? "New live source" : undefined} actionIcon={<Plus className="h-4 w-4" />} onAction={canCreate ? () => open({ mode: "create" }) : undefined}
    trailingContent={canRead ? <Button variant="outline" onClick={refresh} disabled={list.isFetching} aria-label="Refresh live sources"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button> : undefined} />
    {canRead ? <><div className="flex flex-wrap items-center gap-4"><div className="w-full sm:max-w-sm"><SearchBar placeholder="Search live sources…" initialValue={search} onSearch={handleSearch} /></div>
      <Label className="flex items-center gap-2"><input type="checkbox" checked={activeOnly} onChange={event => { setActiveOnly(event.target.checked); setPage(1); }} />Enabled sources only</Label>
      <span className="text-sm text-muted-foreground" role="status">{list.isFetching ? "Refreshing…" : `${list.data?.pagination.total ?? 0} sources`}</span></div>
      {list.isError && <LiveSourceErrorNotice error={liveSourceError(list.error, "load")} />}
      {list.isLoading ? <LoadingIndicator label="Loading live sources…" /> : sources.length ? <>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sources.map(item => <LiveSourceCard key={item.id} source={item} actorId={actor?.id} canUpdate={canUpdate} canDelete={canDelete}
          onView={() => open({ id: item.id, mode: "view" })} onEdit={() => open({ id: item.id, mode: "edit" })} onDelete={() => open({ id: item.id, mode: "delete" })} />)}</div>
        <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} /></>
        : !list.isError && <EmptyState title="No live sources found" description={canCreate ? "Create a source or adjust your filters." : "Adjust your filters or ask an authorized author to create a source."} />}
    </> : <p className="rounded-lg border p-4 text-sm text-muted-foreground">Your access allows creating a source but does not allow listing existing sources.</p>}
    <Dialog open={Boolean(selection)} onOpenChange={value => { if (!value && !pending) close(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader>
        <DialogTitle>{selection?.mode === "create" ? "Create live source" : selection?.mode === "delete" ? "Delete live source" : selection?.mode === "edit" ? "Edit live source" : "Live source details"}</DialogTitle>
        <DialogDescription>Manage the source's presenter and permitted capture options.</DialogDescription></DialogHeader>
        {selection?.mode === "create" ? <LiveSourceForm key={`create:${formVersion}`} source={null} actor={actor} editable={canCreate} pending={pending} canReadDirectory={canReadDirectory}
          presenters={presenters.data ?? []} directoryLoading={presenters.isFetching} directoryFailed={presenters.isError} onRefreshDirectory={() => void presenters.refetch()}
          onSubmit={async (values, baseline) => { await save.mutateAsync({ values, baseline }); }} onClose={close} />
          : detail.isLoading || (!source && detail.isFetching) ? <LoadingIndicator label="Loading current live source…" /> : detail.isError && !source ? <div className="space-y-3"><LiveSourceErrorNotice error={liveSourceError(detail.error, "load")} />
            <Button variant="outline" onClick={() => void detail.refetch()}>Retry loading source</Button></div>
          : source && selection?.mode === "delete" ? <DeleteLiveSource key={`delete:${source.id}:${formVersion}`} source={source} pending={pending} allowed={canDelete && source.permissions?.can_delete === true}
            onDelete={async value => { await remove.mutateAsync(value); }} onClose={close} onReload={reload} />
          : source && <LiveSourceForm key={`${source.id}:${formVersion}`} source={source} actor={actor} editable={Boolean(editable)} viewOnly={selection?.mode === "view"} pending={pending} canReadDirectory={canReadDirectory}
            presenters={presenters.data ?? []} directoryLoading={presenters.isFetching} directoryFailed={presenters.isError} onRefreshDirectory={() => void presenters.refetch()}
            onSubmit={async (values, baseline) => { await save.mutateAsync({ values, baseline }); }} onClose={close} onReload={reload} />}
      </DialogContent>
    </Dialog>
  </div>;
}
