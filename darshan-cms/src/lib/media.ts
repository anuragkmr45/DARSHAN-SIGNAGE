type MediaLike = {
  id?: string | null;
  name?: string | null;
  filename?: string | null;
  display_name?: string | null;
  type?: string | null;
  content_type?: string | null;
  source_content_type?: string | null;
  media_url?: string | null;
  fallback_media_url?: string | null;
  source_url?: string | null;
};

const trimToUndefined = (value?: string | null) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const deriveDisplayNameFromFilename = (filename: string) => {
  const basename = filename
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return basename && basename.length > 0 ? basename : filename;
};

export const resolveMediaDisplayName = (media?: MediaLike | null) =>
  trimToUndefined(media?.display_name) ??
  trimToUndefined(media?.name) ??
  trimToUndefined(media?.filename) ??
  trimToUndefined(media?.id) ??
  "Untitled media";

export const resolveMediaFilename = (media?: MediaLike | null) =>
  trimToUndefined(media?.filename) ?? trimToUndefined(media?.name) ?? trimToUndefined(media?.id) ?? "file";

export const resolveMediaMimeType = (media?: MediaLike | null) =>
  trimToUndefined(media?.content_type) ?? trimToUndefined(media?.source_content_type);

const sourceFormats: Record<string, { badge: string; label: string }> = {
  "image/jpeg": { badge: "JPEG", label: "JPEG image" },
  "image/png": { badge: "PNG", label: "PNG image" },
  "image/webp": { badge: "WEBP", label: "WebP image" },
  "video/mp4": { badge: "MP4", label: "MP4 video" },
  "video/quicktime": { badge: "MOV", label: "MOV video" },
  "application/pdf": { badge: "PDF", label: "PDF document" },
  "application/vnd.ms-powerpoint": { badge: "PPT", label: "PowerPoint (.ppt)" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { badge: "PPTX", label: "PowerPoint (.pptx)" },
  "text/csv": { badge: "CSV", label: "CSV spreadsheet" },
  "application/msword": { badge: "DOC", label: "Word (.doc)" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { badge: "DOCX", label: "Word (.docx)" },
  "application/vnd.ms-excel": { badge: "XLS", label: "Excel (.xls)" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { badge: "XLSX", label: "Excel (.xlsx)" },
};

export const resolveMediaSourceFormat = (media?: MediaLike | null) => {
  const mimeType = (trimToUndefined(media?.source_content_type) ?? trimToUndefined(media?.content_type))?.toLowerCase();
  return mimeType ? sourceFormats[mimeType] ?? { badge: "FILE", label: mimeType } : { badge: "FILE", label: "Unknown file" };
};

export const resolveMediaPreviewType = (media?: MediaLike | null) => {
  const explicitType = trimToUndefined(media?.type)?.toUpperCase();
  if (explicitType === "IMAGE" || explicitType === "VIDEO" || explicitType === "DOCUMENT" || explicitType === "WEBPAGE") {
    return explicitType;
  }

  const mimeType = resolveMediaMimeType(media)?.toLowerCase();
  if (mimeType?.startsWith("image/")) return "IMAGE";
  if (mimeType?.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
};

const mediaStatusMessages: Record<string, string> = {
  WEBPAGE_CAPTURE_FAILED: "This retired webpage item cannot be prepared for playback.",
  DOCUMENT_CONVERSION_FAILED: "The document could not be converted for screen playback.",
  DOCUMENT_CONVERSION_QUEUE_FAILED: "The document could not be queued for preparation.",
  DOCUMENT_SOURCE_MISSING: "The document's source file is missing.",
  VIDEO_TRANSCODE_FAILED: "The video could not be prepared for screen playback.",
  VIDEO_PROCESSING_QUEUE_FAILED: "The video could not be queued for preparation.",
  VIDEO_SOURCE_MISSING: "The video's source file is missing.",
  MEDIA_OBJECT_MISSING: "The uploaded file is missing from storage.",
  UPLOAD_SESSION_EXPIRED: "The upload was not completed before its session expired.",
  UPLOAD_ABORTED: "The upload was cancelled before completion.",
  USER_DELETED_UPLOAD_ABORTED: "The upload was cancelled when its owner's account was deleted.",
  USER_DELETED_UPLOAD_ABORTED_RETAINED: "The upload was cancelled when its owner's account was deleted.",
  USER_DELETED_CLEANUP_PENDING: "The former owner's unfinished upload is awaiting cleanup.",
  MEDIA_RESTORE_REQUEUE_PENDING: "Preparation will resume after restoration.",
  MEDIA_RESTORE_REQUEUE_CLAIMED: "Preparation is resuming after restoration.",
};

export const describeMediaStatusReason = (reason: string) => {
  const normalized = reason.trim();
  if (!normalized) return { message: "The file could not be prepared.", isTechnicalCode: false };
  if (mediaStatusMessages[normalized]) return { message: mediaStatusMessages[normalized], isTechnicalCode: true };
  if (/^[A-Z][A-Z0-9_]+$/.test(normalized)) {
    return { message: "The file could not be prepared. Ask an administrator to check the processing logs.", isTechnicalCode: true };
  }
  return { message: normalized, isTechnicalCode: false };
};

export const isPdfLikeMedia = (media?: MediaLike | null) => {
  const mimeType = resolveMediaMimeType(media)?.toLowerCase();
  if (mimeType?.includes("pdf")) return true;
  const mediaUrl = trimToUndefined(media?.media_url)?.toLowerCase();
  return Boolean(mediaUrl && /\.pdf(\?|#|$)/.test(mediaUrl));
};
