# Observability Stack Install And Upgrade

## Scope

This runbook covers the platform-owned observability stack in the Docker-on-VM production topology:

- Prometheus on the observability VM
- Grafana on the observability VM, optionally proxied through CMS at `/grafana/`
- exporter and metrics targets on the data, Valkey, backend, CMS, and player networks

## Install

1. Start from `deploy/production/docker/.env.example` or the QA equivalent.
2. Render Prometheus, Alertmanager if used, and Grafana templates with site-specific values.
3. Stage rendered files into the observability VM release folder.
4. Load any required image archives before starting containers.
5. Keep the base Alertmanager config local-only unless a site-specific outbound receiver has been reviewed and rendered.
6. Start data, Valkey, backend, and CMS roles before starting observability.
7. Start observability with `bash deploy/production/docker/start-observability.sh`.
8. Confirm Prometheus target health, rule load success, and Grafana dashboard provisioning.

## Upgrade

1. Copy previous rendered env files and target inventories into the new release.
2. Replace only the version-pinned image archives and rendered config outputs intended for the new release.
3. Re-run `scripts/verify/validate-observability-assets.sh` before loading the new images.
4. Re-run any site-specific Alertmanager receiver validation after rendering secrets or destinations.
5. Restart Prometheus before Grafana so datasource and alert health are already available.

## Rollback

1. Stop the observability containers on the observability VM.
2. Restore the previous release folder or previous rendered config set.
3. Re-load the previous image archives if the version changed.
4. Start the previous release and validate target health again.

## Operational Notes

- Production and QA should keep Alertmanager running if the site has enabled it, even when outbound notifications are intentionally disabled.
- CMS currently shows alert summary posture only. Detailed alert triage, silence management, and notification workflow remain in Grafana and Alertmanager.
- Keep Prometheus retention aligned to observability VM storage. The baseline is a starting point, not a guarantee for undersized disks.
- Development uses `deploy/development/observability/` only for local validation of observability assets.
