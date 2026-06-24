# DARSHAN Development Deployment

Development uses Docker Compose for local support services and observability validation.

This path is not the production topology. It is intentionally optimized for local developer feedback:

- Docker Compose is allowed.
- Services may run on one developer workstation.
- Prometheus and Grafana can mount shared dashboards/rules directly from `deploy/shared`.
- Backend, CMS, and player may run from source during development.

## Available Development Stack

| Path | Runs |
|---|---|
| `deploy/development/observability/docker-compose.yml` | Prometheus, Grafana, node exporter |

The development observability stack uses Docker images:

- `prom/prometheus`
- `grafana/grafana`
- `prom/node-exporter`

It mounts shared assets from:

- `deploy/shared/observability/prometheus/rules`
- `deploy/shared/observability/grafana/provisioning`
- `deploy/shared/observability/grafana/dashboards`

## Boundary

Do not use this path as production evidence. Production and QA use the Proxmox LXC service model under:

- `deploy/qa`
- `deploy/production/proxmox`

Use this path only to validate local dashboards, rules, and developer runtime behavior.
