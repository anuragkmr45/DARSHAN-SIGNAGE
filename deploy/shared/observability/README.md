# DARSHAN Observability Assets

This directory contains the platform-owned observability assets for DARSHAN on-prem deployments.

Scope:

- Prometheus templates and rule files for VM2
- Grafana provisioning and dashboards for VM3
- Alertmanager templates for VM2
- Exporter configuration examples for VM1 / VM2 / VM3
- Player `file_sd` inventory templates for optional direct scrape
- Validation fixtures used by `scripts/verify/validate-observability-assets.sh`

The assets here are source-controlled and offline-friendly. Runtime secrets, site IPs, and target inventories must be supplied through environment-specific files or rendered outputs outside this tree.

Layout:

- `prometheus/`: scrape config template, rule files, `file_sd` examples, rule tests
- `grafana/`: provisioning, dashboards-as-code, and Grafana server template
- `alertmanager/`: base template and message template
- `exporters/`: role-specific exporter config examples and snippets

These files are copied into server/CMS export packages and into assembled QA/production runtime bundles by the platform scripts.

Alertmanager note:

- the base Alertmanager config is intentionally local-only
- site-specific outbound notification receivers must be rendered outside git-tracked files
- CMS summary cards may show alert posture, but detailed silence and acknowledgement workflow remains in Grafana and Alertmanager
