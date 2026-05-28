import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Globe, Image as ImageIcon, MonitorPlay, Upload, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { mediaApi } from "@/api/domains/media";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import {
  useDefaultMediaTargets,
  useUpdateDefaultMediaTargets,
} from "@/hooks/useSettingsApi";
import { useToast } from "@/hooks/use-toast";
import { useAuthorization } from "@/hooks/useAuthorization";
import { ApiError } from "@/api/apiClient";
import type {
  DefaultMediaTargetAssignment,
  MediaAsset,
  MediaType,
  Screen,
  ScreenGroup,
} from "@/api/types";
import { resolveMediaDisplayName } from "@/lib/media";

const MEDIA_PAGE_SIZE = 100;
const TARGETS_PAGE_SIZE = 100;

type PickerContext =
  | { type: "SCREEN"; targetIds: string[]; aspectRatio: string }
  | { type: "GROUP"; targetIds: string[]; aspectRatio: string };

type RemoveContext = {
  targetType: "SCREEN" | "GROUP";
  targetId: string;
  label: string;
} | null;

const resolveMediaType = (media: MediaAsset): MediaType => {
  if (media.type) {
    const type = media.type.toUpperCase();
    if (type === "IMAGE" || type === "VIDEO" || type === "DOCUMENT" || type === "WEBPAGE") {
      return type as MediaType;
    }
  }
  const contentType = media.content_type || media.source_content_type || "";
  if (contentType.startsWith("image/")) return "IMAGE";
  if (contentType.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
};

const MediaPreview = ({ media, mediaType, sizeClass }: { media: MediaAsset; mediaType: MediaType; sizeClass: string }) => {
  if (!media.media_url) {
    return (
      <div className={`${sizeClass} rounded-md bg-muted flex items-center justify-center text-muted-foreground`}>
        {mediaType === "IMAGE" ? (
          <ImageIcon className="h-5 w-5" />
        ) : mediaType === "VIDEO" ? (
          <Video className="h-5 w-5" />
        ) : mediaType === "WEBPAGE" ? (
          <Globe className="h-5 w-5" />
        ) : (
          <FileText className="h-5 w-5" />
        )}
      </div>
    );
  }

  if (mediaType === "IMAGE") {
    return (
      <div className={`${sizeClass} rounded-md overflow-hidden bg-muted`}>
        <img src={media.media_url} alt={resolveMediaDisplayName(media)} className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }

  if (mediaType === "VIDEO") {
    return (
      <div className={`${sizeClass} rounded-md overflow-hidden bg-muted`}>
        <video src={media.media_url} className="h-full w-full object-cover" muted preload="metadata" />
      </div>
    );
  }

  if (mediaType === "WEBPAGE") {
    return (
      <div className={`${sizeClass} rounded-md overflow-hidden bg-muted`}>
        <img src={media.media_url} alt={resolveMediaDisplayName(media)} className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }

  return (
    <div className={`${sizeClass} rounded-md bg-muted flex items-center justify-center text-muted-foreground`}>
      <FileText className="h-5 w-5" />
    </div>
  );
};

const resolveScreenAspectRatio = (screen: Screen) => {
  if (screen.aspect_ratio?.trim()) return screen.aspect_ratio.trim();
  const width = screen.width ?? null;
  const height = screen.height ?? null;
  if (!width || !height) return null;

  const gcd = (a: number, b: number): number => {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y !== 0) {
      const temp = y;
      y = x % y;
      x = temp;
    }
    return x || 1;
  };

  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
};

const resolveTargetLabel = (
  assignment: DefaultMediaTargetAssignment,
  screensMap: Map<string, Screen>,
  groupsMap: Map<string, ScreenGroup>,
) => {
  if (assignment.target_type === "SCREEN") {
    return screensMap.get(assignment.target_id)?.name ?? "Unknown screen";
  }
  return groupsMap.get(assignment.target_id)?.name ?? "Unknown group";
};

async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total?: number; pagination?: { total?: number } }>,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let total: number | undefined;

  while (true) {
    const response = await fetchPage(page);
    const pageItems = Array.isArray(response.items) ? response.items : [];
    items.push(...pageItems);

    const reportedTotal = response.pagination?.total ?? response.total;
    total = typeof reportedTotal === "number" ? reportedTotal : total;

    if (pageItems.length < TARGETS_PAGE_SIZE) {
      break;
    }

    if (typeof total === "number" && items.length >= total) {
      break;
    }

    page += 1;
  }

  return items;
}

export function DefaultMediaSection() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { can } = useAuthorization();
  const canEdit = can("update", "OrgSettings");

  const [targetMode, setTargetMode] = useState<"SCREEN" | "GROUP">("SCREEN");
  const [selectedScreenIds, setSelectedScreenIds] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [pickerContext, setPickerContext] = useState<PickerContext | null>(null);
  const [removeContext, setRemoveContext] = useState<RemoveContext>(null);
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("all");

  const assignmentsQuery = useDefaultMediaTargets();
  const updateAssignments = useUpdateDefaultMediaTargets();

  const screensQuery = useQuery({
    queryKey: queryKeys.defaultMediaScreens,
    queryFn: () =>
      fetchAllPages((page) =>
        screensApi.list({ page, limit: TARGETS_PAGE_SIZE }) as Promise<{
          items: Screen[];
          total?: number;
          pagination?: { total?: number };
        }>,
      ),
    staleTime: 60_000,
  });

  const groupsQuery = useQuery({
    queryKey: queryKeys.defaultMediaScreenGroups,
    queryFn: () =>
      fetchAllPages((page) =>
        screensApi.listGroups({ page, limit: TARGETS_PAGE_SIZE }) as Promise<{
          items: ScreenGroup[];
          total?: number;
          pagination?: { total?: number };
        }>,
      ),
    staleTime: 60_000,
  });

  const isPickerOpen = pickerContext !== null;
  const typeFilter = (mediaTypeFilter === "all" ? undefined : mediaTypeFilter.toUpperCase()) as MediaType | undefined;

  const mediaListQuery = useQuery({
    queryKey: ["media", "default-media-picker", typeFilter],
    queryFn: () => mediaApi.list({ limit: MEDIA_PAGE_SIZE, page: 1, status: "READY", type: typeFilter }),
    enabled: isPickerOpen,
    keepPreviousData: true,
  });

  useEffect(() => {
    const error = assignmentsQuery.error || screensQuery.error || groupsQuery.error || mediaListQuery.error;
    if (!error) return;
    const message = error instanceof ApiError ? error.message : "Unable to load default media settings.";
    toast({ title: "Load failed", description: message, variant: "destructive" });
  }, [assignmentsQuery.error, screensQuery.error, groupsQuery.error, mediaListQuery.error, toast]);

  const screens = useMemo(() => (Array.isArray(screensQuery.data) ? screensQuery.data : []), [screensQuery.data]);
  const groups = useMemo(() => (Array.isArray(groupsQuery.data) ? groupsQuery.data : []), [groupsQuery.data]);
  const assignments = useMemo(
    () => (Array.isArray(assignmentsQuery.data?.assignments) ? assignmentsQuery.data.assignments : []),
    [assignmentsQuery.data],
  );
  const screensMap = useMemo(() => new Map(screens.map((screen) => [screen.id, screen])), [screens]);
  const groupsMap = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  const selectedScreens = useMemo(
    () => selectedScreenIds.map((id) => screensMap.get(id)).filter((screen): screen is Screen => Boolean(screen)),
    [selectedScreenIds, screensMap],
  );

  const selectedScreenAspectRatios = useMemo(
    () => Array.from(new Set(selectedScreens.map((screen) => resolveScreenAspectRatio(screen)).filter((value): value is string => Boolean(value)))),
    [selectedScreens],
  );

  const selectedGroup = selectedGroupId ? groupsMap.get(selectedGroupId) ?? null : null;
  const selectedGroupScreens = useMemo(
    () => (selectedGroup?.screen_ids ?? []).map((id) => screensMap.get(id)).filter((screen): screen is Screen => Boolean(screen)),
    [selectedGroup, screensMap],
  );
  const selectedGroupAspectRatios = useMemo(
    () => Array.from(new Set(selectedGroupScreens.map((screen) => resolveScreenAspectRatio(screen)).filter((value): value is string => Boolean(value)))),
    [selectedGroupScreens],
  );

  const targetAspectRatio =
    targetMode === "SCREEN"
      ? selectedScreenAspectRatios.length === 1
        ? selectedScreenAspectRatios[0]
        : null
      : selectedGroupAspectRatios.length === 1
        ? selectedGroupAspectRatios[0]
        : null;

  const targetValidationMessage = useMemo(() => {
    if (targetMode === "SCREEN") {
      if (selectedScreenIds.length === 0) return "Select at least one screen.";
      if (selectedScreenAspectRatios.length !== 1) {
        return "Selected screens must all have the same aspect ratio.";
      }
      return null;
    }

    if (!selectedGroup) return "Select a screen group.";
    if ((selectedGroup.screen_ids ?? []).length === 0) return "Selected group has no screens.";
    if (selectedGroupAspectRatios.length !== 1) {
      return "All screens in the selected group must share the same aspect ratio.";
    }
    return null;
  }, [targetMode, selectedScreenIds.length, selectedScreenAspectRatios.length, selectedGroup, selectedGroupAspectRatios.length]);

  const mediaItems = useMemo(
    () => (Array.isArray(mediaListQuery.data?.items) ? mediaListQuery.data.items : []),
    [mediaListQuery.data],
  );
  const filteredMedia = useMemo(() => {
    const query = mediaSearch.trim().toLowerCase();
    if (!query) return mediaItems;
    return mediaItems.filter((item) => resolveMediaDisplayName(item).toLowerCase().includes(query));
  }, [mediaItems, mediaSearch]);

  const assignmentsByKey = useMemo(
    () =>
      assignments.reduce<Record<string, DefaultMediaTargetAssignment>>((acc, assignment) => {
        acc[`${assignment.target_type}:${assignment.target_id}`] = assignment;
        return acc;
      }, {}),
    [assignments],
  );

  const sanitizeAssignments = (items: DefaultMediaTargetAssignment[]) => {
    const dropped: DefaultMediaTargetAssignment[] = [];
    const kept = items.filter((assignment) => {
      const exists =
        assignment.target_type === "SCREEN"
          ? screensMap.has(assignment.target_id)
          : groupsMap.has(assignment.target_id);

      if (!exists) {
        dropped.push(assignment);
      }

      return exists;
    });

    return { kept, dropped };
  };

  const updateAssignmentList = (nextAssignments: DefaultMediaTargetAssignment[]) => {
    const { kept, dropped } = sanitizeAssignments(nextAssignments);

    if (dropped.length > 0) {
      toast({
        title: "Some old targets were removed",
        description:
          "One or more previously assigned screens or groups no longer exist. They were removed before saving.",
      });
    }

    updateAssignments.mutate(kept, {
      onSuccess: () => {
        setPickerContext(null);
        setRemoveContext(null);
      },
      onError: (error) => {
        const message =
          error instanceof ApiError && /screen not found|screen group not found/i.test(error.message)
            ? "One or more selected screens or groups no longer exist. Refresh the page and try again."
            : error instanceof ApiError
              ? error.message
              : "Unable to save default media targets.";

        toast({
          title: "Save failed",
          description: message,
          variant: "destructive",
        });
      },
    });
  };

  const openPicker = () => {
    if (!canEdit) return;
    if (targetValidationMessage || !targetAspectRatio) {
      toast({ title: "Invalid target selection", description: targetValidationMessage ?? "Select a valid target first.", variant: "destructive" });
      return;
    }

    setPickerContext({
      type: targetMode,
      targetIds: targetMode === "SCREEN" ? selectedScreenIds : [selectedGroupId],
      aspectRatio: targetAspectRatio,
    });
  };

  const handleSelectMedia = (media: MediaAsset) => {
    if (!pickerContext) return;

    const nextAssignments = assignments.filter(
      (assignment) =>
        !pickerContext.targetIds.some(
          (targetId) => assignment.target_type === pickerContext.type && assignment.target_id === targetId,
        ),
    );

    updateAssignmentList([
      ...nextAssignments,
      ...pickerContext.targetIds.map((targetId) => ({
        target_type: pickerContext.type,
        target_id: targetId,
        media_id: media.id,
        aspect_ratio: pickerContext.aspectRatio,
      })),
    ]);
  };

  const handleRemove = () => {
    if (!removeContext) return;
    const nextAssignments = assignments.filter(
      (assignment) =>
        !(assignment.target_type === removeContext.targetType && assignment.target_id === removeContext.targetId),
    );
    updateAssignmentList(nextAssignments);
  };

  const toggleScreenSelection = (screenId: string, checked: boolean) => {
    setSelectedScreenIds((current) =>
      checked ? Array.from(new Set([...current, screenId])) : current.filter((id) => id !== screenId),
    );
  };

  const handleUploadNavigate = () => {
    setPickerContext(null);
    navigate("/media");
  };

  const targetCards = assignments.map((assignment) => {
    const label = resolveTargetLabel(assignment, screensMap, groupsMap);
    return {
      ...assignment,
      label,
      key: `${assignment.target_type}:${assignment.target_id}`,
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default Media</CardTitle>
        <CardDescription>
          Assign fallback media to specific screens or groups only. Multi-screen selections are allowed only when all selected screens share the same aspect ratio.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Scope rules</p>
          <p>1. Default media is used only for the screens or groups you assign here.</p>
          <p>2. Screen groups must contain screens with a single shared aspect ratio.</p>
          <p>3. Untargeted screens stay empty when nothing is scheduled.</p>
        </div>

        <Tabs value={targetMode} onValueChange={(value) => setTargetMode(value as "SCREEN" | "GROUP")}>
          <TabsList>
            <TabsTrigger value="SCREEN">Specific Screens</TabsTrigger>
            <TabsTrigger value="GROUP">Screen Group</TabsTrigger>
          </TabsList>
        </Tabs>

        {targetMode === "SCREEN" ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">Select screens</h3>
                <p className="text-sm text-muted-foreground">Choose one or more screens with the same aspect ratio.</p>
              </div>
              {targetAspectRatio && <Badge variant="secondary">{targetAspectRatio}</Badge>}
            </div>

            <ScrollArea className="h-56 rounded-md border">
              <div className="space-y-2 p-3">
                {screensQuery.isLoading ? (
                  Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)
                ) : screens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No screens found.</p>
                ) : (
                  screens.map((screen) => {
                    const assignment = assignmentsByKey[`SCREEN:${screen.id}`];
                    const aspectRatio = resolveScreenAspectRatio(screen) ?? "Unknown";
                    return (
                      <label key={screen.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Checkbox
                            checked={selectedScreenIds.includes(screen.id)}
                            onCheckedChange={(checked) => toggleScreenSelection(screen.id, Boolean(checked))}
                            disabled={!canEdit}
                          />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{screen.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{screen.location || "No location"} · {aspectRatio}</p>
                          </div>
                        </div>
                        {assignment && <Badge variant="outline">{resolveMediaDisplayName(assignment.media ?? { name: assignment.media_id })}</Badge>}
                      </label>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">Select a group</h3>
                <p className="text-sm text-muted-foreground">The group must contain screens with one shared aspect ratio.</p>
              </div>
              {targetAspectRatio && <Badge variant="secondary">{targetAspectRatio}</Badge>}
            </div>

            <div className="space-y-3 rounded-md border p-4">
              <div className="space-y-2">
                <Label htmlFor="default-media-group">Screen group</Label>
                <Select value={selectedGroupId} onValueChange={setSelectedGroupId} disabled={!canEdit}>
                  <SelectTrigger id="default-media-group">
                    <SelectValue placeholder="Select a group" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedGroup && (
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <p className="font-medium">{selectedGroup.name}</p>
                  <p className="text-muted-foreground">{(selectedGroup.screen_ids ?? []).length} screens in this group</p>
                  {selectedGroupScreens.length > 0 && (
                    <p className="text-muted-foreground mt-1">
                      Aspect ratios: {selectedGroupAspectRatios.join(", ") || "Unknown"}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={openPicker} disabled={!canEdit || Boolean(targetValidationMessage) || updateAssignments.isPending}>
            Assign media
          </Button>
          {targetValidationMessage && <p className="text-sm text-destructive">{targetValidationMessage}</p>}
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Current assignments</h3>
              <p className="text-sm text-muted-foreground">These defaults apply only to the listed targets and matching aspect ratios.</p>
            </div>
            <Badge variant="outline">{targetCards.length}</Badge>
          </div>

          {assignmentsQuery.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => <Skeleton key={index} className="h-36 w-full" />)}
            </div>
          ) : targetCards.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No default media assignments configured.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {targetCards.map((assignment) => {
                const media = assignment.media;
                const mediaType = media ? resolveMediaType(media) : "DOCUMENT";
                return (
                  <Card key={assignment.key}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <MonitorPlay className="h-4 w-4 text-muted-foreground" />
                            <p className="font-medium">{assignment.label}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {assignment.target_type === "SCREEN" ? "Screen" : "Group"} · {assignment.aspect_ratio}
                          </p>
                        </div>
                        <Badge variant={assignment.target_type === "GROUP" ? "secondary" : "outline"}>
                          {assignment.target_type === "GROUP" ? "Group" : "Screen"}
                        </Badge>
                      </div>

                      {media ? (
                        <div className="flex items-center gap-3 rounded-md border p-3">
                          <MediaPreview media={media} mediaType={mediaType} sizeClass="h-20 w-24" />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{resolveMediaDisplayName(media)}</p>
                            <p className="text-xs text-muted-foreground">{mediaType}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Media not found.</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setRemoveContext({
                              targetType: assignment.target_type,
                              targetId: assignment.target_id,
                              label: assignment.label,
                            })
                          }
                          disabled={!canEdit || updateAssignments.isPending}
                        >
                          Clear
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {!canEdit && <p className="text-xs text-muted-foreground">Only users with organization settings access can update default media.</p>}
      </CardContent>

      <Dialog open={isPickerOpen} onOpenChange={(open) => !open && setPickerContext(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>
                Select media for {pickerContext?.type === "GROUP" ? "group" : "screen selection"} {pickerContext ? `(${pickerContext.aspectRatio})` : ""}
              </DialogTitle>
              <Button size="sm" variant="outline" onClick={handleUploadNavigate}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Media
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1 min-w-[200px]">
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

            {mediaListQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <LoadingIndicator label="Loading media..." />
              </div>
            ) : (
              <ScrollArea className="h-[320px]">
                {filteredMedia.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No media found</p>
                    <Button variant="link" size="sm" onClick={handleUploadNavigate}>
                      Upload media
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {filteredMedia.map((media) => {
                      const mediaType = resolveMediaType(media);
                      return (
                        <Card
                          key={media.id}
                          onClick={() => handleSelectMedia(media)}
                          className="cursor-pointer p-3 transition-all hover:border-primary/50 hover:shadow-md"
                        >
                          <div className="space-y-3">
                            <MediaPreview media={media} mediaType={mediaType} sizeClass="h-24 w-full" />
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-muted-foreground">
                                {mediaType === "IMAGE" ? (
                                  <ImageIcon className="h-4 w-4" />
                                ) : mediaType === "VIDEO" ? (
                                  <Video className="h-4 w-4" />
                                ) : mediaType === "WEBPAGE" ? (
                                  <Globe className="h-4 w-4" />
                                ) : (
                                  <FileText className="h-4 w-4" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">{resolveMediaDisplayName(media)}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    {mediaType}
                                  </Badge>
                                  {media.duration_seconds && <span className="text-xs text-muted-foreground">{media.duration_seconds}s</span>}
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
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeContext)}
        title="Clear default media assignment?"
        description={
          removeContext
            ? `This removes the default media assignment for ${removeContext.label}.`
            : ""
        }
        confirmLabel="Clear"
        onConfirm={handleRemove}
        onCancel={() => setRemoveContext(null)}
        isLoading={updateAssignments.isPending}
      />
    </Card>
  );
}
