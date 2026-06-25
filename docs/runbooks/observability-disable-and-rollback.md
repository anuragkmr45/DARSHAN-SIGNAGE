# Observability Disable And Rollback

## Disable Procedures

### Disable direct player scrape

1. Remove the affected player entries from `prometheus/file-sd/players.targets.json`.
2. Reload Prometheus or restart the Prometheus container.
3. Confirm player scrape alerts clear while backend heartbeat summaries remain available in CMS.

### Disable outbound alert delivery

1. Render Alertmanager with the base local-only receiver configuration.
2. Restart only Alertmanager on the observability VM.
3. Confirm alerts still appear in Alertmanager and Grafana, but external delivery is no longer attempted.

### Disable Grafana temporarily

1. Stop only the Grafana container on the observability VM.
2. Keep Prometheus and Alertmanager running on the observability VM.
3. Confirm operators can still use CMS summary pages while Grafana history is unavailable.

## Rollback Procedure

1. Stop the affected observability container or containers.
2. Restore the previous rendered observability release folder on the same host.
3. Re-load the previous image archive only if the image tag changed.
4. Start Alertmanager, then Prometheus, then Grafana if those services are part of the rollback.
5. Validate target health, active alerts, and dashboard provisioning before closing the incident.

## Environment Notes

- Production and QA use the same rollback order and host ownership.
- Development local validation can usually recover by replacing the local compose files and restarting the stack.
- Observability rollback must never require reverting unrelated product runtime code.
