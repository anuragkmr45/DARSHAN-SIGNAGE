import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X,
  FileText,
  Image as ImageIcon,
  Calendar,
  Monitor,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Upload,
  Copy,
  Eye,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ContentTypeBadge, type ContentType } from "@/components/dashboard/ContentTypeBadge";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { scheduleRequestsApi } from "@/api/domains/scheduleRequests";
import { queryKeys } from "@/api/queryKeys";
import type { MediaAsset, ScheduleRequestListItem } from "@/api/types";
import { MediaPreview } from "@/components/common/MediaPreview";
import { resolveMediaDisplayName } from "@/lib/media";

interface RequestDetailDrawerProps {
  request: ScheduleRequestListItem;
  onClose: () => void;
}

type ActionType = "approve" | "reject" | "approve_publish" | "take_down";

type LayoutSlot = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

const formatRequestId = (id?: string | null) => (id ? `REQ-${id.slice(-12)}` : "REQ-—");

const getUserLabel = (user?: ScheduleRequestListItem["requested_by_user"] | null) => {
  if (!user) return "";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || user.email || user.id || "";
};

const resolveContentType = (media: MediaAsset): ContentType => {
  const type = media.type?.toUpperCase();
  if (type === "IMAGE") return "image";
  if (type === "VIDEO") return "video";
  if (type === "DOCUMENT") return "document";

  const contentType = media.content_type || media.source_content_type || "";
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("presentation") || contentType.includes("ppt")) return "pptx";
  if (contentType.includes("csv")) return "csv";
  if (contentType.includes("word") || contentType.includes("doc")) return "docx";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return "document";
};

const parseAspectRatio = (value?: string) => {
  if (!value) return 16 / 9;
  const parts = value.split(":").map((part) => Number(part));
  if (parts.length !== 2 || parts.some((part) => Number.isNaN(part) || part <= 0)) return 16 / 9;
  return parts[0] / parts[1];
};

const normalizeLayoutSlots = (spec?: unknown): LayoutSlot[] => {
  if (!spec) return [];
  if (Array.isArray(spec)) return spec as LayoutSlot[];
  if (typeof spec === "object" && spec && "slots" in spec) {
    const slots = (spec as { slots?: LayoutSlot[] }).slots;
    return Array.isArray(slots) ? slots : [];
  }
  return [];
};

export function RequestDetailDrawer({ request, onClose }: RequestDetailDrawerProps) {
  const { can, isAdminOrSuperAdmin, isLoading: isAuthzLoading } = useAuthorization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentRequest, setCurrentRequest] = useState(request);
  const [actionDialog, setActionDialog] = useState<ActionType | null>(null);
  const [actionComment, setActionComment] = useState("");
  const [previewMedia, setPreviewMedia] = useState<MediaAsset | null>(null);

  useEffect(() => {
    setCurrentRequest(request);
  }, [request]);

  const canApprove = can("approve", "ScheduleRequest") || can("manage", "ScheduleRequest");
  const canPublish = can("publish", "Schedule") || can("manage", "Schedule");
  const allowApprove = !isAuthzLoading && canApprove;
  const allowPublish = !isAuthzLoading && canPublish;
  const allowTakeDown = !isAuthzLoading && isAdminOrSuperAdmin;

  const mediaItems = useMemo(() => currentRequest.media ?? [], [currentRequest.media]);
  const presentations = useMemo(() => currentRequest.presentations ?? [], [currentRequest.presentations]);
  const presentationSlots = useMemo(
    () => currentRequest.presentation_slots ?? [],
    [currentRequest.presentation_slots],
  );
  const scheduleItems = useMemo(() => currentRequest.schedule_items ?? [], [currentRequest.schedule_items]);
  const screens = useMemo(() => currentRequest.screens ?? [], [currentRequest.screens]);
  const screenGroups = useMemo(() => currentRequest.screen_groups ?? [], [currentRequest.screen_groups]);

  const totalSlotDuration = presentationSlots.reduce((sum, slot) => sum + (slot.duration_seconds || 0), 0);

  const primaryPresentation = presentations[0];
  const layoutSpec = primaryPresentation?.layout?.spec;
  const layoutSlots = normalizeLayoutSlots(layoutSpec);
  const layoutAspectRatio = parseAspectRatio(primaryPresentation?.layout?.aspect_ratio);

  const slotsForPresentation = useMemo(() => {
    if (!primaryPresentation?.id) return presentationSlots;
    return presentationSlots.filter((slot) => slot.presentation_id === primaryPresentation.id);
  }, [presentationSlots, primaryPresentation?.id]);

  const mediaById = useMemo(() => new Map(mediaItems.map((media) => [media.id, media])), [mediaItems]);
  const slotMediaById = useMemo(() => {
    const map = new Map<string, MediaAsset | undefined>();
    slotsForPresentation.forEach((slot) => {
      map.set(slot.slot_id, mediaById.get(slot.media_id));
    });
    return map;
  }, [slotsForPresentation, mediaById]);

  const screenPreviewMedia = useMemo(() => {
    const first = slotMediaById.values().next();
    return first.done ? undefined : first.value;
  }, [slotMediaById]);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(currentRequest.id);
      toast({ title: "Copied", description: "Request ID copied to clipboard." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to copy request ID.";
      toast({ title: "Copy failed", description: message, variant: "destructive" });
    }
  };

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: ["schedule-requests"] });

  const approveMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      scheduleRequestsApi.approve(id, comment ? { comment } : undefined),
    onSuccess: (data) => {
      setCurrentRequest((prev) => ({
        ...prev,
        status: data.status ?? "APPROVED",
        review_notes: data.review_notes ?? prev.review_notes,
        reviewed_at: data.reviewed_at ?? prev.reviewed_at,
      }));
      void invalidateList();
      toast({ title: "Approved", description: "Schedule request approved." });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to approve request.";
      toast({ title: "Approve failed", description: message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      scheduleRequestsApi.reject(id, comment ? { comment } : undefined),
    onSuccess: (data) => {
      setCurrentRequest((prev) => ({
        ...prev,
        status: data.status ?? "REJECTED",
        review_notes: data.review_notes ?? prev.review_notes,
        reviewed_at: data.reviewed_at ?? prev.reviewed_at,
      }));
      void invalidateList();
      toast({ title: "Rejected", description: "Schedule request rejected." });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to reject request.";
      toast({ title: "Reject failed", description: message, variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => scheduleRequestsApi.publish(id),
    onSuccess: () => {
      setCurrentRequest((prev) => ({
        ...prev,
        status: "PUBLISHED",
      }));
      void invalidateList();
      toast({ title: "Published", description: "Schedule request published." });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to publish request.";
      toast({ title: "Publish failed", description: message, variant: "destructive" });
    },
  });

  const approvePublishMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment?: string }) => {
      await scheduleRequestsApi.approve(id, comment ? { comment } : undefined);
      return scheduleRequestsApi.publish(id);
    },
    onSuccess: () => {
      setCurrentRequest((prev) => ({
        ...prev,
        status: "PUBLISHED",
      }));
      void invalidateList();
      toast({ title: "Published", description: "Approved and published." });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to approve and publish.";
      toast({ title: "Publish failed", description: message, variant: "destructive" });
    },
  });

  const takeDownMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      scheduleRequestsApi.takeDown(id, reason ? { reason } : undefined),
    onSuccess: (data) => {
      setCurrentRequest((prev) => ({
        ...prev,
        status: data.status ?? "TAKEN_DOWN",
        taken_down_at: data.taken_down_at ?? prev.taken_down_at ?? new Date().toISOString(),
        taken_down_by: data.taken_down_by ?? prev.taken_down_by ?? null,
        takedown_reason: data.takedown_reason ?? prev.takedown_reason ?? null,
        reservation_summary: data.reservation_summary ?? prev.reservation_summary ?? null,
      }));
      void invalidateList();
      toast({
        title: "Schedule taken down",
        description: data.message ?? "Published schedule removed from targeted screens.",
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to take down schedule.";
      toast({ title: "Take down failed", description: message, variant: "destructive" });
    },
  });

  const statusUpper = (currentRequest.status || "").toUpperCase();
  const isExpiredRequest =
    statusUpper === "EXPIRED" || Boolean(currentRequest.schedule_time_status?.is_expired);
  const showPublishOnly = !isExpiredRequest && statusUpper === "APPROVED";
  const showActions = !isExpiredRequest && (statusUpper === "PENDING" || statusUpper === "APPROVED");
  const showTakeDownAction = statusUpper === "PUBLISHED";

  const isMutating =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    publishMutation.isPending ||
    approvePublishMutation.isPending ||
    takeDownMutation.isPending;

  const handleActionConfirm = () => {
    if (!actionDialog) return;
    const comment = actionComment.trim() || undefined;
    if (actionDialog === "approve") {
      approveMutation.mutate({ id: currentRequest.id, comment });
    }
    if (actionDialog === "reject") {
      rejectMutation.mutate({ id: currentRequest.id, comment });
    }
    if (actionDialog === "approve_publish") {
      approvePublishMutation.mutate({ id: currentRequest.id, comment });
    }
    if (actionDialog === "take_down") {
      takeDownMutation.mutate({ id: currentRequest.id, reason: comment });
    }
    setActionDialog(null);
    setActionComment("");
  };

  const handlePublish = () => {
    publishMutation.mutate(currentRequest.id);
  };

  const showScheduleOverview = Boolean(currentRequest.schedule);
  const showRequestNotes = Boolean(currentRequest.notes);
  const showReviewNotes = Boolean(currentRequest.review_notes);
  const requestedByLabel = getUserLabel(currentRequest.requested_by_user);
  const requestedDepartment = currentRequest.requested_by_user?.department?.name;
  const expiredLabel = currentRequest.schedule_time_status?.is_expired;
  const scheduleStatus = currentRequest.schedule_time_status?.status;
  const scheduleNow = currentRequest.schedule_time_status?.now;

  const scheduleTimingLine = currentRequest.schedule?.start_at || currentRequest.schedule?.end_at
    ? `${formatDateTime(currentRequest.schedule?.start_at)} → ${formatDateTime(currentRequest.schedule?.end_at)}`
    : "";

  return (
    <div className="flex w-full min-w-0 flex-col rounded-lg border border-border bg-background xl:w-[480px] xl:rounded-none xl:border-l xl:border-y-0 xl:border-r-0">
      {/* Header */}
      <div className="border-b border-border p-4 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mb-1 truncate text-xl font-bold text-foreground">
                {currentRequest.schedule?.name || "Schedule request"}
              </h2>
              <StatusBadge status={currentRequest.status} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="break-all">{formatRequestId(currentRequest.id)}</span>
              <Button variant="ghost" size="icon" onClick={handleCopyId} aria-label="Copy request ID">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Quick Actions */}
        {showActions && (
          <div className="flex flex-wrap gap-2">
            {showPublishOnly ? (
              <Button size="sm" variant="default" onClick={handlePublish} disabled={!allowPublish || isMutating}>
                <Upload className="h-4 w-4 mr-2" />
                Publish
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setActionDialog("reject")}
                  disabled={!allowApprove || isMutating}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActionDialog("approve")}
                  disabled={!allowApprove || isMutating}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setActionDialog("approve_publish")}
                  disabled={!allowApprove || !allowPublish || isMutating}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve & Publish
                </Button>
              </>
            )}
          </div>
        )}
        {showTakeDownAction && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setActionDialog("take_down")}
              disabled={!allowTakeDown || isMutating}
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Take Down Schedule
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="summary" className="flex-1 flex flex-col">
        <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto px-4 py-2 sm:px-6">
          <TabsTrigger value="summary">
            <FileText className="h-4 w-4 mr-1" />
            Summary
          </TabsTrigger>
          <TabsTrigger value="media">
            <ImageIcon className="h-4 w-4 mr-1" />
            Media
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <Calendar className="h-4 w-4 mr-1" />
            Schedule
          </TabsTrigger>
          <TabsTrigger value="screens">
            <Monitor className="h-4 w-4 mr-1" />
            Screens
          </TabsTrigger>
          <TabsTrigger value="activity">
            <MessageSquare className="h-4 w-4 mr-1" />
            Activity
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1">
          {/* Summary Tab */}
          <TabsContent value="summary" className="space-y-6 p-4 sm:p-6">
            {(requestedByLabel || currentRequest.created_at || currentRequest.updated_at || showRequestNotes || showReviewNotes) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Request Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {requestedByLabel && (
                      <div>
                        <p className="text-sm text-muted-foreground">Requested By</p>
                        <p className="font-medium">{requestedByLabel}</p>
                        {currentRequest.requested_by_user?.email && (
                          <p className="text-xs text-muted-foreground">
                            {currentRequest.requested_by_user.email}
                          </p>
                        )}
                      </div>
                    )}
                    {requestedDepartment && (
                      <div>
                        <p className="text-sm text-muted-foreground">Department</p>
                        <p className="font-medium">{requestedDepartment}</p>
                      </div>
                    )}
                    {currentRequest.created_at && (
                      <div>
                        <p className="text-sm text-muted-foreground">Created</p>
                        <p className="font-medium">{formatDateTime(currentRequest.created_at)}</p>
                      </div>
                    )}
                    {currentRequest.updated_at && (
                      <div>
                        <p className="text-sm text-muted-foreground">Updated</p>
                        <p className="font-medium">{formatDateTime(currentRequest.updated_at)}</p>
                      </div>
                    )}
                  </div>

                  {(showRequestNotes || showReviewNotes) && <Separator />}

                  {showRequestNotes && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Request Notes</p>
                      <div className="rounded-md border bg-muted/40 p-3 text-sm">
                        {currentRequest.notes}
                      </div>
                    </div>
                  )}

                  {showReviewNotes && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Review Notes</p>
                      <div className="rounded-md border bg-muted/40 p-3 text-sm">
                        {currentRequest.review_notes}
                      </div>
                    </div>
                  )}

                  {currentRequest.taken_down_at && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Take Down</p>
                      <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                        <p>Taken down at: {formatDateTime(currentRequest.taken_down_at)}</p>
                        {currentRequest.takedown_reason ? (
                          <p>Reason: {currentRequest.takedown_reason}</p>
                        ) : null}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {showScheduleOverview && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Schedule Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {currentRequest.schedule?.name && (
                    <div>
                      <p className="text-sm text-muted-foreground">Schedule Name</p>
                      <p className="font-medium">{currentRequest.schedule.name}</p>
                    </div>
                  )}
                  {currentRequest.schedule?.id && (
                    <div>
                      <p className="text-sm text-muted-foreground">Schedule ID</p>
                      <p className="text-xs font-mono">{currentRequest.schedule.id}</p>
                    </div>
                  )}
                  {scheduleTimingLine && (
                    <div className="text-sm text-muted-foreground">
                      {scheduleTimingLine}
                    </div>
                  )}
                  {scheduleStatus && (
                    <div>
                      <p className="text-sm text-muted-foreground">Schedule Status</p>
                      <p className="font-medium">{scheduleStatus}</p>
                    </div>
                  )}
                  {typeof expiredLabel === "boolean" && (
                    <div>
                      <p className="text-sm text-muted-foreground">Expired</p>
                      <p className="font-medium">{expiredLabel ? "Yes" : "No"}</p>
                    </div>
                  )}
                  {scheduleNow && (
                    <div>
                      <p className="text-sm text-muted-foreground">Checked At</p>
                      <p className="font-medium">{formatDateTime(scheduleNow)}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Media Tab */}
          <TabsContent value="media" className="space-y-4 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Media Items ({mediaItems.length})</h3>
            </div>

            {mediaItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No media linked to this request.</p>
            ) : (
              <div className="space-y-3">
                {mediaItems.map((media) => (
                  <Card key={media.id}>
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center gap-4">
                        <MediaPreview media={media} />
                        <div className="min-w-0 flex-1 space-y-1 sm:min-w-[220px]">
                          <p className="truncate text-sm font-medium">{resolveMediaDisplayName(media)}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <ContentTypeBadge type={resolveContentType(media)} />
                            {media.duration_seconds && (
                              <span className="text-xs text-muted-foreground">
                                Duration: {formatDuration(media.duration_seconds)}
                              </span>
                            )}
                          </div>
                          {(media.content_type || media.source_content_type) && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {(media.content_type || media.source_content_type) as string}
                            </p>
                          )}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setPreviewMedia(media)}>
                          <Eye className="h-4 w-4 mr-2" />
                          Preview
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {totalSlotDuration > 0 && (
              <div className="p-4 bg-muted rounded-lg text-sm">
                <p className="font-medium mb-1">Total Slot Duration</p>
                <p className="text-2xl font-bold text-primary">{formatDuration(totalSlotDuration)}</p>
              </div>
            )}

            {(presentationSlots.length > 0 || presentations.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Presentation Slots ({presentationSlots.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {presentationSlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No presentation slots provided.</p>
                  ) : (
                    presentationSlots.map((slot) => (
                      <div key={slot.id} className="rounded-md border p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">Slot {slot.slot_id}</Badge>
                          {slot.duration_seconds ? (
                            <Badge variant="secondary">{formatDuration(slot.duration_seconds)}</Badge>
                          ) : null}
                          <Badge variant="secondary">{slot.fit_mode}</Badge>
                          <Badge variant="secondary">Audio {slot.audio_enabled ? "On" : "Off"}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">Media ID: {slot.media_id}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            )}

            {presentations.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Presentations ({presentations.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {presentations.map((presentation) => (
                    <div key={presentation.id} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium">{presentation.name}</p>
                        <p className="text-xs text-muted-foreground">{presentation.id}</p>
                      </div>
                      {presentation.layout_id && <Badge variant="outline">Layout {presentation.layout_id}</Badge>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule" className="space-y-4 p-4 sm:p-6">
            {currentRequest.schedule && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Scheduling Window</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {currentRequest.schedule.start_at && (
                    <div>
                      <p className="text-sm text-muted-foreground">Start Date & Time</p>
                      <p className="font-medium mt-1">{formatDateTime(currentRequest.schedule.start_at)}</p>
                    </div>
                  )}
                  {currentRequest.schedule.end_at && (
                    <div>
                      <p className="text-sm text-muted-foreground">End Date & Time</p>
                      <p className="font-medium mt-1">{formatDateTime(currentRequest.schedule.end_at)}</p>
                    </div>
                  )}
                  {(currentRequest.schedule.start_at || currentRequest.schedule.end_at) && <Separator />}
                  {scheduleItems.length > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Schedule Items ({scheduleItems.length})</p>
                      <div className="space-y-2 mt-2">
                        {scheduleItems.map((item) => (
                          <div key={item.id} className="rounded-md border p-3 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">Priority {item.priority}</span>
                              <Badge variant="outline">{item.id}</Badge>
                            </div>
                            {(item.start_at || item.end_at) && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatDateTime(item.start_at)} → {formatDateTime(item.end_at)}
                              </p>
                            )}
                            {(item.screen_ids?.length || item.screen_group_ids?.length) && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Screens: {item.screen_ids?.length ?? 0} · Groups: {item.screen_group_ids?.length ?? 0}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Screens Tab */}
          <TabsContent value="screens" className="space-y-4 p-4 sm:p-6">
            {layoutSlots.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Layout Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="relative border-2 rounded-lg bg-muted/30 mx-auto"
                    style={{ width: 280, height: 280 / layoutAspectRatio }}
                  >
                    {layoutSlots.map((slot) => {
                      const media = slotMediaById.get(slot.id);
                      const mediaLabel = resolveMediaDisplayName(media);
                      const contentType = media?.content_type || media?.source_content_type || "";
                      const isImage =
                        Boolean(media?.media_url) &&
                        (media?.type === "IMAGE" || contentType.startsWith("image/"));
                      const isVideo =
                        Boolean(media?.media_url) &&
                        (media?.type === "VIDEO" || contentType.startsWith("video/"));
                      return (
                        <div
                          key={slot.id}
                          className="absolute border border-border/60 rounded-md bg-background/60 overflow-hidden"
                          style={{
                            left: `${slot.x * 100}%`,
                            top: `${slot.y * 100}%`,
                            width: `${slot.w * 100}%`,
                            height: `${slot.h * 100}%`,
                          }}
                        >
                          {isImage ? (
                            <img
                              src={media?.media_url ?? ""}
                              alt={mediaLabel || "Media"}
                              className="h-full w-full object-cover"
                            />
                          ) : isVideo ? (
                            <video
                              src={media?.media_url ?? ""}
                              className="h-full w-full object-cover"
                              muted
                              preload="metadata"
                            />
                          ) : (
                            <div className="h-full w-full flex flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted-foreground">
                              <Badge variant="secondary" className="text-[10px]">
                                {slot.id}
                              </Badge>
                              {mediaLabel ? (
                                <>
                                  <span className="font-medium text-foreground truncate max-w-full">
                                    {mediaLabel}
                                  </span>
                                  <span>{media?.type || "Media"}</span>
                                </>
                              ) : (
                                <span>Empty</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {screens.length > 0 && (
              <div>
                <h3 className="font-semibold mb-3">Target Screens ({screens.length})</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {screens.map((screen) => (
                    <div
                      key={screen.id}
                      className="aspect-[9/16] bg-muted rounded-lg border border-border/50 p-3 flex flex-col"
                    >
                      <div className="flex-1 w-full overflow-hidden rounded-md border border-border/30 mb-3">
                          {screenPreviewMedia ? (
                            <MediaPreview media={screenPreviewMedia} className="w-full h-full object-cover" />
                          ) : (
                          <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                            No preview
                          </div>
                        )}
                      </div>
                      <div className="space-y-1 text-center">
                        <p className="text-xs font-medium">{screen.name}</p>
                        <p className="text-xs text-muted-foreground">{screen.id}</p>
                        {screen.status && (
                          <Badge variant="secondary" className="mt-1 text-[10px]">
                            {screen.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {screenGroups.length > 0 && (
              <div>
                <Separator />
                <h3 className="font-semibold mb-3">Screen Groups ({screenGroups.length})</h3>
                <div className="space-y-2">
                  {screenGroups.map((group) => (
                    <div key={group.id} className="rounded-md border p-3 text-sm">
                      <p className="font-medium">{group.name}</p>
                      <p className="text-xs text-muted-foreground">{group.id}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="space-y-4 p-4 sm:p-6">
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No activity data is provided by the schedule-requests API.
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <Dialog open={!!actionDialog} onOpenChange={(open) => (open ? null : setActionDialog(null))}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {actionDialog === "approve" && "Approve request"}
              {actionDialog === "reject" && "Reject request"}
              {actionDialog === "approve_publish" && "Approve & publish"}
              {actionDialog === "take_down" && "Take down published schedule"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {actionDialog === "take_down"
                ? "This published schedule will be removed from all targeted screens. If another published schedule still applies, it will become active automatically; otherwise the screen falls back to default media."
                : "Add an optional note for this action."}
            </p>
            <label className="text-sm text-muted-foreground">
              {actionDialog === "take_down" ? "Reason (optional)" : "Comment (optional)"}
            </label>
            <Textarea
              value={actionComment}
              onChange={(event) => setActionComment(event.target.value)}
              placeholder={
                actionDialog === "take_down"
                  ? "Add an optional takedown note"
                  : "Add a note for this action"
              }
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)} disabled={isMutating}>
              Cancel
            </Button>
            <Button onClick={handleActionConfirm} disabled={isMutating}>
              {isMutating ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewMedia} onOpenChange={(open) => (open ? null : setPreviewMedia(null))}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{resolveMediaDisplayName(previewMedia) || "Media preview"}</DialogTitle>
          </DialogHeader>
          {previewMedia?.media_url ? (
            previewMedia.media_url && previewMedia.type === "VIDEO" ? (
              <video src={previewMedia.media_url} className="w-full max-h-[480px]" controls preload="metadata" />
            ) : (
              <img
                src={previewMedia.media_url}
                alt={resolveMediaDisplayName(previewMedia) || "Media"}
                className="w-full max-h-[480px] object-contain"
              />
            )
          ) : (
            <div className="rounded-md border bg-muted/40 p-6 text-sm text-muted-foreground">
              No preview available for this media asset.
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewMedia(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
