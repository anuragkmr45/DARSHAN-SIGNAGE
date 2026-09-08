import { describe, expect, it } from 'vitest';
import {
  capabilityFingerprint,
  capabilityManifestV1Schema,
  canonicalizeNativePlayerContract,
  deviceSnapshotV2Schema,
  mediaRenditionV1Schema,
} from './native-player';

const mobileCapability = {
  schema_version: 1 as const,
  platform: 'ANDROID' as const,
  os_version: '16',
  app_version: '1.0.0',
  build_number: '100',
  runtime_profile: 'CLOUD_HANDHELD' as const,
  display: { width: 1920, height: 1080, density: 2, orientation: 'LANDSCAPE' as const },
  media: {
    image_mime_types: ['image/jpeg', 'image/webp'],
    video_codecs: ['avc1'],
    video_containers: ['mp4'],
    max_concurrent_videos: 1,
    document_page_images: true,
  },
  webpage: { interactive: true, server_capture_fallback: true },
  storage: { cache_limit_bytes: 1_000_000_000, range_downloads: true, atomic_rename: true },
  security: { key_algorithm: 'ES256' as const, hardware_backed_key: true, attestation: 'ANDROID_KEY' as const },
  kiosk: { requested_state: 'STANDARD' as const, enforced_state: 'STANDARD' as const, provider: 'NONE' },
  screenshots: { supported: true },
  push: { supported: true },
  interaction_protocol_version: 0 as const,
};

describe('native player contract', () => {
  it('produces a deterministic fingerprint independently of object insertion order', () => {
    const first = capabilityManifestV1Schema.parse(mobileCapability);
    const second = capabilityManifestV1Schema.parse(JSON.parse(JSON.stringify(mobileCapability)));
    expect(capabilityFingerprint(first)).toBe(capabilityFingerprint(second));
    expect(canonicalizeNativePlayerContract({ b: 1, a: [true, null] })).toBe('{"a":[true,null],"b":1}');
  });

  it('rejects impossible managed and tvOS webpage capability claims', () => {
    expect(() =>
      capabilityManifestV1Schema.parse({
        ...mobileCapability,
        platform: 'TVOS',
        runtime_profile: 'CLOUD_TV_STANDARD',
        webpage: { interactive: true, server_capture_fallback: true },
      })
    ).toThrow(/tvOS/);

    expect(() =>
      capabilityManifestV1Schema.parse({
        ...mobileCapability,
        runtime_profile: 'ONPREM_ANDROID_MANAGED',
        kiosk: { ...mobileCapability.kiosk, provider: 'NONE' },
      })
    ).toThrow(/kiosk provider/);
  });

  it('requires a document rendition to be anchored to a contiguous immutable page manifest', () => {
    const page = { index: 1, bucket: 'media-ready', object_key: 'document/page-0001.jpg', mime_type: 'image/jpeg', size_bytes: 12, sha256: 'a'.repeat(64) };
    expect(mediaRenditionV1Schema.parse({
      id: '11111111-1111-4111-8111-111111111111', media_id: '22222222-2222-4222-8222-222222222222', source_revision: 'source',
      role: 'DOCUMENT_PAGE_MANIFEST', mime_type: 'image/jpeg', container: null, codecs: [], width: null, height: null, frame_rate: null, bitrate: null,
      size_bytes: page.size_bytes, sha256: page.sha256, bucket: page.bucket, object_key: page.object_key, required_capabilities: {},
      page_manifest: { schema_version: 1, page_duration_ms: 10_000, pages: [page] }, capture_expires_at: null,
    })).toMatchObject({ role: 'DOCUMENT_PAGE_MANIFEST' });
    expect(() => mediaRenditionV1Schema.parse({
      id: '11111111-1111-4111-8111-111111111111', media_id: '22222222-2222-4222-8222-222222222222', source_revision: 'source',
      role: 'DOCUMENT_PAGE_MANIFEST', mime_type: 'image/jpeg', container: null, codecs: [], width: null, height: null, frame_rate: null, bitrate: null,
      size_bytes: page.size_bytes, sha256: page.sha256, bucket: page.bucket, object_key: 'other/page.jpg', required_capabilities: {},
      page_manifest: { schema_version: 1, page_duration_ms: 10_000, pages: [page] }, capture_expires_at: null,
    })).toThrow(/anchored/);
  });

  it('requires all visible snapshot content to be included and mandatory', () => {
    const asset = {
      asset_id: '22222222-2222-4222-8222-222222222222', required: true,
      rendition_candidates: [{
        id: '33333333-3333-4333-8333-333333333333', media_id: '22222222-2222-4222-8222-222222222222', source_revision: '1',
        role: 'IMAGE_DISPLAY', mime_type: 'image/jpeg', container: null, codecs: [], width: null, height: null, frame_rate: null, bitrate: null,
        size_bytes: 1, sha256: 'a'.repeat(64), bucket: 'ready', object_key: 'asset.jpg', required_capabilities: {}, page_manifest: null, capture_expires_at: null,
      }],
    };
    const snapshot = {
      schema_version: 2, snapshot_id: '11111111-1111-4111-8111-111111111111', generation: 1, desired_state_version: '1', server_time: '2026-09-08T00:00:00.000Z', minimum_player_protocol: '1.0',
      emergency: null, default_content: null,
      scenes: [{ scene_id: '44444444-4444-4444-8444-444444444444', schedule_id: '55555555-5555-4555-8555-555555555555', presentation_id: null, starts_at: '2026-09-08T00:00:00.000Z', ends_at: '2026-09-08T01:00:00.000Z', priority: 0, layout_aspect_ratio: null, slots: [{ slot_id: 'slot', bounds: { x: 0, y: 0, w: 1, h: 1, z_index: 0 }, items: [{ asset_id: asset.asset_id, order: 0, duration_ms: 1_000, fit_mode: 'COVER', audio_enabled: false, loop_enabled: false }] }] }],
      assets: [asset],
    };
    expect(deviceSnapshotV2Schema.parse(snapshot)).toMatchObject({ schema_version: 2 });
    expect(() => deviceSnapshotV2Schema.parse({ ...snapshot, assets: [{ ...asset, required: false }] })).toThrow(/marked required/);
    expect(() => deviceSnapshotV2Schema.parse({ ...snapshot, assets: [] })).toThrow(/included asset/);
    expect(() => deviceSnapshotV2Schema.parse({
      ...snapshot,
      assets: [{ ...asset, rendition_candidates: [{ ...asset.rendition_candidates[0]!, media_id: '66666666-6666-4666-8666-666666666666' }] }],
    })).toThrow(/must match its snapshot asset/);
    expect(() => deviceSnapshotV2Schema.parse({
      ...snapshot,
      scenes: [{ ...snapshot.scenes[0]!, ends_at: snapshot.scenes[0]!.starts_at }],
    })).toThrow(/end must be after scene start/);
  });
});
