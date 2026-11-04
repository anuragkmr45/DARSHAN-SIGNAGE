# DARSHAN Human QA Planning Package

> **Live runtime/authoring delta — 2026-11-03:** Backend run/admission/epoch/
> outbox authority, normal-player integration, CMS authoring/presenter/target
> reports and sixth-role packaging now have source implementations on
> `codex/live-screen-broadcast-planning-20261103`. Live runtime remains default
> **OFF**. Verification is partial; the actual native capture → current Backend/
> media → normal-player frame/audio journey and production host enforcement are
> still open. See [runtime/authoring developer evidence](evidence/live-runtime-authoring-developer-verification-2026-11-03.md) for final source/build bindings and bounded results.
> All `LIVE-01..20` remain **Not Tested**. No loop, beta or release approval is claimed.

Status: **PRE-QA DEVELOPMENT VERIFICATION IN PROGRESS; not release-approved.**
The document/video/boundary/security-recovery upgrade has passed focused and
component automated checks/builds plus two current Linux Electron runs. The earlier live
requirements 1-18 run passed 1-17 but found that
the no-Schedule/no-default path does not show the required standard company
image (BR-102/DEF-04/R-38). Physical-player security recovery,
all-player deployment verification, capacity, soak and final release evidence
remain QA/release gates.

Current observability/delivery candidate: branch
`codex/dashboard-observability-report-audit-20261102`, implementation and
developer-evidence tip `6a34b2f`, packaged as signed release
`2026-11-02-beta6`. The beta6 run passed focused server/CMS/player suites, a
source-free local deployment, and a packaged Linux player publish/apply/render/
proof-of-play journey. It did not execute the five-VM site, real Prometheus
player targets, physical displays, Windows, representative load, or production
restore gates. Exact results and checksums are in
`evidence/dashboard-observability-report-developer-verification-2026-11-02.md`.
QA must use the eventual merged commit and rebuilt artifact hashes; local
developer evidence is not independent release approval.

Chat/notification developer evidence on branch `codex/chat-notifications-runtime-20261103`
at commits `8413dd5` and `ed2bd2b` covers three simultaneous local CMS
sessions, two departments, message/notification journeys and selected file
sharing. The deeper human QA cases `CHAT-01..08` remain Not Tested; the CMS
member-removal control is a developer-observed gap. See
`evidence/chat-notifications-developer-verification-2026-11-03.md`.

A disposable local API/CMS/dependency stack, browser flow, real Linux Electron player, freshly migrated test database, focused DB-backed suite and Linux packaging command were executed on 2026-10-15 for the document-page and video-loop scope. Results and screenshots are in `evidence/runtime-2026-10-15/runtime-validation.md`. This targeted run did not execute the full product checklist, Windows/physical-hardware matrix, long soak, security assessment, penetration test, backup/restore rehearsal or production deployment.

On 2026-10-16, an isolated API/worker/PostgreSQL/Valkey/S3-compatible/CMS developer run exercised ownership, tombstones, every supported document extension, selected-page persistence/publication and loop-flag publication. It used RustFS rather than the exact approved MinIO image and stopped before migration `0045`, deterministic race/socket coverage, a valid final CMS page/loop browser result or current Linux Electron playback. Later low-memory builds and automated suites passed. Subsequent static passes masked deleted-user email in legacy Request history; made late upload validation conditional; prevented a late document/video/webpage worker from changing deletion-stopped PROCESSING Media back to READY; and made stale produced-object/thumbnail cleanup retryable. The new database/object-store regressions are authored but unexecuted. See `evidence/runtime-2026-10-16/runtime-validation.md` and `evidence/deleted-user-ownership-review.md`. This remains partial developer evidence; QA execution fields stay independent.

A later resource-bounded closure cycle completed on 2026-10-17 and supersedes those
specific execution gaps: migration `0045` rehearsal, affected DB-backed routes,
CMS browser flows, all player automation and a built API smoke were executed.
It found and fixed a multipart authorization-revocation cleanup defect. See
`evidence/runtime-2026-10-16/authorization-end-to-end-devqa.md` for exact
results and the smaller remaining QA/release boundary. QA-owned result fields
remain independent.

On 2026-10-17, a fresh disposable API/database/Valkey/S3-compatible
storage/worker/Chromium run exercised the 18 requested access, ownership,
emergency, Requests, session, webpage and default behaviours. Requirements
1-17 passed the bounded scenarios. Requirement 18 failed in both the live API
response and current player renderer: it produced a text-only empty state, not
the required company fallback image. See
`evidence/runtime-2026-10-17/runtime-validation.md`.

Also on 2026-10-17, requirements 19-24 were implemented and exercised through
focused and component automation. A disposable built-API/worker stack ingested
real PDF/video fixtures and the current player CLI completed pairing, but the
Electron/CMS visual phase was stopped because free swap was below the agreed
launch gate. See
`evidence/playback-recovery-developer-verification-2026-10-21.md`. This record
must not be read as runtime completion or independent QA approval.

## Read First

1. [System understanding](00_SYSTEM_UNDERSTANDING.md): product boundaries, personas, use cases, state models, dependencies, and analysis limits.
2. [Business rule catalogue](01_BUSINESS_RULES.md): confirmed, implemented, inferred, and unresolved rules, with repository evidence.
3. [Business questions](02_BUSINESS_QUESTIONS.md): code answers for all 20 questions and the remaining human policy/site inputs.
4. [Static source inventory](evidence/repository-inventory.json): explicit API registrations, CMS route declarations, schema tables/enums, SQL migration paths, and existing test-file paths.
5. [Policies versus actual code](evidence/policy-behavior-review.md): requested source-level recheck of administrator access, emergency delegation, two-minute lock/purge, fixed roles and session revocation.
6. [Content and player behavior](evidence/content-runtime-review.md): current sharing/authorization, webpages, default selection and PoP behavior, kept separate from business approval.
7. [Operational behavior](evidence/operational-behavior-review.md): reports, retention, platform, capacity, recovery, network and delete findings from source.
8. [Code-derived expectations](12_CODE_BASELINE_EXPECTATIONS.md): source-behavior baseline for BQ-001 through BQ-020, including confirmed-rule conflicts.
9. [Document page selection review](evidence/document-page-selection-review.md): 2026-10-15 architecture, implementation flow, simulation matrix, static verification and runtime gaps.
10. [Video loop playback review](evidence/video-loop-playback-review.md): 2026-10-15 CMS/API/player flow, multi-pass corner-case simulation, static verification and runtime gates.
11. [Deleted-user ownership review](evidence/deleted-user-ownership-review.md): stable owner/tombstone architecture, source anchors, multi-pass corner cases, static verification and mandatory runtime gates.
12. [Targeted runtime validation](evidence/runtime-2026-10-15/runtime-validation.md): disposable CMS/API/Electron results, screenshots, test/build gates, defects found and remaining release gaps.
13. [2026-10-16 developer validation](evidence/runtime-2026-10-16/runtime-validation.md) and its [environment manifest](evidence/runtime-2026-10-16/environment-manifest.md): partial ownership, ingestion, page/loop publication and current low-memory automated evidence, source/lock/migration hashes, plus explicit invalid/incomplete runtime attempts.
14. [Pre-QA development completion plan](13_PRE_QA_DEVELOPMENT_PLAN.md): ordered implementation, automated-test, migration, disposable-runtime and handoff gates for ownership/tombstones, document page selection and video looping.
15. [Fast developer smoke handoff](evidence/runtime-2026-10-16/fast-developer-smoke.md): the final bounded 2026-10-16 checks, exact results, exclusions and QA execution order.
16. [Authorization/session/Requests review](evidence/authorization-session-requests-review.md): the final 12-area expected-behavior matrix, source anchors, multi-pass corner cases, bounded developer verification and runtime exclusions.
17. [Authorization and playback developer-QA closure](evidence/runtime-2026-10-16/authorization-end-to-end-devqa.md): final multi-loop server/database/API/browser/player results, defect corrections, catalogue integrity and explicit independent-QA gaps.
18. [Requirements 1-18 live runtime validation](evidence/runtime-2026-10-17/runtime-validation.md): exact built-API/worker/Chromium observations, machine-readable results, cleanup and the requirement 18 release blocker.
19. [Playback/recovery developer verification](evidence/playback-recovery-developer-verification-2026-10-21.md): requirements 19-24 implementation, automated results, two Linux Electron runs, selected screenshots and remaining independent-QA gates.
20. [Player delivery, availability and observability developer verification](evidence/dashboard-observability-report-developer-verification-2026-11-02.md): beta6 automated, source-free and packaged-player evidence plus the exact five-VM and physical-player gates still open.
21. [Chat and notification developer verification](evidence/chat-notifications-developer-verification-2026-11-03.md): local three-session behavior, corrected defects, automated checks and remaining independent QA gates. Execute `CHAT-01..08` for the human matrix.
22. [Live publication/authorization developer verification](evidence/live-publication-authorization-developer-verification-2026-11-03.md): capability-gated frozen request/direct publication, scoped reads, real-service immutable downloads and source UI observations; the normal-player broadcast workflow and independent `LIVE-01..20` execution remain open.
23. [Live recovery prerequisite developer verification](evidence/live-recovery-prerequisites-developer-verification-2026-11-03.md): historical `e546630` desired-state, publication, cache and fixture-SFU checkpoint; it predates the current runtime integration.
24. [runtime/authoring developer evidence](evidence/live-runtime-authoring-developer-verification-2026-11-03.md): current default-OFF runtime/authoring/media/deployment source packet, actual bounded CMS approval journey, source/build bindings and remaining integrated/release gates.

The inventory is supporting evidence, not a completed authorization audit. Source references are repository-relative. Only results explicitly linked to the dated runtime report are current execution evidence; test-file presence and historical QA reports do not mean tests currently pass.

The 2026-10-15 requests supersede first-page-only documents and one-pass loop failure: authors choose one static page for each document occurrence, while missing legacy selections remain page 1; a loop-enabled video repeats complete native media cycles while its occurrence is active and stops at the schedule or higher-authority boundary. The latest authorization decisions protect the last active SUPER_ADMIN from delete/disable/demotion, scope non-global directories to active same-department people, enforce the explicit Media/Layout/Presentation/Schedule ownership matrix, classify ADMIN content as organization-shared and SUPER_ADMIN content as restricted, use effective permissions for custom roles, constrain emergency delegates to authorized direct screens, disable general Requests while retaining Schedule Requests, and withdraw obsolete REST/socket access immediately after commit.

The 2026-09-25 answer confirms administrator self-approval and direct publishing. The 2026-10-16 decisions resolve BQ-007 for the people directory and Media/Layout/Presentation/Schedule ownership, and BQ-020 for account tombstones: no automatic person reassignment, stable custody, retained historical creator, immediate access loss and stopped unfinished uploads. These source closures remain runtime test targets. Media/chat recycle behavior and explicitly listed site inputs remain TBD.

## Planning Deliverables

| File | Contents | Current status |
| --- | --- | --- |
| `00_SYSTEM_UNDERSTANDING.md` | System understanding and 32 use cases | Provisional |
| `01_BUSINESS_RULES.md` | Classified rules and business sources | BQ-014 availability/evidence semantics and BR-103..107 playback/recovery decisions are reconciled; all human QA gates remain explicit |
| `02_BUSINESS_QUESTIONS.md` | Questions, answers, affected expectations | Source answers complete; site and business inputs still TBD |
| `03_RISK_REGISTER.csv` | 51 scored risks and risk-to-test links | R-38 remains an observed release blocker; R-39..42 cover requirements 20-24 |
| `04_MASTER_TEST_CHECKLIST.md` | Product and cross-cutting testing checklist | Reconciled for beta6 delivery, availability, player scrape and Grafana paths; human execution remains open |
| `05_TEST_CASES.csv` | 150 detailed, human-executable cases | All 150 have Expected Result; 30 are Partially Tested from dated developer evidence and 120 are Not Tested, including `LIVE-01..20` |
| `06_TRACEABILITY_MATRIX.csv` | 152 requirement/use-case-to-test/risk rows | Latest playback/recovery rules, cases and risks are explicitly traced |
| `07_SECURITY_CHECKLIST.md` | Authorized security verification plan, no execution | Provisional |
| `08_PERFORMANCE_RELIABILITY_CHECKLIST.md` | Load, stress, spike, soak, resilience and recovery plans | Provisional |
| `09_TEST_DATA_AND_ENVIRONMENT.md` | Data recipes, isolation, topology, tools, cleanup rules | Provisional |
| `10_SMOKE_REGRESSION_UAT.md` | Distinct smoke, regression, and UAT selections | Provisional |
| `11_RELEASE_READINESS_CHECKLIST.md` | Deployment, migrations, rollback, restore and release gates | Provisional |
| `12_CODE_BASELINE_EXPECTATIONS.md` | Code-derived expectations for all 20 business topics | Static baseline; not test results |
| `13_PRE_QA_DEVELOPMENT_PLAN.md` | Original deep plan, fast-smoke decision and later end-to-end developer closure | Developer closure complete; listed cross-node/platform/security/recovery/soak gates remain with QA/release validation |

This file grouping covers all requested deliverables without duplicating the detailed cases. Suites reference the master case IDs rather than cloning cases. The detailed CSV has 150 data rows and all required planning fields are populated: Test ID, objective, preconditions, test data, steps, expected result, priority, risk level, design evidence, environment/dependencies and status. QA-owned Actual Result, Execution Evidence and Defect ID fields intentionally remain blank for unexecuted cases.

Priority distribution: 114 P0, 35 P1 and 1 P2. Thirty cases are `Partially Tested` and 120 remain `Not Tested`; the new chat cases include developer evidence in Notes but retain empty QA-owned result fields. The playback/recovery cases contain developer automation evidence but still require the listed Electron/physical execution. Case DEF-04 is Partially Tested because the developer runtime produced an explicit failure; this is not a QA Pass.

## Acceptance Controls

- Record each answer against its BQ ID and cite that answer in the affected rule.
- Do not silently turn current implementation into the business requirement.
- Keep unknown SLOs, retention periods, capacity, RPO and RTO as TBD until agreed.
- A contradictory implementation becomes a suspected defect/test target, not an instruction to change the requirement.
- Cases include every requested design field and every row has an Expected Result. Developer evidence does not change a human QA Status to Pass. Defect ID remains QA-owned until a defect is filed.
- Record code-only outcomes before scoring acceptance. A source-predicted authorization gap is not a security pass; a conflict with a confirmed rule is a suspected defect even when runtime matches source.
- Audit coverage by role/action/resource, state transition, API operation, integration failure, user journey, data lifecycle, risk, and release path.
- Preserve explicit untested/uncovered limitations. Do not claim 100% behavioral coverage from a static inventory.

## How QA Uses This Package

1. Open `05_TEST_CASES.csv` and filter `Status`. For the chat delta run `CHAT-01..08`, `FUN-09..10` and `CONC-04` with three independent CMS profiles; the first full QA run must address the absent member-removal control. For the beta6 delta start with `FUN-11`, `UI-04`, `OBS-02`, `PLAYER-07`, then run the delivery/playback paths in `FUN-03..05` and the relevant player cases. Retain `API-06`, `UI-05`, `PLAYER-03..04`, `PLAYER-10..16`, `COMP-04` and `OBS-04` for the earlier playback/recovery delta, then continue every remaining `Not Tested` row. Re-run every `Partially Tested` row on the approved target matrix.
2. For each row, prepare the stated preconditions/test data, perform `Steps`, and compare the observation with `Expected Result`. The expected-result field is populated for all 150 cases.
3. Write what actually happened in `Actual Result`, set `Status`, link sanitized screenshots/logs/queries in `Execution Evidence`, and add a `Defect ID` when observed behavior differs.
4. Use `10_SMOKE_REGRESSION_UAT.md` to choose the smoke/regression/UAT order; use `06_TRACEABILITY_MATRIX.csv` to see which business rule and risk each case covers.
5. Do not approve release until the open items in `11_RELEASE_READINESS_CHECKLIST.md` have owners/evidence and the final Go/No-go decision is signed by the responsible humans.

## Inventory Method

The tracked-file index was obtained with Git. TypeScript syntax trees were read without executing application modules to enumerate explicit `fastify` route declarations, resolve their `apiEndpoints` strings, and enumerate CMS routes and Drizzle tables/enums. Existing tests were inventoried by tracked filename. Detailed analysis used targeted reads across handlers, policy helpers, repositories, services, schemas, migrations, renderer/main-process code, configuration loaders, release scripts, representative tests, and contracts.

The inventory excludes generated framework routes from its route count, and excludes SQL-only and pg-boss tables from its Drizzle-table count. The semantic QA documents were refreshed for the document/video, beta6 delivery/availability/observability and scoped live-publication deltas, but this is not a new audit of every unrelated route. The original repository-inventory JSON is a historical source snapshot; current live module/API details and evidence are in the live contract and dated publication report. Vendored dependencies, generated builds, binary installers, local output/log directories, private configuration and credentials were not audited.

## Live broadcast implementation delta — 2026-11-03

Current catalog integrity at this delta: **150 cases**, **51
risks**, **152 traceability rows**; 120 Not Tested,
30 Partially Tested and no independent QA Pass.
New scope is `UC-030..032`, `BR-109..116`, `BQ-027`, `R-44..51`, `LIVE-01..20`.

The accepted final feature is a scheduled live event/media source in the same ordinary
installed DARSHAN desktop player and normal pairing/lifecycle/cache/emergency.
The temporary prototype is a technical gate. Current code additionally implements
source authoring, immutable fallback preparation and capability-gated frozen
request/direct publication. The actual running-service verifier passed 55
supporting checks and 15 SHA-verified image/PDF/video downloads. Root observed
source UI create/view/audio edits/retry and same-admin stale-tab recovery.
Checkpoint `e546630` additionally verifies current presenter publish permission,
nullable live-version preservation across writers and callers, strict injected
media fencing and exact-asset fallback repair. Its final source-bound publication
repeat passed 55 checks/15 SHA downloads; cache units passed 464 plus 5 integration/
21 fault checks, and media protocol evidence used an isolated fixture authority.
These are prerequisite/component results. At those historical publication/prerequisite checkpoints, production run authority
and normal-player/CMS integration were still pending. They now have source
implementations as described in the current checkpoint below; actual integrated
frame/audio, production host pidfd/AppArmor and independent acceptance remain open. See the dated prerequisite and
publication reports for exact sources, developer build hashes and remaining gates.

Use [contract](../docs/contracts/live-broadcast.md), [execution loops](../docs/plans/live-broadcast-implementation-loops.md) and
[developer ledger](evidence/live-broadcast-developer-verification-2026-11-03.md). The expected behavior is accepted; code and
runtime verification remain in progress. Add runtime results only with exact
source/artifact/environment identifiers. Keep QA-owned fields independent and
all existing release blockers visible. The repository-local
[qa-master-checklist skill](../.codex/skills/qa-master-checklist/SKILL.md) separates
developer evidence from independent human results and governs this refresh.

## Runtime and authoring developer checkpoint — 2026-11-03

The current packet is **implemented in source, default OFF, partially developer-verified**. It is not a closed implementation loop, beta acceptance or release approval. [runtime/authoring developer evidence](evidence/live-runtime-authoring-developer-verification-2026-11-03.md) owns the exact source/build bindings and final evolving check totals. Historical reports retain their original source scope; an older SFU/prototype result cannot validate the new authority/host-readiness/player source. All `LIVE-01..20` remain **Not Tested** and QA-owned execution/result/defect/sign-off fields remain unchanged.

Actual CMS developer observation: source creation → fallback READY → saved draft/reopen → revision1 review with rendered image → one submitted request → frozen request preview → Approve/Publish success for a future window and one synthetic screen. The existing paired baseline was untouched. This does not demonstrate native capture, a receiver connection/frame/audio or physical display/PoP.

Bounded automated results: Backend runtime 43/4 and neighbors 79/7; authoring 22/22 (after a21-pass/1-fail conditional-Schedule repro and fix); request preview 7/7; targets 6/6; media Node 108 pass/8 opt-in skipped. CMS 248/39 passed before the final create-only consent/page-gate corrections; later final full/build results must be read from the dated ledger. Normal-player source integration is present, with final gates recorded by its owner. Deployment fixtures passed 18 combined configuration/Compose checks (17 configuration + 1 Compose), 11 host-witness and 16 watchdog checks, including signed optional-role fixture validation with Docker deliberately skipped; they are not an installed production artifact.

Open gates include current native CMS capture/audio → configured Backend/media → newly built ordinary player, root-owned RO tmpfs host-readiness/death witness, native host pidfd/AppArmor, Windows/physical/cross-VM TLS/firewall, 10×25 capacity/soak, restore and independent human acceptance. No sudo authentication or safe native root-owned mount proof was available in this checkpoint.

### Current LIVE QA handoff — 2026-11-03

The later [developer ledger](evidence/live-broadcast-developer-verification-2026-11-03.md)
records a local current-source CMS capture through Media to a decoded frame on
the ordinary packaged Linux player, Stop/fallback/restart, schedule-end timing
and bounded regression. This supersedes the older partial checkpoint above.
The [master checklist](04_MASTER_TEST_CHECKLIST.md) now spells out independent
`LIVE-01..20` execution plus cross-VM TLS/media, actual Chrome/Edge and Windows,
physical display/audio, measured 10×25 and isolated restore gates. All 20 CSV
results remain `Not Tested`. The separate local Firefox retry was dropped;
Firefox was not verified or added to the BQ-027 release support matrix.

The [Screen detail permission developer record](evidence/product-ui-screen-detail-permissions-developer-verification-2026-11-04.md) covers record-scoped detail reads and writes, the view-only CMS inspector, a fixture screenshot, and focused local regression. Real role actors and a physical player remain QA work.

The [Screen aggregate scope developer record](evidence/product-ui-screen-aggregate-scope-developer-verification-2026-11-04.md) covers the Dashboard's accessible drill-down rows, Group membership filtering and no-ID socket sync. It keeps site-wide KPI semantics explicit and leaves matched-build role withdrawal and large-fleet QA open.
