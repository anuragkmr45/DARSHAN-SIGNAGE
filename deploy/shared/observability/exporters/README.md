# Production Exporter Architecture

The source-free production bundle deploys and verifies every exporter that its
generated Prometheus configuration scrapes. This avoids the common failure
mode where dashboards contain permanent `up=0` targets because an example-only
exporter was never installed.

| VM role | Default production metrics endpoint | Scraped by Prometheus |
|---|---|---|
| Data | Node exporter (`9100`), PostgreSQL exporter (`9187`), MinIO native HTTPS metrics | Yes |
| Valkey | Node exporter (`9100`) | Yes |
| Backend | Node exporter (`9100`), authenticated API metrics over HTTPS | Yes |
| CMS | Node exporter (`9100`), Nginx exporter (`9113`) | Yes |
| Observability | Node exporter (`9100`), Prometheus and Grafana self-metrics | Yes |
| Players | Application metrics only, where explicitly enabled | Yes when configured |

Exporter ports use HTTP, not a public user interface. The site firewall must
allow them **only** from the observability VM's management address and deny
them from operator, player, and general LAN networks. PostgreSQL's exporter
uses its own restricted `pg_monitor` database role; it never uses the database
administrator credential.

`cAdvisor`, a Valkey exporter, and a blackbox exporter are intentionally not
part of the default bundle or static scrape configuration. cAdvisor in
particular needs broad host/container mounts. Add any of them only through a
separate design review that defines the needed privileges, image supply chain,
port exposure, retention impact, and matching Prometheus/alert rules.

Files in this directory are reference snippets only. The generated production
bundle is authoritative and intentionally contains no site IPs or plaintext
secrets.
