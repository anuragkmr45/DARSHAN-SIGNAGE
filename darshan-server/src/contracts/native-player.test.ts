import { describe, expect, it } from 'vitest';
import {
  capabilityFingerprint,
  capabilityManifestV1Schema,
  canonicalizeNativePlayerContract,
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
});
