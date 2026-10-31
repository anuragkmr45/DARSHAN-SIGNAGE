# DARSHAN Human QA Planning Package

Controlled recovery Packet 2 developer status is tracked in
[its checklist](CONTROLLED_RECOVERY_PACKET2_CHECKLIST.md) and
[developer evidence](evidence/controlled-recovery-packet2-2026-10-30.md).
[Packet 3 reduced CMS/monitoring/evidence status](CONTROLLED_RECOVERY_PACKET3_CHECKLIST.md)
is tracked separately. Packet 3 developer fixtures do not close Docker E2E,
live repository streaming, production topology, RTO or QA gates.

Status: **QA PLANNING RECONCILIATION IN PROGRESS; not ready for QA handoff or
release approval.** The current static repository inventory and human-readable
product map are reconciled. The business-rule catalogue, unresolved questions,
risks, test catalogue and endpoint traceability now include backup Packet 3;
all 134 business-rule rows are catalogued. The first human-decision gate
has been reached: nine product/site answers in BQ-013..021 are required before
their linked acceptance results and downstream risk/test/release artefacts can
be finalized.
Packet 1 authorization/directory implementation is in the uncommitted working
tree. Its source/build/unit status and unexecuted live gates are tracked in
[Packet 1 developer verification](evidence/packet-01-permission-developer-verification-2026-10-22.md).
Backup/recovery Packet 1 is also present in the uncommitted working tree. Its
policy/coordination boundary, corrected review defects and bounded developer
results are recorded in [backup/recovery Packet 1 developer verification](evidence/backup-recovery-packet-01-developer-verification-2026-10-28.md).
Backup/recovery Packet 2 now adds the capture barrier/admission/gateway/telemetry/
emergency/raw-seal boundary; its corrected defects and bounded runtime are in
[backup/recovery Packet 2 developer verification](evidence/backup-recovery-packet-02-developer-verification-2026-10-28.md).
Backup/recovery Packet 3 adds tested encrypted-publication primitives; its
corrections, native-age checks and fail-closed production boundary are in
[backup/recovery Packet 3 developer verification](evidence/backup-recovery-packet-03-developer-verification-2026-10-28.md).
The worker-side signer/verifier/helper-policy/inspector composition is now wired, but
the actual privileged helper and exact cross-role capsule producer, Packet 4 retention,
Packets 5-7 restore/promotion/operator workflow, measured RPO/RTO and full
production-topology acceptance remain open.
The 2026-10-27 R-43 decision is now represented by migration `0048`: an
indexed nullable user-to-Department foreign key with `ON DELETE RESTRICT` and
a fail-closed legacy-orphan report. Its focused unit/build evidence passes;
the disposable PostgreSQL migration/API/race rehearsal remains required before
QA handoff.
The document/video/boundary/security-recovery upgrade has passed focused and
component automated checks/builds plus two current Linux Electron runs. The earlier live
requirements 1-18 run passed 1-17 but found that
the no-Schedule/no-default path does not show the required standard company
image (BR-102/DEF-04/R-38). Physical-player security recovery,
all-player deployment verification, capacity, soak and final release evidence
remain QA/release gates.

Application-source baseline: `release-01`
`db137152cdb8eda7ecf1f836df33e0373b9fc278`, matching
`origin/release-01` before the 2026-10-21 QA-document refresh. QA must receive
a reviewed commit containing the reconciled artifacts and frozen build hashes
before execution evidence is used for release approval. Earlier feature
evidence remains separately dated with its original pre-rebase identifiers.

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
3. [Business questions](02_BUSINESS_QUESTIONS.md): code answers for the original 20 questions plus BQ-021 on SSO delegation; BQ-022/023/024 record confirmed activation-before-login, replacement-link and no-invite-temporary-password decisions. BQ-008 also records the confirmed fail-closed startup role-identity decision; remaining human policy/site inputs are explicit.
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
20. [Confirmed business-rule reconciliation](evidence/confirmed-business-rule-reconciliation.md): current-source comparison for all 41 confirmed rules, including the four explicit conflicts that must carry into tests and release gates.
21. [Implemented-rule reconciliation, part 1](evidence/implemented-business-rule-reconciliation-part-1.md): current-source comparison for all 30 Access/Content and Scheduling/Device implemented rules, including five corrected stale descriptions.
22. [Implemented-rule reconciliation, part 2](evidence/implemented-business-rule-reconciliation-part-2.md): current-source comparison for all 22 Collaboration/Operations implemented rules, including five corrected stale or overbroad descriptions.
23. [Inferred/unresolved-rule reconciliation](evidence/inferred-unresolved-business-rule-reconciliation.md): Step 2C classification and current-source review for the final 12 rows, including the exact eight-answer human gate.
24. [Emergency video loop audit](evidence/emergency-video-loop-audit-2026-10-27.md): original source/history defect proof, the current derived video-only snapshot correction, focused developer coverage, remaining BR-109/R-46 risk and `PLAYER-17` packaged-player verification.
25. [Emergency video loop developer verification](evidence/emergency-video-loop-developer-verification-2026-10-27.md): revision, implementation boundary, exact resource-gated player/server/CMS results, corrected fixture/build findings and the deferred packaged physical-player gate without claiming QA approval.
26. [Backup/recovery Packet 1 developer verification](evidence/backup-recovery-packet-01-developer-verification-2026-10-28.md): exact policy/coordination implementation boundary, six review-found defect corrections, focused developer results and the later-packet/full-topology exclusion.
27. [Backup/recovery Packet 2 developer verification](evidence/backup-recovery-packet-02-developer-verification-2026-10-28.md): capture-barrier boundary, eight review/runtime defect corrections, 129 focused cases, real pg-boss expiry hold, signed gateway upload and combined runtime results, plus explicit Packets 3-7/player/production limits.
28. [Backup/recovery Packet 3 developer verification](evidence/backup-recovery-packet-03-developer-verification-2026-10-28.md): strict capsule/encryption/manifest/publication/reconciliation boundary, eight review-found corrections, refreshed 60/60 focused backup unit result plus earlier 32 DB/route/GC cases and native age positive/negative checks, worker helper/inspector composition, and the privileged-helper/cross-role-capsule/runtime gates that remain open.

The inventory is supporting evidence, not a completed authorization audit. Source references are repository-relative. Only results explicitly linked to the dated runtime report are current execution evidence; test-file presence and historical QA reports do not mean tests currently pass.

The 2026-10-15 requests supersede first-page-only documents and one-pass loop failure: authors choose one static page for each document occurrence, while missing legacy selections remain page 1; a loop-enabled video repeats complete native media cycles while its occurrence is active and stops at the schedule or higher-authority boundary. The latest authorization decisions protect the last active SUPER_ADMIN from delete/disable/demotion, scope non-global directories to active same-department people, enforce the explicit Media/Layout/Presentation/Schedule ownership matrix, classify ADMIN content as organization-shared and SUPER_ADMIN content as restricted, use effective permissions for custom roles, constrain emergency delegates to authorized direct screens, disable general Requests while retaining Schedule Requests, and withdraw obsolete REST/socket access immediately after commit.

The 2026-09-25 answer confirms administrator self-approval and direct publishing. The 2026-10-16 decisions resolve BQ-007 for the people directory and Media/Layout/Presentation/Schedule ownership, and BQ-020 for account tombstones: no automatic person reassignment, stable custody, retained historical creator, immediate access loss and stopped unfinished uploads. These source closures remain runtime test targets. Media/chat recycle behavior, BQ-021 SSO delegation granularity and explicitly listed site inputs remain TBD.

## Planning Deliverables

| File | Contents | Current status |
| --- | --- | --- |
| `00_SYSTEM_UNDERSTANDING.md` | Reconciled current system/product map and 29 use cases | Static Step 1 complete; runtime validation remains separate |
| `01_BUSINESS_RULES.md` | Classified rules and business sources | 47 confirmed, 78 implemented, 2 inferred and 7 unresolved rules; 134 stable IDs including backup/recovery Packet 3 BR-128..136 |
| `02_BUSINESS_QUESTIONS.md` | Questions, answers, affected expectations | Source answers complete; first human gate contains 9 explicit site/business decisions BQ-013..021; BQ-027 is resolved, with site values remaining deployment inputs |
| `03_RISK_REGISTER.csv` | 56 scored risks and risk-to-test links | R-47..56 cover backup policy/coordination, capture consistency, encrypted publication, key custody, retention and recovery failure domains |
| `04_MASTER_TEST_CHECKLIST.md` | Product and cross-cutting testing checklist | Provisional |
| `05_TEST_CASES.csv` | 155 detailed, human-executable cases | All 155 have Expected Result; 29 are Partially Tested, 125 are Not Tested and BKP-19 is Blocked pending Packet 7 |
| `06_TRACEABILITY_MATRIX.csv` | 176 requirement/use-case-to-test/risk rows | Includes BR-110..136 to BKP-04..30/CONC-08/DATA-08 and R-47..56 links |
| `07_SECURITY_CHECKLIST.md` | Authorized security verification plan, no execution | Provisional |
| `08_PERFORMANCE_RELIABILITY_CHECKLIST.md` | Load, stress, spike, soak, resilience and recovery plans | Provisional |
| `09_TEST_DATA_AND_ENVIRONMENT.md` | Data recipes, isolation, topology, tools, cleanup rules | Provisional |
| `10_SMOKE_REGRESSION_UAT.md` | Distinct smoke, regression, and UAT selections | Provisional |
| `11_RELEASE_READINESS_CHECKLIST.md` | Deployment, migrations, rollback, restore and release gates | Provisional |
| `12_CODE_BASELINE_EXPECTATIONS.md` | Code-derived expectations for all 20 business topics | Static baseline; not test results |
| `13_PRE_QA_DEVELOPMENT_PLAN.md` | Original deep plan, fast-smoke decision and later end-to-end developer closure | Historical closure recorded; P01 developer runtime gates remain open before QA handoff |

This file grouping covers all requested deliverables without duplicating the detailed cases. Suites reference the master case IDs rather than cloning cases. The detailed CSV has 157 data rows and all required planning fields are populated: Test ID, objective, preconditions, test data, steps, expected result, priority, risk level, design evidence, environment/dependencies and status. Actual Result, Execution Evidence and Defect ID fields remain blank for unexecuted cases; existing `Partially Tested` rows contain dated developer evidence, not independent QA approval.

Priority distribution: 124 P0, 32 P1 and 1 P2. Thirty-one cases are `Partially Tested`, 125 remain `Not Tested`, and `BKP-19` is `Blocked` until Packet 7 supplies the authorized UNCERTAIN-resolution workflow. All Packet 1 through Packet 3 human QA cases keep blank actual/evidence/defect fields. Developer automation is design evidence only. DEF-04 is Partially Tested because the developer runtime produced an explicit failure; this is not a QA Pass.

## Acceptance Controls

Packet D3/D4 developer evidence is static only: the Docker-only crypto/codec image and activation identity are enrolled, but effects remain unavailable because the concrete installed `DevelopmentD3SystemBoundaries`/workflow/runtime factory is deliberately absent and fail-closed. Exact Node/Playwright/Chromium/Electron host files remain enrolled; no host crypto/codec installation is part of the plan. These results must not be counted as a live backup/restore, Docker, browser/player, promotion/rollback, production topology or RTO pass.

The final D3 bounded correction additionally proves the fixed backend config with the real production validator, durable backup-publication-to-restore binding, supported CMS route/selector and player-loader contracts, and disabled checked-in controller entrypoint. These remain static/injected results and do not change the pending live gates.

- Record each answer against its BQ ID and cite that answer in the affected rule.
- Do not silently turn current implementation into the business requirement.
- Keep unknown SLOs, retention periods, capacity, RPO and RTO as TBD until agreed.
- A contradictory implementation becomes a suspected defect/test target, not an instruction to change the requirement.
- Cases include every requested design field and every row has an Expected Result. Developer evidence does not change a human QA Status to Pass. Defect ID remains QA-owned until a defect is filed.
- Record code-only outcomes before scoring acceptance. A source-predicted authorization gap is not a security pass; a conflict with a confirmed rule is a suspected defect even when runtime matches source.
- Audit coverage by role/action/resource, state transition, API operation, integration failure, user journey, data lifecycle, risk, and release path.
- Preserve explicit untested/uncovered limitations. Do not claim 100% behavioral coverage from a static inventory.

## How QA Uses This Package

1. Open `05_TEST_CASES.csv` and filter `Status`. For the backup/recovery delta start with `BKP-04..30`, `CONC-08` and `DATA-08`; treat `BKP-19` as a Packet 7 release dependency and `BKP-24`, `BKP-29`, `BKP-30` as dependent on the production helper/capsule and site trust inputs, then continue the remaining `Not Tested` rows. Re-run every `Partially Tested` row on the approved target matrix.
2. For each row, prepare the stated preconditions/test data, perform `Steps`, and compare the observation with `Expected Result`. The expected-result field is populated for all 155 cases; UI-03, PERF-01 and PERF-06 contain provisional `TBD` targets pending the relevant business/site answers.
3. Write what actually happened in `Actual Result`, set `Status`, link sanitized screenshots/logs/queries in `Execution Evidence`, and add a `Defect ID` when observed behavior differs.
4. Use `10_SMOKE_REGRESSION_UAT.md` to choose the smoke/regression/UAT order; use `06_TRACEABILITY_MATRIX.csv` to see which business rule and risk each case covers.
5. Do not approve release until the open items in `11_RELEASE_READINESS_CHECKLIST.md` have owners/evidence and the final Go/No-go decision is signed by the responsible humans.

## Inventory Method

The tracked-file index was obtained with Git. TypeScript syntax trees were read without executing application modules to enumerate explicit `fastify` route declarations, resolve their `apiEndpoints` strings, and enumerate CMS routes and Drizzle tables/enums. Existing tests were inventoried by tracked filename. Detailed analysis used targeted reads across handlers, policy helpers, repositories, services, schemas, migrations, renderer/main-process code, configuration loaders, release scripts, representative tests, and contracts.

The inventory excludes generated framework routes from its route count, and excludes SQL-only and pg-boss tables from its Drizzle-table count. It was refreshed for the document-page and video-loop source/test deltas, but is not a fresh semantic audit of every unrelated route. Vendored dependencies, generated builds, binary installers, local output/log directories, private configuration and credentials were not audited.
