import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Additive v1 contracts for native mobile and TV players.  Electron's device
 * protocol remains independently compatible; native clients advertise this
 * contract through the existing pairing and HELLO surfaces.
 */
/** Latest native player contract. Keep prior minors readable during rollout. */
export const NATIVE_PLAYER_CONTRACT_VERSION = '1.1' as const;
export const NATIVE_PLAYER_SUPPORTED_CONTRACT_VERSIONS = ['1.0', '1.1'] as const;
export const nativePlayerContractVersionSchema = z.enum(NATIVE_PLAYER_SUPPORTED_CONTRACT_VERSIONS);

export const runtimeProfileSchema = z.enum([
  'CLOUD_HANDHELD',
  'CLOUD_TV_STANDARD',
  'CLOUD_TV_MANAGED',
  'ONPREM_ANDROID_STANDARD',
  'ONPREM_ANDROID_MANAGED',
]);

export const kioskEnforcementStateSchema = z.enum([
  'STANDARD',
  'MANAGED_REQUESTED',
  'PROVISIONING_REQUIRED',
  'MANAGED_ENFORCED',
  'MANAGED_DEGRADED',
  'RECOVERY',
]);

export const connectivityStateSchema = z.enum([
  'OFFLINE',
  'PROBING',
  'TLS_BLOCKED',
  'CAPTIVE_OR_WRONG_ENDPOINT',
  'DEGRADED',
  'HEALTHY',
]);

export const credentialTrustLevelSchema = z.enum([
  'UNVERIFIED',
  'SOFTWARE_KEY',
  'HARDWARE_KEY',
  'PLAY_INTEGRITY_VERIFIED',
  'APP_ATTEST_VERIFIED',
  'REVOKED',
]);

export const mediaRenditionRoleSchema = z.enum([
  'ORIGINAL',
  'IMAGE_DISPLAY',
  'IMAGE_JPEG_FALLBACK',
  'VIDEO_COMPATIBILITY',
  'VIDEO_POSTER',
  'DOCUMENT_PAGE_MANIFEST',
  'WEBPAGE_INTERACTIVE',
  'WEBPAGE_CAPTURE',
]);

const boundedStringArray = (maximum: number) => z.array(z.string().trim().min(1).max(128)).max(maximum);

export const documentPageV1Schema = z.object({
  index: z.number().int().positive().max(500),
  bucket: z.string().trim().min(1).max(255),
  object_key: z.string().trim().min(1).max(1024),
  mime_type: z.string().trim().min(1).max(255),
  size_bytes: z.number().int().positive().max(2 ** 53 - 1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  // Device snapshots add a short-lived URL. Persisted manifests never do.
  download_url: z.string().url().optional(),
}).strict();

export const documentPageManifestV1Schema = z.object({
  schema_version: z.literal(1),
  page_duration_ms: z.number().int().min(1_000).max(120_000),
  pages: z.array(documentPageV1Schema).min(1).max(500),
}).strict().superRefine((manifest, context) => {
  const expected = manifest.pages.map((_, index) => index + 1);
  if (manifest.pages.some((page, index) => page.index !== expected[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages'], message: 'Document pages must be contiguous and ordered from one' });
  }
});

export const capabilityManifestV1Schema = z
  .object({
    schema_version: z.literal(1),
    platform: z.enum(['ANDROID', 'IOS', 'ANDROID_TV', 'TVOS']),
    os_version: z.string().trim().min(1).max(64),
    app_version: z.string().trim().min(1).max(64),
    build_number: z.string().trim().min(1).max(64),
    release_id: z.string().trim().min(1).max(128).optional(),
    runtime_profile: runtimeProfileSchema,
    display: z.object({
      width: z.number().int().positive().max(32_768),
      height: z.number().int().positive().max(32_768),
      density: z.number().positive().max(16),
      orientation: z.enum(['PORTRAIT', 'LANDSCAPE', 'UNKNOWN']),
    }),
    media: z.object({
      image_mime_types: boundedStringArray(32),
      video_codecs: boundedStringArray(32),
      video_containers: boundedStringArray(16),
      max_concurrent_videos: z.number().int().min(0).max(8),
      document_page_images: z.boolean(),
    }),
    webpage: z.object({
      interactive: z.boolean(),
      server_capture_fallback: z.boolean(),
    }),
    storage: z.object({
      cache_limit_bytes: z.number().int().positive().max(2 ** 53 - 1),
      range_downloads: z.boolean(),
      atomic_rename: z.boolean(),
    }),
    security: z.object({
      key_algorithm: z.enum(['ES256', 'RSA_V1']),
      hardware_backed_key: z.boolean(),
      attestation: z.enum(['NONE', 'ANDROID_KEY', 'PLAY_INTEGRITY', 'APP_ATTEST']),
    }),
    kiosk: z.object({
      requested_state: kioskEnforcementStateSchema,
      enforced_state: kioskEnforcementStateSchema,
      provider: z.enum(['NONE', 'ANDROID_DPC', 'APPLE_MDM']).nullable(),
    }),
    screenshots: z.object({ supported: z.boolean() }),
    push: z.object({ supported: z.boolean() }),
    interaction_protocol_version: z.literal(0),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.platform === 'TVOS' && manifest.webpage.interactive) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['webpage', 'interactive'],
        message: 'tvOS does not support interactive webpage playback',
      });
    }
    if (
      manifest.runtime_profile.startsWith('ONPREM_ANDROID') &&
      !['ANDROID', 'ANDROID_TV'].includes(manifest.platform)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['runtime_profile'],
        message: 'On-prem native profiles are Android-only',
      });
    }
    if (manifest.runtime_profile.endsWith('_MANAGED') && manifest.kiosk.provider === 'NONE') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kiosk', 'provider'],
        message: 'Managed runtime profiles require a kiosk provider',
      });
    }
  });

export const mediaRenditionV1Schema = z
  .object({
    id: z.string().uuid(),
    media_id: z.string().uuid(),
    source_revision: z.string().trim().min(1).max(128),
    role: mediaRenditionRoleSchema,
    mime_type: z.string().trim().min(1).max(255),
    container: z.string().trim().min(1).max(64).nullable(),
    codecs: boundedStringArray(8),
    width: z.number().int().positive().max(32_768).nullable(),
    height: z.number().int().positive().max(32_768).nullable(),
    frame_rate: z.number().positive().max(240).nullable(),
    bitrate: z.number().int().positive().max(2 ** 31 - 1).nullable(),
    size_bytes: z.number().int().nonnegative().max(2 ** 53 - 1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    // Short-lived, device-audience URL. It is never a durable cache identity.
    download_url: z.string().url().optional(),
    bucket: z.string().trim().min(1).max(255),
    object_key: z.string().trim().min(1).max(1024),
    required_capabilities: z.record(z.unknown()).default({}),
    page_manifest: z.record(z.unknown()).nullable().default(null),
    capture_expires_at: z.string().datetime().nullable().default(null),
  })
  .strict()
  .superRefine((rendition, context) => {
    if (rendition.role === 'DOCUMENT_PAGE_MANIFEST') {
      const manifest = documentPageManifestV1Schema.safeParse(rendition.page_manifest);
      if (!manifest.success) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['page_manifest'], message: 'Document rendition requires a valid page manifest' });
        return;
      }
      const first = manifest.data.pages[0];
      if (first.bucket !== rendition.bucket || first.object_key !== rendition.object_key || first.sha256 !== rendition.sha256 || first.size_bytes !== rendition.size_bytes) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['page_manifest'], message: 'Document rendition must be anchored to its first immutable page' });
      }
    }
  });

export const commandResultV2Schema = z
  .object({
    status: z.enum(['SUCCESS', 'FAILURE', 'RETRY_SCHEDULED']),
    reason_code: z.string().trim().min(1).max(120),
    retryable: z.boolean(),
    observed_desired_state_version: z.string().trim().max(128).nullable(),
    applied_desired_state_version: z.string().trim().max(128).nullable(),
    diagnostics: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  })
  .strict();

const deviceSnapshotV2ObjectSchema = z
  .object({
    schema_version: z.literal(2),
    snapshot_id: z.string().uuid(),
    generation: z.number().int().nonnegative(),
    desired_state_version: z.string().trim().min(1).max(128),
    server_time: z.string().datetime(),
    minimum_player_protocol: z.string().trim().min(1).max(32),
    // Overrides are part of the same immutable desired generation as the
    // schedule. They are not imperative websocket commands: a reconnecting
    // player can therefore recover the correct emergency → schedule → default
    // precedence from one signed REST response.
    emergency: z.object({
      id: z.string().uuid(),
      version: z.string().trim().min(1).max(255),
      asset_id: z.string().uuid().nullable(),
      message: z.string().trim().min(1).max(2_000).nullable(),
      expires_at: z.string().datetime().nullable(),
    }).strict().nullable(),
    default_content: z.object({
      asset_id: z.string().uuid(),
      version: z.string().trim().min(1).max(255),
    }).strict().nullable(),
    scenes: z.array(
      z.object({
        scene_id: z.string().uuid(),
        schedule_id: z.string().uuid(),
        presentation_id: z.string().uuid().nullable(),
        starts_at: z.string().datetime(),
        ends_at: z.string().datetime(),
        priority: z.number().int(),
        // A scene always has explicit regions. A no-layout presentation is
        // represented by one full-screen region; a layout presentation keeps
        // every slot and its independent playlist. This prevents clients from
        // accidentally serialising concurrent layout media as one playlist.
        layout_aspect_ratio: z.string().trim().min(3).max(32).nullable(),
        slots: z.array(z.object({
          slot_id: z.string().trim().min(1).max(255),
          bounds: z.object({
            x: z.number().min(0).lt(1),
            y: z.number().min(0).lt(1),
            w: z.number().positive().max(1),
            h: z.number().positive().max(1),
            z_index: z.number().int().min(-10_000).max(10_000),
          }).strict(),
          items: z.array(z.object({
            asset_id: z.string().uuid(),
            order: z.number().int().nonnegative(),
            duration_ms: z.number().int().positive().max(86_400_000),
            fit_mode: z.enum(['COVER', 'CONTAIN', 'STRETCH']),
            audio_enabled: z.boolean(),
            loop_enabled: z.boolean(),
          }).strict()).min(1).max(1_000),
        }).strict()).min(1).max(100),
      }).strict()
    ).max(10_000),
    assets: z
      .array(
        z
          .object({
            asset_id: z.string().uuid(),
            required: z.boolean(),
            rendition_candidates: z.array(mediaRenditionV1Schema).min(1),
          })
          .strict()
      )
      .max(10_000),
  });

/** Reusable scene parser for server-side snapshot construction. */
export const deviceSnapshotV2SceneSchema = deviceSnapshotV2ObjectSchema.shape.scenes.element;

export const deviceSnapshotV2Schema = deviceSnapshotV2ObjectSchema
  .strict()
  .superRefine((snapshot, context) => {
    // A snapshot is an all-or-nothing visual contract. Referencing an asset
    // that is absent or optional would let a client activate a layout with a
    // silently blank slot after a restart or an offline reconciliation.
    const assets = new Map<string, { required: boolean }>();
    snapshot.assets.forEach((asset, index) => {
      if (assets.has(asset.asset_id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['assets', index, 'asset_id'], message: 'Asset IDs must be unique in a native snapshot' });
        return;
      }
      assets.set(asset.asset_id, { required: asset.required });
      asset.rendition_candidates.forEach((rendition, renditionIndex) => {
        if (rendition.media_id !== asset.asset_id) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['assets', index, 'rendition_candidates', renditionIndex, 'media_id'], message: 'Rendition media ID must match its snapshot asset' });
        }
      });
    });
    const requireVisibleAsset = (assetId: string, path: (string | number)[]) => {
      const asset = assets.get(assetId);
      if (!asset) {
        context.addIssue({ code: z.ZodIssueCode.custom, path, message: 'Visible snapshot content must reference an included asset' });
      } else if (!asset.required) {
        context.addIssue({ code: z.ZodIssueCode.custom, path, message: 'Visible snapshot content must be marked required' });
      }
    };
    if (snapshot.emergency?.asset_id) requireVisibleAsset(snapshot.emergency.asset_id, ['emergency', 'asset_id']);
    if (snapshot.default_content) requireVisibleAsset(snapshot.default_content.asset_id, ['default_content', 'asset_id']);
    snapshot.scenes.forEach((scene, sceneIndex) => {
      if (Date.parse(scene.starts_at) >= Date.parse(scene.ends_at)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['scenes', sceneIndex], message: 'Scene end must be after scene start' });
      }
      scene.slots.forEach((slot, slotIndex) => {
        slot.items.forEach((item, itemIndex) => requireVisibleAsset(item.asset_id, ['scenes', sceneIndex, 'slots', slotIndex, 'items', itemIndex, 'asset_id']));
      });
    });
  });

export type RuntimeProfile = z.infer<typeof runtimeProfileSchema>;
export type CapabilityManifestV1 = z.infer<typeof capabilityManifestV1Schema>;
export type DocumentPageManifestV1 = z.infer<typeof documentPageManifestV1Schema>;
export type MediaRenditionV1 = z.infer<typeof mediaRenditionV1Schema>;
export type DeviceSnapshotV2 = z.infer<typeof deviceSnapshotV2Schema>;
export type CommandResultV2 = z.infer<typeof commandResultV2Schema>;

/** Stable JSON encoding used for server/client capability fingerprints. */
export function canonicalizeNativePlayerContract(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeNativePlayerContract(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeNativePlayerContract(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Native player contract contains a non-serializable value');
}

export function capabilityFingerprint(manifest: CapabilityManifestV1): string {
  const normalized = capabilityManifestV1Schema.parse(manifest);
  return createHash('sha256').update(canonicalizeNativePlayerContract(normalized)).digest('hex');
}
