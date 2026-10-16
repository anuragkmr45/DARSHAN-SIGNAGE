# DARSHAN Human QA Planning Package

Status: **READY FOR INDEPENDENT QA EXECUTION after the user-approved fast developer smoke; not release-approved.** Targeted historical PDF/video Linux runtime evidence and partial 2026-10-16 ownership/document API/CMS developer evidence are retained. Migration `0045`, deterministic races/sockets, final CMS/browser and Linux Electron runs, exact dependency-image validation and stability gates are assigned to QA/deep validation and remain open release gates.

Repository baseline: `release-01`, commit `e721c2ab0c8b94af95b6914810a0c6788899e318`, plus the deleted-user ownership working-tree implementation reviewed 2026-10-16. Earlier repository-wide evidence remains historical baseline material; the document-page, video-loop and ownership deltas are traced separately.

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

The inventory is supporting evidence, not a completed authorization audit. Source references are repository-relative. Only results explicitly linked to the dated runtime report are current execution evidence; test-file presence and historical QA reports do not mean tests currently pass.

The 2026-10-15 requests supersede first-page-only documents and one-pass loop failure: authors choose one static page for each document occurrence, while missing legacy selections remain page 1; a loop-enabled video repeats complete native media cycles while its occurrence is active and stops at the schedule or higher-authority boundary. Other confirmed answers remain management-only integrations, excluded general Requests, protected deletion of every SUPER_ADMIN, all-user-role management by SUPER_ADMIN, screen-permission emergency delegation, a two-minute offline lock with media erasure/emergency stop, fixed built-in roles with custom-role customization, and immediate withdrawal of obsolete session access.

The 2026-09-25 answer confirms administrator self-approval and direct publishing. The 2026-10-16 decision resolves BQ-007 for Media/Layout/Presentation/Schedule stable ownership and BQ-020 for account tombstones: no automatic person reassignment, original department/organization custody, retained historical creator, immediate access loss and stopped unfinished uploads. The former Presentation authorization gap is closed in source and remains a runtime test target. OPERATOR-directory privacy, Media/chat recycle behavior and other explicitly listed business/site inputs remain TBD.

## Planning Deliverables

| File | Contents | Current status |
| --- | --- | --- |
| `00_SYSTEM_UNDERSTANDING.md` | System understanding and 29 use cases | Provisional |
| `01_BUSINESS_RULES.md` | Classified rules and business sources | 90 rules; all 20 questions have source review |
| `02_BUSINESS_QUESTIONS.md` | Questions, answers, affected expectations | Source answers complete; site and business inputs still TBD |
| `03_RISK_REGISTER.csv` | 29 scored risks and risk-to-test links | Provisional |
| `04_MASTER_TEST_CHECKLIST.md` | Product and cross-cutting testing checklist | Provisional |
| `05_TEST_CASES.csv` | 96 detailed, human-executable cases | Structurally complete; 22 cases have dated developer evidence and are Partially Tested, while 74 remain Not Tested; developer evidence does not claim QA results |
| `06_TRACEABILITY_MATRIX.csv` | 120 requirement/use-case-to-test/risk rows | Planned; relevant ownership rows identify partial disposable developer execution and the remaining runtime gaps |
| `07_SECURITY_CHECKLIST.md` | Authorized security verification plan, no execution | Provisional |
| `08_PERFORMANCE_RELIABILITY_CHECKLIST.md` | Load, stress, spike, soak, resilience and recovery plans | Provisional |
| `09_TEST_DATA_AND_ENVIRONMENT.md` | Data recipes, isolation, topology, tools, cleanup rules | Provisional |
| `10_SMOKE_REGRESSION_UAT.md` | Distinct smoke, regression, and UAT selections | Provisional |
| `11_RELEASE_READINESS_CHECKLIST.md` | Deployment, migrations, rollback, restore and release gates | Provisional |
| `12_CODE_BASELINE_EXPECTATIONS.md` | Code-derived expectations for all 20 business topics | Static baseline; not test results |
| `13_PRE_QA_DEVELOPMENT_PLAN.md` | Original deep plan plus the superseding fast developer-smoke handoff decision | Fast developer smoke complete; deep runtime gates transferred to QA/release validation |

This file grouping covers all requested deliverables without duplicating the detailed cases. Suites reference the master case IDs rather than cloning cases. The detailed CSV has 96 data rows and all required planning fields are populated: Test ID, objective, preconditions, test data, steps, expected result, priority, risk level, design evidence, environment/dependencies and status. The QA-owned Actual Result, Execution Evidence and Defect ID fields are intentionally blank for unexecuted cases. CSV structure, case/risk IDs, score arithmetic, and rule/use-case/test/risk references remain planning-document integrity checks.

Priority distribution after the ownership delta: 61 P0, 34 P1 and 1 P2 case. Twenty-two broad cases are `Partially Tested` from dated developer runs and 74 remain `Not Tested`; `AUTHZ-07`, `DATA-06`, and `UI-07` are partial, while the unexecuted concurrency case `CONC-07` remains `Not Tested`. None is promoted to Pass by inference.

## Acceptance Controls

- Record each answer against its BQ ID and cite that answer in the affected rule.
- Do not silently turn current implementation into the business requirement.
- Keep unknown SLOs, retention periods, capacity, RPO and RTO as TBD until agreed.
- A contradictory implementation becomes a suspected defect/test target, not an instruction to change the requirement.
- Cases include every requested design field. The 22 cases touched by dated developer runs contain `Partially Tested` status, actual result and execution evidence; all 74 other cases remain `Not Tested` with empty Actual Result and Execution Evidence. Defect ID remains QA-owned and blank until a defect is actually filed.
- Record code-only outcomes before scoring acceptance. A source-predicted authorization gap is not a security pass; a conflict with a confirmed rule is a suspected defect even when runtime matches source.
- Audit coverage by role/action/resource, state transition, API operation, integration failure, user journey, data lifecycle, risk, and release path.
- Preserve explicit untested/uncovered limitations. Do not claim 100% behavioral coverage from a static inventory.

## How QA Uses This Package

1. Open `05_TEST_CASES.csv` and filter `Status`. Start with the 74 `Not Tested` rows—especially `CONC-07`; re-run the 22 `Partially Tested` rows, including `AUTHZ-07`, `DATA-06`, and `UI-07`, on the approved target matrix to finish their missing conditions.
2. For each row, prepare the stated preconditions/test data, perform `Steps`, and compare the observation with `Expected Result`. The expected-result field is populated for all 96 cases.
3. Write what actually happened in `Actual Result`, set `Status`, link sanitized screenshots/logs/queries in `Execution Evidence`, and add a `Defect ID` when observed behavior differs.
4. Use `10_SMOKE_REGRESSION_UAT.md` to choose the smoke/regression/UAT order; use `06_TRACEABILITY_MATRIX.csv` to see which business rule and risk each case covers.
5. Do not approve release until the open items in `11_RELEASE_READINESS_CHECKLIST.md` have owners/evidence and the final Go/No-go decision is signed by the responsible humans.

## Inventory Method

The tracked-file index was obtained with Git. TypeScript syntax trees were read without executing application modules to enumerate explicit `fastify` route declarations, resolve their `apiEndpoints` strings, and enumerate CMS routes and Drizzle tables/enums. Existing tests were inventoried by tracked filename. Detailed analysis used targeted reads across handlers, policy helpers, repositories, services, schemas, migrations, renderer/main-process code, configuration loaders, release scripts, representative tests, and contracts.

The inventory excludes generated framework routes from its route count, and excludes SQL-only and pg-boss tables from its Drizzle-table count. It was refreshed for the document-page and video-loop source/test deltas, but is not a fresh semantic audit of every unrelated route. Vendored dependencies, generated builds, binary installers, local output/log directories, private configuration and credentials were not audited.
