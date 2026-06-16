# Development Observability Stack

This is a minimal local single-machine observability path for developers.

It is intentionally isolated from the production and QA VM topology. It exists only for local validation of Prometheus, Grafana provisioning, dashboards, and rule files.

Local stack:

- Prometheus on `localhost:9090`
- Grafana on `localhost:3001`, configured for `/grafana/`
- node exporter on `localhost:9100`
- local retention defaults to 7 days with WAL compression enabled
- Alertmanager is not started by default in development; local alert validation uses the shared rule files and config checks instead

The local compose file does not require the full DARSHAN runtime stack. It validates the observability assets themselves.

For an end-to-end local check against a running backend, start a development `darshan-server` instance on `localhost:3000` with:

- `OBSERVABILITY_METRICS_BEARER_TOKEN=darshan-development-prometheus`
- `OBSERVABILITY_PROMETHEUS_BASE_URL=http://127.0.0.1:9090`
- `OBSERVABILITY_DEPLOYMENT_MODE=development`

The development Prometheus config scrapes that backend target through `host.docker.internal:3000` and scrapes the local node exporter as `vm2-node` with the `vm2` machine label. That makes local development behave like the backend/server machine in the on-prem topology.

Grafana provisions four DARSHAN dashboards:

- `DARSHAN Backend Server Machine` for backend host and API metrics.
- `DARSHAN Data Machine` for Postgres, MinIO, storage, and data host metrics.
- `DARSHAN CMS Machine` for CMS host, nginx, and Grafana metrics.
- `DARSHAN Player Machines Fleet` for all player devices and fleet summaries.

In this local stack, only the backend/server-machine dashboard has host data by default. The data, CMS, and player fleet dashboards populate when their corresponding exporters or player targets are added to Prometheus.
