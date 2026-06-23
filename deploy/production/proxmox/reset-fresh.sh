#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
reset-fresh.sh is intentionally disabled for Proxmox LXC production.

This layout stores production data in CT filesystems:
- CT 201 PostgreSQL data
- CT 201 MinIO data
- CT 202 Valkey append-only data
- CT 205 Prometheus and Grafana state

Back up the CTs or service data explicitly before any destructive maintenance.
EOF
exit 1
