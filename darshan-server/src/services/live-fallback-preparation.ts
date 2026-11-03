import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, opendir, realpath, rename, rm, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { getDatabase, schema, type Database } from '@/db';
import { getS3Client } from '@/s3';
import { AppError } from '@/utils/app-error';
import {
  collectLiveFallbackPreparationSource, liveSchedulingFingerprint,
  type LiveFallbackSourceGraph,
} from './live-scheduling';
import {
  canonicalLiveCacheKey, validateLiveFallbackManifest,
  type FrozenFallbackManifest, type FrozenFallbackAsset, type NormalizedFallbackAsset,
} from './live-fallback-manifest';

const LEASE_MS = 60_000;
const RENEW_MS = 10_000;
// This is the existing ready bucket used by the processing jobs, not a public URL.
const READY_BUCKET = 'media-ready';
type PreparationRow = typeof schema.liveFallbackPreparations.$inferSelect;
type SourceAsset = LiveFallbackSourceGraph['assets'][number];
export type PreparationClaim = { row: PreparationRow; token: string };
export type PreparationResult =
  | { status: 'READY'; manifest: FrozenFallbackManifest }
  | { status: 'FAILED'; failure_code: string }
  | { status: 'BUSY' | 'CANCELLED' | 'NOT_FOUND' };

export class LiveFallbackPreparationError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'LiveFallbackPreparationError'; }
}
function fail(code: string): never { throw new LiveFallbackPreparationError(code); }
function assertActive(signal: AbortSignal): void { if (signal.aborted) fail('PREPARATION_CLAIM_LOST'); }

export interface LiveFallbackStorage {
  open(location: { bucket: string; object_key: string }, signal: AbortSignal): Promise<{
    body: AsyncIterable<Uint8Array>; contentType?: string; size?: number;
  }>;
  /** Must atomically refuse an existing key. There is no overwrite fallback. */
  putIfAbsent(input: {
    bucket: string; object_key: string; filePath: string; sha256: string;
    size: number; contentType: string;
  }, signal: AbortSignal): Promise<'CREATED' | 'EXISTS'>;
}

export type LiveFallbackHlsPreparationInput = {
  asset: SourceAsset; playlistPath: string; stagingDir: string;
  storage: LiveFallbackStorage; signal: AbortSignal;
};
export type LiveFallbackHlsPreparationOutput = { filePath: string; contentType: 'video/mp4'; representation: 'PREPARED_MP4' };
export type LiveFallbackHlsPreparation = (input: LiveFallbackHlsPreparationInput) => Promise<LiveFallbackHlsPreparationOutput>;

export interface LiveFallbackPreparationRepository {
  claim(id: string, token: string, retryFailed: boolean): Promise<PreparationClaim | PreparationResult>;
  renew(claim: PreparationClaim): Promise<boolean>;
  preflight(claim: PreparationClaim): Promise<void>;
  /** No media I/O or target/schedule locks are allowed inside these methods. */
  recordAsset(claim: PreparationClaim, asset: Omit<NormalizedFallbackAsset, 'storage_object_id'>): Promise<NormalizedFallbackAsset>;
  finalize(claim: PreparationClaim, manifest: FrozenFallbackManifest): Promise<void>;
  markFailed(claim: PreparationClaim, code: string): Promise<boolean>;
}
export type LiveFallbackPreparationDependencies = {
  repository?: LiveFallbackPreparationRepository;
  storage?: LiveFallbackStorage;
  prepareHls?: LiveFallbackHlsPreparation;
  stagingParent?: string;
  readyBucket?: string;
};

export type LiveFallbackStageMarker = {
  kind: 'DARSHAN_LIVE_FALLBACK_STAGE'; version: 1;
  preparation_id: string; claim_token: string; created_at: string;
};
export type LiveFallbackStagingClaimStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
const STAGE_MARKER = '.darshan-live-fallback-stage.json';
const stageUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function stagingUid(): number {
  if (typeof process.getuid !== 'function') fail('FALLBACK_STAGING_OWNER_UNSUPPORTED');
  return process.getuid();
}
async function privateStagingParent(requested?: string): Promise<string> {
  const root = await realpath(tmpdir());
  const parent = requested ?? join(root, `darshan-live-fallback-staging-${stagingUid()}`);
  const rel = relative(root, parent);
  if (!isAbsolute(parent) || !rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('FALLBACK_STAGING_PARENT_UNSAFE');
  try { await mkdir(parent, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = await lstat(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== stagingUid() || (stat.mode & 0o7777) !== 0o700 || await realpath(parent) !== parent) fail('FALLBACK_STAGING_PARENT_UNSAFE');
  return parent;
}

async function createPrivateStage(parent: string, claim: PreparationClaim): Promise<string> {
  const stage = await mkdtemp(join(parent, 'stage-'));
  const marker: LiveFallbackStageMarker = { kind: 'DARSHAN_LIVE_FALLBACK_STAGE', version: 1,
    preparation_id: claim.row.id, claim_token: claim.token, created_at: new Date().toISOString() };
  try {
    const handle = await open(join(stage, STAGE_MARKER), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify(marker)); await handle.sync(); }
    finally { await handle.close(); }
    const directory = await open(stage, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
    return stage;
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}

export async function getLiveFallbackStagingClaimStatus(marker: LiveFallbackStageMarker, db: Database = getDatabase()): Promise<LiveFallbackStagingClaimStatus> {
  const [row] = await db.select({ token: schema.liveFallbackPreparations.claim_token, state: schema.liveFallbackPreparations.state,
    unexpired: sql<boolean>`${schema.liveFallbackPreparations.lease_expires_at} > (clock_timestamp() AT TIME ZONE 'UTC')` })
    .from(schema.liveFallbackPreparations).where(eq(schema.liveFallbackPreparations.id, marker.preparation_id));
  if (!row) return 'UNKNOWN';
  return row.state === 'PROCESSING' && row.token?.toLowerCase() === marker.claim_token.toLowerCase() && row.unexpired === true ? 'ACTIVE' : 'INACTIVE';
}

/** Only positively identified service-owned stages are eligible. Inactive is
 * monotonic for an old UUID: reclaim always creates a new token and an expired
 * token cannot renew. No filesystem deletion holds SQL/auth/target locks. */
export async function scavengeLiveFallbackStaging(
  options: { stagingParent?: string; graceMs?: number; maxScan?: number; maxRemove?: number; now?: () => number } = {},
  dependencies: { claimStatus?: (marker: LiveFallbackStageMarker) => Promise<LiveFallbackStagingClaimStatus> } = {},
): Promise<{ scanned: number; removed: number; protected: number; ignored: number; errors: number }> {
  const result = { scanned: 0, removed: 0, protected: 0, ignored: 0, errors: 0 };
  const parent = await privateStagingParent(options.stagingParent);
  const grace = options.graceMs ?? 5 * 60_000;
  const maxScan = options.maxScan ?? 100, maxRemove = options.maxRemove ?? 20;
  if (!Number.isSafeInteger(grace) || grace < 0 || !Number.isSafeInteger(maxScan) || maxScan < 1 ||
      !Number.isSafeInteger(maxRemove) || maxRemove < 1) fail('FALLBACK_SCAVENGE_OPTIONS_INVALID');
  const directory = await opendir(parent);
  for await (const entry of directory) {
    if (result.scanned >= maxScan || result.removed >= maxRemove) break;
    result.scanned++;
    const stage = join(parent, entry.name), markerPath = join(stage, STAGE_MARKER);
    try {
      // mkdtemp suffix is six alphanumeric characters; quarantine names are
      // UUIDs. Neither name alone authorizes cleanup.
      if (!/^(?:stage-[a-zA-Z0-9]{6}|reap-[a-f0-9-]{36})$/.test(entry.name)) { result.ignored++; continue; }
      const before = await lstat(stage);
      if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== stagingUid() || (before.mode & 0o7777) !== 0o700) { result.ignored++; continue; }
      const markerBefore = await lstat(markerPath);
      if (!markerBefore.isFile() || markerBefore.isSymbolicLink() || markerBefore.uid !== stagingUid() ||
          (markerBefore.mode & 0o7777) !== 0o600 || markerBefore.size < 1 || markerBefore.size > 4096) { result.ignored++; continue; }
      const handle = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      let marker: LiveFallbackStageMarker;
      try {
        const actual = await handle.stat();
        if (actual.dev !== markerBefore.dev || actual.ino !== markerBefore.ino || actual.size !== markerBefore.size) { result.ignored++; continue; }
        marker = JSON.parse(await handle.readFile('utf8')) as LiveFallbackStageMarker;
      } finally { await handle.close(); }
      if (!marker || marker.kind !== 'DARSHAN_LIVE_FALLBACK_STAGE' || marker.version !== 1 ||
          !stageUuid.test(marker.preparation_id) || !stageUuid.test(marker.claim_token) || typeof marker.created_at !== 'string' ||
          Object.keys(marker).sort().join(',') !== 'claim_token,created_at,kind,preparation_id,version' || !Number.isFinite(Date.parse(marker.created_at))) { result.ignored++; continue; }
      if ((options.now?.() ?? Date.now()) - Math.max(Date.parse(marker.created_at), before.mtimeMs, markerBefore.mtimeMs) < grace) { result.protected++; continue; }
      const state = await (dependencies.claimStatus ?? getLiveFallbackStagingClaimStatus)(marker);
      if (state !== 'INACTIVE') { if (state === 'ACTIVE') result.protected++; else result.ignored++; continue; }
      const after = await lstat(stage), markerAfter = await lstat(markerPath);
      if (after.dev !== before.dev || after.ino !== before.ino || after.uid !== before.uid || after.mode !== before.mode ||
          markerAfter.dev !== markerBefore.dev || markerAfter.ino !== markerBefore.ino || markerAfter.size !== markerBefore.size ||
          markerAfter.mtimeMs !== markerBefore.mtimeMs || markerAfter.mode !== markerBefore.mode) { result.ignored++; continue; }
      const quarantine = join(parent, `reap-${randomUUID()}`);
      await rename(stage, quarantine);
      await rm(quarantine, { recursive: true, force: true });
      result.removed++;
    } catch { result.errors++; }
  }
  return result;
}

export function liveFallbackMimeSuffix(mime: string): string {
  // Source policy permits JPEG/PNG/WebP, MP4/QuickTime/PDF. Processing also
  // produces WebM/HLS; TS is the existing internal HLS segment representation.
  const suffix = ({
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'application/pdf': 'pdf', 'application/vnd.apple.mpegurl': 'm3u8',
    'application/x-mpegurl': 'm3u8', 'video/mp2t': 'ts',
  } as Record<string, string>)[mime.toLowerCase()];
  if (!suffix) fail('FALLBACK_MIME_UNSUPPORTED');
  return suffix;
}
function renderTypeFor(mime: string): FrozenFallbackAsset['render_type'] {
  if (/mpegurl/i.test(mime)) return 'hls';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return fail('FALLBACK_MIME_UNSUPPORTED');
}

function storageIdleScope(parent: AbortSignal) {
  const controller = new AbortController();
  let stalled = false, finished = false, timer: ReturnType<typeof setTimeout> | undefined;
  const parentAbort = () => controller.abort();
  const touch = () => {
    if (finished) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { stalled = true; controller.abort(new LiveFallbackPreparationError('FALLBACK_STORAGE_STALLED')); }, 30_000);
    timer.unref();
  };
  const finish = () => { finished = true; if (timer) clearTimeout(timer); parent.removeEventListener('abort', parentAbort); };
  const rethrow = (error: unknown): never => { if (stalled) fail('FALLBACK_STORAGE_STALLED'); throw error; };
  parent.addEventListener('abort', parentAbort, { once: true });
  if (parent.aborted) parentAbort(); else touch();
  return { signal: controller.signal, touch, finish, rethrow };
}

export function createLiveFallbackStorage(): LiveFallbackStorage {
  return {
    async open(location, signal) {
      assertActive(signal);
      const idle = storageIdleScope(signal);
      try {
        const response = await getS3Client().send(new GetObjectCommand({ Bucket: location.bucket, Key: location.object_key }), { abortSignal: idle.signal });
        if (!response.Body || !(Symbol.asyncIterator in response.Body)) fail('FALLBACK_OBJECT_UNREADABLE');
        idle.touch();
        const remote = response.Body as AsyncIterable<Uint8Array> & { destroy?: () => void };
        const body = Readable.from((async function* () {
          try { for await (const chunk of remote) { idle.touch(); yield chunk; } }
          catch (error) { idle.rethrow(error); }
          finally { remote.destroy?.(); idle.finish(); }
        })(), { signal: idle.signal });
        body.once('close', () => { remote.destroy?.(); idle.finish(); });
        // A caller may reject response metadata before starting iteration.
        body.on('error', () => undefined);
        return { body, contentType: response.ContentType, size: response.ContentLength };
      } catch (error) { idle.finish(); return idle.rethrow(error); }
    },
    async putIfAbsent(input, signal) {
      assertActive(signal);
      const idle = storageIdleScope(signal);
      const file = createReadStream(input.filePath, { signal: idle.signal });
      file.on('error', () => undefined);
      const body = Readable.from((async function* () {
        for await (const chunk of file) { idle.touch(); yield chunk; }
      })(), { signal: idle.signal });
      body.on('error', () => undefined);
      try {
        await getS3Client().send(new PutObjectCommand({
          Bucket: input.bucket, Key: input.object_key, Body: body,
          ContentLength: input.size, ContentType: input.contentType,
          Metadata: { 'x-sha256': input.sha256 }, IfNoneMatch: '*',
        }), { abortSignal: idle.signal });
        return 'CREATED';
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 412) return 'EXISTS';
        // Some S3 implementations reject a concurrent conditional PUT with409.
        // Retry is owned by the job; never degrade to an unconditional overwrite.
        if (status === 409) fail('CAS_WRITE_CONFLICT_RETRY');
        return idle.rethrow(error);
      } finally { body.destroy(); file.destroy(); idle.finish(); }
    },
  };
}

export function createLiveFallbackPreparationRepository(db: Database = getDatabase()): LiveFallbackPreparationRepository {
  const claimCondition = (claim: PreparationClaim) => and(eq(schema.liveFallbackPreparations.id, claim.row.id),
    eq(schema.liveFallbackPreparations.state, 'PROCESSING'), eq(schema.liveFallbackPreparations.claim_token, claim.token),
    sql`${schema.liveFallbackPreparations.lease_expires_at} > (clock_timestamp() AT TIME ZONE 'UTC')`);
  const lease = sql`(clock_timestamp() AT TIME ZONE 'UTC') + ${LEASE_MS} * interval '1 millisecond'`;
  return {
    async claim(id, token, retryFailed) {
      const [row] = await db.update(schema.liveFallbackPreparations).set({
        state: 'PROCESSING', claim_token: token, lease_expires_at: lease, failure_code: null, updated_at: new Date(),
      }).where(and(eq(schema.liveFallbackPreparations.id, id), or(
        inArray(schema.liveFallbackPreparations.state, retryFailed ? ['PENDING', 'FAILED'] : ['PENDING']),
        and(eq(schema.liveFallbackPreparations.state, 'PROCESSING'), lt(schema.liveFallbackPreparations.lease_expires_at, sql`(clock_timestamp() AT TIME ZONE 'UTC')`)),
      ))).returning();
      if (row) return { row, token };
      const [existing] = await db.select().from(schema.liveFallbackPreparations).where(eq(schema.liveFallbackPreparations.id, id));
      if (!existing) return { status: 'NOT_FOUND' };
      if (existing.state === 'READY') return { status: 'READY', manifest: existing.manifest as FrozenFallbackManifest };
      if (existing.state === 'FAILED') return { status: 'FAILED', failure_code: existing.failure_code ?? 'PREPARATION_FAILED' };
      return { status: existing.state === 'CANCELLED' ? 'CANCELLED' : 'BUSY' };
    },
    async renew(claim) {
      const rows = await db.update(schema.liveFallbackPreparations).set({ lease_expires_at: lease, updated_at: new Date() })
        .where(claimCondition(claim)).returning({ id: schema.liveFallbackPreparations.id });
      return rows.length === 1;
    },
    async preflight(claim) {
      await db.transaction(async tx => {
        const current = await collectLiveFallbackPreparationSource(claim.row.created_by, claim.row.presentation_id, tx);
        if (current.source_fingerprint !== claim.row.source_fingerprint) fail('FALLBACK_SOURCE_CHANGED');
        const [owned] = await tx.select({ id: schema.liveFallbackPreparations.id }).from(schema.liveFallbackPreparations)
          .where(claimCondition(claim)).for('share');
        if (!owned) fail('PREPARATION_CLAIM_LOST');
      });
    },
    async recordAsset(claim, asset) {
      return db.transaction(async tx => {
        const [current] = await tx.select({ id: schema.liveFallbackPreparations.id }).from(schema.liveFallbackPreparations)
          .where(claimCondition(claim)).for('update');
        if (!current) fail('PREPARATION_CLAIM_LOST');
        const descriptor = { bucket: asset.bucket, object_key: asset.object_key, sha256: asset.sha256, size: asset.size, content_type: asset.content_type };
        await tx.insert(schema.storageObjects).values(descriptor).onConflictDoNothing({ target: [schema.storageObjects.bucket, schema.storageObjects.object_key] });
        const [object] = await tx.select().from(schema.storageObjects).where(and(eq(schema.storageObjects.bucket, asset.bucket), eq(schema.storageObjects.object_key, asset.object_key))).for('share');
        if (!object || object.sha256 !== asset.sha256 || object.size !== asset.size || object.content_type !== asset.content_type) fail('CAS_STORAGE_METADATA_CONFLICT');
        const normalized = { ...asset, storage_object_id: object.id };
        const row = { preparation_id: claim.row.id, asset_id: asset.id, media_id: asset.media_id, storage_object_id: object.id,
          sha256: asset.sha256, size: asset.size, content_type: asset.content_type, render_type: asset.render_type,
          source_type: asset.source_type, status: asset.status, representation: asset.representation, dependencies: asset.dependencies ?? [],
          source_object_id: asset.source_object_id, source_sha256: asset.source_sha256, source_content_type: asset.source_content_type };
        // Only an unapproved PROCESSING preparation can change its partial rows.
        // Storage-object descriptors above are never blindly upserted/rewritten.
        await tx.insert(schema.liveFallbackPreparationAssets).values(row).onConflictDoUpdate({
          target: [schema.liveFallbackPreparationAssets.preparation_id, schema.liveFallbackPreparationAssets.asset_id], set: row,
        });
        return normalized;
      });
    },
    async finalize(claim, manifest) {
      await db.transaction(async tx => {
        // Identity/role/source locks precede the preparation lock, matching API
        // authorization order and avoiding a prep→identity inversion.
        const currentSource = await collectLiveFallbackPreparationSource(claim.row.created_by, claim.row.presentation_id, tx);
        if (currentSource.source_fingerprint !== claim.row.source_fingerprint) fail('FALLBACK_SOURCE_CHANGED');
        const [current] = await tx.select().from(schema.liveFallbackPreparations).where(claimCondition(claim)).for('update');
        if (!current) fail('PREPARATION_CLAIM_LOST');
        const rows = await tx.select().from(schema.liveFallbackPreparationAssets)
          .innerJoin(schema.storageObjects, eq(schema.liveFallbackPreparationAssets.storage_object_id, schema.storageObjects.id))
          .where(eq(schema.liveFallbackPreparationAssets.preparation_id, claim.row.id));
        const normalized: NormalizedFallbackAsset[] = rows.map(({ live_fallback_preparation_assets: asset, storage_objects: object }) => {
          if (asset.sha256 !== object.sha256 || asset.size !== object.size || asset.content_type !== object.content_type) fail('CAS_STORAGE_METADATA_CONFLICT');
          return { ...asset, id: asset.asset_id, bucket: object.bucket, object_key: object.object_key };
        });
        const validated = validateLiveFallbackManifest(manifest, { presentationId: claim.row.presentation_id, assets: normalized });
        const updated = await tx.update(schema.liveFallbackPreparations).set({ state: 'READY', manifest: validated,
          claim_token: null, lease_expires_at: null, failure_code: null, updated_at: new Date() }).where(claimCondition(claim))
          .returning({ id: schema.liveFallbackPreparations.id });
        if (!updated.length) fail('PREPARATION_CLAIM_LOST');
      });
    },
    async markFailed(claim, code) {
      const rows = await db.update(schema.liveFallbackPreparations).set({ state: 'FAILED', failure_code: code,
        claim_token: null, lease_expires_at: null, updated_at: new Date() }).where(claimCondition(claim))
        .returning({ id: schema.liveFallbackPreparations.id });
      return rows.length === 1;
    },
  };
}

async function downloadVerified(storage: LiveFallbackStorage, source: SourceAsset['object'], filePath: string, signal: AbortSignal): Promise<void> {
  const disk = await statfs(join(filePath, '..'));
  if (disk.bavail * disk.bsize < source.size) fail('FALLBACK_STAGING_CAPACITY');
  const input = await storage.open(source, signal);
  if ((input.size !== undefined && input.size !== source.size) || (input.contentType && input.contentType.toLowerCase() !== source.content_type)) {
    (input.body as { destroy?: () => void }).destroy?.();
    fail('FALLBACK_SOURCE_METADATA_CHANGED');
  }
  let size = 0;
  const hash = createHash('sha256');
  const measure = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    if (size > source.size) { callback(new LiveFallbackPreparationError('FALLBACK_SOURCE_SIZE_MISMATCH')); return; }
    hash.update(chunk); callback(null, chunk);
  } });
  await pipeline(Readable.from(input.body), measure, createWriteStream(filePath, { flags: 'wx', mode: 0o600 }), { signal });
  if (size !== source.size || hash.digest('hex') !== source.sha256) fail('FALLBACK_SOURCE_INTEGRITY_MISMATCH');
}

async function hashFile(filePath: string, signal: AbortSignal): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(filePath, { signal })) { assertActive(signal); size += chunk.length; hash.update(chunk); }
  if (!size) fail('FALLBACK_EMPTY_ARTIFACT');
  return { sha256: hash.digest('hex'), size };
}

async function verifyCas(storage: LiveFallbackStorage, asset: Pick<NormalizedFallbackAsset, 'bucket' | 'object_key' | 'sha256' | 'size' | 'content_type'>, signal: AbortSignal): Promise<void> {
  const input = await storage.open(asset, signal);
  if ((input.size !== undefined && input.size !== asset.size) || input.contentType?.toLowerCase() !== asset.content_type) {
    (input.body as { destroy?: () => void }).destroy?.();
    fail('CAS_OBJECT_CONFLICT');
  }
  let size = 0; const hash = createHash('sha256');
  for await (const chunk of input.body) {
    assertActive(signal); size += chunk.length;
    if (size > asset.size) fail('CAS_OBJECT_CONFLICT');
    hash.update(chunk);
  }
  if (size !== asset.size || hash.digest('hex') !== asset.sha256) fail('CAS_OBJECT_CONFLICT');
}

/** Durable asynchronous preparation. The job registry limits per-node concurrency
 * to one; conditional CAS publication also protects independent worker nodes. */
export async function processLiveFallbackPreparation(
  preparationId: string,
  options: { retryFailed?: boolean } = {},
  dependencies: LiveFallbackPreparationDependencies = {},
): Promise<PreparationResult> {
  const repository = dependencies.repository ?? createLiveFallbackPreparationRepository();
  const storage = dependencies.storage ?? createLiveFallbackStorage();
  const claimStarted = performance.now();
  const claimed = await repository.claim(preparationId, randomUUID(), options.retryFailed === true);
  if (!('token' in claimed)) return claimed;
  const claim = claimed;
  const abort = new AbortController();
  let stopped = false, claimLost = false, stage: string | undefined;
  let heartbeat: Promise<void> | undefined;
  let leaseTimer: ReturnType<typeof setTimeout> | undefined;
  const armLease = (started: number) => {
    if (leaseTimer) clearTimeout(leaseTimer);
    const remaining = started + LEASE_MS - performance.now();
    if (remaining <= 0) { claimLost = true; abort.abort(); return; }
    leaseTimer = setTimeout(() => { claimLost = true; abort.abort(); }, remaining);
    leaseTimer.unref();
  };
  armLease(claimStarted);
  const renewLease = async (): Promise<boolean> => {
    const started = performance.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const accepted = await Promise.race([
        repository.renew(claim),
        new Promise<false>(resolve => { timeout = setTimeout(() => resolve(false), 5000); timeout.unref(); }),
      ]);
      if (!accepted || abort.signal.aborted) { claimLost = true; abort.abort(); return false; }
      armLease(started); return true;
    } catch { claimLost = true; abort.abort(); return false; }
    finally { if (timeout) clearTimeout(timeout); }
  };
  const timer = setInterval(() => {
    if (stopped || heartbeat || abort.signal.aborted) return;
    const operation = renewLease().then(() => undefined).finally(() => { if (heartbeat === operation) heartbeat = undefined; });
    heartbeat = operation;
  }, RENEW_MS);
  timer.unref();
  try {
    assertActive(abort.signal);
    const source = claim.row.source_graph as LiveFallbackSourceGraph;
    if (!source || source.version !== 1 || source.presentation?.id !== claim.row.presentation_id ||
        liveSchedulingFingerprint(source) !== claim.row.source_fingerprint) fail('FALLBACK_SOURCE_GRAPH_INVALID');
    await repository.preflight(claim);
    assertActive(abort.signal);
    stage = await createPrivateStage(await privateStagingParent(dependencies.stagingParent), claim);
    const normalized: NormalizedFallbackAsset[] = [];
    for (const asset of source.assets) {
      assertActive(abort.signal);
      const inputPath = join(stage, `${randomUUID()}.input`);
      await downloadVerified(storage, asset.object, inputPath, abort.signal);
      let filePath = inputPath, contentType = asset.object.content_type, representation: string = asset.representation;
      if (/mpegurl/i.test(contentType)) {
        if (!dependencies.prepareHls) fail('HLS_PREPARATION_REQUIRED');
        const output = await dependencies.prepareHls({ asset, playlistPath: inputPath, stagingDir: stage, storage, signal: abort.signal });
        const stat = await lstat(output.filePath);
        const contained = relative(await realpath(stage), await realpath(output.filePath));
        if (!stat.isFile() || stat.isSymbolicLink() || !contained || contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained)) fail('HLS_PREPARATION_OUTPUT_INVALID');
        await chmod(output.filePath, 0o600);
        filePath = output.filePath; contentType = output.contentType; representation = output.representation;
      }
      const digest = await hashFile(filePath, abort.signal);
      const render_type = renderTypeFor(contentType);
      const descriptor: Omit<NormalizedFallbackAsset, 'storage_object_id'> = {
        id: asset.media_id, media_id: asset.media_id, status: 'READY', source_type: asset.source_type,
        bucket: dependencies.readyBucket ?? READY_BUCKET,
        object_key: `live-fallbacks/v1/sha256/${digest.sha256}.${liveFallbackMimeSuffix(contentType)}`,
        ...digest, content_type: contentType, render_type, representation, dependencies: [],
        source_object_id: asset.source_object?.storage_object_id ?? null,
        source_sha256: asset.source_object?.sha256 ?? null,
        source_content_type: asset.source_object?.content_type ?? null,
      };
      assertActive(abort.signal);
      for (let attempt = 0; ; attempt++) {
        try { await storage.putIfAbsent({ ...descriptor, filePath, contentType }, abort.signal); break; }
        catch (error) {
          if (!(error instanceof LiveFallbackPreparationError) || error.code !== 'CAS_WRITE_CONFLICT_RETRY' || attempt >= 2) throw error;
          await delay(50 * (attempt + 1), undefined, { signal: abort.signal });
        }
      }
      await verifyCas(storage, descriptor, abort.signal);
      assertActive(abort.signal);
      normalized.push(await repository.recordAsset(claim, descriptor));
      await rm(inputPath, { force: true });
      if (filePath !== inputPath) await rm(filePath, { force: true });
    }
    stopped = true; clearInterval(timer); await heartbeat; assertActive(abort.signal);
    // Renew immediately before the short final SQL transaction, after any last
    // timer callback, so expiry cannot silently revive an old claim.
    if (!(await renewLease())) fail('PREPARATION_CLAIM_LOST');
    const assets = normalized.map(({ status: _status, source_type: _sourceType, source_object_id: _sourceId,
      source_sha256: _sourceSha, source_content_type: _sourceMime, ...asset }) => ({
      ...asset, cache_key: canonicalLiveCacheKey(asset.sha256, asset.render_type),
    }));
    const manifest = validateLiveFallbackManifest({ version: 1, presentation: {
      ...source.presentation, items: source.presentation.items.map(({ media_id, ...entry }) => ({ ...entry, asset_id: media_id })),
    }, assets }, { presentationId: claim.row.presentation_id, assets: normalized });
    await repository.finalize(claim, manifest);
    return { status: 'READY', manifest };
  } catch (error) {
    stopped = true; clearInterval(timer); abort.abort(); await heartbeat;
    const cause = (error as { cause?: unknown })?.cause;
    const code = error instanceof LiveFallbackPreparationError ? error.code
      : cause instanceof LiveFallbackPreparationError ? cause.code
      : error instanceof AppError && [401, 403].includes(error.statusCode) ? 'FALLBACK_AUTHORIZATION_CHANGED'
      : error instanceof AppError && [404, 409, 422].includes(error.statusCode) ? 'FALLBACK_SOURCE_CHANGED'
      : (error as { code?: string })?.code === 'ENOSPC' ? 'FALLBACK_STAGING_CAPACITY' : 'FALLBACK_PREPARATION_IO_FAILED';
    if (claimLost || code === 'PREPARATION_CLAIM_LOST' || !(await repository.markFailed(claim, code))) return { status: 'CANCELLED' };
    return { status: 'FAILED', failure_code: code };
  } finally {
    stopped = true; clearInterval(timer);
    if (leaseTimer) clearTimeout(leaseTimer);
    if (stage) await rm(stage, { recursive: true, force: true });
  }
}
