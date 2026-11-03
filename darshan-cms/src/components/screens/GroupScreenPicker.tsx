import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import { PageNavigation } from "@/components/common/PageNavigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 20;

type GroupScreenPickerProps = {
  open: boolean;
  groupId?: string;
  enabled: boolean;
  selectedScreenIds: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  onReadyChange: (ready: boolean) => void;
};

export function GroupScreenPicker({
  open, groupId, enabled, selectedScreenIds, onChange, onReadyChange,
}: GroupScreenPickerProps) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: queryKeys.availableGroupScreens({ page, limit: PAGE_SIZE, groupId, q: search }),
    queryFn: () => screensApi.listAvailableGroupScreens({
      page, limit: PAGE_SIZE, group_id: groupId, q: search || undefined,
    }),
    enabled: open && enabled,
  });

  useEffect(() => {
    onReadyChange(!enabled || (open && query.isSuccess && !query.isFetching));
  }, [enabled, onReadyChange, open, query.isFetching, query.isSuccess]);

  useEffect(() => {
    if (!open) {
      setPage(1);
      setSearchInput("");
      setSearch("");
    }
  }, [open]);

  const selected = new Set(selectedScreenIds);
  const total = query.data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (query.data && page > totalPages) setPage(totalPages);
  }, [page, query.data, totalPages]);

  return (
    <section aria-label="Group screens" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Screens</h3>
        <span className="text-xs text-muted-foreground">{selectedScreenIds.length} selected across pages</span>
      </div>
      {!enabled ? (
        <p className="text-sm text-muted-foreground">
          You can create an empty group. Read access to Screen Groups is needed to select screens.
        </p>
      ) : (
        <>
          <form className="flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}>
            <Label htmlFor="group-screen-search" className="sr-only">Search available screens</Label>
            <Input id="group-screen-search" value={searchInput} maxLength={100}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search screen name, location or ID" />
            <Button type="submit" variant="outline">Search</Button>
          </form>
          {query.isPending || query.isFetching ? (
            <div className="space-y-2" aria-label="Loading available screens">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : query.isError ? (
            <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
              Available screens could not be loaded.
              <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
            </div>
          ) : (
            <>
              {query.data.items.length === 0 ? (
                <p className="rounded-md border p-4 text-sm text-muted-foreground">
                  {search ? "No available screens match this search." : "No unassigned screens are available."}
                </p>
              ) : (
                <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
                  {query.data.items.map((screen) => (
                    <label key={screen.id} className="flex cursor-pointer items-start gap-3 p-3 hover:bg-accent/50">
                      <Checkbox aria-label={`Select ${screen.name}`} checked={selected.has(screen.id)}
                        onCheckedChange={(checked) => {
                          onChange((previous) => checked
                            ? previous.includes(screen.id) ? previous : [...previous, screen.id]
                            : previous.filter((id) => id !== screen.id));
                        }} />
                      <span className="min-w-0 text-sm">
                        <span className="block truncate font-medium">{screen.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{screen.location || "No location"}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {totalPages > 1 && (
                <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} />
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
