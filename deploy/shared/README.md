# DARSHAN Shared Deployment Assets

`deploy/shared` is not an environment and is not directly runnable.

It contains source-controlled templates and reusable assets consumed by development, QA, Docker production-like runs, and Proxmox production:

- CMS nginx default template,
- Socket.IO nginx proxy snippet,
- Prometheus scrape/rule templates,
- Prometheus alert and recording rules,
- Grafana provisioning and dashboards,
- Alertmanager templates,
- exporter examples and snippets.

## Why This Folder Exists

The same dashboard, alert, rule, and proxy assets must be used across environments. Keeping them in one shared folder avoids drift between:

- Docker development checks,
- QA runtime bundles,
- Docker production-like checks,
- Proxmox LXC production.

## What Must Not Go Here

Do not put real site values or secrets in `deploy/shared`.

Do not commit:

- passwords,
- tokens,
- private keys,
- certificate private material,
- real customer IP inventories,
- real player scrape target lists,
- notification webhook URLs.

Environment-specific scripts should render copies of these templates into generated output or runtime config paths.
