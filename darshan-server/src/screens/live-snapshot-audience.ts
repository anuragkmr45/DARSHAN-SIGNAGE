import { z } from 'zod';
import { liveFallbackManifestSchema, validateLiveFallbackManifest } from '@/services/live-fallback-manifest';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const audience = z.array(uuid).min(1).max(25).refine(ids => new Set(ids).size === ids.length);
const instant = z.string().datetime({ offset: true });
export const frozenLivePolicySchema = z.object({
  version: z.literal(1), source_kind: z.literal('LIVE'),
  schedule_id: uuid, schedule_item_id: uuid, schedule_revision: z.number().int().positive(),
  live_session_id: uuid, presenter_user_id: uuid, policy_revision: z.number().int().positive(),
  microphone: z.boolean(), screen_share_audio: z.boolean(),
  start_at: instant, end_at: instant, priority: z.number().int(), screen_ids: audience,
  screen_group_ids: z.array(uuid).refine(ids => new Set(ids).size === ids.length),
  fallback: z.object({ preparation_id: uuid, source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    manifest: liveFallbackManifestSchema }).strict(),
}).strict();

export const frozenLiveSnapshotItemSchema = z.object({
  id: uuid, presentation_id: uuid, source_kind: z.literal('LIVE'), live_session_id: uuid,
  start_at: instant, end_at: instant, priority: z.number().int(),
  screen_ids: z.array(uuid), screen_group_ids: z.array(uuid), resolved_screen_ids: audience,
  live_policy: frozenLivePolicySchema, presentation: z.null(),
}).strict();
export type FrozenLiveSnapshotItem = z.infer<typeof frozenLiveSnapshotItemSchema>;
const audiencePolicySchema = frozenLivePolicySchema.extend({
  fallback: z.object({ preparation_id: uuid, source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/), manifest: z.unknown() }).strict(),
});
const audienceItemSchema = frozenLiveSnapshotItemSchema.extend({
  live_policy: audiencePolicySchema,
  live_fallback_downloads: z.array(z.object({ asset_id: uuid, cache_key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive(), content_type: z.string(), url: z.string().url().refine(value => /^https?:\/\//.test(value)),
    expires_at: instant.optional() }).strict()).optional(),
  live_fallback_download_status: z.enum(['AVAILABLE', 'UNAVAILABLE']).optional(),
  live_fallback_policy_status: z.literal('INVALID').optional(),
});
export type FrozenLiveAudienceItem = z.infer<typeof audienceItemSchema>;
export type FrozenAudienceContext = { scheduleId?: string; groupIds?: string[] };

export function isLiveSnapshotCandidate(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const value = item as Record<string, unknown>;
  return value['source_kind'] === 'LIVE' || value['live_policy'] !== undefined || value['live_session_id'] != null;
}

/** A frozen audience is its own authority. Authoring targets and current group
 * membership never repair an absent or inconsistent LIVE policy. */
export function readFrozenLiveAudienceItem(item: unknown, context: FrozenAudienceContext = {}): FrozenLiveAudienceItem | null {
  const result = audienceItemSchema.safeParse(item);
  if (!result.success) return null;
  const value = result.data, policy = value.live_policy;
  if (value.id !== policy.schedule_item_id || value.live_session_id !== policy.live_session_id ||
      value.priority !== policy.priority ||
      Date.parse(value.start_at) !== Date.parse(policy.start_at) || Date.parse(value.end_at) !== Date.parse(policy.end_at) ||
      !(Date.parse(value.start_at) < Date.parse(value.end_at)) ||
      JSON.stringify(value.resolved_screen_ids) !== JSON.stringify(policy.screen_ids) ||
      JSON.stringify(value.screen_group_ids) !== JSON.stringify(policy.screen_group_ids) ||
      (context.scheduleId && policy.schedule_id !== context.scheduleId.toLowerCase())) return null;
  return value;
}

export function readFrozenLiveSnapshotItem(item: unknown, context: FrozenAudienceContext = {}): FrozenLiveSnapshotItem | null {
  if (!readFrozenLiveAudienceItem(item, context)) return null;
  const result = frozenLiveSnapshotItemSchema.safeParse(item);
  if (!result.success) return null;
  const value = result.data, policy = value.live_policy;
  if (value.presentation_id !== policy.fallback.manifest.presentation.id) return null;
  try {
    validateLiveFallbackManifest(policy.fallback.manifest, { presentationId: value.presentation_id,
      assets: policy.fallback.manifest.assets.map(asset => ({ ...asset, status: 'READY',
        source_type: asset.representation === 'WEBPAGE_PREVIEW' ? 'WEBPAGE' : asset.render_type === 'image' ? 'IMAGE'
          : asset.render_type === 'pdf' ? 'DOCUMENT' : 'VIDEO' })) });
    return value;
  } catch { return null; }
}

export function filterFrozenAudienceItemsForScreen<T>(items: T[], screenId: string, groupIds: string[], context: FrozenAudienceContext = {}): T[] {
  return items.filter(item => {
    if (isLiveSnapshotCandidate(item)) return readFrozenLiveAudienceItem(item, context)?.resolved_screen_ids.includes(screenId.toLowerCase()) ?? false;
    const legacy = item as { screen_ids?: unknown; screen_group_ids?: unknown } | null;
    const screens = Array.isArray(legacy?.screen_ids) ? legacy.screen_ids : [];
    const groups = Array.isArray(legacy?.screen_group_ids) ? legacy.screen_group_ids : [];
    if (!screens.length && !groups.length) return true;
    return screens.includes(screenId) || groups.some(group => groupIds.includes(group));
  });
}

export function filterFrozenAudienceItemsForGroup<T>(items: T[], groupId: string, memberIds: string[], context: FrozenAudienceContext = {}): T[] {
  return items.filter(item => {
    if (isLiveSnapshotCandidate(item)) {
      const live = readFrozenLiveAudienceItem(item, context);
      return Boolean(live && live.live_policy.screen_group_ids.includes(groupId.toLowerCase()));
    }
    const legacy = item as { screen_ids?: unknown; screen_group_ids?: unknown } | null;
    const screens = Array.isArray(legacy?.screen_ids) ? legacy.screen_ids : [];
    const groups = Array.isArray(legacy?.screen_group_ids) ? legacy.screen_group_ids : [];
    if (!screens.length && !groups.length) return true;
    return groups.includes(groupId) || screens.some(screen => memberIds.includes(screen));
  });
}
