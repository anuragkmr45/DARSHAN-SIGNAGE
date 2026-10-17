# Webpage Playback And Default-Priority Review

Review date: 2026-10-17

Source baseline: uncommitted `release-01` working tree based on `c680c0a`
Status: implementation/source review complete; independent QA not executed

## Accepted Contract

1. Ordinary HTTP and HTTPS webpages are supported only through explicit
   server/player policy. Source defaults keep HTTP off; the release bundle turns
   it on and allows ports 80/443.
2. Login-required webpages are unsupported. URL credentials, HTTP
   authentication and imported/persistent login profiles are not used.
3. The initial URL, every request/redirect/navigation and the final URL must
   remain inside the approved scheme, host, port, DNS-address and CIDR policy.
4. The latest successful preview is the fallback. Operators can refresh it
   manually and a due scanner refreshes it every 24 hours by default. Failure
   preserves the previous successful revision.
5. Competing GROUP defaults use explicit integer priority `0..100`, highest
   first, with ascending target ID as the deterministic tie-break. A direct
   SCREEN assignment wins first. Legacy/missing priority is zero and an edit
   that omits priority preserves it.

## Implemented Data And Control Flow

Webpage preview flow:

`CMS Media Library -> POST preview refresh -> media refresh token/status ->
capture job -> per-request URL policy -> content-addressed preview object ->
atomic media revision/checksum/captured-at publication -> playback refresh ->
schedule/default serialization -> player revision cache -> live view or latest
valid preview`

- Migration `0047_webpage_preview_refresh.sql` adds preview revision, checksum,
  successful-capture time, attempt time and refresh ownership metadata plus the
  due-scan index/backfill.
- The manual API and due scanner claim work idempotently. Capture publication
  uses the current refresh token/state so an older worker cannot replace a
  newer result.
- The manual endpoint performs ownership/permission revalidation, media row
  lock and refresh claim in one mutation-authorization transaction; an account
  or ownership change cannot slip between authorization and the claim.
- Failed refresh records an error/attempt without replacing the active READY
  preview object or successful revision.
- Snapshot and default-media responses carry the same revision/checksum and
  captured timestamp. The player keys downloaded preview files by media ID and
  revision. Resolution order is the exact valid revision, newest valid older
  revision, legacy cache, then a controlled unavailable state.
- Player live content uses an isolated nonpersistent partition, cancels login
  requests and rechecks navigation/resource destinations. Fallback stays
  visible until the live readiness probe succeeds twice.

Default-priority flow:

`CMS priority input + expected revision -> settings PUT -> transaction advisory
lock -> current revision check -> validation/preservation -> canonical settings
write -> resolver -> screen/default response -> player`

- API validation rejects non-integer/out-of-range priority and duplicate
  targets atomically. Missing legacy priority normalizes to zero.
- An update omitting a GROUP priority copies the existing value rather than
  deriving precedence from array position.
- The resolver first evaluates eligible direct SCREEN assignments. Eligible
  GROUP assignments are then sorted by priority descending and target ID
  ascending. ASPECT_RATIO, GLOBAL and NONE follow.
- The transaction-scoped advisory lock protects the revision check and write,
  including creation of the first settings row. Two same-revision writers
  cannot both commit. The CMS retains local input after a `409` and lets the
  operator refetch/retry explicitly.

## Reviewed Corner Cases

| Area | Covered by implementation/design | Still requires target QA |
| --- | --- | --- |
| HTTP/HTTPS policy | explicit source/release defaults; schemes, ports, wildcard/exact host, IP/CIDR and hard-denied ranges | actual site DNS/firewall/proxy/TLS and cleartext-risk approval |
| Redirect escape | capture request interception/final URL and player navigation policy | controlled multi-hop/DNS-rebinding fixture and packet evidence |
| Authentication | userinfo rejection, fresh capture context, nonpersistent player session, login cancellation | 401/basic/form/SSO fixtures proving no credential/profile use |
| Refresh races | token compare-and-set, duplicate/due/manual work, deletion-safe processing, stale cleanup | real browser/object store/DB fault points and recovery |
| Preview integrity | content-addressed object, checksum/revision propagation, old-cache fallback, corrupt placeholder | packaged physical player, offline restart, cache-pressure/mixed-server rollout |
| Due scanning | default 24-hour interval and bounded batch | production fleet volume, queue latency and Chromium worker capacity |
| Priority bounds | `0..100`, legacy zero, duplicate target rejection | migrated legacy production copy and operator accessibility |
| Priority winner | SCREEN first; GROUP priority and stable tie; eligibility/aspect fallthrough | live player output across group membership changes |
| Concurrent save | real-PostgreSQL lock/revision test; CMS mocked conflict/retry | two real CMS sessions through the final deployed API |

## Deployment Order

1. Back up and apply migration `0047` through the supported migration ledger.
2. Configure the same webpage policy on server/capture and every player. Record
   the explicit HTTP decision, hosts, ports and private CIDRs.
3. Deploy API/worker, then CMS, then player. Do not run the new worker against
   an old schema or publish HTTP content to players with a different policy.
4. Run `WEB-01..06`, `DEF-01..03`, `FUN-06`, `FUN-08` and `PLAYER-09` on the
   frozen candidate before accepting the feature.

## Evidence Boundary

Developer automation proves code-level policy, serialization, database
concurrency and mocked operator flows. It does not prove the real site network,
Chromium/object-store fault behavior, physical player rendering, capacity,
security assessment, mixed-version rollout or soak. Human QA Status, Actual
Result, Execution Evidence and Defect ID remain unclaimed in
`05_TEST_CASES.csv`.
