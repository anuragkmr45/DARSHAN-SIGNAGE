import { z } from 'zod';

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase());
const renderType = z.enum(['image', 'video', 'pdf', 'hls']);
const safeInteger = z.number().int().safe();
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const forbiddenLayoutFields = new Set([
  'source_url', 'download_url', 'playback_url', 'presigned_url', 'signal_url',
  'ticket', 'token', 'access_token', 'refresh_token', 'renewal_token',
  'password', 'secret', 'authorization', 'cookie', 'credentials',
]);

/** Existing layout specs are JSON render data, not an authority/credential carrier. */
function isLayoutJson(value: unknown): value is JsonValue {
  const pending: Array<{ value: unknown; leaving?: boolean }> = [{ value }];
  const ancestors = new Set<object>();
  while (pending.length) {
    const node = pending.pop()!;
    const current = node.value;
    if (node.leaving) { ancestors.delete(current as object); continue; }
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'number') { if (!Number.isFinite(current)) return false; continue; }
    if (typeof current === 'string') {
      if (/^https?:\/\/.*[?&](?:x-amz-|x-goog-|signature=|sig=|token=|access_token=)/i.test(current)) return false;
      continue;
    }
    if (typeof current !== 'object' || ancestors.has(current)) return false;
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return false;
    ancestors.add(current);
    pending.push({ value: current, leaving: true });
    if (Array.isArray(current)) {
      for (const child of current) pending.push({ value: child });
    } else {
      for (const [key, child] of Object.entries(current)) {
        if (forbiddenLayoutFields.has(key.toLowerCase())) return false;
        pending.push({ value: child });
      }
    }
  }
  return true;
}

// Iterative cloning avoids a graph-depth ceiling while preventing a caller from
// mutating the validated layout through its original object reference.
function cloneJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value;
  const copy: JsonValue[] | Record<string, JsonValue> = Array.isArray(value) ? [] : Object.create(null);
  const pending = [{ source: value, target: copy }];
  while (pending.length) {
    const { source, target } = pending.pop()!;
    for (const [key, child] of Object.entries(source)) {
      if (child !== null && typeof child === 'object') {
        const next: JsonValue[] | Record<string, JsonValue> = Array.isArray(child) ? [] : Object.create(null);
        (target as Record<string, JsonValue>)[key] = next;
        pending.push({ source: child, target: next });
      } else {
        (target as Record<string, JsonValue>)[key] = child;
      }
    }
  }
  return copy;
}

const layoutJson = z.custom<JsonValue>(isLayoutJson, 'Layout must be finite JSON without credentials or signed URLs').transform(cloneJson);
const descriptorText = z.string().min(1).refine((value) => value.trim() === value && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127), 'Invalid storage descriptor');
const storageLocation = descriptorText.refine((value) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/[?&](?:x-amz-|x-goog-|signature=|token=)/i.test(value), 'Storage location must not be a URL');

const frozenFallbackAssetSchema = z.object({
  id: uuid,
  media_id: uuid,
  storage_object_id: uuid,
  bucket: storageLocation,
  object_key: storageLocation,
  sha256,
  size: safeInteger.positive(),
  content_type: z.string().min(1).transform((value) => value.toLowerCase()),
  render_type: renderType,
  representation: descriptorText.refine((value) => /^[a-z0-9_]+$/i.test(value), 'Invalid representation'),
  dependencies: z.array(uuid).optional(),
  cache_key: z.string(),
}).strict();

const frozenFallbackEntrySchema = z.object({
  id: uuid,
  slot_id: z.string().min(1).optional(),
  order: safeInteger.nonnegative(),
  asset_id: uuid,
  duration_seconds: safeInteger.positive().optional(),
  page_number: safeInteger.positive().optional(),
  fit_mode: z.enum(['contain', 'cover', 'stretch']).optional(),
  audio_enabled: z.boolean().optional(),
  loop_enabled: z.boolean().optional(),
}).strict();

export const liveFallbackManifestSchema = z.object({
  version: z.literal(1),
  presentation: z.object({
    id: uuid,
    layout: z.object({ id: uuid, aspect_ratio: z.string().min(1), spec: layoutJson }).strict().nullable().optional(),
    items: z.array(frozenFallbackEntrySchema).min(1),
  }).strict(),
  assets: z.array(frozenFallbackAssetSchema).min(1),
}).strict();

export type FrozenFallbackManifest = z.infer<typeof liveFallbackManifestSchema>;
export type FrozenFallbackAsset = z.infer<typeof frozenFallbackAssetSchema>;
export type FrozenFallbackEntry = z.infer<typeof frozenFallbackEntrySchema>;
export type NormalizedFallbackAsset = Omit<FrozenFallbackAsset, 'cache_key'> & {
  status: 'READY';
  source_type: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'WEBPAGE';
  source_object_id?: string | null;
  source_sha256?: string | null;
  source_content_type?: string | null;
};

export class LiveFallbackManifestError extends Error {
  readonly code = 'LIVE_FALLBACK_MANIFEST_INVALID';
  constructor(readonly reason: string) {
    super(`Invalid live fallback manifest: ${reason}`);
    this.name = 'LiveFallbackManifestError';
  }
}

export function canonicalLiveCacheKey(checksum: string, type: FrozenFallbackAsset['render_type']): string {
  const digest = sha256.safeParse(checksum);
  if (!digest.success || !renderType.safeParse(type).success) throw new LiveFallbackManifestError('INVALID_CACHE_IDENTITY');
  return `live_${digest.data}_${type}`;
}

function reject(reason: string): never { throw new LiveFallbackManifestError(reason); }
function normalizedDependencies(asset: { dependencies?: string[] }): string[] {
  if (asset.dependencies !== undefined && !Array.isArray(asset.dependencies)) reject('INVALID_DEPENDENCY');
  const dependencies = (asset.dependencies ?? []).map((id) => {
    if (!uuid.safeParse(id).success) reject('INVALID_DEPENDENCY');
    return id.toLowerCase();
  });
  if (new Set(dependencies).size !== dependencies.length) reject('DUPLICATE_DEPENDENCY');
  return [...dependencies].sort();
}

function checkMime(asset: FrozenFallbackAsset): void {
  const mime = asset.content_type;
  if (mime.includes(';') || mime.trim() !== mime) reject('INVALID_CONTENT_TYPE');
  const compatible = asset.render_type === 'image' ? /^image\/[a-z0-9.+-]+$/.test(mime)
    : asset.render_type === 'video' ? /^video\/[a-z0-9.+-]+$/.test(mime)
      : asset.render_type === 'pdf' ? mime === 'application/pdf'
        : ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'].includes(mime);
  if (!compatible) reject('RENDER_CONTENT_TYPE_MISMATCH');
}

/** Pure validation; callers independently fence current DB/source fingerprint before publication. */
export function validateLiveFallbackManifest(
  input: unknown,
  expected: { presentationId: string; assets: NormalizedFallbackAsset[] },
): FrozenFallbackManifest {
  const parsed = liveFallbackManifestSchema.safeParse(input);
  if (!parsed.success) reject('INVALID_SHAPE');
  const manifest = parsed.data;
  if (!expected || !uuid.safeParse(expected.presentationId).success || manifest.presentation.id !== expected.presentationId.toLowerCase()) reject('PRESENTATION_MISMATCH');
  if (!Array.isArray(expected.assets)) reject('INVALID_EXPECTED_ASSET');
  const assets = new Map<string, FrozenFallbackAsset>();
  for (const asset of manifest.assets) {
    if (assets.has(asset.id)) reject('DUPLICATE_ASSET');
    if (asset.cache_key !== canonicalLiveCacheKey(asset.sha256, asset.render_type)) reject('CACHE_KEY_MISMATCH');
    const prefix = `live-fallbacks/v1/sha256/${asset.sha256}.`;
    if (!asset.object_key.startsWith(prefix) || !/^[a-z0-9]+$/.test(asset.object_key.slice(prefix.length))) reject('CAS_LOCATION_MISMATCH');
    checkMime(asset);
    normalizedDependencies(asset);
    assets.set(asset.id, asset);
  }

  const expectedById = new Map<string, NormalizedFallbackAsset>();
  for (const source of expected.assets) {
    if (!source || source.status !== 'READY' || !uuid.safeParse(source.id).success || expectedById.has(source.id.toLowerCase())) reject('INVALID_EXPECTED_ASSET');
    expectedById.set(source.id.toLowerCase(), source);
  }
  if (assets.size !== expectedById.size) reject('EXPECTED_ASSET_SET_MISMATCH');
  for (const asset of assets.values()) {
    const source = expectedById.get(asset.id);
    if (!source) reject('EXPECTED_ASSET_SET_MISMATCH');
    for (const field of ['media_id', 'storage_object_id', 'bucket', 'object_key', 'sha256', 'size', 'content_type', 'render_type', 'representation'] as const) {
      const actual = asset[field];
      const wanted = source[field];
      if (actual !== (typeof wanted === 'string' && ['media_id', 'storage_object_id', 'sha256', 'content_type'].includes(field) ? wanted.toLowerCase() : wanted)) reject('EXPECTED_DESCRIPTOR_MISMATCH');
    }
    if (JSON.stringify(normalizedDependencies(asset)) !== JSON.stringify(normalizedDependencies(source))) reject('EXPECTED_DEPENDENCIES_MISMATCH');
    if (!['IMAGE', 'VIDEO', 'DOCUMENT'].includes(source.source_type)) reject('INVALID_SOURCE_TYPE');
    if ((source.source_type === 'IMAGE' && asset.render_type !== 'image') ||
        (source.source_type === 'DOCUMENT' && asset.render_type !== 'pdf') ||
        (source.source_type === 'VIDEO' && !['video', 'hls'].includes(asset.render_type))) reject('SOURCE_RENDER_TYPE_MISMATCH');
  }

  const roots = new Set<string>();
  const entryIds = new Set<string>();
  const spec = manifest.presentation.layout?.spec;
  const layoutSlots = Array.isArray(spec) ? spec : spec && typeof spec === 'object' ? spec['slots'] : undefined;
  const slotIds = new Set(Array.isArray(layoutSlots) ? layoutSlots.flatMap((slot) => {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return [];
    const id = slot['id'] ?? slot['slot_id'];
    return typeof id === 'string' && id ? [id] : [];
  }) : []);
  for (const entry of manifest.presentation.items) {
    if (entryIds.has(entry.id)) reject('DUPLICATE_ENTRY');
    entryIds.add(entry.id);
    const asset = assets.get(entry.asset_id);
    if (!asset) reject('MISSING_ENTRY_ASSET');
    if (entry.page_number !== undefined && asset.render_type !== 'pdf') reject('PAGE_REQUIRES_PDF');
    if (entry.slot_id && !manifest.presentation.layout) reject('SLOT_REQUIRES_LAYOUT');
    if (entry.slot_id && !slotIds.has(entry.slot_id)) reject('UNKNOWN_LAYOUT_SLOT');
    roots.add(entry.asset_id);
  }

  // Kahn's algorithm validates the complete dependency graph without recursion
  // or an artificial asset-count/depth limit, including dependency-only assets.
  const indegree = new Map([...assets.keys()].map((id) => [id, 0]));
  for (const asset of assets.values()) {
    if (asset.render_type === 'hls' && !asset.dependencies?.length) reject('HLS_DEPENDENCIES_REQUIRED');
    for (const dependency of asset.dependencies ?? []) {
      if (!assets.has(dependency)) reject('MISSING_DEPENDENCY');
      indegree.set(dependency, indegree.get(dependency)! + 1);
    }
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  for (let index = 0; index < queue.length; index++) {
    for (const dependency of assets.get(queue[index]!)!.dependencies ?? []) {
      const next = indegree.get(dependency)! - 1;
      indegree.set(dependency, next);
      if (next === 0) queue.push(dependency);
    }
  }
  if (queue.length !== assets.size) reject('CYCLIC_DEPENDENCIES');
  const reachable = new Set(roots);
  const pending = [...roots];
  for (let index = 0; index < pending.length; index++) {
    for (const dependency of assets.get(pending[index]!)!.dependencies ?? []) {
      if (!reachable.has(dependency)) { reachable.add(dependency); pending.push(dependency); }
    }
  }
  if (reachable.size !== assets.size) reject('UNUSED_ASSET');
  return manifest;
}
