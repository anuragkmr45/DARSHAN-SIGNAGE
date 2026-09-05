#!/usr/bin/env bash
set -euo pipefail

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must point to a dedicated DARSHAN *_test database}"

export NODE_ENV=test
export DATABASE_URL="$TEST_DATABASE_URL"

npx tsx scripts/test-database.ts reset
exec npx vitest run "$@"
