# Alerting And Operations Standard

## Alert Design

- Every alert must point to a concrete operator action or escalation path.
- Prefer infrastructure, service, and fleet rollup alerts over per-player alert spam.
- Use critical severity only for conditions that threaten core signage operation, data durability, or operator access.
- Use warning severity for degradation that can wait for normal operator response.
- Avoid alerts on metrics that are expected to flap during routine deploys, upgrades, or player maintenance windows.

## Default Coverage

- VM1 data machine health is mandatory.
- PostgreSQL availability is mandatory.
- MinIO metrics reachability and VM1 storage pressure are mandatory.
- VM2 backend availability and backend 5xx rate are mandatory.
- VM3 host visibility and Grafana availability are mandatory.
- Player alerts should prefer backend-derived fleet rollups unless direct scrape is explicitly approved and stable.

## Alertmanager Policy

- Alertmanager runs on VM2 for grouping, silences, and alert inspection.
- The git-tracked base config is local-only by default.
- Outbound notification integrations are site-specific and must be injected at deploy time outside committed files.
- CMS may show alert summary posture, but detailed alert handling remains in Grafana and Alertmanager until a later product phase explicitly adds more.

## Retention And Storage

- Production and QA default to 30 days of Prometheus retention unless the site storage budget requires a lower value.
- Development local validation defaults to 7 days and is not a production sizing reference.
- Enable Prometheus WAL compression by default.
- Prometheus history is operationally useful but not the DARSHAN system of record.

## Validation

- Rule changes must pass `promtool test rules`.
- Prometheus config changes must pass `promtool check config`.
- Alertmanager config changes must pass `amtool check-config`.
- Dashboard JSON must parse cleanly before release packaging.
- Upgrade and rollback runbooks must be updated in the same change set as alerting or retention changes.
