#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
trust="${DARSHAN_RELEASE_TRUST_KEY:-/etc/darshan/trust/release-signing.pem}"
[[ -f "$trust" && ! -L "$trust" && "$(stat -c %u "$trust")" == 0 ]] || { echo "Pinned root-owned release key required." >&2; exit 1; }
(( (8#$(stat -c %a "$trust") & 8#022) == 0 )) || exit 1
openssl dgst -sha256 -verify "$trust" -signature ROLE_MANIFEST.sig ROLE_MANIFEST.sha256 >/dev/null
sha256sum --quiet -c ROLE_MANIFEST.sha256
[[ -s images/IMAGE_MANIFEST.tsv && -z "$(find images -maxdepth 1 -name '*.SKIPPED.txt' -print -quit)" ]] || { echo "Loadable signed media image metadata required." >&2; exit 1; }
docker compose --env-file .env.production -f docker-compose.yml config -q
