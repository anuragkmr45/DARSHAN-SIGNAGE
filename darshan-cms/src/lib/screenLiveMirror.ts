import type { LayoutSlot, MediaAsset, ScreenSnapshot, ScreenSnapshotScheduleItem } from "@/api/types";
import { resolveMediaDisplayName, resolveMediaMimeType } from "@/lib/media";

export type LiveMirrorMediaKind = "image" | "video" | "pdf" | "document" | "url";

export interface LiveMirrorMedia {
  id: string;
  label: string;
  kind: LiveMirrorMediaKind;
  url?: string;
  fit: "cover" | "contain" | "stretch";
  loop: boolean;
  muted: boolean;
  contentType?: string;
}

export interface LiveMirrorSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  media: LiveMirrorMedia | null;
}

export interface LiveMirrorState {
  source: "emergency" | "schedule" | "default" | "empty";
  aspectRatio: string | null;
  slots: LiveMirrorSlot[];
}

type SnapshotMediaLike = Partial<MediaAsset> & {
  id?: string | null;
  media_id?: string | null;
  media_url?: string | null;
  url?: string | null;
  type?: string | null;
  source_content_type?: string | null;
  content_type?: string | null;
  name?: string | null;
  filename?: string | null;
  display_name?: string | null;
  fit_mode?: string | null;
  loop_enabled?: boolean | null;
  audio_enabled?: boolean | null;
};

type SnapshotPresentationEntry = SnapshotMediaLike & {
  order?: number | null;
  duration_seconds?: number | null;
  media?: SnapshotMediaLike | null;
  slot_id?: string | null;
};

const DEFAULT_DURATION_MS = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toCssAspectRatio = (aspectRatio?: string | null) => {
  if (!aspectRatio) return null;
  const [width, height] = aspectRatio.split(":").map((value) => Number(value.trim()));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return `${width} / ${height}`;
};

const normalizeFit = (value?: string | null): "cover" | "contain" | "stretch" => {
  if (value === "cover" || value === "contain" || value === "stretch") {
    return value;
  }
  return "cover";
};

const inferMediaKind = (media?: SnapshotMediaLike | null): LiveMirrorMediaKind => {
  const explicitType = media?.type?.toLowerCase();
  const mimeType = resolveMediaMimeType(media)?.toLowerCase();
  const url = (media?.media_url ?? media?.url ?? "").toLowerCase();

  if (
    explicitType === "video" ||
    mimeType?.startsWith("video/") ||
    /\.(mp4|mov|m4v|webm|ogg)(\?|#|$)/.test(url)
  ) {
    return "video";
  }

  if (
    explicitType === "image" ||
    mimeType?.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|#|$)/.test(url)
  ) {
    return "image";
  }

  if (mimeType?.includes("pdf") || /\.pdf(\?|#|$)/.test(url)) return "pdf";
  if (explicitType === "url") return "url";
  return "document";
};

const getMediaUrl = (entry?: SnapshotMediaLike | null, mediaUrls?: Record<string, string>) => {
  const mediaId = entry?.media_id ?? entry?.id;
  if (mediaId && mediaUrls?.[mediaId]) {
    return mediaUrls[mediaId];
  }
  return entry?.media_url ?? entry?.url ?? undefined;
};

const buildLiveMirrorMedia = (
  entry: SnapshotMediaLike | null | undefined,
  mediaUrls?: Record<string, string>,
): LiveMirrorMedia | null => {
  if (!entry) return null;

  const url = getMediaUrl(entry, mediaUrls);
  const kind = inferMediaKind({ ...entry, media_url: url });
  const id = entry.media_id ?? entry.id;

  if (!id && !url) {
    return null;
  }

  return {
    id: id ?? url ?? "live-mirror-media",
    label: resolveMediaDisplayName(entry),
    kind,
    url,
    fit: normalizeFit(entry.fit_mode),
    loop: entry.loop_enabled === true,
    muted: entry.audio_enabled === true ? false : true,
    contentType: resolveMediaMimeType(entry),
  };
};

const getLayoutSlots = (value: unknown): LayoutSlot[] => {
  if (Array.isArray(value)) {
    return value
      .map((slot) => {
        if (!isRecord(slot)) return null;
        const id = typeof slot.id === "string" ? slot.id : null;
        const x = Number(slot.x);
        const y = Number(slot.y);
        const w = Number(slot.w);
        const h = Number(slot.h);
        if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
          return null;
        }
        return { id, x, y, w, h } satisfies LayoutSlot;
      })
      .filter((slot): slot is LayoutSlot => Boolean(slot));
  }

  if (isRecord(value) && Array.isArray(value.slots)) {
    return getLayoutSlots(value.slots);
  }

  return [];
};

const getDurationMs = (entry: { duration_seconds?: number | null }) => {
  const durationSeconds = Number(entry.duration_seconds ?? 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return DEFAULT_DURATION_MS;
  }
  return Math.max(1, durationSeconds) * 1000;
};

const pickCycledEntry = <T extends { order?: number | null; duration_seconds?: number | null }>(
  entries: T[],
  nowMs: number,
  windowStartMs: number,
): T | null => {
  if (entries.length === 0) return null;

  const sorted = [...entries].sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0));
  if (!Number.isFinite(windowStartMs)) {
    return sorted[0] ?? null;
  }

  const totalDurationMs = sorted.reduce((sum, entry) => sum + getDurationMs(entry), 0);
  if (totalDurationMs <= 0) {
    return sorted[0] ?? null;
  }

  const elapsedMs = Math.max(0, nowMs - windowStartMs);
  let cursor = elapsedMs % totalDurationMs;

  for (const entry of sorted) {
    const durationMs = getDurationMs(entry);
    if (cursor < durationMs) {
      return entry;
    }
    cursor -= durationMs;
  }

  return sorted[sorted.length - 1] ?? null;
};

const pickActiveScheduleItem = (
  items: ScreenSnapshotScheduleItem[] | undefined,
  nowMs: number,
) => {
  return (items ?? [])
    .filter((item) => {
      const startMs = Date.parse(item.start_at);
      const endMs = Date.parse(item.end_at);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return false;
      }
      return startMs <= nowMs && nowMs < endMs;
    })
    .sort((left, right) => {
      if ((right.priority ?? 0) !== (left.priority ?? 0)) {
        return (right.priority ?? 0) - (left.priority ?? 0);
      }
      return Date.parse(right.start_at) - Date.parse(left.start_at);
    })[0];
};

const buildScheduleSlots = (
  item: ScreenSnapshotScheduleItem,
  mediaUrls: Record<string, string>,
  nowMs: number,
): { aspectRatio: string | null; slots: LiveMirrorSlot[] } => {
  const presentation = item.presentation;
  if (!presentation) {
    return { aspectRatio: null, slots: [] };
  }

  const layoutSlots = getLayoutSlots(presentation.layout?.spec);
  const windowStartMs = Date.parse(item.start_at);

  if (layoutSlots.length > 0 && Array.isArray(presentation.slots) && presentation.slots.length > 0) {
    const slots = layoutSlots.map((layoutSlot) => {
      const slotEntries = presentation.slots?.filter((entry) => entry.slot_id === layoutSlot.id) ?? [];
      const activeEntry = pickCycledEntry(slotEntries, nowMs, windowStartMs);
      const media = buildLiveMirrorMedia(activeEntry?.media ? { ...activeEntry.media, ...activeEntry } : activeEntry, mediaUrls);

      return {
        id: layoutSlot.id,
        x: layoutSlot.x,
        y: layoutSlot.y,
        w: layoutSlot.w,
        h: layoutSlot.h,
        media,
      } satisfies LiveMirrorSlot;
    });

    return {
      aspectRatio: presentation.layout?.aspect_ratio ?? null,
      slots,
    };
  }

  const presentationItems = Array.isArray((presentation as { items?: SnapshotPresentationEntry[] }).items)
    ? ((presentation as { items?: SnapshotPresentationEntry[] }).items as SnapshotPresentationEntry[])
    : [];
  const activeEntry = pickCycledEntry(presentationItems, nowMs, windowStartMs);
  const media = buildLiveMirrorMedia(
    activeEntry ? { ...(activeEntry.media ?? {}), ...activeEntry } : null,
    mediaUrls,
  );

  return {
    aspectRatio: presentation.layout?.aspect_ratio ?? null,
    slots: [
      {
        id: "full",
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        media,
      },
    ],
  };
};

const buildFullStage = (
  source: "emergency" | "default",
  media: SnapshotMediaLike | null,
  mediaUrls: Record<string, string>,
  fallbackAspectRatio?: string | null,
): LiveMirrorState => ({
  source,
  aspectRatio: fallbackAspectRatio ?? null,
  slots: [
    {
      id: "full",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      media: buildLiveMirrorMedia(media, mediaUrls),
    },
  ],
});

export const getLiveMirrorAspectRatio = (aspectRatio?: string | null) => toCssAspectRatio(aspectRatio) ?? "16 / 9";

export function buildLiveMirrorState(
  snapshot: ScreenSnapshot | null | undefined,
  nowMs: number,
  fallbackAspectRatio?: string | null,
): LiveMirrorState {
  if (!snapshot) {
    return {
      source: "empty",
      aspectRatio: fallbackAspectRatio ?? null,
      slots: [],
    };
  }

  const mediaUrls = snapshot.media_urls ?? {};
  const emergency = isRecord(snapshot.emergency) ? (snapshot.emergency as SnapshotMediaLike) : null;
  const defaultMedia = isRecord(snapshot.default_media) ? (snapshot.default_media as SnapshotMediaLike) : null;

  if (emergency) {
    return buildFullStage("emergency", emergency, mediaUrls, fallbackAspectRatio);
  }

  const activeScheduleItem = pickActiveScheduleItem(snapshot.snapshot?.schedule?.items, nowMs);
  if (activeScheduleItem) {
    const scheduleState = buildScheduleSlots(activeScheduleItem, mediaUrls, nowMs);
    return {
      source: "schedule",
      aspectRatio: scheduleState.aspectRatio ?? fallbackAspectRatio ?? null,
      slots: scheduleState.slots,
    };
  }

  if (defaultMedia) {
    return buildFullStage("default", defaultMedia, mediaUrls, fallbackAspectRatio);
  }

  return {
    source: "empty",
    aspectRatio: fallbackAspectRatio ?? null,
    slots: [],
  };
}
