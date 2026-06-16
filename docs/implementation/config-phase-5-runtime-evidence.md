# CONFIG-5 Runtime Evidence Attempt

Status: BLOCKED_BY_ENV
Date: 2026-06-16
Operator: Codex

## Summary

CONFIG-5 requires real on-prem/browser/packaged player runtime evidence. This pass did not run runtime evidence because all required environment inputs were missing.

No browser QA, packaged player smoke, two-player clone smoke, environment mismatch smoke, Node 20 validation, or no-secret runtime review is claimed.

## Required Input Presence

Latest check on 2026-06-16 using:

```bash
bash scripts/verify/check-config5-runtime-readiness.sh
```

Result:

```text
CONFIG5_READINESS_STATUS=MISSING_INPUT
```

| Input | Status |
|---|---|
| `ONPREM_QA_BACKEND_BASE_URL` | missing |
| `ONPREM_QA_CMS_BASE_URL` | missing |
| `ONPREM_QA_SOCKET_IO_URL` | missing |
| `ONPREM_POSTGRES_URL` | missing |
| `ONPREM_VALKEY_URL` | missing |
| `ONPREM_MEDIA_ENDPOINT` | missing |
| `ONPREM_PROMETHEUS_URL` | missing |
| `ONPREM_GRAFANA_URL` | missing |
| `ONPREM_LOGS_PATH` | missing |
| `ONPREM_QA_DEVICE_PAIRING_METHOD` | missing |
| `ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH` | missing |
| `ONPREM_INTERNAL_CA_CERT_PATH` | missing |
| `ONPREM_TLS_MODE` | missing |
| `ONPREM_PLAYER_PACKAGE_PATH` | missing |
| `ONPREM_PLAYER_MACHINE_A` | missing |
| `ONPREM_PLAYER_MACHINE_B` | missing |
| `ONPREM_PLAYER_RUNTIME_ROOT_A` | missing |
| `ONPREM_PLAYER_RUNTIME_ROOT_B` | missing |
| `NODE20_PATH` | missing |

## Scenarios Not Run

- Node 20 validation.
- Browser CMS Pairing Health QA.
- Packaged player fresh pair/revoke/reset/re-pair smoke.
- Reinstall/app-data persistence smoke.
- Two-player cloned identity smoke.
- Environment mismatch smoke.
- Runtime no-secret review.

## Evidence Produced

CONFIG-5A readiness artifacts were produced without claiming runtime evidence:

- `docs/implementation/config-phase-5-runtime-inputs.template.env`
- `scripts/verify/check-config5-runtime-readiness.sh`
- `docs/implementation/config-phase-5a-readiness-handoff.md`

Missing env inputs were recorded without printing secret values.

## CONFIG-5A Local Discovery

Listener discovery found candidate ports owned by local Docker/node processes:

- Docker listener candidates: `3001`, `5432`, `6379`, `9000`, `9001`, `9090`
- Node listener candidates: `3000`, `8080`

Health checks did not succeed:

- `http://192.168.0.5:3000/api/v1/health`: connection failed
- `http://127.0.0.1:3000/api/v1/health`: connection failed
- `http://192.168.0.5:3000/health`: connection failed
- `http://127.0.0.1:3000/health`: connection failed
- CMS candidates on `3001` and `5173`: connection failed
- object storage candidates on `9000` and `9001`: connection failed
- Prometheus candidates on `9090`: connection failed

Valkey/Redis CLI tools were not available in PATH.

Node discovery:

- `node -v`: `v24.12.0`
- `node` path: `/usr/local/bin/node`
- no `nvm`, `asdf`, `volta`, or `fnm` executable was found
- no local Node 20 Docker image was found; Docker image discovery found only `prom/node-exporter:v1.8.2`

Packaged player discovery found no usable Darshan/signage packaged artifact. Matches were dependency test/tool files only, not release artifacts.

CONFIG-4 profile validation:

- `bash scripts/verify/validate-onprem-config-examples.sh` passed for 3 profile sets
- secret-pattern sweep over docs/examples/runbooks/implementation returned no findings

Readiness script dry run:

- `bash scripts/verify/check-config5-runtime-readiness.sh --dry-run` reported `CONFIG5_READINESS_STATUS=MISSING_INPUT`

## Production Readiness

NOT_PRODUCTION_READY / BLOCKED_BY_ENV.

## Required Next Action

Provide the missing on-prem QA endpoints, Node 20 runtime path, packaged player artifact/target, player machine/runtime roots, TLS/CA details, and pairing workflow/simulator credentials. Then rerun CONFIG-5 using the CONFIG-4 profile sets.
