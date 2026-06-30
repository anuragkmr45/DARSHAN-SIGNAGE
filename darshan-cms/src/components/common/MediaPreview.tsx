import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Video as VideoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaAsset } from "@/api/types";
import { resolveMediaDisplayName } from "@/lib/media";

type MediaPreviewProps = {
  media?: MediaAsset;
  url?: string;
  type?: string;
  alt?: string;
  className?: string;
  fit?: "cover" | "contain" | "stretch";
  videoControls?: boolean;
  videoMuted?: boolean;
  videoAutoPlay?: boolean;
  videoLoop?: boolean;
};

const resolveObjectFit = (fit: MediaPreviewProps["fit"]) => {
  if (fit === "contain" || fit === "cover") return fit;
  if (fit === "stretch") return "fill";
  return "cover";
};

export function MediaPreview({
  media,
  url,
  type,
  alt,
  className,
  fit,
  videoControls = true,
  videoMuted = true,
  videoAutoPlay = false,
  videoLoop = false,
}: MediaPreviewProps) {
  const isExplicitWebpage = (media?.type ?? "").toLowerCase() === "webpage";
  const sourceUrl = url ?? (isExplicitWebpage ? media?.fallback_media_url ?? media?.media_url : media?.media_url) ?? media?.thumbnail_object_id;
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const normalizedType = (
    type ??
    media?.content_type ??
    media?.source_content_type ??
    media?.type ??
    ""
  ).toLowerCase();
  const mediaType = (media?.type ?? "").toLowerCase();
  const isWebpage = mediaType === "webpage" || normalizedType === "webpage";
  const extension = sourceUrl
    ? sourceUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? ""
    : "";

  const showVideo =
    Boolean(sourceUrl) &&
    (normalizedType.startsWith("video/") ||
      normalizedType === "video" ||
      mediaType === "video" ||
      ["mp4", "mov", "webm", "m4v", "ogg"].includes(extension));

  const showPdf =
    Boolean(sourceUrl) &&
    (normalizedType.includes("pdf") || extension === "pdf");

  const showImage =
    Boolean(sourceUrl) &&
    (isWebpage ||
      normalizedType.startsWith("image/") ||
      normalizedType === "image" ||
      mediaType === "image" ||
      ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(extension));

  useEffect(() => {
    setPdfLoaded(false);
  }, [showPdf, sourceUrl]);

  if (showVideo) {
    return (
      <video
        src={sourceUrl}
        className={cn("rounded-md bg-muted object-cover", className)}
        controls={videoControls}
        preload="metadata"
        muted={videoMuted}
        autoPlay={videoAutoPlay}
        loop={videoLoop}
        playsInline
        style={{ objectFit: resolveObjectFit(fit) }}
      />
    );
  }

  if (showPdf) {
    return (
      <div className={cn("relative overflow-hidden rounded-md bg-muted", className)}>
        {!pdfLoaded && <div className="absolute inset-0 animate-pulse bg-muted" />}
        <iframe
          src={sourceUrl}
          title={alt ?? resolveMediaDisplayName(media) ?? "PDF preview"}
          onLoad={() => setPdfLoaded(true)}
          className={cn("h-full w-full border-0 transition-opacity", pdfLoaded ? "opacity-100" : "opacity-0")}
        />
      </div>
    );
  }

  if (showImage) {
    return (
      <img
        src={sourceUrl}
        alt={alt ?? resolveMediaDisplayName(media) ?? "Media preview"}
        className={cn("rounded-md object-cover bg-muted", className)}
        style={{ objectFit: resolveObjectFit(fit) }}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-md bg-muted flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs text-center px-2 py-3",
        className,
      )}
    >
      {showVideo ? <VideoIcon className="h-5 w-5" /> : showImage ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
      <span className="line-clamp-2 max-w-full">
        {alt ?? resolveMediaDisplayName(media) ?? "No preview available"}
      </span>
    </div>
  );
}
