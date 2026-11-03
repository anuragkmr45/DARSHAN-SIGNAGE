import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { screensApi } from "@/api/domains/screens";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Keep selections across pages; a 250-screen fleet must not be truncated to
 * the first 100 rows. Concrete group expansion is rechecked by server review. */
export function LiveTargetPicker({ actorId, screenIds, groupIds, onChange, disabled = false, canReadGroups = false }: {
  actorId: string; screenIds: string[]; groupIds: string[]; onChange: (screens: string[], groups: string[]) => void;
  disabled?: boolean; canReadGroups?: boolean;
}) {
  const [kind, setKind] = useState<"screens" | "groups">("screens"), [page, setPage] = useState(1), [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["live-authoring-targets", actorId, kind, page, search], retry: false,
    queryFn: () => kind === "screens" ? screensApi.listSummaries({ page, limit: 25, q: search || undefined, include_media: false, include_preview: false })
      : screensApi.listGroupSummaries({ page, limit: 25, q: search || undefined }), staleTime: 0 });
  const selected = kind === "screens" ? screenIds : groupIds;
  const change = (id: string) => {
    const values = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    onChange(kind === "screens" ? values : screenIds, kind === "groups" ? values : groupIds);
  };
  const pages = Math.max(1, Math.ceil((query.data?.pagination.total ?? 0) / 25));
  return <div className="space-y-4"><div className="flex flex-wrap gap-2">
    <Button variant={kind === "screens" ? "secondary" : "outline"} onClick={() => { setKind("screens"); setPage(1); }} disabled={disabled}>Individual screens</Button>
    {canReadGroups && <Button variant={kind === "groups" ? "secondary" : "outline"} onClick={() => { setKind("groups"); setPage(1); }} disabled={disabled}>Screen groups</Button>}
    <span className="self-center text-sm">{screenIds.length} screens and {groupIds.length} groups selected</span></div>
    <Input aria-label="Search live target screens or groups" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} disabled={disabled} placeholder="Search targets…" />
    <p className="text-sm text-muted-foreground">Review resolves groups into 1–25 distinct approved screens. Later membership changes cannot expand a published audience.</p>
    {query.isError && <div role="alert" className="space-y-2 text-sm text-destructive"><p>Targets could not be loaded.</p><Button variant="outline" onClick={() => void query.refetch()}>Retry loading targets</Button></div>}
    {query.isFetching ? <p role="status">Loading targets…</p> : <div className="grid gap-2 sm:grid-cols-2">{query.data?.items.map(item => <label key={item.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
      <input type="checkbox" checked={selected.includes(item.id)} disabled={disabled} onChange={() => change(item.id)} aria-label={`Select ${item.name || item.id}`} />
      <span className="min-w-0 break-words">{item.name || "Unnamed target"}<span className="block font-mono text-xs text-muted-foreground">***{item.id.slice(-8)}</span></span></label>)}</div>}
    {!query.isFetching && !query.isError && !query.data?.items.length && <p>No targets found.</p>}
    <div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={page <= 1 || disabled || query.isFetching} onClick={() => setPage(value => value - 1)}>Previous targets</Button>
      <span className="text-sm">Page {page} of {pages}</span><Button variant="outline" disabled={page >= pages || disabled || query.isFetching} onClick={() => setPage(value => value + 1)}>Next targets</Button></div>
    {(screenIds.length > 0 || groupIds.length > 0) && <details><summary className="cursor-pointer text-sm">All selected targets, including other pages</summary><div className="mt-2 flex flex-wrap gap-2">
      {screenIds.map(id => <Button key={id} size="sm" variant="outline" disabled={disabled} onClick={() => onChange(screenIds.filter(value => value !== id), groupIds)}>Remove screen ***{id.slice(-8)}</Button>)}
      {groupIds.map(id => <Button key={id} size="sm" variant="outline" disabled={disabled} onClick={() => onChange(screenIds, groupIds.filter(value => value !== id))}>Remove group ***{id.slice(-8)}</Button>)}</div></details>}
  </div>;
}
