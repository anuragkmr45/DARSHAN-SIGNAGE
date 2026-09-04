import { ApiError } from "@/api/apiClient";
import { mediaApi, type UploadSessionResponse } from "@/api/domains/media";
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
const MULTIPART_CONCURRENCY = 3;
const SESSION_STORAGE_PREFIX = "darshan.media-upload-session.v1:";

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
  body: Blob,
  contentType: string,
  onProgress?: (percent: number) => void,
) =>
  new Promise<string | undefined>((resolve, reject) => {
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
        resolve(xhr.getResponseHeader("ETag") ?? undefined);
        return;
      }

      const message = xhr.responseText || "Upload failed.";
      reject(new UploadHttpError(xhr.status, message));
    };

    xhr.send(body);
  });

const sha256File = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const sessionStorageKey = (file: File, checksum: string) =>
  `${SESSION_STORAGE_PREFIX}${file.name}:${file.size}:${file.lastModified}:${checksum}`;

const getPersistedSessionId = (key: string): string | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const persistSessionId = (key: string, sessionId: string) => {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, sessionId);
  } catch {
    // Storage being unavailable must not block the upload itself.
  }
};

const clearPersistedSessionId = (key: string) => {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  } catch {
    // Storage being unavailable must not block the upload itself.
  }
};

const newIdempotencyKey = () => crypto.randomUUID();

const partByteLength = (fileSize: number, partSize: number, partNumber: number) =>
  Math.min(partSize, fileSize - (partNumber - 1) * partSize);

const requireCompletedMedia = (session: UploadSessionResponse): MediaAsset => {
  if (!session.media) throw new Error("Upload completed without a media record.");
  return session.media;
};

const resolveUploadSession = async (params: {
  file: File;
  contentType: string;
  displayName: string;
  checksum: string;
}): Promise<{ session: UploadSessionResponse; storageKey: string }> => {
  const storageKey = sessionStorageKey(params.file, params.checksum);
  const persistedSessionId = getPersistedSessionId(storageKey);
  if (persistedSessionId) {
    try {
      const existing = await mediaApi.getUploadSession(persistedSessionId);
      if (existing.state === "ACTIVE" && new Date(existing.expires_at).getTime() > Date.now()) {
        return { session: existing, storageKey };
      }
      if (existing.state === "COMPLETED") {
        return { session: existing, storageKey };
      }
    } catch {
      // A user may have changed browser/auth context. Create a fresh session.
    }
    clearPersistedSessionId(storageKey);
  }

  const session = await mediaApi.createUploadSession(
    {
      filename: params.file.name,
      display_name: params.displayName,
      content_type: params.contentType,
      size: params.file.size,
      checksum_sha256: params.checksum,
    },
    newIdempotencyKey(),
  );
  persistSessionId(storageKey, session.session_id);
  return { session, storageKey };
};

const uploadMultipart = async (params: {
  session: UploadSessionResponse;
  file: File;
  contentType: string;
  onProgress?: (percent: number) => void;
}) => {
  const { session, file, contentType, onProgress } = params;
  if (!session.part_size) throw new Error("Multipart upload session is missing part_size.");
  const uploadedEtags = new Map(session.uploaded_parts.map((part) => [part.part_number, part.etag]));
  const totalParts = session.part_count;
  const progressByPart = new Map<number, number>();
  for (const partNumber of uploadedEtags.keys()) {
    progressByPart.set(partNumber, partByteLength(file.size, session.part_size, partNumber));
  }

  const reportProgress = () => {
    const uploaded = Array.from(progressByPart.values()).reduce((sum, value) => sum + value, 0);
    onProgress?.(Math.min(100, Math.round((uploaded / file.size) * 100)));
  };
  reportProgress();

  const pendingPartNumbers = Array.from({ length: totalParts }, (_value, index) => index + 1).filter(
    (partNumber) => !uploadedEtags.has(partNumber),
  );
  const urlByPart = new Map<number, string>();
  for (let start = 0; start < pendingPartNumbers.length; start += 20) {
    const batch = pendingPartNumbers.slice(start, start + 20);
    const response = await mediaApi.presignUploadParts(session.session_id, batch);
    response.parts.forEach((part) => urlByPart.set(part.part_number, part.upload_url));
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < pendingPartNumbers.length) {
      const partNumber = pendingPartNumbers[cursor++];
      const start = (partNumber - 1) * session.part_size;
      const part = file.slice(start, Math.min(start + session.part_size, file.size));
      let etag: string | undefined;
      let lastError: unknown;

      for (let attempt = 0; attempt < 2 && !etag; attempt += 1) {
        try {
          const uploadUrl =
            attempt === 0 ? urlByPart.get(partNumber) : (await mediaApi.presignUploadParts(session.session_id, [partNumber])).parts[0]?.upload_url;
          if (!uploadUrl) throw new Error(`No upload URL returned for part ${partNumber}.`);
          etag = await uploadViaXhr(uploadUrl, part, contentType, (percent) => {
            progressByPart.set(partNumber, Math.round((part.size * percent) / 100));
            reportProgress();
          });
          if (!etag) throw new Error(`Object storage did not return an ETag for part ${partNumber}.`);
        } catch (error) {
          lastError = error;
        }
      }

      if (!etag) {
        throw lastError instanceof Error ? lastError : new Error(`Part ${partNumber} upload failed.`);
      }
      uploadedEtags.set(partNumber, etag);
      progressByPart.set(partNumber, part.size);
      reportProgress();
    }
  };

  await Promise.all(Array.from({ length: Math.min(MULTIPART_CONCURRENCY, pendingPartNumbers.length) }, worker));
  return Array.from(uploadedEtags.entries())
    .map(([part_number, etag]) => ({ part_number, etag }))
    .sort((left, right) => left.part_number - right.part_number);
};

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
  const checksum = await sha256File(finalFile);
  const { session: initialSession, storageKey } = await resolveUploadSession({
    file: finalFile,
    contentType,
    displayName: opts?.displayName?.trim() || deriveDisplayNameFromFilename(file.name),
    checksum,
  });

  if (initialSession.state === "COMPLETED") {
    clearPersistedSessionId(storageKey);
    return { ...processed, media: requireCompletedMedia(initialSession) };
  }

  if (initialSession.state !== "ACTIVE") {
    clearPersistedSessionId(storageKey);
    throw new Error(`Upload session is ${initialSession.state.toLowerCase()}. Start a new upload.`);
  }

  const metadata =
    processed.width || processed.height
      ? {
          width: processed.width,
          height: processed.height,
          duration_seconds: processed.durationSeconds,
        }
      : await readMediaMetadata(finalFile);

  try {
    if (initialSession.strategy === "single") {
      const uploadUrl = initialSession.upload_url || (await mediaApi.getUploadSession(initialSession.session_id)).upload_url;
      if (!uploadUrl) throw new Error("Upload session did not return a single-upload URL.");
      await uploadViaXhr(uploadUrl, finalFile, contentType, opts?.onProgress);
    }

    const parts =
      initialSession.strategy === "multipart"
        ? await uploadMultipart({ session: initialSession, file: finalFile, contentType, onProgress: opts?.onProgress })
        : undefined;
    const completed = await mediaApi.completeUploadSession(initialSession.session_id, { parts, ...metadata });
    const media = requireCompletedMedia(completed);
    clearPersistedSessionId(storageKey);

    return {
      ...processed,
      media,
    };
  } catch (error) {
    // Keep the session id locally. Retrying the same file resumes server-listed
    // parts rather than silently starting a second object or media record.
    throw error;
  }
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
  if (status === 408) return "Upload paused because the network timed out. Retry with the same file to resume.";
  if (status === 409) return "This upload session is no longer active. Please start the upload again.";
  if (status === 0) return "Network connection interrupted. Retry with the same file to resume the saved upload.";

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
