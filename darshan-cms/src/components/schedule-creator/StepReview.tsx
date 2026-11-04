import {
  LayoutGrid,
  Image,
  Volume2,
  VolumeX,
  Clock,
  Layers,
  Repeat,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import { MediaPreview } from "@/components/common/MediaPreview";
import { AspectFrame } from "@/components/common/AspectFrame";
import type { ScheduleWizardState, SlotMedia } from "@/pages/ScheduleCreator";
import { resolveSlotMediaPreviewOptions, resolveVideoLoopLabel } from "@/lib/scheduleCreatorState";
import { browserScheduleTimeZone, normalizeScheduleTimeZone } from "@/lib/scheduleTimeZone";

interface StepReviewProps {
  state: ScheduleWizardState;
  approvalNotes: string;
  onUpdateNotes: (notes: string) => void;
  validationErrors: string[];
  isCheckingAvailability: boolean;
  onRecheckAvailability: () => void;
}

function SlotMediaPreview({ item, className }: { item: SlotMedia; className: string }) {
  const previewOptions = resolveSlotMediaPreviewOptions(item);
  return (
    <MediaPreview
      url={item.mediaUrl ?? item.mediaThumbnail}
      type={item.mediaContentType ?? item.mediaType}
      alt={item.mediaName}
      className={className}
      fit={item.fitMode}
      videoControls={false}
      videoMuted
      videoAutoPlay={item.mediaType === "VIDEO"}
      videoLoop={previewOptions.videoLoop}
      pdfPage={previewOptions.pdfPage}
    />
  );
}

function LayoutPreview({ state }: { state: ScheduleWizardState }) {
  const { selectedLayout, slotMedia } = state;
  if (!selectedLayout) return null;

  const getSlotMedia = (slotId: string): SlotMedia[] =>
    slotMedia.filter((item) => item.slotId === slotId).sort((left, right) => left.order - right.order);

  return (
    <AspectFrame aspectRatio={selectedLayout.aspect_ratio} className="relative w-full overflow-hidden rounded-lg border-2 border-dashed border-border bg-muted/30">
      {selectedLayout.spec.slots.map((slot) => {
        const mediaItems = getSlotMedia(slot.id);
        const primaryMedia = mediaItems[0];

        return (
          <div
            key={slot.id}
            className="absolute flex flex-col overflow-hidden rounded-md border border-border bg-background"
            style={{
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${slot.w * 100}%`,
              height: `${slot.h * 100}%`,
            }}
          >
            <div className="flex items-center justify-between border-b bg-muted/50 px-2 py-1 text-xs">
              <span className="truncate font-medium">{slot.id}</span>
              <Badge variant="secondary" className="h-4 text-[10px]">
                {mediaItems.length} item{mediaItems.length === 1 ? "" : "s"}
              </Badge>
            </div>

            <div className="relative flex-1 overflow-hidden p-1">
              {primaryMedia ? (
                <>
                  <SlotMediaPreview item={primaryMedia} className="h-full w-full" />
                  <div className="absolute bottom-2 right-2 flex flex-wrap gap-1">
                    {primaryMedia.mediaType === "VIDEO" ? (
                      <Badge variant="secondary" className="h-5 text-[10px]">
                        <Repeat className="mr-1 h-3 w-3" />
                        {resolveVideoLoopLabel(primaryMedia.mediaType, primaryMedia.loopEnabled)}
                      </Badge>
                    ) : null}
                    {primaryMedia.audioEnabled ? (
                      <Badge variant="secondary" className="h-5 text-[10px]">
                        <Volume2 className="mr-1 h-3 w-3" />
                        Audio
                      </Badge>
                    ) : null}
                    {mediaItems.length > 1 ? (
                      <Badge variant="secondary" className="h-5 text-[10px]">
                        +{mediaItems.length - 1} more
                      </Badge>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
                  Empty
                </div>
              )}
            </div>
          </div>
        );
      })}
    </AspectFrame>
  );
}

function MediaDetailsCard({
  slotMedia,
  selectedLayout,
}: {
  slotMedia: SlotMedia[];
  selectedLayout: ScheduleWizardState["selectedLayout"];
}) {
  if (!selectedLayout) return null;

  const slots = selectedLayout.spec.slots.map((slot) => ({
    ...slot,
    media: slotMedia.filter((item) => item.slotId === slot.id).sort((left, right) => left.order - right.order),
  }));

  return (
    <div className="space-y-3">
      {slots.map((slot) => (
        <div key={slot.id} className="rounded-lg border bg-card p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <span className="font-medium">Slot: {slot.id}</span>
            </div>
            <Badge variant={slot.media.length > 0 ? "default" : "secondary"}>
              {slot.media.length} media
            </Badge>
          </div>

          {slot.media.length > 0 ? (
            <div className="space-y-2">
              {slot.media.map((item, index) => (
                <div
                  key={item.clientItemId}
                  className="flex items-center gap-3 rounded-md bg-muted/50 p-2"
                >
                  <SlotMediaPreview item={item} className="h-14 w-16 flex-shrink-0" />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
                      <span className="truncate text-sm font-medium">{item.mediaName}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {item.mediaType}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {item.fitMode}
                      </Badge>
                      {item.mediaType === "DOCUMENT" ? (
                        <Badge variant="secondary" className="text-xs">
                          Page {item.pageNumber ?? 1}{item.pageCount ? ` of ${item.pageCount}` : ""}
                        </Badge>
                      ) : null}
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Display {item.durationSeconds}s
                      </div>
                      {item.mediaType === "VIDEO" ? (
                        <div className={`flex items-center gap-1 text-xs ${item.loopEnabled ? "text-primary" : "text-muted-foreground"}`}>
                          <Repeat className="h-3 w-3" />
                          {resolveVideoLoopLabel(item.mediaType, item.loopEnabled)}
                        </div>
                      ) : null}
                      {item.audioEnabled ? (
                        <div className="flex items-center gap-1 text-xs text-primary">
                          <Volume2 className="h-3 w-3" />
                          Audio on
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <VolumeX className="h-3 w-3" />
                          Muted
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">No media assigned to this slot.</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function StepReview({ state, approvalNotes, onUpdateNotes, validationErrors, isCheckingAvailability, onRecheckAvailability }: StepReviewProps) {
  const {
    selectedLayout,
    slotMedia,
    selectedScreenIds,
    selectedGroupIds,
    scheduleName,
    scheduleDescription,
    timezone,
    startAt,
    endAt,
    priority,
  } = state;

  const { data: screensData } = useQuery({
    queryKey: queryKeys.screens,
    queryFn: () => screensApi.list({ page: 1, limit: 100 }),
    refetchOnMount: "always",
  });
  const { data: groupsData } = useQuery({
    queryKey: queryKeys.screenGroups,
    queryFn: () => screensApi.listGroups({ page: 1, limit: 100 }),
    refetchOnMount: "always",
  });
  const screenNames = new Map((screensData?.items ?? []).map((screen) => [screen.id, screen.name]));
  const groupNames = new Map((groupsData?.items ?? []).map((group) => [group.id, group.name]));
  const browserTimezone = browserScheduleTimeZone();

  const priorityLabel = ["Normal", "High", "Urgent"][priority] || "Normal";

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return "Not set";
    const date = new Date(dateStr);
    return Number.isNaN(date.getTime()) ? "Invalid time" : date.toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Review schedule</h2>
        <p className="text-sm text-muted-foreground">Confirm what will play, where, and when.</p>
      </div>

      <section aria-label="Schedule summary" className="divide-y divide-border rounded-lg border border-border bg-card">
        <div className="grid gap-2 p-4 sm:grid-cols-[8rem_1fr]">
          <h3 className="font-medium">Content</h3>
          <div className="min-w-0 space-y-2 break-words text-sm">
            <p><span className="font-medium">{selectedLayout?.name || "No layout selected"}</span> · {slotMedia.length} media item{slotMedia.length === 1 ? "" : "s"}</p>
            <ul className="space-y-1 text-muted-foreground">
              {slotMedia.map((item) => (
                <li key={item.clientItemId}>
                  {item.slotId}: {item.mediaName}{item.mediaType === "DOCUMENT" ? ` · page ${item.pageNumber ?? 1}${item.pageCount ? ` of ${item.pageCount}` : ""}` : ""}
                  {item.mediaType === "VIDEO" ? ` · loop ${item.loopEnabled ? "on" : "off"}` : ""}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid gap-2 p-4 sm:grid-cols-[8rem_1fr]">
          <h3 className="font-medium">Audience</h3>
          <div className="min-w-0 space-y-1 break-words text-sm">
            {selectedScreenIds.map((id) => <p key={id}>Screen: <span className="font-medium">{screenNames.get(id) || id}</span></p>)}
            {selectedGroupIds.map((id) => <p key={id}>Group: <span className="font-medium">{groupNames.get(id) || id}</span></p>)}
            {selectedScreenIds.length + selectedGroupIds.length === 0 ? <p className="text-destructive">No targets selected</p> : null}
            {selectedGroupIds.length > 0 ? <p className="text-xs text-muted-foreground">Group membership is resolved when the request is submitted.</p> : null}
          </div>
        </div>

        <div className="grid gap-2 p-4 sm:grid-cols-[8rem_1fr]">
          <h3 className="font-medium">Timing</h3>
          <div className="min-w-0 space-y-1 break-words text-sm">
            <p className="font-medium">{scheduleName || "Unnamed schedule"}</p>
            <p>{formatDateTime(startAt)} → {formatDateTime(endAt)}</p>
            <p className="text-muted-foreground">Times entered in browser time ({browserTimezone}). Recorded audit timezone: {normalizeScheduleTimeZone(timezone)}.</p>
            <p className="text-muted-foreground">Priority: {priorityLabel}</p>
            {scheduleDescription ? <p className="text-muted-foreground">{scheduleDescription}</p> : null}
          </div>
        </div>
      </section>

      {isCheckingAvailability ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm">Checking target availability again before submission…</p>
      ) : validationErrors.length > 0 ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">Resolve these issues before submitting:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{validationErrors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The server checks target availability again when you submit. Submission requests approval; it does not start playback.</p>
      )}

      <Button size="sm" variant="outline" onClick={onRecheckAvailability} disabled={isCheckingAvailability}>
        Check availability again
      </Button>

      <div className="space-y-2">
        <Label htmlFor="schedule-approval-notes">Approval notes (optional)</Label>
        <Textarea
          id="schedule-approval-notes"
          placeholder="Add context for the reviewer…"
          value={approvalNotes}
          onChange={(event) => onUpdateNotes(event.target.value)}
          rows={3}
        />
      </div>

      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer font-medium">Preview layout and item settings</summary>
        <div className="mt-4 space-y-6">
          <section className="space-y-3 border-b border-border pb-5">
            <div className="mb-4 flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Layout Preview</h3>
              {selectedLayout ? (
                <div className="ml-auto flex gap-2">
                  <Badge variant="outline">{selectedLayout.aspect_ratio}</Badge>
                  <Badge variant="secondary">{selectedLayout.spec.slots.length} slots</Badge>
                </div>
              ) : null}
            </div>

            {selectedLayout ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{selectedLayout.name}</span>
                  {selectedLayout.description ? (
                    <span className="text-sm text-muted-foreground">- {selectedLayout.description}</span>
                  ) : null}
                </div>
                <div className="max-w-2xl"><LayoutPreview state={state} /></div>
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <LayoutGrid className="mx-auto mb-2 h-12 w-12 opacity-50" />
                <p>No layout selected</p>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="mb-4 flex items-center gap-2">
              <Image className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Media Assignments</h3>
              <Badge variant="secondary" className="ml-auto">
                {slotMedia.length} total items
              </Badge>
            </div>

            {slotMedia.length > 0 ? (
              <MediaDetailsCard slotMedia={slotMedia} selectedLayout={selectedLayout} />
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <Image className="mx-auto mb-2 h-12 w-12 opacity-50" />
                <p>No media assigned yet</p>
              </div>
            )}
          </section>

        </div>
      </details>
    </div>
  );
}
