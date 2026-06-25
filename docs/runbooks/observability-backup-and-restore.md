# Observability Backup And Restore

## Back Up

Back up the following on every release:

- rendered Prometheus config
- recording and alert rule files
- rendered Alertmanager config if enabled
- Grafana provisioning files and dashboards
- player `file_sd` inventory files
- environment files used to render the observability stack

Optional:

- VM-level or storage-level snapshots of the Prometheus data volume if historical data retention matters operationally

## Backup Notes

- Prefer backing up configuration on every release and data snapshots on a scheduled maintenance window.
- Do not enable Prometheus admin APIs just for snapshotting. Use VM or storage snapshots, or an agreed maintenance procedure on the observability VM.
- Grafana dashboard state should remain provisioned from git-managed files where possible. If operators create local dashboards, export and back them up explicitly before upgrades.

## Restore

1. Restore the rendered config and dashboard files to the release folder.
2. Re-load the matching image archives if needed.
3. Start Alertmanager if it is part of the site deployment and confirm config load success.
4. Start Prometheus and confirm config load success, target discovery, and rule load success.
5. Start Grafana and confirm dashboard provisioning.
6. Restore Prometheus data snapshots only after the config layer is healthy.

## Notes

- Observability history is operationally useful but not the product system of record.
- A failed TSDB restore must not block recovery of core DARSHAN services.
- Production and QA follow the same restore order. Development local validation normally restores config only, not historical data.
