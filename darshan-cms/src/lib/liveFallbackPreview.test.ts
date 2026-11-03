import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LiveFallbackPreview } from "@/api/liveTypes";
import { PreparedLiveFallbackPreview } from "@/components/live/PreparedLiveFallbackPreview";
import { preparedLivePreview } from "./liveFallbackPreview";

const fixture = (): LiveFallbackPreview => ({ preparation_id: "prep", presentation_id: "presentation", source_fingerprint: "a".repeat(64),
  checked_at: "2050-01-01T00:00:00.000Z", manifest: { version: 1, presentation: { id: "presentation", layout: null,
    items: [{ id: "entry", asset_id: "asset", order: 0, duration_seconds: 15 }] }, assets: [{ id: "asset", media_id: "business-media",
      storage_object_id: "cas-object", bucket: "immutable-fallbacks", object_key: `live-fallbacks/v1/sha256/${"a".repeat(64)}.png`, sha256: "a".repeat(64),
      size: 64, content_type: "image/png", render_type: "image", representation: "READY", cache_key: `live_${"a".repeat(64)}_image`, dependencies: [] }] },
  downloads: [{ asset_id: "asset", cache_key: `live_${"a".repeat(64)}_image`, sha256: "a".repeat(64), size: 64, content_type: "image/png",
    url: "https://media.example.test/exact-cas.png?synthetic=1", expires_at: "2050-01-01T00:15:00.000Z" }] });
describe("immutable live fallback preview", () => {
  it("uses backend-relative lifetime even when the operator clock differs", () => {
    const value = preparedLivePreview(fixture());
    expect(value.lifetimeMs).toBe(900_000); expect(value.urls.get("asset")).toContain("exact-cas.png");
  });
  it("rejects missing/duplicate/mismatched transport descriptors", () => {
    for (const mutate of [
      (value: LiveFallbackPreview) => { value.downloads = []; },
      (value: LiveFallbackPreview) => { value.downloads[0].size++; },
      (value: LiveFallbackPreview) => { value.downloads[0].sha256 = "b".repeat(64); },
      (value: LiveFallbackPreview) => { value.downloads[0].cache_key = "mutable-media"; },
      (value: LiveFallbackPreview) => { value.manifest.assets.push({ ...value.manifest.assets[0] }); },
    ]) { const value = fixture(); mutate(value); expect(() => preparedLivePreview(value)).toThrow(); }
  });
  it("rejects unsafe URL schemes, embedded credentials and invalid expiry", () => {
    for (const url of ["javascript:alert(1)", "file:///tmp/asset", "https://user:pass@example.test/asset", "https://example.test/asset#secret"]) {
      const value = fixture(); value.downloads[0].url = url; expect(() => preparedLivePreview(value)).toThrow();
    }
    const value = fixture(); value.downloads[0].expires_at = value.checked_at; expect(() => preparedLivePreview(value)).toThrow();
  });
  it("rejects malformed prepared layout geometry instead of inventing its layout", () => {
    const value = fixture(); value.manifest.presentation.items[0].slot_id = "main";
    value.manifest.presentation.layout = { id: "layout", aspect_ratio: "16:9", spec: { slots: [{ id: "main", x: 0, y: 0, w: 2, h: 1 }] } };
    expect(() => preparedLivePreview(value)).toThrow();
  });
  it("matches the player's legacy slot aliases and stacking order", () => {
    const value = fixture(); value.manifest.presentation.items[0].slot_id = "main";
    value.manifest.presentation.layout = { id: "layout", aspect_ratio: "9:16", spec: { slots: [{ slot_id: "main", x: 0, y: 0, width: 1, height: 1, z_index: 5 }] } };
    const parsed = preparedLivePreview(value);
    expect(parsed.fullTimeline).toBe(false); expect(parsed.aspectRatio).toBe("9:16");
    expect(parsed.slots).toEqual([{ id: "main", x: 0, y: 0, w: 1, h: 1, zIndex: 5 }]);
  });
  it("keeps every item in the full-screen timeline when a legacy unslotted item is mixed with slots", () => {
    const value = fixture(); value.manifest.presentation.items.push({ ...value.manifest.presentation.items[0], id: "slotted-entry", slot_id: "main", order: 1 });
    value.manifest.presentation.layout = { id: "layout", aspect_ratio: "9:16", spec: { slots: [{ id: "main", x: 0, y: 0, w: 1, h: 1 }] } };
    const parsed = preparedLivePreview(value); expect(parsed.fullTimeline).toBe(true);
    const markup = renderToStaticMarkup(createElement(PreparedLiveFallbackPreview, { preview: value, onRefresh: vi.fn() }));
    expect(markup).toContain('aria-label="Preview __full__ item 1"'); expect(markup).toContain('aria-label="Preview __full__ item 2"');
  });
  it("shows prepared image bytes and provides an accessible refresh/item control", () => {
    const markup = renderToStaticMarkup(createElement(PreparedLiveFallbackPreview, { preview: fixture(), onRefresh: vi.fn() }));
    expect(markup).toContain("exact-cas.png"); expect(markup).not.toContain("iframe");
    expect(markup).toContain("Refresh prepared preview"); expect(markup).toContain('aria-label="Preview __full__ item 1"');
    expect(markup).toContain("does not confirm delivery to a player");
  });
});
