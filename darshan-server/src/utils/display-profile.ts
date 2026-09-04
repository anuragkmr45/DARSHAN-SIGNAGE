import { createHash } from 'crypto';
import { z } from 'zod';

/**
 * Display Profile V1 is deliberately device-observed data.  It is never
 * accepted from a browser/operator and each observation is ordered by the
 * player runtime session plus its monotonic sequence number.
 */
const positiveInteger = z.number().int().positive().max(100_000);

export const displayAspectSchema = z.object({
  exact_key: z.string().min(1).max(32),
  numeric_value: z.number().positive(),
  match_key: z.string().min(1).max(32),
  relative_error: z.number().nonnegative().max(1),
  normalizer_version: z.literal(1),
});

export const displayOutputSchema = z.object({
  key: z.string().min(1).max(255),
  electron_id: z.string().min(1).max(255),
  identity_confidence: z.enum(['PLATFORM', 'SIGNATURE', 'SESSION']),
  label: z.string().max(255).nullable().optional(),
  detected: z.boolean(),
  internal: z.boolean(),
  primary: z.boolean(),
  bounds_dip: z.object({ x: z.number().int(), y: z.number().int(), width: positiveInteger, height: positiveInteger }),
  work_area_dip: z.object({ x: z.number().int(), y: z.number().int(), width: positiveInteger, height: positiveInteger }),
  scale_factor: z.number().positive().max(16),
  estimated_backing_px: z.object({ width: positiveInteger, height: positiveInteger }),
  native_mode_px: z.object({ width: positiveInteger, height: positiveInteger }).nullable().optional(),
  rotation_degrees: z.number().int().min(0).max(359),
  refresh_rate_hz: z.number().positive().max(1_000).nullable().optional(),
  orientation: z.enum(['LANDSCAPE', 'PORTRAIT', 'SQUARE']),
  aspect: displayAspectSchema,
});

export const displayProfileV1Schema = z.object({
  schema_version: z.literal(1),
  runtime_session_id: z.string().uuid(),
  observation_seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  observed_at: z.string().datetime(),
  selection: z.object({
    mode: z.enum(['PRIMARY', 'PINNED']),
    preferred_key: z.string().min(1).max(255).nullable().optional(),
    active_key: z.string().min(1).max(255).nullable().optional(),
    fallback_used: z.boolean(),
    fallback_reason: z.enum(['TARGET_MISSING', 'AMBIGUOUS_IDENTITY', 'WAYLAND_UNVERIFIED']).nullable().optional(),
  }),
  placement: z.enum(['VERIFIED', 'UNVERIFIED', 'HEADLESS']),
  output: displayOutputSchema.nullable(),
  inventory: z.array(displayOutputSchema).max(32),
  viewport: z
    .object({
      width_css_px: positiveInteger,
      height_css_px: positiveInteger,
      device_pixel_ratio: z.number().positive().max(16),
      density: z.enum(['FULL', 'COMPACT', 'MINIMAL']),
      conformant: z.boolean(),
      omitted_regions: z.array(z.string().min(1).max(64)).max(16),
    })
    .nullable(),
});

export type DisplayProfileV1 = z.infer<typeof displayProfileV1Schema>;

export const displaySelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('PRIMARY') }),
  z.object({
    mode: z.literal('PINNED'),
    display_key: z.string().min(1).max(255),
    expected_profile_revision: z.number().int().nonnegative(),
  }),
]);

export type DisplaySelection = z.infer<typeof displaySelectionSchema>;

export function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(Math.round(a));
  let right = Math.abs(Math.round(b));
  while (right) {
    [left, right] = [right, left % right];
  }
  return left || 1;
}

export function normalizeAspectRatio(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

/** Symmetric compatibility: 1 is exact, 0.995 is within a 0.5% tolerance. */
export function aspectCompatibility(left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return 0;
  return Math.min(left / right, right / left);
}

export function areAspectsCompatible(left: number, right: number, minimum = 0.995): boolean {
  return aspectCompatibility(left, right) >= minimum;
}

export function parseAspectRatio(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashDisplayProfile(profile: DisplayProfileV1): string {
  // Sequence, observation time and runtime session order an observation; they
  // do not describe a display configuration. Excluding them prevents every
  // heartbeat from manufacturing a new profile revision.
  const stable = Object.fromEntries(
    Object.entries(profile).filter(([key]) => !['runtime_session_id', 'observation_seq', 'observed_at'].includes(key))
  );
  return createHash('sha256').update(stableJson(stable)).digest('hex');
}

export function displayProfileLegacyDimensions(profile: DisplayProfileV1): {
  width: number | null;
  height: number | null;
  aspect_ratio: string | null;
  orientation: string | null;
} {
  const output = profile.output;
  if (!output) return { width: null, height: null, aspect_ratio: null, orientation: null };
  const mode = output.bounds_dip;
  return {
    width: mode.width,
    height: mode.height,
    aspect_ratio: normalizeAspectRatio(mode.width, mode.height),
    orientation: output.orientation.toLowerCase(),
  };
}
