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
BACKEND_CONFIG_FILES=(
  "${EXAMPLES_DIR}/backend-config.onprem-local-192.168.0.5.example.json"
  "${EXAMPLES_DIR}/backend-config.qa.example.json"
  "${EXAMPLES_DIR}/backend-config.production.example.json"
)
PLAYER_CONFIG_FILES=(
  "${EXAMPLES_DIR}/player-config.onprem-local-192.168.0.5.example.json"
  "${EXAMPLES_DIR}/player-config.qa.example.json"
  "${EXAMPLES_DIR}/player-config.production.example.json"
)
CMS_CONFIG_FILES=(
  "${EXAMPLES_DIR}/cms-runtime-config.onprem-local-192.168.0.5.example.json"
  "${EXAMPLES_DIR}/cms-runtime-config.qa.example.json"
  "${EXAMPLES_DIR}/cms-runtime-config.production.example.json"
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

  BACKEND_CONFIG_FILES+=("${profile_dir}/backend-config.example.json")
  PLAYER_CONFIG_FILES+=("${profile_dir}/player-config.example.json")
  CMS_CONFIG_FILES+=("${profile_dir}/cms-runtime-config.example.json")
done

for file in "${BACKEND_CONFIG_FILES[@]}" "${PLAYER_CONFIG_FILES[@]}" "${CMS_CONFIG_FILES[@]}"; do
  [[ -f "${file}" ]] || fail "missing standalone config example: ${file}"
  validate_json "${file}"
done

if grep -R -n -E -- '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|-----BEGIN CERTIFICATE-----' "${EXAMPLES_DIR}"/onprem-*-config-set; then
  fail "PEM/private key/certificate block found in on-prem config examples"
fi

if grep -R -n -E -- '://[^[:space:]/@"]+:[^[:space:]/@"]+@' \
  "${EXAMPLES_DIR}"/*.json "${EXAMPLES_DIR}"/onprem-*-config-set/*.json; then
  fail "credentialed URL found in non-secret JSON config examples"
fi

if grep -R -n -E -- '[?&](token|access_token|refresh_token|key|api_key|access_key|secret|password|pass|signature|sig|credential|auth|jwt|session)=' \
  "${EXAMPLES_DIR}"/*.json "${EXAMPLES_DIR}"/onprem-*-config-set/*.json; then
  fail "secret-looking query parameter found in non-secret JSON config examples"
fi

if grep -R -n -E -- '^(SESSION_SECRET|OBJECT_STORAGE_ACCESS_KEY|OBJECT_STORAGE_SECRET_KEY|ADMIN_BOOTSTRAP_PASSWORD)=' \
  "${EXAMPLES_DIR}"/onprem-*-config-set/secrets.env.example; then
  fail "stale or unsupported secret env name found in profile secrets template"
fi

BACKEND_CONFIG_LIST="$(printf '%s\n' "${BACKEND_CONFIG_FILES[@]}")"
PLAYER_CONFIG_LIST="$(printf '%s\n' "${PLAYER_CONFIG_FILES[@]}")"
CMS_CONFIG_LIST="$(printf '%s\n' "${CMS_CONFIG_FILES[@]}")"
export BACKEND_CONFIG_LIST PLAYER_CONFIG_LIST CMS_CONFIG_LIST

(
  cd "${ROOT_DIR}/darshan-server"
  node --import tsx <<'NODE'
import { readFileSync } from 'node:fs';
import { loadBackendFileConfigEnv } from './src/config/file-config.ts';
import { resolveCmsRuntimeConfig } from '../darshan-cms/src/config/runtimeConfig.ts';

const playerModule = await import('../darshan-player/src/common/file-config.ts');
const playerApi = playerModule.default || playerModule['module.exports'] || playerModule;
const { loadPlayerFileConfig } = playerApi;

const splitList = (value) => (value || '').split('\n').map((entry) => entry.trim()).filter(Boolean);
const backendFiles = splitList(process.env.BACKEND_CONFIG_LIST);
const playerFiles = splitList(process.env.PLAYER_CONFIG_LIST);
const cmsFiles = splitList(process.env.CMS_CONFIG_LIST);

const fail = (message) => {
  throw new Error(message);
};

const assertKnownKeys = (label, value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(`${label} contains unsupported key "${key}"`);
    }
  }
};

for (const file of backendFiles) {
  loadBackendFileConfigEnv({ DARSHAN_CONFIG_FILE: file, DARSHAN_ENV: 'validation' });
}

for (const file of playerFiles) {
  loadPlayerFileConfig({ DARSHAN_PLAYER_CONFIG_FILE: file, DARSHAN_ENV: 'validation' });
}

for (const file of cmsFiles) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  assertKnownKeys(file, parsed, ['cms']);
  assertKnownKeys(`${file}.cms`, parsed.cms, ['environment', 'api', 'realtime', 'diagnostics']);
  if (parsed.cms.environment) {
    assertKnownKeys(`${file}.cms.environment`, parsed.cms.environment, ['name', 'deploymentId', 'cmsId']);
  }
  if (parsed.cms.api) {
    assertKnownKeys(`${file}.cms.api`, parsed.cms.api, ['baseUrl']);
  }
  if (parsed.cms.realtime) {
    assertKnownKeys(`${file}.cms.realtime`, parsed.cms.realtime, ['socketBaseUrl', 'socketTransports']);
  }
  if (parsed.cms.diagnostics) {
    assertKnownKeys(`${file}.cms.diagnostics`, parsed.cms.diagnostics, ['showEnvironmentIdentity']);
  }
  resolveCmsRuntimeConfig(
    parsed,
    {
      VITE_API_BASE_URL: 'http://validation.local',
      VITE_WS_BASE_URL: 'http://validation.local',
      VITE_CMS_ENVIRONMENT_NAME: 'validation',
      VITE_CMS_DEPLOYMENT_ID: 'validation',
      VITE_CMS_ID: 'validation'
    },
    'http://validation.local'
  );
}

console.log(`Schema-aware config loader validation passed for ${backendFiles.length} backend, ${playerFiles.length} player, and ${cmsFiles.length} CMS examples.`);
NODE
) || fail "schema-aware config loader validation failed"

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
