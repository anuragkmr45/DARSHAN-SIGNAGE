import { createUuid } from "@/lib/uuid";
import type { PresentationSlotPayload } from "@/api/types";
import type { SlotMedia } from "@/pages/ScheduleCreator";

type SlotMediaPreviewInput = Pick<SlotMedia, "mediaType" | "loopEnabled" | "pageNumber">;

export const resolveSlotMediaPreviewOptions = (item: SlotMediaPreviewInput) => ({
  videoLoop: item.mediaType === "VIDEO" && item.loopEnabled === true,
  pdfPage: item.mediaType === "DOCUMENT" ? item.pageNumber ?? 1 : undefined,
});

export const resolveVideoLoopLabel = (mediaType: unknown, loopEnabled: unknown) =>
  typeof mediaType === "string" && mediaType.toUpperCase() === "VIDEO"
    ? `Loop ${loopEnabled === true ? "On" : "Off"}`
    : null;

export const updateSlotMediaOccurrence = (
  items: SlotMedia[],
  clientItemId: string,
  updates: Partial<SlotMedia>,
): SlotMedia[] => {
  if (!items.some((item) => item.clientItemId === clientItemId)) return items;

  return items.map((item) => {
    if (item.clientItemId === clientItemId) {
      const updated = { ...item, ...updates };
      return {
        ...updated,
        loopEnabled: updated.mediaType === "VIDEO" && updated.loopEnabled === true,
      };
    }

    if (updates.audioEnabled) return { ...item, audioEnabled: false };
    return item;
  });
};

export const normalizeRestoredSlotMedia = (items: unknown): SlotMedia[] => {
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const item = raw as Partial<SlotMedia>;
    const isDocument = item.mediaType === "DOCUMENT";
    const requestedPage = Number(item.pageNumber ?? 1);
    const pageCount = typeof item.pageCount === "number" && item.pageCount > 0 ? Math.trunc(item.pageCount) : null;
    const pageNumber =
      isDocument &&
      Number.isSafeInteger(requestedPage) &&
      requestedPage > 0 &&
      (pageCount ? requestedPage <= pageCount : requestedPage === 1)
        ? requestedPage
        : isDocument
          ? 1
          : undefined;
    return {
      ...(item as SlotMedia),
      clientItemId: typeof item.clientItemId === "string" && item.clientItemId ? item.clientItemId : createUuid(),
      loopEnabled: item.mediaType === "VIDEO" && item.loopEnabled === true,
      pageNumber,
      pageCount,
    };
  });
};

export const buildPresentationSlotPayloads = (items: SlotMedia[]): PresentationSlotPayload[] =>
  items.map((item) => ({
    slot_id: item.slotId,
    media_id: item.mediaId,
    order: item.order,
    duration_seconds: item.durationSeconds,
    fit_mode: item.fitMode,
    audio_enabled: item.audioEnabled,
    loop_enabled: item.mediaType === "VIDEO" && item.loopEnabled === true,
    page_number: item.mediaType === "DOCUMENT" ? item.pageNumber ?? 1 : undefined,
  }));
