import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ImageOff, Link2 } from "lucide-react";
import type { ScreenSnapshot } from "@/api/types";
import { cn } from "@/lib/utils";
import { getServerClockOffsetMs, getServerNowFromOffset } from "@/hooks/screens/screensRealtimeUtils";
import {
  buildLiveMirrorState,
  getLiveMirrorAspectRatio,
  type LiveMirrorMedia,
} from "@/lib/screenLiveMirror";

type LiveScreenMirrorProps = {
  snapshot?: ScreenSnapshot | null;
  fallbackAspectRatio?: string | null;
  fallbackPreviewUrl?: string | null;
  isLoading?: boolean;
  errorMessage?: string | null;
  clockTick?: number;
  className?: string;
};

function useElementVisibility<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry?.isIntersecting ?? true);
      },
      { threshold: 0.2 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

function LiveMirrorVideo({
  media,
  active,
  className,
}: {
  media: LiveMirrorMedia;
  active: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (!active) {
      element.pause();
      return;
    }

    const playPromise = element.play();
    if (typeof playPromise?.catch === "function") {
      playPromise.catch(() => {
        // dashboard playback is best-effort only
      });
    }
  }, [active, media.url]);

  return (
    <video
      ref={ref}
      src={media.url}
      className={cn("h-full w-full bg-black object-cover", className)}
      muted
      playsInline
      autoPlay={active}
      loop={media.loop}
      preload={active ? "auto" : "metadata"}
      style={{ objectFit: media.fit === "stretch" ? "fill" : media.fit }}
    />
  );
}

function LiveMirrorDocumentPlaceholder({ media }: { media: LiveMirrorMedia }) {
  const isUrl = media.kind === "url";

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/20 p-3 text-center text-xs text-muted-foreground">
      {isUrl ? <Link2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
      <span className="line-clamp-2 max-w-full">{media.label}</span>
      <span>{isUrl ? "Live URL preview unavailable" : "Document preview"}</span>
    </div>
  );
}

function LiveMirrorMediaSurface({
  media,
  active,
}: {
  media: LiveMirrorMedia;
  active: boolean;
}) {
  if (media.kind === "video" && media.url) {
    return <LiveMirrorVideo media={media} active={active} />;
  }

  if (media.kind === "pdf" && media.url) {
    return (
      <iframe
        src={media.url}
        title={media.label}
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  if (media.kind === "image" && media.url) {
    return (
      <img
        src={media.url}
        alt={media.label}
        className="h-full w-full bg-black"
        style={{ objectFit: media.fit === "stretch" ? "fill" : media.fit }}
      />
    );
  }

  return <LiveMirrorDocumentPlaceholder media={media} />;
}

export function LiveScreenMirror({
  snapshot,
  fallbackAspectRatio,
  fallbackPreviewUrl,
  isLoading = false,
  errorMessage,
  clockTick = 0,
  className,
}: LiveScreenMirrorProps) {
  const { ref, isVisible } = useElementVisibility<HTMLDivElement>();
  const serverClockOffsetMs = useMemo(
    () => getServerClockOffsetMs(snapshot?.server_time),
    [snapshot?.server_time],
  );
  const nowMs = getServerNowFromOffset(serverClockOffsetMs);

  const mirror = useMemo(
    () => buildLiveMirrorState(snapshot, nowMs, fallbackAspectRatio),
    [snapshot, nowMs, fallbackAspectRatio],
  );
  const stageAspectRatio = getLiveMirrorAspectRatio(mirror.aspectRatio ?? fallbackAspectRatio);

  return (
    <div
      ref={ref}
      className={cn("relative overflow-hidden rounded-md bg-black", className)}
      style={{ aspectRatio: stageAspectRatio }}
    >
      {isLoading ? (
        <div className="absolute inset-0 animate-pulse bg-muted/40" />
      ) : errorMessage && fallbackPreviewUrl ? (
        <>
          <img
            src={fallbackPreviewUrl}
            alt="Latest captured screen preview"
            className="h-full w-full object-contain"
            loading="lazy"
          />
          <div className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-xs text-white">
            Snapshot unavailable. Showing latest captured screenshot.
          </div>
        </>
      ) : mirror.slots.length > 0 ? (
        mirror.slots.map((slot) => (
          <div
            key={slot.id}
            className="absolute overflow-hidden bg-black"
            style={{
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${slot.w * 100}%`,
              height: `${slot.h * 100}%`,
            }}
          >
            {slot.media ? <LiveMirrorMediaSurface media={slot.media} active={isVisible} /> : null}
          </div>
        ))
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <ImageOff className="h-8 w-8" />
          <span className="text-sm">Screen is online, but no schedule or default media is assigned yet.</span>
        </div>
      )}
    </div>
  );
}
