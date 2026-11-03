import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ApiError } from "@/api/apiClient";
import { presentationsApi } from "@/api/domains/presentations";
import { schedulesApi } from "@/api/domains/schedules";
import { scheduleRequestsApi } from "@/api/domains/scheduleRequests";
import { scheduleReservationsApi } from "@/api/domains/scheduleReservations";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import type {
  ReservationConflictItem,
  ScheduleItemPayload,
  ScreenSnapshot,
} from "@/api/types";
import { resolveQuickPresetRange, type ScheduleQuickPresetId } from "@/lib/scheduleQuickPresets";
import { buildPresentationSlotPayloads, normalizeRestoredSlotMedia } from "@/lib/scheduleCreatorState";

import { StepLayoutSelect } from "@/components/schedule-creator/StepLayoutSelect";
import { StepMediaAssign } from "@/components/schedule-creator/StepMediaAssign";
import { StepScreenSelect } from "@/components/schedule-creator/StepScreenSelect";
import { StepScheduleDetails } from "@/components/schedule-creator/StepScheduleDetails";
import { StepReview } from "@/components/schedule-creator/StepReview";

import type { Layout } from "@/pages/Layouts";

// ─────────────────────────────────────────────────────────────────────────────
// Types for wizard state
// ─────────────────────────────────────────────────────────────────────────────

export interface SlotMedia {
  clientItemId: string;
  slotId: string;
  mediaId: string;
  mediaName: string;
  mediaType: "IMAGE" | "VIDEO" | "DOCUMENT" | "WEBPAGE";
  mediaThumbnail?: string;
  mediaUrl?: string | null;
  mediaContentType?: string | null;
  order: number;
  durationSeconds: number;
  fitMode: "cover" | "contain";
  audioEnabled: boolean;
  loopEnabled: boolean;
  pageNumber?: number;
  pageCount?: number | null;
}

export interface ScheduleWizardState {
  // Step 1: Layout
  selectedLayout: Layout | null;
  presentationId?: string | null;
  presentationLayoutId?: string | null;
  presentationSlotSyncKey?: string | null;
  presentationSlotSyncPresentationId?: string | null;

  // Step 2: Media assignments per slot
  slotMedia: SlotMedia[];

  // Step 3: Screen/Group selection
  selectedScreenIds: string[];
  selectedGroupIds: string[];

  // Step 4: Schedule details
  scheduleId?: string | null;
  scheduleSyncKey?: string | null;
  scheduleItemSyncKey?: string | null;
  scheduleItemSyncScheduleId?: string | null;
  scheduleName: string;
  scheduleDescription: string;
  timezone: string;
  startAt: string;
  endAt: string;
  priority: number;

  // Step 5: Notes for approval
  approvalNotes: string;
}

type ScheduleCreatorLocationState = {
  step?: number;
  restoreDraft?: boolean;
};

const STEPS = [
  { id: 1, label: "Layout" },
  { id: 2, label: "Media" },
  { id: 3, label: "Screens" },
  { id: 4, label: "Schedule" },
  { id: 5, label: "Review" },
];

const initialState: ScheduleWizardState = {
  selectedLayout: null,
  presentationId: null,
  presentationLayoutId: null,
  presentationSlotSyncKey: null,
  presentationSlotSyncPresentationId: null,
  slotMedia: [],
  selectedScreenIds: [],
  selectedGroupIds: [],
  scheduleId: null,
  scheduleSyncKey: null,
  scheduleItemSyncKey: null,
  scheduleItemSyncScheduleId: null,
  scheduleName: "",
  scheduleDescription: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  startAt: "",
  endAt: "",
  priority: 0,
  approvalNotes: "",
};

const formatConflictLabel = (conflict: ReservationConflictItem) => {
  const stateLabel = conflict.state.toLowerCase();
  const ownerLabel = conflict.owned_by_current_user ? "you" : "another user";
  const start = new Date(conflict.conflict_start_at);
  const end = new Date(conflict.conflict_end_at);
  const windowLabel =
    Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
      ? `${conflict.conflict_start_at} to ${conflict.conflict_end_at}`
      : `${start.toLocaleString()} to ${end.toLocaleString()}`;
  const expiryLabel = conflict.hold_expires_at
    ? ` Hold expires ${new Date(conflict.hold_expires_at).toLocaleString()}.`
    : "";
  return `${conflict.screen_name} already has a ${stateLabel} reservation owned by ${ownerLabel} for ${windowLabel}.${expiryLabel}`;
};

export default function ScheduleCreator() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardState, setWizardState] = useState<ScheduleWizardState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasRestored, setHasRestored] = useState(false);

  const isScheduleStep = currentStep === 4;
  const isReviewStep = currentStep === 5;
  const isTimingStep = isScheduleStep || isReviewStep;

  const screenSnapshotQueries = useQueries({
    queries: isScheduleStep
      ? wizardState.selectedScreenIds.map((screenId) => ({
          queryKey: queryKeys.screenSnapshot(screenId),
          queryFn: () => screensApi.getSnapshot(screenId, true),
          enabled: isScheduleStep,
          staleTime: 30_000,
        }))
      : [],
  });

  const groupSnapshotQueries = useQueries({
    queries: isScheduleStep
      ? wizardState.selectedGroupIds.map((groupId) => ({
          queryKey: queryKeys.screenGroupSnapshot(groupId),
          queryFn: () => screensApi.getGroupSnapshot(groupId, true),
          enabled: isScheduleStep,
          staleTime: 30_000,
        }))
      : [],
  });

  const reservationPreviewEnabled =
    isTimingStep &&
    (wizardState.selectedScreenIds.length > 0 || wizardState.selectedGroupIds.length > 0) &&
    wizardState.startAt !== "" &&
    wizardState.endAt !== "";

  const reservationPreviewQuery = useQuery({
    queryKey: queryKeys.scheduleReservationsPreview({
      start_at: wizardState.startAt || null,
      end_at: wizardState.endAt || null,
      screen_ids: wizardState.selectedScreenIds,
      screen_group_ids: wizardState.selectedGroupIds,
    }),
    queryFn: () =>
      scheduleReservationsApi.preview({
        start_at: formatScheduleTimestamp(wizardState.startAt),
        end_at: formatScheduleTimestamp(wizardState.endAt),
        screen_ids: wizardState.selectedScreenIds,
        screen_group_ids: wizardState.selectedGroupIds,
      }),
    enabled: reservationPreviewEnabled,
    staleTime: 15_000,
    refetchInterval: isReviewStep ? 30_000 : false,
  });
  const { refetch: refetchReservationPreview } = reservationPreviewQuery;

  useEffect(() => {
    if (isReviewStep && reservationPreviewEnabled) {
      void refetchReservationPreview();
    }
  }, [isReviewStep, reservationPreviewEnabled, refetchReservationPreview]);

  const scheduleTimingValidation = useMemo(() => {
    const errors: string[] = [];
    const serverNowMs = reservationPreviewQuery.data?.server_time
      ? Date.parse(reservationPreviewQuery.data.server_time)
      : Number.NaN;
    const startMs = wizardState.startAt ? new Date(wizardState.startAt).getTime() : NaN;
    const endMs = wizardState.endAt ? new Date(wizardState.endAt).getTime() : NaN;

    if (wizardState.startAt && Number.isNaN(startMs)) {
      errors.push("Start time is invalid.");
    }
    if (wizardState.endAt && Number.isNaN(endMs)) {
      errors.push("End time is invalid.");
    }
    if (wizardState.startAt && !Number.isNaN(startMs) && Number.isFinite(serverNowMs) && startMs <= serverNowMs) {
      errors.push("Start time must be in the future.");
    }
    if (
      wizardState.startAt &&
      wizardState.endAt &&
      !Number.isNaN(startMs) &&
      !Number.isNaN(endMs) &&
      endMs <= startMs
    ) {
      errors.push("End time must be after the start time.");
    }

    const isChecking = isTimingStep ? reservationPreviewQuery.isFetching : false;
    const reservationConflicts = reservationPreviewQuery.data?.reservation_conflicts ?? [];
    if (reservationConflicts.length > 0) {
      errors.push(...reservationConflicts.map(formatConflictLabel));
    }
    const previewAvailable = !reservationPreviewQuery.isError && reservationPreviewQuery.data &&
      Number.isFinite(serverNowMs) &&
      Array.isArray(reservationPreviewQuery.data.reservation_conflicts);
    if (isTimingStep && reservationPreviewEnabled && !isChecking && !previewAvailable) {
      errors.push("Unable to verify reservation conflicts. Please try again.");
    }

    return {
      errors,
      isChecking,
      isValid: errors.length === 0 && !isChecking,
    };
  }, [
    wizardState.startAt,
    wizardState.endAt,
    isTimingStep,
    reservationPreviewEnabled,
    reservationPreviewQuery.data,
    reservationPreviewQuery.isError,
    reservationPreviewQuery.isFetching,
  ]);

  const selectedTargetScheduleItems = useMemo(() => {
    const seen = new Set<string>();

    return [...screenSnapshotQueries, ...groupSnapshotQueries].flatMap((query) => {
      const data = query.data as ScreenSnapshot | undefined;
      const items = data?.snapshot?.schedule?.items ?? [];

      return items.filter((item) => {
        if (!item.id || seen.has(item.id)) {
          return false;
        }
        seen.add(item.id);
        return true;
      });
    });
  }, [screenSnapshotQueries, groupSnapshotQueries]);

  const applyQuickPreset = (preset: ScheduleQuickPresetId) => {
    if (wizardState.selectedScreenIds.length === 0 && wizardState.selectedGroupIds.length === 0) {
      toast({
        title: "Select targets first",
        description: "Choose at least one screen or group before using quick presets.",
        variant: "destructive",
      });
      return;
    }

    if (scheduleTimingValidation.isChecking) {
      toast({
        title: "Checking availability",
        description: "Wait for the selected screens and groups to finish loading schedule data.",
      });
      return;
    }

    const resolved = resolveQuickPresetRange(preset, selectedTargetScheduleItems, new Date());
    if (!resolved) {
      toast({
        title: "No free time found",
        description: "The selected screens/groups do not have a free slot in that preset range.",
        variant: "destructive",
      });
      return;
    }

    updateState({
      startAt: resolved.startAt,
      endAt: resolved.endAt,
      scheduleId: null,
      scheduleSyncKey: null,
      scheduleItemSyncKey: null,
      scheduleItemSyncScheduleId: null,
    });
  };

  const createPresentationMutation = useSafeMutation(
    {
      mutationFn: (payload: { name: string; description?: string; layout_id: string }) =>
        presentationsApi.create(payload),
    },
    "Unable to create presentation."
  );

  const createPresentationSlotsMutation = useSafeMutation(
    {
      mutationFn: async (payload: {
        presentationId: string;
        items: PresentationSlotPayload[];
      }) => {
        return presentationsApi.replaceSlots(payload.presentationId, payload.items);
      },
    },
    "Unable to save presentation slots."
  );

  const createScheduleMutation = useSafeMutation(
    {
      mutationFn: (payload: {
        name: string;
        description?: string;
        timezone?: string;
        start_at: string;
        end_at: string;
      }) =>
        schedulesApi.create(payload),
    },
    "Unable to create schedule."
  );

  const createScheduleItemsMutation = useSafeMutation(
    {
      mutationFn: async (payload: { scheduleId: string; item: ScheduleItemPayload }) =>
        schedulesApi.createItem(payload.scheduleId, payload.item),
    },
    "Unable to attach presentation to schedule."
  );

  const createScheduleRequestMutation = useSafeMutation(
    {
      mutationFn: (payload: { schedule_id: string; notes?: string }) =>
        scheduleRequestsApi.create(payload),
    },
    "Unable to submit schedule request."
  );

  const buildSlotSyncKey = (items: SlotMedia[]) => {
    return items
      .slice()
      .sort((a, b) => {
        if (a.slotId !== b.slotId) return a.slotId.localeCompare(b.slotId);
        if (a.order !== b.order) return a.order - b.order;
        return a.mediaId.localeCompare(b.mediaId);
      })
      .map(
        (item) =>
          `${item.clientItemId}|${item.slotId}|${item.mediaId}|${item.order}|${item.durationSeconds}|${item.fitMode}|${item.audioEnabled}|${item.loopEnabled}|${item.pageNumber ?? ""}`
      )
      .join(";");
  };

  const buildScheduleSyncKey = () => {
    const name = wizardState.scheduleName.trim();
    const description = wizardState.scheduleDescription.trim();
    return `${name}|${description}|${wizardState.timezone}|${wizardState.startAt}|${wizardState.endAt}`;
  };

  const buildScheduleItemSyncKey = () => {
    const screenIds = [...wizardState.selectedScreenIds].sort().join(",");
    const groupIds = [...wizardState.selectedGroupIds].sort().join(",");
    return `${wizardState.presentationId}|${wizardState.startAt}|${wizardState.endAt}|${wizardState.priority}|${screenIds}|${groupIds}`;
  };

  function formatScheduleTimestamp(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 1:
        return wizardState.selectedLayout !== null;
      case 2:
        return wizardState.slotMedia.length > 0 && wizardState.slotMedia.every((item) => {
          if (item.mediaType !== "DOCUMENT") return true;
          const page = item.pageNumber ?? 1;
          return Number.isSafeInteger(page) && page > 0 && (item.pageCount == null || page <= item.pageCount);
        });
      case 3:
        return wizardState.selectedScreenIds.length > 0 || wizardState.selectedGroupIds.length > 0;
      case 4:
        return (
          wizardState.scheduleName.trim() !== "" &&
          wizardState.startAt !== "" &&
          wizardState.endAt !== "" &&
          scheduleTimingValidation.isValid
        );
      case 5:
        return Boolean(
          wizardState.scheduleId &&
          wizardState.selectedLayout &&
          wizardState.slotMedia.length > 0 &&
          (wizardState.selectedScreenIds.length > 0 || wizardState.selectedGroupIds.length > 0) &&
          wizardState.scheduleName.trim() &&
          scheduleTimingValidation.isValid
        );
      default:
        return false;
    }
  };

  const handleNext = async () => {
    if (currentStep >= STEPS.length) return;

    if (currentStep === 1) {
      if (!wizardState.selectedLayout) return;

      const layoutId = wizardState.selectedLayout.id;
      if (wizardState.presentationId && wizardState.presentationLayoutId === layoutId) {
        setCurrentStep((prev) => prev + 1);
        return;
      }

      try {
        const presentation = await createPresentationMutation.mutateAsync({
          name: wizardState.selectedLayout.name,
          description: wizardState.selectedLayout.description || undefined,
          layout_id: layoutId,
        });
        updateState({
          presentationId: presentation.id,
          presentationLayoutId: layoutId,
        });
        setCurrentStep((prev) => prev + 1);
      } catch {
        return;
      }
      return;
    }

    if (currentStep === 2) {
      if (!wizardState.presentationId) {
        toast({
          title: "Missing presentation",
          description: "Please go back and select a layout again.",
          variant: "destructive",
        });
        return;
      }

      const syncKey = buildSlotSyncKey(wizardState.slotMedia);
      if (
        wizardState.presentationSlotSyncKey === syncKey &&
        wizardState.presentationSlotSyncPresentationId === wizardState.presentationId
      ) {
        setCurrentStep((prev) => prev + 1);
        return;
      }

      const payloadItems = buildPresentationSlotPayloads(wizardState.slotMedia);

      try {
        await createPresentationSlotsMutation.mutateAsync({
          presentationId: wizardState.presentationId,
          items: payloadItems,
        });
        updateState({
          presentationSlotSyncKey: syncKey,
          presentationSlotSyncPresentationId: wizardState.presentationId,
        });
        setCurrentStep((prev) => prev + 1);
      } catch {
        return;
      }
      return;
    }

    if (currentStep === 4) {
      if (!scheduleTimingValidation.isValid) {
        if (scheduleTimingValidation.errors.length > 0) {
          toast({
            title: "Schedule timing issue",
            description: scheduleTimingValidation.errors[0],
            variant: "destructive",
          });
        }
        return;
      }

      if (!wizardState.presentationId) {
        toast({
          title: "Missing presentation",
          description: "Please go back and select a layout again.",
          variant: "destructive",
        });
        return;
      }

      const scheduleKey = buildScheduleSyncKey();
      let scheduleId = wizardState.scheduleId ?? null;

      if (!scheduleId || wizardState.scheduleSyncKey !== scheduleKey) {
        try {
          const schedule = await createScheduleMutation.mutateAsync({
            name: wizardState.scheduleName.trim(),
            description: wizardState.scheduleDescription.trim() || undefined,
            timezone: wizardState.timezone || undefined,
            start_at: formatScheduleTimestamp(wizardState.startAt),
            end_at: formatScheduleTimestamp(wizardState.endAt),
          });
          scheduleId = schedule.id;
          updateState({
            scheduleId,
            scheduleSyncKey: scheduleKey,
            scheduleItemSyncKey: null,
            scheduleItemSyncScheduleId: null,
          });
        } catch {
          return;
        }
      }

      const itemKey = buildScheduleItemSyncKey();
      if (
        wizardState.scheduleItemSyncKey === itemKey &&
        wizardState.scheduleItemSyncScheduleId === scheduleId
      ) {
        setCurrentStep((prev) => prev + 1);
        return;
      }

      const itemPayload: ScheduleItemPayload = {
        presentation_id: wizardState.presentationId,
        start_at: formatScheduleTimestamp(wizardState.startAt),
        end_at: formatScheduleTimestamp(wizardState.endAt),
        priority: wizardState.priority,
        screen_ids: wizardState.selectedScreenIds.length ? wizardState.selectedScreenIds : undefined,
        screen_group_ids: wizardState.selectedGroupIds.length ? wizardState.selectedGroupIds : undefined,
      };

      try {
        await createScheduleItemsMutation.mutateAsync({
          scheduleId: scheduleId!,
          item: itemPayload,
        });
        updateState({
          scheduleItemSyncKey: itemKey,
          scheduleItemSyncScheduleId: scheduleId,
        });
        setCurrentStep((prev) => prev + 1);
      } catch {
        return;
      }
      return;
    }

    setCurrentStep((prev) => prev + 1);
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    if (!wizardState.scheduleId) {
      toast({
        title: "Missing schedule",
        description: "Please complete the schedule step before submitting.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      await createScheduleRequestMutation.mutateAsync({
        schedule_id: wizardState.scheduleId,
        notes: wizardState.approvalNotes.trim() || "Need approval",
      });
      toast({
        title: "Request submitted",
        description: "Your schedule request has been submitted for approval.",
      });
      navigate("/schedule");
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        const details = error.details as
          | { reservation_conflicts?: ReservationConflictItem[] }
          | undefined;
        const firstConflict = details?.reservation_conflicts?.[0];
        if (firstConflict) {
          toast({
            title: "Screen reservation conflict",
            description: formatConflictLabel(firstConflict),
            variant: "destructive",
          });
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateState = (updates: Partial<ScheduleWizardState>) => {
    setWizardState((prev) => ({ ...prev, ...updates }));
  };

  useEffect(() => {
    if (hasRestored) return;
    const state = location.state as ScheduleCreatorLocationState | null;
    if (state?.restoreDraft) {
      const stored = typeof window === "undefined" ? null : sessionStorage.getItem("scheduleCreatorDraft");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { state: ScheduleWizardState; step?: number };
          if (parsed?.state) {
            setWizardState({
              ...initialState,
              ...parsed.state,
              slotMedia: normalizeRestoredSlotMedia(parsed.state.slotMedia),
            });
            setCurrentStep(state.step ?? parsed.step ?? 1);
          } else if (state.step) {
            setCurrentStep(state.step);
          }
        } catch {
          if (state.step) {
            setCurrentStep(state.step);
          }
        }
      } else if (state.step) {
        setCurrentStep(state.step);
      }
    }
    setHasRestored(true);
  }, [hasRestored, location.state]);

  useEffect(() => {
    if (!hasRestored || typeof window === "undefined") return;
    const payload = JSON.stringify({ state: wizardState, step: currentStep });
    sessionStorage.setItem("scheduleCreatorDraft", payload);
  }, [wizardState, currentStep, hasRestored]);

  return (
    <div className="space-y-5 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Create Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">Choose content, audience, and timing before submitting.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => navigate("/schedule")}>
          Cancel
        </Button>
      </div>

      <ol aria-label="Schedule steps" className="grid grid-cols-5 gap-1 border-b border-border">
          {STEPS.map((step) => {
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;
            return (
              <li
                key={step.id}
                aria-current={isActive ? "step" : undefined}
                className={`flex min-w-0 flex-col items-center gap-1 border-b-2 px-1 pb-3 text-center text-xs sm:flex-row sm:justify-center sm:text-sm ${
                  isActive ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground"
                }`}
              >
                <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${isCompleted ? "border-primary text-primary" : isActive ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                  {isCompleted ? <Check className="h-3.5 w-3.5" /> : step.id}
                </span>
                <span className="truncate">{step.label}</span>
              </li>
            );
          })}
      </ol>

      <section aria-label={`${STEPS[currentStep - 1]?.label ?? "Schedule"} step`} className="min-h-[40vh]">
        {currentStep === 1 && (
          <StepLayoutSelect
            selectedLayout={wizardState.selectedLayout}
            onSelectLayout={(layout) => {
              updateState({
                selectedLayout: layout,
                slotMedia: [],
                presentationId: null,
                presentationLayoutId: null,
                presentationSlotSyncKey: null,
                presentationSlotSyncPresentationId: null,
                scheduleId: null,
                scheduleSyncKey: null,
                scheduleItemSyncKey: null,
                scheduleItemSyncScheduleId: null,
              });
            }}
          />
        )}
        {currentStep === 2 && wizardState.selectedLayout && (
          <StepMediaAssign
            layout={wizardState.selectedLayout}
            slotMedia={wizardState.slotMedia}
            onUpdateSlotMedia={(slotMedia) =>
              updateState({
                slotMedia,
                presentationSlotSyncKey: null,
                presentationSlotSyncPresentationId: null,
              })
            }
          />
        )}
        {currentStep === 3 && (
          <StepScreenSelect
            selectedScreenIds={wizardState.selectedScreenIds}
            selectedGroupIds={wizardState.selectedGroupIds}
            onUpdateSelection={(screenIds, groupIds) =>
              updateState({
                selectedScreenIds: screenIds,
                selectedGroupIds: groupIds,
                scheduleItemSyncKey: null,
                scheduleItemSyncScheduleId: null,
              })
            }
          />
        )}
        {currentStep === 4 && (
          <StepScheduleDetails
            scheduleName={wizardState.scheduleName}
            scheduleDescription={wizardState.scheduleDescription}
            timezone={wizardState.timezone}
            startAt={wizardState.startAt}
            endAt={wizardState.endAt}
            priority={wizardState.priority}
            validationErrors={scheduleTimingValidation.errors}
            isCheckingAvailability={scheduleTimingValidation.isChecking}
            hasSelectedTargets={wizardState.selectedScreenIds.length > 0 || wizardState.selectedGroupIds.length > 0}
            onApplyQuickPreset={applyQuickPreset}
            onUpdate={(details) =>
              updateState({
                ...details,
                scheduleId: null,
                scheduleSyncKey: null,
                scheduleItemSyncKey: null,
                scheduleItemSyncScheduleId: null,
              })
            }
          />
        )}
        {currentStep === 5 && (
          <StepReview
            state={wizardState}
            approvalNotes={wizardState.approvalNotes}
            onUpdateNotes={(approvalNotes) => updateState({ approvalNotes })}
            validationErrors={scheduleTimingValidation.errors}
            isCheckingAvailability={scheduleTimingValidation.isChecking}
            onRecheckAvailability={() => { void refetchReservationPreview(); }}
          />
        )}
      </section>

      <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border bg-background py-3">
        <Button variant="outline" onClick={handleBack} disabled={currentStep === 1}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        {currentStep < STEPS.length ? (
          <Button
            onClick={handleNext}
            disabled={
              !canProceed() ||
              (currentStep === 1 && createPresentationMutation.isPending) ||
              (currentStep === 2 && createPresentationSlotsMutation.isPending) ||
              (currentStep === 4 &&
                (createScheduleMutation.isPending || createScheduleItemsMutation.isPending))
            }
          >
            Continue
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={isSubmitting || !canProceed()}>
            {isSubmitting ? "Submitting..." : "Submit for Approval"}
            <Send className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
}
