const { createHash } = require('crypto')
const LIVE_IDS = {
  device: '11111111-1111-4111-8111-111111111111', publish: '22222222-2222-4222-8222-222222222222',
  snapshot: '33333333-3333-4333-8333-333333333333', schedule: '44444444-4444-4444-8444-444444444444',
  item: '55555555-5555-4555-8555-555555555555', presentation: '66666666-6666-4666-8666-666666666666',
  asset: '77777777-7777-4777-8777-777777777777', media: '88888888-8888-4888-8888-888888888888',
  storage: '99999999-9999-4999-8999-999999999999', source: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  presenter: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', preparation: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  entry: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
}
function liveFixture(now = Date.now()) {
  const bytes = Buffer.from('approved fallback fixture')
  const sha = createHash('sha256').update(bytes).digest('hex')
  const asset = { id: LIVE_IDS.asset, media_id: LIVE_IDS.media, storage_object_id: LIVE_IDS.storage,
    bucket: 'media-ready', object_key: `live-fallbacks/v1/sha256/${sha}.png`, sha256: sha, size: bytes.length,
    content_type: 'image/png', render_type: 'image', representation: 'READY', cache_key: `live_${sha}_image` }
  const policy = { version: 1, source_kind: 'LIVE', schedule_id: LIVE_IDS.schedule, schedule_item_id: LIVE_IDS.item,
    schedule_revision: 1, live_session_id: LIVE_IDS.source, presenter_user_id: LIVE_IDS.presenter, policy_revision: 1,
    microphone: false, screen_share_audio: false, start_at: new Date(now - 1000).toISOString(),
    end_at: new Date(now + 60000).toISOString(), priority: 1, screen_ids: [LIVE_IDS.device], screen_group_ids: [],
    fallback: { preparation_id: LIVE_IDS.preparation, source_fingerprint: 'a'.repeat(64), manifest: { version: 1,
      presentation: { id: LIVE_IDS.presentation, layout: null, items: [{ id: LIVE_IDS.entry, order: 0, asset_id: asset.id, duration_seconds: 10 }] }, assets: [asset] } } }
  const item = { id: LIVE_IDS.item, presentation_id: LIVE_IDS.presentation, source_kind: 'LIVE', live_session_id: LIVE_IDS.source,
    start_at: policy.start_at, end_at: policy.end_at, priority: 1, screen_ids: [], screen_group_ids: [],
    resolved_screen_ids: [LIVE_IDS.device], live_policy: policy, presentation: null,
    live_fallback_download_status: 'AVAILABLE', live_fallback_downloads: [{ asset_id: asset.id, cache_key: asset.cache_key,
      sha256: asset.sha256, size: asset.size, content_type: asset.content_type, url: 'https://files.example.test/fallback?X-Amz-Signature=temporary-secret' }] }
  const raw = { device_id: LIVE_IDS.device, server_time: new Date(now).toISOString(), content_state: 'scheduled',
    publish: { publish_id: LIVE_IDS.publish, snapshot_id: LIVE_IDS.snapshot }, snapshot: { id: LIVE_IDS.snapshot,
      publish_id: LIVE_IDS.publish, schedule: { id: LIVE_IDS.schedule, items: [item] } }, emergency: null,
    default_media: { id: 'ordinary-default', type: 'message', message: 'Ordinary default' } }
  return { raw, item, policy, asset, bytes }
}
module.exports = { LIVE_IDS, liveFixture }
