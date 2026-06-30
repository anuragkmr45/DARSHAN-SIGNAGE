# Production Observability Deployment Notes

Production observability runs as the `darshan-observability` Docker project on the observability VM.

Five-VM production layout:

- VM1 data: Postgres and MinIO metrics targets
- VM2 Valkey: Valkey health and optional exporter targets
- VM3 backend: backend `/metrics`
- VM4 CMS: nginx CMS and `/grafana/` proxy path
- VM5 observability: Prometheus and Grafana containers

Primary inputs:

- use `deploy/production/docker/.env.example` as the starting point for site-specific host/port values
- keep site IPs and secrets outside git-tracked files
- keep player direct-scrape targets in the Prometheus `file_sd` inventory only if direct scrape is approved
- keep Alertmanager outbound receiver settings site-local if Alertmanager is added
- keep Prometheus retention aligned to observability VM storage sizing
- Grafana normally uses `http://<cms-vm>:<cms-port>/grafana/` when exposed through CMS, or the direct observability VM URL for operator-only access

The canonical shared assets live in `deploy/shared/observability/`.
