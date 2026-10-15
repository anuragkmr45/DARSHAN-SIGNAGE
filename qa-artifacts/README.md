# DARSHAN Human QA Planning Package

Status: PROVISIONAL QA PLAN with targeted Linux runtime evidence. Not release approval; unresolved acceptance policy and platform/reliability gates remain TBD.

Repository baseline: `release-01`, commit `8e0bb6f5b93b230c2f08fe377cb52f8eccf729e2`, plus the video-loop reliability working-tree implementation reviewed 2026-10-15. Earlier repository-wide evidence remains historical baseline material; the document-page and video-loop deltas are traced separately.

A disposable local API/CMS/dependency stack, browser flow, real Linux Electron player, freshly migrated test database, focused DB-backed suite and Linux packaging command were executed on 2026-10-15 for the document-page and video-loop scope. Results and screenshots are in `evidence/runtime-2026-10-15/runtime-validation.md`. This targeted run did not execute the full product checklist, Windows/physical-hardware matrix, long soak, security assessment, penetration test, backup/restore rehearsal or production deployment.

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
11. [Targeted runtime validation](evidence/runtime-2026-10-15/runtime-validation.md): disposable CMS/API/Electron results, screenshots, test/build gates, defects found and remaining release gaps.

The inventory is supporting evidence, not a completed authorization audit. Source references are repository-relative. Only results explicitly linked to the dated runtime report are current execution evidence; test-file presence and historical QA reports do not mean tests currently pass.

The 2026-10-15 requests supersede first-page-only documents and one-pass loop failure: authors choose one static page for each document occurrence, while missing legacy selections remain page 1; a loop-enabled video repeats complete native media cycles while its occurrence is active and stops at the schedule or higher-authority boundary. Other confirmed answers remain management-only integrations, excluded general Requests, protected deletion of every SUPER_ADMIN, all-user-role management by SUPER_ADMIN, screen-permission emergency delegation, a two-minute offline lock with media erasure/emergency stop, fixed built-in roles with custom-role customization, and immediate withdrawal of obsolete session access.

The 2026-09-25 answer confirms administrator self-approval and direct publishing. BQ-007/011/012/013 now have explicit code-baseline expected results in the questions and detailed cases. Unknown business acceptance remains TBD, and the presentation authorization gap is not normalized into an approved requirement.

## Planning Deliverables

| File | Contents | Current status |
| --- | --- | --- |
| `00_SYSTEM_UNDERSTANDING.md` | System understanding and 29 use cases | Provisional |
| `01_BUSINESS_RULES.md` | Classified rules and business sources | 83 rules; all 20 questions have source review |
| `02_BUSINESS_QUESTIONS.md` | Questions, answers, affected expectations | Source answers complete; site and business inputs still TBD |
| `03_RISK_REGISTER.csv` | 24 scored risks and risk-to-test links | Provisional |
| `04_MASTER_TEST_CHECKLIST.md` | Product and cross-cutting testing checklist | Provisional |
| `05_TEST_CASES.csv` | 92 detailed, human-executable cases | Planned; targeted feature cases have partial execution evidence; all others remain Not Tested |
| `06_TRACEABILITY_MATRIX.csv` | 113 requirement/use-case-to-test/risk rows | Planned; not executed |
| `07_SECURITY_CHECKLIST.md` | Authorized security verification plan, no execution | Provisional |
| `08_PERFORMANCE_RELIABILITY_CHECKLIST.md` | Load, stress, spike, soak, resilience and recovery plans | Provisional |
| `09_TEST_DATA_AND_ENVIRONMENT.md` | Data recipes, isolation, topology, tools, cleanup rules | Provisional |
| `10_SMOKE_REGRESSION_UAT.md` | Distinct smoke, regression, and UAT selections | Provisional |
| `11_RELEASE_READINESS_CHECKLIST.md` | Deployment, migrations, rollback, restore and release gates | Provisional |
| `12_CODE_BASELINE_EXPECTATIONS.md` | Code-derived expectations for all 20 business topics | Static baseline; not test results |

This file grouping covers all 15 requested deliverables without duplicating the detailed cases. Suites reference the master case IDs rather than cloning cases. The detailed CSV retains expected results for every case and now records status, actual result and evidence only for the targeted paths exercised on 2026-10-15. CSV structure, case/risk IDs, score arithmetic, and rule/use-case/test/risk references remain planning-document integrity checks.

Priority distribution after the video-loop delta: 58 P0, 33 P1 and 1 P2 case. After the targeted run, 19 broad cases are `Partially Tested` and 73 remain `Not Tested`; none is promoted to Pass by inference.

## Acceptance Controls

- Record each answer against its BQ ID and cite that answer in the affected rule.
- Do not silently turn current implementation into the business requirement.
- Keep unknown SLOs, retention periods, capacity, RPO and RTO as TBD until agreed.
- A contradictory implementation becomes a suspected defect/test target, not an instruction to change the requirement.
- Cases include every requested field. Only the 19 cases touched by the dated targeted run contain `Partially Tested` status, actual result and execution evidence; all other cases remain `Not Tested` with empty execution fields.
- Record code-only outcomes before scoring acceptance. A source-predicted authorization gap is not a security pass; a conflict with a confirmed rule is a suspected defect even when runtime matches source.
- Audit coverage by role/action/resource, state transition, API operation, integration failure, user journey, data lifecycle, risk, and release path.
- Preserve explicit untested/uncovered limitations. Do not claim 100% behavioral coverage from a static inventory.

## How QA Uses This Package

1. Open `05_TEST_CASES.csv` and filter `Status`. Start with the 73 `Not Tested` rows; re-run the 19 `Partially Tested` rows on the approved target matrix to finish their missing conditions.
2. For each row, prepare the stated preconditions/test data, perform `Steps`, and compare the observation with `Expected Result`. The expected-result field is populated for all 92 cases.
3. Write what actually happened in `Actual Result`, set `Status`, link sanitized screenshots/logs/queries in `Execution Evidence`, and add a `Defect ID` when observed behavior differs.
4. Use `10_SMOKE_REGRESSION_UAT.md` to choose the smoke/regression/UAT order; use `06_TRACEABILITY_MATRIX.csv` to see which business rule and risk each case covers.
5. Do not approve release until the open items in `11_RELEASE_READINESS_CHECKLIST.md` have owners/evidence and the final Go/No-go decision is signed by the responsible humans.

## Inventory Method

The tracked-file index was obtained with Git. TypeScript syntax trees were read without executing application modules to enumerate explicit `fastify` route declarations, resolve their `apiEndpoints` strings, and enumerate CMS routes and Drizzle tables/enums. Existing tests were inventoried by tracked filename. Detailed analysis used targeted reads across handlers, policy helpers, repositories, services, schemas, migrations, renderer/main-process code, configuration loaders, release scripts, representative tests, and contracts.

The inventory excludes generated framework routes from its route count, and excludes SQL-only and pg-boss tables from its Drizzle-table count. It was refreshed for the document-page and video-loop source/test deltas, but is not a fresh semantic audit of every unrelated route. Vendored dependencies, generated builds, binary installers, local output/log directories, private configuration and credentials were not audited.
