# QA Observability Deployment Notes

QA uses the same Proxmox LXC role pattern as production. Older bundle labels may still say VM1 / VM2 / VM3, but QA evidence should be collected against the five role split unless a test explicitly documents a Docker-only exception.

- QA data LXC: exporters and native MinIO metrics
- QA Valkey LXC: Valkey health and realtime bus checks
- QA backend LXC: backend `/metrics`, runtime dependency checks, optional host exporters
- QA CMS LXC: nginx CMS and `/grafana/` proxy checks
- QA observability LXC: Prometheus, Grafana, optional Alertmanager

The QA topology intentionally mirrors production so observability assets, runbooks, and promotions stay aligned.

Operational notes:

- keep Alertmanager outbound receiver settings site-local; the base config is local-only by default
- keep Prometheus retention aligned to the QA VM2 storage budget; the baseline target is 30 days with WAL compression enabled
- validate direct player scrape targets in QA before enabling them in production
