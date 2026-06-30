#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'USAGE'
Usage: bash scripts/verify/check-config5-runtime-readiness.sh [--dry-run]

Reads CONFIG-5 runtime inputs from the current shell environment.
Prints presence/absence only; never prints secret values.

Exit codes:
  0 READY_FOR_RUNTIME_EVIDENCE
  2 MISSING_INPUT
  3 HEALTH_FAILED
USAGE
  exit 0
elif [[ -n "${1:-}" ]]; then
  echo "Unknown argument: $1" >&2
  exit 2
fi

REQUIRED_VARS=(
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
)

missing=()
for var_name in "${REQUIRED_VARS[@]}"; do
  if [[ -n "${!var_name:-}" ]]; then
    printf '%s=present\n' "${var_name}"
  else
    printf '%s=missing\n' "${var_name}"
    missing+=("${var_name}")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "CONFIG5_READINESS_STATUS=MISSING_INPUT"
  printf 'CONFIG5_MISSING_INPUTS=%s\n' "$(IFS=,; echo "${missing[*]}")"
  exit 2
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "CONFIG5_READINESS_STATUS=READY_FOR_HEALTH_CHECKS"
  exit 0
fi

health_failed=()

check_http() {
  local label="$1"
  local url="$2"
  if curl -fsS --max-time 5 "${url}" >/dev/null 2>&1; then
    printf '%s=healthy\n' "${label}"
  else
    printf '%s=HEALTH_FAILED\n' "${label}"
    health_failed+=("${label}")
  fi
}

check_head() {
  local label="$1"
  local url="$2"
  if curl -fsSI --max-time 5 "${url}" >/dev/null 2>&1; then
    printf '%s=reachable\n' "${label}"
  else
    printf '%s=HEALTH_FAILED\n' "${label}"
    health_failed+=("${label}")
  fi
}

check_path_file() {
  local label="$1"
  local path="$2"
  if [[ -f "${path}" ]]; then
    printf '%s=present\n' "${label}"
  else
    printf '%s=HEALTH_FAILED\n' "${label}"
    health_failed+=("${label}")
  fi
}

check_path_any() {
  local label="$1"
  local path="$2"
  if [[ -e "${path}" ]]; then
    printf '%s=present\n' "${label}"
  else
    printf '%s=HEALTH_FAILED\n' "${label}"
    health_failed+=("${label}")
  fi
}

check_http ONPREM_QA_BACKEND_HEALTH "${ONPREM_QA_BACKEND_BASE_URL%/}/api/v1/health"
check_head ONPREM_QA_CMS_HTTP "${ONPREM_QA_CMS_BASE_URL%/}"
check_head ONPREM_QA_SOCKET_IO_HTTP "${ONPREM_QA_SOCKET_IO_URL%/}"
check_head ONPREM_MEDIA_ENDPOINT_HTTP "${ONPREM_MEDIA_ENDPOINT%/}"
check_http ONPREM_PROMETHEUS_HEALTH "${ONPREM_PROMETHEUS_URL%/}/-/healthy"
check_http ONPREM_GRAFANA_HEALTH "${ONPREM_GRAFANA_URL%/}/api/health"

check_path_any ONPREM_LOGS_PATH_EXISTS "${ONPREM_LOGS_PATH}"
check_path_file ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH_EXISTS "${ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH}"
check_path_file ONPREM_PLAYER_PACKAGE_PATH_EXISTS "${ONPREM_PLAYER_PACKAGE_PATH}"
check_path_any ONPREM_PLAYER_RUNTIME_ROOT_A_EXISTS "${ONPREM_PLAYER_RUNTIME_ROOT_A}"
check_path_any ONPREM_PLAYER_RUNTIME_ROOT_B_EXISTS "${ONPREM_PLAYER_RUNTIME_ROOT_B}"

if [[ "${ONPREM_TLS_MODE}" != "none" && "${ONPREM_TLS_MODE}" != "off" ]]; then
  check_path_file ONPREM_INTERNAL_CA_CERT_PATH_EXISTS "${ONPREM_INTERNAL_CA_CERT_PATH}"
fi

if [[ -x "${NODE20_PATH}" ]]; then
  node_version="$("${NODE20_PATH}" -v 2>/dev/null || true)"
  if [[ "${node_version}" =~ ^v20\. ]]; then
    echo "NODE20_PATH_VERSION=valid"
  else
    echo "NODE20_PATH_VERSION=HEALTH_FAILED"
    health_failed+=(NODE20_PATH_VERSION)
  fi
else
  echo "NODE20_PATH_EXECUTABLE=HEALTH_FAILED"
  health_failed+=(NODE20_PATH_EXECUTABLE)
fi

if (( ${#health_failed[@]} > 0 )); then
  echo "CONFIG5_READINESS_STATUS=HEALTH_FAILED"
  printf 'CONFIG5_HEALTH_FAILED=%s\n' "$(IFS=,; echo "${health_failed[*]}")"
  exit 3
fi

echo "CONFIG5_READINESS_STATUS=READY_FOR_RUNTIME_EVIDENCE"
