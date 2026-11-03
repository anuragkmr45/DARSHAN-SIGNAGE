import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareLiveHlsFallback } from './live-fallback-hls';
import type { LiveFallbackHlsPreparationInput } from './live-fallback-preparation';

describe('restricted internal HLS preparation before live approval', () => {
  const directories: string[] = [];
  afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
  async function fixture(text = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:2.000000,\nsegment_000.ts\n#EXT-X-ENDLIST\n') {
    const stagingDir = await mkdtemp(join(tmpdir(), 'live-hls-unit-')); directories.push(stagingDir);
    const playlistPath = join(stagingDir, 'verified.m3u8'); await writeFile(playlistPath, text, { mode: 0o600 });
    const mediaId = randomUUID();
    const open = vi.fn(async () => ({ body: (async function* () { yield Buffer.from('safe'); yield Buffer.from('segment'); })(), size: 11, contentType: 'video/mp2t' }));
    const input: LiveFallbackHlsPreparationInput = { stagingDir, playlistPath, signal: new AbortController().signal,
      storage: { open, putIfAbsent: vi.fn() }, asset: { media_id: mediaId, source_type: 'VIDEO', representation: 'READY',
        object: { storage_object_id: randomUUID(), bucket: 'media-ready', object_key: `${mediaId}/hls/playlist.m3u8`,
          size: Buffer.byteLength(text), content_type: 'application/vnd.apple.mpegurl', sha256: 'a'.repeat(64) },
        source_object: null, duration_seconds: 2, page_count: null } };
    const remux = vi.fn(async (_playlist: string, output: string) => { await writeFile(output, 'verified-mp4-output'); });
    return { input, open, remux };
  }
  it('downloads only same-directory private objects and prepares an explicit MP4', async () => {
    const { input, open, remux } = await fixture();
    const result = await prepareLiveHlsFallback(input, { remux });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ bucket: 'media-ready', object_key: `${input.asset.media_id}/hls/segment_000.ts` }, input.signal);
    const playlist = remux.mock.calls[0]![0];
    expect(await readFile(join(dirname(playlist), 'segment_000.ts'), 'utf8')).toBe('safesegment');
    expect(await readFile(playlist, 'utf8')).not.toMatch(/https?:|file:|\?token/);
    expect(result).toMatchObject({ contentType: 'video/mp4', representation: 'PREPARED_MP4' });
  });
  it.each(['https://example.test/segment.ts', '../segment_000.ts', '/etc/passwd', 'file:///etc/passwd',
    'segment_000.ts?token=secret', 'segment_000.ts#fragment', 'segment_000\\.ts'])('rejects unsafe segment URI %s before storage or FFmpeg', async uri => {
    const { input, open, remux } = await fixture(`#EXTM3U\n#EXTINF:1,\n${uri}\n#EXT-X-ENDLIST\n`);
    await expect(prepareLiveHlsFallback(input, { remux })).rejects.toMatchObject({ code: 'HLS_SEGMENT_LOCATION_INVALID' });
    expect(open).not.toHaveBeenCalled(); expect(remux).not.toHaveBeenCalled();
  });
  it.each(['#EXT-X-KEY:METHOD=AES-128,URI="https://example.test/key"', '#EXT-X-MAP:URI="init.mp4"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000', '#EXT-X-BYTERANGE:10@0'])('rejects URI-bearing/nested/encrypted constructs %s', async tag => {
    const { input, open, remux } = await fixture(`#EXTM3U\n${tag}\n#EXTINF:1,\nsegment_000.ts\n#EXT-X-ENDLIST\n`);
    await expect(prepareLiveHlsFallback(input, { remux })).rejects.toMatchObject({ code: 'HLS_PLAYLIST_UNSUPPORTED' });
    expect(open).not.toHaveBeenCalled(); expect(remux).not.toHaveBeenCalled();
  });
  it.each(['#EXTM3U\n#EXTINF:1,\nsegment_000.ts\n', '#EXTM3U\n#EXT-X-ENDLIST\n',
    '#EXTM3U\n#EXTINF:0,\nsegment_000.ts\n#EXT-X-ENDLIST\n', '#EXTM3U\n#EXTINF:1,\n#EXT-X-ENDLIST\n'])('refuses incomplete or malformed VOD', async text => {
    const { input, open, remux } = await fixture(text);
    await expect(prepareLiveHlsFallback(input, { remux })).rejects.toHaveProperty('code'); expect(open).not.toHaveBeenCalled();
  });
  it('refuses size mismatches and does not remux truncated content', async () => {
    const { input, open, remux } = await fixture();
    open.mockResolvedValue({ body: (async function* () { yield Buffer.from('bad'); })(), size: 11, contentType: 'video/mp2t' });
    await expect(prepareLiveHlsFallback(input, { remux })).rejects.toMatchObject({ code: 'HLS_SEGMENT_SIZE_MISMATCH' }); expect(remux).not.toHaveBeenCalled();
  });
  it('refuses non-segment content types', async () => {
    const { input, open, remux } = await fixture();
    open.mockResolvedValue({ body: (async function* () { yield Buffer.from('bad'); })(), size: 3, contentType: 'application/vnd.apple.mpegurl' });
    await expect(prepareLiveHlsFallback(input, { remux })).rejects.toMatchObject({ code: 'HLS_SEGMENT_UNVERIFIED' }); expect(remux).not.toHaveBeenCalled();
  });
  it('does not consume storage after cancellation', async () => {
    const { input, open, remux } = await fixture(); const controller = new AbortController(); controller.abort(); input.signal = controller.signal;
    await expect(prepareLiveHlsFallback(input, { remux })).rejects.toMatchObject({ code: 'PREPARATION_CLAIM_LOST' }); expect(open).not.toHaveBeenCalled();
  });
  it('rejects a substituted playlist symlink', async () => {
    const { input, open, remux } = await fixture();
    const link = join(input.stagingDir, 'link.m3u8'); await symlink(input.playlistPath, link); input.playlistPath = link;
    await expect(prepareLiveHlsFallback(input, { remux })).rejects.toMatchObject({ code: 'HLS_STAGING_INVALID' }); expect(open).not.toHaveBeenCalled();
  });
});
