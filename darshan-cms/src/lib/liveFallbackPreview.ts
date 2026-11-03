import type { LiveFallbackAsset, LiveFallbackPreview } from "@/api/liveTypes";

export interface LivePreviewSlot { id: string; x: number; y: number; w: number; h: number; zIndex?: number }
export function preparedLivePreview(preview: LiveFallbackPreview) {
  const { manifest } = preview;
  if (manifest.version !== 1 || manifest.presentation.id !== preview.presentation_id || !manifest.assets.length ||
      !manifest.presentation.items.length || preview.downloads.length !== manifest.assets.length) throw new Error("The prepared preview is incomplete.");
  const assets = new Map<string, LiveFallbackAsset>(), urls = new Map<string, string>();
  let lifetimeMs = 900_000;
  for (const asset of manifest.assets) {
    if (assets.has(asset.id) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
        asset.cache_key !== `live_${asset.sha256}_${asset.render_type}`) throw new Error("The prepared preview descriptor is invalid.");
    assets.set(asset.id, asset);
  }
  for (const download of preview.downloads) {
    const asset = assets.get(download.asset_id);
    if (!asset || urls.has(asset.id) || download.sha256 !== asset.sha256 || download.size !== asset.size ||
        download.content_type !== asset.content_type || download.cache_key !== asset.cache_key) throw new Error("The prepared preview files do not match the approved descriptors.");
    const url = new URL(download.url), duration = Date.parse(download.expires_at) - Date.parse(preview.checked_at);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || !Number.isFinite(duration) || duration <= 0 || duration > 900_000) {
      throw new Error("The prepared preview address is invalid or expired.");
    }
    urls.set(asset.id, url.toString()); lifetimeMs = Math.min(lifetimeMs, duration);
  }
  let slots: LivePreviewSlot[];
  const layout = manifest.presentation.layout;
  // Match the installed player's legacy fallback behavior: one unslotted
  // entry makes the whole presentation a full-screen sequential timeline.
  const fullTimeline = !layout || manifest.presentation.items.some(entry => !entry.slot_id);
  if (fullTimeline) slots = [{ id: "__full__", x: 0, y: 0, w: 1, h: 1 }];
  else {
    const spec = layout!.spec, raw = Array.isArray(spec) ? spec : spec && typeof spec === "object" ? (spec as { slots?: unknown }).slots : undefined;
    if (!Array.isArray(raw) || !raw.length) throw new Error("The prepared fallback layout cannot be previewed.");
    slots = raw.map(value => {
      if (!value || typeof value !== "object") throw new Error("The prepared layout slot is invalid.");
      const legacy = value as Record<string, unknown>;
      const slot = { id: legacy.id ?? legacy.slot_id, x: legacy.x ?? 0, y: legacy.y ?? 0,
        w: legacy.w ?? legacy.width ?? 1, h: legacy.h ?? legacy.height ?? 1, zIndex: legacy.zIndex ?? legacy.z_index } as LivePreviewSlot;
      if (typeof slot.id !== "string" || !slot.id || ![slot.x, slot.y, slot.w, slot.h].every(Number.isFinite) ||
          slot.x < 0 || slot.y < 0 || slot.w <= 0 || slot.h <= 0 || slot.x + slot.w > 1.000001 || slot.y + slot.h > 1.000001 ||
          slot.zIndex !== undefined && !Number.isSafeInteger(slot.zIndex)) throw new Error("The prepared layout slot is invalid.");
      return slot;
    });
    if (new Set(slots.map(slot => slot.id)).size !== slots.length) throw new Error("The prepared layout has duplicate slots.");
  }
  for (const entry of manifest.presentation.items) {
    if (!assets.has(entry.asset_id) || (!fullTimeline && entry.slot_id && !slots.some(slot => slot.id === entry.slot_id))) throw new Error("A prepared playback entry is unavailable.");
  }
  return { assets, urls, slots, lifetimeMs, fullTimeline, aspectRatio: fullTimeline ? "16:9" : layout!.aspect_ratio };
}
