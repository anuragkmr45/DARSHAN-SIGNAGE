# Groups 1–4 Release Gates — 2026-11-01

Status: **developer implementation and focused regression complete; release acceptance blocked**. This file records product decisions and required evidence. Tests named below are not passed merely because source exists.

## Developer packet checks

| Packet | Required developer journey | Current status |
| --- | --- | --- |
| 1 | API blockers, stale CMS Screen/Group dialogs, concurrent writer, deleted-player REST confirmation and visible fresh pairing ≤5 seconds | Server DB/API, 12-step Screen dry run, both CMS Group controls and player lifecycle checks passed. A real Docker/Xvfb Electron journey displayed fresh pairing within 343 ms of API success; physical Windows/Ubuntu display confirmation remains pending |
| 2 | SSO 404/local login, preflight with stored secret, internal HTTP/HTTPS and denied public/redirect/DNS/credential destinations, verified cross-VM TLS | Server policy/API tests, real private HTTP webpage capture and webhook delivery, SSO absence and local login passed; site firewall and cross-VM TLS evidence remain pending |
| 3 | Delete/restore Media and chat in CMS/API, permissions, retained object hashes, old cleanup-job replay, failed object/association restoration, PoP spool/write/drop accounting | Real CMS/API delete/restore journeys passed. PostgreSQL associations and MinIO object bytes survived deletion and were restored with an exact SHA-256 match; production-sized recovery remains pending |
| 4 | 30 full-day backup boundary, failed capture/no prune, clock rollback, measured capacity and isolated restore | Backup shell and Compose parse passed. The real sidecar created and checksum-verified a live set, then PostgreSQL and MinIO were restored into isolated targets; Data VM capacity and production-sized restore remain pending |

## Developer verification performed

- Nine server integration files passed, **109/109 tests**, after a fresh migration of the disposable PostgreSQL database. They include local login, Screen/Group guards, telemetry, defaults, Media/chat, SSO absence and a real private HTTP webhook Test fixture. Focused policy suites passed **19/19**. The server build and compiled production CLI passed; SSO preflight reported zero active configurations and zero stored secrets in the disposable database.
- The CMS production build and bundle budget passed; **126/126 unit tests** passed. Affected Chromium journeys passed, including Screen deletion, both Group deletion controls, Media/chat restoration and SSO navigation absence.
- The player build passed; **376/376 unit**, **5/5 integration** and **14/14 fault** tests passed. The original public-address webpage fixture was updated to an explicitly approved private address.
- The Screen realtime dry run passed **12/12 steps** with a live PostgreSQL/MinIO fixture. Backup shell tests and both Docker Compose parses passed. Targeted server/CMS/player lint found no errors; shell syntax and `git diff --check` passed.
- A disposable single-host Docker application stack was run with PostgreSQL, MinIO, Valkey, API, CMS, a private HTTP fixture and the actual Electron player under Xvfb. No representative five-VM load run was started.

## Live Docker application journeys

The following checks used the running CMS and actual APIs rather than only test scripts:

- Local administrator login succeeded. The SSO config route returned 404 and no SSO navigation was present.
- An empty authorized Screen inventory initially returned 403. The route now authorizes the Screen subject before applying row filters and correctly returns an empty list; a focused regression test covers this case.
- A paired Screen and Group with an active group emergency both rejected deletion with the expected `SCREEN_IN_USE` and `SCREEN_GROUP_IN_USE` 409 responses. The target rows and membership remained intact. After the emergency was cleared, its retained historical record no longer blocked deletion.
- An uploaded Media object was soft-deleted and hidden from the normal library, while its PostgreSQL storage pointer and MinIO bytes remained present. Administrator restore returned it to the library. The source file, retained object and restored object matched SHA-256 `daed3a...`; `MEDIA_DELETE` and `MEDIA_RESTORE` audit rows used the correct entity ID.
- A chat message with an attachment and its conversation were soft-deleted. The body, revision, members and attachment association remained stored. Message restore was correctly blocked while its conversation was deleted, then both were restored through the administrator Deleted Content flow.
- A private HTTP webpage was captured and rendered with its fallback preview. The webhook Test action delivered to the approved private HTTP fixture and showed HTTP 200/Healthy in CMS. The first real delivery exposed Node 20's `{ all: true }` DNS lookup callback shape; the pinned lookup now supports both callback shapes and has focused tests.
- The real Electron player was paired, completed CSR/certificate provisioning and visibly reached its online no-content state. Deleting that unreferenced Screen produced HTTP 200, the notification caused authoritative REST validation, playback stopped, credentials were cleared and a fresh pairing code became visible. Player logs show the delete reconciliation at `20:25:51.622`, hard recovery at `20:25:51.636` and pairing pending at `20:25:51.656`. The first screenshot capture began 15 ms after the API response and completed within 343 ms with the fresh pairing screen already visible, well inside the five-second requirement. Before/after screenshot hashes were `c7bfffe4...` and `c94d1e0b...`.
- That first real player run also exposed a zero-Hz Xvfb display observation that the pairing and heartbeat schemas correctly reject. The player now records non-positive platform refresh rates as unknown (`null`), after which pairing, heartbeat-compatible display data and the complete deletion journey succeeded.
- The actual backup sidecar image created `backup-2026-11-01` from the live PostgreSQL and MinIO services with 30-day retention metadata and valid checksums. Its PostgreSQL dump restored into an isolated database with the expected users, screens, Media, conversation, message and historical emergency. A retained MinIO object restored into an isolated bucket with the exact 550-byte size and SHA-256 `daed3a...`. This is functional local recovery evidence, not a production-capacity rehearsal.

Focused post-fix verification passed Media **16/16**, Screen deletion **7/7**, webhook delivery **10/10**, production command contracts **8/8**, and a nine-file server packet regression **92/92**, plus the server build, player build and complete player test counts above. The production policy suite was run in a controlled process because inheriting the live sidecar's 30-day environment would invalidate its deliberate three-day compatibility fixtures. The production command contract must run from the monorepo checkout because it intentionally reads repository-level deployment assets; an API-only source mount cannot supply those files.

## Five-VM measured release run

Use a frozen candidate and representative PostgreSQL/MinIO data. Record site ID, release/image hashes, VM shapes, storage free/used bytes, TLS/proxy configuration, clock synchronization, test tool versions, start/end UTC timestamps and raw metrics/log locations. Ramp to 500 connected players, 40 active CMS users and five concurrent 500 MiB uploads, then a 1,000-player five-minute spike. Generate one PoP event for every simulated playback transition. Repeat with simultaneous backup, uploads, processing, emergency fanout and reconnects. Share a proxy IP while forwarding distinct real client addresses from *configured trusted proxies only*; confirm normal device traffic is not accidentally throttled and untrusted forwarded headers are ignored.

Pass only with measured API p95 ≤1 second, p99 ≤2 seconds, non-chaos errors <1%, cached emergency display ≤3 seconds on healthy WebSocket and ≤7 seconds on fallback, no lost command fanout, backlog recovery, no PoP discard at normal load, and sustained CPU/memory <80%. Retain raw samples, calculation scripts, object hashes, player screen capture timestamps, and reviewer approval. A sample capacity template or model calculation is insufficient. **No representative five-VM run has been executed in this developer workspace.**

## Recovery and release stop conditions

Measure a full daily backup set and pass `deploy/production/docker/backup/check-capacity.sh` on the Data VM before sidecar activation. Preserve every successful set for 30 full IST days. Rehearse a production-sized PostgreSQL/MinIO restore into isolated clean targets before each production release and monthly thereafter; verify rows, object hashes, representative playback and readiness. Record last recoverable transaction, start/end, measured RPO ≤24 hours, RTO ≤4 hours and maintenance ≤2 hours. An overdue backup, failed restore, missing evidence, capacity failure or regression blocks approval. Same-VM backup cannot satisfy the 24-hour RPO for Data VM/disk loss; this remains an explicit accepted-risk decision, not a passing recovery test.

The backup sidecar image is not yet packaged in the source-free/offline bundle; this packet's sidecar path is direct Compose only. A direct Compose CMS HTTP endpoint needs verified site TLS ingress before it can satisfy the user/cross-VM HTTPS boundary. Physical Windows/Ubuntu displays, multi-node fanout, production-scale load and the independent recovery rehearsal remain QA work.
