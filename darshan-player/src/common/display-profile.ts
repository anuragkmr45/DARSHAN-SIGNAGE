export type DisplayDensity = 'FULL' | 'COMPACT' | 'MINIMAL'
export type DisplayPlacement = 'VERIFIED' | 'UNVERIFIED' | 'HEADLESS'
export type DisplaySelectionMode = 'PRIMARY' | 'PINNED'

export interface DisplayAspect {
  exact_key: string
  numeric_value: number
  match_key: string
  relative_error: number
  normalizer_version: 1
}

export interface DisplayOutput {
  key: string
  electron_id: string
  identity_confidence: 'PLATFORM' | 'SIGNATURE' | 'SESSION'
  label: string | null
  detected: boolean
  internal: boolean
  primary: boolean
  bounds_dip: { x: number; y: number; width: number; height: number }
  work_area_dip: { x: number; y: number; width: number; height: number }
  scale_factor: number
  estimated_backing_px: { width: number; height: number }
  native_mode_px: { width: number; height: number } | null
  rotation_degrees: number
  refresh_rate_hz: number | null
  orientation: 'LANDSCAPE' | 'PORTRAIT' | 'SQUARE'
  aspect: DisplayAspect
}

export interface DisplayProfileV1 {
  schema_version: 1
  runtime_session_id: string
  observation_seq: number
  observed_at: string
  selection: {
    mode: DisplaySelectionMode
    preferred_key: string | null
    active_key: string | null
    fallback_used: boolean
    fallback_reason: 'TARGET_MISSING' | 'AMBIGUOUS_IDENTITY' | 'WAYLAND_UNVERIFIED' | null
  }
  placement: DisplayPlacement
  output: DisplayOutput | null
  inventory: DisplayOutput[]
  viewport: {
    width_css_px: number
    height_css_px: number
    device_pixel_ratio: number
    density: DisplayDensity
    conformant: boolean
    omitted_regions: string[]
  } | null
}

export interface DisplayDesiredSelection {
  mode: DisplaySelectionMode
  preferred_key: string | null
  selection_version?: number
}

export function greatestCommonDivisor(first: number, second: number): number {
  let left = Math.abs(Math.round(first))
  let right = Math.abs(Math.round(second))
  while (right) {
    ;[left, right] = [right, left % right]
  }
  return left || 1
}

export function normalizedAspect(width: number, height: number): DisplayAspect {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  const divisor = greatestCommonDivisor(safeWidth, safeHeight)
  const exactKey = `${safeWidth / divisor}:${safeHeight / divisor}`
  return {
    exact_key: exactKey,
    numeric_value: safeWidth / safeHeight,
    match_key: exactKey,
    relative_error: 0,
    normalizer_version: 1,
  }
}

export function outputOrientation(width: number, height: number): DisplayOutput['orientation'] {
  if (width === height) return 'SQUARE'
  return width > height ? 'LANDSCAPE' : 'PORTRAIT'
}
