import { ApiError } from "@/api/apiClient";
import { mediaApi } from "@/api/domains/media";
import type { MediaAsset } from "@/api/types";
import { maybeCompressForUpload, type CompressionResult } from "@/lib/mediaCompression";
import { deriveDisplayNameFromFilename } from "@/lib/media";

export const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export const allowedExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".mp4",
  ".mov",
  ".pdf",
  ".ppt",
  ".pptx",
  ".csv",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
]);

export interface UploadMediaResult extends CompressionResult {
  media: MediaAsset;
}

const sleep = (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

class UploadHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadHttpError";
    this.status = status;
  }
}

const isImageOrVideo = (contentType: string) =>
  contentType.startsWith("image/") || contentType.startsWith("video/");

const extFromName = (name: string) =>
  name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";

export const validateUploadFile = (file: File): string | null => {
  const ext = extFromName(file.name);
  const allowed = allowedMimeTypes.has(file.type) || (ext && allowedExtensions.has(ext));
  if (!allowed) {
    return "Unsupported file type. Allowed: JPEG, PNG, WEBP, MP4, MOV, PDF, PPT/PPTX, CSV, DOC/DOCX, XLS/XLSX.";
  }
  return null;
};

export const readMediaMetadata = (
  file: File,
): Promise<Partial<{ width: number; height: number; duration_seconds: number }>> =>
  new Promise((resolve) => {
    if (typeof window === "undefined") return resolve({});

    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve({});
        URL.revokeObjectURL(url);
      };
      img.src = url;
      return;
    }

    if (file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        resolve({
          width: video.videoWidth || undefined,
          height: video.videoHeight || undefined,
          duration_seconds: Number.isNaN(video.duration) ? undefined : Math.round(video.duration),
        });
        URL.revokeObjectURL(url);
      };
      video.onerror = () => {
        resolve({});
        URL.revokeObjectURL(url);
      };
      video.src = url;
      return;
    }

    resolve({});
  });

const uploadViaXhr = (
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      const progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
      onProgress(progress);
    };

    xhr.onerror = () => {
      reject(new UploadHttpError(0, "Upload failed due to a network error."));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }

      const message = xhr.responseText || "Upload failed.";
      reject(new UploadHttpError(xhr.status, message));
    };

    xhr.send(file);
  });

export const uploadMediaWithPresign = async (
  file: File,
  opts?: {
    displayName?: string;
    onProgress?: (percent: number) => void;
    onPrepared?: (result: CompressionResult) => void;
  },
): Promise<UploadMediaResult> => {
  const processed = await maybeCompressForUpload(file);
  const finalFile = processed.file;
  const contentType = finalFile.type || "application/octet-stream";

  opts?.onPrepared?.(processed);

  const presign = await mediaApi.presignUpload({
    filename: finalFile.name,
    display_name: opts?.displayName?.trim() || deriveDisplayNameFromFilename(file.name),
    content_type: contentType,
    size: finalFile.size,
  });

  await uploadViaXhr(presign.upload_url, finalFile, contentType, opts?.onProgress);

  const metadata =
    processed.width || processed.height
      ? {
          width: processed.width,
          height: processed.height,
          duration_seconds: processed.durationSeconds,
        }
      : await readMediaMetadata(finalFile);

  const media = await mediaApi.complete(presign.media_id, {
    content_type: contentType,
    size: finalFile.size,
    ...metadata,
  });

  return {
    ...processed,
    media,
  };
};

export const getFriendlyUploadError = (error: unknown): string => {
  const status =
    error instanceof ApiError
      ? error.status
      : error instanceof UploadHttpError
      ? error.status
      : undefined;

  if (status === 413) return "Upload failed: file is too large.";
  if (status === 415) return "Upload failed: unsupported file type.";
  if (status === 403) return "Upload failed: you do not have permission to upload this file.";

  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Upload failed. Please try again.";
};

const getFriendlyProcessingFailure = (media: MediaAsset): string => {
  switch (media.status_reason) {
    case "WEBPAGE_HTTP_400":
    case "WEBPAGE_HTTP_401":
    case "WEBPAGE_HTTP_403":
    case "WEBPAGE_HTTP_404":
    case "WEBPAGE_HTTP_500":
      return `The webpage URL returned ${media.status_reason.replace("WEBPAGE_HTTP_", "HTTP ")} during server verification.`;
    case "WEBPAGE_NON_HTML_CONTENT":
      return "The URL did not return an HTML webpage. Use a normal webpage URL, not an API or file endpoint.";
    case "WEBPAGE_REQUEST_TIMEOUT":
      return "The webpage took too long to respond during server verification.";
    case "WEBPAGE_UNREACHABLE":
      return "The server could not reach this webpage URL during verification.";
    case "WEBPAGE_CAPTURE_FAILED":
      return "The server could not verify this webpage or generate its fallback preview.";
    case "DOCUMENT_CONVERSION_FAILED":
      return "The server could not convert this document into a displayable PDF.";
    default:
      return "Server verification failed for this upload.";
  }
};

export const waitForMediaReady = async (
  mediaId: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<MediaAsset> => {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const intervalMs = options?.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const media = await mediaApi.getById(mediaId);
    if (media.status === "READY") {
      return media;
    }
    if (media.status === "FAILED") {
      throw new Error(getFriendlyProcessingFailure(media));
    }

    await sleep(intervalMs);
  }

  throw new Error("Server verification is taking longer than expected. Please refresh and try again.");
};

export const createLocalPreviewUrl = (file: File) => {
  const contentType = file.type || "";
  if (!isImageOrVideo(contentType)) return undefined;
  return URL.createObjectURL(file);
};

export { UploadHttpError };
