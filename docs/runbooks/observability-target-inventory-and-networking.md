# Observability Target Inventory And Networking

## Player Target Inventory

- Use Prometheus `file_sd` for optional direct player scrape.
- Keep the inventory in a site-local rendered file derived from `players.targets.example.json`.
- Maintain only stable labels: `site`, `environment`, `device_id`, `screen_id`, and an optional bounded grouping label.
- Direct player scrape requires the player config to opt into remote metrics exposure. The safe default remains `bindAddress=127.0.0.1` with `allowRemoteAccess=false`.

## VM Networking

Required reachability:

- Observability VM Prometheus to data VM exporters, Postgres metrics, and MinIO metrics
- Observability VM Prometheus to Valkey VM metrics if enabled
- Observability VM Prometheus to backend VM `/metrics`
- Observability VM Prometheus to CMS VM and Grafana metrics if enabled
- CMS VM reverse proxy to backend VM `/api/v1/` and `/socket.io/`
- CMS VM reverse proxy to observability VM Grafana when `/grafana/` is exposed through CMS

## Firewall Guidance

- Allow only the minimum management-plane ingress required for exporters and Prometheus.
- Do not expose exporter ports through the public CMS entrypoint.
- If player direct scrape is not approved, keep player metrics bound to localhost.
