# Matched Docker browser smoke: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. Isolated local QA site only; no production or independent human acceptance.

## Frozen artifacts and activation

- CMS build `117dd5ad-77d4-4a29-ab00-80cb0885d892` and server build `f7c83f08-4028-443b-a802-2833c3e4696a` were frozen from the current branch and activated in the existing isolated Docker stack. The API, worker, CMS, PostgreSQL, MinIO, Valkey and TLS proxy were running.
- The first server activation failed its readiness gate and rolled back to the previous containers. The current build had two additive pending migrations. After reviewing and applying `0062_group_member_screen_lookup.sql` and `0063_proof_of_play_completion_outcome.sql` to the isolated QA database, guarded activation passed. The ready endpoint reported database, migrations, bootstrap, MinIO, Valkey and worker ready. The previous containers remain available for rollback.
- The current CMS activation passed. Home, readiness and public appearance endpoints returned HTTP 200 through `https://localhost:18443`.

## Running CMS observations

- The public Home, Login and activation pages loaded in the browser with the cream-and-forest design. The activation form exposed invitation code, new password and confirmation fields; no activation code was submitted.
- The existing local QA administrator signed in through the actual CMS form. Dashboard loaded one registered and online Screen, current backend health, machine metrics, and an observability alert. Its direct player scrape state explicitly said **Not configured**; the Screen being online was determined from backend heartbeats.
- In Settings → Appearance, the site started at **Light / Forest / Always expanded**. Saving Dark showed an `Appearance updated` confirmation. Reloading the public Home route in a second tab showed the dark site appearance. The original Light setting was saved again and confirmed by the CMS.
- Screens loaded one online QA player. Its detail inspector opened and showed live backend heartbeat data. Observability displayed CPU 17.6%, memory 3.6/6.2 GB, disk 193/467 GB and queue backlog 0 at the observed heartbeat. Device details were rendered as readable fields rather than raw JSON.
- The inspector distinguished **Direct scrape not configured** from **Health ONLINE**. Grafana trend view reported that Grafana was unavailable through this isolated CMS; the stack does not include a Grafana service or direct player scrape targets. No historical trend claim is made from these observations.

### Later frozen-candidate navigation pass

After the Reports PDF fix, the isolated API/worker build `e072fc24-7029-49a8-b01e-7639220c5e49` passed guarded activation. After the Media wording fix, CMS build `dbbb05ad-82a6-441b-a974-0ed2594ac610` passed hash-checked activation with its prior container retained. In the signed-in browser, the Dashboard, Screens, Schedule Queue, Media Library, Layouts, Live broadcasts, Conversations, Notifications, Operators, Departments, Users, Reports & Logs, Site Settings, API Keys, Webhooks and Proof of Play routes were opened through the sidebar. The named page headings or, for Conversations, the split-view empty state loaded with no route-level error. This is a navigation smoke, not a pass for each route's controls or business actions. The [Media workflow record](product-ui-media-library-developer-verification-2026-11-04.md) covers the separate upload, preview, delete and restore journey; the [PDF export record](product-ui-pdf-export-developer-verification-2026-11-04.md) covers real Downloads.

## Boundaries

This smoke verifies current built CMS/server integration and actual browser navigation for the named pages. It does not cover the full control-level matrix, concurrent actors, mutations in other routes, packaged-player visuals, cross-VM observability, physical displays, Windows, or independent human QA. A displayed heartbeat proves a backend report, not a human-observed frame. The QA player and prior test history were left intact.
