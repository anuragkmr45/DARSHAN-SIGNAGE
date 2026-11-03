import { useEffect, useMemo, useState } from "react";
import { Eye, Plus, MoreHorizontal, Pencil, Trash2, RefreshCw, LayoutGrid } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { SearchBar } from "@/components/common/SearchBar";
import { useToast } from "@/hooks/use-toast";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { Input } from "@/components/ui/input";
import { layoutsApi } from "@/api/domains/layouts";
import { queryKeys } from "@/api/queryKeys";
import type { LayoutItem, LayoutListParams } from "@/api/types";
import { PageNavigation } from "@/components/common/PageNavigation";
import { useAppSelector } from "@/store/hooks";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  canDeleteLayoutRecord,
  canManageLayoutRecord,
  getContentCreatorLabel,
  getContentOwnershipLabel,
} from "@/lib/access";

const ITEMS_PER_PAGE = 9;
const aspectRatios = ["16:9", "9:16", "1:1", "4:3", "21:9"];

function formatRelativeTime(dateString: string): string {
  const timestamp = Date.parse(dateString);
  if (Number.isNaN(timestamp)) return "Unknown";

  const diffMs = Date.now() - timestamp;
  if (diffMs <= 0) return "Just now";

  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) {
    const hours = Math.floor(diffHours);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }

  return new Date(timestamp).toLocaleDateString();
}

export type Layout = LayoutItem;

const Layouts = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { can } = useAuthorization();
  const canCreate = can("create", "Layout");
  const currentUser = useAppSelector((state) => state.auth.user);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [aspectRatioFilter, setAspectRatioFilter] = useState<string>("all");
  const [deleteTarget, setDeleteTarget] = useState<LayoutItem | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LayoutItem | null>(null);
  const [confirmationInput, setConfirmationInput] = useState("");

  const trimmedSearchQuery = searchQuery.trim();
  const aspectRatioQuery = aspectRatioFilter === "all" ? undefined : aspectRatioFilter;

  useEffect(() => {
    setPage(1);
  }, [trimmedSearchQuery, aspectRatioFilter]);

  useEffect(() => {
    setConfirmationInput("");
  }, [deleteTarget?.id]);

  const filters = useMemo<LayoutListParams>(() => {
    const params: LayoutListParams = {
      page,
      limit: ITEMS_PER_PAGE,
    };
    if (trimmedSearchQuery) {
      params.search = trimmedSearchQuery;
    }
    if (aspectRatioQuery) {
      params.aspect_ratio = aspectRatioQuery;
    }
    return params;
  }, [page, trimmedSearchQuery, aspectRatioQuery]);

  const queryKey = useMemo(
    () =>
      queryKeys.layouts({
        page,
        limit: ITEMS_PER_PAGE,
        search: trimmedSearchQuery || undefined,
        aspect_ratio: aspectRatioQuery,
      }),
    [page, trimmedSearchQuery, aspectRatioQuery],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => layoutsApi.list(filters),
  });

  const deleteLayoutMutation = useSafeMutation({
    mutationFn: (layoutId: string) => layoutsApi.remove(layoutId),
    onSuccess: () => {
      refetch();
    },
  }, "Unable to delete layout.");

  const pagination = data?.pagination ?? { page, limit: ITEMS_PER_PAGE, total: 0 };
  const layouts = data?.items ?? [];
  const totalPages =
    pagination.limit > 0 ? Math.max(1, Math.ceil(pagination.total / pagination.limit)) : 1;
  const canConfirmDelete =
    Boolean(deleteTarget && confirmationInput.trim() === deleteTarget.name);

  useEffect(() => {
    if (data && page > totalPages) {
      setPage(totalPages);
    }
  }, [data, page, totalPages]);

  const handleDelete = async () => {
    if (!deleteTarget || !canConfirmDelete) return;
    const targetName = deleteTarget.name;
    try {
      await deleteLayoutMutation.mutateAsync(deleteTarget.id);
      toast({
        title: "Layout deleted",
        description: `"${targetName}" has been removed.`,
      });
      setConfirmationInput("");
      setDeleteTarget(null);
    } catch {
      // Error toast handled by useSafeMutation; keep dialog open for retry.
    }
  };

  const handleRefresh = () => {
    void refetch();
  };

  const errorMessage =
    error instanceof Error ? error.message : "Unable to load layouts right now.";

  const renderLayoutPreview = (layout: LayoutItem) => {
    const [widthRatio, heightRatio] = layout.aspect_ratio.split(":").map(Number);
    const previewRatio = widthRatio > 0 && heightRatio > 0 ? `${widthRatio} / ${heightRatio}` : "16 / 9";

    return (
      <div
        className="relative rounded-lg border bg-muted/30"
        style={{ width: "min(100%, 420px)", aspectRatio: previewRatio }}
      >
        {layout.spec.slots.map((slot) => (
          <div
            key={slot.id}
            className="absolute flex items-center justify-center overflow-hidden rounded border border-primary/60 bg-primary/10 text-[10px] text-muted-foreground"
            style={{
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${slot.w * 100}%`,
              height: `${slot.h * 100}%`,
            }}
          >
            {slot.id}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Layouts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Reusable arrangements for screen content.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" aria-label="Refresh layouts" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh
          </Button>
          {canCreate && <Button onClick={() => navigate("/layouts/new")}>
            <Plus aria-hidden="true" className="mr-2 h-4 w-4" />New Layout
          </Button>}
        </div>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-sm">
          <SearchBar
            placeholder="Search layouts"
            onSearch={setSearchQuery}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:justify-end">
          <Select value={aspectRatioFilter} onValueChange={setAspectRatioFilter}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Aspect Ratio" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Ratios</SelectItem>
              {aspectRatios.map((ratio) => (
                <SelectItem key={ratio} value={ratio}>
                  {ratio}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading layouts…" : `${pagination.total} ${pagination.total === 1 ? "layout" : "layouts"}`}
            {isFetching && !isLoading ? " · Updating" : ""}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-md border p-6">
          <LoadingIndicator label="Loading layouts..." />
        </div>
      ) : isError && !data ? (
        <EmptyState
          title="Unable to load layouts"
          description={errorMessage}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : layouts.length === 0 ? (
        <EmptyState
          title={trimmedSearchQuery || aspectRatioQuery ? "No layouts match these filters" : "No layouts yet"}
          description={trimmedSearchQuery || aspectRatioQuery ? "Try another name or aspect ratio." : "Layouts you can access will appear here."}
          actionLabel={canCreate && !trimmedSearchQuery && !aspectRatioQuery ? "Create layout" : undefined}
          onAction={canCreate ? () => navigate("/layouts/new") : undefined}
        />
      ) : (
        <>
        <div className="hidden overflow-x-auto rounded-xl border lg:block">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Aspect Ratio</TableHead>
                <TableHead>Slots</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {layouts.map((layout) => {
                const canManageLayout = canManageLayoutRecord(currentUser, layout);
                const canDeleteLayout = canDeleteLayoutRecord(currentUser, layout);
                return (
                <TableRow key={layout.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                      {layout.name}
                      {getContentOwnershipLabel(layout) ? (
                        <Badge variant="secondary">{getContentOwnershipLabel(layout)}</Badge>
                      ) : null}
                      {getContentCreatorLabel(layout) ? (
                        <Badge variant="outline">{getContentCreatorLabel(layout)}</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[300px] text-muted-foreground">
                    <span className="line-clamp-2 break-words">{layout.description}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{layout.aspect_ratio}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{layout.spec.slots.length}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(layout.updated_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${layout.name}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setPreviewTarget(layout)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!canManageLayout}
                          onClick={() => navigate(`/layouts/${layout.id}`)}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          disabled={!canDeleteLayout}
                          onClick={() => setDeleteTarget(layout)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {!canManageLayout && !canDeleteLayout ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Read-only for your account
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-3 lg:hidden" aria-label="Layouts">
          {layouts.map((layout) => {
            const canManageLayout = canManageLayoutRecord(currentUser, layout);
            const canDeleteLayout = canDeleteLayoutRecord(currentUser, layout);
            return (
              <article key={layout.id} className="rounded-xl border border-border bg-background p-4" aria-label={layout.name}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h2 className="break-words text-base font-semibold">{layout.name}</h2>
                    {layout.description && <p className="line-clamp-2 break-words text-sm text-muted-foreground">{layout.description}</p>}
                  </div>
                  <Badge variant="secondary" className="shrink-0">{layout.aspect_ratio}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{layout.spec.slots.length} {layout.spec.slots.length === 1 ? "slot" : "slots"}</span>
                  <span>Updated {formatRelativeTime(layout.updated_at)}</span>
                  {getContentOwnershipLabel(layout) && <span>{getContentOwnershipLabel(layout)}</span>}
                  {getContentCreatorLabel(layout) && <span>{getContentCreatorLabel(layout)}</span>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                  <Button variant="outline" size="sm" onClick={() => setPreviewTarget(layout)}>View</Button>
                  {canManageLayout && <Button variant="outline" size="sm" onClick={() => navigate(`/layouts/${layout.id}`)}>Edit</Button>}
                  {canDeleteLayout && <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label={`More actions for ${layout.name}`}>More</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(layout)}>
                        <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>}
                  {!canManageLayout && !canDeleteLayout && <span className="text-xs text-muted-foreground">Read-only for your account</span>}
                </div>
              </article>
            );
          })}
        </div>
        </>
      )}

      {isError && data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <span>Could not refresh layouts. Showing the last loaded list.</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button>
        </div>
      )}

      {data && pagination.total > pagination.limit && <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} className="justify-end" />}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete layout?"
        description="This will permanently remove the layout template. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        isLoading={deleteLayoutMutation.isPending}
        confirmDisabled={!canConfirmDelete}
      >
        {deleteTarget && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Please type <span className="font-medium text-foreground">{deleteTarget.name}</span> to confirm.
            </p>
            <Input
              value={confirmationInput}
              onChange={(event) => setConfirmationInput(event.target.value)}
              placeholder="Layout name"
              aria-label="Confirm layout name"
              className="w-full"
            />
          </div>
        )}
      </ConfirmDialog>

      <Dialog open={!!previewTarget} onOpenChange={(open) => !open && setPreviewTarget(null)}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewTarget?.name || "Layout preview"}</DialogTitle>
          </DialogHeader>
          {previewTarget && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{previewTarget.aspect_ratio}</Badge>
                <Badge variant="outline">{previewTarget.spec.slots.length} slots</Badge>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4 sm:p-6">
                {renderLayoutPreview(previewTarget)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Layouts;
