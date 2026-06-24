#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
reset-fresh.sh is intentionally disabled for Proxmox LXC production.

This layout stores production data in CT filesystems:
- CT 100 PostgreSQL data
- CT 100 MinIO data
- CT 103 Valkey append-only data
- CT 104 Prometheus and Grafana state

Back up the CTs or service data explicitly before any destructive maintenance.
EOF
exit 1
