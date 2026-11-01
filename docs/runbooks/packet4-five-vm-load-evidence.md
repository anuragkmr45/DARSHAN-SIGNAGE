# Packet 4 five-VM load evidence

This runner generates real traffic against a pre-provisioned representative QA site. It is not a capacity model and does not mark a release gate passed. Independent QA must correlate its evidence with proxy, API, worker, PostgreSQL, MinIO, Valkey and host metrics.

## Safety and prerequisites

- Use the representative five-VM QA environment only. The runner requires HTTPS except for loopback development.
- Provision 1,000 paired QA Screens and 40 active QA CMS users. CMS access tokens must remain valid for the complete baseline plus spike. Clear unrelated pending commands before a fanout measurement.
- Put credentials in an absolute-path JSON file outside the repository and run `chmod 600` on it. Never commit or attach this file to evidence.
- Use a dedicated evidence directory with enough space. Raw request evidence contains IDs and timings but never tokens or device serial values.
- Five 500 MiB uploads create real retained Media. Arrange approved post-test cleanup after evidence review.
- Start production-sized backup, media processing and host/VM metric capture independently so they overlap the baseline phase.

The credential manifest has this shape; values below are field descriptions, not usable credentials:

```json
{
  "players": [
    {
      "deviceId": "paired QA screen ID",
      "serial": "pre-provisioned QA device certificate serial",
      "privateKeyPath": "/absolute/external/mode-600/player-private-key.pem",
      "mediaId": "existing QA media ID",
      "scheduleId": "existing QA schedule ID",
      "forwardedFor": "unique simulated client IP"
    }
  ],
  "cmsUsers": [
    {
      "accessToken": "pre-provisioned short-lived QA access token",
      "forwardedFor": "unique simulated client IP"
    }
  ]
}
```

Each player key path must be unique, absolute, outside the repository and mode `600`. The runner preloads and parses all 1,000 RSA private keys before any traffic; key contents and filesystem paths are never written to evidence. Every device request, including command acknowledgement, is signed with the production `DARSHAN_DEVICE_AUTH_V1` canonical request and includes the v1 timestamp, signature and serial headers.

Copy `scripts/load/groups-1-4-qa-load.example.json` outside the repository and review the target, durations, CMS read flows, backlog window and evidence directory. Install the `darshan-server` dependencies first; the runner uses the candidate's pinned Socket.IO client. The fixed Packet 4 shape cannot be reduced: 500 baseline player Socket.IO connections, 1,000 connections for a five-minute spike, 40 CMS users, and five concurrent 500 MiB uploads. A smaller approved site may instead use the explicit `site-capacity-v1` profile; `scripts/load/pxe-drdo-site-capacity.example.json` binds PXE to 10 normal players and a 20-player five-minute spike while preserving the CMS and upload stress gates. The resulting capacity certificate must use the same normal maximum. Every simulated playback transition submits PoP. Each player also exercises signed heartbeat, desired-state, command polling and token-bound command acknowledgement. `COMMAND_AVAILABLE` and `RESYNC_REQUIRED` notifications immediately wake their corresponding authoritative REST paths.

## Validate without traffic

Dry-run is the default. It parses the full config and the external credential manifest, checks counts/uniqueness/file permissions, and prints the projected plan without making a network request:

```bash
node scripts/load/groups-1-4-qa-load.mjs \
  --config /etc/darshan-qa/packet4-load.json \
  --credentials /etc/darshan-qa/packet4-credentials.json
```

Run its focused tests before using a frozen release candidate:

```bash
node --test scripts/load/groups-1-4-qa-load.test.mjs
```

## Execute the measured workload

Execution requires both `--execute` and an exact acknowledgement containing the normalized target origin. A public or production-named target additionally requires `allowProductionLookingTarget: true` in the reviewed config. This is a safety acknowledgement, not approval to test production.

```bash
node scripts/load/groups-1-4-qa-load.mjs \
  --config /etc/darshan-qa/packet4-load.json \
  --credentials /etc/darshan-qa/packet4-credentials.json \
  --execute \
  --acknowledge-qa-target 'I_ACKNOWLEDGE_DESTRUCTIVE_QA_LOAD_ON_https://darshan-api.qa.internal'
```

To measure command fanout, configure a site-specific, pre-provisioned QA trigger in `fanout`, set `enabled: true`, and set its exact expected recipients. The runner invokes it once at phase start and counts unique devices/commands observed and acknowledged. The trigger is deliberately not hard-coded because emergency/publish fixtures and authorization are site-owned.

For the trusted-proxy case, run through the configured QA reverse proxy with `proxyScenario.mode: "trusted"`; all generator traffic shares the proxy source while manifest `forwardedFor` values remain distinct. Repeat against an untrusted direct ingress with `mode: "untrusted"` and confirm forwarded values are ignored by the server-side/proxy evidence. Review 429 counts rather than assuming a zero count proves correct trust configuration.

## Evidence and independent decision

Each run creates an immutable timestamped directory containing:

- `requests.ndjson`: status and latency for every operation, including heartbeats, desired state, commands/acks, PoP, CMS flows, upload parts and optional fanout;
- `resources.ndjson`: generator resource samples plus configured same-origin metric/health probe inputs;
- `summary.json`: per-operation p50/p95/p99, error rates, PoP attempted/accepted, 429 counts, unique command recipients, backlog-recovery timing and generator resource totals;
- `run-plan.json`: the credential-free dry-run plan and required release shape.

The summary stores hashes of the reviewed config and credential manifest, never credential contents, and always reports `release_gate.status: "NOT_EVALUATED"`. QA must add external CPU/memory (<80%), proxy trust/rate-limit, database/object counts and hashes, queue depth/backlog recovery, emergency display timing, command fanout reconciliation, PoP database reconciliation and reviewer approval. Apply the thresholds in `qa-artifacts/evidence/groups-1-4-release-gates-2026-11-01.md`; missing external evidence or any incomplete runner status blocks approval.
