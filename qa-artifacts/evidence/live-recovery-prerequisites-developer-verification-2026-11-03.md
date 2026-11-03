# Live recovery prerequisites developer verification — 2026-11-03

Status: **DEVELOPER PREREQUISITES VERIFIED — COMPLETE FEATURE AND RELEASE GATES OPEN.**
This is a separate packet after source `8041a50` and its QA binding `d611bb6`.
It does not replace or rewrite the
[publication report](live-publication-authorization-developer-verification-2026-11-03.md).
Prerequisite source checkpoint: `e54663079dc20668266769bd7f1c2455aedb348a`
on `codex/live-screen-broadcast-planning-20261103`. Builds and isolated results
below are bound to that source; no production release artifact is claimed.
No full live feature, beta gate or independent human acceptance is claimed.

## Server: presenter eligibility before approval

The schedule preparation path now evaluates the assigned presenter's current
record-bound `publish LiveBroadcast` permission on the actual source. Active
account, role and required source-department membership remain necessary.
Current inherited/conditional grants are evaluated under the existing shared
role graph and sorted actor/presenter identity locks; membership alone does not
grant source control.

Source CRUD can still create a draft intended for future permission assignment.
Preflight, approval and publication refuse a source whose presenter is currently
unable to broadcast it. This prevents reserving an already unstartable policy;
it does **not** implement start/admission permission renewal. That remains a
separate production authority requirement.

Fresh preflight reports `422 LIVE_PRESENTER_UNAVAILABLE`. A previously reviewed
direct publish or request approve/publish reports the existing stable
`409 LIVE_APPROVAL_STALE` with reason `LIVE_PRESENTER_UNAVAILABLE`. The first
new test incorrectly expected the fresh-preflight status at the reviewed path;
its assertion was corrected to this existing contract. Production rejection
was not weakened. Root reports the final publishing suite **20/20 PASS**,
including revoked/foreign conditional grants and inherited eligible grants.

## Server: opaque desired live version prerequisite

Migration `0059_device_desired_live_version.sql` adds nullable text
`live_version` to current desired state and desired-state history only.
SHA-256:
`234026913c111001383406f93f827a81a2f927b0491f1db6565e69bd607fbd77`.
Existing rows remain null; no historical live authority is invented or
backfilled. Root applied the canonical migration only to the isolated feature
test database after the clean server build, with no adoption/unmanaged gap and
no pending migration. This is not production rollout evidence.

- Internal command input `desiredLiveVersion` and the direct writer's
  `liveVersion` accept an opaque string or null. Omission/undefined preserves
  the current value atomically in both bulk and sequential SQL upserts;
  explicit null clears it. Existing command/state counters retain their normal
  command semantics.
- History captures the **resulting current value**, including ordinary writes
  which preserve an earlier live version. Explicit-only outbox/metadata hints
  preserve durable notification semantics without changing ordinary command
  payload shape or adding a per-command live column.
- Device desired-state REST and CMS delivery-state projections expose the
  nullable field; the CMS API type is optional for compatibility. The current
  ordinary-player decoder ignores additional response fields. No public live
  setter, run/admission API or player capability is enabled by this change.
- A concrete bulk duplicate-screen defect was corrected: inserted commands
  previously matched input by screen ID, selecting the last input for every
  duplicate. Internal generated command UUIDs now correlate each inserted row
  to its own input, preserving input order and correctly skipping idempotency
  conflicts. A retry cannot reapply an old live version.
- Command insertion, bulk upserts and mixed/duplicate fallback acquire screens
  in a canonical order while preserving each screen's input order and the
  returned command order. Physical command INSERT also orders idempotency keys
  within a screen, independently of logical command order, using binary rather
  than locale comparison. UUID letter case is normalized before selecting the
  duplicate-screen fallback.

The first focused DB loop caught a Drizzle encoding error from using a raw
Column object as an update value. Both preserve expressions were corrected to
explicit SQL column expressions. The first full build then caught UUID-template
inference on the command-input Map; an explicit `Map<string, ...>` fixed that
type error. Neither failed check was accepted as a pass; root's subsequent
clean server build passed before restarting the own API/worker.

A subsequent adversarial review found another real lock cycle: two
duplicate-screen batches with keys A→B and B→A could deadlock in the unique
index before desired-state upserts. An owned-DB AFTER INSERT/advisory barrier
reproduced PostgreSQL `40P01`. A second real reproduction used upper/lowercase
forms of the same valid screen UUID and raised `21000` because duplicate
detection selected a bulk upsert against the same row twice. Neither failure
was dismissed as a timing/flaky-test issue.

The physical key sort and UUID normalization above fixed both. The final
focused desired-state file passed **12/12** (2.616s; 7.46s total), including
deterministic ASCII and Unicode swapped-key races, exact winning logical
history and case-equivalent screen IDs. The final combined neighbor run below
includes both fixes and two additional real HTTP caller regressions. Root reports
the final clean server build **PASS** on the same current source that passed
all 14 desired-state and 20 publishing cases. Only the isolated own API/worker were
protected during build/restart; the stop/build/start interval was 75.5s. The prior
compiled backup was preserved and was not needed. Both restarted services passed
all six readiness checks. No production service was restarted by this packet.

## Server verification

[Sanitized server regression summary](runtime-live-2026-11-03/live-recovery-prerequisites-server-results.json)
records **32/32 PASS across 3 files**, including the 14 desired-state/HTTP
cases, 13 command-route neighbors and 5 playback-refresh dispatch neighbors.
Vitest took 12.02s; wrapper wall time was 12.674s. Node 20.20.2, one worker/768 MiB and
host TZ Asia/Kolkata were used.
This supersedes the earlier passing 27-case neighbor packet; those are not
additional unique cases.

A fresh schema-only owned database was verified empty, and only its migration
shape was used for broad neighbors. The new 14-case suite separately rebuilt
the pre-0059 shape in its own empty database before applying 0059. Both owned
databases closed their connections and were dropped without FORCE. No feature
database data was written by this regression.

The new cases include sequential → bulk → sequential preservation, explicit
clear, mixed modes, duplicate screen inputs, ignored idempotency replay,
genuine concurrent lock contention and opposite batch orders, current history,
and actual signed RSA device REST/CMS projection. Public command caller
regressions additionally prove conditional own-screen 201/foreign 403 before
command/history/outbox/state writes, omitted PING preservation of all four
versions, and snapshot-only updates. A forged public live-version property
cannot reach the internal setter. Only CMS token decoding and
unrelated socket setup are replaced in the focused HTTP fixture; device
signature verification and all desired-state SQL decisions remain real.
Focused service/test lint and diff checks passed.

The command route corrections bind update permission to the loaded Screen and
preserve omitted ordinary desired fields instead of converting them to null.
They do not introduce a public live setter or widen grants.

## Repeated actual API/worker/MinIO publication check

After the final clean build, canonical 0059, presenter-permission check and
command-caller/bulk-order corrections, the guarded publication verifier reran
on newly named, unpaired synthetic fixtures. Final run
`b1c6053e-519f-4659-9f23-88dd8bfe11f8` passed **55 supporting checks / 15
SHA-verified downloads**, exit 0, from `2026-11-03T02:14:34.383Z` to
`02:14:48.472Z` (14.089s). This is the final-source repeat; prior intermediate
55-check repeats are not additional unique cases.
Image/PDF/video downloads totaled 1,366,995 bytes for these small fixed fixtures.

[Sanitized repeat-run results](runtime-live-2026-11-03/live-recovery-prerequisites-publication-runtime-results.json)
SHA-256:
`38038a13cdf92a70efc5f8754eb30169507f322c4d6a8e0bd4299747b69ac050`.

The run retained frozen authored-group and concrete-screen audiences after
membership replacement, checked unchanged records after deletion rejection,
completed request phases/idempotent retries and downloaded the approved CAS
bytes. Its three publications were taken down; both reservation graphs became
RELEASED, history remained and only its own login session was revoked. The real
paired player and prior fixture identities were excluded.

The repeat demonstrates that the rebuilt running server still supports the
bounded publication path. Non-null live-version writes/clear and history
semantics were exercised on test-owned DB fixtures, not through a new public
running-service setter. No player update, transient player lock, admitted live
run, rendering, audio or physical-display behavior is claimed by this run.

## Media: fresh authority and teardown prerequisite

The media controller now has an injectable strict-authority path. It requires a
fresh nonce-bound response with boolean `allowed: true`, canonical identity/role/
audio, node instance, external epoch, generation and operation revision. Missing
or non-boolean decisions cannot allocate, extend or rotate authority. Identity
and revision are reserved before awaiting the check; tombstones and fences are
rechecked after it. Unknown admission/run stops fence pending or later creates,
and old cleanup cannot remove a replacement. Logical REVOKED state alone does
not confirm teardown or free occupied capacity.

The authority deadline is anchored before the fresh check, so network/check
latency consumes the lease. The strict callback is injected by the test fixture;
**no production Backend verifier or durable run/outbox is implemented here**.
The ordinary media entrypoint remains prototype mode and refuses a requested
non-prototype authority mode before opening listeners. Current code details and
limits are in [strict media authority](../../darshan-media/STRICT_AUTHORITY.md).

Root records the final media packet as **96 PASS / 1 opt-in SKIPPED**, with the
opt-in actual-SFU protocol case subsequently enabled and passed separately.
These are separate execution modes of that case, not an extra unique scenario.
The [sanitized actual-SFU result](runtime-live-2026-11-03/live-recovery-prerequisites-media-runtime-results.json)
passed with:

- Real SFU/RPC/signaling and injected loopback HTTP authority: canonical presenter/
  receiver permissions, removal, unknown-stop tombstones, old-stop/replacement
  fencing and stopping a pending check.
- A delayed check measured 609ms and left 9395ms of lease; the response did not
  receive a fresh ten seconds from arrival.
- A healthy local Docker-daemon watchdog observed actual SFU death within a
  measured **1933ms upper bound**, below the fixture's 3000ms enforcement bound.
  This establishes that tested actuation path, not direct host pidfd permission.
- Listener readiness pins child start time, network namespace, private listening
  sockets and their child-owned file descriptors. A foreign listener cannot
  establish readiness or make unrelated-child termination count as isolation.
  The actual runtime used UID 1000 and passed the `/proc` ownership guard.

Two earlier opt-in attempts failed because the test image overlay did not give
the runtime user the required file ownership. They remain failed attempts;
`COPY --chown` corrected the fixture, and the successful UID/proc runtime above
is the accepted evidence. No permission bypass was accepted.

Image: `sha256:5e3128017bca2f98f6b72ad72834166da448df72cfff0d66efa590e9c0c98f63`.
This was an offline developer source/test overlay, not the final deployment
image. Core source digest:
`46ade1876845fc3cf2c7c39f863b0a5db44b876d51505c1fd56be76a3589f6d2`.
Node 20.20.2 and LiveKit server SDK 2.19.2 were inspected inside the image.
The copied result SHA-256 is
`2363d6b097e6c3ce53157a60936d9e357649ca11c3db3a2e47c112e649b8ccf0`.

Direct host pidfd/AppArmor actuation in the production service context remains
**OPEN**. No production Backend, WebRTC frame, physical audio, browser capture
or display claim follows from this protocol/process-death run. The owned media
test containers and private temporary directories were removed; three developer
test images were retained. Existing isolated service fixtures/history remain.

## Player: immutable approved-asset cache prerequisite

`ensureApprovedAsset` now streams and verifies the exact frozen descriptor into
private staging, then atomically publishes it only while the owner, operation,
expected entry and cancellation fences remain current. It repairs corrupt bytes
or stale metadata even when the expected SHA is unchanged. A verified local
asset needs no download URL. Independent occurrence owners keep their own
protection; releasing one cannot release another. Security purge and explicit
cancellation take precedence over late writes. This primitive does not send
publish success, live observations or proof-of-play.

Transfers/validation are bounded by existing prefetch concurrency, capped at ten
active streams with 64KiB buffers. The separate monotonic total budget defaults
to ten minutes and is capped at thirty; network progress-idle is bounded at
thirty seconds. Progressing large artifacts are not rejected merely for taking
more than thirty seconds. Queue/hash/transfer/publication remain inside the
total deadline; these budgets never extend live authority. Capacity accounts
for outstanding physical staging and protects current owners/now-playing keys.

Marked staging initialization uses a flushed private ownership marker and
exclusive hard-link publication. Unknown existing pointers/content are preserved
and rejected. Bounded recovery handles only known inactive claims after its
grace period, with process/path/ownership checks; it does not delete directories
by prefix. Unsupported hard-link filesystems fail closed. Actual Windows/NTFS
behavior remains a QA gate. See [cache contract](../../darshan-player/CACHE_PINS.md).

[Sanitized cache results](runtime-live-2026-11-03/live-recovery-prerequisites-cache-results.json)
record the final current-source packet:

| Check | Result |
| --- | --- |
| Focused exact-asset/cache regressions | 65 PASS: 36 new real HTTP/temp-directory cases and 29 existing cache cases |
| Full player units | 464 PASS |
| Integration | 5 PASS |
| Fault injection | 21 PASS |
| Main no-emit, full player build, changed-file lint and diff checks | PASS |

The first full unit attempt was **457 PASS / 3 FAIL**, from two fixture umask
assumptions and an outdated exact purge-count assertion. The harness used normal
022 fixture umask, while logs remained private; the assertion now verifies that
invalidation precedes the first forced purge and permits repeated purge calls.
The three failures passed their focused rerun. An intermediate 460-pass unit run
preceded the separate idle/total change; **464** is the final current-source count.
Earlier attempts are retained as provenance, not summed into the final count.

The exact-source dedicated MinIO check transferred a 104-byte fixture and
verified SHA `76cd2c2c40b45c0d5f5f145c286c20a8a541133d419034b2a3dad827a46b40b9`.
It passed exact download, same-SHA corrupt-metadata repair, local use without a
URL, independent-owner protection and release allowing eviction. The synthetic
object was retained. The normal paired Electron app/profile was not touched;
there is no newly packaged player, normal-player live coordinator/capability,
Windows or actual cache-full display journey claim.

Cache source SHA-256:
`5b873c7694e245440afa848b71c3abc0c6409a1d888f94c153723a2d7a2f92fd`.
The copied result SHA-256 is
`72146e77168c29ca04078e85ec8ba8376b2488dffc0b1e24e33ba2f8cd90412c`.
Its `committed: false` field describes collection before the source commit;
the build binding independently verifies all four recorded source hashes
against the committed `e546630` files.

## Source/build and catalog binding

The [prerequisite build manifest](runtime-live-2026-11-03/live-recovery-prerequisites-build-binding.json)
binds source `e54663079dc20668266769bd7f1c2455aedb348a`, the developer outputs below,
the actual media image/core/package hashes and all copied result hashes. Each
tree hashes sorted POSIX relative path, NUL, decimal size, NUL, lowercase file
SHA-256 and LF for every included file; then SHA-256 of the concatenation.
Per-file rows and exclusions are explicit in the manifest.

| Developer output | Files / bytes | Tree SHA-256 |
| --- | --- | --- |
| Server `dist` JavaScript | 338 / 3,577,043 | `ebc2912cc022a6dc6ab81273e913422bba6d265222fb794a382fd1b21c7620ec` |
| Ordinary player `dist/main` compiled output | 60 / 818,744 | `7ef5b6e9004ee116d3c18f2c4532f0013f434a25d15d2de2c2e2b3a207b3495e` |
| Ordinary player `dist/renderer` JS/MJS/HTML/CSS | 29 / 3,828,910 | `93fcd07b92b9a4fdf10f375cd975f959e5966f514840cdda4019221543067aac` |
| CMS `dist` HTML/CSS/JavaScript | 91 / 1,899,093 | `69fa9ae61d6952d91c0743fa98a36523b0591b485d2e757c724b90623ba768f2` |

Player roots follow the actual main/renderer TypeScript and ordinary bundle/copy
configuration; development-only `live-prototype` paths and the older prototype
ASAR are excluded. Runtime config, private env/credentials, source maps,
declarations, static images/fonts/icons, binaries/installers and TGZs are not
hashed. Server hashes cover compiled secret-handling **code**, never runtime
secret values. The CMS change in this packet is an optional response type only;
its unchanged compiled tree equals the verified `8041a50` tree. This is not a
new CMS browser/build test or a source-free/offline release artifact.

Manifest SHA-256:
`0f1f55c5f21759a730def5335285a1d9d4d871aa4ac82c2caee43d38fbb885ab`.

[Catalog integrity](runtime-live-2026-11-03/live-recovery-prerequisites-qa-catalog-integrity.json)
rechecked **150 cases / 51 risks / 152 traceability rows**, 114 P0 / 35 P1 / 1 P2,
120 Not Tested / 30 Partially Tested. All expected results and risk/test links
remain valid, including expanded ID ranges. All three CSVs are byte-identical
to the source checkpoint. All twenty human LIVE cases remain Not Tested with
empty QA-owned execution/result/defect fields.

## Acceptance boundary

Production scheduled run/admission/epoch authority, complete same-player live
coordination/rendering and fallback pin consumption, presenter capture controls,
the full CMS publishing workflow, external pidfd/AppArmor enforcement and offline
release artifacts remain open. Prerequisite validation does not close any full
implementation loop or establish 250-player capacity, native capture/audio,
whole-machine suspension, restore/epoch behavior or independent business sign-off.
All human `LIVE-01..20` statuses and QA-owned result fields are unchanged.
