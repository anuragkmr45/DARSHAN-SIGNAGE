# Player delivery, availability, and observability developer verification — 2026-11-02

Branch: `codex/dashboard-observability-report-audit-20261102`

Implementation commit: `86dc5968b6b9a3d2708f2854029cf6fdbd84e4bc`

Beta packaging and runtime fixes: `44c9496`, `5438738`, `75df917`, `fd81343`, `4ff9671`, `6d50a62`, `2cbd176`

## Product behavior verified in code and automated runtime checks

- A publish target remains pending until the player reports the exact active publish ID and snapshot ID in a heartbeat. The first matching application time is retained across duplicate heartbeats.
- Group delivery is derived from the concrete screen membership captured at publish time; later group membership changes do not rewrite historical delivery truth.
- Proof-of-play carries the publish ID separately and is emitted only after renderer success for the current occurrence. A delayed renderer response cannot reopen an already completed occurrence.
- Dashboard and schedule reporting distinguish assigned schedule windows, applied publishes, fresh playback reports, and proof-of-play. None is presented as proof of what a human saw on the physical display.
- Availability is reconstructed from server-received heartbeats with a 90-second grace period. Reports expose online, estimated outage, backend-unknown, known time, and uptime percentage. A player with no accepted heartbeat is labelled `Never seen`.
- Readiness checkpoints are deployment-scoped so history from a different deployment cannot incorrectly turn an outage into known time.
- The media restore control now depends on `Manage Media` permission, not the built-in `ADMIN` or `SUPER_ADMIN` role names.
- Direct player hardware metrics are an opt-in Prometheus HTTPS/mTLS path. Empty inventory remains a valid deployment and does not create invented scrape targets.

## Developer verification

| Surface | Result |
|---|---|
| Server TypeScript build and production build | Passed |
| Delivery acknowledgement, proof-of-play, evidence metrics, schedule report, and availability database suites | 10/10 passed against dedicated `darshan_test` |
| Server unit suite | 75/75 passed |
| Screen/realtime lifecycle dry run | 12/12 passed |
| Migration ledger | `0052` and `0053` applied; no pending migrations, unmanaged objects, or adoption requirement |
| CMS production build and bundle budget | Passed; entry 221.9 KiB / 70.1 KiB gzip in the beta package |
| CMS unit suite | 126/126 passed |
| CMS Chromium operator flows | 16/16 passed, including availability, evidence states, Grafana links, and custom-role media restore |
| Player build | Passed |
| Player unit suite | 390/390 passed, including completed static-slot versus completed non-looping-video evidence |
| Player lifecycle integration suite | 5/5 passed |
| Player network/fault suite | 14/14 passed |
| Generated-certificate player metrics mTLS handshake | Passed |
| Prometheus config/rules, Alertmanager, Compose, bundle smoke checks | Passed |
| Production bundle configuration policy | 17/17 passed |
| Player scrape configuration validator | Passed for valid empty/mTLS inputs and expected rejection cases |
| Source-free production-bundle acceptance | Passed in generated internal-CA and operator-provided TLS modes |
| Clean standalone server package install | Passed: migrations through `0053`, bootstrap/login acceptance, bootstrap password removal, healthy API and worker with zero restarts, and Chromium available in both runtime containers |
| Clean standalone CMS package install | Passed: CMS, API proxy, Grafana health, and Grafana login all returned HTTP 200 |
| Git whitespace validation | Passed |

One availability test initially inserted readiness checkpoints under a synthetic deployment ID after the implementation began filtering by the active deployment. The fixture was corrected to use the configured deployment ID, and the complete focused suite then passed 10/10. No runtime algorithm was weakened to satisfy the test.

## Temporary deployed-stack observation

The reachable temporary deployment at `192.168.29.64` returned:

- CMS `http://192.168.29.64:8080/`: HTTP 200.
- Grafana health through `/grafana/api/health`: database `ok`, version 12.0.2.
- Grafana login through `/grafana/login`: HTTP 200 without a redirect loop.
- Prometheus readiness: ready.
- Active targets: `darshan-server` 1/1 up, `prometheus` 1/1 up, and `vm2-node` 1/1 up.
- Player scrape targets: zero.

That running stack predates this beta artifact. Its zero player targets are expected until operators install the site-local player inventory and mTLS material and configure each player metrics endpoint. The production screenshot host `192.168.128.74` remained unreachable from the build machine, so no live production claim is made.

## Local beta candidate

Release ID: `2026-11-02-beta6`

- Component packages: `/home/hexmon/Desktop/DARSHAN-SIGNAGE/out/2026-11-02-beta6`
- Signed source-free five-VM bundle: `/home/hexmon/Desktop/DARSHAN-SIGNAGE/dist/onprem/pxe-drdo/2026-11-02-beta6`
- Source provenance: `2cbd1766a3ebd1e860e94873d22a2fa143fff0c0`
- Bundle checksum-manifest SHA-256: `2fd5d9a5031eec56d8c65644593a1fbbda0718aa0fc7d7ae24144a3c5177deb4`
- Transfer-manifest SHA-256: `027cebecf36103f3744a7ab33440e4999d4c74a51aeaf87d3090c2186a0c2340`
- Bundle verification: every packaged file, every role archive, the transfer manifest, and signatures passed both the build-time verifier and a separate trust-key verification.
- Linux player installers: `.deb` and AppImage present; the `.deb` is 94,786,240 bytes and the AppImage is 150,058,788 bytes.
- Role archives present for data, Valkey, backend, CMS, observability, and recovery.
- Player scrape inventory is intentionally empty; the mTLS Prometheus configuration and validator are present.
- The isolated standalone package now signs media through its same-host CMS origin instead of the Docker-only `minio` hostname. The production-split bundle continues to use its configured recipient-facing CMS HTTPS origin.

The beta used the prior `2026-11-01-r1` production configuration values with only the release ID and release-derived artifact paths changed. No new secrets file was created or committed. Beta candidates 1 through 5 are superseded and must not be deployed. Beta 3 and beta 4 correctly stopped before publication when the verifier found unsupported Docker archive metadata. Beta 5 exposed the final standalone media-origin and static-layout restart cases during live acceptance; both were fixed before beta 6 was assembled.

## Live beta-6 AppImage journey

The packaged beta-6 AppImage, not a source/dev player, was paired to the isolated local package stack and exercised with a real uploaded PNG delivered through MinIO and the CMS media proxy.

- A single-image presentation with a four-second nominal item duration was scheduled and published to the paired screen.
- The player fetched the exact immutable snapshot, cached and rendered the image, then reported the exact publish and snapshot IDs. The publish target changed from pending to `SUCCESS`; its first `applied_at` remained `2026-11-02T10:35:07.136Z`.
- More than four seconds after the image loaded, the server still received one active slot for the exact schedule. This confirms that visibly held static content is not falsely removed from active playback evidence when its nominal duration elapses.
- The packaged player was stopped and restarted while the schedule remained active. It revalidated its identity through REST, fetched the authoritative snapshot, rendered the image again, and reported one fresh active slot. The screen overview reported live heartbeat playback for the expected schedule and publish.
- Taking down the publish cleared the schedule and closed the renderer-confirmed playback occurrence at 41 seconds. The PoP service uploaded the event with `replayed: 1`, `failed: 0`, and an empty remaining buffer/spool.
- The schedule report then showed the exact publish as target `SUCCESS`, lifecycle `Taken down`, and `proof_observed: true` at `2026-11-02T10:35:57.694Z`.

An earlier negative run deliberately retained the Docker-only MinIO origin. The player could not render that media and therefore did not create false proof-of-play. This demonstrated that delivery acknowledgement and renderer proof remain separate signals. The disposable runtime included generated credentials and certificates; only the safe results above were retained in this document.

## Local package runtime acceptance

The beta-5 component packages were installed into isolated Docker projects rather than only being inspected by scripts; the server application code and database migration level are unchanged in beta 6:

- The server package started a clean PostgreSQL, MinIO, Valkey, API, and worker environment. All migrations completed, an administrator could bootstrap and log in, the one-time bootstrap password file was removed, and the API and worker remained healthy without restarts.
- The CMS package started against that server. The CMS route, proxied API health route, Grafana health route, and Grafana login route all returned HTTP 200.
- The beta-5 package containers remained isolated from the older temporary deployment and were used only as the compatible backend for the beta-6 AppImage journey above. This is local functional acceptance, not evidence that the five production VMs, firewall, DNS, storage, or physical players are correct.

## Remaining release QA — not claimed

- Install/upgrade and rollback on the real five VMs.
- Configure real player addresses, per-player HTTPS metrics server certificates, Prometheus client credentials, and the firewall rule allowing only the observability VM to reach player port 3300.
- Pair real players, publish schedules, and measure publish acknowledgement, proof-of-play, hardware telemetry, outage/return, backend-unknown time, and dashboard/report values against observed events.
- Confirm physical-display behavior and the five-second deletion-to-pairing requirement on deployed players.
- Execute production-like load gates, multi-machine soak, Windows-player coverage, capacity evidence, and a production-sized restore rehearsal.
- Verify the inaccessible production environment after the management network is available.

These checks require the operator-provided VM/player hostnames, IP addresses, SSH usernames, and a secure authentication path. The feature branch must not be merged into `release-01` merely from local beta evidence.
