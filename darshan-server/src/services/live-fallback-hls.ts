import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdtemp, realpath, statfs, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep, posix } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { execFile } from 'node:child_process';
import { getResolvedFfmpegPath } from '@/utils/runtime-dependencies';
import { LiveFallbackPreparationError as HlsPreparationError } from './live-fallback-preparation';
import type { LiveFallbackHlsPreparationInput, LiveFallbackHlsPreparationOutput } from './live-fallback-preparation';
function fail(code: string): never { throw new HlsPreparationError(code); }
function active(signal: AbortSignal) { if (signal.aborted) fail('PREPARATION_CLAIM_LOST'); }

// Only our existing FFmpeg VOD output is accepted. URI-bearing tags, keys,
// nested playlists and arbitrary protocols are never forwarded to FFmpeg.
const safeTag = /^(?:#EXTM3U|#EXT-X-VERSION:\d+|#EXT-X-TARGETDURATION:\d+|#EXT-X-MEDIA-SEQUENCE:\d+|#EXT-X-DISCONTINUITY-SEQUENCE:\d+|#EXT-X-PLAYLIST-TYPE:VOD|#EXT-X-ALLOW-CACHE:(?:YES|NO)|#EXT-X-INDEPENDENT-SEGMENTS|#EXT-X-DISCONTINUITY|#EXT-X-ENDLIST)$/;
async function* lines(path: string, signal: AbortSignal) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  for await (const chunk of createReadStream(path, { signal, highWaterMark: 4096 })) {
    pending += decoder.write(chunk);
    let boundary: number;
    while ((boundary = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, boundary).replace(/\r$/, '');
      if (line.length > 1024) fail('HLS_PLAYLIST_INVALID');
      yield line; pending = pending.slice(boundary + 1);
    }
    if (pending.length > 1024) fail('HLS_PLAYLIST_INVALID');
  }
  pending += decoder.end();
  if (pending.length > 1024) fail('HLS_PLAYLIST_INVALID');
  if (pending) yield pending.replace(/\r$/, '');
}

type Remux = (playlist: string, output: string, signal: AbortSignal) => Promise<void>;
async function remux(playlist: string, output: string, signal: AbortSignal) {
  const executable = getResolvedFfmpegPath();
  if (!executable) fail('HLS_FFMPEG_UNAVAILABLE');
  await new Promise<void>((resolve, reject) => {
    execFile(executable!, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-protocol_whitelist', 'file', '-allowed_extensions', 'ts', '-i', playlist,
      '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', output],
    { signal, timeout: 10 * 60_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 }, error => {
      if (signal.aborted) reject(new HlsPreparationError('PREPARATION_CLAIM_LOST'));
      else if (error) reject(new HlsPreparationError('HLS_REMUX_FAILED'));
      else resolve();
    });
  });
}

/** Prepare an explicit MP4 rendition BEFORE approval. Reads only same-bucket,
 * same-directory segment_NNN.ts objects from the verified internal playlist.
 * FFmpeg sees private local files and has no network protocol permission. The
 * caller verifies/hashes the resulting MP4 and approves that exact CAS revision. */
export async function prepareLiveHlsFallback(
  input: LiveFallbackHlsPreparationInput,
  dependencies: { remux?: Remux } = {},
): Promise<LiveFallbackHlsPreparationOutput> {
  active(input.signal);
  if (input.asset.source_type !== 'VIDEO' || !/^(?:application\/vnd\.apple\.mpegurl|application\/x-mpegurl)$/.test(input.asset.object.content_type)) {
    fail('HLS_PLAYLIST_INVALID');
  }
  if (input.asset.representation !== 'READY' || input.asset.object.object_key !== `${input.asset.media_id}/hls/playlist.m3u8`) {
    fail('HLS_SEGMENT_LOCATION_INVALID');
  }
  const parent = await realpath(input.stagingDir), playlist = await realpath(input.playlistPath);
  const rel = relative(parent, playlist);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || !(await lstat(input.playlistPath)).isFile() || (await lstat(input.playlistPath)).isSymbolicLink()) {
    fail('HLS_STAGING_INVALID');
  }
  const normalized: string[] = [], segments = new Set<string>();
  let header = false, ended = false, awaitingSegment = false;
  for await (const line of lines(playlist, input.signal)) {
    active(input.signal);
    if (!line) continue;
    if (!header) { if (line !== '#EXTM3U') fail('HLS_PLAYLIST_INVALID'); header = true; normalized.push(line); continue; }
    if (ended) fail('HLS_PLAYLIST_INVALID');
    if (line.startsWith('#EXTINF:')) {
      const duration = Number(line.slice(8).split(',')[0]);
      const hasControl = [...line].some(character => character.charCodeAt(0) < 32);
      if (awaitingSegment || !/^#EXTINF:(?:\d+(?:\.\d+)?),/.test(line) || hasControl || !Number.isFinite(duration) || duration <= 0) fail('HLS_PLAYLIST_INVALID');
      awaitingSegment = true;
    } else if (line.startsWith('#')) {
      // Ignore plain comments rather than passing untrusted text downstream.
      if (!line.startsWith('#EXT')) continue;
      if (!safeTag.test(line) || line === '#EXTM3U' || awaitingSegment) fail('HLS_PLAYLIST_UNSUPPORTED');
      if (line === '#EXT-X-ENDLIST') ended = true;
    } else {
      if (!awaitingSegment || !/^segment_\d+\.ts$/.test(line)) fail('HLS_SEGMENT_LOCATION_INVALID');
      segments.add(line); awaitingSegment = false;
    }
    normalized.push(line);
  }
  if (!header || !ended || awaitingSegment || !segments.size) fail('HLS_PLAYLIST_INVALID');
  const local = await mkdtemp(join(parent, 'hls-'));
  const prefix = posix.dirname(input.asset.object.object_key).replace(/\/$/, '');
  let downloadedBytes = 0;
  for (const segment of segments) {
    active(input.signal);
    const object = await input.storage.open({ bucket: input.asset.object.bucket,
      object_key: (prefix === '.' ? '' : prefix + '/') + segment }, input.signal);
    const stream = Readable.from(object.body);
    try {
      if (!Number.isSafeInteger(object.size) || object.size! <= 0 || object.contentType?.split(';')[0].trim().toLowerCase() !== 'video/mp2t') fail('HLS_SEGMENT_UNVERIFIED');
      const space = await statfs(local);
      if (space.bavail * space.bsize < object.size!) fail('FALLBACK_STAGING_CAPACITY');
      let size = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > object.size!) callback(new HlsPreparationError('HLS_SEGMENT_SIZE_MISMATCH'));
        else callback(null, chunk);
      } });
      await pipeline(stream, meter, createWriteStream(join(local, segment), { flags: 'wx', mode: 0o600 }), { signal: input.signal });
      if (size !== object.size) fail('HLS_SEGMENT_SIZE_MISMATCH');
      downloadedBytes += size;
      if (!Number.isSafeInteger(downloadedBytes)) fail('FALLBACK_STAGING_CAPACITY');
    } finally { stream.destroy(); }
  }
  active(input.signal);
  const space = await statfs(local);
  if (space.bavail * space.bsize < downloadedBytes) fail('FALLBACK_STAGING_CAPACITY');
  const localPlaylist = join(local, 'playlist.m3u8'), output = join(local, 'approved-fallback.mp4');
  await writeFile(localPlaylist, normalized.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  await (dependencies.remux ?? remux)(localPlaylist, output, input.signal);
  active(input.signal);
  const result = await lstat(output);
  if (!result.isFile() || result.isSymbolicLink() || result.size <= 0) fail('HLS_REMUX_FAILED');
  return { filePath: output, contentType: 'video/mp4', representation: 'PREPARED_MP4' };
}
