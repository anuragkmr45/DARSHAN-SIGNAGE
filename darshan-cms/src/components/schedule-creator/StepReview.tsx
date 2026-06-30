import {
  LayoutGrid,
  Image,
  Monitor,
  Calendar,
  Check,
  Volume2,
  VolumeX,
  Clock,
  Layers,
  Repeat,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MediaPreview } from "@/components/common/MediaPreview";
import type { ScheduleWizardState, SlotMedia } from "@/pages/ScheduleCreator";

interface StepReviewProps {
  state: ScheduleWizardState;
  approvalNotes: string;
  onUpdateNotes: (notes: string) => void;
}

function SlotMediaPreview({ item, className }: { item: SlotMedia; className: string }) {
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
      videoLoop={item.mediaType === "VIDEO" ? item.loopEnabled : false}
    />
  );
}

function LayoutPreview({ state }: { state: ScheduleWizardState }) {
  const { selectedLayout, slotMedia } = state;
  if (!selectedLayout) return null;

  const getSlotMedia = (slotId: string): SlotMedia[] =>
    slotMedia.filter((item) => item.slotId === slotId).sort((left, right) => left.order - right.order);

  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg border-2 border-dashed border-border bg-muted/30">
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
                    {primaryMedia.mediaType === "VIDEO" && primaryMedia.loopEnabled ? (
                      <Badge variant="secondary" className="h-5 text-[10px]">
                        <Repeat className="mr-1 h-3 w-3" />
                        Loop
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
    </div>
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
                  key={`${item.slotId}-${item.mediaId}-${index}`}
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
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Display {item.durationSeconds}s
                      </div>
                      {item.mediaType === "VIDEO" && item.loopEnabled ? (
                        <div className="flex items-center gap-1 text-xs text-primary">
                          <Repeat className="h-3 w-3" />
                          Loop
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

export function StepReview({ state, approvalNotes, onUpdateNotes }: StepReviewProps) {
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

  const priorityLabel = ["Normal", "High", "Urgent"][priority] || "Normal";

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return "Not set";
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Review & Submit</h2>
        <p className="text-sm text-muted-foreground">Review your schedule before submitting for approval.</p>
      </div>

      <ScrollArea className="h-[500px] pr-4">
        <div className="space-y-6">
          <Card className="p-4">
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
                <LayoutPreview state={state} />
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <LayoutGrid className="mx-auto mb-2 h-12 w-12 opacity-50" />
                <p>No layout selected</p>
              </div>
            )}
          </Card>

          <Card className="p-4">
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
          </Card>

          <Card className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Target Screens</h3>
              <Badge variant="secondary" className="ml-auto">
                {selectedScreenIds.length + selectedGroupIds.length} selected
              </Badge>
            </div>

            {selectedScreenIds.length > 0 || selectedGroupIds.length > 0 ? (
              <div className="space-y-4">
                {selectedScreenIds.length > 0 ? (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <Monitor className="h-4 w-4" />
                      Individual Screens ({selectedScreenIds.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedScreenIds.map((id) => (
                        <Badge key={id} variant="outline">
                          {id}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedGroupIds.length > 0 ? (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <Layers className="h-4 w-4" />
                      Screen Groups ({selectedGroupIds.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedGroupIds.map((id) => (
                        <Badge key={id} variant="outline">
                          {id}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <Monitor className="mx-auto mb-2 h-12 w-12 opacity-50" />
                <p>No screens selected</p>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Schedule Details</h3>
              <Check className="ml-auto h-4 w-4 text-primary" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Name</p>
                <p className="font-medium">
                  {scheduleName || <span className="italic text-muted-foreground">Not set</span>}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Priority</p>
                <Badge variant={priority === 2 ? "destructive" : priority === 1 ? "default" : "secondary"}>
                  {priorityLabel}
                </Badge>
              </div>

              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Start Time</p>
                <p className="font-medium">{formatDateTime(startAt)}</p>
              </div>

              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">End Time</p>
                <p className="font-medium">{formatDateTime(endAt)}</p>
              </div>

              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Audit Timezone</p>
                <p className="font-medium">{timezone || "UTC"}</p>
                <p className="text-xs text-muted-foreground">Execution remains UTC-based on the player.</p>
              </div>

              {scheduleDescription ? (
                <div className="col-span-2 space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
                  <p className="text-sm">{scheduleDescription}</p>
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <Check className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Approval Notes</h3>
            </div>
            <Textarea
              placeholder="Add context for the reviewer…"
              value={approvalNotes}
              onChange={(event) => onUpdateNotes(event.target.value)}
              rows={4}
            />
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
