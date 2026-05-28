# Deployment And Packaging Standard

## Ownership

- Deployable observability assets live in `DARSHAN monorepo root`.
- Product repos own only the instrumentation and summary APIs that are specific to their runtime.

## Packaging

- Production runtime must not depend on internet downloads.
- Platform packages and runtime bundles may carry config assets, templates, runbooks, and optionally staged image archives.
- If image archives are not staged into the bundle, the bundle must document the offline loading procedure explicitly.

## Dashboards And Rules

- Dashboards, recording rules, alert rules, and datasource provisioning must be stored as code in git.
- Environment-specific values must be rendered from templates or env files outside committed assets.

## Exporter Policy By Machine Role

- VM1 data: `node_exporter`, `postgres_exporter`, MinIO native metrics, optional `cadvisor`
- VM2 backend: `node_exporter`, backend `/metrics`, optional `cadvisor`, optional `blackbox_exporter`
- VM3 CMS: `node_exporter`, `nginx-prometheus-exporter`, optional `cadvisor`, Grafana self-metrics
- Players: app metrics by default; host exporters only when explicitly approved

## Environment Separation

- Production and QA use the same VM1 / VM2 / VM3 pattern.
- Development may use a single-machine local stack, but it must stay isolated from production assumptions.
