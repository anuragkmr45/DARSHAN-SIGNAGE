# Observability Incident Response

## Failed Scrape Targets

1. Open Prometheus targets on the observability VM and identify whether the failure is isolated to one job or one machine.
2. Confirm basic network reachability from the observability VM to the target port.
3. For the data VM, prioritize Postgres, MinIO, and host/node targets before lower-priority targets.
4. If the target is a player and direct scrape is optional at the site, confirm whether the player target should remain in `players.targets.json` at all.
5. Silence only the specific alert that matches the maintenance window. Do not silence broad platform alerts without a written reason.

## Grafana Unavailable

1. Confirm CMS nginx is up and still proxies `/grafana/` to the observability VM Grafana port.
2. Check the Grafana container logs and confirm the provisioned datasource still points to the observability VM Prometheus.
3. Confirm Prometheus is reachable from Grafana before restarting Grafana.
4. If Grafana remains unavailable, CMS summary views should still work. Treat this as degraded observability, not immediate signage downtime, unless operators lose all required visibility.

## Prometheus Unavailable

1. Treat Prometheus loss on the observability VM as a critical observability incident.
2. Confirm the container is running and the rendered config files still exist in the active release folder.
3. Validate the current config and rules with `scripts/verify/validate-observability-assets.sh` from the build machine or a matching repo checkout.
4. If the failure started after a config update, roll back to the previous validated release folder.
5. Restore historical data only after Prometheus is healthy again.

## Data VM Capacity Pressure

1. Treat data VM storage pressure as urgent because it impacts both PostgreSQL and MinIO.
2. Confirm which filesystem is filling and whether Docker volumes or MinIO objects are the dominant consumer.
3. Stop non-essential ingest or retention-increasing tasks before deleting data.
4. If the filesystem alert is near saturation, expand storage or move data before restarting dependent services.

## Backend Metrics Missing

1. Confirm `darshan-server` is reachable on the backend VM and `/metrics` still binds to the expected local or management interface.
2. Check whether the backend process is healthy but the `/metrics` access policy changed.
3. If the scrape is blocked only by config drift, restore the expected bind or token config instead of broadening exposure.
4. Use CMS summary APIs as a fallback current-state view while the Prometheus scrape path is being restored.

## Player Metrics Missing

1. Check whether the site has approved direct player scrape. If not, missing player scrape metrics are not a production incident by themselves.
2. If direct scrape is approved, confirm the player bind address, firewall rules, and `players.targets.json` entry.
3. If a player remains unreachable, remove or comment the target only when the player is intentionally decommissioned.
4. Backend heartbeat-derived screen state remains the primary operator signal; do not block playback recovery on scrape-only issues.

## Rule Validation During Upgrades

1. Run `scripts/verify/validate-observability-assets.sh` before copying any updated rules or dashboards.
2. Re-run the same validation after rendering environment-specific values for production or QA.
3. Do not restart Prometheus or Alertmanager with unvalidated rule or config changes.

## Offline Image And Config Updates

1. Load all required images before touching running containers.
2. Copy rendered config and dashboard changes into the new release folder.
3. Restart only the affected observability component in dependency order.
4. Keep the previous validated release folder intact until the updated stack is confirmed healthy.
