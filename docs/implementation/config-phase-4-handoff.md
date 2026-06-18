# CONFIG-4 Handoff: On-Prem Config Profile Sets

## Summary

CONFIG-4 creates complete non-secret on-prem config profile examples for dev, QA, and production, plus a static validation script. No runtime behavior changed.

## Scope Implemented

- Added dev, QA, and production profile set directories under `docs/examples/`.
- Each profile set contains backend, player, CMS runtime, secrets template, README, and validation checklist files.
- Added `scripts/verify/validate-onprem-config-examples.sh`.
- Updated config architecture, reduction plan, operator runbook, open risks, and QA evidence docs.

## Files Changed

- `docs/examples/onprem-dev-config-set/backend-config.example.json`
- `docs/examples/onprem-dev-config-set/player-config.example.json`
- `docs/examples/onprem-dev-config-set/cms-runtime-config.example.json`
- `docs/examples/onprem-dev-config-set/secrets.env.example`
- `docs/examples/onprem-dev-config-set/README.md`
- `docs/examples/onprem-dev-config-set/validation-checklist.md`
- `docs/examples/onprem-qa-config-set/backend-config.example.json`
- `docs/examples/onprem-qa-config-set/player-config.example.json`
- `docs/examples/onprem-qa-config-set/cms-runtime-config.example.json`
- `docs/examples/onprem-qa-config-set/secrets.env.example`
- `docs/examples/onprem-qa-config-set/README.md`
- `docs/examples/onprem-qa-config-set/validation-checklist.md`
- `docs/examples/onprem-prod-config-set/backend-config.example.json`
- `docs/examples/onprem-prod-config-set/player-config.example.json`
- `docs/examples/onprem-prod-config-set/cms-runtime-config.example.json`
- `docs/examples/onprem-prod-config-set/secrets.env.example`
- `docs/examples/onprem-prod-config-set/README.md`
- `docs/examples/onprem-prod-config-set/validation-checklist.md`
- `scripts/verify/validate-onprem-config-examples.sh`
- `docs/architecture/onprem-config-architecture.md`
- `docs/implementation/config-env-reduction-plan.md`
- `docs/runbooks/onprem-config-management.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `docs/implementation/ghost-pairing-onprem-qa-evidence.md`

## Profile Sets

- Dev: uses local `192.168.0.5` example host values only.
- QA: uses placeholder internal hostnames such as `https://qa-backend.internal.example`.
- Production: uses placeholder internal hostnames such as `https://prod-backend.internal.example`.

## Validation

The validator checks:

- required profile files exist
- JSON examples parse
- non-secret JSON files do not contain credentialed URLs
- non-secret JSON files do not contain secret-looking query parameters
- no PEM/private key/certificate blocks are present
- `secrets.env.example` values are placeholders only
- core config docs reference CONFIG-1/2/3

The validator does not contact any services and does not claim runtime evidence.

## Tests Run

- `bash scripts/verify/validate-onprem-config-examples.sh`

## Test Results

Passed:

- `On-prem config example validation passed for 3 profile sets.`

## Failed Tests

None.

## Blocked Tests

- Node 20 validation remains blocked.
- Browser/on-prem runtime evidence remains blocked.
- Packaged player evidence remains blocked.

## Runtime Evidence Status

BLOCKED_BY_ENV. CONFIG-4 is static config/example validation only.

## Risks

- Profile sets are examples, not site-specific approved configs.
- Sites must replace placeholder hostnames and secrets locally.
- Production readiness still requires runtime validation using actual on-prem endpoints.

## Rollback Plan

Remove the CONFIG-4 profile directories and validator script, then revert the docs listed in this handoff. No runtime code or migrations changed.

## Next Phase Readiness

CONFIG-5 can start only if runtime inputs exist. If required on-prem endpoints, Node 20 runtime, packaged player target, and browser QA target are missing, CONFIG-5 must stop as BLOCKED_BY_ENV.

## Recommendation

APPROVE_WITH_CONDITIONS
