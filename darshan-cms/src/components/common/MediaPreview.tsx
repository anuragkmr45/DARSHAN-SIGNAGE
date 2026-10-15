import { useEffect, useRef, useState } from "react";
import { FileText, Globe2, Image as ImageIcon, Video as VideoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaAsset } from "@/api/types";
import { resolveMediaDisplayName } from "@/lib/media";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type MediaPreviewProps = {
  media?: MediaAsset;
  url?: string;
  webpageUrl?: string;
  type?: string;
  alt?: string;
  className?: string;
  fit?: "cover" | "contain" | "stretch";
  videoControls?: boolean;
  videoMuted?: boolean;
  videoAutoPlay?: boolean;
  videoLoop?: boolean;
  pdfPage?: number;
};

type PdfRenderTask = { promise: Promise<void>; cancel?: () => void };
type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => PdfRenderTask;
  cleanup?: () => void;
};
type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy?: () => Promise<void>;
};
type PdfLoadingTask = { promise: Promise<PdfDocument>; destroy?: () => Promise<void> };
type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: { url: string }) => PdfLoadingTask;
};

function PdfCanvasPreview({ source, pageNumber, title }: { source: string; pageNumber: number; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let disposed = false;
    let renderTask: PdfRenderTask | undefined;
    let loadingTask: PdfLoadingTask | undefined;
    let documentProxy: PdfDocument | undefined;
    let observer: ResizeObserver | undefined;
    let frame: number | undefined;
    let generation = 0;
    setStatus("loading");

    const render = async () => {
      const currentGeneration = ++generation;
      try {
        if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new Error("Invalid PDF page selection");
        if (!documentProxy) {
          const pdfjs = (await import("pdfjs-dist/build/pdf.mjs")) as unknown as PdfJsModule;
          if (!pdfjs.GlobalWorkerOptions.workerSrc) {
            pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
          }
          loadingTask = pdfjs.getDocument({ url: source });
          documentProxy = await loadingTask.promise;
        }
        if (disposed || currentGeneration !== generation) return;
        if (pageNumber > documentProxy.numPages) throw new Error("Selected page is outside this document");
        const page = await documentProxy.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const rect = containerRef.current?.getBoundingClientRect();
        const width = Math.max(1, rect?.width || baseViewport.width);
        const height = Math.max(1, rect?.height || baseViewport.height);
        const scale = Math.max(0.1, Math.min(width / baseViewport.width, height / baseViewport.height));
        const viewport = page.getViewport({ scale });
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("Canvas rendering is unavailable");
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderTask?.cancel?.();
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        if (!disposed && currentGeneration === generation) setStatus("ready");
        page.cleanup?.();
      } catch (error) {
        if (disposed || (error instanceof Error && error.name === "RenderingCancelledException")) return;
        setStatus("error");
      }
    };

    const scheduleRender = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => void render());
    };
    scheduleRender();
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      observer = new ResizeObserver(scheduleRender);
      observer.observe(containerRef.current);
    }

    return () => {
      disposed = true;
      generation += 1;
      observer?.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      try { renderTask?.cancel?.(); } catch { /* render already settled */ }
      void documentProxy?.destroy?.().catch(() => undefined);
      void loadingTask?.destroy?.().catch(() => undefined);
    };
  }, [source, pageNumber]);

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center overflow-hidden" title={title}>
      {status === "loading" ? <div className="absolute inset-0 animate-pulse bg-muted" aria-label="Loading PDF preview" /> : null}
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted-foreground">
          PDF page preview unavailable
        </div>
      ) : null}
      <canvas ref={canvasRef} className={cn("block max-h-full max-w-full bg-white", status === "ready" ? "opacity-100" : "opacity-0")} />
    </div>
  );
}

const resolveObjectFit = (fit: MediaPreviewProps["fit"]) => {
  if (fit === "contain" || fit === "cover") return fit;
  if (fit === "stretch") return "fill";
  return "cover";
};

export const resolveMediaPreviewSource = (media?: MediaAsset, url?: string, type?: string) => {
  const isWebpage = (media?.type ?? type ?? "").toLowerCase() === "webpage";
  return isWebpage ? url ?? media?.fallback_media_url : url ?? media?.media_url;
};

export const resolveWebpageHostname = (media?: MediaAsset, webpageUrl?: string) => {
  const candidate = webpageUrl ?? media?.source_url;
  if (!candidate) return "Webpage";
  try {
    return new URL(candidate).hostname || "Webpage";
  } catch {
    return "Webpage";
  }
};

export function MediaPreview({
  media,
  url,
  webpageUrl,
  type,
  alt,
  className,
  fit,
  videoControls = true,
  videoMuted = true,
  videoAutoPlay = false,
  videoLoop = false,
  pdfPage = 1,
}: MediaPreviewProps) {
  const isExplicitWebpage = (media?.type ?? type ?? "").toLowerCase() === "webpage";
  const sourceUrl = resolveMediaPreviewSource(media, url, type);
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
        <PdfCanvasPreview
          source={sourceUrl}
          pageNumber={pdfPage}
          title={alt ?? resolveMediaDisplayName(media) ?? "PDF preview"}
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
      {isWebpage ? <Globe2 className="h-5 w-5" /> : showVideo ? <VideoIcon className="h-5 w-5" /> : showImage ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
      <span className="line-clamp-2 max-w-full">
        {alt ?? resolveMediaDisplayName(media) ?? "No preview available"}
      </span>
      {isWebpage && (media?.source_url || webpageUrl) && (
        <span className="line-clamp-1 max-w-full opacity-75">
          {resolveWebpageHostname(media, webpageUrl)}
        </span>
      )}
    </div>
  );
}
