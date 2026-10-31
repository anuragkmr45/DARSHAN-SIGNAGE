# D3 Gate03 authenticated-health diagnosis — read-only

Finding: **a MinIO health-probe false negative on its second unauthenticated TLS check in the same Node process**. The source service returns the required403 AccessDenied. A pooled TLS socket is reused, so there is no new `checkServerIdentity` callback; the probe's fresh per-request certificate variable stays null. The strict health validator correctly rejects that missing proof. This is controller-side peer bookkeeping, not evidence of a MinIO outage or an authenticated AWS SDK failure.

No repository implementation code, profile, gate, service, volume or credential was changed. No prefix/status/data-status/seed command, repair, restart/stop, container exec, DB/S3/Valkey write, backup/capture/restore or commit ran. Only separately authorized read-only component diagnostics and exact retained-ID inspect/log reads ran. Runtime instrumentation observed existing clients without changing targets, credentials, validation return values or budgets. No private values, certificate/key bodies, TLS session material or unrestricted error/log text were printed. Inline diagnostic sources and bounded outputs are retained in the [canonical evidence JSON](controlled-recovery-d3-health-gate03-diagnosis-2026-10-31.json), SHA-256 `547dad841cbc1c684dfc4685307f68ae60494e050a4fdc1814017ea3ff8b08b4`.

## Initial fixed component observations

The initial diagnostic process ran internally from `2026-10-31T02:33:04.330Z` through `02:33:12.342Z`, exit0. It used UID:GID1000:1000, backend cwd, clean explicit environment,512MiB Node heap,180-second internal/240-second outer bound. All three installed read-only target/admission checks passed (898/896/865ms). Each existing health request retained its unchanged666ms budget (2000ms group budget divided by3).

| Component | Authenticated TLS | Unauthenticated TLS | Plaintext |
|---|---|---|---|
| PostgreSQL |86ms; SELECT1, database/user darshan, ssl=true, version160015 |22ms; rejected AUTH, SQLSTATE28P01 |6ms; rejected TLS_REQUIRED, SQLSTATE28000 |
| MinIO |39ms; SDK ListBuckets HTTP200, zero buckets |9ms; HTTP403 AUTH rejection |9ms; HTTP400 TLS_REQUIRED |
| Valkey |8ms; AUTH/WHOAMI/PING, d3-source/PONG |6ms; AUTH rejection |2ms; TLS_REQUIRED, connection reset |

All nine component phases passed their existing contract. Every TLS phase that requires peer proof matched the retained certificate fingerprint. No additional SQL surface was available: the diagnostic PG observer admitted exactly the existing fixed SELECT, and the SDK observer admitted only empty-input ListBuckets. AUTH/WHOAMI/PING were session/read-only operations; no Valkey data/ACL mutation occurred.

## Same-process MinIO comparison

The bounded MinIO-only comparison ran internally from `2026-10-31T02:36:40.041Z` through `02:36:46.398Z`, exit0, using the same untouched target, retained layout, exact installed target verifier, original666ms requests and existing health transport. It ran two health groups, not a prefix retry. Both authenticated SDK ListBuckets requests succeeded. Node's future-version SDK warning was present while those requests succeeded, so it is not the failure demonstrated here.

| Phase | First group | Second group |
|---|---|---|
| Authenticated S3 |200,85ms, exact peer SHA |200,40ms, exact peer SHA |
| Unauthenticated TLS |403,41ms, exact peer SHA |403,2ms, certificate SHA **null** |
| Plaintext |400 TLS_REQUIRED,4ms |400 TLS_REQUIRED,2ms |
| Existing health validator |PASS |HEALTH_UNVERIFIED |

The retained MinIO certificate SHA is `2956d35cfb9c68bdb818ae2ecd239869e8c7ae3f0a9ecc62e8631144ef5fcad4`. The enrolled Node20.20.2 global HTTPS agent has keepAlive=true and maxCachedSessions100. Observed connections were two fresh dedicated authenticated sockets and one global unauthenticated socket. That global socket remained open; the second unauthenticated request created no new TLS connection or identity callback. The three observed fresh connections were authorized, matched the exact retained peer SHA and had sessionReused=false. This demonstrates pooled **connection reuse**; a new resumed TLS handshake was not observed. The enrolled Node built-in source confirms `https.request` selects the global agent by default and its reuse method marks `req.reusedSocket=true`.

The false-negative phase takes2ms, far below666ms. No timeout, extra authentication failure, image/config drift, restart or OOM is needed to produce it. The instrumented callback delegates unchanged to the original strict verifier; no CA/name/hash check was bypassed.

## Exact code path and attribution

- `controlled-recovery-d3-source-health.ts:70–78`: raw negative HTTP(S) probe initializes a fresh null certificate variable, captures it only through the handshake callback and supplies no per-request agent.
- `controlled-recovery-d3-source-health.ts:123–124`: all three replies are obtained, then the null negative-TLS peer SHA fails the exact retained fingerprint requirement.
- `controlled-recovery-d3-source-health.ts:128`: the catch discards the phase/cause and emits HEALTH_UNVERIFIED.
- `controlled-recovery-d3-source-services.ts:145–146`: the next catch emits the generic AUTHENTICATED_HEALTH_FAILED reported by Gate03.
- `controlled-recovery-d3-recovery-prefix.ts:83,97`: the fixed observer performs service observation twice in one process, matching this reproducible second-observation failure path.

The original [Gate03 report](controlled-recovery-d3-recovery-prefix-live-gate-03-2026-10-31.md) did not retain component/phase diagnostics, so it alone cannot forensically attribute its historical failure. The separately authorized comparison reproduces the matching installed-client/code path and identifies its concrete false negative. It does not promote Gate03 to prefix acceptance or prove any ledger/business-state condition.

## Retained state and continuity

| Role | Exact runtime ID | State | Memory cap |
|---|---|---|---|
| PostgreSQL |`59293a90028f1085f53470e81a37cda5fe45a5cf3e3efe1339d2f063ab5bdc47` |running; restart0; OOMfalse; exit0 |268435456 |
| MinIO |`762ece210166e24e6e8ae2304492433fc50dffd3de038e13bda534355f9e769f` |running; restart0; OOMfalse; exit0 |402653184 |
| Valkey |`7a830cd163dc5f2860fbf114ceb994db6372cde8d96da4037df88e3d72b3afff` |running; restart0; OOMfalse; exit0 |100663296 |

All are the exact retained full image/config/label/mount/cap identities, with read-only roots and no configured Docker healthcheck status (null). Runtime IDs/PIDs/start times/caps were unchanged across initial observations; MinIO identity/start/restart/OOM state was unchanged across comparison. The complete resource receipt digest is `c8fdf00e766b1fe54282ee3bd71895667b73ea6b9e8ad7f947732d1b4d269936`; layout receipt SHA is `6445bf3e980ab5355205ab6485a8d23d60adb5d6c4dceb9b6fbafb0f3252fe21`. Stage remains SERVICES_READY with no pending roles. No mutation/layout lock was acquired.

Before/after source+keys metadata inventories contain80 entries and have the same SHA in both processes: `00e81d8f0d422e625bd6c3171b13cabf226a6bb3ce000beeb009d230afe664e5`. They bind inode/device/link/type/mode/owner/size/mtime/ctime; atime is intentionally excluded from read-only continuity. Layout and resource receipts revalidated unchanged. Source/data/activation hashes remain `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`, `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`, `030862accc6c5d20a90c2a6a6eb4b4a2a64c1f93a4f34aad34bab185ff794ecb`.

Bounded Docker logs were read only for those exact IDs, last30 minutes/tail100/64KiB maximum. Captured byte counts and digests are retained in JSON (PostgreSQL1941 bytes, MinIO0, Valkey398); raw log text was not printed or copied. Exploratory category counters are not used to assert absence of errors or to establish root cause. Current service state comes from exact inspections, and the false negative comes from direct client/TLS observations.

## Smallest proposed static correction

Change only the raw negative probe's agent selection in `controlled-recovery-d3-source-health.ts` to force a fresh, nonpooled request (for example `agent:false`, or an owned one-request agent with no keepalive/session cache). Keep CA verification, exact SNI/fingerprint checks, AUTH/HTTP400 rejection and666ms budget unchanged; continue rejecting missing peer proof. Do not alter MinIO, credentials, certificates, Node version, SDK dependency, admission thresholds, source/data profiles or gates.

Add a deterministic two-round pooled-socket regression in `controlled-recovery-d3-source-runtime.unit.test.ts`, including skipped identity callback on reuse; prove the fixed path invokes strict peer validation for every request. Retain bad/missing peer, negative403/plain400, abort/deadline and connection-settlement regressions. Refresh only the changed source-health asset and related QA evidence, then run focused/predecessor tests, types/build/lint/audits. No live validation or prefix retry follows automatically. Classified role/mode/cause propagation through the catches would be a separate optional observability improvement, not necessary to repair this demonstrated defect.

No repair or implementation edit has been made. Handles44650 and77281 completed; no diagnostic remains running. This packet adds only its JSON/Markdown evidence. Prefix remains unaccepted, live-seed enrollment and all later disabled gates are unchanged, and further static correction/live action requires its own instruction.
