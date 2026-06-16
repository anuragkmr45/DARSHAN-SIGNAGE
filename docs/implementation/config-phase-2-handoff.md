# CONFIG-2 Handoff: Player Config Alignment

## Summary

CONFIG-2 adds an optional player-specific JSON site config loader for non-secret on-prem deployment values. Existing player behavior remains compatible when no player site config selector is set. Existing runtime config files, app-data, pairing identity, certificates, cache metadata, offline queues, and reset behavior remain separate from site config.

## Scope Implemented

- Added player JSON site config loader.
- Added player-specific config selectors.
- Preserved existing runtime config selector behavior.
- Added env override support for the focused CONFIG-2 subset.
- Added redacted player runtime config diagnostics for operator tooling.
- Sent configured environment/deployment labels on pairing-status validation.
- Made offline validation grace configurable without changing the default.
- Added CONFIG-2 player examples and updated config/runbook/status docs.

## Out of Scope

- CMS runtime config.
- Backend CONFIG-1 loader changes beyond docs/status notes.
- YAML support.
- Secrets-file loading.
- Production readiness approval.
- Browser/on-prem runtime evidence.
- Packaged player smoke evidence.

## Files Changed

- `darshan-player/src/common/file-config.ts`
- `darshan-player/src/common/config.ts`
- `darshan-player/src/common/types.ts`
- `darshan-player/src/main/services/pairing-service.ts`
- `darshan-player/src/main/services/player-flow.ts`
- `darshan-player/src/main/services/operator-tools.ts`
- `darshan-player/test/unit/common/file-config.test.ts`
- `darshan-player/test/unit/services/pairing-service.test.ts`
- `darshan-player/test/unit/common/config.test.ts`
- `darshan-player/test/unit/main/operator-tools.test.ts`
- `docs/examples/player-config.onprem-local-192.168.0.5.example.json`
- `docs/examples/player-config.qa.example.json`
- `docs/examples/player-config.production.example.json`
- config architecture, inventory, runbook, readiness, and risk docs

## Config Selectors

Supported:

- `DARSHAN_PLAYER_CONFIG_FILE`: preferred player JSON site config selector.
- `SIGNHEX_PLAYER_CONFIG_FILE`: alias if `DARSHAN_PLAYER_CONFIG_FILE` is absent.
- `DARSHAN_ENV`: profile/label selector.
- `SIGNHEX_ENV`: alias if `DARSHAN_ENV` is absent.

Rules:

- no player site config selector means existing behavior.
- both player selectors may point to the same resolved path.
- different player selector paths fail fast.
- generic `DARSHAN_CONFIG_FILE` / `SIGNHEX_CONFIG_FILE` are not used by the player in CONFIG-2.

Existing runtime config selectors remain supported:

- `DARSHAN_CONFIG_PATH`
- `SIGNAGE_CONFIG_PATH`
- `HEXMON_CONFIG_PATH`

## Config File Formats Supported

CONFIG-2 supports JSON only. YAML is intentionally rejected because no YAML parser was added for the air-gapped package mirror.

## Env Compatibility

Existing env and runtime config behavior remains compatible. Env vars override selected player site config values. Focused CONFIG-2 keys include:

- backend base URL
- Socket.IO URL
- environment/deployment labels
- selected realtime and polling timings
- offline validation grace
- backend-first rollout flag
- duplicate identity detection/enforcement display values
- cache max bytes
- diagnostics environment display flag

## Runtime State Boundary

The following remain runtime state, not config:

- device id
- certificates and private keys
- pairing codes and pairing validation metadata
- install instance id
- runtime session id
- snapshot/default-media metadata
- media cache
- proof-of-play spool
- request queue
- logs and screenshots

## Redacted Diagnostics

`darshan-player --pairing-status` and doctor output include a redacted config summary. It reports whether a player site config file is loaded, selected profile, safe environment labels, backend URL host/path, offline grace, duplicate identity mode, and mapped config keys. It does not include certificate material, private keys, tokens, full runtime identifiers, pairing secrets, URL username/password userinfo, URL query strings, or URL fragments.

CONFIG-2.1 tightened this after independent review found that credentialed env URLs could be printed by diagnostics. Runtime API/socket URL behavior is unchanged; only support diagnostics are redacted.

## Tests Run

```bash
cd darshan-player && npm run build
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/file-config.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/pairing-service.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/operator-tools.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/heartbeat.test.ts
cd darshan-server && npm run build
cd darshan-server && npx vitest run src/config/file-config.test.ts
```

## Test Results

- `npm run build`: passed
- `test/unit/common/file-config.test.ts`: 12 passing after CONFIG-2.1 URL redaction regressions
- `test/unit/services/pairing-service.test.ts`: 1 passing
- `test/unit/services/player-flow.test.ts`: 21 passing
- `test/unit/main/cli.test.ts`: 7 passing
- `test/unit/main/operator-tools.test.ts`: 5 passing
- `test/unit/services/heartbeat.test.ts`: 2 passing
- backend `npm run build`: passed
- backend `src/config/file-config.test.ts`: 15 passing

## Failed Tests

None remaining in the targeted CONFIG-2 commands.

## Blocked Tests

- Node 20 validation remains blocked in this workspace.
- Browser/on-prem runtime evidence remains blocked.
- Packaged player evidence remains blocked.

## Runtime Evidence Status

BLOCKED_BY_ENV. CONFIG-2 added examples and local code/tests only. Local discovery found listeners on `3000`, `8080`, `9000`, `9001`, `9090`, `3001`, `6379`, and `5432`, but health probes to `http://192.168.0.5:3000/api/v1/health` and `http://127.0.0.1:3000/api/v1/health` failed. Local Node is `v24.12.0`, not the supported `>=20 <21` validation runtime. No browser/on-prem runtime evidence was claimed.

## Risks

- CMS runtime config remains build-time/env based.
- Player JSON loader needs Node 20 validation before production signoff.
- Site config examples still need on-prem endpoint confirmation.
- Runtime evidence still requires real backend/CMS/player targets.

## Rollback Plan

Unset `DARSHAN_PLAYER_CONFIG_FILE`, `SIGNHEX_PLAYER_CONFIG_FILE`, `DARSHAN_ENV`, and `SIGNHEX_ENV` to return to the previous player runtime-config-only behavior. Existing `DARSHAN_CONFIG_PATH`, `SIGNAGE_CONFIG_PATH`, and `HEXMON_CONFIG_PATH` remain available. Reverting CONFIG-2 code is also safe because it is opt-in and additive.

## Next Phase Readiness

CONFIG-3 CMS runtime config can start with conditions:

- CONFIG-2 independent verification passes.
- No production readiness is claimed.
- Node 20 and runtime evidence remain blockers.

## Recommendation

APPROVE_WITH_CONDITIONS
