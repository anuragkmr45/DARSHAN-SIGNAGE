import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filterFrozenAudienceItemsForGroup, filterFrozenAudienceItemsForScreen,
  readFrozenLiveAudienceItem, readFrozenLiveSnapshotItem,
} from './live-snapshot-audience';
import { hydrateLiveFallbackItems, liveFallbackDeliveryRevision, type PublishedLiveFallback } from '@/services/live-fallback-delivery';
import { buildScheduleItemSummary, buildScreenPlaybackState } from './playback';

vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => { throw new Error('Fixture forbids DB access'); } }));
const sdk = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock('@/s3', () => ({ getPresignedUrl: (...args: unknown[]) => sdk.sign(...args), headObject: () => { throw new Error('Fixture forbids storage HEAD'); } }));
beforeEach(() => { sdk.sign.mockReset().mockResolvedValue('https://configured-gateway.test/cached?signature=synthetic'); });
const now = new Date('2030-01-01T12:00:00.000Z');
const checksum = 'a'.repeat(64);
function fixture() {
  const screen = randomUUID(), other = randomUUID(), group = randomUUID(), publish = randomUUID();
  const asset = { id: randomUUID(), media_id: randomUUID(), storage_object_id: randomUUID(), bucket: 'configured-ready',
    object_key: `live-fallbacks/v1/sha256/${checksum}.png`, sha256: checksum, size: 4, content_type: 'image/png', render_type: 'image' as const,
    representation: 'SOURCE', dependencies: [], cache_key: `live_${checksum}_image` };
  const manifest = { version: 1 as const, presentation: { id: randomUUID(), layout: null,
    items: [{ id: randomUUID(), order: 0, asset_id: asset.id }] }, assets: [asset] };
  const policy = { version: 1 as const, source_kind: 'LIVE' as const, schedule_id: randomUUID(), schedule_item_id: randomUUID(), schedule_revision: 1,
    live_session_id: randomUUID(), presenter_user_id: randomUUID(), policy_revision: 1,
    microphone: false, screen_share_audio: false, start_at: '2030-01-01T13:00:00.000Z', end_at: '2030-01-01T14:00:00.000Z', priority: 0,
    screen_ids: [screen], screen_group_ids: [group], fallback: { preparation_id: randomUUID(), source_fingerprint: checksum, manifest } };
  const item = { id: policy.schedule_item_id, presentation_id: manifest.presentation.id, source_kind: 'LIVE' as const,
    live_session_id: policy.live_session_id, start_at: policy.start_at, end_at: policy.end_at, priority: 0,
    screen_ids: [], screen_group_ids: [group], resolved_screen_ids: [screen], live_policy: policy, presentation: null };
  const prepared: PublishedLiveFallback = { occurrence: { id: randomUUID(), state: 'PUBLISHED', publish_id: publish,
    schedule_id: policy.schedule_id, schedule_item_id: item.id, schedule_revision: 1, live_session_id: policy.live_session_id,
    presenter_user_id: policy.presenter_user_id, policy_revision: 1, preparation_id: policy.fallback.preparation_id,
    frozen_policy: policy, screen_ids: [screen], start_at: new Date(policy.start_at), end_at: new Date(policy.end_at) } as PublishedLiveFallback['occurrence'],
  assets: [{ ...asset, status: 'READY', source_type: 'IMAGE' }], storageConsistent: true };
  const load = vi.fn(async () => prepared);
  const sign = vi.fn(async () => 'https://configured-gateway.test/media?signature=synthetic');
  return { screen, other, group, publish, asset, manifest, policy, item, prepared, load, sign,
    options: { publishId: publish, scheduleId: policy.schedule_id, screenId: screen, includeUrls: true, now } };
}

describe('frozen LIVE audience readers', () => {
  it('accepts exact stored policy and never re-resolves current group membership', () => {
    const f = fixture();
    expect(readFrozenLiveSnapshotItem(f.item)).not.toBeNull();
    expect(filterFrozenAudienceItemsForScreen([f.item], f.screen, [])).toEqual([f.item]);
    expect(filterFrozenAudienceItemsForScreen([f.item], f.other, [f.group])).toEqual([]);
    expect(filterFrozenAudienceItemsForGroup([f.item], f.group, [])).toEqual([f.item]);
    expect(filterFrozenAudienceItemsForGroup([f.item], randomUUID(), [f.screen])).toEqual([]);
  });

  it('rejects missing/duplicate/inconsistent control, identity, windows and audiences', () => {
    const f = fixture();
    const candidates = [
      { ...f.item, live_policy: undefined }, { ...f.item, resolved_screen_ids: [] },
      { ...f.item, resolved_screen_ids: [f.other] }, { ...f.item, resolved_screen_ids: [f.screen, f.screen] },
      { ...f.item, id: randomUUID() }, { ...f.item, live_session_id: randomUUID() },
      { ...f.item, start_at: f.item.end_at }, { ...f.item, priority: 9 }, { ...f.item, screen_group_ids: [] },
      { ...f.item, source_kind: undefined }, { ...f.item, live_policy: { ...f.policy, screen_group_ids: undefined } },
    ];
    for (const item of candidates) {
      expect(readFrozenLiveAudienceItem(item)).toBeNull();
      expect(filterFrozenAudienceItemsForScreen([item], f.screen, [f.group])).toEqual([]);
    }
    expect(readFrozenLiveSnapshotItem(f.item, { scheduleId: randomUUID() })).toBeNull();
  });

  it('retains authorized window control when fallback contents are malformed but denies full stored validation', () => {
    const f = fixture(), damaged = { ...f.item, live_policy: { ...f.policy, fallback: { ...f.policy.fallback, manifest: null } } };
    expect(readFrozenLiveAudienceItem(damaged)).not.toBeNull();
    expect(readFrozenLiveSnapshotItem(damaged)).toBeNull();
    expect(filterFrozenAudienceItemsForScreen([damaged], f.screen, [])).toHaveLength(1);
  });

  it('preserves all legacy presentation target semantics', () => {
    const f = fixture(), global = { id: 'global' }, direct = { id: 'direct', screen_ids: [f.screen] }, grouped = { id: 'group', screen_group_ids: [f.group] };
    expect(filterFrozenAudienceItemsForScreen([global, direct, grouped], f.screen, [f.group])).toHaveLength(3);
    expect(filterFrozenAudienceItemsForScreen([global, direct, grouped], f.other, [])).toEqual([global]);
    expect(filterFrozenAudienceItemsForGroup([global, direct, grouped], f.group, [f.screen])).toHaveLength(3);
  });

  it('allows only known response siblings on reader re-filtering while serializer stays strict', () => {
    const f = fixture(), response = { ...f.item, live_fallback_download_status: 'UNAVAILABLE', live_fallback_downloads: [] };
    expect(filterFrozenAudienceItemsForScreen([response], f.screen, [])).toHaveLength(1);
    expect(readFrozenLiveSnapshotItem(response)).toBeNull();
    expect(readFrozenLiveAudienceItem({ ...response, ticket: 'unexpected' })).toBeNull();
  });

  it('labels planned live source truthfully and does not invent a presentation name or playback confirmation', () => {
    const f = fixture(), summary = buildScheduleItemSummary(f.item);
    expect(summary).toMatchObject({ source_kind: 'LIVE', live_session_id: f.policy.live_session_id, presentation_name: 'Live broadcast' });
    expect(summary.media).toEqual([{ id: f.asset.media_id, name: null, type: 'IMAGE', thumbnail_url: null }]);
  });

  it('does not report ordinary default media as playing during an assigned live window without player evidence', async () => {
    const f = fixture();
    const state = await buildScreenPlaybackState({ id: f.screen, name: 'Fixture', status: 'ACTIVE', last_heartbeat_at: now,
      current_media_id: null, current_schedule_id: null, created_at: now, updated_at: now } as Parameters<typeof buildScreenPlaybackState>[0], {
      db: {} as never, now: new Date('2030-01-01T13:30:00.000Z'), groupIds: [], includeMedia: false,
      latestPublish: { publish_id: f.publish, schedule_id: f.policy.schedule_id, snapshot_id: randomUUID(), published_at: now,
        payload: { schedule: { id: f.policy.schedule_id, items: [f.item] } }, reservation_version: 1,
        selection_reason: 'active_reservation', reservation_start_at: now, reservation_end_at: new Date(f.item.end_at) },
      defaultMedia: { media_id: randomUUID(), media: null, source: 'GLOBAL', aspect_ratio: null } as never,
      activeEmergencies: [], recoveryState: { auth_diagnostics: { state: 'VALID' }, active_pairing: null } as never,
    });
    expect(state.playback).toMatchObject({ source: 'SCHEDULE', scheduled_source_kind: 'LIVE', current_media_id: null, live_playback_confirmed: null });
  });
});

describe('frozen fallback REST delivery', () => {
  it('verifies normalized occurrence/storage and signs configured recipient URLs on clones for future prefetch', async () => {
    const f = fixture(), original = structuredClone(f.item);
    const output = await hydrateLiveFallbackItems([f.item], f.options, f);
    expect(output[0]).toMatchObject({ source_kind: 'LIVE', live_fallback_downloads: [{ asset_id: f.asset.id,
      cache_key: f.asset.cache_key, sha256: checksum, size: 4, content_type: 'image/png', url: 'https://configured-gateway.test/media?signature=synthetic' }] });
    expect(f.sign).toHaveBeenCalledWith(f.asset.bucket, f.asset.object_key, expect.objectContaining({ audience: 'device', expiresIn: 3600 }));
    expect(f.item).toEqual(original);
    expect(filterFrozenAudienceItemsForScreen(output, f.screen, [])).toHaveLength(1);
  });

  it('rejects new members before occurrence lookup and never resolves mutable media', async () => {
    const f = fixture();
    expect(await hydrateLiveFallbackItems([f.item], { ...f.options, screenId: f.other }, f)).toEqual([]);
    expect(f.load).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled();
  });

  it('validates published authority even without URLs and avoids storage/signing I/O', async () => {
    const f = fixture();
    expect(await hydrateLiveFallbackItems([f.item], { ...f.options, includeUrls: false }, f)).toEqual([f.item]);
    expect(f.load).toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled();
  });

  it('rejects missing, replaced, released or inconsistent occurrence authority', async () => {
    for (const mismatch of ['missing', 'publish', 'window', 'audience', 'released']) {
      const f = fixture();
      if (mismatch === 'missing') f.load.mockResolvedValueOnce(null as never);
      if (mismatch === 'publish') f.prepared.occurrence.publish_id = randomUUID();
      if (mismatch === 'window') f.prepared.occurrence.end_at = now;
      if (mismatch === 'audience') f.prepared.occurrence.screen_ids = [f.other];
      if (mismatch === 'released') f.prepared.occurrence.state = 'RELEASED';
      expect(await hydrateLiveFallbackItems([f.item], f.options, f)).toEqual([]);
      expect(f.sign).not.toHaveBeenCalled();
    }
  });

  it('preserves the live blocking window for malformed fallback, missing assets or metadata corruption', async () => {
    for (const mismatch of ['manifest', 'assets', 'storage']) {
      const f = fixture();
      const input = structuredClone(f.item);
      if (mismatch === 'manifest') (input.live_policy.fallback as { manifest: unknown }).manifest = null;
      if (mismatch === 'assets') f.prepared.assets = [];
      if (mismatch === 'storage') f.prepared.storageConsistent = false;
      const output = await hydrateLiveFallbackItems([input], { ...f.options, includeUrls: false }, f);
      expect(output).toMatchObject([{ source_kind: 'LIVE', start_at: f.item.start_at, end_at: f.item.end_at,
        live_fallback_download_status: 'UNAVAILABLE', live_fallback_downloads: [] }]);
      expect(f.sign).not.toHaveBeenCalled();
    }
  });

  it('preserves authorized live window on signing outage without revoking approved local-cache policy', async () => {
    const f = fixture(); f.sign.mockRejectedValueOnce(new Error('unavailable'));
    const output = await hydrateLiveFallbackItems([f.item], f.options, f);
    expect(output).toMatchObject([{ source_kind: 'LIVE', live_fallback_download_status: 'UNAVAILABLE', live_fallback_downloads: [] }]);
    expect(output[0]).not.toHaveProperty('live_fallback_policy_status');
  });

  it('caches transport signatures only and revalidates every audience and descriptor request', async () => {
    const f = fixture();
    const dependencies = { load: f.load };
    await Promise.all([hydrateLiveFallbackItems([f.item], f.options, dependencies), hydrateLiveFallbackItems([f.item], f.options, dependencies)]);
    expect(sdk.sign).toHaveBeenCalledTimes(1); expect(f.load).toHaveBeenCalledTimes(2);
    f.prepared.storageConsistent = false;
    expect(await hydrateLiveFallbackItems([f.item], f.options, dependencies)).toMatchObject([{ live_fallback_policy_status: 'INVALID', live_fallback_download_status: 'UNAVAILABLE' }]);
    expect(sdk.sign).toHaveBeenCalledTimes(1); expect(f.load).toHaveBeenCalledTimes(3);
    expect(await hydrateLiveFallbackItems([f.item], { ...f.options, screenId: f.other }, dependencies)).toEqual([]);
  });

  it('changes response revision when authority, download status or URL expiry changes', async () => {
    const f = fixture(); const available = await hydrateLiveFallbackItems([f.item], f.options, f);
    const initial = liveFallbackDeliveryRevision('snapshot-revision', available);
    expect(liveFallbackDeliveryRevision('snapshot-revision', available)).toBe(initial);
    expect(liveFallbackDeliveryRevision('snapshot-revision', [])).not.toBe(initial);
    expect(liveFallbackDeliveryRevision('snapshot-revision', [{ ...f.item, live_fallback_download_status: 'UNAVAILABLE', live_fallback_downloads: [] }])).not.toBe(initial);
    const changed = structuredClone(available) as Array<Record<string, unknown>>;
    (changed[0]!['live_fallback_downloads'] as Array<Record<string, unknown>>)[0]!['expires_at'] = '2040-01-01T00:00:00.000Z';
    expect(liveFallbackDeliveryRevision('snapshot-revision', changed)).not.toBe(initial);
  });

  it('can rehydrate a response without retaining an obsolete failure flag or leaking URLs when disabled', async () => {
    const f = fixture();
    f.sign.mockRejectedValueOnce(new Error('temporary signer failure'));
    const unavailable = await hydrateLiveFallbackItems([f.item], f.options, f);
    const repaired = await hydrateLiveFallbackItems(unavailable, f.options, f);
    expect(repaired[0]).toHaveProperty('live_fallback_download_status', 'AVAILABLE');
    const hidden = await hydrateLiveFallbackItems(repaired, { ...f.options, includeUrls: false }, f);
    expect(hidden).toEqual([f.item]);
  });

  it('keeps ordinary presentation items unchanged', async () => {
    const f = fixture(), ordinary = { id: 'old', presentation: { id: 'legacy' } };
    expect(await hydrateLiveFallbackItems([ordinary], f.options, f)).toEqual([ordinary]);
    expect(f.load).not.toHaveBeenCalled();
  });
});
