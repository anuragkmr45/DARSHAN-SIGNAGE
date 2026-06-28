# DARSHAN - Master Codex Prompt Pack
## Business-Aware QA, Deployment Readiness, And On-Prem / Air-Gapped Support

Status: historical prompt pack and broad workflow reference.

Current QA documentation lives in `docs/qa/**`, with `docs/qa/README.md` as the entrypoint. Any older instruction in this file that says to create artifacts under `/qa` should be read as historical; current repo-local QA artifacts belong under `docs/qa`.

Use this prompt pack for the software product named DARSHAN.
It is intentionally not HRMS-specific. DARSHAN may have a different tech stack, business domain, integrations, and deployment requirements.

This prompt pack follows this process:

1. Analyze the whole codebase first.
2. Extract business logic and code logic separately.
3. Ask only important business/deployment questions.
4. Convert answers into implementation/action plans.
5. Implement approved `need action` items.
6. Verify with commands and evidence.
7. Generate a serious enterprise testing workbook, client/internal docs, sprint plan, and tester manual.
8. Add future scope only after the testing sheet is generated.

## How To Use

Run Prompt 1 first. After Codex creates the discovery files, answer each question in `qa/DARSHAN_BUSINESS_LOGIC_QUESTIONS.md` using:

```text
ans:
[confirmed business answer]

need action:
[what must be implemented/fixed now]

future:
[not current release; add after test sheet generation]

no action:
[keep current behavior; just test it]
```

Then run Prompt 2, Prompt 3, Prompt 4, and Prompt 5 in sequence.

## Prompt 1 - Discovery, Business Logic, Deployment Logic, And Questions

```text
You are acting as a Senior Software Architect, Senior QA Lead, Business Analyst, DevOps Engineer, Security Reviewer, and Release Manager.

Product name:
DARSHAN

Goal:
Understand this repository completely before making changes or generating the final testing sheet.

Important:
- Do NOT assume the tech stack.
- Do NOT assume the business domain.
- Do NOT assume the deployment model.
- Do NOT copy HRMS-specific logic into DARSHAN.
- Do NOT modify application source code in this phase.
- Do NOT generate the final testing workbook in this phase.
- Do NOT hallucinate. Every claim must be backed by file evidence, command evidence, or clearly marked as an assumption.
- If a rule is unclear, ask a question instead of silently guessing.
- Create all analysis outputs inside `/qa`.
- If `/qa` already exists, preserve existing files unless you are explicitly updating DARSHAN-related artifacts.
- Use backend/server/API/database logic as source of truth for permissions and business rules when available.
- Treat frontend/client route guards as UX-only unless backend/server enforces the same rule.
- If this is not a web app, adapt the analysis to the actual software architecture.

Read the entire repository, including:
- README and docs
- package/build/config files
- Dockerfiles, compose files, Kubernetes/Helm manifests, deployment scripts
- CI/CD workflows
- backend/server/API code
- frontend/client/UI code
- database schemas/migrations/models
- auth/session/security logic
- RBAC/permission logic
- business workflow/state-machine logic
- validation logic
- file/media/storage logic
- notification/email/SMS/webhook/integration logic
- background workers/queues/schedulers
- test files
- task sheets or project tracking docs
- environment examples
- any existing QA docs or release notes

Create:

1. `qa/DARSHAN_CODEBASE_ANALYSIS.md`
2. `qa/DARSHAN_BUSINESS_LOGIC_QUESTIONS.md`
3. `qa/DARSHAN_DEPLOYMENT_DISCOVERY.md`
4. `qa/DARSHAN_EVIDENCE_REGISTER.md`

Use this exact structure.

────────────────────────────────────────
FILE 1: qa/DARSHAN_CODEBASE_ANALYSIS.md
────────────────────────────────────────

Include:

## 1. Product Summary
- What DARSHAN appears to do
- Who the users/personas appear to be
- Main business goals
- Critical business outcomes
- Things proven from code/docs
- Things inferred but not proven

## 2. Tech Stack Summary
Identify:
- Frontend framework, if any
- Backend framework, if any
- Database/storage
- Queue/cache/session system
- Object/media/file storage
- Email/SMS/notification provider
- Auth/session mechanism
- Build tooling/package manager
- Test tooling
- Deployment tooling
- CI/CD tooling
- Runtime requirements

For each item:
- Evidence file/path
- Confidence: High / Medium / Low
- Notes / risks

## 3. Architecture Map
Include:
- Apps/services/modules
- API boundaries
- Frontend/backend relationship
- Workers/jobs/schedulers
- Database boundaries
- External integrations
- Internal integrations
- Local development flow
- Production/runtime flow

## 4. Feature / Screen / Module Map
For every feature/module/screen/domain:
- Feature name
- User goal
- Personas/roles involved
- Main files/routes/components/services
- APIs/endpoints/events/jobs involved
- Data dependencies
- Business rules proven from code
- Edge cases found in code
- Error/loading/empty states
- Missing or unclear rules
- Risk level: High / Medium / Low

## 5. Role / Permission Matrix - Detailed
Do not make this short.

For every role/persona found:
- Role name from backend/server/source of truth
- Frontend/display alias, if any
- Module access
- Allowed actions
- Blocked actions
- Approval/decision authority
- Data visibility scope
- Export/download authority
- Admin/config authority
- Evidence file/path
- Negative tests required
- Unclear questions

If frontend roles and backend roles differ:
- List every mismatch.
- Mark backend/server role model as source of truth unless code proves otherwise.
- Add questions/actions to align labels and tests.

## 6. Business Entity / Status / Workflow Map
Identify all important business entities, such as:
- User/account/customer/member/case/ticket/order/request/application/document/payment/project/task/report/session/etc.

Use actual DARSHAN entities from code.

For each entity:
- Entity name
- Important fields
- Status values
- Allowed status transitions
- Blocked status transitions
- Who can create/update/delete/approve/reject/close/export
- Required validations
- Audit/logging behavior
- Edge cases
- Missing rules
- Evidence

## 7. API / Integration Map
For each API/service/integration:
- Endpoint/service/event/job name
- Purpose
- Auth required?
- Roles allowed
- Success behavior
- Failure behavior
- Loading/empty state expected
- Retry behavior
- Rate limit/security behavior if found
- Business impact if it fails
- Evidence

## 8. Deployment Readiness Observations
Summarize what currently exists for:
- Local development
- Hosted/internet deployment
- On-prem deployment
- Air-gapped/offline deployment
- Docker/Compose/Kubernetes
- Environment variables
- Secrets
- Database migrations
- Object/file storage
- Email/notification delivery
- Cache/queue/session services
- Backup/restore
- Health checks
- Logs/monitoring
- CI/CD
- Branch-based deployment
- Release artifacts

## 9. Risk Areas
Include at least:
- Business-critical workflow risk
- Revenue/payment/approval risk, if applicable
- Auth/session risk
- RBAC/permission risk
- Data loss risk
- File/media/document risk
- External integration risk
- On-prem/air-gapped risk
- Deployment/rollback risk
- Migration risk
- Performance risk
- Mobile/responsive risk, if applicable
- Client/UAT risk

## 10. Initial QA Strategy
Propose testing lanes:
- P0 Release Gate
- P0 Deployment Smoke
- P1 Sprint Regression
- P1 Full Product Regression
- P2 Deep/Future Regression
- Security/RBAC Negative Tests
- On-prem/Air-gapped Readiness Tests
- Data Migration/Backup/Restore Tests
- Performance/Load Smoke Tests

Do not generate the final test cases yet.

────────────────────────────────────────
FILE 2: qa/DARSHAN_BUSINESS_LOGIC_QUESTIONS.md
────────────────────────────────────────

Ask questions needed to create better business-specific test cases and implementation actions.

Use this format:

QID:
Area:
Priority: P0 / P1 / P2
Question:
Why this matters:
Code evidence:
Default assumption if unanswered:
Need action candidate: yes/no

Rules:
- Ask only useful questions.
- Prioritize P0 questions first.
- Ask about role/permission mismatches.
- Ask about approval/workflow edge cases.
- Ask about data visibility and ownership.
- Ask about status transitions.
- Ask about deletion/retention/audit.
- Ask about deployment mode: internet-hosted, on-prem, air-gapped, or both.
- Ask about environment separation: local/dev/QA/UAT/prod.
- Ask about branch strategy.
- Ask about whether the tester should run first-time full software testing.
- Ask about business-critical flows for signoff.
- Ask about future-scope items separately from current release blockers.

────────────────────────────────────────
FILE 3: qa/DARSHAN_DEPLOYMENT_DISCOVERY.md
────────────────────────────────────────

Create a deployment-focused analysis.

Include:

## 1. Current Deployment Model Found In Repo
- Existing Dockerfiles
- Existing compose files
- Existing Kubernetes/Helm files
- Existing CI/CD files
- Existing env examples
- Existing deployment docs
- Existing health checks
- Existing build/start commands

## 2. Internet-Hosted Deployment Suitability
If the product can be internet-hosted, evaluate:
- Frontend host options
- Backend/API host options
- Database hosting
- Cache/queue/session hosting
- Object storage
- Email/SMS provider
- DNS/subdomain plan
- HTTPS/TLS
- CORS/cookie/session implications
- Required code/config changes

Do not assume providers unless code/docs mention them or the user specifies them.

## 3. On-Prem Deployment Suitability
If the product needs on-prem deployment, evaluate:
- Docker Compose suitability
- Kubernetes/Helm suitability
- Internal reverse proxy suitability
- Internal DNS/domain assumptions
- Internal TLS/certificate assumptions
- Local database/container database
- Local object storage option
- Local cache/queue/session option
- Local email/SMTP option
- Logs and monitoring
- Backup/restore
- Migrations
- Upgrade process
- Offline package process

## 4. Air-Gapped Deployment Suitability
If air-gapped is required, evaluate:
- Can the product build without internet?
- Are all packages lockfile-pinned?
- Are container base images pinned?
- Are external CDNs/assets/fonts/scripts used?
- Are license keys/external calls required?
- Are external APIs mandatory?
- Are update checks disabled?
- Is email/SMS/cloud storage replaceable?
- Can Docker images be exported/imported?
- Can migrations run offline?
- Can docs and test data be bundled?
- Can smoke tests run offline?

## 5. Recommended Environment Model
Propose a model, but mark as recommendation until user confirms:

Recommended common model:
- Local development: developer machine, local env, local DB/storage/cache when needed
- Hosted dev or on-prem dev: `dev` branch / dev container stack
- QA/UAT: `qa` branch / QA container stack
- Production: `main` or `master` branch / production container stack

Important:
- If Node.js is used, do not blindly set `NODE_ENV=qa`.
- Prefer `APP_ENV=local|dev|qa|uat|prod` or equivalent for business environment.
- Keep runtime optimization envs like `NODE_ENV=production` for deployed builds if required by the framework.
- If this is not Node.js, use the equivalent runtime-vs-business-environment split.

## 6. On-Prem Replacement Matrix
If DARSHAN currently uses cloud services or may need them, create a replacement matrix:

Cloud/Hosted capability -> On-prem/air-gapped replacement:
- Cloud DB -> Postgres/MySQL/MSSQL/etc. container or internal DB, based on codebase
- Cloud object storage -> MinIO/S3-compatible local storage or filesystem adapter
- Cloud cache/queue -> Valkey/Redis/RabbitMQ/etc. local container
- Cloud email -> internal SMTP or Mailpit for dev/QA
- Cloud logs/monitoring -> local logs plus Prometheus/Grafana/Loki if suitable
- Hosted frontend/backend -> Docker Compose/Kubernetes behind internal reverse proxy
- External CI/CD -> artifact bundle and manual/offline deployment steps

Do not implement yet.

────────────────────────────────────────
FILE 4: qa/DARSHAN_EVIDENCE_REGISTER.md
────────────────────────────────────────

Create an evidence table:

| Claim ID | Claim | Evidence Type | File/Command | Line/Output Summary | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |

Rules:
- Every major business, tech, deployment, and test-generation claim must have evidence.
- If evidence is missing, mark it as assumption.
- If command execution is blocked, record the reason.
- Never pretend a file, branch, service, or sheet was updated if it was not.
```

## Prompt 2 - Convert Answers Into Implementation Plan And Approved Business Rules

```text
Read:
- qa/DARSHAN_CODEBASE_ANALYSIS.md
- qa/DARSHAN_BUSINESS_LOGIC_QUESTIONS.md
- qa/DARSHAN_DEPLOYMENT_DISCOVERY.md
- qa/DARSHAN_EVIDENCE_REGISTER.md
- My answers in the current Codex conversation

Goal:
Convert all answers into confirmed business rules, implementation actions, future scope, and QA requirements.

Important:
- Do NOT modify source code yet.
- Do NOT generate the final testing workbook yet.
- Separate `need action`, `ans`, `future`, and `no action`.
- For every `need action`, create a multi-stage implementation plan.
- For every `ans`, convert it into confirmed business logic and test coverage.
- For every `future`, add it to future scope but do not implement before the testing sheet exists.
- For every unclear item, use the default assumption only if it is safe and explicitly recorded.
- Do not hallucinate. Use file/command evidence or mark assumption.

Create or update:

1. `qa/DARSHAN_BUSINESS_RULES_CONFIRMED.md`
2. `qa/DARSHAN_NEED_ACTION_IMPLEMENTATION_PLAN.md`
3. `qa/DARSHAN_FUTURE_SCOPE_QUEUE.md`
4. `qa/DARSHAN_QA_REQUIREMENTS_FROM_BUSINESS_RULES.md`
5. `qa/DARSHAN_RELEASE_RISK_REGISTER.md`

Use this structure.

────────────────────────────────────────
FILE 1: qa/DARSHAN_BUSINESS_RULES_CONFIRMED.md
────────────────────────────────────────

For every confirmed rule:
- Rule ID
- Source question ID
- Area
- Business rule
- Current code behavior
- Expected behavior
- Gap: none / code change needed / test-only / future
- Priority: P0 / P1 / P2
- Roles affected
- Test types required
- Evidence
- Notes

────────────────────────────────────────
FILE 2: qa/DARSHAN_NEED_ACTION_IMPLEMENTATION_PLAN.md
────────────────────────────────────────

For every `need action`:
- Action ID
- Related QID
- Area
- Problem statement
- Business reason
- Current behavior evidence
- Target behavior
- Implementation stages
- Files likely to change
- Tests to add/update
- Manual QA coverage to add
- Deployment impact
- On-prem/air-gapped impact
- Data migration impact
- Rollback considerations
- Risk
- Acceptance criteria
- Verification commands

Each implementation plan can have multiple stages:
- Stage 1: Evidence and current-flow verification
- Stage 2: Backend/server/source-of-truth changes
- Stage 3: Frontend/client/UI changes
- Stage 4: Database/migration changes if needed
- Stage 5: Docker/env/deployment changes if needed
- Stage 6: Automated tests
- Stage 7: Manual QA sheet updates
- Stage 8: Dev validation and evidence

If the product is on-prem/air-gapped, add:
- Offline dependency impact
- Container image impact
- Environment file impact
- Object storage/mail/cache local-service impact

────────────────────────────────────────
FILE 3: qa/DARSHAN_FUTURE_SCOPE_QUEUE.md
────────────────────────────────────────

Add future items only here for now.

Include:
- Future ID
- Area
- Business reason
- Why not now
- Suggested sprint
- Dependencies
- Risks if deferred
- Test placeholders needed after current sheet generation

Do not implement future items yet.

────────────────────────────────────────
FILE 4: qa/DARSHAN_QA_REQUIREMENTS_FROM_BUSINESS_RULES.md
────────────────────────────────────────

Create QA requirements, not final test cases yet.

For every rule/action:
- Requirement ID
- Business rule
- Roles
- P0/P1/P2
- Happy path coverage needed
- Negative coverage needed
- Edge coverage needed
- Permission/RBAC coverage needed
- Deployment/environment coverage needed
- On-prem/air-gapped coverage needed
- Required test data

────────────────────────────────────────
FILE 5: qa/DARSHAN_RELEASE_RISK_REGISTER.md
────────────────────────────────────────

Create risk register:
- Risk ID
- Area
- Risk description
- Impact
- Likelihood
- Priority
- Mitigation
- Test coverage required
- Owner suggestion
- Release blocker? yes/no
```

## Prompt 3 - Implement Approved Need Actions And Deployment Readiness

```text
Read:
- qa/DARSHAN_CODEBASE_ANALYSIS.md
- qa/DARSHAN_DEPLOYMENT_DISCOVERY.md
- qa/DARSHAN_BUSINESS_RULES_CONFIRMED.md
- qa/DARSHAN_NEED_ACTION_IMPLEMENTATION_PLAN.md
- qa/DARSHAN_QA_REQUIREMENTS_FROM_BUSINESS_RULES.md
- qa/DARSHAN_RELEASE_RISK_REGISTER.md

Goal:
Implement all approved `need action` items and make DARSHAN suitable for its confirmed deployment model.

Important:
- Implement only approved `need action` items.
- Do not implement future-scope items yet.
- Preserve existing app behavior unless the confirmed business rule requires a change.
- Do not hardcode secrets.
- Do not commit real credentials.
- Do not remove existing tests.
- Do not claim success without running verification or recording why verification was blocked.
- If a file cannot be safely edited, create an exact patch file under `/qa` instead of pretending it was updated.
- If the repo has task sheets, sprint sheets, or project trackers, update them safely. If direct update risks corruption, create `qa/DARSHAN_TASK_SHEET_UPDATE_PATCH.md`.

Implementation expectations:

## A. Business Logic Implementation
For each need-action item:
- Update backend/server/source-of-truth first.
- Update frontend/client only after backend behavior is clear.
- Update DB migrations/models if needed.
- Update API contracts/docs if present.
- Update automated tests.
- Update manual QA requirements.
- Record evidence.

## B. Deployment Readiness - Internet Hosted Mode
If internet-hosted deployment is confirmed or supported:
- Add or update deployment docs.
- Add or update env examples for local/dev/qa/prod.
- Add or update frontend/backend build/start commands.
- Add health checks.
- Add safe CORS/cookie/session config.
- Add branch-to-environment CI/CD if appropriate:
  - `dev` -> dev
  - `qa` -> QA/UAT
  - `main` or `master` -> production
- Use GitHub Environments/secrets/protection rules if GitHub Actions is used.
- Keep one active production branch operationally.
- Add post-deploy smoke test scripts where possible.
- Do not assume a cloud provider unless confirmed.

## C. Deployment Readiness - On-Prem / Air-Gapped Mode
If on-prem or air-gapped deployment is confirmed or supported:
- Add or update Dockerfile(s) if missing.
- Add or update Compose files or Kubernetes manifests based on repo suitability.
- Prefer separate container stacks or profiles for:
  - local
  - dev
  - qa
  - prod
- Use separate env files:
  - `.env.local.example`
  - `.env.dev.example`
  - `.env.example`
  - `.env.prod.example`
- Use separate databases or schemas per environment.
- Use separate object storage buckets/folders per environment.
- Use separate cache/queue/session services or logical namespaces per environment.
- Use internal DNS/domain examples.
- Use internal TLS/certificate notes.
- Add health checks for all services.
- Add migration commands.
- Add backup/restore scripts or docs.
- Add offline image/package transfer documentation.
- Add air-gapped install bundle checklist.
- Ensure the app does not require external CDNs/assets/scripts/fonts at runtime unless explicitly approved.
- Ensure email/SMS/cloud providers are replaceable with internal SMTP/local provider or clearly marked as unsupported.
- Ensure local object storage can replace cloud media storage if needed.
- Ensure CI can build artifacts online, but air-gapped deployment can install from exported images/artifacts offline.

Suggested on-prem replacement model, adapt to actual stack:
- Database: local/internal DB container or organization-managed DB
- Object storage: MinIO/S3-compatible storage or filesystem adapter
- Cache/session/queue: Valkey/Redis/RabbitMQ/etc. local container, based on actual code
- Email: internal SMTP; Mailpit only for local/dev/QA testing
- Reverse proxy: Nginx/Caddy/Traefik or existing repo choice
- TLS: internal CA or customer-provided certificate
- Logs: container logs plus optional local observability stack

## D. Environment Variable Model
Detect stack first.

If Node.js is used:
- Use `APP_ENV=local|dev|qa|uat|prod` or equivalent for business environment.
- Keep `NODE_ENV=production` for deployed optimized builds unless framework docs/code require otherwise.

If another stack is used:
- Use equivalent separation between runtime optimization mode and product environment.

Do not overload runtime env with business env unless code proves it is safe.

## E. Branching And Release Model
Add docs and CI/CD for:
- `feature/*` -> local/dev testing only
- `dev` -> dev deployment/container stack
- `qa` -> QA/UAT deployment/container stack
- `main` or `master` -> production deployment/container stack
- Hotfix branch process
- Rollback process
- Release tagging
- Version/build metadata

For air-gapped:
- CI may create release artifacts/images in connected environment.
- Offline deployment imports artifacts into the air-gapped network.
- Do not require GitHub/Cloud registry access from the air-gapped runtime.

Create/update:

1. `qa/DARSHAN_IMPLEMENTATION_EVIDENCE_REGISTER.md`
2. `qa/DARSHAN_DEV_TEST_EXECUTION_LOG.md`
3. `docs/deployment/darshan-hosted-deployment.md` if internet-hosted is supported
4. `docs/deployment/darshan-onprem-airgapped-deployment.md` if on-prem/air-gapped is supported
5. `docs/development/darshan-agile-release-process.md`
6. CI/CD files only if appropriate for the repo
7. Docker/Compose/Kubernetes files only if appropriate for the repo
8. Env examples only if appropriate for the repo
9. Task sheet patch/update files if task sheets exist

Verification:
Run all relevant commands discovered in the repo, such as:
- typecheck
- lint
- unit tests
- integration tests
- build
- API contract tests
- frontend build
- Docker build
- Compose config validation
- Kubernetes manifest validation if available
- migration dry run if safe
- smoke tests if available

If a command is blocked:
- Record the exact command
- Record why it was blocked
- Record what environment/service is missing
- Do not mark it pass

Stop after implementation and verification.
Do not generate the final testing workbook until this implementation phase is complete.
```

## Prompt 4 - Generate Enterprise Testing Workbook, Tester Manual, Docs, And Sprint Plan

```text
Read:
- qa/DARSHAN_CODEBASE_ANALYSIS.md
- qa/DARSHAN_DEPLOYMENT_DISCOVERY.md
- qa/DARSHAN_BUSINESS_RULES_CONFIRMED.md
- qa/DARSHAN_NEED_ACTION_IMPLEMENTATION_PLAN.md
- qa/DARSHAN_QA_REQUIREMENTS_FROM_BUSINESS_RULES.md
- qa/DARSHAN_RELEASE_RISK_REGISTER.md
- qa/DARSHAN_IMPLEMENTATION_EVIDENCE_REGISTER.md
- qa/DARSHAN_DEV_TEST_EXECUTION_LOG.md
- Current repository code/docs

Goal:
Generate a full enterprise-grade testing package for DARSHAN.

Important:
- This product may be tested for the first time after dev testing.
- Do NOT include only P0 tasks.
- Cover the whole software, not only the current sprint.
- Use P0/P1/P2 correctly.
- P0 = release/UAT blocker or core business/deployment gate.
- P1 = important regression and high-value feature coverage.
- P2 = lower-risk, deep, exploratory, nice-to-have, or future validation.
- Tester should not be overwhelmed.
- Organize tests into execution lanes and sprints.
- Assign story points to every testing task/suite.
- Use comparatively lower story points because this is a fast-paced startup with AI support.
- Use 7-day sprints.
- Use 48 story points maximum per tester/team sprint unless the repo/project docs specify otherwise.
- Split full testing into multiple sprints if needed.
- Do not exceed 48 story points per sprint.
- Make the workbook useful for dev, QA, product, business, and client/UAT stakeholders.
- Do not expose internal code paths in client-facing docs.

Create or update:

1. `qa/DARSHAN_TESTING_TEST_CASES.xlsx`
2. `qa/DARSHAN_TESTING_CHECKLIST_INTERNAL.md`
3. `qa/DARSHAN_TESTING_CHECKLIST_CLIENT.md`
4. `qa/DARSHAN_TESTING_CHECKLIST_CLIENT.docx`
5. `qa/DARSHAN_TESTER_RUN_BOOK.md`
6. `qa/DARSHAN_TESTER_MANUAL_LOCAL_QA_SETUP.md`
7. `qa/DARSHAN_RELEASE_SIGNOFF_SUMMARY.md`
8. `qa/DARSHAN_TESTING_WORKBOOK_VALIDATION.md`
9. `qa/DARSHAN_TASK_SHEET_UPDATE_PATCH.md` if task sheet cannot be safely edited

The XLSX workbook must have these sheets:

## Sheet 1: Execution Summary
Columns:
- Product
- Build Version
- Environment
- Testing Phase
- Total Test Cases
- P0 Count
- P1 Count
- P2 Count
- Passed
- Failed
- Blocked
- Not Run
- Release Readiness
- Major Risks
- QA Owner
- Product Owner
- Last Updated

## Sheet 2: Sprint Plan
Columns:
- Sprint Number
- Sprint Duration
- Sprint Goal
- Scope
- Story Points Planned
- Story Points Used
- P0 Count
- P1 Count
- P2 Count
- Entry Criteria
- Exit Criteria
- Dependencies
- Notes

Rules:
- 7-day sprints.
- 48 story points max per sprint.
- Prioritize P0 first, then high-risk P1, then full regression.
- If first-time full software testing needs more than one sprint, split cleanly.

## Sheet 3: P0 Release Gate
Must include only must-pass items:
- Login/session/auth
- Core business workflows
- Permission/RBAC blockers
- Data creation/update/delete blockers
- Critical APIs
- Critical deployment smoke
- Critical environment isolation
- Critical on-prem/air-gapped checks if applicable
- Critical file/media/storage checks if applicable
- Critical backup/restore smoke if applicable

## Sheet 4: Deployment Smoke
Include:
- Correct environment loaded
- Correct API/backend target
- Correct DB/storage/cache target
- Health checks
- Migrations
- CORS/cookies/session
- TLS/certificates
- Static assets
- File upload/download
- Email/SMS/notification smoke
- Worker/job smoke
- Logs/errors
- Rollback smoke
- On-prem container stack smoke
- Air-gapped no-external-call smoke

## Sheet 5: Full Regression
Cover the whole product by module/feature.
Include P0, P1, and P2.

## Sheet 6: Role Permission Matrix
Make this detailed, not short.
Columns:
- Role
- Display Name
- Source of Truth
- Module
- Action
- Allowed?
- Scope
- Approval Authority
- Data Visibility
- Export/Download Allowed?
- Delete/Destructive Allowed?
- Backend Evidence
- Frontend Evidence
- Negative Test IDs
- Notes

## Sheet 7: Business Rule Traceability
Make this detailed.
Columns:
- Business Rule ID
- Source QID/Doc
- Business Rule
- Feature/Module
- Roles
- Priority
- Test Case IDs
- Implementation Evidence
- Deployment Impact
- On-Prem/Air-Gapped Impact
- Risk
- Status
- Notes

## Sheet 8: Test Cases
Every test case must include:
- Test Case ID
- Priority: P0/P1/P2
- Sprint
- Story Points
- Test Lane
- Feature/Module
- Business Flow
- Role/Persona
- Environment: Local/Dev/QA/UAT/Prod/On-Prem/Air-Gapped
- Test Type: Happy Path/Negative/Edge/RBAC/API Failure/UI State/Deployment/Security/Performance/Data Integrity
- Preconditions
- Test Data
- Steps
- Expected Result
- Actual Result
- Status: Not Run/Pass/Fail/Blocked/Not Applicable
- Defect ID
- Evidence Required
- Automation Candidate: Yes/No
- Business Rule ID
- Code/Doc Evidence
- Notes

## Sheet 9: Test Data
Include:
- Test user/persona
- Role
- Credentials placeholder only, no real secrets
- Data setup steps
- Required records
- Required documents/files
- Environment
- Cleanup steps
- Notes

## Sheet 10: Environment Matrix
Include:
- Local
- Dev
- QA/UAT
- Production
- On-Prem Dev
- On-Prem QA
- On-Prem Prod
- Air-Gapped
Columns:
- Environment
- Purpose
- Branch
- Domain/Internal URL
- API URL
- Database
- Object Storage
- Cache/Queue
- Email/SMS
- Feature Flags
- APP_ENV or equivalent
- Runtime Env
- Secrets Source
- Deployment Method
- Notes

## Sheet 11: Container / Service Matrix
For Docker/Kubernetes/on-prem:
- Service Name
- Image Name
- Version/Tag
- Port
- Env File
- Volume
- Network
- Health Check
- Depends On
- Restart Policy
- Backup Needed?
- Logs Location
- Notes

## Sheet 12: CI/CD and Branch Matrix
Include:
- Branch
- Environment
- Trigger
- Build Steps
- Test Steps
- Deployment Steps
- Required Secrets
- Approval Required?
- Rollback Method
- Artifact Produced
- On-Prem/Air-Gapped Handling
- Notes

## Sheet 13: Defect Log
Columns:
- Defect ID
- Test Case ID
- Priority
- Severity
- Feature
- Environment
- Actual Result
- Expected Result
- Repro Steps
- Screenshot/Log Reference
- API Request ID / Trace ID
- Assigned To
- Status
- Fix Version
- Retest Result
- Notes

## Sheet 14: Risk Register
Use `qa/DARSHAN_RELEASE_RISK_REGISTER.md`.

## Sheet 15: Backup / Restore / Migration
Include:
- DB migration smoke
- Backup creation
- Restore validation
- Object storage backup
- Cache/session handling
- Rollback
- On-prem offline upgrade
- Air-gapped artifact import
- Version compatibility

## Sheet 16: Performance Smoke
Include:
- Page load / dashboard load
- Key API response
- Export/report generation
- File upload/download
- Search/filter/list pages
- Worker/job processing
- Container resource smoke
- Offline/on-prem constraints

## Sheet 17: Future Scope
Only after all current testing sheets are generated:
- Future items from `qa/DARSHAN_FUTURE_SCOPE_QUEUE.md`
- Future test placeholders
- Suggested sprint
- Dependencies
- Not release blocking

## Sheet 18: Signoff
Include:
- QA Lead Signoff
- Product Owner Signoff
- Business Owner Signoff
- Deployment Owner Signoff
- Security/Infra Signoff if applicable
- Overall Status
- Blockers
- Conditional Go-Live Notes
- Date

Also create:

## qa/DARSHAN_TESTER_RUN_BOOK.md
A short execution guide:
- Which sheet to start with
- Exact testing order
- What to fill
- How to log defects
- How to handle blocked tests
- What is release blocking
- How to use evidence
- How to avoid being overwhelmed

## qa/DARSHAN_TESTER_MANUAL_LOCAL_QA_SETUP.md
A detailed manual for testers.

Must include:
- macOS setup
- Ubuntu/Linux setup
- Windows setup
- Docker setup if supported
- Non-Docker setup if supported
- How to run frontend/backend/services based on actual repo
- How to run migrations
- How to seed test data if available
- How to access local app
- How to use on-prem container stack
- How to use air-gapped bundle if applicable
- How to test uploads/files
- How to test emails/notifications
- How to read logs
- How to capture request IDs/trace IDs
- Troubleshooting FAQ
- Common mistakes
- What not to change

## qa/DARSHAN_TESTING_CHECKLIST_INTERNAL.md
Internal developer/QA checklist:
- Can include code references
- Can include API endpoints
- Can include risk notes
- Can include assumptions
- Can include command evidence

## qa/DARSHAN_TESTING_CHECKLIST_CLIENT.md
Client/non-technical checklist:
- Remove code paths
- Use business language
- Keep test IDs
- Keep priority
- Keep clear steps and expected results
- Keep signoff section

## qa/DARSHAN_TESTING_CHECKLIST_CLIENT.docx
Professional document:
- Title page
- Project/build/environment fields
- Tester details
- Summary table
- Grouped feature sections
- Pass/Fail/Blocked checkboxes
- Actual result and notes
- Signoff section

## qa/DARSHAN_RELEASE_SIGNOFF_SUMMARY.md
Include:
- What was tested
- What passed
- What failed
- What is blocked
- Release decision
- Known risks
- Required approvals
- Deployment readiness
- On-prem/air-gapped readiness if applicable

Validation:
After generating the workbook/docs:
- Validate the XLSX has all required sheets.
- Validate every test case has priority.
- Validate every test case has story points.
- Validate every story point value is numeric.
- Validate no sprint exceeds 48 story points.
- Validate P0/P1/P2 all exist unless a written reason is provided.
- Validate Role Permission Matrix has module/action-level detail.
- Validate Business Rule Traceability maps rules to test IDs.
- Validate Deployment Smoke includes internet/on-prem/air-gapped coverage as applicable.
- Validate Future Scope exists only after current test sheets are generated.
- Validate no real secrets are written.
- Validate no unverified claims are presented as facts.

Create `qa/DARSHAN_TESTING_WORKBOOK_VALIDATION.md` with results.

If any validation fails:
- Fix the workbook.
- Re-run validation.
- Record final status.
```

## Prompt 5 - Future Scope Planning After Test Sheet Generation

```text
Read:
- qa/DARSHAN_FUTURE_SCOPE_QUEUE.md
- qa/DARSHAN_TESTING_TEST_CASES.xlsx
- qa/DARSHAN_TESTING_WORKBOOK_VALIDATION.md
- qa/DARSHAN_RELEASE_SIGNOFF_SUMMARY.md

Goal:
Create a future implementation and testing plan only after the current testing package is complete.

Create:

1. `qa/DARSHAN_FUTURE_SCOPE_AFTER_TEST_SHEET.md`
2. `qa/DARSHAN_NEXT_CODEX_PROMPT_FUTURE_SCOPE.md`

Include:
- Future feature/action list
- Business value
- Dependencies
- Suggested sprint sequence
- Story points
- Risks
- Required code changes
- Required test additions
- Required deployment additions
- On-prem/air-gapped impact
- Acceptance criteria

Do not implement future items in this phase.
```

## Recommended DARSHAN Deployment Decision Logic

Use this logic inside Codex while analyzing DARSHAN.

### Case 1: Internet-Hosted DARSHAN

Recommended shape, adapted to actual stack:

```text
Frontend -> public host / CDN / web server
Backend/API -> hosted app service or container service
Database -> managed DB or hosted DB
Object storage -> cloud object storage
Cache/session/queue -> managed cache/queue
Email/SMS -> managed provider
CI/CD -> GitHub Actions or repo-supported CI
DNS -> public domains/subdomains
```

Branch model:

```text
feature/* -> local development only
dev       -> dev deployment
qa        -> QA/UAT deployment
main      -> production deployment
```

Production should usually use a clean primary domain. Dev/QA should use subdomains.

### Case 2: On-Prem DARSHAN

Recommended shape, adapted to actual stack:

```text
Internal reverse proxy
  -> frontend container/static app
  -> backend/API container
      -> database container or internal DB
      -> cache/session/queue container
      -> object storage container or filesystem adapter
      -> internal SMTP/email relay
      -> workers/jobs/schedulers
```

Use separate container stacks or env files:

```text
darshan-local
darshan-dev
darshan-qa
darshan-prod
```

Use separate data:

```text
dev DB != qa DB != prod DB
dev storage bucket != qa storage bucket != prod storage bucket
dev cache namespace != qa cache namespace != prod cache namespace
```

### Case 3: Air-Gapped DARSHAN

Recommended shape, adapted to actual stack:

```text
Connected build machine:
  - build app
  - build container images
  - create image tar files
  - create offline deployment bundle
  - include migrations/docs/smoke tests/checksums

Air-gapped target:
  - load images
  - configure env files
  - run DB migrations
  - start containers
  - run smoke tests
  - record deployment evidence
```

Offline bundle should include:

```text
release/
  images/
    frontend.tar.gz
    backend.tar.gz
    worker.tar.gz
    db-migration-tool.tar.gz
  compose/
    docker-compose.prod.yml
    docker-compose.qa.yml
  env/
    .env.prod.example
    .env.example
  migrations/
  docs/
  scripts/
    install.sh
    migrate.sh
    backup.sh
    restore.sh
    smoke-test.sh
  checksums/
    SHA256SUMS
```

## Non-Hallucination Rules For Codex

Codex must follow these throughout:

```text
1. If you did not inspect a file, do not claim what it contains.
2. If you did not run a command, do not claim it passed.
3. If a command failed because services were missing, record it as blocked, not failed.
4. If a workbook/task sheet cannot be safely edited, create a patch file.
5. If a provider/service is not confirmed in code/docs, call it a recommendation, not existing architecture.
6. If DARSHAN is not a web app, adapt all frontend/backend wording to the actual architecture.
7. Do not use HRMS business rules for DARSHAN unless DARSHAN code/docs prove the same rule.
8. Do not put secrets in files.
9. Do not mark future-scope items as release blockers unless the user confirms them as current release requirements.
10. Backend/server/database/source-of-truth rules override frontend-only visibility.
```

## Minimal First Command

```bash
cd /path/to/DARSHAN
codex
```

Then paste Prompt 1.

After Codex asks questions, answer with:

```text
QID-001:
ans: ...

QID-002:
need action: ...

QID-003:
future: ...

QID-004:
no action: ...
```

Then paste Prompt 2, Prompt 3, and Prompt 4.
