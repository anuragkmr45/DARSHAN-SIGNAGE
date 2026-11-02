# Dashboard and schedule report data contract

The CMS dashboard polls the backend every 30 seconds for fleet, health, and observability summaries. The offline and storage reports poll every 60 seconds. A value is **Unavailable** when its API fails; zero means the API returned a measured zero. Data can lag by one poll interval.

The posture banner prioritizes unavailable dashboard data, then screens that are not online, then unavailable observability, then operational notices. It does not say checks are nominal when a registered screen has no fresh heartbeat.

| Display | Source and meaning |
| --- | --- |
| Screens | Registered `screens` rows; online means status `ACTIVE` and a heartbeat received within five minutes. A connected socket alone does not count as a heartbeat. |
| Long offline | Screens whose last heartbeat is older than 24 hours. A screen that has never heartbeated enters this count only 24 hours after registration. This is a last-seen threshold, not a measured outage interval. `offline_hours` is null for never-seen screens because no last-seen timestamp exists. |
| Active schedule assignments | Distinct `ACTIVE`-status screens with an active publish and schedule window now, plus a recent legacy `current_schedule_id`. This is assignment state, not proof that media is playing; disconnected or unconfirmed target status may still be included until screen status changes. |
| Last publish | Maximum `publishes.published_at`, including publishes later taken down. “No publish yet” means that timestamp is absent. Job statistics failing does not suppress this value. |
| Media storage | Sum of recorded media source sizes, including retained media rows. This is not a measurement of every MinIO object or filesystem byte. |
| Enabled operator accounts | Active user accounts assigned the built-in `OPERATOR` role. This does not measure currently signed-in users or custom operator roles. |
| Fleet totals | Registered screen count and state counts read from PostgreSQL. Online uses the same five-minute status and heartbeat rule as Screens; it remains available when Prometheus is down. |
| Direct player scrapes | Optional Prometheus `players` targets discovered through `file_sd`. Players can connect and heartbeat normally while this number is “Not configured.” Enable remote player metrics and maintain `players.targets.json` only when the site approves direct scrape access. |
| Machine health and alerts | Prometheus queries. These values remain unavailable when Prometheus or the relevant exporters are unreachable. They are not inferred from player connectivity. The development Prometheus job labels use machine `vm2`. |
| Grafana links | The CMS probes both `/grafana/api/health` and `/grafana/login` before offering drill-down links. The second probe catches a proxy redirect loop caused by stripping Grafana's `/grafana/` subpath. The Backend link uses the provisioned `darshan-vm2-backend` dashboard UID. A healthy API alone does not imply Grafana is installed or proxied. |

The schedule report counts schedule rows whose windows overlap the selected range, and publish target records whose effective publish interval overlaps it. A group publish creates one explicit group target and individual screen targets for its resolved members, so **By Screen** and **By Explicit Screen Group** overlap. `PENDING` is displayed as **Delivery unconfirmed**; only recorded `SUCCESS` and `FAILED` statuses appear in their respective counts. Player connection alone does not update a target status. A null `taken_down_at` displays **Not taken down**. This is not downtime or proof of playback.

The source-free `package-cms.sh` output contains CMS nginx and static assets; it does not start Prometheus or Grafana. Its `.env.template` uses `127.0.0.1` placeholders, which refer to the CMS container. Operators must set reachable backend, MinIO, and Grafana upstream hosts and deploy the observability VM separately. The shared CMS nginx template preserves the `/grafana/` upstream path required by `serve_from_sub_path=true`. `health-check.sh` checks the Grafana login route and reports proxy reachability without treating optional Grafana failure as CMS API failure.
