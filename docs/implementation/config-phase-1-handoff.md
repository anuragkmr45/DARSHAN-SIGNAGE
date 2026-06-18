# CONFIG-1 Handoff: Backend Config Loader

## Summary

CONFIG-1 adds an optional backend JSON config loader for a focused non-secret config subset. Existing `.env` behavior remains compatible: if no config file selector is set, backend behavior is unchanged; if a config file is set, env vars override config-file values.

No player or CMS runtime config refactor was done in CONFIG-1. Post-CONFIG-2 note: player-specific JSON site config alignment has since been implemented; CMS runtime config remains pending.

## Scope Implemented

- Added backend config loader module: `darshan-server/src/config/file-config.ts`
- Integrated loader into `darshan-server/src/config/index.ts`
- Added redacted runtime config summary function
- Added unit tests for selector behavior, env precedence, invalid config, strict keys, JSON-only format, secret-key rejection, credentialed URL rejection, and diagnostics redaction
- Added backend JSON config examples
- Added backend config selector variables to server env examples
- Updated CONFIG docs and production-readiness status docs

## Out of Scope

- Player config loader refactor, later completed in CONFIG-2
- CMS runtime config loader
- YAML support
- secrets-file autoloading
- public diagnostics endpoint
- production readiness approval
- browser/on-prem runtime evidence

## Files Changed

- `darshan-server/src/config/file-config.ts`
- `darshan-server/src/config/file-config.test.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.qa.example`
- `docs/examples/backend-config.onprem-local-192.168.0.5.example.json`
- `docs/examples/backend-config.qa.example.json`
- `docs/examples/backend-config.production.example.json`
- `docs/architecture/onprem-config-architecture.md`
- `docs/implementation/config-env-reduction-plan.md`
- `docs/implementation/config-env-inventory.md`
- `docs/implementation/config-phase-0-handoff.md`
- `docs/implementation/config-phase-1-handoff.md`
- `docs/runbooks/onprem-config-management.md`
- `docs/implementation/ghost-pairing-production-readiness-review.md`
- `docs/implementation/ghost-pairing-onprem-qa-evidence.md`
- `docs/implementation/realtime-sync-open-risks.md`

## Config Selectors

Supported:

- `DARSHAN_CONFIG_FILE`: preferred backend JSON config file selector
- `SIGNHEX_CONFIG_FILE`: alias if `DARSHAN_CONFIG_FILE` is absent
- `DARSHAN_ENV`: preferred backend environment/profile label selector
- `SIGNHEX_ENV`: alias if `DARSHAN_ENV` is absent

Rules:

- no selector means current env-only behavior
- both config selectors may point to the same resolved path
- different config selector paths fail fast
- both environment selectors must match if both are set
- `NODE_ENV` remains the fallback profile label source and is not rewritten

## Config File Formats Supported

CONFIG-1 supports JSON only.

YAML remains a target architecture option, but the backend package does not currently include a YAML parser. No dependency was added in CONFIG-1 to avoid creating a new air-gapped package mirror requirement.

## Env Compatibility

Env vars override config file values. The loader maps a focused non-secret config subset into existing env-shaped keys before the existing Zod env schema parses the runtime config.

Focused keys include:

- server identity labels
- CORS/socket origins
- Socket.IO path/transport/polling/sticky-session flags
- realtime bus provider
- Valkey non-secret mode/TLS/namespace/pubsub/timing values
- duplicate identity detection/enforcement/timings
- MinIO endpoint/port/SSL/region derived from non-credentialed media endpoint
- Prometheus/Grafana non-secret observability values
- websocket notification size limit

Secrets remain env/secrets-file managed.

## Redacted Diagnostics

`getRedactedRuntimeConfigSummary()` is available from `darshan-server/src/config/index.ts`.

It reports:

- config file configured/loaded/source/path/format
- profile selector
- environment/deployment/server labels
- duplicate identity settings
- realtime bus/socket settings
- Valkey mode/TLS/auth/namespace plus `urlConfigured` boolean
- observability endpoint labels
- mapped config keys
- explicit redaction marker

It does not include DB URLs, JWT secrets, Valkey URLs, tokens, private keys, passwords, or object storage secrets.

## Tests Run

```bash
cd darshan-server && npm run build
cd darshan-server && npx vitest run src/config/file-config.test.ts
cd darshan-server && npx vitest run src/routes/device-telemetry-auth.test.ts
cd darshan-server && npx vitest run src/routes/device-pairing.test.ts
cd darshan-server && npx vitest run src/routes/screens.test.ts
```

Local discovery:

```bash
lsof -iTCP -sTCP:LISTEN -n -P
curl -fsS -m 2 http://192.168.0.5:3000/api/v1/health
curl -fsS -m 2 http://127.0.0.1:3000/api/v1/health
node -v
```

## Test Results

- `npm run build`: passed
- `src/config/file-config.test.ts`: 15 passed
- `src/routes/device-telemetry-auth.test.ts`: 23 passed
- `src/routes/device-pairing.test.ts`: 16 passed
- `src/routes/screens.test.ts`: 19 passed when rerun isolated

Note: an initial parallel run of DB-mutating route suites produced a non-authoritative `screens.test.ts` count failure. The isolated required command passed.

## Failed Tests

No required isolated test command remained failing.

## Blocked Tests

- Node 20 validation remains blocked. Local Node is `v24.12.0`; target remains `>=20 <21`.
- Browser/on-prem runtime evidence remains blocked.
- Packaged player evidence remains blocked.

## Runtime Evidence Status

BLOCKED_BY_ENV.

Local listeners were present on ports including `3000`, `8080`, `9000`, `9001`, `9090`, `3001`, `6379`, and `5432`, but backend health checks failed on `192.168.0.5:3000` and `127.0.0.1:3000`. No runtime evidence was claimed.

## Risks

- Backend JSON loader is new and needs Node 20 validation.
- YAML examples remain docs/target architecture only.
- CMS still uses Vite build-time env for endpoint config.
- Player config was unchanged in CONFIG-1; CONFIG-2 later added opt-in player-specific JSON site config alignment.
- Real site config runtime evidence has not run.

## Rollback Plan

Unset `DARSHAN_CONFIG_FILE`, `SIGNHEX_CONFIG_FILE`, `DARSHAN_ENV`, and `SIGNHEX_ENV` to return to previous env-only backend behavior. The code path with no config selector preserves existing behavior.

If needed, revert:

- `darshan-server/src/config/file-config.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/src/config/file-config.test.ts`
- CONFIG-1 docs/examples/env-example changes

## Next Phase Readiness

CONFIG-2 has started and completed locally. Independent CONFIG-2 verification can start with conditions:

- backend CONFIG-1 tests stay green
- no production readiness is claimed
- Node 20 and runtime evidence remain blockers

Next recommended scope after CONFIG-2 verification: CONFIG-3 CMS runtime config alignment.

## Recommendation

APPROVE_WITH_CONDITIONS
