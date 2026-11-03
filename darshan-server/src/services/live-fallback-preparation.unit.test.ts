import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, utimes, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLiveFallbackStorage, LiveFallbackPreparationError, processLiveFallbackPreparation,
  scavengeLiveFallbackStaging,
  type LiveFallbackPreparationRepository, type LiveFallbackStorage, type PreparationClaim,
} from './live-fallback-preparation';
import { liveSchedulingFingerprint, type LiveFallbackSourceGraph } from './live-scheduling';
import type { NormalizedFallbackAsset } from './live-fallback-manifest';
import { AppError } from '@/utils/app-error';

const sdk = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/s3', () => ({ getS3Client: () => sdk }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'),
  getDatabase: () => { throw new Error('Unit fixture forbids live database'); } }));
const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const uuid = () => randomUUID();
const contents = Buffer.from('fixture frozen final bytes');

function graph(mime = 'image/png'): LiveFallbackSourceGraph {
  const media = uuid();
  return { version: 1, presentation: { id: uuid(), layout: null,
    items: [{ id: uuid(), media_id: media, order: 0, duration_seconds: 12 }] },
  assets: [{ media_id: media, source_type: mime === 'application/pdf' ? 'DOCUMENT' : /video|mpegurl/.test(mime) ? 'VIDEO' : 'IMAGE',
    representation: 'SOURCE', duration_seconds: null, page_count: mime === 'application/pdf' ? 3 : null,
    object: { storage_object_id: uuid(), bucket: 'source-fixture', object_key: 'mutable/source', sha256: sha(contents), size: contents.length, content_type: mime },
    source_object: null }] };
}

function repository(source: LiveFallbackSourceGraph) {
  const row = { id: uuid(), presentation_id: source.presentation.id, created_by: uuid(), state: 'PENDING',
    source_fingerprint: liveSchedulingFingerprint(source), source_graph: source,
    manifest: null, failure_code: null, claim_token: null, lease_expires_at: null,
    created_at: new Date(), updated_at: new Date() };
  const assets = new Map<string, NormalizedFallbackAsset>();
  let owner: string | null = null;
  const current = (claim: PreparationClaim) => owner === claim.token && row.state === 'PROCESSING';
  const repo: LiveFallbackPreparationRepository = {
    async claim(_id, token, retryFailed) {
      if (row.state === 'READY') return { status: 'READY', manifest: row.manifest! };
      if (row.state === 'PROCESSING') return { status: 'BUSY' };
      if (row.state === 'FAILED' && !retryFailed) return { status: 'FAILED', failure_code: row.failure_code! };
      owner = token; row.state = 'PROCESSING';
      return { row: row as unknown as PreparationClaim['row'], token };
    },
    async renew(claim) { return current(claim); },
    async preflight(claim) { if (!current(claim)) throw new LiveFallbackPreparationError('PREPARATION_CLAIM_LOST'); },
    async recordAsset(claim, asset) {
      if (!current(claim)) throw new LiveFallbackPreparationError('PREPARATION_CLAIM_LOST');
      const normalized = { ...asset, storage_object_id: uuid() };
      assets.set(asset.id, normalized); return normalized;
    },
    async finalize(claim, manifest) {
      if (!current(claim)) throw new LiveFallbackPreparationError('PREPARATION_CLAIM_LOST');
      row.state = 'READY'; row.manifest = manifest as never;
    },
    async markFailed(claim, code) {
      if (!current(claim)) return false;
      row.state = 'FAILED'; row.failure_code = code as never; return true;
    },
  };
  return { repo, row, assets, steal: () => { owner = uuid(); } };
}

function storage(source: LiveFallbackSourceGraph) {
  const objects = new Map<string, { body: Buffer; type: string }>();
  for (const asset of source.assets) objects.set(`${asset.object.bucket}/${asset.object.object_key}`, { body: contents, type: asset.object.content_type });
  let created = 0, reused = 0;
  const adapter: LiveFallbackStorage = {
    async open(location, signal) {
      if (signal.aborted) throw new Error('aborted');
      const object = objects.get(`${location.bucket}/${location.object_key}`);
      if (!object) throw new Error('missing fixture object');
      return { size: object.body.length, contentType: object.type, body: (async function* () {
        for (let offset = 0; offset < object.body.length; offset += 3) {
          if (signal.aborted) throw new Error('aborted');
          yield object.body.subarray(offset, offset + 3);
        }
      })() };
    },
    async putIfAbsent(input, signal) {
      expect(signal.aborted).toBe(false);
      expect((await stat(input.filePath)).mode & 0o777).toBe(0o600);
      const data = await readFile(input.filePath);
      const key = `${input.bucket}/${input.object_key}`;
      if (objects.has(key)) { reused++; return 'EXISTS'; }
      objects.set(key, { body: data, type: input.contentType }); created++; return 'CREATED';
    },
  };
  return { adapter, objects, counts: () => ({ created, reused }) };
}

describe('durable immutable live fallback preparation', () => {
  let parent: string;
  beforeEach(async () => { sdk.send.mockReset(); parent = await mkdtemp(join(tmpdir(), 'darshan-preparation-unit-')); });
  afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await rm(parent, { recursive: true, force: true }); });

  it('streams final bytes into private staging, publishes CAS, persists references and is idempotent READY', async () => {
    const source = graph(), db = repository(source), s3 = storage(source);
    const result = await processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent });
    expect(result.status).toBe('READY');
    if (result.status !== 'READY') throw new Error('missing manifest');
    expect(result.manifest.assets[0]!.object_key).toBe(`live-fallbacks/v1/sha256/${sha(contents)}.png`);
    expect(result.manifest.assets[0]!.storage_object_id).not.toBe(source.assets[0]!.object.storage_object_id);
    expect(result.manifest.assets[0]!.media_id).toBe(source.assets[0]!.media_id);
    expect(db.assets.size).toBe(1); expect(s3.counts()).toEqual({ created: 1, reused: 0 });
    expect(await readdir(parent)).toEqual([]);
    await expect(processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter })).resolves.toEqual(result);
    expect(s3.counts().created).toBe(1);
  });

  it('creates its private owned crash marker before the first media request', async () => {
    const source = graph(), db = repository(source), s3 = storage(source);
    const get = s3.adapter.open; let checked = false;
    s3.adapter.open = async (location, signal) => {
      if (!checked) {
        checked = true;
        const entries = await readdir(parent); expect(entries).toHaveLength(1);
        const stage = join(parent, entries[0]!);
        expect((await stat(stage)).mode & 0o7777).toBe(0o700);
        const markerPath = join(stage, '.darshan-live-fallback-stage.json');
        expect((await stat(markerPath)).mode & 0o7777).toBe(0o600);
        const marker = JSON.parse(await readFile(markerPath, 'utf8'));
        expect(marker).toMatchObject({ kind: 'DARSHAN_LIVE_FALLBACK_STAGE', version: 1, preparation_id: db.row.id });
        expect(marker.claim_token).toMatch(/^[a-f0-9-]{36}$/);
      }
      return get(location, signal);
    };
    expect((await processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent })).status).toBe('READY');
    expect(checked).toBe(true); expect(await readdir(parent)).toEqual([]);
  });

  it('rejects actual checksum/size changes before any CAS publication and cleans staging', async () => {
    for (const mutation of ['checksum', 'size']) {
      const source = graph(), db = repository(source), s3 = storage(source);
      s3.objects.get('source-fixture/mutable/source')!.body = mutation === 'checksum' ? Buffer.alloc(contents.length, 2) : Buffer.from('short');
      const result = await processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent });
      expect(result).toMatchObject({ status: 'FAILED', failure_code: mutation === 'checksum' ? 'FALLBACK_SOURCE_INTEGRITY_MISMATCH' : 'FALLBACK_SOURCE_METADATA_CHANGED' });
      expect(s3.counts().created).toBe(0); expect(db.assets.size).toBe(0); expect(await readdir(parent)).toEqual([]);
    }
  });

  it('rejects revoked creator authority or changed source before S3 access without leaking errors', async () => {
    for (const error of [AppError.forbidden('private role data https://secret.invalid?token=private'), new LiveFallbackPreparationError('FALLBACK_SOURCE_CHANGED')]) {
      const source = graph(), db = repository(source), s3 = storage(source);
      db.repo.preflight = async () => { throw error; };
      const get = vi.spyOn(s3.adapter, 'open');
      const result = await processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent });
      expect(result).toEqual({ status: 'FAILED', failure_code: error instanceof AppError ? 'FALLBACK_AUTHORIZATION_CHANGED' : 'FALLBACK_SOURCE_CHANGED' });
      expect(get).not.toHaveBeenCalled(); expect(await readdir(parent)).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('private');
    }
  });

  it('bounds streaming bytes even when the server omits Content-Length', async () => {
    const source = graph(), db = repository(source), s3 = storage(source);
    const original = s3.adapter.open;
    s3.adapter.open = async (location, signal) => {
      const input = await original(location, signal);
      return { ...input, size: undefined, body: (async function* () { yield contents; yield Buffer.from('extra'); })() };
    };
    await expect(processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent }))
      .resolves.toMatchObject({ status: 'FAILED', failure_code: 'FALLBACK_SOURCE_SIZE_MISMATCH' });
    expect(s3.counts().created).toBe(0); expect(await readdir(parent)).toEqual([]);
  });

  it('refuses corrupt existing CAS bytes and never overwrites their content or metadata', async () => {
    const source = graph(), db = repository(source), s3 = storage(source);
    const key = `media-ready/live-fallbacks/v1/sha256/${sha(contents)}.png`;
    const corrupt = Buffer.alloc(contents.length, 9); s3.objects.set(key, { body: corrupt, type: 'image/png' });
    await expect(processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent }))
      .resolves.toMatchObject({ status: 'FAILED', failure_code: 'CAS_OBJECT_CONFLICT' });
    expect(s3.objects.get(key)!.body).toEqual(corrupt); expect(s3.counts()).toEqual({ created: 0, reused: 1 }); expect(db.assets.size).toBe(0);
  });

  it('allows independent preparations to race the same immutable CAS bytes safely', async () => {
    const source = graph(), first = repository(source), second = repository(source), s3 = storage(source);
    const results = await Promise.all([first, second].map(db => processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent })));
    expect(results.map(result => result.status)).toEqual(['READY', 'READY']);
    expect(s3.counts()).toEqual({ created: 1, reused: 1 }); expect(await readdir(parent)).toEqual([]);
  });

  it('returns BUSY for duplicate job delivery while the first worker owns its claim', async () => {
    const source = graph(), db = repository(source), s3 = storage(source);
    const [first, second] = await Promise.all([1, 2].map(() => processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent })));
    expect([first.status, second.status].sort()).toEqual(['BUSY', 'READY']); expect(s3.counts().created).toBe(1);
  });

  it('retries a transient conditional-write conflict without falling back to an overwrite', async () => {
    const source = graph(), db = repository(source), s3 = storage(source);
    const put = s3.adapter.putIfAbsent; let calls = 0;
    s3.adapter.putIfAbsent = async (input, signal) => {
      if (calls++ === 0) throw new LiveFallbackPreparationError('CAS_WRITE_CONFLICT_RETRY');
      return put(input, signal);
    };
    expect((await processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent })).status).toBe('READY');
    expect(calls).toBe(2); expect(s3.counts().created).toBe(1);
  });

  it('fences a stolen claim after media I/O without failing or publishing the new owner', async () => {
    const source = graph(), db = repository(source), s3 = storage(source);
    const put = s3.adapter.putIfAbsent;
    s3.adapter.putIfAbsent = async (input, signal) => { const value = await put(input, signal); db.steal(); return value; };
    const markFailed = vi.spyOn(db.repo, 'markFailed');
    await expect(processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent }))
      .resolves.toEqual({ status: 'CANCELLED' });
    expect(markFailed).not.toHaveBeenCalled(); expect(db.row.state).toBe('PROCESSING'); expect(db.assets.size).toBe(0); expect(await readdir(parent)).toEqual([]);
  });

  it('requires current source fingerprint again at finalization and retries FAILED only explicitly', async () => {
    const source = graph(), db = repository(source), s3 = storage(source);
    const finalize = db.repo.finalize;
    db.repo.finalize = async () => { throw new LiveFallbackPreparationError('FALLBACK_SOURCE_CHANGED'); };
    await expect(processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent }))
      .resolves.toEqual({ status: 'FAILED', failure_code: 'FALLBACK_SOURCE_CHANGED' });
    db.repo.finalize = finalize;
    expect((await processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter })).status).toBe('FAILED');
    expect((await processLiveFallbackPreparation(db.row.id, { retryFailed: true }, { repository: db.repo, storage: s3.adapter, stagingParent: parent })).status).toBe('READY');
    expect(s3.counts()).toEqual({ created: 1, reused: 1 });
  });

  it('keeps native PDF source and converted PDF final representation exact', async () => {
    for (const representation of ['SOURCE', 'READY'] as const) {
      const source = graph('application/pdf'); source.assets[0]!.representation = representation;
      source.presentation.items[0]!.page_number = 2;
      const db = repository(source), s3 = storage(source);
      const result = await processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent });
      expect(result.status).toBe('READY');
      if (result.status === 'READY') { expect(result.manifest.assets[0]!.representation).toBe(representation); expect(result.manifest.assets[0]!.render_type).toBe('pdf'); expect(result.manifest.presentation.items[0]!.page_number).toBe(2); }
    }
  });

  it('rejects retired webpage fallback descriptors', async () => {
    const source = graph(); source.assets[0]!.source_type = 'WEBPAGE';
    const db = repository(source), s3 = storage(source);
    const result = await processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent });
    expect(result.status).toBe('FAILED');
    expect(s3.counts().created).toBe(0);
  });

  it('fails closed for HLS until its explicit local preparation adapter is wired, never reading raw source', async () => {
    const source = graph('application/vnd.apple.mpegurl'), db = repository(source), s3 = storage(source);
    const result = await processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent });
    expect(result).toEqual({ status: 'FAILED', failure_code: 'HLS_PREPARATION_REQUIRED' }); expect(s3.counts().created).toBe(0);
  });

  it('freezes the explicit HLS-derived MP4 before approval and rejects adapter output outside staging', async () => {
    for (const escape of [false, true]) {
      const source = graph('application/vnd.apple.mpegurl'), db = repository(source), s3 = storage(source);
      const result = await processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent,
        prepareHls: async ({ stagingDir }) => {
          const filePath = join(escape ? parent : stagingDir, `${uuid()}.mp4`); await writeFile(filePath, contents, { mode: 0o600 });
          return { filePath, contentType: 'video/mp4', representation: 'PREPARED_MP4' };
        } });
      if (escape) expect(result).toEqual({ status: 'FAILED', failure_code: 'HLS_PREPARATION_OUTPUT_INVALID' });
      else { expect(result.status).toBe('READY'); if (result.status === 'READY') expect(result.manifest.assets[0]).toMatchObject({ content_type: 'video/mp4', render_type: 'video', representation: 'PREPARED_MP4' }); }
    }
  });

  it('cancels finalization when renewal is rejected without changing newer claim state', async () => {
    const source = graph(), db = repository(source), s3 = storage(source);
    db.repo.renew = async () => false;
    const markFailed = vi.spyOn(db.repo, 'markFailed');
    await expect(processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent }))
      .resolves.toEqual({ status: 'CANCELLED' });
    expect(db.row.manifest).toBeNull(); expect(markFailed).not.toHaveBeenCalled(); expect(await readdir(parent)).toEqual([]);
  });

  it('uses conditional PUT with actual streaming body and refuses existing-key overwrite', async () => {
    const filePath = join(parent, 'verified.png'); await writeFile(filePath, contents, { mode: 0o600 });
    const input = { bucket: 'media-ready', object_key: 'immutable-key', filePath, sha256: sha(contents), size: contents.length, contentType: 'image/png' };
    let uploaded = Buffer.alloc(0);
    sdk.send.mockImplementationOnce(async command => {
      expect(command.input.IfNoneMatch).toBe('*'); expect(command.input.Metadata).toEqual({ 'x-sha256': sha(contents) });
      for await (const chunk of command.input.Body) uploaded = Buffer.concat([uploaded, chunk]);
      return {};
    });
    const adapter = createLiveFallbackStorage();
    await expect(adapter.putIfAbsent(input, new AbortController().signal)).resolves.toBe('CREATED');
    expect(uploaded).toEqual(contents);
    sdk.send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 } });
    await expect(adapter.putIfAbsent(input, new AbortController().signal)).resolves.toBe('EXISTS');
  });

  it('aborts stalled GET headers after bounded idle time without a live S3 request', async () => {
    vi.useFakeTimers();
    sdk.send.mockImplementation((_command, options) => new Promise((_resolve, reject) => {
      options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const result = createLiveFallbackStorage().open({ bucket: 'fixture', object_key: 'source' }, new AbortController().signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ code: 'FALLBACK_STORAGE_STALLED' });
  });

  it('allows a transfer longer than the idle timeout while chunks keep making progress', async () => {
    vi.useFakeTimers();
    sdk.send.mockResolvedValueOnce({ ContentType: 'image/png', Body: (async function* () {
      for (let index = 0; index < 4; index++) {
        if (index) await new Promise(resolve => setTimeout(resolve, 20_000));
        yield Buffer.from([index]);
      }
    })() });
    const result = (async () => {
      const input = await createLiveFallbackStorage().open({ bucket: 'fixture', object_key: 'source' }, new AbortController().signal);
      const values: number[] = []; for await (const chunk of input.body) values.push(...chunk); return values;
    })();
    await vi.advanceTimersByTimeAsync(65_000);
    await expect(result).resolves.toEqual([0, 1, 2, 3]);
  });

  it('bounds a hung lease renewal and aborts in-flight storage without failing a newer owner', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    const source = graph(), db = repository(source), s3 = storage(source);
    db.repo.renew = () => new Promise<boolean>(() => undefined);
    let reached: () => void = () => undefined;
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    s3.adapter.open = (_location, signal) => {
      reached();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    };
    const failed = vi.spyOn(db.repo, 'markFailed');
    const result = processLiveFallbackPreparation(db.row.id, {}, { repository: db.repo, storage: s3.adapter, stagingParent: parent });
    await waiting; await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toEqual({ status: 'CANCELLED' });
    expect(failed).not.toHaveBeenCalled(); expect(db.assets.size).toBe(0); expect(await readdir(parent)).toEqual([]);
  });

  describe('crash staging recovery', () => {
    const markerName = '.darshan-live-fallback-stage.json';
    const old = new Date(Date.now() - 10 * 60_000);
    async function crashStage() {
      const stage = await mkdtemp(join(parent, 'stage-'));
      const marker = { kind: 'DARSHAN_LIVE_FALLBACK_STAGE', version: 1, preparation_id: uuid(), claim_token: uuid(), created_at: old.toISOString() };
      await writeFile(join(stage, markerName), JSON.stringify(marker), { mode: 0o600 });
      await writeFile(join(stage, 'partial-media'), Buffer.alloc(1024));
      await utimes(join(stage, markerName), old, old); await utimes(stage, old, old);
      return { stage, marker };
    }

    it('removes only marked expired/replaced claim stages after grace and preserves active/unknown work', async () => {
      const stale = await crashStage(), active = await crashStage(), unknown = await crashStage();
      const result = await scavengeLiveFallbackStaging({ stagingParent: parent }, { claimStatus: async marker =>
        marker.claim_token === stale.marker.claim_token ? 'INACTIVE' : marker.claim_token === active.marker.claim_token ? 'ACTIVE' : 'UNKNOWN' });
      expect(result).toMatchObject({ removed: 1, protected: 1, ignored: 1 });
      expect(await readdir(parent)).toHaveLength(2);
      expect(await readFile(join(active.stage, 'partial-media'))).toHaveLength(1024);
      expect(await readFile(join(unknown.stage, 'partial-media'))).toHaveLength(1024);
    });

    it('leaves unmarked, malformed, symlink and shared-readable material untouched', async () => {
      const unmarked = await crashStage(); await rm(join(unmarked.stage, markerName));
      const malformed = await crashStage(); await writeFile(join(malformed.stage, markerName), '{invalid');
      const shared = await crashStage(); await chmod(shared.stage, 0o755);
      const linkedMarker = await crashStage();
      const outside = join(parent, 'user-file'); await writeFile(outside, 'preserve');
      await rm(join(linkedMarker.stage, markerName)); await symlink(outside, join(linkedMarker.stage, markerName));
      const linkedStage = join(parent, 'stage-ABC123'); await symlink(shared.stage, linkedStage);
      const check = vi.fn(async () => 'INACTIVE' as const);
      const before = (await readdir(parent)).sort();
      const result = await scavengeLiveFallbackStaging({ stagingParent: parent, graceMs: 0 }, { claimStatus: check });
      expect(result.removed).toBe(0); expect(check).not.toHaveBeenCalled();
      expect((await readdir(parent)).sort()).toEqual(before); expect(await readFile(outside, 'utf8')).toBe('preserve');
    });

    it('keeps fresh stages without querying claims and bounds work per reconciliation', async () => {
      const fresh = await crashStage(); await utimes(fresh.stage, new Date(), new Date());
      const check = vi.fn(async () => 'INACTIVE' as const);
      expect((await scavengeLiveFallbackStaging({ stagingParent: parent }, { claimStatus: check })).removed).toBe(0);
      expect(check).not.toHaveBeenCalled();
      await utimes(fresh.stage, old, old); await crashStage(); await crashStage();
      const result = await scavengeLiveFallbackStaging({ stagingParent: parent, maxScan: 2, maxRemove: 1 }, { claimStatus: check });
      expect(result.removed).toBe(1); expect(result.scanned).toBeLessThanOrEqual(2); expect(await readdir(parent)).toHaveLength(2);
    });

    it('refuses unsafe staging parents and preserves a directory replaced during claim lookup', async () => {
      const unsafe = join(parent, 'unsafe'); await mkdir(unsafe, { mode: 0o755 });
      await expect(scavengeLiveFallbackStaging({ stagingParent: unsafe }, { claimStatus: async () => 'INACTIVE' }))
        .rejects.toMatchObject({ code: 'FALLBACK_STAGING_PARENT_UNSAFE' });
      const candidate = await crashStage();
      const moved = join(parent, 'preserved-original');
      const result = await scavengeLiveFallbackStaging({ stagingParent: parent }, { claimStatus: async () => {
        await rename(candidate.stage, moved); await mkdir(candidate.stage, { mode: 0o700 });
        await writeFile(join(candidate.stage, 'user-content'), 'preserve'); return 'INACTIVE';
      } });
      expect(result.removed).toBe(0); expect(await readFile(join(candidate.stage, 'user-content'), 'utf8')).toBe('preserve');
      expect(await readFile(join(moved, 'partial-media'))).toHaveLength(1024);
    });
  });
});
