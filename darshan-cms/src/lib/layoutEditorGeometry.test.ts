import { describe, expect, it } from "vitest";
import { canvasDimensions, drawSlot, moveSlot, nextSlotId, placeNewSlot, resizeSlot, updateSlotNumber } from "./layoutEditorGeometry";
import type { LayoutSlot } from "@/api/types";

const slot: LayoutSlot = { id: "slot-1", x: 0.2, y: 0.2, w: 0.3, h: 0.3 };

describe("layout editor geometry", () => {
  it("fits a valid ratio and falls back safely for malformed ratios", () => {
    expect(canvasDimensions("9:16", 360).height).toBe(640);
    expect(canvasDimensions("bad", 320).height).toBe(180);
  });

  it("uses a free ID after deletion and places only non-overlapping slots", () => {
    expect(nextSlotId([{ ...slot, id: "slot-1" }, { ...slot, id: "slot-3" }])).toBe("slot-2");
    const added = placeNewSlot([slot]);
    expect(added).not.toBeNull();
    expect(added && (added.x + added.w <= slot.x || added.x >= slot.x + slot.w || added.y + added.h <= slot.y || added.y >= slot.y + slot.h)).toBe(true);
    expect(placeNewSlot([{ id: "full", x: 0, y: 0, w: 1, h: 1 }])).toBeNull();
  });

  it("keeps numeric moves and sizes inside the authored canvas", () => {
    expect(updateSlotNumber(slot, "x", 0.95, 0).x).toBe(0.7);
    expect(updateSlotNumber(slot, "y", 0.99, 0).y).toBe(0.7);
    expect(updateSlotNumber(slot, "w", 0, 0.1).w).toBe(0.1);
    expect(updateSlotNumber(slot, "x", 0.15, 0.1).x).toBe(0.2);
    expect(moveSlot(slot, 1, 1, 0.1)).toMatchObject({ x: 0.7, y: 0.7 });
    expect(resizeSlot(slot, 1, 1, 0.1)).toMatchObject({ w: 0.8, h: 0.8 });
  });

  it("rejects a tap-sized draw and preserves normalized geometry", () => {
    expect(drawSlot("slot-2", { x: 0.1, y: 0.1 }, { x: 0.11, y: 0.11 }, 0.05)).toBeNull();
    expect(drawSlot("slot-2", { x: 0.8, y: 0.7 }, { x: 0.2, y: 0.3 }, 0.05)).toEqual({
      id: "slot-2", x: 0.2, y: 0.3, w: 0.6, h: 0.4,
    });
  });
});
