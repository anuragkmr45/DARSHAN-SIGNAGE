# SignHex / Darshan Autonomous Codex Runbook — CONFIG-2.3 through CONFIG-5

**Recommended repo-root path:**

```txt
/Users/anuragkumar/Desktop/signhex/SIGNHEX_AUTONOMOUS_CODEX_CONFIG_2_3_TO_5_RUNBOOK.md
```

Use this file when you want Codex to continue autonomously from the current CONFIG-2.x blocker through CONFIG-5 with strict gates.

This runbook is intentionally explicit. Codex must not guess the next task. It must read code/docs, verify the current state, implement only the next unblocked phase, verify it, update docs/handoffs, then proceed only if the phase gate allows.

---

## 0. Why this file exists

The current work is no longer just a single bug fix. The remaining sequence is:

```txt
CONFIG-2.3
  Complete player URL emission redaction.

CONFIG-3
  CMS runtime config alignment.

CONFIG-4
  On-prem dev/QA/prod config profile sets and validation scripts.

CONFIG-5
  Runtime/on-prem/browser/packaged player evidence collection and production-readiness evidence.

Production Readiness Decision
  Only after CONFIG-5 evidence exists and Node 20/on-prem/browser/runtime checks pass or are formally risk-accepted.
```

Codex should continue through this sequence automatically **only while the gate for each phase passes**.

If human input, Node 20 runtime, on-prem URLs, packaged player target, browser QA, two-machine duplicate test environment, or risk acceptance is required, Codex must stop and report the blocker.

---

## 1. Actual repo folders

The current repo appears to use:

```txt
darshan-server
darshan-player
darshan-cms
docs
deploy
scripts
```

Older prompts may mention:

```txt
signhex-server
signage-screen
signhex-nexus-core
signhex-platform
```

Codex must inspect the actual repo and use actual paths. Do not assume `signhex-platform` exists.

---

## 2. Current known state

This is a starting hint only. Codex must verify from code/docs/tests.

```txt
Ghost Pairing GP-1 through GP-6: APPROVED_WITH_CONDITIONS
Known screens.test reporting failure: FIXED_VERIFIED
CONFIG-0: APPROVE_CONFIG_PLAN with conditions
CONFIG-1 backend config loader: APPROVED_WITH_CONDITIONS
CONFIG-2 player config alignment: NEEDS_FIX until diagnostics/log URL redaction fully passes
CONFIG-2.1: NEEDS_FIX
CONFIG-2.2: NEEDS_FIX
CONFIG-3: BLOCKED until CONFIG-2.x passes
CONFIG-4: BLOCKED until CONFIG-3 passes
CONFIG-5: BLOCKED until CONFIG-4 passes and runtime inputs exist
Production readiness: NOT_PRODUCTION_READY / BLOCKED_BY_ENV
Runtime/on-prem evidence: BLOCKED_BY_ENV
Node 20 validation: BLOCKED_BY_ENV
```

Latest CONFIG-2.2 independent verification found remaining raw URL paths:

```txt
darshan-player/src/main/services/log-shipper.ts
  logs uploadUrl raw after upload completion.

darshan-player/src/renderer/webpage-playback.ts
  logs options.liveUrl, expected, actual raw.

darshan-player/src/renderer/player.ts
  forwards renderer logs to main.

darshan-player/src/main/index.ts
  receives renderer logs and may persist raw URL content.

darshan-player/src/main/services/network/request-queue.ts
  uses redacted URL in request size accounting; redaction should affect emitted logs only, not runtime/accounting behavior.
```

Therefore the first task is:

```txt
CONFIG-2.3: Complete player URL emission redaction and restore request-queue raw accounting.
```

---

## 3. Non-negotiable rules

These apply to every phase.

```txt
1. Do not mark production ready without real browser/on-prem/runtime evidence.
2. Do not fake runtime evidence.
3. Do not claim tests passed unless they actually ran.
4. If a test cannot run, mark BLOCKED_BY_ENV with exact reason and rerun command.
5. Do not start a later phase if the current phase is NEEDS_FIX or BLOCKED.
6. Do not hide failing tests.
7. Do not overwrite unrelated dirty work.
8. Do not commit real secrets.
9. Do not move secrets into committed config files.
10. Do not expose cert PEM, private keys, tokens, signed URLs, full certificate serials, raw hardware IDs, passwords, or credentialed URLs in logs, diagnostics, doctor output, CMS, support bundles, docs examples, browser runtime config, or test snapshots.
11. Runtime URLs may remain raw only internally for actual network operations.
12. Redaction applies to emitted/logged/diagnostic/support/browser-visible data.
13. Do not change realtime architecture.
14. WebSocket remains notification/wake-up only.
15. REST/DB remain authoritative.
16. Polling/heartbeat/offline fallback must remain.
17. Do not remove ghost-pairing safeguards.
18. Do not auto-wipe app-data during normal uninstall/upgrade.
19. Do not enable duplicate identity block mode for production unless separately approved and tested.
20. Do not start CONFIG-3 until CONFIG-2.3 passes verification.
21. Do not start CONFIG-4 until CONFIG-3 passes verification.
22. Do not start CONFIG-5 until CONFIG-4 passes verification and runtime inputs are available.
```

---

## 4. Universal start procedure

Before each phase:

```bash
git status --short --branch
git diff --stat
git diff --name-only
```

If dirty files exist:

```txt
1. List them.
2. Identify whether they are related to current phase.
3. Do not overwrite unrelated changes.
4. Continue only if safe.
```

Read these files if present:

```txt
ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md
SIGNHEX_AUTONOMOUS_CODEX_PRODUCTION_READINESS_RUNBOOK.md
SIGNHEX_AUTONOMOUS_CODEX_CONFIG_2_3_TO_5_RUNBOOK.md

docs/architecture/onprem-config-architecture.md
docs/implementation/config-env-reduction-plan.md
docs/implementation/config-env-inventory.md
docs/implementation/config-phase-0-handoff.md
docs/implementation/config-phase-1-handoff.md
docs/implementation/config-phase-2-handoff.md
docs/implementation/config-phase-2-1-handoff.md
docs/implementation/config-phase-2-2-handoff.md
docs/implementation/config-phase-2-3-handoff.md

docs/runbooks/onprem-config-management.md
docs/implementation/realtime-sync-open-risks.md
docs/implementation/ghost-pairing-production-readiness-review.md
docs/implementation/ghost-pairing-onprem-qa-evidence.md
docs/implementation/ghost-pairing-e2e-matrix.md
```

If a required file is missing, do not hallucinate it. Create/update only if the current phase requires it.

---

## 5. Autonomous phase decision

Codex must choose the first unapproved phase in this order:

```txt
1. CONFIG-2.3 if CONFIG-2.2/2.3 is NEEDS_FIX or absent.
2. CONFIG-3 if CONFIG-2.3 is approved/approved with non-blocking conditions.
3. CONFIG-4 if CONFIG-3 is approved/approved with non-blocking conditions.
4. CONFIG-5 if CONFIG-4 is approved and runtime inputs exist.
5. Production readiness decision if CONFIG-5 evidence exists.
```

Stop if:

```txt
- required on-prem endpoints are missing
- Node 20 runtime is missing
- packaged player target is missing
- two-player duplicate test environment is missing
- browser QA access is missing
- human approval/risk acceptance is required
- related tests fail and cannot be safely fixed
```

---

# PHASE CONFIG-2.3 — Complete Player URL Emission Redaction

## 6.1 Goal

Finish player redaction so no credentialed URL or sensitive URL component appears in:

```txt
config summary
pairing diagnostics
doctor output
support bundle output
HTTP client logs
WebSocket logs
startup logs
log shipper logs
request queue logs
renderer webpage logs
renderer-to-main log forwarding
main-process renderer log persistence
```

Also restore request-queue size/accounting to use raw runtime data, not redacted diagnostic data.

Do not start CONFIG-3 until this is verified.

---

## 6.2 Files to inspect

```txt
darshan-player/src/common/redaction.ts
darshan-player/src/common/file-config.ts
darshan-player/src/common/config.ts

darshan-player/src/main/services/pairing-service.ts
darshan-player/src/main/services/operator-tools.ts
darshan-player/src/main/services/network/http-client.ts
darshan-player/src/main/services/network/request-queue.ts
darshan-player/src/main/services/log-shipper.ts
darshan-player/src/main/index.ts
darshan-player/src/main/cli.ts

darshan-player/src/renderer/webpage-playback.ts
darshan-player/src/renderer/player.ts
```

Search:

```bash
rg -n "apiBase|baseURL|baseUrl|wsUrl|socket|url|URL|uploadUrl|liveUrl|expected|actual|diagnostic|diagnostics|doctor|logger|log\.|console\.|network|backend|redact|password|token|secret|credential|private|key|signed" darshan-player/src darshan-player/test docs
```

---

## 6.3 Implementation requirements

### A. Central redaction helpers

Use or create:

```txt
darshan-player/src/common/redaction.ts
```

It should expose capabilities equivalent to:

```ts
redactUrlForDiagnostics(value: unknown): string
sanitizeLogPayload(value: unknown): unknown
sanitizeRendererLogPayload(value: unknown): unknown
redactUrlInText(value: string): string
```

Exact names can differ, but functionality must exist.

### B. URL redaction behavior

The helper must:

```txt
- Remove URL username/password.
- Remove all query strings.
- Remove all fragments.
- Never echo invalid raw URL input.
- Preserve useful protocol/host/port/path if safe.
- Redact URL substrings embedded in text messages where feasible.
```

Examples:

```txt
https://user:password@backend.internal:3000/api?token=abc#secret
→ https://backend.internal:3000/api

https://backend.internal:3000/api?password=secret
→ https://backend.internal:3000/api

not a url password=secret
→ [invalid-url-redacted]
```

### C. Object/log payload sanitization

For payloads like:

```json
{
  "liveUrl": "https://u:p@example.com/page?token=abc#x",
  "expected": "https://u:p@example.com/a?token=abc",
  "actual": "https://u:p@example.com/b?password=def",
  "message": "Loaded https://u:p@example.com/page?token=abc"
}
```

Output must not expose:

```txt
u
p
token
abc
password
def
fragment
```

### D. Patch known unsafe paths

Patch:

```txt
darshan-player/src/main/services/log-shipper.ts
darshan-player/src/renderer/webpage-playback.ts
darshan-player/src/renderer/player.ts
darshan-player/src/main/index.ts
darshan-player/src/main/services/network/request-queue.ts
```

Also re-check:

```txt
darshan-player/src/main/services/network/http-client.ts
darshan-player/src/main/services/pairing-service.ts
darshan-player/src/main/services/operator-tools.ts
darshan-player/src/main/services/realtime* if present
darshan-player/src/main/services/websocket* if present
```

### E. Request queue accounting

Requirement:

```txt
Use raw runtime data for request byte-size/accounting and persistence.
Use redacted data only for logs/diagnostics/output.
```

Add regression test proving accounting uses raw URL length or previous raw behavior, while emitted logs are redacted.

---

## 6.4 Tests for CONFIG-2.3

Run:

```bash
cd darshan-player && npm run build
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/redaction.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/file-config.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/operator-tools.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/heartbeat.test.ts
```

Add/run tests for:

```txt
log-shipper
request-queue
webpage-playback
renderer/main log sanitization
http-client
pairing-service diagnostics
```

Minimum assertions:

```txt
1. log-shipper does not log credentialed uploadUrl.
2. webpage-playback does not log credentialed liveUrl/expected/actual.
3. renderer-to-main log payload sanitizes URL fields.
4. request-queue accounting uses raw runtime data.
5. request-queue emitted logs are redacted.
6. doctor output does not include credentialed apiBase/wsUrl.
7. invalid URL does not echo raw input.
8. runtime API/socket/upload behavior is unchanged.
```

---

## 6.5 Docs to update for CONFIG-2.3

Update:

```txt
docs/implementation/config-phase-2-handoff.md
docs/implementation/config-phase-2-1-handoff.md
docs/implementation/config-phase-2-2-handoff.md
docs/architecture/onprem-config-architecture.md
docs/implementation/config-env-reduction-plan.md
docs/runbooks/onprem-config-management.md
docs/implementation/realtime-sync-open-risks.md
```

Create:

```txt
docs/implementation/config-phase-2-3-handoff.md
```

Required sections:

```txt
# CONFIG-2.3 Handoff: Complete Player URL Emission Redaction

## Summary
## Scope Implemented
## Files Changed
## Emission Paths Reviewed
## Tests Run
## Test Results
## Failed Tests
## Blocked Tests
## Security Review
## Runtime URL Behavior
## Runtime Evidence Status
## Rollback Plan
## Next Phase Readiness
## Recommendation
```

Allowed recommendation values:

```txt
APPROVE_CONFIG_2_3
APPROVE_WITH_CONDITIONS
NEEDS_FIX
BLOCKED
```

---

## 6.6 CONFIG-2.3 verification

After implementation, Codex must verify.

Search again:

```bash
rg -n "apiBase|baseURL|baseUrl|wsUrl|socket|uploadUrl|liveUrl|expected|actual|url|URL|diagnostics\.apiBase|result\.baseURL|logger\.|console\.|log\(" darshan-player/src darshan-player/test
```

Review every emission/log/serialize path manually.

Verification output:

```txt
# Verification: CONFIG-2.3 Complete Player URL Emission Redaction

## Verdict
APPROVED / APPROVED_WITH_CONDITIONS / NEEDS_FIX / BLOCKED

## Summary
## Emission Path Review
## Redaction Review
## Request Queue Accounting Review
## Runtime Behavior Review
## Secret Exposure Review
## Docs Review
## Test Evidence
## Failed Tests
## Blocked Tests
## Runtime Evidence Status
## Production Readiness Impact
## Can CONFIG-3 Start
yes / no / yes_with_conditions

## Recommended Next Action
```

---

# PHASE CONFIG-3 — CMS Runtime Config Alignment

Start only if CONFIG-2.3 passes.

## 7.1 Goal

Implement optional CMS runtime config alignment so on-prem QA/prod can change non-secret deployment values without rebuilding where feasible.

Do not put secrets into browser-visible config.

---

## 7.2 CMS config design

Because CMS is browser-based, runtime env vars may not be available after build. Prefer a browser-safe runtime config file:

```txt
public/runtime-config.json
```

or an injected global:

```txt
window.__DARSHAN_RUNTIME_CONFIG__
```

Use the mechanism that fits the current CMS stack best.

Recommended runtime config JSON:

```json
{
  "environment": {
    "name": "onprem-qa",
    "deploymentId": "qa-lab-1",
    "cmsId": "cms-a"
  },
  "api": {
    "baseUrl": "http://192.168.0.5:3000"
  },
  "realtime": {
    "socketIoUrl": "http://192.168.0.5:3000/socket.io/"
  },
  "features": {
    "pairingHealth": true
  },
  "diagnostics": {
    "showEnvironmentIdentity": true
  }
}
```

No secrets.

---

## 7.3 CONFIG-3 strict scope

```txt
- CMS only.
- Do not change backend/player behavior except docs/examples.
- Do not put API tokens or secrets in browser config.
- Existing Vite/build env behavior must remain.
- Runtime config is optional.
- No runtime config means existing behavior.
```

---

## 7.4 Files to inspect

```txt
darshan-cms/package.json
darshan-cms/src/api/apiClient.ts
darshan-cms/src/api/*
darshan-cms/src/config*
darshan-cms/src/main*
darshan-cms/src/App*
darshan-cms/src/pages/Screens.tsx
darshan-cms/src/components/screens/PairingHealthPanel.tsx
darshan-cms/public/*
darshan-cms/vite.config*
```

Search:

```bash
rg -n "import.meta.env|VITE_|API_BASE|baseURL|apiClient|runtime-config|window\.__|environment|deployment|PairingHealth|socket|CMS|config" darshan-cms docs
```

---

## 7.5 CONFIG-3 implementation requirements

### A. Runtime config loader

Add a CMS runtime config loader.

Possible file:

```txt
darshan-cms/src/config/runtimeConfig.ts
```

Responsibilities:

```txt
- load optional browser runtime config
- validate known keys
- reject secret-looking keys
- preserve existing env/build-time config if no runtime config
- env/build-time values override or runtime config overrides according to documented decision
- provide redacted/safe diagnostics summary
```

Recommended precedence:

```txt
1. built-in defaults
2. build-time Vite env
3. runtime-config.json if present
4. emergency local override only if existing code supports it
```

But if existing product requires env override, document and implement that instead.

Important: Browser runtime config should not contain secrets. If a secret-looking key appears, fail or ignore with safe error.

### B. API client integration

`apiClient` should use runtime config base URL if present.

No runtime config:

```txt
existing behavior unchanged.
```

### C. Environment identity display

CMS should show environment/deployment/cmsId in safe diagnostics area or Pairing Health panel.

This supports QA/prod mismatch detection.

### D. Pairing Health

Ensure Pairing Health uses runtime config API base correctly.

### E. Examples

Add:

```txt
docs/examples/cms-runtime-config.onprem-local-192.168.0.5.example.json
docs/examples/cms-runtime-config.qa.example.json
docs/examples/cms-runtime-config.production.example.json
```

Optionally add:

```txt
darshan-cms/public/runtime-config.example.json
```

Do not add real runtime-config.json if it would be deployed accidentally with example values, unless clearly example-only.

---

## 7.6 CONFIG-3 tests

Run:

```bash
cd darshan-cms && npm run build
cd darshan-cms && npm run lint
```

Add/run tests for:

```txt
runtime config missing -> existing API base behavior
runtime config present -> API base applied
secret-looking keys rejected
runtime config examples contain no secrets
PairingHealth uses configured API client
environment identity displays safely
```

If CMS has unit test setup:

```bash
cd darshan-cms && npm run test:unit
```

If it does not, document browser QA required.

---

## 7.7 CONFIG-3 docs

Update:

```txt
docs/architecture/onprem-config-architecture.md
docs/implementation/config-env-reduction-plan.md
docs/implementation/config-env-inventory.md
docs/runbooks/onprem-config-management.md
docs/implementation/realtime-sync-open-risks.md
docs/implementation/ghost-pairing-onprem-qa-evidence.md
```

Create:

```txt
docs/implementation/config-phase-3-handoff.md
```

Required sections:

```txt
# CONFIG-3 Handoff: CMS Runtime Config Alignment

## Summary
## Scope Implemented
## Files Changed
## Config Mechanism
## Config File Formats Supported
## Env/Runtime Compatibility
## Browser Secret Boundary
## Tests Run
## Test Results
## Failed Tests
## Blocked Tests
## Runtime Evidence Status
## Risks
## Rollback Plan
## Next Phase Readiness
## Recommendation
```

Allowed recommendation values:

```txt
APPROVE_CONFIG_3
APPROVE_WITH_CONDITIONS
NEEDS_FIX
BLOCKED
```

---

## 7.8 CONFIG-3 acceptance criteria

Approve only if:

```txt
- CMS builds with no runtime config.
- Existing env/build behavior remains compatible.
- Runtime config can set non-secret API base/environment labels.
- Browser-visible config rejects/does not include secrets.
- Pairing Health still works with existing API client.
- Tests pass.
- Browser runtime evidence is not falsely claimed.
```

Do not approve if:

```txt
- API secrets can appear in runtime config.
- Existing deployments break.
- CMS requires runtime config to boot.
- Runtime config examples contain secrets.
- Tests fail or are missing without documentation.
```

---

## 7.9 CONFIG-3 verification

Run an internal verification after implementation.

Output:

```txt
# Verification: CONFIG-3 CMS Runtime Config Alignment

## Verdict
APPROVED / APPROVED_WITH_CONDITIONS / NEEDS_FIX / BLOCKED

## Summary
## Runtime Config Review
## API Client Review
## Browser Secret Boundary Review
## Pairing Health Review
## Docs/Examples Review
## Test Evidence
## Failed Tests
## Blocked Tests
## Runtime Evidence Status
## Can CONFIG-4 Start
yes / no / yes_with_conditions

## Recommended Next Action
```

---

# PHASE CONFIG-4 — On-Prem Config Profile Sets

Start only if CONFIG-3 passes.

## 8.1 Goal

Create complete, safe on-prem config profile examples for dev/QA/prod, including backend, player, CMS, and secrets templates.

No runtime behavior changes unless validator scripts are added.

---

## 8.2 Profile sets to create

Create:

```txt
docs/examples/onprem-dev-config-set/
docs/examples/onprem-qa-config-set/
docs/examples/onprem-prod-config-set/
```

Each should include:

```txt
backend-config.example.json
player-config.example.json
cms-runtime-config.example.json
secrets.env.example
README.md
validation-checklist.md
```

Use:

```txt
192.168.0.5
```

only in local/dev examples, not as universal QA/prod.

QA/prod examples should use placeholders:

```txt
https://qa-backend.internal.example
https://qa-cms.internal.example
https://prod-backend.internal.example
https://prod-cms.internal.example
```

or clearly marked internal hostnames.

---

## 8.3 Secrets template rules

`secrets.env.example` may contain placeholder keys only:

```txt
DATABASE_URL=postgres://<user>:<password>@<host>:5432/<db>
VALKEY_URL=valkey://:<password>@<host>:6379/0
JWT_SECRET=<generate-strong-secret>
OBJECT_STORAGE_ACCESS_KEY=<access-key>
OBJECT_STORAGE_SECRET_KEY=<secret-key>
```

No real secrets.

---

## 8.4 Validation script

Add a safe validator if feasible:

```txt
scripts/verify/validate-onprem-config-examples.sh
```

or under existing script conventions.

Checks:

```txt
- required example files exist
- no obvious real secrets
- no PEM/private key blocks
- JSON parses
- no credentialed URL in non-secret config files
- secrets.env.example contains placeholders only
- docs reference CONFIG-1/2/3 correctly
```

Do not require running services.

---

## 8.5 CONFIG-4 docs

Update:

```txt
docs/architecture/onprem-config-architecture.md
docs/implementation/config-env-reduction-plan.md
docs/runbooks/onprem-config-management.md
docs/implementation/realtime-sync-open-risks.md
docs/implementation/ghost-pairing-onprem-qa-evidence.md
```

Create:

```txt
docs/implementation/config-phase-4-handoff.md
```

Required sections:

```txt
# CONFIG-4 Handoff: On-Prem Config Profile Sets

## Summary
## Scope Implemented
## Files Changed
## Profile Sets
## Validation
## Tests Run
## Test Results
## Failed Tests
## Blocked Tests
## Runtime Evidence Status
## Risks
## Rollback Plan
## Next Phase Readiness
## Recommendation
```

---

## 8.6 CONFIG-4 tests

Run:

```bash
bash scripts/verify/validate-onprem-config-examples.sh
```

If script path differs, use actual path.

Run builds only if code changed.

---

## 8.7 CONFIG-4 acceptance criteria

Approve if:

```txt
- dev/QA/prod config example sets exist
- no real secrets are included
- JSON examples parse
- non-secret config contains no credentialed URLs
- secrets template uses placeholders only
- validation script passes
- runtime evidence is not falsely claimed
```

---

# PHASE CONFIG-5 — On-Prem Runtime Evidence and Production-Readiness Evidence

Start only if CONFIG-4 passes and runtime inputs exist.

## 9.1 Goal

Collect actual evidence from on-prem/browser/packaged player runtime. This is not docs-only.

Do not claim pass unless the test actually ran.

---

## 9.2 Required inputs

Codex must check for:

```txt
ONPREM_QA_BACKEND_BASE_URL
ONPREM_QA_CMS_BASE_URL
ONPREM_QA_SOCKET_IO_URL
ONPREM_POSTGRES_URL
ONPREM_VALKEY_URL
ONPREM_MEDIA_ENDPOINT
ONPREM_PROMETHEUS_URL
ONPREM_GRAFANA_URL
ONPREM_LOGS_PATH
ONPREM_QA_DEVICE_PAIRING_METHOD
ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH
ONPREM_INTERNAL_CA_CERT_PATH
ONPREM_TLS_MODE
ONPREM_PLAYER_PACKAGE_PATH
ONPREM_PLAYER_MACHINE_A
ONPREM_PLAYER_MACHINE_B
ONPREM_PLAYER_RUNTIME_ROOT_A
ONPREM_PLAYER_RUNTIME_ROOT_B
NODE20_PATH
```

If missing, mark:

```txt
BLOCKED_BY_ENV
```

Do not fake.

---

## 9.3 Runtime evidence tests

### A. Node 20 validation

Use `NODE20_PATH` if provided.

Run builds/tests under Node >=20 <21.

### B. Browser CMS QA

Test:

```txt
CMS loads
Pairing Health loads
environment identity visible
orphan rows visible if fixture exists
duplicate conflict visible if fixture exists
revoke action works
reclaim disabled
no secrets in browser UI/network snapshot
```

### C. Packaged player smoke

Test packaged player, not only dev process:

```txt
install/start
pair
CMS shows screen
no-content only after backend validation
revoke from CMS
player requires re-pair
reset-pairing dry-run
reset-pairing
re-pair as new screen
```

### D. Reinstall/app-data smoke

Test:

```txt
uninstall without reset
reinstall
old app-data validation behavior correct
revoke/delete -> requires pairing
clean reset -> new player
```

### E. Two-player cloned identity smoke

Test with two machines or isolated runtime roots:

```txt
copy app-data
start both
duplicate warning appears
enforcement remains warn
revoke/reset resolves operationally
```

### F. Environment mismatch smoke

Test safely in QA:

```txt
mismatched environment/deployment header/config
pairing-status returns ENVIRONMENT_MISMATCH
player does not show paired/no-content
CMS shows environment info
```

### G. No-secret runtime review

Review:

```txt
backend logs
player logs
doctor output
support bundle output
browser network payloads
CMS screenshots
Pairing Health API
runtime-config.json
```

Ensure no:

```txt
PEM
private key
tokens
passwords
signed URLs
full serials
credentialed URLs
raw hardware IDs
```

---

## 9.4 CONFIG-5 docs/evidence

Update/create:

```txt
docs/implementation/config-phase-5-runtime-evidence.md
docs/implementation/ghost-pairing-onprem-qa-evidence.md
docs/implementation/ghost-pairing-production-readiness-review.md
docs/implementation/realtime-sync-open-risks.md
```

Evidence must include:

```txt
date/time
environment
build/package version
config files used
operator
commands run
screenshots/log references redacted
pass/fail/block
remaining risks
```

---

## 9.5 CONFIG-5 output

CONFIG-5 can end in:

```txt
APPROVED_WITH_CONDITIONS
BLOCKED_BY_ENV
NEEDS_FIX
```

It should not automatically mark production ready. Production readiness decision is separate.

---

# PHASE Production Readiness Decision

Only after CONFIG-5 evidence exists.

Allowed decisions:

```txt
PRODUCTION_READY
PRODUCTION_READY_WITH_ACCEPTED_RISKS
NOT_PRODUCTION_READY
BLOCKED_BY_ENV
```

Read:

```txt
docs/implementation/config-phase-5-runtime-evidence.md
docs/implementation/ghost-pairing-onprem-qa-evidence.md
docs/implementation/ghost-pairing-production-readiness-review.md
docs/implementation/realtime-sync-open-risks.md
all CONFIG and GP handoffs
```

Output:

```txt
# Production Readiness Decision

## Decision
## Summary
## Evidence Reviewed
## Tests Passed
## Tests Failed
## Tests Blocked
## Risks Accepted
## Risks Not Accepted
## Rollback Plan
## Operator Runbooks
## Required Monitoring
## Go/No-Go
## Conditions
## Next Action
```

---

# 10. Master prompt to paste into Codex

Paste this after placing the runbook file in repo root.

```txt
You are Codex acting as principal implementation lead, senior security reviewer, senior Electron engineer, senior backend engineer, senior CMS engineer, and production-readiness reviewer.

Repo root:
/Users/anuragkumar/Desktop/signhex

First read:
SIGNHEX_AUTONOMOUS_CODEX_CONFIG_2_3_TO_5_RUNBOOK.md

Then read any existing:
- ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md
- SIGNHEX_AUTONOMOUS_CODEX_PRODUCTION_READINESS_RUNBOOK.md
- docs/implementation/config-phase-2-handoff.md
- docs/implementation/config-phase-2-1-handoff.md
- docs/implementation/config-phase-2-2-handoff.md
- docs/implementation/realtime-sync-open-risks.md
- docs/implementation/ghost-pairing-production-readiness-review.md

Goal:
Continue autonomously from the current state through CONFIG-2.3, CONFIG-3, CONFIG-4, and CONFIG-5 with strict gates.

Current expected blocker:
CONFIG-2.2 was independently verified as NEEDS_FIX because raw URL emissions remain in:
- log-shipper uploadUrl logs
- renderer webpage liveUrl/expected/actual logs
- renderer-to-main log forwarding
- request-queue size accounting using redacted URL data

Rules:
1. Do not start CONFIG-3 until CONFIG-2.3 passes verification.
2. Do not start CONFIG-4 until CONFIG-3 passes verification.
3. Do not start CONFIG-5 until CONFIG-4 passes verification and runtime inputs exist.
4. Do not mark production ready.
5. Do not fake runtime evidence.
6. Do not expose credentialed URLs or secrets in diagnostics/logs/support/browser output.
7. Runtime URLs must remain raw internally for actual network operations.
8. Redaction applies only to emitted/logged/diagnostic/support/browser-visible data.
9. After every implementation task, run verification checks and update docs/handoff.
10. Continue to the next phase only if the current phase is APPROVED or APPROVED_WITH_CONDITIONS and conditions do not block the next phase.
11. Stop if human input, Node 20 runtime, on-prem endpoints, packaged player target, browser QA, or risk acceptance is required.

Process:
1. Start with git status/diff.
2. Verify actual current code and docs.
3. If CONFIG-2.3 is needed, implement it.
4. Run required tests.
5. Perform verification using the checklist in the runbook.
6. Update CONFIG-2.3 handoff and related docs.
7. If CONFIG-2.3 passes, proceed to CONFIG-3 CMS runtime config alignment.
8. If CONFIG-3 passes, proceed to CONFIG-4 on-prem config profile sets.
9. If CONFIG-4 passes and runtime inputs exist, proceed to CONFIG-5 runtime evidence.
10. If runtime inputs are missing, stop with BLOCKED_BY_ENV and list exact missing inputs.

Final response after this Codex session must include:

Current phase:
Approval state:
Task completed:
Verification result:
Files changed:
Migrations changed:
APIs changed:
Env vars changed:
Tests run:
Tests passed:
Tests failed:
Tests blocked:
Runtime evidence status:
Production readiness:
Can next phase start:
Human inputs required:
Next action:
```

---

## 11. Required final response format from Codex

Every Codex run using this file must end with:

```txt
Current phase:
Approval state:
Task completed:
Verification result:
Files changed:
Migrations changed:
APIs changed:
Env vars changed:
Tests run:
Tests passed:
Tests failed:
Tests blocked:
Runtime evidence status:
Production readiness:
Can next phase start:
Human inputs required:
Next action:
```
