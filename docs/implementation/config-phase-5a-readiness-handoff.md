# CONFIG-5A Handoff: Runtime Input Readiness

## Summary

CONFIG-5A prepared the workspace for a future CONFIG-5 runtime evidence run. It did not run browser QA, packaged player smoke, Node 20 validation, or on-prem runtime evidence because required inputs are still missing.

## Local Discovery

Local host candidate checked:

- `192.168.0.5`

Listener discovery found candidate local listeners, but listeners are not runtime evidence by themselves.

## Node 20 Discovery

| Check | Result |
|---|---|
| `node -v` | `v24.12.0` |
| `command -v node` | `/usr/local/bin/node` |
| `command -v nvm` | missing |
| `command -v asdf` | missing |
| `command -v volta` | missing |
| `command -v fnm` | missing |
| `~/.nvm/versions/node` | not found |
| `~/.asdf/installs/nodejs` | not found |
| `~/.volta/tools/image/node` | not found |
| `/usr/local/bin/node*` | `/usr/local/bin/node` only |
| `/opt/homebrew/bin/node*` | not found |
| Docker Node 20 image | not found |

Docker image discovery required escalated access to the local Docker socket and found only `prom/node-exporter:v1.8.2`, not a Node 20 runtime.

Node 20 validation remains BLOCKED_BY_ENV.

## Service Listener Discovery

Candidate listeners:

- Docker: `3001`, `5432`, `6379`, `9000`, `9001`, `9090`
- Node: `3000`, `8080`

No listener was treated as evidence without a successful health check.

## Health Checks

All safe health checks failed or were unavailable:

- `http://192.168.0.5:3000/api/v1/health`: connection failed
- `http://127.0.0.1:3000/api/v1/health`: connection failed
- `http://192.168.0.5:3000/health`: connection failed
- `http://127.0.0.1:3000/health`: connection failed
- `http://192.168.0.5:3001`: connection failed
- `http://192.168.0.5:5173`: connection failed
- `http://127.0.0.1:3001`: connection failed
- `http://127.0.0.1:5173`: connection failed
- `http://192.168.0.5:9000`: connection failed
- `http://192.168.0.5:9001`: connection failed
- `http://192.168.0.5:9090/-/healthy`: connection failed
- `http://127.0.0.1:9090/-/healthy`: connection failed

Valkey/Redis CLI checks:

- `valkey-cli`: missing
- `redis-cli`: missing

## Packaged Player Artifact Discovery

No usable packaged Darshan/signage player artifact was found.

Searches found only dependency test/tool files such as:

- `darshan-player/node_modules/.../app-builder.exe`
- `darshan-player/node_modules/.../7za.exe`
- `darshan-player/node_modules/thread-stream/test/...zip`

`ONPREM_PLAYER_PACKAGE_PATH` remains missing.

## Config Profile Validation

Passed:

```bash
bash scripts/verify/validate-onprem-config-examples.sh
```

Result:

```text
On-prem config example validation passed for 3 profile sets.
```

Secret-pattern sweep over `docs/examples`, `docs/runbooks`, and `docs/implementation` returned no findings.

## Input Template

Created:

- `docs/implementation/config-phase-5-runtime-inputs.template.env`

This is a template only. Filled runtime values must be kept outside git, for example in `.local/config5-runtime.env`. `.local/` is gitignored.

## Readiness Script

Created:

- `scripts/verify/check-config5-runtime-readiness.sh`

The script:

- reads env from the current shell
- prints presence/absence only
- supports `--dry-run`
- does not print secret values
- returns non-zero when required inputs are missing
- distinguishes `MISSING_INPUT`, `HEALTH_FAILED`, and `READY_FOR_RUNTIME_EVIDENCE`

Dry-run result:

```text
CONFIG5_READINESS_STATUS=MISSING_INPUT
```

## Tests/Commands Run

- `git status --short --branch`
- `git diff --stat`
- `git diff --name-only`
- `lsof -iTCP -sTCP:LISTEN -n -P | grep -E "3000|3001|5173|5174|8080|8081|9000|9001|9090|3002|6379|5432" || true`
- backend, CMS, object storage, and Prometheus `curl` checks listed above
- `command -v valkey-cli || true`
- `command -v redis-cli || true`
- `node -v || true`
- Node manager/path discovery commands
- Docker version/image discovery
- packaged player artifact `find` commands
- `bash scripts/verify/validate-onprem-config-examples.sh`
- secret-pattern sweep over docs/examples/runbooks/implementation
- `bash scripts/verify/check-config5-runtime-readiness.sh --dry-run || true`

## Results

- Config profile validation passed.
- Runtime readiness is not achieved.
- No runtime/browser/packaged-player evidence was collected.

## Blocked Items

- Node 20 validation.
- Backend health evidence.
- CMS browser QA.
- Socket/realtime endpoint evidence.
- Postgres/Valkey/media/Prometheus/Grafana/log access evidence.
- Packaged player smoke.
- Duplicate cloned identity smoke.
- Environment mismatch smoke.
- Runtime no-secret review.

## Required Human Inputs

- `ONPREM_QA_BACKEND_BASE_URL`
- `ONPREM_QA_CMS_BASE_URL`
- `ONPREM_QA_SOCKET_IO_URL`
- `ONPREM_POSTGRES_URL`
- `ONPREM_VALKEY_URL`
- `ONPREM_MEDIA_ENDPOINT`
- `ONPREM_PROMETHEUS_URL`
- `ONPREM_GRAFANA_URL`
- `ONPREM_LOGS_PATH`
- `ONPREM_QA_DEVICE_PAIRING_METHOD`
- `ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH`
- `ONPREM_INTERNAL_CA_CERT_PATH`
- `ONPREM_TLS_MODE`
- `ONPREM_PLAYER_PACKAGE_PATH`
- `ONPREM_PLAYER_MACHINE_A`
- `ONPREM_PLAYER_MACHINE_B`
- `ONPREM_PLAYER_RUNTIME_ROOT_A`
- `ONPREM_PLAYER_RUNTIME_ROOT_B`
- `NODE20_PATH`

## Runtime Evidence Status

BLOCKED_BY_ENV.

## Production Readiness

NOT_PRODUCTION_READY.

## Recommendation

BLOCKED_BY_ENV.
