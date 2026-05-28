import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Image as ImageIcon, Video, FileText, Copy, Trash2, Globe, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  type UploadMediaResult,
} from "@/lib/mediaUploadFlow";
import { mapMediaDeleteError } from "@/lib/mediaDeleteErrors";
import { deriveDisplayNameFromFilename, resolveMediaDisplayName } from "@/lib/media";
import { canDeleteMediaRecord } from "@/lib/access";
import { PageNavigation } from "@/components/common/PageNavigation";

type MediaLibraryLocationState = {
  returnTo?: string;
  returnStep?: number;
  restoreDraft?: boolean;
  openUpload?: boolean;
};

type MediaTab = "all" | "image" | "video" | "document" | "webpage";

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
  resolveLibraryMediaType(media) === "WEBPAGE"
    ? media.fallback_media_url ?? media.media_url ?? null
    : media.media_url ?? null;

const resolveCopyTargetUrl = (media: MediaAsset) =>
  resolveLibraryMediaType(media) === "WEBPAGE"
    ? media.source_url ?? media.fallback_media_url ?? media.media_url ?? null
    : media.media_url ?? null;

const resolveStatusLabel = (media: MediaAsset) => media.status ?? "PENDING";
const resolvePlayableMimeType = (media: MediaAsset) => media.content_type || media.source_content_type || null;
const resolveOriginalMimeType = (media: MediaAsset) => media.source_content_type || null;

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
  const [activeTab, setActiveTab] = useState<MediaTab>("all");
  const [pageByTab, setPageByTab] = useState<Record<MediaTab, number>>({
    all: 1,
    image: 1,
    video: 1,
    document: 1,
    webpage: 1,
  });
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isWebpageOpen, setIsWebpageOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [webpageName, setWebpageName] = useState("");
  const [webpageUrl, setWebpageUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadMediaResult | null>(null);
  const [previewMedia, setPreviewMedia] = useState<MediaAsset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaAsset | null>(null);
  const [deleteMode, setDeleteMode] = useState<"soft" | "hard">("soft");

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
        ? `Media uploaded successfully.${compressionNote} Server verification is still running; the file will appear once it is marked ready.`
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
    mutationFn: async ({ mediaId, hard }: { mediaId: string; hard: boolean }) => {
      const response = await mediaApi.remove(mediaId, hard ? { hard: true } : undefined);
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

  const webpageMutation = useMutation({
    mutationFn: async () => {
      return await mediaApi.createMetadata({
        name: webpageName.trim(),
        type: "WEBPAGE",
        source_url: webpageUrl.trim(),
      });
    },
    onSuccess: (media) => {
      toast({
        title: "Webpage added",
        description:
          media.status === "READY"
            ? "The webpage asset is ready to use."
            : "The server is verifying the webpage and generating a fallback preview.",
      });
      setIsWebpageOpen(false);
      setWebpageName("");
      setWebpageUrl("");
      void queryClient.invalidateQueries({ queryKey: ["media"] });

      if (media.status === "PROCESSING") {
        void waitForMediaReady(media.id)
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: ["media"] });
            toast({
              title: "Webpage ready",
              description: `${resolveMediaDisplayName(media)} is now ready to use.`,
            });
          })
          .catch((error) => {
            toast({
              title: "Webpage verification failed",
              description: getFriendlyUploadError(error),
              variant: "destructive",
            });
          });
      }
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "Unable to add webpage.";
      toast({ title: "Create failed", description: message, variant: "destructive" });
    },
  });

  const activePage = pageByTab[activeTab];
  const typeFilter = (activeTab === "all" ? undefined : activeTab.toUpperCase()) as MediaType | undefined;

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ["media", "library", typeFilter, activePage, MEDIA_PAGE_SIZE],
    queryFn: () =>
      mediaApi.list({
        limit: MEDIA_PAGE_SIZE,
        page: activePage,
        type: typeFilter,
      }),
    placeholderData: (previousData) => previousData,
  });

  const statsQueries = useQueries({
    queries: [
      {
        queryKey: ["media", "stats", "all"],
        queryFn: () => mediaApi.list({ page: 1, limit: 1 }),
      },
      {
        queryKey: ["media", "stats", "image"],
        queryFn: () => mediaApi.list({ page: 1, limit: 1, type: "IMAGE" }),
      },
      {
        queryKey: ["media", "stats", "video"],
        queryFn: () => mediaApi.list({ page: 1, limit: 1, type: "VIDEO" }),
      },
      {
        queryKey: ["media", "stats", "document"],
        queryFn: () => mediaApi.list({ page: 1, limit: 1, type: "DOCUMENT" }),
      },
      {
        queryKey: ["media", "stats", "webpage"],
        queryFn: () => mediaApi.list({ page: 1, limit: 1, type: "WEBPAGE" }),
      },
    ],
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
    if (!selectedFile || isUploading) return;
    setUploadResult(null);
    setUploadProgress(0);
    uploadMutation.mutate(selectedFile);
  };

  const handleCopyUrl = async (url?: string | null) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Copied", description: "Media URL copied to clipboard." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to copy URL.";
      toast({ title: "Copy failed", description: message, variant: "destructive" });
    }
  };

  const handlePreview = (item: MediaAsset) => {
    if (resolvePrimaryMediaUrl(item) || item.source_url) {
      setPreviewMedia(item);
    }
  };

  const closePreview = () => setPreviewMedia(null);

  const confirmDelete = (item: MediaAsset) => {
    setDeleteTarget(item);
    setDeleteMode("soft");
  };

  const handleDelete = () => {
    if (!deleteTarget || deleteMutation.isPending) return;
    deleteMutation.mutate({ mediaId: deleteTarget.id, hard: deleteMode === "hard" });
  };

  useEffect(() => {
    if (!isUploadOpen) setSelectedFile(null);
  }, [isUploadOpen]);

  useEffect(() => {
    if (!isWebpageOpen) {
      setWebpageName("");
      setWebpageUrl("");
    }
  }, [isWebpageOpen]);

  useEffect(() => {
    if (locationState?.openUpload) {
      setIsUploadOpen(true);
    }
  }, [locationState?.openUpload]);

  useEffect(() => {
    if (isError) {
      const message = error instanceof ApiError ? error.message : "Unable to load media.";
      toast({ title: "Load failed", description: message, variant: "destructive" });
    }
  }, [isError, error, toast]);

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
          (activeTab === "document" && typeKey === "DOCUMENT") ||
          (activeTab === "webpage" && typeKey === "WEBPAGE");
        return matchesTab;
      }),
    [media, activeTab]
  );

  const stats = useMemo(() => {
    const total = statsQueries[0]?.data?.total ?? 0;
    const images = statsQueries[1]?.data?.total ?? 0;
    const videos = statsQueries[2]?.data?.total ?? 0;
    const documents = statsQueries[3]?.data?.total ?? 0;
    const webpages = statsQueries[4]?.data?.total ?? 0;
    return { total, images, videos, documents, webpages };
  }, [statsQueries]);

  useEffect(() => {
    if (activePage > totalPages) {
      setPageByTab((prev) => ({
        ...prev,
        [activeTab]: totalPages,
      }));
    }
  }, [activePage, activeTab, totalPages]);

  const resolveMediaLabel = (media: MediaAsset) => resolveMediaDisplayName(media);
  const resolveMediaUpdatedLabel = (media: MediaAsset) =>
    formatRelativeMediaTime(media.updated_at ?? media.created_at);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-foreground">Media Library</h1>
          <p className="text-muted-foreground mt-1">
            Browse uploaded assets, conversion jobs, and webpage playback items.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setIsWebpageOpen(true)}>
            <Globe className="h-4 w-4 mr-2" />
            Add Webpage
          </Button>
          <Button variant="outline" onClick={() => setIsUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Media
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Total Files" value={stats.total} icon={<FileText className="h-5 w-5 text-primary" />} />
        <StatCard title="Images" value={stats.images} icon={<ImageIcon className="h-5 w-5 text-blue-600" />} />
        <StatCard title="Videos" value={stats.videos} icon={<Video className="h-5 w-5 text-purple-600" />} />
        <StatCard title="Documents" value={stats.documents} icon={<FileText className="h-5 w-5 text-orange-600" />} />
        <StatCard title="Webpages" value={stats.webpages} icon={<Globe className="h-5 w-5 text-emerald-600" />} />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto p-1">
              <TabsTrigger value="all" className="shrink-0">All</TabsTrigger>
              <TabsTrigger value="image" className="shrink-0">Images</TabsTrigger>
              <TabsTrigger value="video" className="shrink-0">Videos</TabsTrigger>
              <TabsTrigger value="document" className="shrink-0">Documents</TabsTrigger>
              <TabsTrigger value="webpage" className="shrink-0">Webpages</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="text-sm text-muted-foreground">
            {isFetching ? "Refreshing..." : `${pagination.total} items`}
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} className="h-40" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMedia.map((item: MediaAsset) => (
            <Card
              key={item.id}
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => handlePreview(item)}
            >
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="truncate">{resolveMediaLabel(item)}</span>
                  <Badge variant="outline">{resolveLibraryMediaType(item)}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
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
                    ) : resolveLibraryMediaType(item) === "WEBPAGE" ? (
                      <div className="relative h-40 w-full overflow-hidden bg-slate-950">
                        <img
                          src={resolvePrimaryMediaUrl(item) ?? undefined}
                          alt={resolveMediaLabel(item)}
                          className="h-full w-full object-cover opacity-80"
                          loading="lazy"
                        />
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-3 py-2 text-white">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium">{item.source_url ?? "Webpage"}</p>
                          </div>
                          <Globe className="h-4 w-4 shrink-0" />
                        </div>
                      </div>
                    ) : (
                      <div className="h-40 w-full flex flex-col items-center justify-center gap-2 text-center px-3">
                        <FileText className="h-8 w-8 text-primary" />
                        <p className="text-xs text-muted-foreground">
                          {resolveLibraryMediaType(item) === "DOCUMENT" ? "Document preview" : "Media preview"}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyUrl(resolveCopyTargetUrl(item));
                            }}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copy URL
                          </Button>
                          <Button variant="ghost" size="sm" asChild onClick={(e) => e.stopPropagation()}>
                            <a href={resolveCopyTargetUrl(item) ?? undefined} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-40 w-full flex flex-col items-center justify-center gap-2 rounded-md border bg-muted/30 px-4 text-center">
                    {resolveLibraryMediaType(item) === "WEBPAGE" ? <Globe className="h-8 w-8 text-primary" /> : <FileText className="h-8 w-8 text-primary" />}
                    <p className="text-xs text-muted-foreground">
                      {item.status === "PROCESSING"
                        ? "Processing on the server"
                        : item.status === "FAILED"
                        ? "Processing failed"
                        : "No preview available"}
                    </p>
                  </div>
                )}
                {(resolveCopyTargetUrl(item) || canDeleteMediaRecord(currentUser, item)) && (
                  <div className="flex justify-end gap-2">
                    {resolveCopyTargetUrl(item) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyUrl(resolveCopyTargetUrl(item));
                        }}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy URL
                      </Button>
                    ) : null}
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!canDeleteMediaRecord(currentUser, item)}
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(item);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                )}
                {item.size && <div>Size: {(item.size / 1024 / 1024).toFixed(2)} MB</div>}
                {item.status && (
                  <Badge variant="secondary" className="text-xs">
                    {resolveStatusLabel(item)}
                  </Badge>
                )}
                {item.status_reason ? (
                  <div className="text-xs text-amber-700">
                    Reason: {item.status_reason}
                  </div>
                ) : null}
                {resolveLibraryMediaType(item) === "DOCUMENT" ? (
                  <div className="space-y-1 text-xs">
                    {resolveOriginalMimeType(item) ? <div>Original type: {resolveOriginalMimeType(item)}</div> : null}
                    {resolvePlayableMimeType(item) ? <div>Playback type: {resolvePlayableMimeType(item)}</div> : null}
                  </div>
                ) : null}
                {resolveLibraryMediaType(item) === "WEBPAGE" && item.source_url ? (
                  <div className="space-y-1 text-xs">
                    <div className="break-all">URL: {item.source_url}</div>
                    <div>Playback is anonymous/public only. CMS login state is not reused.</div>
                  </div>
                ) : null}
                {resolveLibraryMediaType(item) === "WEBPAGE" && item.fallback_media_url ? (
                  <div className="text-xs">
                    Fallback preview: server-captured screenshot
                  </div>
                ) : null}
                {resolveMediaUpdatedLabel(item) && (
                  <div className="text-xs">
                    Updated: {resolveMediaUpdatedLabel(item)}
                  </div>
                )}
                <div className="text-xs">
                  Status : {item?.status ?? "PENDING"}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PageNavigation
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
      />

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
                  <Badge variant="outline">{selectedFile.type || "unknown"}</Badge>
                </div>
                <div>Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</div>
                {uploadResult?.didCompress && (
                  <div className="text-xs text-emerald-700">
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
              We request a presigned upload URL, upload directly to storage, then the server verifies the object and marks it READY.
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

      <Dialog open={isWebpageOpen} onOpenChange={setIsWebpageOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add Webpage</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webpage-name">Display name</Label>
              <Input
                id="webpage-name"
                value={webpageName}
                onChange={(event) => setWebpageName(event.target.value)}
                placeholder="Marketing site homepage"
                disabled={webpageMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webpage-url">Webpage URL</Label>
              <Input
                id="webpage-url"
                value={webpageUrl}
                onChange={(event) => setWebpageUrl(event.target.value)}
                placeholder="https://example.com"
                disabled={webpageMutation.isPending}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The server verifies the URL, captures a fallback screenshot, and only then marks it ready. Webpage playback is anonymous/public only; CMS login cookies are never reused on screens.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsWebpageOpen(false)} disabled={webpageMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => webpageMutation.mutate()}
              disabled={!webpageName.trim() || !webpageUrl.trim() || webpageMutation.isPending}
            >
              {webpageMutation.isPending ? "Saving..." : "Add Webpage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {previewMedia && (
        <Dialog open={!!previewMedia} onOpenChange={(open) => (open ? null : closePreview())}>
          <DialogContent className="sm:max-w-[720px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="truncate">{resolveMediaLabel(previewMedia)}</span>
                {previewMedia.type && <Badge variant="outline">{previewMedia.type}</Badge>}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {resolvePrimaryMediaUrl(previewMedia) || previewMedia.source_url ? (
                resolveLibraryMediaType(previewMedia) === "IMAGE" || (previewMedia.content_type || "").startsWith("image/") ? (
                  <img
                    src={resolvePrimaryMediaUrl(previewMedia) ?? undefined}
                    alt={resolveMediaLabel(previewMedia)}
                    className="w-full max-h-[480px] object-contain"
                  />
                ) : resolveLibraryMediaType(previewMedia) === "VIDEO" || (previewMedia.content_type || "").startsWith("video/") ? (
                  <video
                    src={resolvePrimaryMediaUrl(previewMedia) ?? undefined}
                    className="w-full max-h-[480px]"
                    controls
                    preload="metadata"
                  />
                ) : resolveLibraryMediaType(previewMedia) === "WEBPAGE" ? (
                  <div className="space-y-3">
                    {resolvePrimaryMediaUrl(previewMedia) ? (
                      <img
                        src={resolvePrimaryMediaUrl(previewMedia) ?? undefined}
                        alt={resolveMediaLabel(previewMedia)}
                        className="w-full max-h-[420px] rounded-md border object-contain"
                      />
                    ) : null}
                    <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Live URL</p>
                        <p className="truncate text-sm">{previewMedia.source_url ?? "Unavailable"}</p>
                      </div>
                      {previewMedia.source_url ? (
                        <Button variant="outline" size="sm" asChild>
                          <a href={previewMedia.source_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open Live
                          </a>
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Playback uses the live URL only when it loads anonymously. Screens fall back to the captured preview when the live page is unavailable.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-md border bg-muted/40 p-6 text-center">
                    <FileText className="h-10 w-10 text-primary" />
                    <p className="text-sm text-muted-foreground">Document preview unavailable. Open in a new tab.</p>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {resolveOriginalMimeType(previewMedia) ? <div>Original type: {resolveOriginalMimeType(previewMedia)}</div> : null}
                      {resolvePlayableMimeType(previewMedia) ? <div>Playback type: {resolvePlayableMimeType(previewMedia)}</div> : null}
                    </div>
                    <Button variant="outline" asChild>
                      <a href={resolveCopyTargetUrl(previewMedia) ?? undefined} target="_blank" rel="noreferrer">
                        Open document
                      </a>
                    </Button>
                  </div>
                )
              ) : (
                <p className="text-sm text-muted-foreground">No media URL available.</p>
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
              Choose soft delete to restrict usage, or hard delete to permanently remove the media and its storage
              references.
            </p>
            <div className="flex gap-2">
              <Button
                variant={deleteMode === "soft" ? "default" : "outline"}
                onClick={() => setDeleteMode("soft")}
              >
                Soft Delete
              </Button>
              <Button
                variant={deleteMode === "hard" ? "destructive" : "outline"}
                onClick={() => setDeleteMode("hard")}
              >
                Hard Delete
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : deleteMode === "hard" ? "Hard Delete" : "Soft Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">{icon}</div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </div>
    </Card>
  );
}
