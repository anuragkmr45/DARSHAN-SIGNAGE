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

export const isPdfLikeMedia = (media?: MediaLike | null) => {
  const mimeType = resolveMediaMimeType(media)?.toLowerCase();
  if (mimeType?.includes("pdf")) return true;
  const mediaUrl = trimToUndefined(media?.media_url)?.toLowerCase();
  return Boolean(mediaUrl && /\.pdf(\?|#|$)/.test(mediaUrl));
};
