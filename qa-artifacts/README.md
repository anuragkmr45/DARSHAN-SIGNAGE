# DARSHAN Human QA Planning Package

Status: **READY FOR INDEPENDENT QA EXECUTION; not release-approved.** The authorization/ownership/emergency/Requests/session implementation is complete in source through `8f66d8f`; server/CMS builds and bounded automated/static checks passed. The application was deliberately not started for this change set. Browser, database/migration, multi-process socket, deterministic race and end-to-end evidence remain QA/release gates.

Repository baseline: `release-01` source through commit `8f66d8f`. Earlier document-page, video-loop and ownership evidence remains historical baseline material and is traced separately.

A disposable local API/CMS/dependency stack, browser flow, real Linux Electron player, freshly migrated test database, focused DB-backed suite and Linux packaging command were executed on 2026-10-15 for the document-page and video-loop scope. Results and screenshots are in `evidence/runtime-2026-10-15/runtime-validation.md`. This targeted run did not execute the full product checklist, Windows/physical-hardware matrix, long soak, security assessment, penetration test, backup/restore rehearsal or production deployment.

On 2026-10-16, an isolated API/worker/PostgreSQL/Valkey/S3-compatible/CMS developer run exercised ownership, tombstones, every supported document extension, selected-page persistence/publication and loop-flag publication. It used RustFS rather than the exact approved MinIO image and stopped before migration `0045`, deterministic race/socket coverage, a valid final CMS page/loop browser result or current Linux Electron playback. Later low-memory builds and automated suites passed. Subsequent static passes masked deleted-user email in legacy Request history; made late upload validation conditional; prevented a late document/video/webpage worker from changing deletion-stopped PROCESSING Media back to READY; and made stale produced-object/thumbnail cleanup retryable. The new database/object-store regressions are authored but unexecuted. See `evidence/runtime-2026-10-16/runtime-validation.md` and `evidence/deleted-user-ownership-review.md`. This remains partial developer evidence; QA execution fields stay independent.

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

The inventory is supporting evidence, not a completed authorization audit. Source references are repository-relative. Only results explicitly linked to the dated runtime report are current execution evidence; test-file presence and historical QA reports do not mean tests currently pass.

The 2026-10-15 requests supersede first-page-only documents and one-pass loop failure: authors choose one static page for each document occurrence, while missing legacy selections remain page 1; a loop-enabled video repeats complete native media cycles while its occurrence is active and stops at the schedule or higher-authority boundary. The latest authorization decisions protect the last active SUPER_ADMIN from delete/disable/demotion, scope non-global directories to active same-department people, enforce the explicit Media/Layout/Presentation/Schedule ownership matrix, classify ADMIN content as organization-shared and SUPER_ADMIN content as restricted, use effective permissions for custom roles, constrain emergency delegates to authorized direct screens, disable general Requests while retaining Schedule Requests, and withdraw obsolete REST/socket access immediately after commit.

The 2026-09-25 answer confirms administrator self-approval and direct publishing. The 2026-10-16 decisions resolve BQ-007 for the people directory and Media/Layout/Presentation/Schedule ownership, and BQ-020 for account tombstones: no automatic person reassignment, stable custody, retained historical creator, immediate access loss and stopped unfinished uploads. These source closures remain runtime test targets. Media/chat recycle behavior and explicitly listed site inputs remain TBD.

## Planning Deliverables

| File | Contents | Current status |
| --- | --- | --- |
| `00_SYSTEM_UNDERSTANDING.md` | System understanding and 29 use cases | Provisional |
| `01_BUSINESS_RULES.md` | Classified rules and business sources | Latest authorization decisions are BR-091..096; all 20 questions retain source review |
| `02_BUSINESS_QUESTIONS.md` | Questions, answers, affected expectations | Source answers complete; site and business inputs still TBD |
| `03_RISK_REGISTER.csv` | 34 scored risks and risk-to-test links | Structurally validated; runtime disposition pending |
| `04_MASTER_TEST_CHECKLIST.md` | Product and cross-cutting testing checklist | Provisional |
| `05_TEST_CASES.csv` | 102 detailed, human-executable cases | All 102 have Expected Result; 22 are Partially Tested from dated developer evidence and 80 are Not Tested |
| `06_TRACEABILITY_MATRIX.csv` | 131 requirement/use-case-to-test/risk rows | Structurally validated; latest authorization rows are explicitly traced |
| `07_SECURITY_CHECKLIST.md` | Authorized security verification plan, no execution | Provisional |
| `08_PERFORMANCE_RELIABILITY_CHECKLIST.md` | Load, stress, spike, soak, resilience and recovery plans | Provisional |
| `09_TEST_DATA_AND_ENVIRONMENT.md` | Data recipes, isolation, topology, tools, cleanup rules | Provisional |
| `10_SMOKE_REGRESSION_UAT.md` | Distinct smoke, regression, and UAT selections | Provisional |
| `11_RELEASE_READINESS_CHECKLIST.md` | Deployment, migrations, rollback, restore and release gates | Provisional |
| `12_CODE_BASELINE_EXPECTATIONS.md` | Code-derived expectations for all 20 business topics | Static baseline; not test results |
| `13_PRE_QA_DEVELOPMENT_PLAN.md` | Original deep plan plus the superseding fast developer-smoke handoff decision | Fast developer smoke complete; deep runtime gates transferred to QA/release validation |

This file grouping covers all requested deliverables without duplicating the detailed cases. Suites reference the master case IDs rather than cloning cases. The detailed CSV has 102 data rows and all required planning fields are populated: Test ID, objective, preconditions, test data, steps, expected result, priority, risk level, design evidence, environment/dependencies and status. QA-owned Actual Result, Execution Evidence and Defect ID fields intentionally remain blank for unexecuted cases.

Priority distribution: 67 P0, 34 P1 and 1 P2. Twenty-two cases are `Partially Tested` from dated developer runs and 80 remain `Not Tested`; the new authorization cases remain Not Tested despite successful bounded developer checks. None is promoted to Pass by inference.

## Acceptance Controls

- Record each answer against its BQ ID and cite that answer in the affected rule.
- Do not silently turn current implementation into the business requirement.
- Keep unknown SLOs, retention periods, capacity, RPO and RTO as TBD until agreed.
- A contradictory implementation becomes a suspected defect/test target, not an instruction to change the requirement.
- Cases include every requested design field and every row has an Expected Result. The 22 cases touched by dated developer runs remain `Partially Tested`; all 80 others remain `Not Tested`. Defect ID remains QA-owned until a defect is filed.
- Record code-only outcomes before scoring acceptance. A source-predicted authorization gap is not a security pass; a conflict with a confirmed rule is a suspected defect even when runtime matches source.
- Audit coverage by role/action/resource, state transition, API operation, integration failure, user journey, data lifecycle, risk, and release path.
- Preserve explicit untested/uncovered limitations. Do not claim 100% behavioral coverage from a static inventory.

## How QA Uses This Package

1. Open `05_TEST_CASES.csv` and filter `Status`. Start with the 80 `Not Tested` rows—especially `AUTHN-04`, `AUTHZ-01..03`, `AUTHZ-06`, `AUTHZ-08..13` and `CONC-07`; re-run the 22 `Partially Tested` rows on the approved target matrix.
2. For each row, prepare the stated preconditions/test data, perform `Steps`, and compare the observation with `Expected Result`. The expected-result field is populated for all 102 cases.
3. Write what actually happened in `Actual Result`, set `Status`, link sanitized screenshots/logs/queries in `Execution Evidence`, and add a `Defect ID` when observed behavior differs.
4. Use `10_SMOKE_REGRESSION_UAT.md` to choose the smoke/regression/UAT order; use `06_TRACEABILITY_MATRIX.csv` to see which business rule and risk each case covers.
5. Do not approve release until the open items in `11_RELEASE_READINESS_CHECKLIST.md` have owners/evidence and the final Go/No-go decision is signed by the responsible humans.

## Inventory Method

The tracked-file index was obtained with Git. TypeScript syntax trees were read without executing application modules to enumerate explicit `fastify` route declarations, resolve their `apiEndpoints` strings, and enumerate CMS routes and Drizzle tables/enums. Existing tests were inventoried by tracked filename. Detailed analysis used targeted reads across handlers, policy helpers, repositories, services, schemas, migrations, renderer/main-process code, configuration loaders, release scripts, representative tests, and contracts.

The inventory excludes generated framework routes from its route count, and excludes SQL-only and pg-boss tables from its Drizzle-table count. It was refreshed for the document-page and video-loop source/test deltas, but is not a fresh semantic audit of every unrelated route. Vendored dependencies, generated builds, binary installers, local output/log directories, private configuration and credentials were not audited.
