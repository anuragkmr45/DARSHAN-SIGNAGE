import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ToastAction } from "@/components/ui/toast";
import { mediaApi } from "@/api/domains/media";
import type { MediaAsset, MediaType } from "@/api/types";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/api/apiClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppSelector } from "@/store/hooks";
import {
  getFriendlyUploadError,
  waitForMediaReady,
  uploadMediaWithPresign,
  validateUploadFile,
  resolveUploadContentType,
  type UploadMediaResult,
} from "@/lib/mediaUploadFlow";
import { mapMediaDeleteError } from "@/lib/mediaDeleteErrors";
import { deriveDisplayNameFromFilename, isPdfLikeMedia, resolveMediaDisplayName, resolveMediaSourceFormat } from "@/lib/media";
import { canDeleteMediaRecord, getContentCreatorLabel, getContentOwnershipLabel } from "@/lib/access";
import { PageNavigation } from "@/components/common/PageNavigation";
import { MediaPreview } from "@/components/common/MediaPreview";
import { useAuthorization } from "@/hooks/useAuthorization";

type MediaLibraryLocationState = {
  returnTo?: string;
  returnStep?: number;
  restoreDraft?: boolean;
  openUpload?: boolean;
};

type MediaTab = "all" | "image" | "video" | "document";

const MEDIA_PAGE_SIZE = 6;

const resolveLibraryMediaType = (media: MediaAsset): MediaType => {
  const explicitType = (media.type || "").toUpperCase();
  if (explicitType === "IMAGE" || explicitType === "VIDEO" || explicitType === "DOCUMENT" || explicitType === "WEBPAGE") {
    return explicitType;
  }

  const contentType = media.content_type || media.source_content_type || "";
  if (contentType.startsWith("image/")) return "IMAGE";
  if (contentType.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
};

const resolvePrimaryMediaUrl = (media: MediaAsset) =>
  resolveLibraryMediaType(media) === "WEBPAGE" ? null : media.media_url ?? null;

const resolveCopyTargetUrl = (media: MediaAsset) =>
  resolveLibraryMediaType(media) === "WEBPAGE" ? null : media.media_url ?? null;

const resolveStatusLabel = (media: MediaAsset) => {
  switch (media.status) {
    case "READY": return "Ready";
    case "PROCESSING": return "Preparing";
    case "FAILED": return "Needs attention";
    default: return "Waiting";
  }
};
const resolvePlayableMimeType = (media: MediaAsset) => media.content_type || media.source_content_type || null;
const resolveFormatBadge = (media: MediaAsset) =>
  resolveLibraryMediaType(media) === "DOCUMENT" ? resolveMediaSourceFormat(media).badge : resolveLibraryMediaType(media);
const isConvertedDocument = (media: MediaAsset) =>
  resolveLibraryMediaType(media) === "DOCUMENT" &&
  Boolean(media.source_content_type) &&
  media.source_content_type !== "application/pdf" &&
  resolvePlayableMimeType(media) === "application/pdf";

const copyTextToClipboard = async (text: string) => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable in this browser.");
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.width = "1px";
  textArea.style.height = "1px";
  textArea.style.opacity = "0";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const didCopy = document.execCommand("copy");
    if (!didCopy) {
      throw new Error("Clipboard copy was blocked by the browser.");
    }
  } finally {
    document.body.removeChild(textArea);
  }
};

const formatRelativeMediaTime = (value?: string | null) => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;

  const diffMs = Date.now() - timestamp;
  if (diffMs <= 0) return "Just now";

  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) {
    const hours = Math.floor(diffHours);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
};

export default function MediaLibrary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as MediaLibraryLocationState | null;
  const currentUser = useAppSelector((state) => state.auth.user);
  const { can } = useAuthorization();
  const canUpload = can('create', 'Media');
  const [activeTab, setActiveTab] = useState<MediaTab>("all");
  const [pageByTab, setPageByTab] = useState<Record<MediaTab, number>>({
    all: 1,
    image: 1,
    video: 1,
    document: 1,
  });
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadMediaResult | null>(null);
  const [previewMedia, setPreviewMedia] = useState<MediaAsset | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const previewDetailQuery = useQuery({
    queryKey: ["media", "preview", previewMedia?.id],
    queryFn: () => mediaApi.getById(previewMedia!.id),
    enabled: Boolean(previewMedia),
  });
  const previewRecord = previewDetailQuery.data?.id === previewMedia?.id ? previewDetailQuery.data : previewMedia;
  const [deleteTarget, setDeleteTarget] = useState<MediaAsset | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedPage, setDeletedPage] = useState(1);
  const canRestore = can('manage', 'Media');
  const deletedMediaQuery = useQuery({ queryKey: ['media', 'deleted', deletedPage], queryFn: () => mediaApi.deleted(deletedPage), enabled: canRestore && showDeleted });
  const restoreMutation = useMutation({
    mutationFn: mediaApi.restore,
    onSuccess: () => {
      toast({ title: 'Media restored' });
      void queryClient.invalidateQueries({ queryKey: ['media'] });
    },
    onError: (error: Error) => toast({ title: 'Restore failed', description: error.message, variant: 'destructive' }),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      return uploadMediaWithPresign(file, {
        displayName,
        onPrepared: (result) => {
          setUploadResult((previous) =>
            previous
              ? {
                  ...previous,
                  ...result,
                }
              : {
                  ...result,
                  media: {
                    id: "",
                    filename: result.file.name,
                  },
                },
          );
        },
        onProgress: (progress) => {
          setUploadProgress(progress);
        },
      });
    },
    onSuccess: (result) => {
      const compressionNote = result.didCompress
        ? ` Compressed ${(result.originalSize / 1024 / 1024).toFixed(2)} MB -> ${(result.finalSize / 1024 / 1024).toFixed(2)} MB.`
        : "";
      const isProcessing = result.media.status === "PROCESSING";
      const description = isProcessing
        ? `Media uploaded and verified.${compressionNote} Playback preparation is running; the preview will appear when ready.`
        : `Media uploaded and verified.${compressionNote}`;
      toast({ title: "Upload complete", description });
      setIsUploadOpen(false);
      setSelectedFile(null);
      setDisplayName("");
      setUploadProgress(0);
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      if (isProcessing) {
        void waitForMediaReady(result.media.id)
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: ["media"] });
            toast({
              title: "Media ready",
              description: `${resolveMediaDisplayName(result.media)} is now ready to use.`,
            });
          })
          .catch((error) => {
            toast({
              title: "Verification delayed",
              description: getFriendlyUploadError(error),
              variant: "destructive",
            });
          });
      }
      if (locationState?.returnTo) {
        navigate(locationState.returnTo, {
          state: {
            step: locationState.returnStep ?? 2,
            restoreDraft: true,
          },
        });
      }
    },
    onError: (err) => {
      const message = getFriendlyUploadError(err);
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mediaId: string) => {
      const response = await mediaApi.remove(mediaId);
      return response as { message?: string } | void;
    },
    onSuccess: (res) => {
      const description = (res as { message?: string } | undefined)?.message ?? "Media deleted.";
      toast({ title: "Deleted", description });
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["media"] });
    },
    onError: (err) => {
      const mapped = mapMediaDeleteError(err);
      if (mapped.dismissDeleteDialog) {
        setDeleteTarget(null);
      }
      if (err instanceof ApiError && err.code === "NOT_FOUND") {
        void queryClient.invalidateQueries({ queryKey: ["media"] });
      }
      toast({
        title: mapped.title,
        description: mapped.description,
        variant: mapped.variant,
        action:
          mapped.helpRoute && mapped.helpLabel ? (
            <ToastAction altText={mapped.helpLabel} onClick={() => navigate(mapped.helpRoute!)}>
              {mapped.helpLabel}
            </ToastAction>
          ) : undefined,
      });
    },
  });

  const activePage = pageByTab[activeTab];
  const typeFilter = (activeTab === "all" ? undefined : activeTab.toUpperCase()) as MediaType | undefined;

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["media", "library", typeFilter, activePage, MEDIA_PAGE_SIZE],
    queryFn: () =>
      mediaApi.list({
        limit: MEDIA_PAGE_SIZE,
        page: activePage,
        type: typeFilter,
      }),
    refetchInterval: 45 * 60 * 1000,
  });

  const isUploading = uploadMutation.isPending;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setDisplayName("");
      setUploadResult(null);
      setUploadProgress(0);
      return;
    }

    const validationError = validateUploadFile(file);
    if (validationError) {
      toast({
        title: "Unsupported file type",
        description: validationError,
        variant: "destructive",
      });
      input.value = "";
      setSelectedFile(null);
      setDisplayName("");
      setUploadResult(null);
      setUploadProgress(0);
      return;
    }

    setSelectedFile(file);
    setDisplayName(deriveDisplayNameFromFilename(file.name));
    setUploadResult(null);
    setUploadProgress(0);
  };

  const handleUpload = () => {
    if (!canUpload || !selectedFile || isUploading) return;
    setUploadResult(null);
    setUploadProgress(0);
    uploadMutation.mutate(selectedFile);
  };

  const handleCopyUrl = async (url?: string | null) => {
    if (!url) return;
    try {
      await copyTextToClipboard(url);
      toast({ title: "Copied", description: "Media URL copied to clipboard." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to copy URL.";
      toast({ title: "Copy failed", description: message, variant: "destructive" });
    }
  };

  const handlePreview = (item: MediaAsset) => {
    setPreviewPage(1);
    setPreviewMedia(item);
  };

  const closePreview = () => setPreviewMedia(null);

  const confirmDelete = (item: MediaAsset) => {
    setDeleteTarget(item);
  };

  const handleDelete = () => {
    if (!deleteTarget || deleteMutation.isPending) return;
    deleteMutation.mutate(deleteTarget.id);
  };

  useEffect(() => {
    if (!isUploadOpen) setSelectedFile(null);
  }, [isUploadOpen]);

  useEffect(() => {
    if (locationState?.openUpload && canUpload) {
      setIsUploadOpen(true);
    }
  }, [canUpload, locationState?.openUpload]);

  const pagination = data ?? { items: [], page: activePage, limit: MEDIA_PAGE_SIZE, total: 0 };
  const totalPages = pagination.limit > 0 ? Math.max(1, Math.ceil(pagination.total / pagination.limit)) : 1;
  const media = useMemo(() => data?.items ?? [], [data]);

  const filteredMedia = useMemo(
    () =>
      media.filter((item) => {
        const typeKey = resolveLibraryMediaType(item);
        const matchesTab =
          activeTab === "all" ||
          (activeTab === "image" && typeKey === "IMAGE") ||
          (activeTab === "video" && typeKey === "VIDEO") ||
          (activeTab === "document" && typeKey === "DOCUMENT");
        return matchesTab;
      }),
    [media, activeTab]
  );

  useEffect(() => {
    if (data && activePage > totalPages) {
      setPageByTab((prev) => ({
        ...prev,
        [activeTab]: totalPages,
      }));
    }
  }, [activePage, activeTab, data, totalPages]);

  const resolveMediaLabel = (media: MediaAsset) => resolveMediaDisplayName(media);
  const resolveMediaUpdatedLabel = (media: MediaAsset) =>
    formatRelativeMediaTime(media.updated_at ?? media.created_at);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Media Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">Uploaded files and their playback readiness.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRestore && <Button variant="outline" onClick={() => setShowDeleted(true)}>Deleted Media</Button>}
          {canUpload && <Button onClick={() => setIsUploadOpen(true)}>
            <Upload aria-hidden="true" className="mr-2 h-4 w-4" />Upload Media
          </Button>}
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="h-auto max-w-full justify-start gap-1 overflow-x-auto p-1">
              <TabsTrigger value="all" className="shrink-0">All</TabsTrigger>
              <TabsTrigger value="image" className="shrink-0">Images</TabsTrigger>
              <TabsTrigger value="video" className="shrink-0">Videos</TabsTrigger>
              <TabsTrigger value="document" className="shrink-0">Documents</TabsTrigger>
            </TabsList>
          </Tabs>
          <div role="status" className="text-sm text-muted-foreground">
            {isLoading ? "Loading files…" : `${pagination.total} ${pagination.total === 1 ? "file" : "files"}`}
            {isFetching && !isLoading ? " · Updating" : ""}
          </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} className="h-40" />
          ))}
        </div>
      ) : isError && !data ? (
        <div role="alert" className="rounded-xl border border-border px-5 py-10 text-center">
          <p className="font-medium">Could not load Media Library</p>
          <p className="mt-1 text-sm text-muted-foreground">{error instanceof ApiError ? error.message : "Check your connection and try again."}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()}>Retry</Button>
        </div>
      ) : filteredMedia.length === 0 ? (
        <div className="rounded-xl border border-border px-5 py-10 text-center">
          <p className="font-medium">{activeTab === "all" ? "No media yet" : `No ${activeTab === "document" ? "documents" : `${activeTab}s`} found`}</p>
          <p className="mt-1 text-sm text-muted-foreground">{activeTab === "all" ? "Uploaded files will appear here." : "Choose another file type or upload a new file."}</p>
          {canUpload && activeTab === "all" && <Button size="sm" className="mt-4" onClick={() => setIsUploadOpen(true)}>Upload Media</Button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMedia.map((item: MediaAsset) => (
            <Card key={item.id} role="group" aria-label={resolveMediaLabel(item)} className="flex h-full flex-col overflow-hidden shadow-none">
              <CardHeader>
                <div className="space-y-2">
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span className="truncate">{resolveMediaLabel(item)}</span>
                    <Badge variant="outline">{resolveFormatBadge(item)}</Badge>
                  </CardTitle>
                  <div className="flex flex-wrap gap-2">
                    {getContentOwnershipLabel(item) ? (
                      <Badge variant="secondary">{getContentOwnershipLabel(item)}</Badge>
                    ) : null}
                    {getContentCreatorLabel(item) ? (
                      <Badge variant="outline">{getContentCreatorLabel(item)}</Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
                {resolvePrimaryMediaUrl(item) ? (
                  <div className="overflow-hidden rounded-md border bg-muted/30">
                    {resolveLibraryMediaType(item) === "IMAGE" || (item.content_type || "").startsWith("image/") ? (
                      <img
                        src={resolvePrimaryMediaUrl(item) ?? undefined}
                        alt={resolveMediaLabel(item)}
                        className="h-40 w-full object-cover"
                        loading="lazy"
                      />
                    ) : resolveLibraryMediaType(item) === "VIDEO" || (item.content_type || "").startsWith("video/") ? (
                      <video
                        src={resolvePrimaryMediaUrl(item) ?? undefined}
                        className="h-40 w-full object-cover"
                        controls
                        preload="metadata"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : resolveLibraryMediaType(item) === "DOCUMENT" && isPdfLikeMedia(item) ? (
                      <div className="relative h-40 w-full">
                        <MediaPreview
                          media={item}
                          url={resolvePrimaryMediaUrl(item) ?? undefined}
                          className="h-40 w-full"
                          fit="contain"
                          alt={`${resolveMediaLabel(item)} first page`}
                        />
                        <span className="absolute bottom-2 right-2 rounded bg-background/90 px-2 py-1 text-xs font-medium shadow">
                          {resolveMediaSourceFormat(item).badge} · Preview
                        </span>
                      </div>
                    ) : (
                      <div className="h-40 w-full flex flex-col items-center justify-center gap-2 text-center px-3">
                        <FileText className="h-8 w-8 text-primary" />
                        <p className="text-xs text-muted-foreground">
                          {resolveLibraryMediaType(item) === "DOCUMENT" ? "Document preview" : "Media preview"}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-40 w-full flex flex-col items-center justify-center gap-2 rounded-md border bg-muted/30 px-4 text-center">
                    <FileText className="h-8 w-8 text-primary" />
                    <p className="text-xs text-muted-foreground">
                      {item.status === "PROCESSING"
                        ? "Processing on the server"
                        : item.status === "FAILED"
                        ? "Processing failed"
                        : resolveLibraryMediaType(item) === "WEBPAGE" ? "Retired webpage item" : "No preview available"}
                    </p>
                  </div>
                )}
                {item.size && <div>Size: {(item.size / 1024 / 1024).toFixed(2)} MB</div>}
                {item.status && (
                  <Badge variant="secondary" className="self-start text-xs">
                    {resolveStatusLabel(item)}
                  </Badge>
                )}
                {item.status_reason ? (
                  <div className="text-xs status-text-warning">
                    Reason: {item.status_reason}
                  </div>
                ) : null}
                {resolveLibraryMediaType(item) === "DOCUMENT" ? (
                  <div className="space-y-1 text-xs">
                    <div>Original format: {resolveMediaSourceFormat(item).label}</div>
                    {isConvertedDocument(item) ? <div>Screen playback: converted PDF</div> : null}
                    {item.page_count ? <div>{item.page_count} page{item.page_count === 1 ? "" : "s"}</div> : null}
                  </div>
                ) : null}
                {resolveMediaUpdatedLabel(item) && (
                  <div className="text-xs">
                    Updated: {resolveMediaUpdatedLabel(item)}
                  </div>
                )}
                <div className="mt-auto flex flex-wrap gap-2 border-t border-border/70 pt-3">
                  <Button variant="outline" size="sm" onClick={() => handlePreview(item)}>Preview</Button>
                  {resolveCopyTargetUrl(item) ? (
                    <Button variant="outline" size="sm" onClick={() => handleCopyUrl(resolveCopyTargetUrl(item))}>
                      <Copy aria-hidden="true" className="mr-2 h-4 w-4" />Copy URL
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={!canDeleteMediaRecord(currentUser, item)} onClick={() => confirmDelete(item)}>
                    <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isError && data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <span>Could not refresh the file list. Showing the last loaded results.</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button>
        </div>
      )}

      {data && pagination.total > pagination.limit && <PageNavigation
        currentPage={activePage}
        totalPages={totalPages}
        showPageNumbers
        onPageChange={(nextPage) =>
          setPageByTab((prev) => ({
            ...prev,
            [activeTab]: nextPage,
          }))
        }
        className="flex justify-end"
      />}

      <Dialog
        open={isUploadOpen}
        onOpenChange={(open) => {
          setIsUploadOpen(open);
          if (!open) {
            setSelectedFile(null);
            setDisplayName("");
            setUploadResult(null);
            setUploadProgress(0);
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Upload Media</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="media-file">Select file</Label>
              <Input
                id="media-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.mov,.mp4,.pdf,.ppt,.pptx,.csv,.doc,.docx,.xls,.xlsx"
                onChange={handleFileChange}
                disabled={isUploading}
              />
            </div>
            {selectedFile && (
              <div className="rounded-md border p-3 text-sm text-muted-foreground space-y-2">
                <div className="flex items-center justify-between text-foreground">
                  <span className="font-medium truncate">{selectedFile.name}</span>
                  <Badge variant="outline">
                    {resolveMediaSourceFormat({ source_content_type: resolveUploadContentType(selectedFile) ?? undefined }).label}
                  </Badge>
                </div>
                <div>Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</div>
                {uploadResult?.didCompress && (
                  <div className="text-xs status-text-success">
                    Compressed: {(uploadResult.originalSize / 1024 / 1024).toFixed(2)} MB {"->"}{" "}
                    {(uploadResult.finalSize / 1024 / 1024).toFixed(2)} MB
                  </div>
                )}
                {isUploading && (
                  <div className="space-y-1">
                    <Progress value={uploadProgress} className="h-1.5" />
                    <div className="text-[11px] text-muted-foreground">{uploadProgress}% uploaded</div>
                  </div>
                )}
              </div>
            )}
            {selectedFile && (
              <div className="space-y-2">
                <Label htmlFor="media-display-name">Display name</Label>
                <Input
                  id="media-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Enter a user-friendly name"
                  disabled={isUploading}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              The server verifies the upload. Videos and documents are prepared for playback, then their previews appear when ready.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUploadOpen(false)} disabled={isUploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!selectedFile || !displayName.trim() || isUploading}>
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {previewMedia && (
        <Dialog open={!!previewMedia} onOpenChange={(open) => (open ? null : closePreview())}>
          <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-[800px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="truncate">{resolveMediaLabel(previewMedia)}</span>
                <Badge variant="outline">{resolveFormatBadge(previewMedia)}</Badge>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {previewDetailQuery.isFetching ? (
                <p className="text-sm text-muted-foreground">Loading current preview...</p>
              ) : previewDetailQuery.isError ? (
                <div className="space-y-2 text-sm">
                  <p>Could not load a current preview link.</p>
                  <Button variant="outline" onClick={() => void previewDetailQuery.refetch()}>Retry</Button>
                </div>
              ) : previewRecord && resolveLibraryMediaType(previewRecord) === "WEBPAGE" ? (
                <div className="rounded border p-4">Webpage media is retired and cannot be played.</div>
              ) : previewRecord && resolvePrimaryMediaUrl(previewRecord) ? (
                resolveLibraryMediaType(previewRecord) === "IMAGE" || (previewRecord.content_type || "").startsWith("image/") ? (
                  <img
                    src={resolvePrimaryMediaUrl(previewRecord) ?? undefined}
                    alt={resolveMediaLabel(previewRecord)}
                    className="w-full max-h-[480px] object-contain"
                  />
                ) : resolveLibraryMediaType(previewRecord) === "VIDEO" || (previewRecord.content_type || "").startsWith("video/") ? (
                  <video
                    src={resolvePrimaryMediaUrl(previewRecord) ?? undefined}
                    className="w-full max-h-[480px]"
                    controls
                    preload="metadata"
                  />
                ) : resolveLibraryMediaType(previewRecord) === "DOCUMENT" && isPdfLikeMedia(previewRecord) ? (
                  <div className="space-y-3">
                    <MediaPreview
                      media={previewRecord}
                      url={resolvePrimaryMediaUrl(previewRecord) ?? undefined}
                      type="application/pdf"
                      alt={`${resolveMediaLabel(previewRecord)} page ${previewPage}`}
                      className="h-[55vh] min-h-[320px] w-full border"
                      fit="contain"
                      pdfPage={previewPage}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <div>
                        <span>Original format: {resolveMediaSourceFormat(previewRecord).label}</span>
                        {isConvertedDocument(previewRecord) ? <span className="ml-2 text-muted-foreground">Converted to PDF for screen playback</span> : null}
                      </div>
                      {previewRecord.page_count && previewRecord.page_count > 1 ? (
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" disabled={previewPage <= 1} onClick={() => setPreviewPage((page) => page - 1)}>Previous page</Button>
                          <span>Page {previewPage} of {previewRecord.page_count}</span>
                          <Button variant="outline" size="sm" disabled={previewPage >= previewRecord.page_count} onClick={() => setPreviewPage((page) => page + 1)}>Next page</Button>
                        </div>
                      ) : null}
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a href={resolvePrimaryMediaUrl(previewRecord) ?? undefined} target="_blank" rel="noreferrer">Open PDF in new tab</a>
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-md border bg-muted/40 p-6 text-center">
                    <FileText className="h-10 w-10 text-primary" />
                    <p className="text-sm text-muted-foreground">Preview is unavailable for this file.</p>
                    <div className="text-xs text-muted-foreground">Original format: {resolveMediaSourceFormat(previewRecord).label}</div>
                    <Button variant="outline" asChild>
                      <a href={resolveCopyTargetUrl(previewRecord) ?? undefined} target="_blank" rel="noreferrer">
                        Open document
                      </a>
                    </Button>
                  </div>
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  {previewRecord?.status === "PROCESSING" ? "This file is still being prepared." : previewRecord?.status === "FAILED" ? "Processing failed; this file has no preview." : "No media URL available."}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closePreview}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog open={!!deleteTarget} onOpenChange={(open) => (open ? null : setDeleteTarget(null))}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Delete Media</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This media will be hidden from normal use. Its objects remain available for an administrator to restore.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Media"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={showDeleted} onOpenChange={setShowDeleted}>
        <DialogContent>
          <DialogHeader><DialogTitle>Deleted Media</DialogTitle></DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {deletedMediaQuery.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading deleted media…</p>}
            {deletedMediaQuery.isError && <div role="alert" className="space-y-2 text-sm"><p>Unable to load deleted media.</p><Button variant="outline" size="sm" onClick={() => void deletedMediaQuery.refetch()}>Retry</Button></div>}
            {deletedMediaQuery.data?.items.length === 0 && !deletedMediaQuery.isError && <p>No deleted media.</p>}
            {deletedMediaQuery.data?.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 border-b py-2">
                <span>{item.name}</span>
                <Button variant="outline" disabled={restoreMutation.isPending} onClick={() => restoreMutation.mutate(item.id)}>Restore</Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2" aria-label="Deleted media pages">
            <Button variant="outline" disabled={deletedPage === 1 || deletedMediaQuery.isFetching} onClick={() => setDeletedPage((page) => page - 1)}>Previous</Button>
            <span>Page {deletedPage}</span>
            <Button variant="outline" disabled={deletedMediaQuery.isFetching || (deletedMediaQuery.data?.items.length ?? 0) < 100} onClick={() => setDeletedPage((page) => page + 1)}>Next</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
