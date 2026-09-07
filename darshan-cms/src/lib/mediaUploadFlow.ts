import { ApiError } from "@/api/apiClient";
import { mediaApi, type MediaUploadPolicy, type UploadSessionResponse } from "@/api/domains/media";
import type { MediaAsset } from "@/api/types";
import { maybeCompressForUpload, type CompressionResult } from "@/lib/mediaCompression";
import { deriveDisplayNameFromFilename } from "@/lib/media";
import { createSHA256 } from "hash-wasm";

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
const HASH_CHUNK_BYTES = 4 * 1024 * 1024;
const SESSION_STORAGE_PREFIX = "darshan.media-upload-session.v1:";

class UploadHttpError extends Error {
  status: number;
  stage: UploadStage;
  requestId?: string;
  code?: string;
  retryable: boolean;

  constructor(
    status: number,
    message: string,
    stage: UploadStage = "storage-put",
    requestId?: string,
    code?: string,
  ) {
    super(message);
    this.name = "UploadHttpError";
    this.status = status;
    this.stage = stage;
    this.requestId = requestId;
    this.code = code;
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500;
  }
}

type UploadStage = "policy" | "session-create" | "storage-put" | "part-presign" | "part-upload" | "complete" | "verification";

const resolveUploadRemediation = (stage: UploadStage, retryable: boolean) => {
  if (stage === "policy") return "Choose a file within the displayed upload policy.";
  if (retryable) return "Retry with the same file to resume the saved upload where possible.";
  if (stage === "verification") return "Review the server verification reason, correct the source, and upload again.";
  return "Start a new upload or contact an administrator with the reference code.";
};

class UploadPipelineError extends Error {
  stage: UploadStage;
  cause: unknown;
  status?: number;
  code?: string;
  requestId?: string;
  retryable: boolean;
  remediation: string;

  constructor(stage: UploadStage, cause: unknown) {
    super(cause instanceof Error ? cause.message : "Upload failed.");
    this.name = "UploadPipelineError";
    this.stage = stage;
    this.cause = cause;
    this.status = cause instanceof ApiError || cause instanceof UploadHttpError ? cause.status : undefined;
    this.code = cause instanceof ApiError || cause instanceof UploadHttpError ? cause.code : undefined;
    this.requestId = cause instanceof ApiError ? cause.traceId : cause instanceof UploadHttpError ? cause.requestId : undefined;
    this.retryable =
      cause instanceof UploadHttpError
        ? cause.retryable
        : cause instanceof ApiError
          ? cause.status === 408 || cause.status === 429 || cause.status >= 500
          : false;
    this.remediation = resolveUploadRemediation(stage, this.retryable);
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
      reject(new UploadHttpError(
        xhr.status,
        message,
        "storage-put",
        xhr.getResponseHeader("X-Request-Id") ?? xhr.getResponseHeader("X-Correlation-Id") ?? undefined,
      ));
    };

    xhr.send(body);
  });

export const sha256File = async (file: File, chunkBytes = HASH_CHUNK_BYTES): Promise<string> => {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new Error("Hash chunk size must be a positive safe integer.");
  }

  const hasher = await createSHA256();
  hasher.init();
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    const chunk = await file.slice(offset, Math.min(offset + chunkBytes, file.size)).arrayBuffer();
    hasher.update(new Uint8Array(chunk));
  }
  return hasher.digest("hex");
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
    let response: Awaited<ReturnType<typeof mediaApi.presignUploadParts>>;
    try {
      response = await mediaApi.presignUploadParts(session.session_id, batch);
    } catch (error) {
      throw new UploadPipelineError("part-presign", error);
    }
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
          let uploadUrl = attempt === 0 ? urlByPart.get(partNumber) : undefined;
          if (attempt > 0) {
            try {
              uploadUrl = (await mediaApi.presignUploadParts(session.session_id, [partNumber])).parts[0]?.upload_url;
            } catch (error) {
              throw new UploadPipelineError("part-presign", error);
            }
          }
          if (!uploadUrl) throw new Error(`No upload URL returned for part ${partNumber}.`);
          try {
            etag = await uploadViaXhr(uploadUrl, part, contentType, (percent) => {
              progressByPart.set(partNumber, Math.round((part.size * percent) / 100));
              reportProgress();
            });
          } catch (error) {
            throw new UploadPipelineError("part-upload", error);
          }
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
  let policy: MediaUploadPolicy;
  try {
    policy = await mediaApi.getUploadPolicy();
  } catch (error) {
    throw new UploadPipelineError("policy", error);
  }
  const processed = await maybeCompressForUpload(file);
  const finalFile = processed.file;
  const contentType = finalFile.type || "application/octet-stream";

  if (finalFile.size > policy.max_bytes) {
    throw new UploadHttpError(
      413,
      `The prepared file is ${(finalFile.size / (1024 * 1024)).toFixed(2)} MiB; the server limit is ${policy.max_mb} MiB.`,
      "policy",
    );
  }

  opts?.onPrepared?.(processed);
  const checksum = await sha256File(finalFile);
  let resolvedSession: Awaited<ReturnType<typeof resolveUploadSession>>;
  try {
    resolvedSession = await resolveUploadSession({
      file: finalFile,
      contentType,
      displayName: opts?.displayName?.trim() || deriveDisplayNameFromFilename(file.name),
      checksum,
    });
  } catch (error) {
    throw new UploadPipelineError("session-create", error);
  }
  const { session: initialSession, storageKey } = resolvedSession;

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

  if (initialSession.strategy === "single") {
    const uploadUrl = initialSession.upload_url || (await mediaApi.getUploadSession(initialSession.session_id)).upload_url;
    if (!uploadUrl) throw new Error("Upload session did not return a single-upload URL.");
    try {
      await uploadViaXhr(uploadUrl, finalFile, contentType, opts?.onProgress);
    } catch (error) {
      throw new UploadPipelineError("storage-put", error);
    }
  }

  const parts =
    initialSession.strategy === "multipart"
      ? await uploadMultipart({ session: initialSession, file: finalFile, contentType, onProgress: opts?.onProgress })
      : undefined;
  let completed: UploadSessionResponse;
  try {
    completed = await mediaApi.completeUploadSession(initialSession.session_id, { parts, ...metadata });
  } catch (error) {
    throw new UploadPipelineError("complete", error);
  }
  const media = requireCompletedMedia(completed);
  clearPersistedSessionId(storageKey);

  return {
    ...processed,
    media,
  };
};

export const getFriendlyUploadError = (error: unknown): string => {
  const pipelineError = error instanceof UploadPipelineError ? error : undefined;
  const rootError = pipelineError?.cause ?? error;
  const status =
    rootError instanceof ApiError
      ? rootError.status
      : rootError instanceof UploadHttpError
      ? rootError.status
      : undefined;
  const stage = pipelineError?.stage ?? (rootError instanceof UploadHttpError ? rootError.stage : undefined);
  const requestId = pipelineError?.requestId ?? (rootError instanceof ApiError ? rootError.traceId : rootError instanceof UploadHttpError ? rootError.requestId : undefined);
  const code = pipelineError?.code ?? (rootError instanceof ApiError ? rootError.code : rootError instanceof UploadHttpError ? rootError.code : undefined);
  const retryable = pipelineError?.retryable ?? (rootError instanceof UploadHttpError ? rootError.retryable : false);
  const suffix = `${stage ? ` Stage: ${stage}.` : ""}${code ? ` Code: ${code}.` : ""}${requestId ? ` Reference: ${requestId}.` : ""}`;

  if (status === 413) {
    const boundary =
      stage === "policy"
        ? "the application upload policy"
        : stage === "storage-put" || stage === "part-upload"
          ? "the object-storage upload gateway"
          : stage === "session-create" || stage === "part-presign" || stage === "complete"
            ? "the CMS/API gateway"
            : "an upstream HTTP gateway";
    return `Upload rejected by ${boundary} because its configured size limit was exceeded.${suffix}`;
  }
  if (status === 415) return `Upload failed: unsupported file type.${suffix}`;
  if (status === 403) return `Upload failed: you do not have permission to upload this file.${suffix}`;
  if (status === 408) return `Upload paused because the network timed out. Retry with the same file to resume.${suffix}`;
  if (status === 409) return `This upload session is no longer active. Please start the upload again.${suffix}`;
  if (status === 0) return `Network connection interrupted. Retry with the same file to resume the saved upload.${suffix}`;

  const remediation = pipelineError?.remediation;
  const retryHint = remediation ? ` ${remediation}` : retryable ? " Retry with the same file to resume where possible." : "";
  if (rootError instanceof ApiError) return `${rootError.message}${retryHint}${suffix}`;
  if (rootError instanceof Error) return `${rootError.message}${retryHint}${suffix}`;
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
    case "WEBPAGE_HOST_NOT_ALLOWED":
    case "WEBPAGE_ADDRESS_BLOCKED":
    case "WEBPAGE_REDIRECT_BLOCKED":
    case "WEBPAGE_RESOURCE_BLOCKED":
    case "WEBPAGE_SCHEME_BLOCKED":
    case "WEBPAGE_PORT_BLOCKED":
    case "WEBPAGE_CREDENTIALS_BLOCKED":
      return "The webpage was blocked by the configured webpage security policy.";
    case "WEBPAGE_DNS_POLICY_FAILED":
      return "The webpage hostname could not be resolved safely by the server.";
    case "WEBPAGE_RESPONSE_TOO_LARGE":
      return "The webpage document exceeded the server verification size limit.";
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
      throw new UploadPipelineError("verification", new Error(getFriendlyProcessingFailure(media)));
    }

    await sleep(intervalMs);
  }

  throw new UploadPipelineError(
    "verification",
    new Error("Server verification is taking longer than expected. Please refresh and try again."),
  );
};

export const createLocalPreviewUrl = (file: File) => {
  const contentType = file.type || "";
  if (!isImageOrVideo(contentType)) return undefined;
  return URL.createObjectURL(file);
};

export { UploadHttpError, UploadPipelineError };
