import { describe, expect, it } from "vitest";
import {
  buildPresentationSlotPayloads,
  normalizeRestoredSlotMedia,
  resolveSlotMediaPreviewOptions,
  resolveVideoLoopLabel,
  updateSlotMediaOccurrence,
} from "./scheduleCreatorState";

const baseItem = {
  clientItemId: "occurrence-1",
  slotId: "main",
  mediaId: "media-1",
  mediaName: "Fixture",
  order: 0,
  durationSeconds: 10,
  fitMode: "contain" as const,
  audioEnabled: false,
};

describe("normalizeRestoredSlotMedia", () => {
  it("preserves an explicit video loop and defaults a legacy missing value to false", () => {
    const [looped, legacy] = normalizeRestoredSlotMedia([
      { ...baseItem, mediaType: "VIDEO", loopEnabled: true },
      { ...baseItem, clientItemId: "occurrence-2", mediaType: "VIDEO" },
    ]);

    expect(looped.loopEnabled).toBe(true);
    expect(legacy.loopEnabled).toBe(false);
  });

  it("normalizes loop over-posting on non-video restored items", () => {
    const [image, document] = normalizeRestoredSlotMedia([
      { ...baseItem, mediaType: "IMAGE", loopEnabled: true },
      { ...baseItem, clientItemId: "occurrence-2", mediaType: "DOCUMENT", loopEnabled: true, pageCount: 5, pageNumber: 3 },
    ]);

    expect(image.loopEnabled).toBe(false);
    expect(document.loopEnabled).toBe(false);
    expect(document.pageNumber).toBe(3);
  });

  it("keeps duplicate video occurrences independent in the API payload", () => {
    const payload = buildPresentationSlotPayloads([
      { ...baseItem, mediaType: "VIDEO", loopEnabled: true },
      { ...baseItem, clientItemId: "occurrence-2", order: 1, mediaType: "VIDEO", loopEnabled: false },
      { ...baseItem, clientItemId: "occurrence-3", order: 2, mediaType: "IMAGE", loopEnabled: true },
      {
        ...baseItem,
        clientItemId: "occurrence-4",
        order: 3,
        mediaType: "DOCUMENT",
        loopEnabled: true,
        pageNumber: 4,
        pageCount: 8,
      },
    ]);

    expect(payload.map((item) => item.loop_enabled)).toEqual([true, false, false, false]);
    expect(payload[3].page_number).toBe(4);
    expect(payload.map((item) => item.order)).toEqual([0, 1, 2, 3]);
  });

  it("updates only the selected duplicate video occurrence", () => {
    const original = [
      { ...baseItem, mediaType: "VIDEO" as const, loopEnabled: false },
      {
        ...baseItem,
        clientItemId: "occurrence-2",
        order: 1,
        mediaType: "VIDEO" as const,
        loopEnabled: false,
      },
    ];

    const updated = updateSlotMediaOccurrence(original, "occurrence-2", { loopEnabled: true });

    expect(updated.map((item) => item.loopEnabled)).toEqual([false, true]);
    expect(updated[0]).toBe(original[0]);
  });

  it("prevents a non-video occurrence from retaining an over-posted loop value", () => {
    const [updated] = updateSlotMediaOccurrence(
      [{ ...baseItem, mediaType: "IMAGE", loopEnabled: false }],
      "occurrence-1",
      { loopEnabled: true },
    );

    expect(updated.loopEnabled).toBe(false);
  });

  it("does not change other occurrences when a stale occurrence id is submitted", () => {
    const original = [
      { ...baseItem, mediaType: "VIDEO" as const, loopEnabled: false, audioEnabled: true },
      {
        ...baseItem,
        clientItemId: "occurrence-2",
        order: 1,
        mediaType: "VIDEO" as const,
        loopEnabled: true,
      },
    ];

    const updated = updateSlotMediaOccurrence(original, "removed-occurrence", {
      audioEnabled: true,
      loopEnabled: false,
    });

    expect(updated).toBe(original);
    expect(updated.map((item) => [item.audioEnabled, item.loopEnabled])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("resolves preview options for looped video and the selected document page", () => {
    expect(resolveSlotMediaPreviewOptions({
      mediaType: "VIDEO",
      loopEnabled: true,
    })).toEqual({ videoLoop: true, pdfPage: undefined });
    expect(resolveSlotMediaPreviewOptions({
      mediaType: "DOCUMENT",
      loopEnabled: true,
      pageNumber: 4,
    })).toEqual({ videoLoop: false, pdfPage: 4 });
  });

  it("uses an explicit and type-safe loop label in review and approval surfaces", () => {
    expect(resolveVideoLoopLabel("VIDEO", true)).toBe("Loop On");
    expect(resolveVideoLoopLabel("video", false)).toBe("Loop Off");
    expect(resolveVideoLoopLabel("VIDEO", "true")).toBe("Loop Off");
    expect(resolveVideoLoopLabel("DOCUMENT", true)).toBeNull();
  });
});
