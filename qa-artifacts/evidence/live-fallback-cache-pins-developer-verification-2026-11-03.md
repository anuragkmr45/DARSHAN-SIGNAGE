# Live fallback cache pins — developer verification, 2026-11-03

Scope: cache primitive only, on
`codex/live-screen-broadcast-planning-20261103`. This note does not close a live
broadcast implementation loop, independent QA case or release gate.

## Source and behavior

Changed `darshan-player/src/main/services/cache/cache-manager.ts` and its focused
unit tests. API and lifetime contract: `darshan-player/CACHE_PINS.md`.

The new owner is the immutable pair of published UUID and schedule-item UUID.
Its exact cached assets require approved SHA-256 checksums. Pins protect cached
fallback bytes independently from currently playing content and other owners.
Pin claims are synchronous before asynchronous verification/eviction can yield;
release and forced security purge fence late work. Missing, corrupt, changed,
unreadable and cancelled results do not authorize fallback playback. No remote
or older-revision substitute is returned.

Source review found no presentation item-count maximum in
`darshan-server/src/routes/presentations.ts` (`items: z.array(...)`). The primitive
therefore has no 256-asset restriction. Worker concurrency follows the existing
player prefetch policy (configured one through ten). The 64-owner guard is an
explicit internal leak/resource guard that rejects a new owner with
`PIN_OWNER_LIMIT`; it does not silently discard assets. Intended lifecycle
integration holds current/next occurrence owners and releases inactive owners.

## Executed focused validation

Node `v20.20.2`, `NODE_OPTIONS=--max-old-space-size=768`:

```bash
./node_modules/.bin/mocha --config .mocharc.json \
  --spec test/unit/services/cache-manager.test.ts
```

Result: **29 passing, 0 failing** (16 existing cases and 13 new pin cases), about
five seconds. Ignored sanitized command log:
`.local/live-broadcast/cache-pins-focused-20261103.txt` (mode `0600`).

The new cases verify:

- Union protection across LRU eviction, ordinary clear and now-playing changes.
- Overlapping owners and independent release/now-playing lifetimes.
- A claim made before verification and another made during a stale eviction list.
- Missing exact revision without substitution, corrupt bytes and symlink refusal.
- Release/forced purge while verification is pending and no pin resurrection.
- A released owner's late I/O failure after a fresh claim succeeds.
- All-pinned capacity refusal while preserving approved bytes.
- Pinned checksum overwrite refusal and conflicting/unsafe input errors.
- Deduplication without empty owner leakage and explicit owner guard recovery.
- Verification/protection of **all 257** approved local files.

`git diff --check -- darshan-player` also passed at this development checkpoint.

After the cache source stabilized, the following ran sequentially with the same
Node and heap limit and passed:

| Check | Result | Duration |
| --- | --- | --- |
| `tsc -p tsconfig.main.json --noEmit` | Exit 0 | 6.4 s |
| `tsc -p tsconfig.renderer.json --noEmit` | Exit 0 | 4.4 s |
| `npm run build` | Exit 0 | 15.0 s |

Private ignored logs use
`.local/live-broadcast/cache-foundation-{main-types,renderer-types,build}-20261103.txt`
(each mode `0600`). No package rebuild, process restart or running-player change
was made for these checks.

## Stable-packet player regression

After the combined server/cache foundation stabilized, all three player suites
ran sequentially with Node `v20.20.2` and heap limit 768 MiB. Available host memory
was checked before each suite (1,921 / 2,006 / 1,952 MiB respectively, above the
800 MiB start gate). No player source changed during the run.

| Command | Result | Duration |
| --- | --- | --- |
| `npm run test:unit` | **428 passing, 0 failing**, exit 0 | 129.9 s |
| `npm run test:integration` | **5 passing, 0 failing**, exit 0 | 6.9 s |
| `npm run test:fault` | **21 passing, 0 failing**, exit 0 | 6.4 s |

Private bounded/sanitized logs:
`.local/live-broadcast/cache-foundation-{unit,integration,fault}-20261103.txt`;
machine-readable summary:
`.local/live-broadcast/cache-foundation-packet-summary-20261103.json`. All are
mode `0600`. The cache-manager source SHA-256, measured before and after the run,
was unchanged:
`e4c47c0182df2b619d7cc08c22c468cc66da36a2a19f8b6bf932fdb0f9a8b907`.

## Remaining validation

The cache API is not yet called by a live coordinator, schedule flow or renderer.
No live capability is advertised. The current cache source passed the focused
and complete player checks recorded above. Those checks establish regression
coverage of the primitive and existing player paths; they do not establish an
integrated live coordinator or complete broadcast user journey.

Actual same-player playback under cache pressure, fallback presentation/PDF/video
dependencies, release on schedule replacement/emergency/security transitions,
restart reconstruction and Content unavailable pixels remain integrated runtime
checks. This focused test pass does not establish those user journeys or
production readiness. No QA-owned result/status fields or the main live
developer ledger were changed by this cache packet.
