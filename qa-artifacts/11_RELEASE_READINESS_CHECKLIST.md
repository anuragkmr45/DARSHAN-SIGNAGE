# Release Readiness Checklist

This is a release gate, not a current sign-off. Record owner, date,
build/release ID, evidence and decision for each item. The authorization/session
review is `evidence/authorization-session-requests-review.md`; the final
developer cycle added real-PostgreSQL, built-API, browser and full-player
automated evidence in
`evidence/runtime-2026-10-16/authorization-end-to-end-devqa.md`. These results
do not replace independent QA, platform, security, recovery, soak or deployment
gates.

The webpage/default-priority developer review and exact bounded commands are in
`evidence/webpage-default-priority-review.md` and
`evidence/webpage-default-priority-developer-verification-2026-10-17.md`.
The later live requirements 1-18 run is in
`evidence/runtime-2026-10-17/runtime-validation.md`; 1-17 passed the bounded
developer scenarios and requirement 18 failed.

Requirements 19-24 source/automated verification and two current Linux
Electron runtime passes are recorded in
`evidence/playback-recovery-developer-verification-2026-10-21.md`. This is
developer evidence, not an independent QA or release pass.

The new uncommitted P01 authorization/directory changes are **not** covered by
the historical checked authorization developer item below. P01 still needs
real PostgreSQL, CMS browser, deterministic race, two-node Valkey and affected
regression evidence before a frozen candidate can be handed to QA; see
`evidence/packet-01-permission-developer-verification-2026-10-22.md`.
The user-confirmed activation-before-login rule BR-108 has source/build/unit
evidence only; its PostgreSQL API lifecycle, legacy-session and two-node
checks are part of that open P01 gate.

## Current Targeted Feature Evidence

- [x] Backup/recovery Packet 1 has bounded developer evidence for focused unit, real disposable PostgreSQL/pg-boss integration, migration-ledger, manual route, parser, source-free validator and server-build checks; exact commands/results and six review-found defect corrections are recorded in `evidence/backup-recovery-packet-01-developer-verification-2026-10-28.md`. This is evidence only. `BKP-04..11`, `CONC-08` and `DATA-08` remain `Not Tested` for human QA.
- [x] Backup/recovery Packet 2 has bounded developer evidence for a fresh 52-migration PostgreSQL database, 129/129 focused cases, real pg-boss expiry hold, signed gateway upload, combined API/worker/MinIO runtime, build/lint and bundle checks; eight review/runtime defects and exact limits are recorded in `evidence/backup-recovery-packet-02-developer-verification-2026-10-28.md`. This is evidence only. `BKP-12..20` remain `Not Tested` or `Blocked` for human QA.
- [x] Backup/recovery Packet 3 has bounded developer evidence for 53/53 backup-unit cases, 32/32 PostgreSQL/route/GC cases, server build, native pinned age 2 MiB exact round-trip, wrong-key rejection and truncated-ciphertext rejection. Eight review-found corrections and the fail-closed production boundary are recorded in `evidence/backup-recovery-packet-03-developer-verification-2026-10-28.md`. This is evidence only. `BKP-21..30` remain `Not Tested` or blocked for human QA.

- [x] Disposable Linux CMS/API/Electron flow demonstrated independent PDF pages, video Loop On/Off, multiple items, simultaneous slots, corrupt-media advance, schedule hard stop, cached offline restart/recovery, take-down and page-aware PoP persistence.
- [x] CMS/server/player focused tests and builds passed; Linux AppImage and amd64 `.deb` were created with recorded hashes.
- [x] Deleted-user ownership source/build checks, affected DB-backed routes and migration `0045` upgrade/repeat/failure/recovery rehearsal passed on disposable PostgreSQL. This is developer evidence only; the complete QA matrix and release recovery gate remain open.
- [x] Authorization/session/Requests developer verification passed server/CMS/player builds, focused unit/integration suites, six CMS browser cases and built-API HTTP checks. A multipart authorization-revocation cleanup defect was fixed and the final affected server rerun passed 65/65. Multi-process live sockets remain open.
- [ ] `AUTHN-03..05`, `AUTHZ-01..03`, `AUTHZ-06`, `AUTHZ-08..19` require independent QA runtime evidence; bounded developer checks do not mark these cases Pass. For `AUTHN-03`, verify invite-create has no `temp_password`, public no-cookie activation, one-time manager link, secure handoff, no token in lists/logs, pending-login denial using a known database fixture password, replacement of lost/expired pending links with immediate old-link invalidation and stored status reset to PENDING, malformed invitation-date filtering, replay/expiry, and old-session revocation. Confirm the separate authorized reset-password flow still returns its generated password. For `AUTHZ-17`, run the actual User/Invitation/Operator browser forms with matching and nonmatching proposed records, plus direct API denial. For `AUTHZ-18`, run conditional versus unconditional Report/Dashboard/AuditLog/ProofOfPlay actors against actual APIs and CMS, plus matching/nonmatching per-screen observability. For `AUTHZ-19`, use three screens and two mixed-membership groups to verify filtered REST counts/pages, every screen operational detail, group relationship redaction, device command/pairing scope, record-specific CMS controls and socket subscribe/sync/event isolation. Hold the shared per-device lifecycle lock and prove immediate retryable `409` with no Screen/display/group-membership/command/history/desired-state/outbox mutation for recovery, display selection, screenshot policy, screenshot trigger, direct CMS command, group membership mutation, group screenshot controls, Screen update and Screen deletion; after release, each legal request must commit its complete state/command lifecycle once. Verify a hidden current group member cannot be removed through a forged replacement and a partial idempotency-conflict batch keeps inserted command metadata aligned. Then race replacement, confirmation, completion, revocation, Screen/group mutation, Screen deletion and permission/session removal to prove exactly one legal committed outcome and no identity-drift certificate issuance. BQ-023/024 and R-43 are business-confirmed but still need PostgreSQL/API/browser/concurrency execution.
- [ ] `AUTHZ-07`, `DATA-06`, `CONC-07` and `UI-07` require independent QA runtime evidence; no Pass/Actual Result may be inferred from the checked developer items above.
- [ ] Resolve BQ-025 before approving Screen deletion: deleting a directly targeted Screen must not leave unsafe mutable targets or turn the last explicit target into empty/global scope. The selected policy needs direct API, current/future Schedule, active Emergency, publish-snapshot/history and concurrent delete/publish evidence. R-44.
- [ ] Resolve BQ-026 before approving Screen Group deletion: an in-use group must not disappear while current/future Schedule, active publish, active Emergency or group-default assignments still depend on it, and cleanup must never turn a final explicit Schedule target into global scope. Verify actionable reference counts, concurrent delete/retarget/publish behavior and immutable history. R-45.
- [ ] Fresh-machine installation/reboot tests for the generated Linux packages remain pending.
- [ ] Windows x64 package/install/kiosk/playback and supported physical display matrix remain pending.
- [ ] Long soak, approved performance limits, physical-player secure lock/cache purge/recovery, all-player update-and-connect capability deployment, accessibility and full product/security regression remain pending.
- [x] Server, CMS and player blocking-error lint exits successfully. The two no-behavior errors found during the review were corrected; the existing warning backlog remains technical debt and is not represented as remediated.
- [x] Webpage/default-priority focused developer gates passed: real-PostgreSQL settings/media routes, migration unit, server policy/jobs/default resolver, one-worker CMS flows, player full unit and fault suites, builds and release-bundle configuration.
- [x] Live built-API/worker/Chromium developer flow exercised requirements 1-17 successfully, including real webpage capture, denied redirect reachability, retained failed-refresh preview and rendered preview fallback. This is partial developer evidence only.
- [x] Requirements 19-24 focused player/CMS/server automation, complete player unit/integration/fault/performance suites, component builds and static QA traceability passed at the recorded working-tree baseline. This does not replace independent QA.
- [x] Requirements 19-24 developer runtime gate passed twice with the real Linux Electron player: selected/invalid PDF pages, corrupt-video progression/retry cancellation, 41/18 ms hard stops and 120,144/120,146 ms secure lock/fresh-authority recovery. Independent QA remains open.
- [ ] **BLOCKER — BR-102 / DEF-04 / R-38:** the no-Schedule/no-default path must show the approved standard company fallback image. Current runtime returns `NONE` and renders a text-only `No content assigned yet` card.
- [ ] `WEB-01..06`, `DEF-01..03`, `FUN-06`, `FUN-08` and `PLAYER-09` require independent QA against controlled HTTP/HTTPS/DNS/auth/redirect fixtures, real capture/object storage and the packaged physical player.

## Build And Environment

- [ ] Signed site/release manifest, installer and role archives verify against the independently pinned key; provenance and compatibility generation match. `DEP-01`, `DEP-05`.
- [ ] Approved real capacity evidence matches site/release, workload and resource policy; sample template values are never accepted as measured evidence. `PERF-01`, `DEP-02`; BQ-017.
- [ ] Transfer, staging, Docker, release, worker scratch, database, MinIO and off-host storage have measured free capacity for the entire update and backup; low space rejects before partial activation. `DEP-02`, `BKP-01`.
- [ ] Actual VM firewall rules and certificate trust match the approved network boundary. `DEP-06`, `SEC-02`; BQ-019.
- [ ] The documented client/platform matrix and physical displays have native package, kiosk, autostart, portrait/landscape and content evidence. `COMP-01..03`, `PLAYER-05`; BQ-016.

## Data And Recovery

- [ ] Nonempty database and all contracted object classes, including logs-auth and log archives, are in off-host backup manifest and restore to an isolated clean target with verified counts/hashes. `DATA-03`, `BKP-01..02`.
- [ ] Packet 1 production policy and coordination pass on the frozen candidate: exactly one repository mode; worker-only local mount or legacy credentials; deployment-owned daily time/timezone/retention; migration `0049`; stable pre/post-upgrade coordination key; transactional row/job creation; `201` new versus `200` coalesced manual response; automatic date identity; one active attempt; queue/attempt/lease/deadline/cancellation fences; typed terminal prerequisites; bounded transient retry; recurring reconciliation after a live-at-startup lease expires; atomic terminal-only delete; process-group/network abort and scratch cleanup. `BKP-04..11`, `CONC-08`, `DATA-08`; R-47/R-48.
- [ ] Packet 2 capture consistency passes on the frozen candidate: migration `0050`; immutable database-clock 300-second deadline; watchdog reopen; ACTIVE/COMPLETED/UNCERTAIN operation drain; complete HTTP/socket/hidden-write inventory; pre-fetch pg-boss hold and shutdown; signed staging/source gateway through every Nginx variant; durable replay-safe telemetry; atomic trigger/clear/expiry emergency preemption; protected raw DB/object staging and seal before packaging; and actual player availability beyond two minutes through the deadline. `BKP-12..20`; R-50/R-52.
- [ ] **BLOCKER — UNCERTAIN operations / BKP-19:** a gateway/database outcome whose result cannot be proven must block copying. Packet 7 must expose an authorized, audited, evidence-based resolution workflow; source-only store capability is insufficient for operator release readiness.
- [ ] **BLOCKER — production backup runtime / R-49/R-55:** Packet 3 implements tested encryption, manifest, publication and reconciliation primitives, and the worker now injects a pinned helper contract/signer/verifier and publication inspector. The actual privileged helper/cross-role capsule producer, retained verification-key policy and production PostgreSQL+MinIO run are absent, so it is not yet an operating automated local-backup service. Do not approve local backup/recovery until the confirmed BQ-027 architecture is deployed with site inputs and `BKP-21..30` complete.
- [ ] **BLOCKER — retention/restore/failure domain / R-56:** Packet 4 retention, clean local restore/promotion, recovery generation, final CMS health and independent encrypted copy are not delivered. A same-Backend-host local repository is not proof of Backend-VM or site disaster recovery. The confirmed targets—daily-or-better backup, 30-day minimum retention, automatic expiry, four-hour RTO and two-hour planned downtime—require measured end-to-end evidence; RPO, exact schedule/timezone and failure-domain promise remain BQ-018/027.
- [ ] Recovery evidence is fresh, signed by the separate authority and tied to this site/release policy. The recorded measured RPO/RTO meet the approved BQ-018 thresholds.
- [ ] Retention/deletion obligations for DB records, media, chat, screenshots, logs, metrics and backups have owners and evidence. Do not infer compliance from a config field or unused cleanup function. `BKP-01`, `PERF-04`; BQ-015/020.
- [ ] If upgrading, forward migration baseline, backup/restore plan, downtime window and compatible client/player versions are approved. Failed migration leaves a controlled state; no old image is started against unreviewed schema. `DEP-03`, `BKP-03`; BQ-018.
- [ ] Migration `0045` is rehearsed on a disposable legacy-data copy for organization/valid-department/restricted/missing/nullable and pre-migration-transferred creator classes, constraints/indexes, tombstone references, repeat invocation and recovery. The developer PostgreSQL rehearsal passed these technical paths; QA/release still needs frozen-candidate evidence, human acceptance of unknowable historical departments and a rollback decision that disables physical deletion on an older server. `DATA-06`, `BKP-03`; R-25/R-29.
- [ ] Migration `0047` is applied before any new API/worker/player rollout. Verify new preview columns/index, legacy backfill semantics, repeat application through the migration ledger and restore/forward-recovery behavior on the frozen candidate. Do not deploy the new worker against an old schema. `WEB-04..06`, `DEP-03`, `BKP-03`; R-36.
- [ ] An interrupted first install resumes correctly, old release stop script cannot stop the new active role, and stable volumes/site identity are preserved. `DEP-05`, `DEP-07`.

## Product And Security

- [ ] All release `P0` cases pass with execution evidence and reviewed defects. Open Critical/High risks in `03_RISK_REGISTER.csv` have explicit disposition; no source-only finding is counted as a passed runtime test.
- [ ] Last-active SUPER_ADMIN protection passes delete/disable/demotion, one-versus-two account, concurrent removal and recovery CLI paths. Custom roles follow effective direct/inherited/conditional permissions regardless of name; record-limited Role grants cannot open subject-wide catalogues, and invalid/conditional ADMIN branding grants cannot remove its restriction. `AUTHZ-01..02`; R-03/R-30/R-33.
- [ ] Role-identity safety passes on isolated copies: a canonical built-in name with `is_system=false` stops API startup and demo seed for administrator review; production bootstrap/adoption/inspection and administrator CLI mutations report conflict, while CLI inspection shows the non-system marker. None promotes or assigns the row or changes role/account/session/audit/adoption state. Genuine `is_system=true` permission drift repairs once, revokes affected sessions, and allows approved adoption/recovery. `AUTHZ-16`; BR-071; R-03. Authored database regressions are not runtime passes.
- [ ] Record-limited Role permissions enable CMS Edit/Delete only on matching Role rows; Save rechecks current authorization and the API rejects a stale or forged nonmatching mutation without a row/session change. Run the authored browser scenario against the built CMS and real API before sign-off. `UI-08`; R-33.
- [ ] Record-limited Department permissions constrain list rows/totals, detail, proposed create/update, delete and CMS controls. Run the authored API matrix on PostgreSQL and the browser scenario against the built CMS/API; a source build or mock-only test is not a release pass. `AUTHZ-15`; R-33.
- [ ] Singleton settings and generic settings API checks pass: conditional grants alone never authorize OrgSettings/BrandingSettings, `org.branding` is hidden from a generic list without BrandingSettings read, and a generic branding upsert without BrandingSettings update leaves the row unchanged. Confirm CMS permission state and direct API outcomes on the frozen build. `AUTHZ-14`; R-03/R-33. The route test is authored but has not run against PostgreSQL.
- [ ] Immediate withdrawal passes after disable/delete, password, role, department and direct/transitive permission changes across REST, protected socket actions and at least two API nodes. During a CMS A-to-B switch, delayed A GET/401 responses cannot affect B's view or session; other open tabs clear A's identity/cache/sockets on login/logout. Exercise storage-event, BroadcastChannel-only and both-signals-unavailable conditions; resolve any stale protected view before sign-off. Distinguish already-running work and Valkey failure. `AUTHN-04..05`, `CONC-07`; R-01.
- [ ] People directories pass same-department active-only filtering across users/operators/invites/chat pickers, guessed IDs, totals and pagination, with global `manage User` as the only global-directory exception. `AUTHZ-08`; R-31.
- [ ] Account create/invite/update reject a nonexistent department without an account or session side effect. Run both orders of concurrent account assignment and Department deletion on PostgreSQL; a record-limited delete grant must affect only its matching Department, and a revoked caller must not delete after waiting. Migration `0048` and its schema contract add the approved indexed `users.department_id -> departments.id ON DELETE RESTRICT` foreign key, preserve nullable unassignment and fail closed with an orphan report. Focused source/unit checks pass; execute the authored migration rehearsal and API/race assertions on disposable PostgreSQL before handoff. `DATA-07`, `CONC-07`; R-43 implementation complete, runtime evidence pending.
- [ ] Conditional Conversation grants are enforced on both current chat and legacy DM APIs: matching records alone are listed/read/changed, unmatched direct IDs leave messages and receipts unchanged, and only unconditional read can migrate an old DM row. Conditional `update Media` grants authorize only matching attachments; every chat attachment must also pass current stored Media read/owner-scope policy, including cross-department and restricted denials. Run authored route matrices on disposable PostgreSQL and complete the CMS journey before sign-off. `FUN-09`, `AUTHZ-02`, `AUTHZ-09`; R-19/R-33.
- [ ] Media/Layout/Presentation creator mutation, permitted same-department read, Schedule same-department action-specific management, cross-department denial, nested closure and ADMIN organization versus SUPER_ADMIN restricted classification pass for every actor/scope. Repeat conditional create/read/manage roles on the frozen build: creation scope, actual record checks and pre-pagination list totals must agree; ScheduleRequest detail/list/count/summary and reservation preview must exclude nonmatching records, and unsupported conditions fail closed. The shared policy has unit/build evidence, but database/API/browser and other subject-only route checks remain open. `AUTHZ-09..13`; R-02/R-25/R-26/R-27/R-32/R-33.
- [ ] User tombstone/email reuse/list exclusion/history display, owning-department deletion counts, UI confirmation/labels/action flags, no deleted-email disclosure, upload/finalization and PROCESSING-worker commit orders, duplicate-worker safety, non-reactivation and retryable source/ready/thumbnail object cleanup pass with evidence. `DATA-06`, `CONC-07`, `REL-02`, `UI-07`; R-25/R-28.
- [ ] Delegated emergencies are accessible in CMS and constrained to authorized direct Screens for trigger/status/history/clear; only unconditional global Emergency management controls group/global targets, while conditional Emergency/EmergencyType grants cannot open subject-wide authority; READY/readable media and transaction-time recheck pass. An exact 120-second authenticated-backend outage still stops every authority and erases only media cache. `AUTHZ-03`, `PLAYER-03..04`, `PLAYER-16`.
- [ ] Migration `0044` is rehearsed; the document page-count backfill dry-run is reviewed before apply; malformed/encrypted failures are resolved; rollback retains nullable compatibility columns until affected snapshots/PoP age out. `DATA-05`, `FILE-06`.
- [ ] Media upload, conversion, selected-page CMS preview, immutable snapshot, capable-player playback, page-aware PoP, webpage preview, chat and reports pass smoke/UAT on actual target hardware. `10_SMOKE_REGRESSION_UAT.md`.
- [ ] Video-only loop selection survives CMS draft/review/request and API/snapshot round trips; a short video completes at least three native cycles on one mounted occurrence, coexists with the selected PDF page, and stops at every hard boundary. Corrupt multi-item video shows `Unavailable` until its original boundary; a failed only-item frame retries once per clamped 1–30 second interval; no hidden audio, timer storm, stale callback or resource growth occurs. `UI-06`, `API-07`, `PLAYER-11..15`, `OBS-04`, `PERF-06`; R-24/R-40/R-41.
- [ ] **BLOCKER — BR-109 / PLAYER-17 / R-46:** emergency takeover video is continuous authority media. The working tree now derives video-only loop intent in the device snapshot and uses the existing player authority/lifecycle paths. Focused player/server/CMS developer tests and builds passed on 2026-10-27. Do not close this gate until Windows/Ubuntu physical-player evidence on the final immutable build proves time-zero start, three natural wraps on one mounted identity, harmless-refresh continuity, replacement start at zero, and clean clear/expiry/security-lock/disposal/shutdown restoration.
- [ ] Every target player is updated, has connected once and has advertised `pdf_page_selection_v1`; schedules using page >1 are blocked until that prerequisite is complete. Page 1 remains compatible while capability data is absent, but mixed-version playback is not an accepted release mode. `API-06`, `COMP-04`; R-22.
- [ ] Post-publish PDF page mismatch and CMS stale-page restoration meet BR-103: CMS preserves/blocks the invalid value; player shows exact `Unavailable`, emits safe requested/actual context, and never renders a substitute page. `UI-05`, `PLAYER-10`; R-39.
- [ ] Secure recovery meets BR-107: locked heartbeat only reports reachability/starts one recovery; identity validation, forced fresh snapshot, current-content sync/check and authority apply precede unlock; invalid identity re-pairs, snapshot failure remains locked with bounded retry, and stale authority never resumes. `PLAYER-03..04`, `PLAYER-16`; R-05/R-42.
- [ ] Release configuration explicitly records webpage HTTP decision, approved hosts, ports and private CIDRs. Source defaults remain fail-closed; enabling HTTP is accepted as cleartext risk. Every server/player node receives the same policy before new webpage content is published. `WEB-01..03`; R-35.
- [ ] Manual and 24-hour automatic preview refresh, failed-refresh preservation, snapshot/default revision propagation and revision-aware packaged-player fallback pass with real object storage. `WEB-04..06`, `PLAYER-09`; R-08/R-36.
- [ ] Default priority `0..100`, deterministic tie-break, direct-Screen precedence, legacy zero, edit preservation and two-writer stale conflict pass on the frozen database/CMS/player build. `FUN-06`, `DEF-01..03`; R-37.
- [ ] The approved standard company fallback asset is versioned in the release, resolves when no Schedule/default is eligible, renders online/offline on packaged physical players and survives restart/cache damage as specified. `DEF-04`, `PLAYER-05`; R-38.
- [ ] General Requests old URLs/OpenAPI/CMS/client/report/webhook surfaces are absent and legacy rows are not exposed; Schedule Requests still pass smoke. `AUTHZ-06`; R-18/R-34.
- [ ] Human policies remaining for BQ-013/014/015/016/017/018/019, BQ-020 Media/chat recycle behavior and BQ-021 SSO delegation are answered or accepted as explicit limits. BQ-011/012 are closed by BR-097..101 and BQ-027 architecture is confirmed; its repository/capacity/schedule/trust/inventory/failure-domain values remain required deployment evidence. A remaining TBD affecting recovery, capacity, credential visibility or critical playback cannot be silently converted to Pass.

## Mandatory Independent QA / Larger-Machine Gate

- [ ] The frozen production bundle proves the Packet 5A2c2 dual-listener and generated runner boundary on the actual Backend host: exact socket ownership/inodes, bind rollback, signal/drain behavior, immutable image/CID admission, static mount matrix, resource/free-space floors and public-trust copies. Developer fake-Docker/source checks do not close this gate. `BKP-31..32`; R-57.
- [ ] An isolated larger QA environment has executed load/stress/soak, simultaneous players/browsers, two-node realtime/Valkey failure/recovery, the full Data/Valkey/API/worker/CMS/Observability topology, Windows and physical displays, long video/PDF memory-growth runs, and production deployment plus backup/restore rehearsal. Required IDs: `PERF-01..06`, `AUTHN-04`, `CONC-03`, `CONC-08`, `REL-01..02`, `OBS-01..02`, `COMP-01..04`, `PLAYER-05`, `PLAYER-08`, `PLAYER-10..17`, `DEP-01..07`, `BKP-01..32`, `DATA-08`. Limited-workstation developer checks cannot close this gate.

## Decision Record

| Field | Human completion |
| --- | --- |
| Release and source commit | Pending |
| Site / environment and role generations | Pending |
| QA case evidence location | Pending |
| Approved capacity profile and workload | Pending |
| Restore rehearsal, RPO and RTO evidence | Pending |
| Open defects and risk exceptions | Pending |
| Product/security/operations approvers | Pending |
| Decision: Go / No-go / Conditional with owner and date | Pending |

## Packet 3 Gates

- [ ] Final-review corrections `BKP-37..44` have disposable PostgreSQL, signed HTTP/socket, actual producer archive, Docker and real `promtool` evidence. Developer fixtures (**76 focused tests; 485 full recovery tests**) do not close these live gates.

- [ ] Release-03 / migration 0057 compatibility and immutable release-01/0055 and release-02/0056 prefixes reviewed.
- [ ] Live trusted ciphertext download authorization, source-replacement, abort/backpressure and audit evidence attached (`BKP-33`).
- [ ] Deployment report signer/keyring custody and anti-rollback import rehearsal attached (`BKP-34`).
- [ ] Prometheus rule validation and alert fire/clear evidence attached (`BKP-35`).
- [ ] CMS operator-browser loading/error/denial/account-switch/download/report flow attached (`BKP-36`).
- [ ] Docker recovered-application E2E, split-host topology, production sizing, rollback rehearsal and measured RTO remain pending and are not waived by Packet 3 fixtures.

## Activation Packet A Gates

- [ ] Packet A remains disabled on production hosts; no effect adapter is installed or implied by static fixture success.
- [ ] Packet B real Packet 1 adapter receives independent security/release review and disposable source/hold/decrypt/import validation.
- [ ] Packet C Packet 2 adapter and disposable Docker application/promotion/rollback E2E pass before any enablement.
- [ ] Root-owned canonical activation/assets, local daemon/context/preloaded images, broker/keyring/recipient authority and exact mount/resource identities are verified on the approved host.
- [ ] Production-sized streaming/backpressure/cancellation/ENOSPC evidence is attached for `BKP-51`.

## Activation Packet B Gates

- [ ] Packet B executable, migration, private database credential, decrypt, object endpoint and SQL-validation assets are added to a separately signed activation revision; Packet A/tiny activation remains non-authoritative.
- [ ] `BKP-52..54` pass with real protected broker/keyrings, pinned age, disposable Docker/PostgreSQL/MinIO and producer ciphertext.
- [ ] Crash-before/after effects, SQL commit ambiguity, object corruption/resume, cancellation and ENOSPC are demonstrated without touching original targets.
- [ ] Packet C Packet 2 and application/promotion/rollback E2E remain open after Packet B acceptance.

## Activation Packet C Gates

- [ ] Separate release-03/0057 Packet C profile and all SQL/app/snapshot/promotion/E2E assets are signed and enrolled; historical release-02/0056 remains unchanged.
- [ ] Disposable PostgreSQL proves atomic reconciliation and exact receipt across every crash boundary, including session/pairing/command/outbox/job/backup/upload/schedule/emergency classes.
- [ ] Fixed API/CMS/browser/player cases, worker drain, writer fencing, promotion, acceptance and pre-write rollback pass on the tiny disposable environment.
- [ ] Post-write divergence preservation is rehearsed separately; no automatic lossless rollback claim is accepted.
- [ ] Production 4 GiB capacity, split-host/private TLS topology and measured RTO remain mandatory after tiny E2E and are not satisfied by it.

## Activation independent-review correction gates

- [x] Realistic bounded Docker stdout/stderr fixtures prove separate context/daemon/image/resource parsing and whole-absent versus partial target classification; no Docker process was started.
- [x] Developer fixtures prove the `0600` keyring composition, exact producer dump name, crash-after-create observation, durable restart baseline, final full-object verification, cancellation cleanup, immutable snapshots, fixed accept/rollback lock scope and atomic source binding (**82 focused; 519 full recovery**).
- [x] Final bounded fixtures reject host-bind/tmpfs mounts before normalization and prove terminate/join precedes cleanup of a genuinely stalled async generator; final correction totals are **83 focused; 520 full recovery**.
- [ ] Repeat Docker parser/error cases against the approved installed Docker version and local Unix daemon without widening the fixed command set.
- [ ] Repeat create-crash/database-baseline/object-corruption/source-race/snapshot-retry/accept-rollback concurrency against disposable Docker/PostgreSQL/MinIO and the protected deployment authority.
- [ ] Keep production activation disabled until the above evidence, signed assets, security review and release approval are attached; static fixture results do not authorize effects.

## Activation Packet D1 gates

- [x] Development-only fixed activation/entrypoint and injected readiness matrix pass; production CLI/package excludes Packet D1 and `run` is unavailable.
- [x] Report states `nonProduction=true`, `productionTopologySatisfied=false`, `splitHostSatisfied=false`, `rtoSatisfied=false`, preserves a 512 MiB host reserve and discloses the separate 4 GiB production minimum.
- [ ] Review and enroll exact local socket/context/daemon/version/root and PostgreSQL/MinIO/Valkey image identities in the fixed development activation.
- [ ] Run the read-only command on the approved development host and retain its secret-free report; any running container, current pressure or missing artifact blocks later work.
- [ ] Packet D2 or later effect execution requires separate approval and must not reinterpret D1 readiness as production, topology or RTO evidence.

## Activation Packet D2 gates

- [x] Exact disabled machine activation, requested resource caps, dataset ceiling/classes, typed stage methods, readiness recheck/order/resume/cleanup/report contracts and exact confirmation have developer fixtures.
- [ ] Enroll a reviewed real implementation for every typed effect method and its fixed asset hash; mocks/injected fixtures cannot enable the activation.
- [ ] Complete the D2 runbook pre-run checklist, then explicitly approve changing only the fixed activation to enabled.
- [ ] Execute one real disposable encrypted backup/restore and full API/CMS/headless-browser/player/worker/promotion/rollback sequence; retain journal, hashes, timings and cgroup/host pressure evidence.
- [ ] Confirm source/original targets unchanged and cleanup only exact retained resources after evidence. Keep production/native disabled and do not claim topology/RTO.

## Activation Packet D3 gates

- [x] Static developer fixtures cover the 2,592 MiB stage gate, D1-strict/retained-owned admission, physical/content separation, stop seal, retained resume measurements, fixed argv/env/cgroups, deterministic fixtures, 0057 seed, tool refusal, exact cleanup and distinct promotion/rollback actions.
- [x] Independent-review P2 correction adds full-process durable-prefix restart, measured D1+D3 readiness, supported config/file-secret isolation, official-image-shaped PG16 init/runtime, hash-bound launchers and a concrete exported Packet 1/2/promotion/rollback composition. Initial real-driver completeness wording is retracted in the D3 evidence addendum.
- [x] Final bounded correction validates the generated API/worker configuration with the actual production loader, binds restore to the durable V2 publication receipt, replaces invented CMS paths with supported routes/selectors, verifies player settings through the real loader, and gives the checked-in controller an executable typed entrypoint. Static results are 39/39 focused server and 1/1 player-loader; the post-change recovery regression is 520/520.
- [x] D3 foundation identity is derived from the real development runtime profile/schema and adapter files; examples, zero-filled/fabricated hashes and foreign operation/root/resource identities are rejected. This does not enroll missing Packet A/B/C workflow authority.
- [x] Enroll exact direct-file Node `v20.20.2`, Playwright `1.58.2` package/API/CLI/catalog + matching Chromium `145.0.7632.6`, and Electron package/binary `33.4.11` identities. Symlink-only launchers are rejected.
- [x] Packet D4 removes host crypto/codec installation from the D3 contract and adds a fixed, network-disabled runtime Docker tool boundary with typed age/ffmpeg operations and exact mount/resource/cancellation controls.
- [x] The separately authorized Packet D4 image enrollment is recorded (age 1.3.2-r1, ffmpeg 8.1.3-r0, exact image/digest/config/labels). D3 identity verification is enabled; D2 remains disabled and the installed whole-run factory fails with `CONTROLLED_RECOVERY_D3_DEPENDENCIES_NOT_ENROLLED`. No host age/ffmpeg installation is required.
- [x] Developer filesystem/fake-process coverage exercises durable age continuity, exact operation/profile binding, direct bounded Docker dispatch, foreign-name refusal, joined cleanup and protected publication concurrency/conflict/crash recovery. This is static foundation evidence only.
- [ ] Run the bounded container age identity/encrypt/decrypt continuity check and retain actual checksums/modes/cleanup evidence; this does not close backup/restore or application E2E gates.
- [x] The bounded check's original 0644 encrypted output was refused. A compiled fixed wrapper now applies umask 0077 before tool execution; root built it under 512 MiB, enrolled the observed identity and passed an exact-binary-hash rebuild with unchanged final image/config/digest. Versioned receipt rotation preserves the same private key and every prior public receipt. Static D1–D4/foundation/executor checks pass 84/84; the final crypto roundtrip still requires its own evidence.
- [ ] Enroll real source/services/broker reservation/trust/capsule/restore/runtime/app/promotion/rollback/cleanup boundaries and prove repository/artifact reverification. Typed seams and fixture success cannot close these gates.
- [x] Source subpacket 1 has a disabled strict profile, immutable stage/resource/stop journal and command lock, exact Docker ownership/parser/dispatch checks, source-service sequencing and authenticated TLS/negative-probe contracts. Temporary filesystem/fake-Docker cases pass; these are static contracts, not live source readiness or backup acceptance.
- [x] Independent-review P2 corrections reject foreign running/stopped source-volume consumers on other networks, retain created IDs before honoring cancellation without starting them, and resume exact mixed-running stop attempts. Source filesystem/fake-Docker cases pass 57/57; live source/backup acceptance remains open.
- [ ] Supply real retained TLS/secret layout, volume materialization, source executor/probes, current migrations/representative seed/object seal, production five-role capsule, transactional reservation and capture/encrypt/settlement providers before enabling any source/backup effect.
- [ ] Review disposable TLS/config/secrets, bridge IPs, loopback ports, cgroups, `DISPLAY=:0`, Firefox non-interference and retained-on-failure procedure before effect approval.
- [ ] Execute the approved tiny run and retain actual stage journals, duration/peak/swap evidence, encrypted backup/restore receipts, app/player checks, promotion/rollback evidence and exact cleanup IDs. Static fixtures do not close this gate.
