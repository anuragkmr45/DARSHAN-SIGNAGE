import { useEffect, useMemo, useState } from "react";
import type { LiveFallbackPreview } from "@/api/liveTypes";
import { MediaPreview } from "@/components/common/MediaPreview";
import { AspectFrame } from "@/components/common/AspectFrame";
import { Button } from "@/components/ui/button";
import { preparedLivePreview } from "@/lib/liveFallbackPreview";

export function PreparedLiveFallbackPreview({ preview, onRefresh, refreshing = false }: {
  preview: LiveFallbackPreview; onRefresh: () => void; refreshing?: boolean;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({}), [expired, setExpired] = useState(false);
  const parsed = useMemo(() => {
    try { return { data: preparedLivePreview(preview), error: null }; }
    catch (error) { return { data: null, error: error instanceof Error ? error.message : "Prepared preview unavailable." }; }
  }, [preview]);
  useEffect(() => {
    setExpired(false);
    if (!parsed.data) return;
    // Server-relative lifetime avoids relying on the operator computer clock.
    const deadline = performance.now() + parsed.data.lifetimeMs;
    const timer = window.setInterval(() => { if (performance.now() >= deadline) setExpired(true); }, 1000);
    return () => window.clearInterval(timer);
  }, [parsed]);
  const entries = preview.manifest.presentation.items;
  return <section className="space-y-3 rounded-lg border p-4" aria-label="Prepared fallback preview">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Prepared fallback preview</h3>
      <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>{refreshing ? "Refreshing preview…" : "Refresh prepared preview"}</Button></div>
    <p className="text-sm text-muted-foreground">These are the immutable files prepared for offline playback. Select an item to inspect each slot. Videos start muted; this preview does not confirm delivery to a player.</p>
    {parsed.error || expired ? <p role="alert" className="text-sm text-destructive">{parsed.error ?? "Preview links expired. Refresh the prepared preview."}</p> : parsed.data && <>
      <AspectFrame aspectRatio={parsed.data.aspectRatio} className="relative w-full overflow-hidden rounded bg-black">
        {parsed.data.slots.map(slot => {
          const items = entries.filter(entry => parsed.data!.fullTimeline || entry.slot_id === slot.id).sort((a, b) => a.order - b.order);
          const entry = items.find(item => item.id === selected[slot.id]) ?? items[0];
          const asset = entry ? parsed.data!.assets.get(entry.asset_id) : undefined;
          return <div key={slot.id} className="absolute overflow-hidden" style={{ left: `${slot.x * 100}%`, top: `${slot.y * 100}%`, width: `${slot.w * 100}%`, height: `${slot.h * 100}%`, zIndex: slot.zIndex }}>
            {entry && asset && asset.render_type !== "hls" ? <MediaPreview key={`${preview.checked_at}:${entry.id}`} url={parsed.data!.urls.get(asset.id)}
              type={asset.content_type} alt={`Prepared fallback ${slot.id === "__full__" ? "full screen" : slot.id}`} className="h-full w-full" fit={entry.fit_mode ?? "contain"}
              pdfPage={entry.page_number ?? 1} videoControls videoAutoPlay={false} videoMuted videoLoop={entry.loop_enabled === true} />
              : <div className="flex h-full items-center justify-center p-3 text-center text-sm text-white">{asset?.render_type === "hls" ? "This prepared video format cannot be previewed here." : "No fallback item in this slot."}</div>}
          </div>;
        })}
      </AspectFrame>
      <div className="space-y-3">{parsed.data.slots.map(slot => <div key={slot.id}><p className="mb-2 text-sm font-medium">{slot.id === "__full__" ? "Full-screen fallback" : `Slot ${slot.id}`}</p>
        <div className="flex flex-wrap gap-2">{entries.filter(entry => parsed.data!.fullTimeline || entry.slot_id === slot.id).sort((a, b) => a.order - b.order).map((entry, index) => {
          const asset = parsed.data!.assets.get(entry.asset_id)!;
          return <Button key={entry.id} size="sm" variant={selected[slot.id] === entry.id || !selected[slot.id] && index === 0 ? "secondary" : "outline"}
            onClick={() => setSelected(current => ({ ...current, [slot.id]: entry.id }))} aria-label={`Preview ${slot.id} item ${index + 1}`}>
            {index + 1}. {asset.render_type.toUpperCase()}{entry.page_number ? ` · page ${entry.page_number}` : ""}{entry.duration_seconds ? ` · ${entry.duration_seconds}s` : ""}{entry.audio_enabled ? " · audio on" : ""}</Button>;
        })}</div></div>)}</div>
    </>}
  </section>;
}
