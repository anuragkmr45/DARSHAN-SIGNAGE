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
import { canManageLayoutRecord } from "@/lib/access";

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

export interface LayoutSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  id: string;
  name: string;
  description: string;
  aspect_ratio: string;
  spec: {
    slots: LayoutSlot[];
  };
  updated_at: string;
}

function getPreviewDimensions(ratio: string, maxWidth: number): { width: number; height: number } {
  const [widthRatio, heightRatio] = ratio.split(":").map(Number);
  if (!widthRatio || !heightRatio) {
    return { width: maxWidth, height: maxWidth * 0.5625 };
  }

  return {
    width: maxWidth,
    height: maxWidth * (heightRatio / widthRatio),
  };
}

const Layouts = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
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
    placeholderData: (previousData) => previousData,
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
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

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
    refetch();
    toast({
      title: "Layouts refreshed",
      description: "Layout list has been updated.",
    });
  };

  const errorMessage =
    error instanceof Error ? error.message : "Unable to load layouts right now.";

  const renderLayoutPreview = (layout: LayoutItem, maxWidth = 420) => {
    const dimensions = getPreviewDimensions(layout.aspect_ratio, maxWidth);

    return (
      <div
        className="relative rounded-lg border bg-muted/30"
        style={{ width: dimensions.width, height: dimensions.height }}
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">Layouts</h1>
          <p className="text-muted-foreground">
            Manage mosaic templates used to place content on screens.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => navigate("/layouts/new")}>
            <Plus className="mr-2 h-4 w-4" />
            New Layout
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-sm">
          <SearchBar
            placeholder="Search by name or description..."
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
            {isFetching ? "Refreshing..." : `${pagination.total} layouts`}
          </p>
        </div>
      </div>

      {/* Table or Empty/Error States */}
      {isLoading ? (
        <div className="rounded-md border p-6">
          <LoadingIndicator label="Loading layouts..." />
        </div>
      ) : isError ? (
        <EmptyState
          title="Unable to load layouts"
          description={errorMessage}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : layouts.length === 0 ? (
        <EmptyState
          title="No layouts found"
          description="Try a different search term or create a new layout."
          actionLabel="Create layout"
          onAction={() => navigate("/layouts/new")}
        />
      ) : (
        <div className="rounded-md border">
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
                return (
                <TableRow key={layout.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                      {layout.name}
                      {layout.is_shared ? <Badge variant="secondary">Shared</Badge> : null}
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
                        <Button variant="ghost" size="icon">
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
                          disabled={!canManageLayout}
                          onClick={() => setDeleteTarget(layout)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {!canManageLayout && layout.is_shared ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Shared admin template
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} className="justify-end" />

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
        <DialogContent className="max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewTarget?.name || "Layout preview"}</DialogTitle>
          </DialogHeader>
          {previewTarget && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{previewTarget.aspect_ratio}</Badge>
                <Badge variant="outline">{previewTarget.spec.slots.length} slots</Badge>
              </div>
              <div className="overflow-x-auto rounded-lg border bg-muted/20 p-4 sm:p-6">
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
