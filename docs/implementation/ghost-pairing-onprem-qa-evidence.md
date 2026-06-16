# Ghost Pairing On-Prem QA Evidence

Status: BLOCKED_BY_ENV
Date/time: 2026-06-16 14:27 IST
Operator: Codex
Repository: `/Users/anuragkumar/Desktop/signhex`
Branch: `rename/darshan-product`

## Scope

This evidence pass attempted to collect real browser/on-prem packaged runtime evidence for Ghost Pairing GP-1 through GP-6. No browser QA, packaged player smoke, duplicate cloned identity smoke, environment mismatch smoke, or no-secret runtime review was marked as passed because the required on-prem QA inputs were not present.

## Environment Discovery

Required input presence, without secret values:

| Input | Status |
|---|---|
| `ONPREM_QA_BACKEND_BASE_URL` | missing |
| `ONPREM_QA_CMS_BASE_URL` | missing |
| `ONPREM_QA_SOCKET_IO_URL` | missing |
| `ONPREM_POSTGRES_URL` | missing |
| `ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH` | missing |
| `ONPREM_MEDIA_ENDPOINT` | missing |
| `ONPREM_VALKEY_URL` | missing |
| `ONPREM_PROMETHEUS_URL` | missing |
| `ONPREM_GRAFANA_URL` | missing |
| `ONPREM_LOGS_PATH` | missing |
| `ONPREM_QA_DEVICE_PAIRING_METHOD` | missing |
| `ONPREM_INTERNAL_CA_CERT_PATH` | missing |
| `ONPREM_TLS_MODE` | missing |
| `ONPREM_PLAYER_PACKAGE_PATH` | missing |
| `ONPREM_PLAYER_MACHINE_A` | missing |
| `ONPREM_PLAYER_MACHINE_B` | missing |
| `ONPREM_PLAYER_RUNTIME_ROOT_A` | missing |
| `ONPREM_PLAYER_RUNTIME_ROOT_B` | missing |
| `NODE20_PATH` | missing |

CONFIG-0 local discovery:

| Check | Result |
|---|---|
| Local example profile | `docs/examples/onprem-local-192.168.0.5.config.example.yaml` created as non-secret example only |
| Backend CONFIG-1 JSON examples | `docs/examples/backend-config.onprem-local-192.168.0.5.example.json`, `docs/examples/backend-config.qa.example.json`, `docs/examples/backend-config.production.example.json` |
| Player CONFIG-2 JSON examples | `docs/examples/player-config.onprem-local-192.168.0.5.example.json`, `docs/examples/player-config.qa.example.json`, `docs/examples/player-config.production.example.json` |
| Listening ports observed | `3000`, `8080`, `9000`, `9001`, `9090`, `3001`, `6379`, `5432` |
| `http://192.168.0.5:3000/api/v1/health` | connection failed |
| `http://192.168.0.5:9000/minio/health/live` | connection failed |
| `http://192.168.0.5:9090/-/ready` | connection failed |
| `http://127.0.0.1:3000/api/v1/health` | connection failed |

No runtime evidence was claimed from these local listeners.

Supported runtime check:

| Check | Result |
|---|---|
| Required Node runtime | `>=20 <21` |
| Available Node runtime | `v24.12.0` |
| Node 20 validation | BLOCKED_BY_ENV |

## Scenarios

| Scenario | Status | Evidence | Remaining Work |
|---|---|---|---|
| Browser CMS Pairing Health QA | BLOCKED_BY_ENV | `ONPREM_QA_CMS_BASE_URL` and `ONPREM_QA_BACKEND_BASE_URL` are missing. | Provide QA CMS/backend endpoints and run the browser checklist in `docs/runbooks/ghost-pairing-onprem-qa-checklist.md`. |
| Packaged player fresh pair/revoke/reset/re-pair smoke | BLOCKED_BY_ENV | No packaged QA player target, backend endpoint, or simulator/pairing workflow input was provided. | Install/start packaged player against on-prem QA and capture redacted evidence. |
| Reinstall/app-data persistence smoke | BLOCKED_BY_ENV | No packaged player machine or backend target was available. | Run uninstall/reinstall with and without clean reset on QA hardware. |
| Two-player cloned app-data duplicate smoke | MANUAL_ONPREM_REQUIRED | No two-machine or isolated runtime-root QA target was provided. | Pair player A, copy runtime identity to player B/test root, and verify warning-mode duplicate visibility. |
| Environment mismatch smoke | BLOCKED_BY_ENV | No safe QA backend/CMS/player configuration target was provided. | Configure mismatch in QA and verify `ENVIRONMENT_MISMATCH` without paired/no-content UI. |
| Runtime no-secret review | BLOCKED_BY_ENV | No browser network responses, backend runtime logs, packaged player CLI output, or screenshots were available. | Review runtime artifacts from browser/player smoke and confirm no PEM/private key/token/full serial/signed URL/raw hardware ID exposure. |

## Local Reporting Check

The previously known reporting failure was rerun locally under the available Node `v24.12.0` runtime:

```bash
cd darshan-server && npx vitest run src/routes/screens.test.ts
```

Result:

- Test file: 1 passed.
- Tests: 19 passed.
- `active_screens_now` reporting assertion remains fixed.

This is not Node 20 release evidence.

## Evidence Artifacts

No browser screenshots, packaged player logs, CMS network captures, revoke audit references, or duplicate identity runtime captures were produced because the on-prem QA target inputs were missing.

## Recommendation

BLOCKED_BY_ENV. Do not approve production. Provide the missing on-prem QA endpoint/configuration inputs, Node 20 runtime, packaged player artifact target, test machines or isolated runtime roots, and site-specific backend/player JSON config profiles, then rerun the browser/on-prem QA checklist.
