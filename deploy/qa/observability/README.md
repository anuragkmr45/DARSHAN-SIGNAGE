# QA Observability Deployment Notes

QA uses the same Docker-on-VM role pattern as production.

- QA data VM: exporters and native MinIO metrics
- QA Valkey VM: Valkey health and realtime bus checks
- QA backend VM: backend `/metrics`, runtime dependency checks, optional host exporters
- QA CMS VM: nginx CMS and `/grafana/` proxy checks
- QA observability VM: Prometheus, Grafana, optional Alertmanager

The QA topology intentionally mirrors production so observability assets, runbooks, and promotions stay aligned.

Operational notes:

- keep Alertmanager outbound receiver settings site-local; the base config is local-only by default
- keep Prometheus retention aligned to the QA observability VM storage budget
- validate direct player scrape targets in QA before enabling them in production
