# DARSHAN Human QA Planning Package

Status: PROVISIONAL QA PLAN - ready for human review; unresolved acceptance policy remains TBD. Not release approval.

Repository baseline: `release-01`, commit `a6e401d2479cd0dee34c33552671cd0f86d4d173`, inventoried 2026-09-24; targeted source review and user answers updated through 2026-09-25; all 20 code-behavior expectations and QA handoff updated 2026-09-30.

No tests, builds, load tools, penetration tests, application services, deployment commands, or database commands were executed. No application code, configuration, infrastructure, or existing documentation was changed. Only this directory was added. The pre-existing untracked `.codex/` directory was left alone.

## Read First

1. [System understanding](00_SYSTEM_UNDERSTANDING.md): product boundaries, personas, use cases, state models, dependencies, and analysis limits.
2. [Business rule catalogue](01_BUSINESS_RULES.md): confirmed, implemented, inferred, and unresolved rules, with repository evidence.
3. [Business questions](02_BUSINESS_QUESTIONS.md): code answers for all 20 questions and the remaining human policy/site inputs.
4. [Static source inventory](evidence/repository-inventory.json): explicit API registrations, CMS route declarations, schema tables/enums, SQL migration paths, and existing test-file paths.
5. [Policies versus actual code](evidence/policy-behavior-review.md): requested source-level recheck of administrator access, emergency delegation, two-minute lock/purge, fixed roles and session revocation.
6. [Content and player behavior](evidence/content-runtime-review.md): current sharing/authorization, webpages, default selection and PoP behavior, kept separate from business approval.
7. [Operational behavior](evidence/operational-behavior-review.md): reports, retention, platform, capacity, recovery, network and delete findings from source.
8. [Code-derived expectations](12_CODE_BASELINE_EXPECTATIONS.md): source-behavior baseline for BQ-001 through BQ-020, including confirmed-rule conflicts.

The inventory is supporting evidence, not a completed authorization audit or a test execution report. Source references are repository-relative. Test-file presence and historical QA reports do not mean tests currently pass.

User answers confirm first-page documents, management-only integrations, excluded general Requests, protected deletion of every SUPER_ADMIN, all-user-role management by SUPER_ADMIN, screen-permission emergency delegation, a two-minute offline lock with media erasure/emergency stop, fixed built-in roles with custom-role customization, and immediate withdrawal of obsolete session access. No fallback access-withdrawal grace period is approved. Source conflicts and remaining edge-policy limits are documented without changing application code.

The 2026-09-25 answer confirms administrator self-approval and direct publishing. BQ-007/011/012/013 now have explicit code-baseline expected results in the questions and detailed cases. Unknown business acceptance remains TBD, and the presentation authorization gap is not normalized into an approved requirement.

## Planning Deliverables

| File | Contents | Current status |
| --- | --- | --- |
| `00_SYSTEM_UNDERSTANDING.md` | System understanding and 29 use cases | Provisional |
| `01_BUSINESS_RULES.md` | Classified rules and business sources | 78 rules; all 20 questions have source review |
| `02_BUSINESS_QUESTIONS.md` | Questions, answers, affected expectations | Source answers complete; site and business inputs still TBD |
| `03_RISK_REGISTER.csv` | 20 scored risks and risk-to-test links | Provisional |
| `04_MASTER_TEST_CHECKLIST.md` | Product and cross-cutting testing checklist | Provisional |
| `05_TEST_CASES.csv` | 76 detailed, human-executable cases | Planned; all Not Tested |
| `06_TRACEABILITY_MATRIX.csv` | 107 requirement/use-case-to-test/risk rows | Planned; not executed |
| `07_SECURITY_CHECKLIST.md` | Authorized security verification plan, no execution | Provisional |
| `08_PERFORMANCE_RELIABILITY_CHECKLIST.md` | Load, stress, spike, soak, resilience and recovery plans | Provisional |
| `09_TEST_DATA_AND_ENVIRONMENT.md` | Data recipes, isolation, topology, tools, cleanup rules | Provisional |
| `10_SMOKE_REGRESSION_UAT.md` | Distinct smoke, regression, and UAT selections | Provisional |
| `11_RELEASE_READINESS_CHECKLIST.md` | Deployment, migrations, rollback, restore and release gates | Provisional |
| `12_CODE_BASELINE_EXPECTATIONS.md` | Code-derived expectations for all 20 business topics | Static baseline; not test results |

This file grouping covers all 15 requested deliverables without duplicating the detailed cases. Suites reference the master case IDs rather than cloning cases. The detailed CSV has a blank `Actual Result` column in every case, along with blank execution-evidence and defect-ID fields; QA fills these only after testing. CSV structure, case/risk IDs, score arithmetic, and rule/use-case/test/risk references are planning-document integrity checks only; no application behavior was tested.

## Acceptance Controls

- Record each answer against its BQ ID and cite that answer in the affected rule.
- Do not silently turn current implementation into the business requirement.
- Keep unknown SLOs, retention periods, capacity, RPO and RTO as TBD until agreed.
- A contradictory implementation becomes a suspected defect/test target, not an instruction to change the requirement.
- Cases include every requested field and start at `Not Tested` with empty actual-result, execution-evidence and defect-ID fields.
- Record code-only outcomes before scoring acceptance. A source-predicted authorization gap is not a security pass; a conflict with a confirmed rule is a suspected defect even when runtime matches source.
- Audit coverage by role/action/resource, state transition, API operation, integration failure, user journey, data lifecycle, risk, and release path.
- Preserve explicit untested/uncovered limitations. Do not claim 100% behavioral coverage from a static inventory.

## Inventory Method

The tracked-file index was obtained with Git. TypeScript syntax trees were read without executing application modules to enumerate explicit `fastify` route declarations, resolve their `apiEndpoints` strings, and enumerate CMS routes and Drizzle tables/enums. Existing tests were inventoried by tracked filename. Detailed analysis used targeted reads across handlers, policy helpers, repositories, services, schemas, migrations, renderer/main-process code, configuration loaders, release scripts, representative tests, and contracts.

The inventory excludes generated framework routes from its route count, and excludes SQL-only and pg-boss tables from its Drizzle-table count. It does not claim every repository line received a line-by-line correctness audit. Vendored dependencies, generated builds, binary installers, local output/log directories, private configuration and credentials were not audited.
