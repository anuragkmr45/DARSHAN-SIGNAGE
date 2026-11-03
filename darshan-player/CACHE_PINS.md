# Published-occurrence cache pins and exact artifact repair

This is a cache service primitive for the planned live fallback coordinator. It
is not yet connected to schedule selection, live rendering or capability
advertisement. Ordinary player playback continues to use its existing
`markNowPlaying`, `unmarkNowPlaying` and `replaceNowPlaying` methods.

## Contract

`pinPublishedOccurrence({ publishId, scheduleItemId }, assets)` synchronously
protects the requested exact cache keys before starting asynchronous local-file
verification. Each asset is `{ cacheKey, sha256 }`; the checksum must be the
approved SHA-256 of the bytes stored at that key. The returned promise contains
`{ ready, assets }`, where each asset has a status and a `localPath` only when
`READY`. The method does not download anything, resolve a remote URL, select an
older revision or substitute ordinary default content.

`ready` is true only when every unique requested asset is a regular local file
inside the cache directory, still points to the same indexed file after reading,
and passes a streamed SHA-256 check. Statuses are `READY`, `MISSING`, `CORRUPT`,
`UNREADABLE`, `CHANGED` and `CANCELLED`. Non-ready assets lose pin protection; an
owner with no protected assets is removed after verification. Partial readiness
keeps the verified subset protected, but does not authorize playback of the
complete fallback. Callers must require `ready: true` and retain their own
published-occurrence/generation fence before using the result.

The owner IDs must be UUIDs. Cache keys must use the cache's canonical safe
filename form (for example a media UUID or its `.__revision__.` key); path
aliases, traversal and invalid checksums throw a `CacheError`. A claim is
immutable until released. Identical duplicate assets are deduplicated, and an
identical pending claim returns the same promise. Conflicting checksums or a
changed asset set for a retained owner are rejected with typed error reasons.

The existing presentation schema has no item-count ceiling. Pins therefore do
not impose an asset-count limit or truncate the supplied set. Verification uses
at most the existing configured prefetch concurrency (maximum ten streams).
There is an internal guard of 64 retained/in-flight owners: a leaking caller
receives `PIN_OWNER_LIMIT` and must release inactive owners. This is not a
scheduling limit; the intended coordinator holds the current and next published
occurrence. Missing/corrupt-only claims do not permanently consume owner slots.

## Lifetime and eviction

`releasePublishedOccurrence(owner)` synchronously releases only that owner's
pins. Other owners of the same asset and ordinary now-playing protection remain
effective. A late verification result/error cannot recreate a released owner or
remove a fresh replacement claim.

Ordinary cache clearing and LRU eviction protect the union of now-playing keys
and published pins, including claims whose verification is in flight. Eviction
rechecks each candidate immediately before removal. A pinned key cannot be
overwritten with a different checksum. If all available content is protected,
the existing add path returns `INSUFFICIENT_SPACE` rather than deleting an
approved fallback.

`clear(true)` invalidates pending writes, cancels approved transfers, and clears
all owner pins and now-playing protection. Pending verification returns
cancelled readiness and cannot resurrect pins. The existing security flow may
also call `invalidatePendingWrites()` before its forced purge.

Pins exist only in memory. After restart, the future coordinator must reconstruct
the approved asset set from its immutable snapshot and verify it again. A ready
result is evidence at verification time; external disk changes can still make
files unavailable, so rendering needs its normal failure path and Content
unavailable behavior. Pin readiness alone is not publish acknowledgement or
proof-of-play.

## Exact immutable asset preparation

```ts
await cache.ensureApprovedAsset(
  { publishId, scheduleItemId },
  { cache_key, sha256, size, content_type },
  downloadUrl, // optional when the exact asset already exists locally
  { signal, totalTimeoutMs: 600_000, idleTimeoutMs: 30_000 },
)
// Resolves to { cacheKey, localPath }; otherwise throws a typed CacheError.
```

This API accepts only canonical approved `live_<sha256>_<render-type>` keys.
The current prepared formats are JPEG/PNG/WebP images, MP4/QuickTime/WebM video,
and PDF. HLS sources must have their verified MP4 side artifact prepared before
approval; this API does not make a playlist or its remote dependencies playable.
Converted documents use their approved final PDF bytes. Business `media_id`
remains separate from the content cache key and belongs in the future
coordinator's playback/PoP mapping.

Every local hit is checked against actual size and streamed SHA-256, with file
identity checked before and after reading. An indexed checksum alone cannot
prove readiness. Missing or corrupted exact content can be repaired from the
supplied URL, including corruption whose indexed SHA still matches the
manifest. A valid local asset succeeds without a URL or an available object
store. The API never resolves an older revision, substitutes the raw upload,
or returns a remote URL as a local-ready result.

A repair serializes with ordinary writes and filename normalization for the
same key. It keeps the previous file until the new body has passed exact size,
SHA and HTTP representation checks, flushes the private staged file, then
atomically replaces the expected unchanged entry. A newer entry or changed
path cancels the old publication. Independent owners retain their protection;
releasing one owner cannot release another owner's verified asset. Conflicting
descriptors for an already claimed key fail before disturbing that claim.

A successful preparation retains that owner's exact-asset protection until
`releasePublishedOccurrence(owner)`. Partial preparation does not prove that a
complete presentation is ready: the consumer must still verify/pin every
manifest dependency and fence the published occurrence before playback.
Failed or cancelled requests leave no missing-asset owner residue. Consumers
must release owners when resetting identity. Owner release, forced purge and
caller cancellation prevent late writes from publishing or restoring a
released claim. Queued requests cancel promptly;
active requests finish stream and stage cleanup before returning cancellation.

Transfers and validation use the configured prefetch concurrency, capped at
ten active operations. Bodies stream through 64 KiB file buffers instead of
being accumulated as a complete in-memory file. A monotonic total deadline
includes queueing, local verification, transfer and publication: its default is
ten minutes and its maximum is thirty minutes. A separate HTTP progress-idle
deadline defaults to thirty seconds, with that same thirty-second maximum.
Both options require positive integers and can be shortened by callers.
Only completed response headers and nonempty body chunks reset idle time; a
progressing large approved artifact can take longer than thirty seconds. The
idle timer ends when the body pipeline finishes, while the total fence remains
through publication. Valid local content does not start a network idle timer.
Caller/window cancellation, owner release and security purge still take
precedence. These artifact budgets do not extend a live admission lease. The
general media `add()` API retains its existing buffered download behavior.

Capacity checks reserve each repair's committed-size delta and protect all
current owners/now-playing keys during eviction. Disk preflight also accounts
for outstanding physical staging bytes from concurrent repairs. Capacity,
short/truncated/oversized bodies, wrong SHA/MIME, HTTP encoding/redirects,
interruption and disk failures do not publish a partial asset. Error details
contain safe reason codes and the cache key, without transport credentials.
The future consumer must refresh expired download URLs and report failures
using the business media ID; this primitive does not send publish success or
live-playback observations.

## Staging initialization and crash recovery

Approved transfers use a private marked UUID directory on the cache volume.
Initialization flushes its ownership marker before publishing the canonical
`.approved-staging-owner.json` marker through an exclusive hard link. The
canonical marker and the selected root marker must identify the same file.
This avoids overwriting an existing empty directory under differing POSIX and
Windows directory-rename rules. Concurrent initializers use the already
published valid winner. An interrupted unpublished initialization does not
prevent creating a new root.

The marker and internal candidate directories are excluded from ordinary media
indexing, prefix lookup, cache accounting and LRU/ordinary clearing, including
case variants. An unknown existing canonical marker is preserved and rejected.
A filesystem without the required hard-link support fails with
`APPROVED_STAGE_PUBLISH_UNSUPPORTED`; it does not adopt unknown directories.
POSIX owner/mode checks and directory flushes are conditional on platform
support. Actual Windows/NTFS permissions and runtime behavior remain a release
QA check.

`reconcileApprovedStages()` runs at cache initialization and before a new
repair. It examines at most 100 candidates and removes at most 20 per pass.
Only explicitly marked owned service directories, at least five minutes old,
can be reclaimed after confirming the creating process is dead or its matching
in-process operation is inactive. Markers are bounded reads;
directory/file identities are rechecked before quarantine and removal. Live or
unknown process probes, unmarked/unknown content, unexpected child files,
symlinks, unsafe ownership/modes and changed paths are preserved. Known
abandoned initialization candidates can also be reclaimed. No directory is
removed merely because its name has a prefix.

Normal clearing preserves active approved claims. Forced security clearing
still takes precedence over artifacts, staging and all ownership metadata.
These primitives remain unconnected to the normal live coordinator and do not
enable or advertise `live_broadcast_v1`.

## Focused developer check

```bash
NODE_OPTIONS=--max-old-space-size=768 ./node_modules/.bin/mocha \
  --config .mocharc.json --spec test/unit/services/cache-manager.test.ts \
  --spec test/unit/services/approved-cache-asset.test.ts
```

Run with the repository's installed Node 20. The focused tests use real temporary
cache files, real loopback HTTP streams, crash-stage recovery, and deterministic
asynchronous eviction/release races. An isolated temporary cache has also been
checked against the dedicated local MinIO service; that is developer service
verification, without restarting or exercising the normal paired Electron app.
The integrated same-player live/fallback lifecycle, actual cache-full playback
and packet-level build/regression checks remain separate gates.
