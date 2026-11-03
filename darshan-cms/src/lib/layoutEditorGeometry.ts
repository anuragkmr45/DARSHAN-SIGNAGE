import type { LayoutSlot } from "@/api/types";

const round = (value: number) => Number(value.toFixed(3));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function canvasDimensions(aspectRatio: string, width: number) {
  const [horizontal, vertical] = aspectRatio.split(":").map(Number);
  const ratio = Number.isFinite(horizontal / vertical) && horizontal > 0 && vertical > 0
    ? horizontal / vertical
    : 16 / 9;
  return { width, height: width / ratio };
}

export function nextSlotId(slots: LayoutSlot[]) {
  const used = new Set(slots.map((slot) => slot.id));
  let index = 1;
  while (used.has(`slot-${index}`)) index += 1;
  return `slot-${index}`;
}

export function slotsOverlap(left: LayoutSlot, right: LayoutSlot) {
  return !(
    left.x >= right.x + right.w || left.x + left.w <= right.x ||
    left.y >= right.y + right.h || left.y + left.h <= right.y
  );
}

export function updateSlotNumber(slot: LayoutSlot, property: "x" | "y" | "w" | "h", value: number, snapStep: number) {
  if (!Number.isFinite(value)) return slot;
  const max = property === "x" ? 1 - slot.w : property === "y" ? 1 - slot.h
    : property === "w" ? 1 - slot.x : 1 - slot.y;
  const min = property === "w" || property === "h" ? Math.min(max, Math.max(0.01, snapStep)) : 0;
  const snapped = snapStep > 0 ? Math.round(value / snapStep + 1e-9) * snapStep : value;
  return { ...slot, [property]: round(clamp(snapped, min, max)) };
}

export function moveSlot(slot: LayoutSlot, deltaX: number, deltaY: number, snapStep: number) {
  const movedX = updateSlotNumber(slot, "x", slot.x + deltaX, snapStep);
  return updateSlotNumber(movedX, "y", slot.y + deltaY, snapStep);
}

export function resizeSlot(slot: LayoutSlot, deltaX: number, deltaY: number, snapStep: number) {
  const resizedWidth = updateSlotNumber(slot, "w", slot.w + deltaX, snapStep);
  return updateSlotNumber(resizedWidth, "h", slot.h + deltaY, snapStep);
}

export function drawSlot(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  minSize: number,
): LayoutSlot | null {
  const x = round(clamp(Math.min(start.x, end.x), 0, 1));
  const y = round(clamp(Math.min(start.y, end.y), 0, 1));
  const w = round(clamp(Math.abs(end.x - start.x), 0, 1 - x));
  const h = round(clamp(Math.abs(end.y - start.y), 0, 1 - y));
  return w >= minSize && h >= minSize ? { id, x, y, w, h } : null;
}

export function placeNewSlot(slots: LayoutSlot[]): LayoutSlot | null {
  for (const size of [0.3, 0.2, 0.1]) {
    for (let y = 0; y <= 1 - size + 0.0001; y += 0.1) {
      for (let x = 0; x <= 1 - size + 0.0001; x += 0.1) {
        const candidate = { id: nextSlotId(slots), x: round(x), y: round(y), w: size, h: size };
        if (slots.every((slot) => !slotsOverlap(candidate, slot))) return candidate;
      }
    }
  }
  return null;
}
