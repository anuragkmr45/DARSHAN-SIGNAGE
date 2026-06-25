# Exporter Configuration Examples

These examples document the expected exporter placement by machine role.

Recommended placement:

- Data VM: `node_exporter`, `postgres_exporter`, MinIO native metrics, optional `cadvisor`
- Valkey VM: `node_exporter`, optional `cadvisor`, optional Valkey exporter
- Backend VM: `node_exporter`, optional `cadvisor`, optional `blackbox_exporter`
- CMS VM: `node_exporter`, `nginx-prometheus-exporter`, optional `cadvisor`
- Observability VM: Prometheus, Grafana, optional Alertmanager, optional `node_exporter`
- Players: direct app scrape only by default; host exporters only where explicitly approved

Files in this directory are examples and snippets only. They intentionally avoid site IPs, secrets, and organization-specific values.
