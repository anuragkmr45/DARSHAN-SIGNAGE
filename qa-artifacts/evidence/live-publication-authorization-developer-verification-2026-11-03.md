# Live publication and authorization developer verification — 2026-11-03

Status: **PARTIAL IMPLEMENTATION VERIFIED; FEATURE AND HUMAN QA OPEN.**
This report supersedes the earlier foundation-only publication status for its
stated scope. It does not close any `LIVE-01..20` human case or declare beta/
production readiness.

## Source and environment

- Repository/branch: `DARSHAN-SIGNAGE`,
  `codex/live-screen-broadcast-planning-20261103`.
- Source packet: `8041a509fea6af5421c9f6d150eee8975585b354`
  (`feat(live): publish frozen audiences and add CMS source authoring`), following
  foundation `339954b`. This commit binds the server/CMS/verifier source and
  contract/plan; ongoing player work was excluded. It is not an updated deployed
  release artifact.
- Isolated API/CMS/worker, PostgreSQL test database, MinIO and private fixture
  inputs were used on this limited-resource Linux host. The supporting verifier
  accepts only its fixed loopback API, dedicated `darshan_live_20261103_test`
  database and isolated MinIO; configuration/credentials stay private.
- Node `20.20.2`; builds and focused database checks ran sequentially. Temporary
  test databases/schemas belonged to their suites. No production database was
  migrated or cleaned by these checks.
- The real paired baseline player was excluded from this publication run.
  Two new, unpaired OFFLINE screens explicitly advertise test capabilities;
  they establish server publication behavior, not installed-player support.

## Implemented packet

- Live preflight returns the current frozen policy/fingerprint. Direct LIVE
  publication requires reviewed fingerprint/preparation IDs; request creation
  stores strict versioned approval metadata and rechecks it at approve/publish.
  Snapshots, screen reservations and logical broadcast reservations commit
  together; missing/incomplete/failing callbacks roll back all writes.
- Frozen policy includes concrete per-item audience and authored/explicit group
  provenance. Authored live groups receive immutable group PublishTargets even
  when the publish body omits explicit groups. Changed group membership cannot
  add recipients or remove the original frozen screen audience.
- Request publication retries retain the existing publication after source or
  mutable draft changes, including ordinary reservation-history cleanup.
  Source audio/presenter policy edits apply to future approval, not existing
  approved policy. These are publication semantics, not run admission controls.
- Record-bound Schedule/Request GET and SQL list/count/summary authorization
  preserves current inherited/conditional grants and inversion priority.
  Conditional management cannot become global department access; unsupported
  condition shapes deny. Manual target updates authorize the actual Schedule.
- Screen/Group CMS reads are authorized before artifact signing. Genuine
  device-signature access retains its identity path. Normalized active live
  references protect deleted/changed draft dependencies and frozen audiences;
  stale/released request or publish history does not become a permanent blocker.
- Signed artifact URLs are response-only. Current frozen asset rows and CAS
  bytes, rather than mutable Media delivery rows, supply approved downloads.
  Cache/ETag revisions account for dynamic delivery state. Host-IST raw Date
  comparisons now bind explicit UTC instants for active-reference checks.
- CMS source authoring exposes current presenters, optional audio policy,
  availability semantics, reload/retry and revision conflicts. Cross-account
  pending GET reuse is fenced by a session epoch. The scheduled publishing
  wizard and presenter/capture controls remain unfinished.

## Automated developer checks

Counts are suite-specific and must not be added as unique product scenarios.
Earlier source/fallback/capacity evidence remains in the
[foundation ledger](live-broadcast-developer-verification-2026-11-03.md).

| Check | Recorded result and scope |
| --- | --- |
| Final server TypeScript/build | PASS; root restarted the isolated API/worker and readiness returned six healthy checks |
| Final current-source focused packet | Root reports 62/62 PASS across 4 files: LiveSession ACL (20), LivePublishing (18), LiveAuthoring (7) and frozen reader (17); Node 20 / TZ Asia/Kolkata; supersedes the earlier partial 25/20/17 reruns |
| Screen lifecycle dry run | Root reports 12/12 PASS after correcting test-fixture permissions; this was a fixture defect, not a product permission relaxation |
| Final CMS unit suite | Root reports 182/182 PASS across 29 files, 28.34s, after the final copy/error handling fixes |
| Final CMS production build/bundle budget | Root reports PASS in 22.61s; bundle 219.3 KiB / 69.4 KiB gzip |
| Broader affected server regression | Root reports 52/52 PASS across 8 files, 71.25s, on a fresh owned database removed after completion |
| Catalog integrity | PASS: 150 cases / 51 risks / 152 traceability rows; all IDs/references resolve and QA-owned fields are unchanged |

Database tests cover stale direct review, same-count group replacement,
changed fallback/capability, strict stored-policy integrity, callback rollback,
opposite actor/presenter lock order, presenter replacement while waiting for a
target lock, account deactivation winning its identity lock, conditional reads,
foreign-department isolation and unchanged unauthorized delivery targets.
JWT decoding and postcommit dispatch are substituted only where stated in the
tests; those suite results do not constitute real browser/player journeys.

## Actual running-service evidence

[Sanitized publication results](runtime-live-2026-11-03/live-publication-runtime-results.json)
SHA-256: `2aa48e9b9e6d439812a218f3fce512ae5d2dcb3ef69f046cbc8b857a93f68395`.

The guarded `scripts/qa/live-publication-evidence.mjs` ran from
`2026-11-03T01:31:20.166Z` to `01:31:32.981Z`: **55 supporting checks in
12.815s**, exit 0. These include expected error responses, not 55 independent
manual acceptance cases. The file contains sanitized IDs/statuses/hashes/timing;
no cookies, passwords, tokens, signed URLs or private configuration were copied.
Verifier SHA-256:
`b0d6bc85ebf5fa460ea6647328b4ca8569d2f7a266cc1348663eaa208fea2550`.

- Actual cookie/CSRF login, current actor and READY fallback validation passed.
  Source, group, schedule, request, publish and takedown actions used REST.
  SQL mutations inserted only two new named OFFLINE fixture screens.
- GroupA initially contained X. PublicationA froze X and authored GroupA without
  explicit publish-body group IDs. After GroupA changed to Y and a different
  schedule directly published B to Y, GroupA's endpoint showed current member Y
  while retaining frozen publicationA/X. X retained A; Y received only B.
- Fifteen streamed downloads across image, PDF and processed video matched
  frozen SHA/size/MIME/cache descriptors: 1,366,995 bytes total. Individual
  transfers took 6–175ms for these small synthetic fixtures only; this is not
  upload, capacity, soak or production-network performance evidence.
- Source, original screen and group DELETE attempts returned their expected
  `409` blockers. Hashes of owned targets, memberships, schedules, items,
  publications, snapshots, both reservation graphs and normalized assets were
  unchanged.
- Request HELD → RESERVED → PUBLISHED phases shared their reservation token.
  A future source microphone-policy edit preserved the existing frozen API/DB
  policy. Both request and direct retry endpoints returned the same publication
  and snapshot IDs; no duplicate publish was created.
- All three own publications were taken down, screen/logical live reservations
  became RELEASED, and history remained. The source, drafts and fixture screens
  were retained; no hard cleanup/reset was performed. Only this probe's login
  session was revoked and a subsequent request confirmed `401`.

No live run, admission, presenter stream, connected-player delivery, rendering
or physical display was exercised by this service verifier.

## Actual CMS browser observations

Root observed the source page against the running API: New Source, presenter
refresh, create/view, both optional audio-policy edits, and service restart →
Retry recovery. These are source-authoring controls, not capture consent or a
scheduled broadcast journey.

On the freshly built CMS, the own API was stopped while its worker remained
available. View displayed readable service-unavailable guidance for the proxy
`502`, rather than raw HTML. After API restart/readiness, Retry reloaded the
same source. The root-reviewed synthetic-data
[readable error screenshot](runtime-live-2026-11-03/cms-live-source-readable-proxy-error.jpg)
is retained as pixel evidence. The stale-tab screenshot was scrolled away from
its banner and is deliberately not used as banner pixel proof.
Screenshot SHA-256:
`c90354cab44d836ab1ac95599ecdeda141f068045e397dbd74c233c12113ad8b`.

Root also disabled an own unused source, confirmed Enabled-only filtering hid
it, removed the filter to find it again, and soft-deleted it through the visible
confirmation; reload confirmed its absence. No unrelated source was changed.

Two tabs shared the same administrator session and initially loaded revision
2. One saved a description at revision 3. The other exposed the
source-changed `409` in browser accessibility state, retained its draft and disabled Save; explicit Reload
loaded revision 3/server description. This proves that specific stale-tab path,
not independent presenter/account isolation. The stale-tab screenshot remains
ignored and supplies no pixel claim for its offscreen conflict banner.

The broader server packet covered Screens (21), screen namespace (10),
reservations (4), screen deletion (8), ordinary publication (4), device
acknowledgement (2), schedule routes (2) and groups (1). It did not mutate the feature database, and is
not a complete CMS-to-player live journey.

### Developer build binding

[Compiled build manifest](runtime-live-2026-11-03/live-publication-build-binding.json)
binds the source commit above to these developer compilation outputs:

| Tree | Included files | Bytes | Tree SHA-256 |
| --- | --- | --- | --- |
| Server `dist` | All 338 JavaScript files | 3,573,182 | `b5689f5be700ef2ffe62c9c9c868d19ff9fb0df0cb97924d253a5111971fa7e9` |
| CMS `dist` | All 91 HTML/CSS/JavaScript files | 1,899,093 | `69fa9ae61d6952d91c0743fa98a36523b0591b485d2e757c724b90623ba768f2` |

The manifest lists each file's POSIX relative path, decimal size and SHA-256.
Sort paths within each root, concatenate UTF-8 `path`, NUL, `size`, NUL,
`sha256`, LF for each entry, then SHA-256 that byte stream. Timestamps and
absolute paths do not participate. Manifest SHA-256:
`886ed3bba5338a0f955f3416342513929fd335585d2b592c28ff0aea777fd656`.

Private environment/configuration, credentials, user-data, player work and
source maps/declarations were not hashed. These are developer builds, not TGZ
or offline deployment bundles. Updated packaged release artifacts have not
been built. Complete integrated player/CMS regression remains a later
feature-packet gate.

## Catalog integrity

[Catalog audit](runtime-live-2026-11-03/publication-catalog-integrity.json) records
150 cases, 51 risks and 152 traceability rows. All expected results are populated;
Case priority counts remain 114 P0, 35 P1 and 1 P2. Status counts remain 120 Not
Tested and 30 Partially Tested. Every LIVE-01..20 remains Not Tested with blank
QA Actual Result/Execution Evidence/Defect fields. Only selected developer notes
were added; trace Coverage Status and risk scores were preserved.

## Remaining implementation and acceptance

Capability-gated server publication is implemented, while the normal player
still withholds `live_broadcast_v1`. Production run/admission/epoch authority,
same ordinary installed-player schedule/coordinator/renderer integration,
fallback pin consumption, presenter/capture controls, complete CMS publishing
wizard and sixth-role offline artifacts are unfinished. No loop or beta gate
is closed by this report.

All human `LIVE-01..20` remain **Not Tested**, with QA Actual Result, Execution
Evidence and Defect ID unchanged. Retain browser/OS/audio, physical display,
cross-VM trust/firewall/TURN, external restore epoch and representative ten-run/
250-player load/soak gates. Existing unrelated release blockers remain open.
