import { and, eq, inArray } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { capabilityManifestV1Schema, type CapabilityManifestV1 } from '@/contracts/native-player';

type DB = ReturnType<typeof getDatabase>;

type ReadyMedia = typeof schema.media.$inferSelect & {
  object: typeof schema.storageObjects.$inferSelect | null;
};

export type NativeCompatibilityIssue = {
  screen_id: string;
  media_id: string;
  media_name: string;
  reason: 'MISSING_VERIFIED_RENDITION' | 'UNSUPPORTED_MEDIA_CAPABILITY' | 'MULTI_VIDEO_LAYOUT_UNSUPPORTED';
  required_capability: string;
  corrective_action: 'GENERATE_RENDITION' | 'CHANGE_LAYOUT' | 'REMOVE_TARGET';
};

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function sourceRevision(media: ReadyMedia) {
  return media.object?.sha256 ?? `${media.ready_object_id ?? media.id}:${media.updated_at.toISOString()}`;
}

function isSha256(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function roleFor(media: ReadyMedia): { role: string; codecs: string[]; required: Record<string, unknown> } | null {
  const type = normalized(media.type);
  const mime = normalized(media.object?.content_type ?? media.source_content_type);
  if (type === 'image' && mime.startsWith('image/')) return { role: 'IMAGE_DISPLAY', codecs: [], required: { image_mime_type: mime } };
  // Webpage verification captures an immutable, offline-safe image in the
  // ready object. It is a native rendition, not an interactive URL: devices
  // without a web runtime can display it deterministically.
  if (type === 'webpage' && mime.startsWith('image/')) return { role: 'WEBPAGE_CAPTURE', codecs: [], required: { server_capture_fallback: true, image_mime_type: mime } };
  if (type === 'video' && mime === 'video/mp4') return { role: 'VIDEO_COMPATIBILITY', codecs: ['h264', 'aac'], required: { video_codecs: ['h264'], container: 'mp4' } };
  // Document and webpage rows must be created by their conversion/capture
  // workers because an arbitrary source file or URL is not an offline-safe
  // mobile rendition.
  return null;
}

/**
 * Registers only immutable, checksummed READY objects as mobile candidates.
 * It intentionally refuses to invent a rendition for documents/webpages or
 * unknown video codecs: workers must generate those representations first.
 */
export async function ensureNativeRenditionsForMedia(mediaIds: string[], db: DB = getDatabase()) {
  const uniqueIds = Array.from(new Set(mediaIds));
  if (!uniqueIds.length) return new Map<string, ReadyMedia>();
  const mediaRows = await db.select().from(schema.media).where(inArray(schema.media.id, uniqueIds as any));
  const objectIds = mediaRows.map((media) => media.ready_object_id).filter((id): id is string => Boolean(id));
  const objects = objectIds.length
    ? await db.select().from(schema.storageObjects).where(inArray(schema.storageObjects.id, objectIds as any))
    : [];
  const objectMap = new Map(objects.map((object) => [object.id, object]));
  const result = new Map<string, ReadyMedia>();

  for (const media of mediaRows) {
    const hydrated: ReadyMedia = { ...media, object: media.ready_object_id ? objectMap.get(media.ready_object_id) ?? null : null };
    result.set(media.id, hydrated);
    if (media.status !== 'READY' || !hydrated.object || !isSha256(hydrated.object.sha256)) continue;
    const descriptor = roleFor(hydrated);
    if (!descriptor) continue;
    await db
      .insert(schema.mediaRenditions)
      .values({
        media_id: media.id,
        source_revision: sourceRevision(hydrated).slice(0, 128),
        role: descriptor.role,
        state: 'READY',
        mime_type: normalized(hydrated.object.content_type ?? media.source_content_type),
        container: descriptor.role === 'VIDEO_COMPATIBILITY' ? 'mp4' : null,
        codecs: descriptor.codecs,
        width: media.width,
        height: media.height,
        size_bytes: hydrated.object.size,
        sha256: hydrated.object.sha256.toLowerCase(),
        bucket: hydrated.object.bucket,
        object_key: hydrated.object.object_key,
        required_capabilities: descriptor.required,
      })
      .onConflictDoNothing();
  }
  return result;
}

export async function nativeCapabilityManifestsForScreens(screenIds: string[], db: DB = getDatabase()) {
  if (!screenIds.length) return new Map<string, CapabilityManifestV1>();
  const rows = await db
    .select()
    .from(schema.deviceInstallations)
    .where(and(inArray(schema.deviceInstallations.screen_id, screenIds as any), eq(schema.deviceInstallations.status, 'ACTIVE')))
    .orderBy(schema.deviceInstallations.last_seen_at);
  const result = new Map<string, CapabilityManifestV1>();
  for (const row of rows) {
    const parsed = capabilityManifestV1Schema.safeParse(row.capability_manifest);
    if (parsed.success) result.set(row.screen_id, parsed.data);
  }
  return result;
}

export function isNativeRenditionCompatible(
  manifest: CapabilityManifestV1,
  media: Pick<ReadyMedia, 'type'>,
  rendition: typeof schema.mediaRenditions.$inferSelect
) {
  if (rendition.state !== 'READY' || !isSha256(rendition.sha256) || !rendition.bucket || !rendition.object_key) return false;
  if (rendition.role === 'IMAGE_DISPLAY' || rendition.role === 'IMAGE_JPEG_FALLBACK') {
    return manifest.media.image_mime_types.map(normalized).includes(normalized(rendition.mime_type));
  }
  if (rendition.role === 'VIDEO_COMPATIBILITY') {
    return rendition.codecs.some((codec) => manifest.media.video_codecs.map(normalized).includes(normalized(codec))) &&
      (!rendition.container || manifest.media.video_containers.map(normalized).includes(normalized(rendition.container)));
  }
  if (rendition.role === 'DOCUMENT_PAGE_MANIFEST') return manifest.media.document_page_images;
  if (rendition.role === 'WEBPAGE_INTERACTIVE') return manifest.webpage.interactive;
  if (rendition.role === 'WEBPAGE_CAPTURE') {
    return manifest.webpage.server_capture_fallback &&
      manifest.media.image_mime_types.map(normalized).includes(normalized(rendition.mime_type));
  }
  return media.type !== 'WEBPAGE';
}

export async function getNativeCompatibilityIssues(params: {
  screenIds: string[];
  mediaIds: string[];
  concurrentVideoCount: number;
  db?: DB;
}): Promise<NativeCompatibilityIssue[]> {
  const db = params.db ?? getDatabase();
  const manifests = await nativeCapabilityManifestsForScreens(params.screenIds, db);
  if (!manifests.size) return [];
  const media = await ensureNativeRenditionsForMedia(params.mediaIds, db);
  const revisions = Array.from(media.values()).map(sourceRevision);
  const renditions = params.mediaIds.length
    ? await db.select().from(schema.mediaRenditions).where(inArray(schema.mediaRenditions.media_id, params.mediaIds as any))
    : [];
  const issues: NativeCompatibilityIssue[] = [];
  for (const [screenId, manifest] of manifests) {
    if (params.concurrentVideoCount > manifest.media.max_concurrent_videos) {
      issues.push({ screen_id: screenId, media_id: '__layout__', media_name: 'Layout', reason: 'MULTI_VIDEO_LAYOUT_UNSUPPORTED', required_capability: `max_concurrent_videos>=${params.concurrentVideoCount}`, corrective_action: 'CHANGE_LAYOUT' });
    }
    for (const mediaId of params.mediaIds) {
      const record = media.get(mediaId);
      if (!record || !record.object || !isSha256(record.object.sha256)) {
        issues.push({ screen_id: screenId, media_id: mediaId, media_name: record?.name ?? mediaId, reason: 'MISSING_VERIFIED_RENDITION', required_capability: 'checksummed immutable rendition', corrective_action: 'GENERATE_RENDITION' });
        continue;
      }
      const candidates = renditions.filter((rendition) => rendition.media_id === mediaId && revisions.includes(rendition.source_revision));
      if (!candidates.some((rendition) => isNativeRenditionCompatible(manifest, record, rendition))) {
        const required = normalized(record.type) === 'WEBPAGE' ? 'webpage interactive or server capture' : `compatible ${normalized(record.type).toLowerCase()} rendition`;
        issues.push({ screen_id: screenId, media_id: mediaId, media_name: record.name, reason: 'UNSUPPORTED_MEDIA_CAPABILITY', required_capability: required, corrective_action: 'GENERATE_RENDITION' });
      }
    }
  }
  return issues.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
