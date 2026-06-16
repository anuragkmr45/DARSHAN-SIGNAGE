#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLES_DIR="${ROOT_DIR}/docs/examples"
PROFILE_DIRS=(
  "onprem-dev-config-set"
  "onprem-qa-config-set"
  "onprem-prod-config-set"
)
REQUIRED_FILES=(
  "backend-config.example.json"
  "player-config.example.json"
  "cms-runtime-config.example.json"
  "secrets.env.example"
  "README.md"
  "validation-checklist.md"
)

fail() {
  printf 'CONFIG example validation failed: %s\n' "$1" >&2
  exit 1
}

validate_json() {
  local file="$1"
  node -e "const fs=require('fs'); JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));" "$file" \
    || fail "invalid JSON: ${file}"
}

validate_secrets_template() {
  local file="$1"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" =~ ^# ]] && continue
    [[ "${line}" == *"="* ]] || fail "invalid secrets template line in ${file}: ${line}"
    local value="${line#*=}"
    [[ "${value}" == *"<"* && "${value}" == *">"* ]] \
      || fail "secrets template values must be placeholders only: ${file}: ${line%%=*}"
  done < "${file}"
}

for profile in "${PROFILE_DIRS[@]}"; do
  profile_dir="${EXAMPLES_DIR}/${profile}"
  [[ -d "${profile_dir}" ]] || fail "missing profile directory: ${profile_dir}"

  for required_file in "${REQUIRED_FILES[@]}"; do
    [[ -f "${profile_dir}/${required_file}" ]] || fail "missing ${required_file} in ${profile_dir}"
  done

  validate_json "${profile_dir}/backend-config.example.json"
  validate_json "${profile_dir}/player-config.example.json"
  validate_json "${profile_dir}/cms-runtime-config.example.json"
  validate_secrets_template "${profile_dir}/secrets.env.example"
done

if grep -R -n -E -- '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|-----BEGIN CERTIFICATE-----' "${EXAMPLES_DIR}"/onprem-*-config-set; then
  fail "PEM/private key/certificate block found in on-prem config examples"
fi

if grep -R -n -E -- '://[^[:space:]/@"]+:[^[:space:]/@"]+@' \
  "${EXAMPLES_DIR}"/onprem-*-config-set/*.json; then
  fail "credentialed URL found in non-secret JSON config examples"
fi

if grep -R -n -E -- '[?&](token|access_token|refresh_token|key|api_key|access_key|secret|password|pass|signature|sig|credential|auth|jwt|session)=' \
  "${EXAMPLES_DIR}"/onprem-*-config-set/*.json; then
  fail "secret-looking query parameter found in non-secret JSON config examples"
fi

for required_doc in \
  "${ROOT_DIR}/docs/architecture/onprem-config-architecture.md" \
  "${ROOT_DIR}/docs/implementation/config-env-reduction-plan.md" \
  "${ROOT_DIR}/docs/runbooks/onprem-config-management.md"; do
  [[ -f "${required_doc}" ]] || fail "missing config documentation: ${required_doc}"
done

grep -q 'CONFIG-1' "${ROOT_DIR}/docs/architecture/onprem-config-architecture.md" \
  || fail "architecture doc does not reference CONFIG-1"
grep -q 'CONFIG-2' "${ROOT_DIR}/docs/architecture/onprem-config-architecture.md" \
  || fail "architecture doc does not reference CONFIG-2"
grep -q 'CONFIG-3' "${ROOT_DIR}/docs/architecture/onprem-config-architecture.md" \
  || fail "architecture doc does not reference CONFIG-3"

printf 'On-prem config example validation passed for %s profile sets.\n' "${#PROFILE_DIRS[@]}"
