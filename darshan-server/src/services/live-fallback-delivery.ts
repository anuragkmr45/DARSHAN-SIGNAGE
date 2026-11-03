import { and, eq, gt, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { getPresignedUrl } from '@/s3';
import { isLiveSnapshotCandidate, readFrozenLiveAudienceItem, readFrozenLiveSnapshotItem, type FrozenLiveAudienceItem } from '@/screens/live-snapshot-audience';
import { liveSchedulingFingerprint } from './live-scheduling';
import { validateLiveFallbackManifest, type FrozenFallbackManifest, type NormalizedFallbackAsset } from './live-fallback-manifest';

type Occurrence = typeof schema.liveScheduleOccurrences.$inferSelect;
export type PublishedLiveFallback = { occurrence: Occurrence; assets: NormalizedFallbackAsset[]; storageConsistent: boolean };
export type LiveFallbackDownload = { asset_id: string; cache_key: string; sha256: string; size: number; content_type: string; url: string; expires_at: string };
type DeliveryOptions = {
  publishId: string; scheduleId?: string; includeUrls: boolean; db?: DbExecutor; now?: Date;
  screenId?: string; groupId?: string; targetGroupIds?: string[];
};
export type LiveFallbackDeliveryDependencies = {
  load?: (publishId: string, itemId: string, now: Date) => Promise<PublishedLiveFallback | null>;
  sign?: typeof getPresignedUrl;
};

// This cache holds only transport URLs, never audience/admission decisions.
// Eviction changes performance, not the number of approved fallback assets.
const URL_CACHE_BYTES = 8 * 1024 * 1024;
const signedUrls = new Map<string, { url: string; expiresAt: number; bytes: number }>();
const pendingUrls = new Map<string, Promise<{ url: string; expiresAt: number }>>();
let signedUrlBytes = 0;
async function cachedDownloadUrl(asset: NormalizedFallbackAsset): Promise<{ url: string; expiresAt: number }> {
  const key = JSON.stringify([asset.storage_object_id, asset.bucket, asset.object_key, asset.sha256, asset.size, asset.content_type]);
  const cached = signedUrls.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    signedUrls.delete(key); signedUrls.set(key, cached); return cached;
  }
  if (cached) { signedUrls.delete(key); signedUrlBytes -= cached.bytes; }
  const pending = pendingUrls.get(key); if (pending) return pending;
  const operation = (async () => {
    const signedAt = Date.now();
    const url = await getPresignedUrl(asset.bucket, asset.object_key, {
      expiresIn: 3600, responseContentType: asset.content_type, responseContentDisposition: 'inline', audience: 'device',
    });
    const result = { url, expiresAt: signedAt + 3600_000 };
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(url) + 128;
    if (bytes <= URL_CACHE_BYTES) {
      while (signedUrlBytes + bytes > URL_CACHE_BYTES && signedUrls.size) {
        const oldest = signedUrls.entries().next().value!; signedUrls.delete(oldest[0]); signedUrlBytes -= oldest[1].bytes;
      }
      signedUrls.set(key, { ...result, bytes }); signedUrlBytes += bytes;
    }
    return result;
  })().finally(() => { if (pendingUrls.get(key) === operation) pendingUrls.delete(key); });
  pendingUrls.set(key, operation); return operation;
}

async function loadPublishedFallback(db: DbExecutor, publishId: string, itemId: string, now: Date): Promise<PublishedLiveFallback | null> {
  const [row] = await db.select({ occurrence: schema.liveScheduleOccurrences }).from(schema.liveScheduleOccurrences)
    .innerJoin(schema.publishes, eq(schema.liveScheduleOccurrences.publish_id, schema.publishes.id))
    .where(and(eq(schema.liveScheduleOccurrences.publish_id, publishId), eq(schema.liveScheduleOccurrences.schedule_item_id, itemId),
      eq(schema.liveScheduleOccurrences.state, 'PUBLISHED'), gt(schema.liveScheduleOccurrences.end_at, now),
      eq(schema.publishes.status, 'ACTIVE'), isNull(schema.publishes.taken_down_at)));
  if (!row) return null;
  const rows = await db.select().from(schema.liveOccurrenceAssets)
    .innerJoin(schema.storageObjects, eq(schema.liveOccurrenceAssets.storage_object_id, schema.storageObjects.id))
    .where(eq(schema.liveOccurrenceAssets.occurrence_id, row.occurrence.id));
  let storageConsistent = true;
  const assets = rows.map(({ live_occurrence_assets: asset, storage_objects: object }): NormalizedFallbackAsset => {
    if (asset.sha256 !== object.sha256 || asset.size !== object.size || asset.content_type !== object.content_type) storageConsistent = false;
    return { id: asset.asset_id, media_id: asset.media_id, storage_object_id: asset.storage_object_id,
      bucket: object.bucket, object_key: object.object_key, sha256: asset.sha256, size: asset.size, content_type: asset.content_type,
      render_type: asset.render_type, source_type: asset.source_type, status: asset.status, representation: asset.representation,
      dependencies: asset.dependencies, source_object_id: asset.source_object_id, source_sha256: asset.source_sha256,
      source_content_type: asset.source_content_type };
  });
  return { occurrence: row.occurrence, assets, storageConsistent };
}

function controlPolicy(policy: FrozenLiveAudienceItem['live_policy']) {
  return { ...policy, fallback: { ...policy.fallback, manifest: undefined } };
}

/** Only dynamic response data changes this suffix; the approved policy stays
 * immutable. The digest contains no recoverable transport credential. */
export function liveFallbackDeliveryRevision(base: string, items: unknown[]): string {
  return createHash('sha256').update(base).update(JSON.stringify(items.filter(isLiveSnapshotCandidate).map(item => {
    const value = item as Record<string, unknown>;
    return { id: value['id'], download_status: value['live_fallback_download_status'] ?? null,
      policy_status: value['live_fallback_policy_status'] ?? null, downloads: value['live_fallback_downloads'] ?? null };
  }))).digest('hex');
}

/** Response-only hydration. No presigned URL enters an immutable snapshot or
 * approved policy, and no mutable Media row is consulted for frozen artifacts. */
export async function hydrateLiveFallbackItems<T>(items: T[], options: DeliveryOptions, dependencies: LiveFallbackDeliveryDependencies = {}): Promise<T[]> {
  const result: T[] = [], now = options.now ?? new Date();
  for (const item of items) {
    if (!isLiveSnapshotCandidate(item)) { result.push(item); continue; }
    const live = readFrozenLiveAudienceItem(item, { scheduleId: options.scheduleId });
    if (!live) continue;
    if (options.screenId) { if (!live.resolved_screen_ids.includes(options.screenId.toLowerCase())) continue; }
    else if (!options.groupId || !live.live_policy.screen_group_ids.includes(options.groupId.toLowerCase())) continue;
    const prepared = await (dependencies.load ?? ((publishId, itemId, at) => loadPublishedFallback(options.db ?? getDatabase(), publishId, itemId, at)))(options.publishId, live.id, now);
    if (!prepared) continue;
    const occurrence = prepared.occurrence;
    const authoritative = readFrozenLiveAudienceItem({ ...live, live_policy: occurrence.frozen_policy,
      resolved_screen_ids: occurrence.screen_ids }, { scheduleId: options.scheduleId });
    if (!authoritative || occurrence.publish_id !== options.publishId || occurrence.schedule_item_id !== live.id ||
        occurrence.state !== 'PUBLISHED' || occurrence.end_at <= now || occurrence.schedule_id !== authoritative.live_policy.schedule_id ||
        occurrence.live_session_id !== authoritative.live_policy.live_session_id || occurrence.presenter_user_id !== authoritative.live_policy.presenter_user_id ||
        occurrence.preparation_id !== authoritative.live_policy.fallback.preparation_id || occurrence.schedule_revision !== authoritative.live_policy.schedule_revision ||
        occurrence.policy_revision !== authoritative.live_policy.policy_revision ||
        occurrence.start_at.getTime() !== Date.parse(live.start_at) || occurrence.end_at.getTime() !== Date.parse(live.end_at) ||
        liveSchedulingFingerprint(controlPolicy(live.live_policy)) !== liveSchedulingFingerprint(controlPolicy(authoritative.live_policy))) continue;
    const stored = { ...(item as Record<string, unknown>) };
    delete stored['live_fallback_downloads']; delete stored['live_fallback_download_status']; delete stored['live_fallback_policy_status'];
    const unavailable = (invalidPolicy = false) => ({ ...stored, live_fallback_downloads: [], live_fallback_download_status: 'UNAVAILABLE',
      ...(invalidPolicy ? { live_fallback_policy_status: 'INVALID' } : {}) }) as T;
    const full = readFrozenLiveSnapshotItem(stored, { scheduleId: options.scheduleId });
    if (!full || !prepared.storageConsistent || liveSchedulingFingerprint(full.live_policy) !== liveSchedulingFingerprint(occurrence.frozen_policy)) {
      result.push(unavailable(true)); continue;
    }
    let manifest: FrozenFallbackManifest;
    try {
      manifest = validateLiveFallbackManifest(full.live_policy.fallback.manifest, { presentationId: full.presentation_id, assets: prepared.assets });
    } catch { result.push(unavailable(true)); continue; }
    try {
      if (!options.includeUrls) { result.push(stored as T); continue; }
      const downloads: LiveFallbackDownload[] = [];
      const normalizedById = new Map(prepared.assets.map(asset => [asset.id, asset]));
      for (const asset of manifest.assets) {
        const normalized = normalizedById.get(asset.id)!;
        const signed = dependencies.sign ? { url: await dependencies.sign(asset.bucket, asset.object_key, {
          expiresIn: 3600, responseContentType: asset.content_type, responseContentDisposition: 'inline', audience: 'device',
        }), expiresAt: Date.now() + 3600_000 } : await cachedDownloadUrl(normalized);
        downloads.push({ asset_id: asset.id, cache_key: asset.cache_key, sha256: asset.sha256, size: asset.size,
          content_type: asset.content_type, url: signed.url, expires_at: new Date(signed.expiresAt).toISOString() });
      }
      result.push({ ...stored, live_fallback_downloads: downloads, live_fallback_download_status: 'AVAILABLE' } as T);
    } catch { result.push(unavailable()); }
  }
  return result;
}
