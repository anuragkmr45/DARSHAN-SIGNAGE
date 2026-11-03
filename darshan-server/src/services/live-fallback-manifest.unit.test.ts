import { describe, expect, it } from 'vitest';
import {
  canonicalLiveCacheKey,
  LiveFallbackManifestError,
  liveFallbackManifestSchema,
  validateLiveFallbackManifest,
  type FrozenFallbackAsset,
  type FrozenFallbackManifest,
  type NormalizedFallbackAsset,
} from './live-fallback-manifest';

const id = (index: number) => `10000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const checksum = 'a'.repeat(64);
const presentationId = id(1);
function asset(index = 2, changes: Partial<FrozenFallbackAsset> = {}): FrozenFallbackAsset {
  const value: FrozenFallbackAsset = {
    id: id(index), media_id: id(index + 10000), storage_object_id: id(index + 20000),
    bucket: 'media-ready', object_key: `live-fallbacks/v1/sha256/${checksum}.png`,
    sha256: checksum, size: 12, content_type: 'image/png', render_type: 'image',
    representation: 'SOURCE', cache_key: canonicalLiveCacheKey(checksum, 'image'), ...changes,
  };
  return value;
}
function manifest(assets = [asset()]): FrozenFallbackManifest {
  return {
    version: 1,
    presentation: { id: presentationId, items: [{ id: id(50001), order: 0, asset_id: assets[0]!.id }] },
    assets,
  };
}
function expected(assets: FrozenFallbackAsset[]): { presentationId: string; assets: NormalizedFallbackAsset[] } {
  return {
    presentationId,
    assets: assets.map(({ cache_key: _cacheKey, ...value }) => ({
      ...value, status: 'READY', source_type: value.render_type === 'image' ? 'IMAGE' : value.render_type === 'pdf' ? 'DOCUMENT' : 'VIDEO',
    })),
  };
}
function reason(run: () => unknown, wanted: string): void {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(LiveFallbackManifestError);
    expect((error as LiveFallbackManifestError).code).toBe('LIVE_FALLBACK_MANIFEST_INVALID');
    expect((error as LiveFallbackManifestError).reason).toBe(wanted);
  }
}

describe('frozen live fallback manifest', () => {
  it('preserves business media IDs while deriving a Windows-safe content cache identity', () => {
    expect(canonicalLiveCacheKey('A'.repeat(64), 'pdf')).toBe(`live_${checksum}_pdf`);
    expect(canonicalLiveCacheKey(checksum, 'image')).toMatch(/^[a-z0-9_]+$/);
    const input = manifest();
    const output = validateLiveFallbackManifest(input, expected(input.assets));
    expect(output.assets[0]!.media_id).toBe(input.assets[0]!.media_id);
    expect(output).not.toBe(input);
    reason(() => canonicalLiveCacheKey('../bad', 'image'), 'INVALID_CACHE_IDENTITY');
    reason(() => canonicalLiveCacheKey(checksum, 'url' as 'image'), 'INVALID_CACHE_IDENTITY');
  });

  it('rejects unknown authority/URL fields at every structured level', () => {
    const base = manifest();
    for (const extra of [
      { ...base, ticket: 'private' },
      { ...base, presentation: { ...base.presentation, source_url: 'https://example.test' } },
      { ...base, assets: [{ ...base.assets[0], download_url: 'https://example.test?X-Amz-Signature=private' }] },
      { ...base, presentation: { ...base.presentation, items: [{ ...base.presentation.items[0], renewal_token: 'private' }] } },
    ]) expect(liveFallbackManifestSchema.safeParse(extra).success).toBe(false);
  });

  it('requires the exact expected READY asset set and immutable storage descriptor', () => {
    const input = manifest();
    const approved = expected(input.assets);
    reason(() => validateLiveFallbackManifest(input, { ...approved, presentationId: id(9) }), 'PRESENTATION_MISMATCH');
    reason(() => validateLiveFallbackManifest(input, { ...approved, assets: [] }), 'EXPECTED_ASSET_SET_MISMATCH');
    reason(() => validateLiveFallbackManifest(input, { ...approved, assets: [{ ...approved.assets[0]!, status: 'FAILED' } as unknown as NormalizedFallbackAsset] }), 'INVALID_EXPECTED_ASSET');
    for (const field of ['media_id', 'storage_object_id', 'bucket', 'object_key', 'sha256', 'size', 'content_type', 'render_type', 'representation'] as const) {
      const source = { ...approved.assets[0]! };
      (source as Record<string, unknown>)[field] = field === 'size' ? 99 : 'changed';
      reason(() => validateLiveFallbackManifest(input, { ...approved, assets: [source] }), 'EXPECTED_DESCRIPTOR_MISMATCH');
    }
    reason(() => validateLiveFallbackManifest({ ...input, assets: [{ ...input.assets[0], cache_key: 'mutable-media-id' }] }, approved), 'CACHE_KEY_MISMATCH');
    const mutable = manifest([asset(2, { object_key: `${id(2)}/ready.png` })]);
    reason(() => validateLiveFallbackManifest(mutable, expected(mutable.assets)), 'CAS_LOCATION_MISMATCH');
    const wrongHash = manifest([asset(2, { object_key: `live-fallbacks/v1/sha256/${'b'.repeat(64)}.png` })]);
    reason(() => validateLiveFallbackManifest(wrongHash, expected(wrongHash.assets)), 'CAS_LOCATION_MISMATCH');
  });

  it('rejects duplicate identities and absent entry/dependency targets', () => {
    const first = asset();
    reason(() => validateLiveFallbackManifest(manifest([first, first]), expected([first])), 'DUPLICATE_ASSET');
    const duplicateEntry = manifest(); duplicateEntry.presentation.items.push({ ...duplicateEntry.presentation.items[0]! });
    reason(() => validateLiveFallbackManifest(duplicateEntry, expected(duplicateEntry.assets)), 'DUPLICATE_ENTRY');
    const missingEntry = manifest(); missingEntry.presentation.items[0]!.asset_id = id(99);
    reason(() => validateLiveFallbackManifest(missingEntry, expected(missingEntry.assets)), 'MISSING_ENTRY_ASSET');
    const missingDependency = manifest([asset(2, { dependencies: [id(99)] })]);
    reason(() => validateLiveFallbackManifest(missingDependency, expected(missingDependency.assets)), 'MISSING_DEPENDENCY');
    const repeatedDependency = manifest([asset(2, { dependencies: [id(99), id(99)] })]);
    reason(() => validateLiveFallbackManifest(repeatedDependency, expected(repeatedDependency.assets)), 'DUPLICATE_DEPENDENCY');
  });

  it('accepts dependency-only assets and rejects cycles, orphans and changed dependency lists', () => {
    const child = asset(3);
    const input = manifest([asset(2, { dependencies: [child.id] }), child]);
    expect(validateLiveFallbackManifest(input, expected(input.assets)).assets).toHaveLength(2);
    const cyclic = manifest([asset(2, { dependencies: [id(3)] }), asset(3, { dependencies: [id(2)] })]);
    reason(() => validateLiveFallbackManifest(cyclic, expected(cyclic.assets)), 'CYCLIC_DEPENDENCIES');
    const orphan = manifest([asset(2), child]);
    reason(() => validateLiveFallbackManifest(orphan, expected(orphan.assets)), 'UNUSED_ASSET');
    const approved = expected(input.assets); approved.assets[0]!.dependencies = [];
    reason(() => validateLiveFallbackManifest(input, approved), 'EXPECTED_DEPENDENCIES_MISMATCH');
  });

  it('validates a 5000-asset dependency chain without a recursive graph or new item-count cap', () => {
    const assets = Array.from({ length: 5000 }, (_, index) => asset(index + 2,
      index < 4999 ? { dependencies: [id(index + 3)] } : {}));
    expect(validateLiveFallbackManifest(manifest(assets), expected(assets)).assets).toHaveLength(5000);
  });

  it('uses the frozen processed PDF and selected page without admitting raw Office bytes', () => {
    const pdf = asset(2, { render_type: 'pdf', content_type: 'application/pdf', representation: 'READY', cache_key: canonicalLiveCacheKey(checksum, 'pdf') });
    const input = manifest([pdf]); input.presentation.items[0]!.page_number = 7;
    expect(validateLiveFallbackManifest(input, expected(input.assets)).presentation.items[0]!.page_number).toBe(7);
    const office = manifest([{ ...pdf, content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }]);
    reason(() => validateLiveFallbackManifest(office, expected(office.assets)), 'RENDER_CONTENT_TYPE_MISMATCH');
    const imagePage = manifest(); imagePage.presentation.items[0]!.page_number = 1;
    reason(() => validateLiveFallbackManifest(imagePage, expected(imagePage.assets)), 'PAGE_REQUIRES_PDF');
  });

  it('rejects retired webpage fallback media', () => {
    const input = manifest(); const wanted = expected(input.assets);
    wanted.assets[0]!.source_type = 'WEBPAGE';
    reason(() => validateLiveFallbackManifest(input, wanted), 'INVALID_SOURCE_TYPE');
  });

  it('represents HLS playlists and all frozen video-segment dependencies explicitly', () => {
    const playlist = asset(2, { render_type: 'hls', content_type: 'application/vnd.apple.mpegurl', representation: 'READY', dependencies: [id(3)], cache_key: canonicalLiveCacheKey(checksum, 'hls') });
    const segment = asset(3, { render_type: 'video', content_type: 'video/mp2t', representation: 'READY', cache_key: canonicalLiveCacheKey(checksum, 'video') });
    const input = manifest([playlist, segment]);
    expect(validateLiveFallbackManifest(input, expected(input.assets)).assets).toHaveLength(2);
    const absent = manifest([playlist]);
    reason(() => validateLiveFallbackManifest(absent, expected(absent.assets)), 'MISSING_DEPENDENCY');
  });

  it('checks layout slot references and clones arbitrary finite render JSON without leaking credentials', () => {
    const input = manifest();
    input.presentation.layout = { id: id(77), aspect_ratio: '16:9', spec: { slots: [{ id: 'left', x: 0, y: 0, w: 1, h: 1, custom: { label: 'Left' } }] } };
    input.presentation.items[0]!.slot_id = 'left';
    const output = validateLiveFallbackManifest(input, expected(input.assets));
    (input.presentation.layout.spec as { slots: { custom: { label: string } }[] }).slots[0]!.custom.label = 'Changed';
    expect(output.presentation.layout!.spec).toMatchObject({ slots: [{ custom: { label: 'Left' } }] });
    input.presentation.items[0]!.slot_id = 'absent';
    reason(() => validateLiveFallbackManifest(input, expected(input.assets)), 'UNKNOWN_LAYOUT_SLOT');
    for (const spec of [{ source_url: 'https://example.test' }, { extra: { ticket: 'secret' } },
      { image: 'https://example.test/image.png?X-Amz-Signature=private' }]) {
      expect(liveFallbackManifestSchema.safeParse({ ...input, presentation: { ...input.presentation, layout: { ...input.presentation.layout, spec } } }).success).toBe(false);
    }
    const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
    expect(liveFallbackManifestSchema.safeParse({ ...input, presentation: { ...input.presentation, layout: { ...input.presentation.layout, spec: cycle } } }).success).toBe(false);
  });
});
