import { createHash } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import {
  capabilityManifestV1Schema,
  deviceSnapshotV2Schema,
  deviceSnapshotV2SceneSchema,
  documentPageManifestV1Schema,
  mediaRenditionV1Schema,
  type DeviceSnapshotV2,
  type MediaRenditionV1,
} from '@/contracts/native-player';
import { isNativeRenditionCompatible } from '@/services/native-media-renditions';
import { getPresignedUrl, initializeS3 } from '@/s3';

type DB = ReturnType<typeof getDatabase>;
type NativeEmergencyOverride = Readonly<{ id: string; version: string; assetId: string | null; message: string | null; expiresAt: string | null }>;
type NativeDefaultOverride = Readonly<{ assetId: string; version: string }>;

/**
 * Builds the additive native representation of a desired playback snapshot.
 * The existing Electron snapshot intentionally remains untouched.  A native
 * client receives no candidate until it is immutable, checksummed, READY and
 * compatible with the active enrolled installation's reported capabilities.
 */
export async function buildNativeDeviceSnapshot(params: {
  screenId: string;
  snapshotId: string | null;
  desiredStateVersion: number;
  scheduleId: string | null;
  mediaIds: string[];
  scheduleItems: unknown[];
  emergency: NativeEmergencyOverride | null;
  defaultContent: NativeDefaultOverride | null;
  serverTime: string;
  db?: DB;
}): Promise<DeviceSnapshotV2 | null> {
  if (!params.snapshotId && !params.emergency && !params.defaultContent) return null;
  const db = params.db ?? getDatabase();
  const [installation] = await db
    .select()
    .from(schema.deviceInstallations)
    .where(and(eq(schema.deviceInstallations.screen_id, params.screenId), eq(schema.deviceInstallations.status, 'ACTIVE')))
    .orderBy(desc(schema.deviceInstallations.last_seen_at), desc(schema.deviceInstallations.updated_at))
    .limit(1);
  const manifest = capabilityManifestV1Schema.safeParse(installation?.capability_manifest);
  if (!manifest.success) return null;

  const scenes = params.scheduleId ? buildNativeScenes(params.scheduleItems, params.scheduleId) : [];
  if (scenes === null) return null;
  const snapshotId = nativeRepresentationId(params);
  const mediaIds = Array.from(new Set(params.mediaIds.filter(Boolean))).sort();
  if (!mediaIds.length) {
    return deviceSnapshotV2Schema.parse({
      schema_version: 2,
      snapshot_id: snapshotId,
      generation: Math.max(0, params.desiredStateVersion),
      desired_state_version: String(Math.max(0, params.desiredStateVersion)),
      server_time: params.serverTime,
      minimum_player_protocol: '1.0',
      emergency: params.emergency ? {
        id: params.emergency.id, version: params.emergency.version, asset_id: params.emergency.assetId,
        message: params.emergency.message, expires_at: params.emergency.expiresAt,
      } : null,
      default_content: params.defaultContent ? { asset_id: params.defaultContent.assetId, version: params.defaultContent.version } : null,
      scenes,
      assets: [],
    });
  }

  const [mediaRows, renditionRows] = await Promise.all([
    db.select().from(schema.media).where(inArray(schema.media.id, mediaIds as any)),
    db.select().from(schema.mediaRenditions).where(inArray(schema.mediaRenditions.media_id, mediaIds as any)),
  ]);
  const mediaById = new Map(mediaRows.map((media) => [media.id, media]));
  const candidatesByMedia = new Map<string, MediaRenditionV1[]>();
  // Snapshot construction can occur in API-only test/runtime paths. Creating
  // the configured client is side-effect free; bucket ownership remains
  // bootstrap/runtime responsibility.
  initializeS3();
  for (const rendition of renditionRows) {
    const media = mediaById.get(rendition.media_id);
    if (!media || !isNativeRenditionCompatible(manifest.data, { type: media.type }, rendition)) continue;
    if (!rendition.sha256 || !rendition.bucket || !rendition.object_key || rendition.size_bytes === null) continue;
    const persistedManifest = rendition.role === 'DOCUMENT_PAGE_MANIFEST'
      ? documentPageManifestV1Schema.safeParse(rendition.page_manifest)
      : null;
    if (persistedManifest && !persistedManifest.success) continue;
    const pageManifest = persistedManifest
      ? {
          ...persistedManifest.data,
          pages: await Promise.all(persistedManifest.data.pages.map(async (page) => ({
            ...page,
            download_url: await getPresignedUrl(page.bucket, page.object_key, {
              audience: 'device',
              expiresIn: 5 * 60,
              responseContentType: page.mime_type,
            }),
          }))),
        }
      : rendition.page_manifest;
    const parsedCandidate = mediaRenditionV1Schema.safeParse({
      id: rendition.id,
      media_id: rendition.media_id,
      source_revision: rendition.source_revision,
      role: rendition.role,
      mime_type: rendition.mime_type,
      container: rendition.container,
      codecs: rendition.codecs ?? [],
      width: rendition.width,
      height: rendition.height,
      frame_rate: rendition.frame_rate_milli === null ? null : rendition.frame_rate_milli / 1000,
      bitrate: rendition.bitrate,
      size_bytes: rendition.size_bytes,
      sha256: rendition.sha256,
      download_url: await getPresignedUrl(rendition.bucket, rendition.object_key, {
        audience: 'device',
        expiresIn: 5 * 60,
        responseContentType: rendition.mime_type,
      }),
      bucket: rendition.bucket,
      object_key: rendition.object_key,
      required_capabilities: (rendition.required_capabilities ?? {}) as Record<string, unknown>,
      page_manifest: pageManifest,
      capture_expires_at: rendition.capture_expires_at?.toISOString() ?? null,
    });
    // Database rows can outlive contract rollouts.  An unknown or malformed
    // candidate is deliberately ignored, never coerced into a playable asset.
    if (!parsedCandidate.success) continue;
    const candidate: MediaRenditionV1 = parsedCandidate.data;
    const candidates = candidatesByMedia.get(rendition.media_id) ?? [];
    candidates.push(candidate);
    candidatesByMedia.set(rendition.media_id, candidates);
  }

  // Publish-time validation prevents this in normal operation.  Keeping this
  // guard here protects clients that enroll after legacy content was already
  // published: they retain LKG instead of receiving an incomplete generation.
  if (mediaIds.some((mediaId) => !(candidatesByMedia.get(mediaId)?.length))) return null;

  return deviceSnapshotV2Schema.parse({
    schema_version: 2,
    snapshot_id: snapshotId,
    generation: Math.max(0, params.desiredStateVersion),
    desired_state_version: String(Math.max(0, params.desiredStateVersion)),
    server_time: params.serverTime,
    minimum_player_protocol: '1.0',
    emergency: params.emergency ? {
      id: params.emergency.id, version: params.emergency.version, asset_id: params.emergency.assetId,
      message: params.emergency.message, expires_at: params.emergency.expiresAt,
    } : null,
    default_content: params.defaultContent ? { asset_id: params.defaultContent.assetId, version: params.defaultContent.version } : null,
    scenes,
    assets: mediaIds.map((mediaId) => ({
      asset_id: mediaId,
      required: true,
      rendition_candidates: (candidatesByMedia.get(mediaId) ?? []).sort((left, right) => left.id.localeCompare(right.id)),
    })),
  });
}

/** A native desired generation changes whenever an override changes, even when
 * the underlying published schedule is unchanged. The UUID is deterministic,
 * so ordinary reconciliation does not cause needless redownloads. */
function nativeRepresentationId(params: {
  screenId: string; snapshotId: string | null; scheduleId: string | null; desiredStateVersion: number;
  emergency: NativeEmergencyOverride | null; defaultContent: NativeDefaultOverride | null;
}): string {
  if (params.snapshotId && !params.emergency && !params.defaultContent) return params.snapshotId;
  const bytes = createHash('sha256').update(JSON.stringify({
    screen: params.screenId, schedule: params.scheduleId, snapshot: params.snapshotId,
    state: params.desiredStateVersion, emergency: params.emergency, default: params.defaultContent,
  })).digest('hex');
  return `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-4${bytes.slice(13, 16)}-8${bytes.slice(17, 20)}-${bytes.slice(20, 32)}`;
}

function buildNativeScenes(scheduleItems: unknown[], scheduleId: string): DeviceSnapshotV2['scenes'] | null {
  const scenes: DeviceSnapshotV2['scenes'] = [];
  for (const raw of scheduleItems) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, any>;
    const presentation = item.presentation;
    const slotEntries = Array.isArray(presentation?.slots) ? presentation.slots : [];
    const slots = slotEntries.length > 0
      ? buildLayoutSlots(presentation, slotEntries)
      : [{
          slot_id: 'full-screen',
          bounds: { x: 0, y: 0, w: 1, h: 1, z_index: 0 },
          items: buildSlotPlaylist(Array.isArray(presentation?.items) ? presentation.items : []),
        }];
    // A layout without valid bounds is not equivalent to a sequential
    // playlist. Returning null makes the device retain LKG rather than render
    // legal but incorrect content in the wrong region.
    if (slots === null || slots.some((slot) => slot.items.length === 0)) return null;
    const candidate = {
      scene_id: item.id,
      schedule_id: scheduleId,
      presentation_id: typeof item.presentation_id === 'string' ? item.presentation_id : null,
      starts_at: item.start_at,
      ends_at: item.end_at,
      priority: Number.isInteger(item.priority) ? item.priority : 0,
      layout_aspect_ratio: slotEntries.length > 0 && typeof presentation?.layout?.aspect_ratio === 'string'
        ? presentation.layout.aspect_ratio
        : null,
      slots,
    };
    const parsed = deviceSnapshotV2SceneSchema.safeParse(candidate);
    // Never turn malformed legacy input into a blank native generation.
    if (!parsed.success) return null;
    scenes.push(parsed.data);
  }
  return scenes.sort((left, right) => left.starts_at.localeCompare(right.starts_at) || right.priority - left.priority || left.scene_id.localeCompare(right.scene_id));
}

function buildSlotPlaylist(entries: any[]) {
  return entries
    .filter((entry: any) => typeof entry?.media_id === 'string')
    .map((entry: any, index: number) => ({
      asset_id: entry.media_id,
      order: Number.isInteger(entry.order) && entry.order >= 0 ? entry.order : index,
      duration_ms: Math.max(1, Math.round(Number(entry.duration_seconds ?? 10) * 1_000)),
      fit_mode: normalizeFitMode(entry.fit_mode),
      audio_enabled: entry.audio_enabled === true,
      loop_enabled: entry.loop_enabled === true,
    }))
    .sort((left: any, right: any) => left.order - right.order || left.asset_id.localeCompare(right.asset_id));
}

function buildLayoutSlots(presentation: any, slotEntries: any[]): DeviceSnapshotV2['scenes'][number]['slots'] | null {
  const spec = presentation?.layout?.spec;
  const declared = Array.isArray(spec) ? spec : Array.isArray(spec?.slots) ? spec.slots : null;
  if (!declared?.length) return null;
  const entriesBySlot = new Map<string, any[]>();
  for (const entry of slotEntries) {
    if (typeof entry?.slot_id !== 'string' || !entry.slot_id.trim()) return null;
    const entries = entriesBySlot.get(entry.slot_id) ?? [];
    entries.push(entry);
    entriesBySlot.set(entry.slot_id, entries);
  }
  const result: DeviceSnapshotV2['scenes'][number]['slots'] = [];
  const seen = new Set<string>();
  for (const declaredSlot of declared) {
    const slot = declaredSlot as Record<string, unknown>;
    const slotId = typeof slot.id === 'string' ? slot.id : typeof slot.slot_id === 'string' ? slot.slot_id : null;
    if (!slotId || seen.has(slotId)) return null;
    seen.add(slotId);
    const entries = entriesBySlot.get(slotId);
    if (!entries?.length) continue;
    const x = finiteNumber(slot.x);
    const y = finiteNumber(slot.y);
    const w = finiteNumber(slot.w ?? slot.width);
    const h = finiteNumber(slot.h ?? slot.height);
    const zIndex = finiteNumber(slot.z ?? slot.z_index ?? 0);
    if (x === null || y === null || w === null || h === null || zIndex === null ||
      x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1 || !Number.isInteger(zIndex)) return null;
    result.push({
      slot_id: slotId,
      bounds: { x, y, w, h, z_index: zIndex },
      items: buildSlotPlaylist(entries),
    });
  }
  // A referenced but undeclared slot must not disappear from a native scene.
  if (result.length === 0 || [...entriesBySlot.keys()].some((slotId) => !seen.has(slotId))) return null;
  return result.sort((left, right) => left.bounds.z_index - right.bounds.z_index || left.slot_id.localeCompare(right.slot_id));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeFitMode(value: unknown): 'COVER' | 'CONTAIN' | 'STRETCH' {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === 'CONTAIN') return 'CONTAIN';
  if (normalized === 'STRETCH' || normalized === 'FILL') return 'STRETCH';
  return 'COVER';
}
