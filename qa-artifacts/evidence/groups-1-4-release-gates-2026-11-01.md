# Groups 1–4 Release Gates — 2026-11-01

Status: **developer implementation and focused regression complete; release acceptance blocked**. This file records product decisions and required evidence. Tests named below are not passed merely because source exists.

## Developer packet checks

| Packet | Required developer journey | Current status |
| --- | --- | --- |
| 1 | API blockers, stale CMS Screen/Group dialogs, concurrent writer, deleted-player REST confirmation and visible fresh pairing ≤5 seconds | Server DB/API, 12-step Screen dry run, both CMS Group controls and player lifecycle unit checks passed; controlled visible five-second clock and physical display pending |
| 2 | SSO 404/local login, preflight with stored secret, internal HTTP/HTTPS and denied public/redirect/DNS/credential destinations, verified cross-VM TLS | Server policy/API tests, real private HTTP webhook fixture, SSO preflight and local auth regression passed; site firewall, DNS rebinding and TLS fixtures pending |
| 3 | Delete/restore Media and chat in CMS/API, permissions, retained object hashes, old cleanup-job replay, failed object/association restoration, PoP spool/write/drop accounting | Real MinIO Media object checksum and missing-object tests, chat/API/CMS and PoP unit tests passed; production data backup/restore pending |
| 4 | 30 full-day backup boundary, failed capture/no prune, clock rollback, measured capacity and isolated restore | Backup shell and Compose parse passed; developer disk capacity check correctly blocked; Data VM capacity and production-sized restore pending |

## Developer verification performed

- Nine server integration files passed, **109/109 tests**, after a fresh migration of the disposable PostgreSQL database. They include local login, Screen/Group guards, telemetry, defaults, Media/chat, SSO absence and a real private HTTP webhook Test fixture. Focused policy suites passed **19/19**. The server build and compiled production CLI passed; SSO preflight reported zero active configurations and zero stored secrets in the disposable database.
- The CMS production build and bundle budget passed; **126/126 unit tests** passed. Affected Chromium journeys passed, including Screen deletion, both Group deletion controls, Media/chat restoration and SSO navigation absence.
- The player build passed; **375/375 unit**, **5/5 integration** and **14/14 fault** tests passed. The original public-address webpage fixture was updated to an explicitly approved private address. These tests do not measure a physical display transition.
- The Screen realtime dry run passed **12/12 steps** with a live PostgreSQL/MinIO fixture. Backup shell tests and both Docker Compose parses passed. Targeted server/CMS/player lint found no errors; shell syntax and `git diff --check` passed.
- Disposable local services used PostgreSQL and MinIO only. No heavy five-VM application stack or representative load run was started.

## Five-VM measured release run

Use a frozen candidate and representative PostgreSQL/MinIO data. Record site ID, release/image hashes, VM shapes, storage free/used bytes, TLS/proxy configuration, clock synchronization, test tool versions, start/end UTC timestamps and raw metrics/log locations. Ramp to 500 connected players, 40 active CMS users and five concurrent 500 MiB uploads, then a 1,000-player five-minute spike. Generate one PoP event for every simulated playback transition. Repeat with simultaneous backup, uploads, processing, emergency fanout and reconnects. Share a proxy IP while forwarding distinct real client addresses from *configured trusted proxies only*; confirm normal device traffic is not accidentally throttled and untrusted forwarded headers are ignored.

Pass only with measured API p95 ≤1 second, p99 ≤2 seconds, non-chaos errors <1%, cached emergency display ≤3 seconds on healthy WebSocket and ≤7 seconds on fallback, no lost command fanout, backlog recovery, no PoP discard at normal load, and sustained CPU/memory <80%. Retain raw samples, calculation scripts, object hashes, player screen capture timestamps, and reviewer approval. A sample capacity template or model calculation is insufficient. **No representative five-VM run has been executed in this developer workspace.**

## Recovery and release stop conditions

Measure a full daily backup set and pass `deploy/production/docker/backup/check-capacity.sh` on the Data VM before sidecar activation. Preserve every successful set for 30 full IST days. Rehearse a production-sized PostgreSQL/MinIO restore into isolated clean targets before each production release and monthly thereafter; verify rows, object hashes, representative playback and readiness. Record last recoverable transaction, start/end, measured RPO ≤24 hours, RTO ≤4 hours and maintenance ≤2 hours. An overdue backup, failed restore, missing evidence, capacity failure or regression blocks approval. Same-VM backup cannot satisfy the 24-hour RPO for Data VM/disk loss; this remains an explicit accepted-risk decision, not a passing recovery test.

The backup sidecar image is not yet packaged in the source-free/offline bundle; this packet's sidecar path is direct Compose only. A direct Compose CMS HTTP endpoint needs verified site TLS ingress before it can satisfy the user/cross-VM HTTPS boundary. Physical Windows/Ubuntu displays, multi-node fanout, production-scale load and the independent recovery rehearsal remain QA work.
