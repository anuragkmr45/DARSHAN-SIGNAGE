# Observability Target Inventory And Networking

## Player Target Inventory

- Use Prometheus `file_sd` for optional direct player scrape.
- Keep the inventory in a site-local rendered file derived from `players.targets.example.json`.
- Maintain only stable labels: `site`, `environment`, `device_id`, `screen_id`, and an optional bounded grouping label.
- Direct player scrape requires the player config to opt into remote metrics exposure. The safe default remains `bindAddress=127.0.0.1` with `allowRemoteAccess=false`.
- Production direct scrape uses HTTPS mutual TLS. The player validates the observability client certificate, and Prometheus validates each player's certificate against the site CA.
- The generated Observability role keeps live site files under `/etc/darshan/sites/<site>/player-metrics`: `players.targets.json`, `ca.crt`, `client.crt`, and mode-`0600` `client.key`. `prepare-host.sh` creates an empty inventory once. Release artifacts contain only an example and validator; they never contain the site client private key or player addresses.
- Run `./validate-player-scrape-config.sh "$PLAYER_METRICS_CONFIG_DIR"` before reloading Prometheus. `start.sh` performs this check automatically. An empty inventory is valid and leaves direct player scrape disabled.

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
- Allow the player metrics port only from the Observability VM. Do not expose it through the CMS, backend, or general user network.
- Do not expose exporter ports through the public CMS entrypoint.
- If player direct scrape is not approved, keep player metrics bound to localhost.
