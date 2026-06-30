import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Trash2,
  GripVertical,
  Volume2,
  VolumeX,
  Globe,
  Image as ImageIcon,
  Video,
  FileText,
  Upload,
  Repeat,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { MediaPreview } from "@/components/common/MediaPreview";
import { useToast } from "@/hooks/use-toast";
import { mediaApi } from "@/api/domains/media";
import type { MediaAsset, MediaType } from "@/api/types";
import { ApiError } from "@/api/apiClient";
import type { Layout } from "@/pages/Layouts";
import type { SlotMedia } from "@/pages/ScheduleCreator";
import { resolveMediaDisplayName } from "@/lib/media";

interface StepMediaAssignProps {
  layout: Layout;
  slotMedia: SlotMedia[];
  onUpdateSlotMedia: (slotMedia: SlotMedia[]) => void;
}

const MEDIA_PAGE_SIZE = 100;
const FIT_MODE_HELP = "Cover fills the slot and may crop. Contain keeps the full media visible with possible margins.";

const resolveMediaType = (media: MediaAsset): SlotMedia["mediaType"] => {
  if (media.type) {
    const type = media.type.toUpperCase();
    if (type === "IMAGE" || type === "VIDEO" || type === "DOCUMENT" || type === "WEBPAGE") {
      return type as SlotMedia["mediaType"];
    }
  }

  const contentType = media.content_type || media.source_content_type || "";
  if (contentType.startsWith("image/")) return "IMAGE";
  if (contentType.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
};

const mediaTypeLabel = (mediaType: SlotMedia["mediaType"], contentType?: string | null) => {
  if (mediaType !== "DOCUMENT") return mediaType;
  if ((contentType || "").toLowerCase().includes("pdf")) return "PDF";
  return "DOCUMENT";
};

const getMediaIcon = (type: SlotMedia["mediaType"]) => {
  switch (type) {
    case "IMAGE":
      return <ImageIcon className="h-4 w-4" />;
    case "VIDEO":
      return <Video className="h-4 w-4" />;
    case "WEBPAGE":
      return <Globe className="h-4 w-4" />;
    default:
      return <FileText className="h-4 w-4" />;
  }
};

function SlotMediaPreview({
  item,
  className,
}: {
  item: Pick<SlotMedia, "mediaName" | "mediaType" | "mediaUrl" | "mediaContentType" | "fitMode" | "loopEnabled">;
  className: string;
}) {
  return (
    <MediaPreview
      url={item.mediaUrl ?? undefined}
      type={item.mediaContentType ?? item.mediaType}
      alt={item.mediaName}
      className={className}
      fit={item.fitMode}
      videoControls={false}
      videoMuted
      videoAutoPlay={item.mediaType === "VIDEO"}
      videoLoop={item.mediaType === "VIDEO" ? item.loopEnabled : false}
    />
  );
}

export function StepMediaAssign({ layout, slotMedia, onUpdateSlotMedia }: StepMediaAssignProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(layout.spec.slots[0]?.id || null);
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("all");

  const slots = layout.spec.slots;
  const typeFilter = (mediaTypeFilter === "all" ? undefined : mediaTypeFilter.toUpperCase()) as MediaType | undefined;

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ["media", "schedule-creator", typeFilter],
    queryFn: () =>
      mediaApi.list({
        limit: MEDIA_PAGE_SIZE,
        page: 1,
        status: "READY",
        type: typeFilter,
      }),
    keepPreviousData: true,
  });

  useEffect(() => {
    if (!isError) return;
    const message = error instanceof ApiError ? error.message : "Unable to load media.";
    toast({ title: "Load failed", description: message, variant: "destructive" });
  }, [isError, error, toast]);

  const mediaItems = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);

  const filteredMedia = useMemo(() => {
    const query = mediaSearch.trim().toLowerCase();
    if (!query) return mediaItems;
    return mediaItems.filter((item) => resolveMediaDisplayName(item).toLowerCase().includes(query));
  }, [mediaItems, mediaSearch]);

  const getSlotMedia = (slotId: string) =>
    slotMedia
      .filter((item) => item.slotId === slotId)
      .sort((left, right) => left.order - right.order);

  const handleAddMedia = (media: MediaAsset) => {
    if (!selectedSlotId) return;

    const existingSlotMedia = getSlotMedia(selectedSlotId);
    const newOrder = existingSlotMedia.length;
    const mediaType = resolveMediaType(media);
    const hasAudioElsewhere = slotMedia.some((item) => item.slotId !== selectedSlotId && item.audioEnabled);

    const newSlotMedia: SlotMedia = {
      slotId: selectedSlotId,
      mediaId: media.id,
      mediaName: resolveMediaDisplayName(media),
      mediaType,
      mediaThumbnail: mediaType === "IMAGE" ? media.media_url ?? undefined : undefined,
      mediaUrl: media.media_url ?? null,
      mediaContentType: media.content_type ?? media.source_content_type ?? null,
      order: newOrder,
      durationSeconds: media.duration_seconds || 10,
      fitMode: "cover",
      audioEnabled: !hasAudioElsewhere && mediaType === "VIDEO",
      loopEnabled: false,
    };

    onUpdateSlotMedia([...slotMedia, newSlotMedia]);
    setIsMediaPickerOpen(false);
    toast({
      title: "Media added",
      description: `Added ${resolveMediaDisplayName(media)} to ${selectedSlotId}`,
    });
  };

  const handleRemoveMedia = (slotId: string, mediaId: string) => {
    onUpdateSlotMedia(slotMedia.filter((item) => !(item.slotId === slotId && item.mediaId === mediaId)));
  };

  const handleUpdateMediaSettings = (
    slotId: string,
    mediaId: string,
    updates: Partial<SlotMedia>,
  ) => {
    onUpdateSlotMedia(
      slotMedia.map((item) => {
        if (item.slotId === slotId && item.mediaId === mediaId) {
          return {
            ...item,
            ...updates,
            loopEnabled:
              item.mediaType === "VIDEO"
                ? (updates.loopEnabled ?? item.loopEnabled)
                : false,
          };
        }

        if (updates.audioEnabled && item.slotId !== slotId) {
          return { ...item, audioEnabled: false };
        }

        return item;
      }),
    );
  };

  const handleUploadNavigate = () => {
    setIsMediaPickerOpen(false);
    navigate("/media", {
      state: {
        returnTo: "/schedule/new",
        returnStep: 2,
        restoreDraft: true,
        openUpload: true,
      },
    });
  };

  const renderLayoutPreview = () => {
    const aspectRatio = layout.aspect_ratio === "9:16" ? 9 / 16 : 16 / 9;
    const previewWidth = 320;
    const previewHeight = previewWidth / aspectRatio;

    return (
      <div
        className="relative mx-auto rounded-lg border-2 bg-muted/30"
        style={{ width: previewWidth, height: previewHeight }}
      >
        {slots.map((slot) => {
          const isSelected = selectedSlotId === slot.id;
          const slotItems = getSlotMedia(slot.id);
          const primaryMedia = slotItems[0];

          return (
            <div
              key={slot.id}
              onClick={() => setSelectedSlotId(slot.id)}
              className={`absolute cursor-pointer overflow-hidden border-2 transition-all ${
                isSelected
                  ? "border-primary bg-primary/15"
                  : primaryMedia
                    ? "border-primary/50 bg-primary/5"
                    : "border-dashed border-muted-foreground/50 bg-muted/60"
              }`}
              style={{
                left: `${slot.x * 100}%`,
                top: `${slot.y * 100}%`,
                width: `${slot.w * 100}%`,
                height: `${slot.h * 100}%`,
              }}
            >
              {primaryMedia ? (
                <>
                  <SlotMediaPreview item={primaryMedia} className="h-full w-full" />
                  <div className="pointer-events-none absolute inset-x-1 bottom-1 flex flex-wrap items-center justify-end gap-1">
                    {primaryMedia.audioEnabled ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Audio
                      </Badge>
                    ) : null}
                    {primaryMedia.mediaType === "VIDEO" && primaryMedia.loopEnabled ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Loop
                      </Badge>
                    ) : null}
                    {slotItems.length > 1 ? (
                      <Badge variant="secondary" className="text-[10px]">
                        +{slotItems.length - 1}
                      </Badge>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-muted-foreground">
                  {slot.id}
                </div>
              )}

              <div className="pointer-events-none absolute left-1 top-1 flex items-center gap-1">
                <Badge variant="secondary" className="text-[10px]">
                  {slot.id}
                </Badge>
                {primaryMedia ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {slotItems.length}
                  </Badge>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Assign Media to Slots</h2>
        <p className="text-sm text-muted-foreground">
          Click a slot in the preview, then add media items and fine-tune how each item should play.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground">Layout Preview</h3>
          {renderLayoutPreview()}
          <p className="text-center text-xs text-muted-foreground">Click a slot to edit it.</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium">
              Slot: <span className="text-primary">{selectedSlotId || "None selected"}</span>
            </h3>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleUploadNavigate}>
                <Upload className="mr-2 h-4 w-4" />
                Upload Media
              </Button>
              <Button size="sm" onClick={() => setIsMediaPickerOpen(true)} disabled={!selectedSlotId}>
                <Plus className="mr-2 h-4 w-4" />
                Add Media
              </Button>
            </div>
          </div>

          {selectedSlotId ? (
            <ScrollArea className="h-[360px] rounded-lg border p-3">
              {getSlotMedia(selectedSlotId).length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <ImageIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  <p className="text-sm">No media assigned to this slot</p>
                  <Button variant="link" size="sm" onClick={() => setIsMediaPickerOpen(true)}>
                    Add media
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {getSlotMedia(selectedSlotId).map((item, index) => (
                    <Card key={`${item.slotId}-${item.mediaId}`} className="p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex cursor-grab items-center gap-2 text-muted-foreground">
                          <GripVertical className="h-4 w-4" />
                          <span className="w-5 font-mono text-xs">{index + 1}</span>
                        </div>

                        <div className="flex-1 space-y-3 min-w-0">
                          <div className="flex gap-3">
                            <SlotMediaPreview item={item} className="h-24 w-32 flex-shrink-0" />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex items-center gap-2">
                                {getMediaIcon(item.mediaType)}
                                <span className="truncate text-sm font-medium">{item.mediaName}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {mediaTypeLabel(item.mediaType, item.mediaContentType)}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {item.fitMode}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  Display {item.durationSeconds}s
                                </Badge>
                                {item.mediaType === "VIDEO" && item.loopEnabled ? (
                                  <Badge variant="secondary" className="text-xs">
                                    Loop enabled
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Display time (sec)</Label>
                              <Input
                                type="number"
                                min={1}
                                value={item.durationSeconds}
                                onChange={(event) =>
                                  handleUpdateMediaSettings(item.slotId, item.mediaId, {
                                    durationSeconds: parseInt(event.target.value, 10) || 10,
                                  })
                                }
                                className="h-8"
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs">Fit mode</Label>
                              <Select
                                value={item.fitMode}
                                onValueChange={(value: "cover" | "contain") =>
                                  handleUpdateMediaSettings(item.slotId, item.mediaId, { fitMode: value })
                                }
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="cover">Cover</SelectItem>
                                  <SelectItem value="contain">Contain</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-[11px] text-muted-foreground">{FIT_MODE_HELP}</p>
                            </div>
                          </div>

                          {item.mediaType === "VIDEO" ? (
                            <div className="flex flex-wrap items-center gap-4">
                              <div className="flex items-center gap-2">
                                <Switch
                                  id={`audio-${item.mediaId}`}
                                  checked={item.audioEnabled}
                                  onCheckedChange={(checked) =>
                                    handleUpdateMediaSettings(item.slotId, item.mediaId, { audioEnabled: checked })
                                  }
                                />
                                <Label htmlFor={`audio-${item.mediaId}`} className="flex items-center gap-1 text-xs">
                                  {item.audioEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                                  Audio {item.audioEnabled ? "On" : "Off"}
                                </Label>
                              </div>

                              <div className="flex items-center gap-2">
                                <Switch
                                  id={`loop-${item.mediaId}`}
                                  checked={item.loopEnabled}
                                  onCheckedChange={(checked) =>
                                    handleUpdateMediaSettings(item.slotId, item.mediaId, { loopEnabled: checked })
                                  }
                                />
                                <Label htmlFor={`loop-${item.mediaId}`} className="flex items-center gap-1 text-xs">
                                  <Repeat className="h-3 w-3" />
                                  Loop video
                                </Label>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRemoveMedia(item.slotId, item.mediaId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          ) : null}

          {slotMedia.some((item) => item.audioEnabled) ? (
            <div className="flex items-center gap-2 rounded bg-muted/50 p-2 text-xs text-muted-foreground">
              <Volume2 className="h-4 w-4" />
              <span>Only one slot can have audio enabled at a time.</span>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={isMediaPickerOpen} onOpenChange={setIsMediaPickerOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>Select Media for "{selectedSlotId}"</DialogTitle>
              <Button size="sm" variant="outline" onClick={handleUploadNavigate}>
                <Upload className="mr-2 h-4 w-4" />
                Upload Media
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-[220px] flex-1">
                <SearchBar placeholder="Search media..." onSearch={setMediaSearch} />
              </div>
              <Tabs value={mediaTypeFilter} onValueChange={setMediaTypeFilter}>
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="image">Images</TabsTrigger>
                  <TabsTrigger value="video">Videos</TabsTrigger>
                  <TabsTrigger value="document">Documents</TabsTrigger>
                  <TabsTrigger value="webpage">Webpages</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <LoadingIndicator label="Loading media..." />
              </div>
            ) : (
              <ScrollArea className="h-[340px]">
                {filteredMedia.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <ImageIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    <p className="text-sm">No media found</p>
                    <Button variant="link" size="sm" onClick={handleUploadNavigate}>
                      Upload media
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 pr-4 sm:grid-cols-2">
                    {filteredMedia.map((media) => {
                      const mediaType = resolveMediaType(media);
                      return (
                        <Card
                          key={media.id}
                          onClick={() => handleAddMedia(media)}
                          className="cursor-pointer p-3 transition-all hover:border-primary/50 hover:shadow-md"
                        >
                          <div className="space-y-3">
                            <MediaPreview
                              media={media}
                              className="h-28 w-full"
                              videoControls={false}
                              videoMuted
                              videoAutoPlay={mediaType === "VIDEO"}
                            />
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground">
                                {getMediaIcon(mediaType)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{resolveMediaDisplayName(media)}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="text-xs">
                                    {mediaTypeLabel(mediaType, media.source_content_type ?? media.content_type)}
                                  </Badge>
                                  {typeof media.duration_seconds === "number" ? (
                                    <span className="text-xs text-muted-foreground">{media.duration_seconds}s</span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            )}

            {isFetching && !isLoading ? (
              <div className="text-xs text-muted-foreground">Refreshing media…</div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMediaPickerOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
