# CONFIG-0 Handoff: On-Prem Config / Env Reduction

## Summary

CONFIG-0 audited the current Darshan env/config surface and recorded a non-breaking target architecture for air-gapped on-prem deployments. No runtime code was changed. Existing env vars remain the source of truth until a later phase adds optional config-file loaders.

## Scope

Included:

- current server/player/CMS config pattern review
- env var classification
- target config hierarchy and precedence
- secrets policy
- local `192.168.0.5` example profile
- on-prem config management runbook
- status-doc updates

Excluded:

- backend config loader implementation
- CMS runtime config loader implementation
- player config behavior changes
- production readiness approval
- browser/on-prem runtime evidence

## Files Inspected

- `darshan-server/src/config/index.ts`
- `darshan-server/src/device-auth/config.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.qa.example`
- `darshan-player/src/common/config.ts`
- `darshan-player/src/common/platform-paths.ts`
- `darshan-player/config.example.json`
- `darshan-cms/.env`
- `darshan-cms/src/api/apiClient.ts`
- `darshan-cms/src/api/notificationsSocket.ts`
- `darshan-cms/src/components/ProductionSecurityBoundary.tsx`
- `darshan-cms/src/components/screens/ScreenDetailsModal.tsx`
- `docs/implementation/ghost-pairing-production-readiness-review.md`
- `docs/implementation/ghost-pairing-onprem-qa-evidence.md`
- `docs/implementation/ghost-pairing-e2e-matrix.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md`

## Env Inventory

The inventory is recorded in `docs/implementation/config-env-inventory.md`.

High-level classification:

- server has the largest env surface and should be migrated first
- player already has a config-file model and mostly needs documentation/alignment
- CMS endpoint config is build-time today and should move to runtime config in a later phase
- deploy/evidence inputs should become evidence config profiles, with sensitive values staying in env/secrets

## Recommended Target Architecture

Use config files for non-secret runtime settings and env/secrets files for secrets:

```text
/etc/darshan/server/config.qa.yaml
/etc/darshan/server/secrets.env
/etc/darshan/cms/config.qa.yaml
/etc/darshan/cms/secrets.env
/etc/darshan/player/config.qa.json
/etc/darshan/player/secrets.env
```

Recommended precedence:

1. built-in defaults
2. committed example config
3. environment profile config
4. site-specific config file
5. environment variables
6. command-line overrides where supported

## Files Created/Updated

- `docs/architecture/onprem-config-architecture.md`
- `docs/implementation/config-env-reduction-plan.md`
- `docs/implementation/config-env-inventory.md`
- `docs/runbooks/onprem-config-management.md`
- `docs/examples/onprem-local-192.168.0.5.config.example.yaml`
- `docs/implementation/config-phase-0-handoff.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `docs/implementation/ghost-pairing-production-readiness-review.md`
- `docs/implementation/ghost-pairing-onprem-qa-evidence.md`
- `docs/implementation/ghost-pairing-e2e-matrix.md`

## Code Changed

None.

## Tests Run

CONFIG-0 is docs/examples only.

Local discovery commands:

- `lsof -iTCP -sTCP:LISTEN -n -P`
- `curl -fsS -m 2 http://192.168.0.5:3000/api/v1/health`
- `curl -fsS -m 2 http://192.168.0.5:9000/minio/health/live`
- `curl -fsS -m 2 http://192.168.0.5:9090/-/ready`
- `curl -fsS -m 2 http://127.0.0.1:3000/api/v1/health`

Result:

- listeners were present on common backend/CMS/data/observability ports
- health checks failed, so no runtime evidence was claimed

## Blocked Items

- Browser/on-prem runtime evidence remains blocked.
- Node 20 validation remains blocked.
- Backend/CMS config loaders are not implemented yet.
- CMS still uses Vite build-time env for backend/socket URLs.

## Risks

- A large immediate env-to-config refactor could break on-prem deployments.
- CMS runtime config requires packaging and nginx review.
- Valkey URL handling needs a decision on URL-vs-split-secret fields.
- Legacy aliases cannot be removed until deployed sites are audited.

## Required Human Decisions

- Use `SIGNHEX_CONFIG_FILE`, `DARSHAN_CONFIG_FILE`, or both.
- Choose CMS runtime config mechanism.
- Decide Valkey secret split strategy.
- Provide Node 20 runtime path.
- Provide on-prem QA endpoint values before runtime evidence collection.

## Next Implementation Phase

CONFIG-1 implements optional backend config-file loading with no behavior change when unset:

- support `DARSHAN_CONFIG_FILE`
- support `SIGNHEX_CONFIG_FILE` alias
- merge non-secret config before env validation
- keep env overrides
- add redacted config summary
- add tests for precedence and secret redaction

Post-CONFIG-2 note: backend CONFIG-1 and player CONFIG-2 loaders are now implemented with compatibility preserved. CMS runtime config remains a later phase.

## Recommendation

APPROVE_CONFIG_PLAN with conditions:

- no production readiness approval until browser/on-prem runtime evidence and Node 20 validation pass
- no runtime loader refactor until CONFIG-1 is reviewed
- keep existing env compatibility throughout migration
