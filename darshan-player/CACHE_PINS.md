# Published-occurrence cache pins

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

`clear(true)` overrides and clears all owner pins and now-playing protection.
Pending verification returns cancelled readiness and cannot resurrect pins.
The existing security flow must continue to invalidate pending cache writes
with `invalidatePendingWrites()` before its forced purge.

Pins exist only in memory. After restart, the future coordinator must reconstruct
the approved asset set from its immutable snapshot and verify it again. A ready
result is evidence at verification time; external disk changes can still make
files unavailable, so rendering needs its normal failure path and Content
unavailable behavior. Pin readiness alone is not publish acknowledgement or
proof-of-play.

## Focused developer check

```bash
NODE_OPTIONS=--max-old-space-size=768 ./node_modules/.bin/mocha \
  --config .mocharc.json --spec test/unit/services/cache-manager.test.ts
```

Run with the repository's installed Node 20. The focused tests use real temporary
cache files and deterministic asynchronous eviction/release races. The integrated
same-player live/fallback lifecycle, actual cache-full playback and packet-level
build/regression checks remain separate gates.
